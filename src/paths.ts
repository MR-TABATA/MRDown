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

/** Directory portion of a path (everything before the final separator). */
export function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i <= 0 ? '' : path.slice(0, i);
}

/**
 * Turn arbitrary heading text into a safe file name (no path separators or
 * characters Windows forbids), collapsed and length-capped. Falls back to
 * `untitled` when nothing usable remains.
 */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim();
  return cleaned || 'untitled';
}

/** Abbreviate the home-directory prefix to `~` (home should have no trailing slash). */
export function tildify(path: string, home: string): string {
  if (home && (path === home || path.startsWith(`${home}/`))) {
    return `~${path.slice(home.length)}`;
  }
  return path;
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

/** Collapse `.` and `..` segments, preserving a POSIX/`C:`/UNC absolute prefix. */
function normalizeSegments(path: string, sep: string): string {
  let prefix = '';
  let rest = path;
  const drive = /^([a-zA-Z]:)[\\/]/.exec(path);
  if (path.startsWith('/')) {
    prefix = sep;
    rest = path.slice(1);
  } else if (drive) {
    prefix = drive[1] + sep;
    rest = path.slice(drive[0].length);
  } else if (path.startsWith('\\\\')) {
    prefix = sep + sep;
    rest = path.slice(2);
  }
  const out: string[] = [];
  for (const part of rest.split(/[\\/]+/)) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (!prefix) out.push('..');
    } else {
      out.push(part);
    }
  }
  return prefix + out.join(sep);
}

/**
 * Resolve a Markdown link `href` to a local document this app can open.
 *
 * Returns an absolute filesystem path (with any `#fragment`/`?query` stripped,
 * `.`/`..` collapsed) when the href points at a supported local file to open
 * in-app, or `null` when it's an in-page anchor, a remote/non-file URL, a file
 * type we don't open, or an unresolvable relative link (no base directory) —
 * those are left to the caller to scroll to or open externally.
 */
export function resolveDocLink(filePath: string, href: string): string | null {
  if (!href || href.startsWith('#')) return null;
  let raw = href;
  if (/^file:\/\//i.test(raw)) {
    raw = raw.replace(/^file:\/\//i, '');
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[a-zA-Z]:[\\/]/.test(raw)) {
    return null; // remote/non-file scheme (http, mailto, data, tauri, …) — not a drive letter
  }
  raw = raw.split('#')[0].split('?')[0];
  let path: string;
  try {
    path = decodeURIComponent(raw);
  } catch {
    path = raw;
  }
  if (!path || !isSupported(path)) return null;
  const sep = filePath.includes('\\') ? '\\' : '/';
  const isAbsolute =
    path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\');
  if (isAbsolute) return normalizeSegments(path, sep);
  const dir = filePath.slice(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')));
  if (!dir) return null; // no base to resolve a relative link against (e.g. an untitled doc)
  return normalizeSegments(`${dir}${sep}${path}`, sep);
}
