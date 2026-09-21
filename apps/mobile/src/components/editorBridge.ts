import type { NoteEditorProps, PluginVaultRequest } from './NoteEditor.types';

/**
 * App side of the conversation with the editor page (`editor-web/main.tsx`, which lists the messages).
 * Shared by the WebView editor (phone) and the iframe editor (web preview); each supplies how to `post`.
 */
export function createEditorBridge(post: (message: object) => void, getProps: () => NoteEditorProps) {
  let ready = false;
  let runSeq = 0;
  const runs = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();

  const sendPlugins = () => {
    if (ready) post({ type: 'plugins', plugins: getProps().plugins });
  };

  return {
    isReady: () => ready,
    sendEmbeds: () => ready && post({ type: 'embeds', embeds: [...getProps().embeds] }),
    sendPlugins,
    insert: (text: string) => post({ type: 'insert', text }),
    runPluginCommand(pluginId: string, commandId: string): Promise<void> {
      const n = ++runSeq;
      return new Promise((resolve, reject) => {
        runs.set(n, { resolve, reject });
        post({ type: 'plugin-run', n, pluginId, commandId });
      });
    },

    /** Handle one message from the page. */
    handle(raw: string) {
      let msg: { type: string; [key: string]: unknown };
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      const props = getProps();
      switch (msg.type) {
        case 'ready':
          ready = true;
          post({ type: 'init', value: props.initialText, notePath: props.path, embeds: [...props.embeds] });
          sendPlugins();
          break;
        case 'change':
          if (typeof msg.value === 'string') props.onChange(msg.value);
          break;
        case 'swipe-right':
          props.onSwipeRight();
          break;
        case 'notice':
          props.onNotice(String(msg.message));
          break;
        case 'plugin-commands':
          props.onPluginCommands(msg.commands as never);
          break;
        case 'plugin-status':
          props.onPluginStatus(String(msg.id), (msg.error as string | null) ?? null);
          break;
        case 'plugin-result': {
          const run = runs.get(Number(msg.n));
          runs.delete(Number(msg.n));
          if (run) (msg.error ? run.reject(new Error(String(msg.error))) : run.resolve());
          break;
        }
        case 'vault': {
          const id = msg.id;
          props.onVault(msg.request as PluginVaultRequest).then(
            (value) => post({ type: 'vault-result', id, ok: true, value }),
            (e: unknown) => post({ type: 'vault-result', id, ok: false, error: e instanceof Error ? e.message : String(e) }),
          );
          break;
        }
      }
    },
  };
}
