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

// Ranges covering CJK ideographs, kana and full-width punctuation — counted per
// character (no spaces between "words"), unlike space-delimited scripts.
const CJK = /[぀-ヿ㐀-䶿一-鿿＀-￯]/g;

/**
 * Character count, (space-delimited) word count and an estimated reading time
 * for a document. CJK characters are counted individually and read at ~500/min;
 * the remaining space-delimited words at ~200/min, so mixed JA/EN text is
 * estimated sensibly. Reading time is at least a minute for any non-empty text.
 */
export function docStats(text: string): { chars: number; words: number; minutes: number } {
  const chars = [...text].length;
  const cjk = (text.match(CJK) || []).length;
  const words = (text.replace(CJK, ' ').match(/\S+/g) || []).length;
  const minutes = chars === 0 ? 0 : Math.max(1, Math.round(cjk / 500 + words / 200));
  return { chars, words, minutes };
}

const FENCE = /^\s{0,3}(```|~~~)/;
const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

/**
 * Flip the `[ ]`/`[x]` of the `index`-th task-list item, counting the same items
 * the renderer turns into checkboxes: fenced code blocks and a leading YAML
 * frontmatter block are skipped, so a `- [ ]` inside either can't shift the
 * mapping between a clicked checkbox and its source line. Returns the new source,
 * or null when there is no such item.
 */
export function toggleTaskListItem(source: string, index: number): string | null {
  const lines = source.split('\n');
  let start = 0;
  if (/^---\s*$/.test(lines[0] ?? '')) {
    const close = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l));
    if (close !== -1) start = close + 1;
  }

  let fenced = false;
  let seen = 0;
  for (let i = start; i < lines.length; i++) {
    if (FENCE.test(lines[i])) {
      fenced = !fenced;
      continue;
    }
    if (fenced || !TASK.test(lines[i])) continue;
    if (seen === index) {
      lines[i] = lines[i].replace(TASK, (_m, open: string, mark: string, close: string) =>
        `${open}${mark === ' ' ? 'x' : ' '}${close}`
      );
      return lines.join('\n');
    }
    seen++;
  }
  return null;
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

/** The fields a corporate document header shows, in the order it shows them. */
export type DocHeaderField = 'title' | 'docNumber' | 'version' | 'date' | 'author' | 'classification';
export type DocHeaderFields = Partial<Record<DocHeaderField, string>>;

/**
 * Frontmatter names that map onto each header field. Japanese and English both:
 * the templates ship in both languages, and a document one person writes gets
 * read by someone whose app is in the other. Matching is case-insensitive.
 *
 * Several names share a field on purpose (`updated`/`created` are both a date) —
 * the first one present in the document wins and any later one falls through to
 * the plain metadata panel, so nothing is silently dropped.
 */
const DOC_HEADER_KEYS: Record<DocHeaderField, string[]> = {
  title: ['title', 'タイトル', '文書名', '件名'],
  docNumber: ['doc', 'docnumber', 'doc_number', 'doc-number', 'document', '文書番号', '管理番号', '番号'],
  version: ['version', 'ver', 'rev', 'revision', 'バージョン', '版数', '版'],
  date: ['date', 'updated', 'created', '日付', '作成日', '更新日'],
  author: ['author', 'owner', '作成者', '担当', '作成'],
  classification: ['classification', 'confidential', 'confidentiality', '機密区分', '取扱区分', '取扱', '区分'],
};

const DOC_HEADER_ALIAS = new Map<string, DocHeaderField>();
for (const [field, names] of Object.entries(DOC_HEADER_KEYS) as [DocHeaderField, string[]][]) {
  for (const name of names) DOC_HEADER_ALIAS.set(name, field);
}

/** The order fields appear in the header's meta row (title/classification sit apart). */
const DOC_HEADER_META_ORDER: DocHeaderField[] = ['docNumber', 'version', 'date', 'author'];

/**
 * Split frontmatter into the fields a document header can draw and everything
 * else. `rest` keeps its original lines so it can go through `frontmatterToHtml`
 * unchanged — an unrecognised key is never lost, it just stays in the panel.
 *
 * A known key left blank is swallowed rather than passed on: the templates ship
 * `title:` and `author:` empty for the author to fill in, and showing those in
 * the metadata panel would greet every new document with a card full of empty
 * keys. A blank one doesn't claim the field either, so filling in a later
 * duplicate still works.
 *
 * Indented lines are nested YAML belonging to the key above, so they are never
 * read as a header field of their own.
 */
export function parseDocHeader(frontmatter: string): { fields: DocHeaderFields; rest: string } {
  const fields: DocHeaderFields = {};
  const rest: string[] = [];
  for (const line of frontmatter.split('\n')) {
    const m = /^([^\s:][^:]*?)[ \t]*:[ \t]*(.*)$/.exec(line);
    const field = m ? DOC_HEADER_ALIAS.get(m[1].trim().toLowerCase()) : undefined;
    if (m && field) {
      const value = m[2].trim();
      if (value === '') continue; // waiting to be filled in
      if (fields[field] === undefined) {
        fields[field] = value;
        continue;
      }
      // A second name for a field already set (`date` then `updated`): keep it
      // visible in the panel rather than drop it on the floor.
    }
    if (line.trim() !== '') rest.push(line);
  }
  return { fields, rest: rest.join('\n') };
}

/**
 * Draw the document header as a band at the top of the preview: logo and
 * confidentiality marking on one row, the title under them, then the document
 * number / version / date / author.
 *
 * The band is deliberately tied to the document's own frontmatter — with no
 * known field there is nothing to draw, and `withLogo` alone will not summon
 * one. Otherwise every README you opened would sprout your company's logo.
 *
 * The logo `<img>` is emitted without a `src`: the app's sanitizer drops
 * `data:`/`asset:` URLs, so the caller fills it in on the sanitized DOM (the
 * same route local images take).
 */
export function docHeaderToHtml(
  fields: DocHeaderFields,
  labels: Record<DocHeaderField, string>,
  withLogo: boolean,
): string {
  const has = DOC_HEADER_META_ORDER.some((f) => fields[f]) || !!fields.title || !!fields.classification;
  if (!has) return '';

  const logo = withLogo ? '<img class="doc-header-logo" alt="">' : '';
  const mark = fields.classification
    ? `<span class="doc-header-mark">${escapeHtml(fields.classification)}</span>`
    : '';
  // Keep the row even when only one side is filled, so the logo stays left and
  // the marking stays right instead of collapsing onto each other.
  const top = logo || mark ? `<div class="doc-header-top">${logo}${mark}</div>` : '';
  const title = fields.title
    ? `<div class="doc-header-title">${escapeHtml(fields.title)}</div>`
    : '';
  const meta = DOC_HEADER_META_ORDER.filter((f) => fields[f])
    .map(
      (f) =>
        `<span class="doc-header-item"><span class="doc-header-key">${escapeHtml(labels[f])}</span>` +
        `<span class="doc-header-val">${escapeHtml(fields[f]!)}</span></span>`,
    )
    .join('');
  const metaRow = meta ? `<div class="doc-header-meta">${meta}</div>` : '';
  return `<div class="doc-header">${top}${title}${metaRow}</div>`;
}
