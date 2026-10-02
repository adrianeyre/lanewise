import type { FoundUpdate, Updater, UpdateStatus } from "./updater";

/** Tauri's `invoke`, which only `platform/tauri.ts` imports. */
export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

/** How often to ask how far the download has got. */
export const PROGRESS_MS = 250;

/** The shell rejects with what to say as a string; this makes it an Error. */
function saying(error: unknown): never {
  throw error instanceof Error ? error : new Error(String(error));
}

/**
 * Updates in the Desktop App: the Tauri shell's own commands
 * (`desktop/src/update.rs`) check the latest Release and install through
 * Tauri's updater. The download's progress is polled over IPC.
 */
export function desktopUpdater(invoke: Invoke): Updater {
  return {
    status: () => invoke<UpdateStatus>("update_status").catch(saying),
    check: () => invoke<FoundUpdate | null>("update_check").catch(saying),
    async install(onProgress) {
      const poll = setInterval(() => void invoke<number>("update_progress").then(onProgress, () => {}), PROGRESS_MS);
      try {
        await invoke("update_install").catch(saying);
      } finally {
        clearInterval(poll);
      }
    },
  };
}
