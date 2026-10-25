// Pure Markdown-rendering helpers — no DOM or Tauri dependencies.
import { Marked, type MarkedExtension, type Token, type Tokens } from 'marked';
import markedFootnote from 'marked-footnote';

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

/** Block-level tokens end their line, so words in two paragraphs never fuse. */
const BLOCK_TOKENS = new Set(['paragraph', 'heading', 'blockquote', 'code']);

/**
 * The text a reader actually reads: the Markdown with its notation taken away.
 * `#`, `**`, list markers, link URLs, image paths, HTML tags and frontmatter are
 * not text; a link contributes its label, an image its alt text, and a code
 * block its code (it is read too). Built from the same token stream the preview
 * renders from, so the count follows what is on screen.
 */
export function readableText(source: string): string {
  return readableFromTokens(lexBody(extractFrontmatter(source).body));
}

/**
 * Statistics lex with a `Marked` of their own, never the preview's. The footnote
 * extension keeps state across a lex (whether it has met a definition, and the
 * numbering of references); sharing it would leave that state behind for the next
 * render of a document with footnotes — a lost footnote section, or its first
 * reference numbered 2. Statistics run beside the preview, so they must not.
 */
const statsMarked = new Marked(markedFootnote());

/** Lex the way `parse` does, extension hooks included, so this instance resets too. */
function lexBody(body: string): Token[] {
  const tokens = statsMarked.lexer(body);
  const hook = statsMarked.defaults.walkTokens;
  if (hook) statsMarked.walkTokens(tokens, hook);
  return tokens;
}

function readableFromTokens(all: Token[]): string {
  const plain = (tokens: Token[]): string => {
    let out = '';
    for (const tok of tokens) {
      switch (tok.type) {
        case 'html':
        case 'space':
        case 'def':
          break;
        case 'hr':
        case 'br':
          out += '\n';
          break;
        case 'list':
          for (const item of (tok as Tokens.List).items) out += plain(item.tokens) + '\n';
          break;
        case 'footnotes':
          // The section the preview draws: referenced definitions, once each.
          for (const item of (tok as unknown as { items: Array<{ content: Token[] }> }).items) out += plain(item.content);
          break;
        case 'blockquote': {
          // A callout's `[!NOTE]` marker is not drawn; it is not read either.
          const bq = tok as Tokens.Blockquote;
          const first = bq.tokens[0];
          const m = first?.type === 'paragraph' ? CALLOUT_MARKER.exec(bq.text) : null;
          const kids = m
            ? [{ ...first, tokens: dropLeading((first as Tokens.Paragraph).tokens, m[0].length) } as Token, ...bq.tokens.slice(1)]
            : bq.tokens;
          out += plain(kids) + '\n';
          break;
        }
        case 'table': {
          const t = tok as Tokens.Table;
          for (const row of [t.header, ...t.rows]) out += row.map((c) => plain(c.tokens)).join(' ') + '\n';
          break;
        }
        default: {
          const kids = (tok as { tokens?: Token[] }).tokens;
          if (kids) out += plain(kids);
          else if ('text' in tok) out += (tok as { text: string }).text;
          if (BLOCK_TOKENS.has(tok.type) && kids) out += '\n';
          else if (tok.type === 'code') out += '\n';
        }
      }
    }
    return out;
  };
  return plain(all);
}

/**
 * Size of a document, measured on what is read (see `readableText`): characters
 * without whitespace, space-delimited words, and an estimated reading time.
 * CJK characters count one by one and are read at ~500/min; the remaining words
 * at ~200/min, so mixed JA/EN text is estimated sensibly. `minutes` is 0 for
 * anything under a minute — callers say "under a minute" rather than round a
 * 17-character note up to one.
 */
export function docStats(source: string): DocStats {
  return statsFromText(readableText(source));
}

export interface DocStats {
  chars: number;
  words: number;
  minutes: number;
}

