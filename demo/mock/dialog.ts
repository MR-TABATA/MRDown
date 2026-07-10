// `@tauri-apps/plugin-dialog`. A native file picker can't appear in a recording,
// so the scenario never opens one; these exist to keep the module resolvable.

export async function open(_opts?: unknown): Promise<string | null> {
  return null;
}

export async function save(_opts?: unknown): Promise<string | null> {
  return null;
}

export async function confirm(_message: string, _opts?: unknown): Promise<boolean> {
  return true;
}
