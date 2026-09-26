import { VAULT_DIR } from '../vault';
import type { NoteEditorProps, PluginVaultRequest } from './NoteEditor.types';

/**
 * App side of the conversation with the editor page (`editor-web/main.tsx`, which lists the messages).
 * Shared by the WebView editor (phone) and the iframe editor (web preview); each supplies how to `post`.
 * `key`: a secret the app wrote into the page; a message without it is ignored. The page runs plugins, and on a phone their
 * frames may be able to reach the WebView's bridge directly, but they can't read the page's variables.
 */
export function createEditorBridge(post: (message: object) => void, getProps: () => NoteEditorProps, key?: string) {
  let ready = false;
  let runSeq = 0;
  const runs = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();

  const sendPlugins = () => {
    if (ready) post({ type: 'plugins', plugins: getProps().plugins });
  };

  /** Give the page a note to show (at first, and again when another note opens in the same page). */
  const sendInit = () => {
    const props = getProps();
    post({
      type: 'init',
      value: props.initialText,
      notePath: props.path,
      embeds: [...props.embeds],
      title: props.title,
      reading: props.reading,
      ...(props.canvas && { canvas: { vaultDir: VAULT_DIR, ...props.canvas } }),
    });
  };

  return {
    isReady: () => ready,
    /** Another note was opened: show it in the page that is already loaded (its plugins keep running). */
    sendOpen: () => ready && sendInit(),
    sendEmbeds: () => ready && post({ type: 'embeds', embeds: [...getProps().embeds] }),
    sendPlugins,
    sendReading: () => ready && post({ type: 'reading', on: getProps().reading }),
    sendTitle: () => ready && post({ type: 'title', title: getProps().title }),
    sendFiles: () => ready && getProps().canvas && post({ type: 'files', ...getProps().canvas }),
    insert: (text: string) => post({ type: 'insert', text }),
    setText: (text: string) => ready && post({ type: 'value', value: text }),
    addFile: (file: string) => post({ type: 'add-file', file }),
    openPluginButton: (pluginId: string) => post({ type: 'plugin-button', pluginId }),
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
      if (key !== undefined && msg.key !== key) return; // not from the editor page (a plugin's frame, or some other page)
      const props = getProps();
      switch (msg.type) {
        case 'ready':
          ready = true;
          sendInit();
          sendPlugins();
          break;
        case 'change':
          if (typeof msg.value === 'string') props.onChange(msg.value, typeof msg.path === 'string' ? msg.path : undefined);
          break;
        case 'rename':
          props.onRename(String(msg.title)).then(
            (ok) => post({ type: 'rename-result', n: msg.n, ok }),
            () => post({ type: 'rename-result', n: msg.n, ok: false }),
          );
          break;
        case 'swipe-right':
          props.onSwipeRight();
          break;
        case 'open':
          props.onOpenFile(String(msg.file));
          break;
        case 'open-link':
          props.onOpenUrl(String(msg.url));
          break;
        case 'notice':
          props.onNotice(String(msg.message));
          break;
        case 'plugin-commands':
          props.onPluginCommands(msg.commands as never);
          break;
        case 'plugin-buttons':
          props.onPluginButtons(msg.buttons as never);
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
