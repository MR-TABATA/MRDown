// Stands in for `@tauri-apps/api/core`: the 17 commands src/main.ts invokes.

import { files, versions, committed, recents, type Version } from './vfs';

function basename(p: string) {
  return p.split('/').pop() ?? p;
}

export async function invoke<T>(cmd: string, args: any = {}): Promise<T> {
  const r = (v: unknown) => v as T;

  switch (cmd) {
    case 'read_file': {
      const e = files.get(args.path);
      if (!e) throw new Error(`No such file: ${args.path}`);
      return r(e.content);
    }
    case 'file_mtime': {
      const e = files.get(args.path);
      if (!e) throw new Error(`No such file: ${args.path}`);
      return r(e.mtime);
    }
    case 'save_file':
    case 'export_file': {
      const prev = files.get(args.path);
      files.set(args.path, { content: args.content, mtime: (prev?.mtime ?? Date.now()) + 1000 });
      return r(undefined);
    }
    case 'delete_file':
      files.delete(args.path);
      return r(undefined);

    case 'read_dir': {
      const prefix = args.dir.endsWith('/') ? args.dir : `${args.dir}/`;
      const seen = new Map<string, { name: string; path: string; is_dir: boolean }>();
      for (const p of files.keys()) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        const slash = rest.indexOf('/');
        const name = slash === -1 ? rest : rest.slice(0, slash);
        const path = prefix + name;
        if (!seen.has(path)) seen.set(path, { name, path, is_dir: slash !== -1 });
      }
      return r([...seen.values()].sort((a, b) => Number(b.is_dir) - Number(a.is_dir) || a.name.localeCompare(b.name)));
    }

    case 'get_recent_files':
      return r([...recents]);
    case 'add_recent_file': {
      const next = [args.path, ...recents.filter((p) => p !== args.path)].slice(0, 10);
      recents.length = 0;
      recents.push(...next);
      return r([...recents]);
    }
    case 'get_pending_file':
      return r(null);

    case 'snapshot_version': {
      const list = versions.get(args.path) ?? [];
      // The real command dedupes against the newest snapshot and keeps ids
      // monotonic, so two snapshots in one millisecond stay ordered.
      const latest = list[list.length - 1];
      if (latest?.content === args.content) return r(undefined);
      const id = latest && Date.now() <= latest.id ? latest.id + 1 : Date.now();
      // Mirrors the backend's one attribution: an external change that lands on
      // exactly the committed bytes was Git putting the file back.
      const kind =
        args.kind === 'external' && committed.get(args.path) === args.content ? 'git' : (args.kind ?? 'save');
      list.push({ id, bytes: args.content.length, content: args.content, kind });
      versions.set(args.path, list);
      return r(undefined);
    }
    case 'list_versions': {
      const list = versions.get(args.path) ?? [];
      // The real command hands back newest-first metadata only.
      return r(
        [...list].reverse().map(({ id, bytes, kind }): Omit<Version, 'content'> => ({ id, bytes, kind })),
      );
    }
    case 'read_version': {
      const v = (versions.get(args.path) ?? []).find((x) => x.id === args.id);
      if (!v) throw new Error(`No such version: ${args.id}`);
      return r(v.content);
    }

    // Stands in for the file's content at HEAD. `null` is the honest answer for
    // a fixture that isn't in a repository, and it's the path the UI has to
    // handle anyway (no Git, untracked, no commits).
    case 'git_head_content':
      return r(committed.get(args.path) ?? null);

    case 'save_image': {
      files.set(args.path, { content: `<binary ${basename(args.path)}>`, mtime: Date.now() });
      return r(undefined);
    }

    // A browser has no native menu, so record what the app asked for instead of
    // applying it; that's the only way the menu's enabled state is observable here.
    case 'set_document_open':
      window.__menuDocOpen = args.open;
      return r(undefined);

    // Nothing to observe in a browser; the demo never exercises these.
    case 'apply_menu':
    case 'print_document':
      return r(undefined);

    default:
      throw new Error(`mock invoke: unhandled command "${cmd}"`);
  }
}

/** Local images aren't part of the demo fixtures; hand back a harmless URL. */
export function convertFileSrc(path: string): string {
  return `about:blank#${encodeURIComponent(path)}`;
}
