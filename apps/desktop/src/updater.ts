import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const inTauri = () => Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

/** The newer release published on GitHub (see `plugins.updater` in tauri.conf.json), or null when up to date or outside the app window. */
export const findUpdate = (): Promise<Update | null> => (inTauri() ? check() : Promise.resolve(null));

/** Downloads and installs the update (its signature is checked against the key in tauri.conf.json), then restarts Granite. */
export async function installUpdate(update: Update, onProgress: (percent: number | null) => void): Promise<void> {
  let total = 0;
  let done = 0;
  await update.downloadAndInstall((e) => {
    if (e.event === "Started") total = e.data.contentLength ?? 0;
    else if (e.event === "Progress") {
      done += e.data.chunkLength;
      onProgress(total ? Math.round((done / total) * 100) : null);
    }
  });
  await relaunch();
}
