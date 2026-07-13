// `@tauri-apps/plugin-dialog`. A native file picker can't appear in a recording,
// so the scenario never opens one; these exist to keep the module resolvable.

/**
 * A browser has no file dialog. The harness stands in for the user's choice:
 * `window.__pick = [pathA, pathB]` is what they would have selected next.
 * Consumed on use, so a stale answer can't leak into a later dialog.
 */
export async function open(opts?: { multiple?: boolean }): Promise<string | string[] | null> {
  const picked = window.__pick ?? null;
  window.__pick = undefined;
  if (picked === null) return null;
  return opts?.multiple ? picked : (picked[0] ?? null);
}

export async function save(_opts?: unknown): Promise<string | null> {
  return null;
}

export async function confirm(_message: string, _opts?: unknown): Promise<boolean> {
  return true;
}
