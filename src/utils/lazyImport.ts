// Recovering from a page that outlived a deployment.
//
// Every route and the two export libraries are lazy-loaded, and Vite names each
// chunk with a content hash. GitHub Pages replaces the whole directory on deploy, so
// the moment a new build lands, every hash from the old one is gone. A tab that is
// already open still holds the old entry script, so the first lazy action it takes --
// opening the editor, or exporting a character to PDF -- asks for a file that no
// longer exists and dies with "Failed to fetch dynamically imported module".
//
// Nothing can stop a page from being open across a deploy. What can be done is to
// notice it and reload, which fetches the new HTML and therefore the new names. The
// reload happens once per failure, not in a loop: the flag is cleared on the next
// boot, so the next deploy gets its own chance.

const RELOAD_FLAG = "character-studio.chunk-reload";

// This module executing means the entry script loaded, which means the page is
// running current names. Clearing here is what keeps the guard from latching: it is
// only ever set between a failure and the reload that follows it.
try {
  sessionStorage.removeItem(RELOAD_FLAG);
} catch {
  // Storage unavailable; the guard simply never latches and reloads are unguarded.
}

/**
 * Whether an error is the browser failing to fetch a chunk, as opposed to the chunk
 * loading and throwing. The distinction matters: only the first is worth a reload,
 * and reloading on a genuine bug would hide it behind a refresh loop.
 */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");

  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Loading chunk \d+ failed/i.test(message) ||
    /Loading CSS chunk \d+ failed/i.test(message)
  );
}

type RecoveryOptions = {
  /** Injected in tests; defaults to the real sessionStorage. */
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  /** Injected in tests; defaults to a real page reload. */
  reload?: () => void;
};

/**
 * Runs a dynamic import, and turns a stale-chunk failure into one reload.
 *
 * When a reload is started the returned promise deliberately never settles: the page
 * is going away, and resolving would let React render a screen the user is about to
 * lose -- or worse, an error boundary -- for the frame before the reload lands.
 */
export async function importWithRecovery<T>(
  load: () => Promise<T>,
  options: RecoveryOptions = {},
): Promise<T> {
  const storage = options.storage ?? (typeof sessionStorage === "undefined" ? null : sessionStorage);
  const reload = options.reload ?? (() => window.location.reload());

  try {
    return await load();
  } catch (error) {
    // Already tried once for this page: reloading again would loop, so the error is
    // passed through for the caller to show.
    if (!isChunkLoadError(error) || storage?.getItem(RELOAD_FLAG)) {
      throw error;
    }

    try {
      storage?.setItem(RELOAD_FLAG, "1");
    } catch {
      // If the flag cannot be written the reload is unguarded; still better than a
      // dead export button.
    }

    reload();
    return new Promise<T>(() => {});
  }
}
