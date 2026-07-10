// `@tauri-apps/api/path`.

import { demo } from './vfs';

export async function homeDir(): Promise<string> {
  return demo.HOME;
}

export async function resolveResource(p: string): Promise<string> {
  return `/app/resources/${p}`;
}
