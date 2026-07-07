// Pure Markdown-rendering helpers — no DOM or Tauri dependencies.

/**
 * Build a URL-friendly id from heading text. Keeps unicode letters/numbers
 * (so Japanese headings survive) and collapses whitespace to hyphens.
 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '');
}

/**
 * Text of the first ATX heading (`# ...` through `###### ...`) in a document,
 * with any trailing `#` closers stripped. Returns null when there is none —
 * used to suggest a file name when saving an untitled buffer.
 */
export function firstHeadingTitle(source: string): string | null {
  for (const line of source.split('\n')) {
    const m = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * Split leading YAML frontmatter off a document. A `---` on the very first line
 * through the next `---`/`...` fence (Jekyll/Hugo/Obsidian style) is returned in
 * `frontmatter` (its inner lines, no fences) and removed from `body`. Without a
 * closing fence there is no frontmatter, so the source is returned unchanged —
 * this keeps a plain thematic break at the top of a file from being swallowed.
 */
export function extractFrontmatter(source: string): { frontmatter: string | null; body: string } {
  // Tolerate a UTF-8 BOM and CRLF line endings.
  const text = source.replace(/^﻿/, '');
  if (!/^---[ \t]*\r?\n/.test(text)) return { frontmatter: null, body: source };
  const lines = text.split('\n');
  for (let i = 1; i < lines.length; i++) {
    if (/^(---|\.\.\.)[ \t]*\r?$/.test(lines[i])) {
      const frontmatter = lines.slice(1, i).join('\n').replace(/\r$/gm, '');
      const body = lines.slice(i + 1).join('\n');
      return { frontmatter, body };
    }
  }
  return { frontmatter: null, body: source };
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Render extracted frontmatter as a collapsed metadata panel instead of the
 * broken `<hr>` + text `marked` would produce. Flat `key: value` lines become a
 * two-column table; anything else (nested keys, list items, block scalars) is
 * shown verbatim so no YAML is silently misparsed. All text is HTML-escaped;
 * the result is still meant to pass through the app's sanitizer.
 */
export function frontmatterToHtml(frontmatter: string, label: string): string {
  const rows = frontmatter.split('\n').map((line) => {
    if (line.trim() === '') return '';
    const m = /^([A-Za-z0-9_.-]+)[ \t]*:[ \t]*(.*)$/.exec(line);
    if (m && m[2] !== '') {
      return `<tr><th>${escapeHtml(m[1])}</th><td>${escapeHtml(m[2])}</td></tr>`;
    }
    // A key with only nested content, a list item, or anything we don't split:
    // show the raw line across both columns rather than guess at the YAML.
    return `<tr><td colspan="2"><code>${escapeHtml(line)}</code></td></tr>`;
  });
  return (
    `<details class="frontmatter"><summary>${escapeHtml(label)}</summary>` +
    `<table>${rows.join('')}</table></details>`
  );
}
