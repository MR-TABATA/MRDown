// Pure path helpers — no DOM or Tauri dependencies, so they are unit-testable.

export const SUPPORTED = ['md', 'markdown', 'txt'];

/** Whether a path looks like a Markdown file we can open. */
export function isSupported(path: string): boolean {
  return SUPPORTED.includes((path.split('.').pop() || '').toLowerCase());
}

/** Final path component, handling both POSIX and Windows separators. */
export function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/**
 * Resolve a Markdown image `src` against the document's file path.
 *
 * Returns an absolute filesystem path to feed through `convertFileSrc`, or
 * `null` when the src is remote/data/already-resolved and should be left as-is.
 */
export function resolveImagePath(filePath: string, src: string): string | null {
  if (!src || /^(https?:|data:|blob:|asset:|tauri:)/i.test(src)) return null;
  const sep = filePath.includes('\\') ? '\\' : '/';
  const dir = filePath.slice(0, filePath.lastIndexOf(sep));
  const rel = src.replace(/^\.\//, '');
  const isAbsolute =
    rel.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(rel) || rel.startsWith('\\\\');
  return isAbsolute ? rel : `${dir}${sep}${rel.split('/').join(sep)}`;
}