function statsFromText(text: string): DocStats {
  const chars = [...text.replace(/\s+/gu, '')].length;
  const cjk = (text.match(CJK) || []).length;
  const words = (text.replace(CJK, ' ').match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || []).length;
  const exact = cjk / 500 + words / 200;
  return { chars, words, minutes: exact < 1 ? 0 : Math.round(exact) };
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

/** Which header field a frontmatter key names, if any. Case-insensitive. */
export function docHeaderFieldFor(key: string): DocHeaderField | undefined {
  return DOC_HEADER_ALIAS.get(key.trim().toLowerCase());
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

export const CALLOUT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

const CALLOUT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i;

/**
 * GitHub-style callouts: a blockquote whose first line is `[!NOTE]` (also TIP,
 * IMPORTANT, WARNING, CAUTION) renders as a labelled box. Anything else — an
 * unknown kind, or a marker that isn't alone on the first line — stays an
 * ordinary quote, as it does on GitHub. `label` supplies the title text so the
 * box speaks the app's language.
 */
/** Drop the first `n` source characters from a run of inline tokens, cutting
 *  into the token that straddles the boundary (a plain text token, in practice). */
function dropLeading(tokens: Token[], n: number): Token[] {
  const out: Token[] = [];
  for (const tok of tokens) {
    if (n <= 0) {
      out.push(tok);
    } else if (tok.raw.length <= n) {
      n -= tok.raw.length;
    } else if ('text' in tok && typeof tok.text === 'string' && tok.raw === tok.text) {
      out.push({ ...tok, raw: tok.raw.slice(n), text: tok.text.slice(n) } as Token);
      n = 0;
    } else {
      out.push(tok); // not text: keep whole rather than corrupt it
      n = 0;
    }
  }
  return out;
}

export function calloutExtension(label: (kind: CalloutKind) => string): MarkedExtension {
  return {
    renderer: {
      blockquote({ text, tokens }) {
        const m = CALLOUT_MARKER.exec(text);
        const first = tokens[0];
        if (!m || first?.type !== 'paragraph') return false; // fall back to marked's own blockquote
        const kind = m[1].toLowerCase() as CalloutKind;
        // Render the tokens already parsed, minus the marker. Re-lexing the body
        // as a fresh document would lose what only the whole document knows:
        // reference-style links defined outside the box.
        const body = dropLeading((first as Tokens.Paragraph).tokens, m[0].length);
        const blocks: Token[] = [...(body.length ? [{ ...first, tokens: body } as Token] : []), ...tokens.slice(1)];
        const inner = blocks.length ? this.parser.parse(blocks) : '';
        return `<div class="callout callout-${kind}"><p class="callout-title">${label(kind)}</p>${inner}</div>\n`;
      },
    },
  };
}

export interface DocCounts {
  lines: number;
  headings: number;
  links: number;
  images: number;
  codeBlocks: number;
  tasks: { done: number; total: number };
}

/**
 * What a document is made of, counted from the same token stream the preview is
 * rendered from — so a `- [ ]` or a link inside a code fence is not counted, and
 * the numbers agree with what the reader sees. Frontmatter is not body text.
 */
export function docCounts(text: string): DocCounts {
  const body = extractFrontmatter(text).body;
  return countsFromTokens(body, body ? lexBody(body) : []);
}

function countsFromTokens(text: string, tokens: Token[]): DocCounts {
  const counts: DocCounts = { lines: 0, headings: 0, links: 0, images: 0, codeBlocks: 0, tasks: { done: 0, total: 0 } };
  if (!text) return counts;
  counts.lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  statsMarked.walkTokens(tokens, (tok) => {
    switch (tok.type) {
      case 'heading': counts.headings++; break;
      case 'link': counts.links++; break;
      case 'image': counts.images++; break;
      case 'code': counts.codeBlocks++; break;
      case 'list_item':
        if (tok.task) {
          counts.tasks.total++;
          if (tok.checked) counts.tasks.done++;
        }
        break;
    }
  });
  return counts;
}

/** Both measures from one parse — what a live panel needs on every keystroke. */
export function docOverview(source: string): { stats: DocStats; counts: DocCounts } {
  const body = extractFrontmatter(source).body;
  const tokens = body ? lexBody(body) : [];
  return { stats: statsFromText(readableFromTokens(tokens)), counts: countsFromTokens(body, tokens) };
}
