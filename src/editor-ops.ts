// Pure text-selection transforms for the editor toolbar — no DOM or Tauri
// dependencies, so the markdown-formatting logic is unit-testable. Each takes
// and returns a `Sel` (the textarea value plus selection range) so the caller
// only has to push the result back into the element.

import { findTables, type Align, type TableBlock } from './table';

export interface Sel {
  text: string;
  start: number;
  end: number;
}

/**
 * Wrap the selection with an inline marker (e.g. `**`, `*`, `` ` ``), or strip
 * it when it is already wrapped — whether the markers sit just outside the
 * selection or inside it. With an empty selection, inserts the markers and
 * places the caret between them.
 */
export function toggleWrap(s: Sel, marker: string): Sel {
  const { text, start, end } = s;
  const m = marker.length;

  // Markers already just outside the selection → unwrap them.
  if (text.slice(start - m, start) === marker && text.slice(end, end + m) === marker) {
    return {
      text: text.slice(0, start - m) + text.slice(start, end) + text.slice(end + m),
      start: start - m,
      end: end - m,
    };
  }

  const selected = text.slice(start, end);

  // Markers captured inside the selection → unwrap them.
  if (selected.length >= 2 * m && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(m, selected.length - m);
    return { text: text.slice(0, start) + inner + text.slice(end), start, end: start + inner.length };
  }

  // Otherwise wrap, keeping the original text selected.
  return {
    text: text.slice(0, start) + marker + selected + marker + text.slice(end),
    start: start + m,
    end: end + m,
  };
}

/**
 * Toggle a line prefix (e.g. `# `, `- `, `> `) on every non-blank line touched
 * by the selection. `detect` matches an existing prefix to strip; when every
 * non-blank line already matches it the block is un-prefixed, otherwise the
 * prefix is added. The whole affected block ends up selected.
 */
export function toggleLinePrefix(s: Sel, prefix: string, detect: RegExp): Sel {
  const { text } = s;
  const lineStart = text.lastIndexOf('\n', s.start - 1) + 1;
  let lineEnd = text.indexOf('\n', s.end);
  if (lineEnd === -1) lineEnd = text.length;

  const lines = text.slice(lineStart, lineEnd).split('\n');
  const nonBlank = lines.filter((l) => l.trim() !== '');
  const allPrefixed = nonBlank.length > 0 && nonBlank.every((l) => detect.test(l));
  // Blank lines inside a block are left alone — but a caret sitting on a blank
  // line *is* the block, and there the prefix is exactly what was asked for
  // (the checklist button, and `/todo`, on an empty line).
  const blankOnly = nonBlank.length === 0;

  const block = lines
    .map((l) => {
      if (l.trim() === '' && !blankOnly) return l;
      return allPrefixed ? l.replace(detect, '') : prefix + l;
    })
    .join('\n');

  return {
    text: text.slice(0, lineStart) + block + text.slice(lineEnd),
    start: lineStart,
    end: lineStart + block.length,
  };
}

/**
 * Wrap the selection as a Markdown link, leaving the `url` placeholder selected
 * so the user can type the destination immediately.
 */
export function insertLink(s: Sel): Sel {
  const { text, start, end } = s;
  const label = text.slice(start, end);
  const urlStart = start + label.length + 3; // '[' + label + ']('
  return {
    text: `${text.slice(0, start)}[${label}](url)${text.slice(end)}`,
    start: urlStart,
    end: urlStart + 3,
  };
}

/** Like {@link insertLink} but for an image (`![alt](url)`). */
export function insertImage(s: Sel): Sel {
  const { text, start, end } = s;
  const alt = text.slice(start, end);
  const urlStart = start + alt.length + 4; // '![' + alt + ']('
  return {
    text: `${text.slice(0, start)}![${alt}](url)${text.slice(end)}`,
    start: urlStart,
    end: urlStart + 3,
  };
}

/**
 * Insert `block` as its own paragraph, adding surrounding blank-line padding
 * only where the neighbouring text doesn't already provide it. Returns the new
 * text and where the block's own content begins.
 */
function asBlock(s: Sel, block: string): { text: string; bodyStart: number } {
  const before = s.text.slice(0, s.start);
  const after = s.text.slice(s.end);
  const lead = before === '' || before.endsWith('\n') ? '' : '\n';
  const trail = after === '' || after.startsWith('\n') ? '' : '\n';
  return { text: before + lead + block + trail + after, bodyStart: s.start + lead.length };
}

/** Wrap the selection in a fenced code block, caret left in the language slot. */
export function insertFence(s: Sel): Sel {
  const body = s.text.slice(s.start, s.end);
  const { text, bodyStart } = asBlock(s, '```\n' + body + '\n```');
  const lang = bodyStart + 3; // just after the opening ```
  return { text, start: lang, end: lang };
}

/** Insert a 2×2 table skeleton with the first header cell selected. */
export function insertTable(s: Sel): Sel {
  const { text, bodyStart } = asBlock(s, '| 見出し | 見出し |\n| --- | --- |\n| セル | セル |');
  const cell = bodyStart + 2; // after the leading '| '
  return { text, start: cell, end: cell + 3 }; // '見出し'
}

/** Insert a horizontal rule (`---`) on its own line. */
export function insertHr(s: Sel): Sel {
  const { text, bodyStart } = asBlock(s, '---');
  const caret = bodyStart + 3;
  return { text, start: caret, end: caret };
}

// --- Typing behaviours (wired to the editor's keydown) ------------------------

/**
 * Enter inside a list item continues the list on the next line: unordered
 * markers repeat, ordered numbers increment, task items start unchecked, and
 * the indent is preserved. Pressing Enter on an *empty* item clears the marker
 * instead (exiting the list). Returns null when the caret isn't in a list line
 * (or a range is selected), so the caller lets the default Enter happen.
 */
export function listContinue(s: Sel): Sel | null {
  if (s.start !== s.end) return null;
  const { text, start } = s;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = text.indexOf('\n', start);
  if (lineEnd === -1) lineEnd = text.length;
  const line = text.slice(lineStart, lineEnd);

  const task = /^(\s*)([-*+]) \[([ xX])\] (.*)$/.exec(line);
  const ul = /^(\s*)([-*+]) (.*)$/.exec(line);
  const ol = /^(\s*)(\d+)([.)]) (.*)$/.exec(line);
  let indent: string, marker: string, content: string;
  if (task) [indent, marker, content] = [task[1], `${task[2]} [ ] `, task[4]];
  else if (ul) [indent, marker, content] = [ul[1], `${ul[2]} `, ul[3]];
  else if (ol) [indent, marker, content] = [ol[1], `${Number(ol[2]) + 1}${ol[3]} `, ol[4]];
  else return null;

  // Empty item → drop the marker, leaving a blank line (exit the list).
  if (content.trim() === '') {
    return { text: text.slice(0, lineStart) + text.slice(lineEnd), start: lineStart, end: lineStart };
  }
  const insert = '\n' + indent + marker;
  return { text: text.slice(0, start) + insert + text.slice(start), start: start + insert.length, end: start + insert.length };
}

const INDENT = '  ';
const LIST_LINE = /^\s*([-*+]|\d+[.)]) /;

/**
 * Tab / Shift-Tab indents or outdents the list lines touched by the selection
 * (by two spaces). Returns null when the block isn't a list, so Tab keeps its
 * default behaviour outside lists.
 */
export function listIndent(s: Sel, outdent: boolean): Sel | null {
  const { text, start, end } = s;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = text.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = text.length;
  const lines = text.slice(lineStart, lineEnd).split('\n');
  if (!lines.some((l) => LIST_LINE.test(l))) return null;

  let firstDelta = 0;
  let totalDelta = 0;
  const out = lines
    .map((l, i) => {
      if (outdent) {
        const removed = l.startsWith(INDENT) ? INDENT.length : l.startsWith('\t') ? 1 : 0;
        if (i === 0) firstDelta = -removed;
        totalDelta -= removed;
        return l.slice(removed);
      }
      if (i === 0) firstDelta = INDENT.length;
      totalDelta += INDENT.length;
      return INDENT + l;
    })
    .join('\n');

  return {
    text: text.slice(0, lineStart) + out + text.slice(lineEnd),
    start: Math.max(lineStart, start + firstDelta),
    end: end + totalDelta,
  };
}

const OPEN_CLOSE: Record<string, string> = { '[': ']', '(': ')', '`': '`' };
const WRAP: Record<string, string> = { '[': ']', '(': ')', '`': '`', '*': '*', '_': '_' };

/**
 * Bracket/quote auto-pairing for a typed character. With a selection it wraps
 * the text (`[`→`[sel]`, `` ` ``→`` `sel` ``, `*`→`*sel*` …). With a collapsed
 * caret it inserts the matching close for `[ ( ` ``, and "types over" an existing
 * close when the caret already sits on it. Returns null to type normally.
 */
export function autoPair(s: Sel, ch: string): Sel | null {
  const { text, start, end } = s;
  if (start !== end && ch in WRAP) {
    const sel = text.slice(start, end);
    return { text: text.slice(0, start) + ch + sel + WRAP[ch] + text.slice(end), start: start + 1, end: end + 1 };
  }
  if (start === end) {
    // Type over the matching close instead of inserting a second one.
    if ((ch === ']' || ch === ')' || ch === '`') && text[start] === ch) {
      return { text, start: start + 1, end: start + 1 };
    }
    if (ch in OPEN_CLOSE) {
      return { text: text.slice(0, start) + ch + OPEN_CLOSE[ch] + text.slice(start), start: start + 1, end: start + 1 };
    }
  }
  return null;
}

const URL_RE = /^(https?:\/\/|mailto:)\S+$/i;

/**
 * Pasting a bare URL over selected text turns it into a Markdown link
 * (`[selection](url)`), caret after the link. Returns null when there's no
 * selection or the clipboard text isn't a single URL, so paste stays default.
 */
export function linkFromPaste(s: Sel, pasted: string): Sel | null {
  const url = pasted.trim();
  if (s.start === s.end || !URL_RE.test(url)) return null;
  const label = s.text.slice(s.start, s.end);
  const caret = s.start + label.length + url.length + 4; // [label](url)
  return {
    text: s.text.slice(0, s.start) + `[${label}](${url})` + s.text.slice(s.end),
    start: caret,
    end: caret,
  };
}


// --- `/` insert and conversions ---------------------------------------------
// notes/spec-slash-insert.md. The menu is a thin popover over these: everything
// stays `Sel → Sel` like the toolbar ops above, so what gets inserted (and what
// a conversion produces) is testable as text, with no editor in the way.

/**
 * Where a `/` menu belongs, given the caret — or null to type a plain `/`.
 * It fires only on a `/` at the start of an otherwise empty line: mid-line a `/`
 * is a path, which is by far the more common thing to type in a document about
 * code. Returns the offset of the `/` and whatever has been typed after it,
 * which is the menu's filter.
 */
export function slashContext(s: Sel): { from: number; query: string } | null {
  if (s.start !== s.end) return null;
  const { text, start } = s;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = text.indexOf('\n', start);
  if (lineEnd === -1) lineEnd = text.length;
  // Nothing but the typed `/query` on the line, and the caret at its end.
  if (text.slice(start, lineEnd).trim() !== '') return null;
  const m = /^\/(\S*)$/.exec(text.slice(lineStart, start));
  return m ? { from: lineStart, query: m[1] } : null;
}

/**
 * Drop the typed `/query` so the chosen action runs on a clean line — the menu
 * confirms by composing this with an existing op (`clearSlash` then `insertTable`).
 */
export function clearSlash(s: Sel, from: number): Sel {
  return { text: s.text.slice(0, from) + s.text.slice(s.end), start: from, end: from };
}

/** The full lines the selection touches, as source offsets. */
function lineSpan(s: Sel): [number, number] {
  const from = s.text.lastIndexOf('\n', s.start - 1) + 1;
  let to = s.text.indexOf('\n', s.end);
  if (to === -1) to = s.text.length;
  return [from, to];
}

/**
 * What a conversion should work on: the selection when there is one, otherwise
 * the run of non-blank lines around the caret. Converting is normally something
 * you do *to the block you are looking at*, and selecting it first is a step
 * that buys nothing.
 *
 * From a blank line it takes the block just above. That is where you are
 * standing after typing a list and pressing Enter — and it is where the `/`
 * menu leaves the caret, which is the only place its conversions can be run from.
 */
function blockSpan(s: Sel): [number, number] {
  let [from, to] = lineSpan(s);
  if (s.start !== s.end) return [from, to];
  const { text } = s;
  if (text.slice(from, to).trim() === '') {
    // Walk back over the blank lines to the end of the previous block.
    let end = from - 1;
    while (end > 0 && text.slice(text.lastIndexOf('\n', end - 1) + 1, end).trim() === '') {
      end = text.lastIndexOf('\n', end - 1);
    }
    if (end <= 0) return [from, to]; // nothing above
    from = to = end;
  }
  while (from > 0) {
    const prev = text.lastIndexOf('\n', from - 2) + 1;
    if (text.slice(prev, from - 1).trim() === '') break;
    from = prev;
  }
  while (to < text.length) {
    let next = text.indexOf('\n', to + 1);
    if (next === -1) next = text.length;
    if (text.slice(to + 1, next).trim() === '') break;
    to = next;
  }
  return [from, to];
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const TASK_MARK = /^\[([ xX])\]\s+/;
/** What splits one item into cells: an em/en dash, or a colon. */
const CELL_SPLIT = /\s+[—–]\s+|[:：]\s+/;
const HEADINGS = ['項目', '内容', '備考'];

const escapeCell = (text: string) => text.replace(/\|/g, '\\|');

/**
 * A bullet or task list becomes a table — the "I jotted it down, now I need
 * columns" move that otherwise sends people to a spreadsheet.
 *
 * Each item is one row, split into cells on ` — ` or `: ` (so `**名前** — 説明`,
 * the shape these notes are already written in, arrives as two columns). A task
 * list gets a 状態 column carrying the checkbox. Nesting is flattened: the depth
 * is dropped rather than guessed at — `- [ ]` → WBS keeps the hierarchy, and
 * that is a different conversion (spec §3).
 *
 * Returns null when the block isn't a list, so the caller can leave the text alone.
 */
export function listToTable(s: Sel): Sel | null {
  const [from, to] = blockSpan(s);
  const lines = s.text.slice(from, to).split('\n');
  const items = lines.map((l) => LIST_ITEM.exec(l));
  if (items.length === 0 || items.some((m) => m === null)) return null;

  const bodies = items.map((m) => m![1]);
  const tasks = bodies.map((b) => TASK_MARK.exec(b));
  const hasTasks = tasks.some((t) => t !== null);

  const rows = bodies.map((body, i) => {
    const t = tasks[i];
    const rest = t ? body.slice(t[0].length) : body;
    const cells = rest.split(CELL_SPLIT).map((c) => escapeCell(c.trim()));
    return hasTasks ? [t && t[1].toLowerCase() === 'x' ? '済' : '', ...cells] : cells;
  });

  const width = Math.max(...rows.map((r) => r.length));
  const header = Array.from({ length: width }, (_, i) => {
    if (hasTasks && i === 0) return '状態';
    const n = hasTasks ? i - 1 : i;
    return HEADINGS[n] ?? `列${n + 1}`;
  });

  const line = (cells: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
  const table = [line(header), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.map(line)].join(
    '\n'
  );

  return { text: s.text.slice(0, from) + table + s.text.slice(to), start: from, end: from + table.length };
}

// ── 選択範囲に効く小さな変換 ────────────────────────────────────────
//
// どれも「その場で・手動で・ローカルに」効く。選択が無いときは行に効く ──
// 何も選ばずに押しても無反応、が一番いらつくため。

/** The span these work on: the selection, or the caret's own line when there is none. */
function scope(s: Sel): [number, number] {
  return s.start !== s.end ? [s.start, s.end] : lineSpan(s);
}

/** Replace `[from,to)` and keep the result selected, so the next press stacks on it. */
function put(s: Sel, from: number, to: number, body: string): Sel {
  return { text: s.text.slice(0, from) + body + s.text.slice(to), start: from, end: from + body.length };
}

/** Break an identifier into its words, whatever style it is written in. */
function words(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

type CaseName = 'camel' | 'snake' | 'kebab' | 'constant' | 'title';
const CASE_CYCLE: CaseName[] = ['camel', 'snake', 'kebab', 'constant', 'title'];

const CASE_WRITE: Record<CaseName, (w: string[]) => string> = {
  camel: (w) => w.map((x, i) => (i === 0 ? x : x[0].toUpperCase() + x.slice(1))).join(''),
  snake: (w) => w.join('_'),
  kebab: (w) => w.join('-'),
  constant: (w) => w.join('_').toUpperCase(),
  title: (w) => w.map((x) => x[0].toUpperCase() + x.slice(1)).join(' '),
};

function caseOf(text: string): CaseName | null {
  if (/^[A-Z0-9]+(_[A-Z0-9]+)*$/.test(text)) return 'constant';
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(text)) return 'snake';
  if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(text)) return 'kebab';
  if (/^[a-z][a-zA-Z0-9]*$/.test(text) && /[A-Z]/.test(text)) return 'camel';
  if (/^[A-Z][a-z0-9]*( [A-Z][a-z0-9]*)+$/.test(text)) return 'title';
  return null;
}

/**
 * Cycle the selection's naming style: camel → snake → kebab → CONSTANT → Title.
 * Nothing is asked, because every stop is one more press away — a menu of five
 * costs more than pressing again. An unrecognised shape starts at camelCase.
 */
export function cycleCase(s: Sel): Sel | null {
  const [from, to] = scope(s);
  const text = s.text.slice(from, to).trim();
  if (!text || /\s{2,}|\n/.test(text)) return null;   // 語ひとつ（か短い句）にだけ効かせる
  const w = words(text);
  if (w.length === 0) return null;
  const now = caseOf(text);
  const next = CASE_CYCLE[(now === null ? -1 : CASE_CYCLE.indexOf(now)) + 1] ?? CASE_CYCLE[0];
  return put(s, from, to, CASE_WRITE[next](w));
}

export type SortMode = 'text' | 'number' | 'length';

/**
 * Sort the selected lines. Three orders rather than one that cycles: a sort
 * throws the previous order away, so pressing again cannot walk back.
 * List markers (`- `, `1. `) stay put; what is compared is the text after them.
 */
export function sortLines(s: Sel, mode: SortMode): Sel | null {
  const [from, to] = scope(s);
  const lines = s.text.slice(from, to).split('\n');
  if (lines.length < 2) return null;
  const key = (l: string) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '');
  const num = (l: string) => {
    const m = /-?\d+(?:\.\d+)?/.exec(key(l));
    return m ? Number(m[0]) : Number.POSITIVE_INFINITY;   // 数の無い行は末尾へ
  };
  const cmp = {
    text: (a: string, b: string) => key(a).localeCompare(key(b), 'ja'),
    number: (a: string, b: string) => num(a) - num(b),
    length: (a: string, b: string) => key(a).length - key(b).length,
  }[mode];
  return put(s, from, to, [...lines].sort(cmp).join('\n'));
}

/** Join the selected lines into one. List markers are dropped; cells are kept. */
export function joinLines(s: Sel, sep = '、'): Sel | null {
  const [from, to] = scope(s);
  const lines = s.text.slice(from, to).split('\n').map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim());
  const kept = lines.filter(Boolean);
  if (kept.length < 2) return null;
  return put(s, from, to, kept.join(sep));
}

/**
 * The reverse: one line back into several. Splits on commas (either width) when
 * there are any, and on whitespace otherwise — the two ways a list gets flattened.
 */
export function splitLines(s: Sel, marker = '- '): Sel | null {
  const [from, to] = scope(s);
  const text = s.text.slice(from, to).trim();
  if (!text || text.includes('\n')) return null;
  const parts = /[,、，]/.test(text) ? text.split(/\s*[,、，]\s*/) : text.split(/\s+/);
  const kept = parts.filter(Boolean);
  if (kept.length < 2) return null;
  return put(s, from, to, kept.map((p) => marker + p).join('\n'));
}

/** Wrap at `width` columns, keeping each paragraph's own indent. */
export function wrapLines(s: Sel, width = 80): Sel | null {
  const [from, to] = scope(s);
  const src = s.text.slice(from, to);
  if (!src.trim()) return null;
  const out = src.split('\n').flatMap((line) => {
    const indent = /^\s*/.exec(line)![0];
    const body = line.slice(indent.length);
    if (indent.length + body.length <= width || !body) return [line];
    const parts: string[] = [];
    let cur = '';
    for (const w of body.split(/\s+/)) {
      if (cur && indent.length + cur.length + 1 + w.length > width) { parts.push(indent + cur); cur = w; }
      else cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) parts.push(indent + cur);
    return parts;
  });
  return put(s, from, to, out.join('\n'));
}

/** Strip the indent every selected line shares, so a pasted block starts at column 1. */
export function dedentLines(s: Sel): Sel | null {
  const [from, to] = scope(s);
  const lines = s.text.slice(from, to).split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].replace(/\t/g, '    ').length);
  if (indents.length === 0) return null;
  const common = Math.min(...indents);
  if (common === 0) return null;
  const out = lines.map((l) => {
    const lead = /^[ \t]*/.exec(l)![0].replace(/\t/g, '    ');
    return lead.slice(common) + l.slice(/^[ \t]*/.exec(l)![0].length);
  });
  return put(s, from, to, out.join('\n'));
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
};

/**
 * Turn `&amp;` and `%20` back into what they stand for — the two ways text
 * arrives mangled from a browser. Percent-decoding is attempted per run, so one
 * bad sequence does not throw the rest away.
 */
export function decodeText(s: Sel): Sel | null {
  const [from, to] = scope(s);
  const src = s.text.slice(from, to);
  if (!src) return null;
  let out = src.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === '#') {
      const n = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[body.toLowerCase()] ?? m;
  });
  out = out.replace(/(?:%[0-9a-fA-F]{2})+/g, (m) => {
    try { return decodeURIComponent(m); } catch { return m; }
  });
  return out === src ? null : put(s, from, to, out);
}

// ── `/wbs`（spec §2 フォームのある部品）───────────────────────────────
//
// **既定値だけで使い物になること**が条件。フォームは Enter だけで抜けられ、
// 何も触らなければ「深さ 2・ID あり・今日から」の骨組みが出る。
// 骨組みであって雛形ではない ── 中身の散文は書かない（テンプレートと同じ線）。

export interface WbsOptions {
  /** 階層の深さ 1〜3。各段に 2 項目ずつ置く。 */
  depth: number;
  /** `1` / `1.1` を振るか。切ると素の箇条書きになる。 */
  ids: boolean;
  /** 開始日（`YYYY-MM-DD`）。表と gantt の起点。null なら日付を入れない。 */
  start: string | null;
  /** 辞書（表）も一緒に作る。列は `tableToGantt` が読める名前で出す。 */
  table: boolean;
  /** mermaid gantt の骨組みも一緒に作る。 */
  gantt: boolean;
}

export const WBS_DEFAULTS: WbsOptions = {
  depth: 2, ids: true, start: null, table: false, gantt: false,
};

/** `1`, `1.1`, `1.2`, `2`, … を深さぶん。各段 2 項目。 */
function wbsIds(depth: number): { id: string; level: number }[] {
  const out: { id: string; level: number }[] = [];
  const walk = (prefix: number[], level: number) => {
    for (let i = 1; i <= 2; i++) {
      const path = [...prefix, i];
      out.push({ id: path.join('.'), level });
      if (level < depth) walk(path, level + 1);
    }
  };
  walk([], 1);
  return out;
}

/**
 * Insert a WBS skeleton at the caret, with the companions the form asked for.
 * The caret lands at the end of the first item, so typing starts the work.
 */
export function insertWbs(s: Sel, o: WbsOptions): Sel {
  const nodes = wbsIds(Math.max(1, Math.min(3, o.depth)));
  const list = nodes.map(
    (n) => `${'  '.repeat(n.level - 1)}- [ ] ${o.ids ? `${n.id} ` : ''}`
  );

  const blocks = [list.join('\n')];

  if (o.table) {
    const head = o.ids ? ['ID', 'タスク', '担当', '開始', '終了'] : ['タスク', '担当', '開始', '終了'];
    const row = (n: { id: string }, first: boolean) => {
      const cells = o.ids ? [n.id, '', '', first ? (o.start ?? '') : '', ''] : ['', '', first ? (o.start ?? '') : '', ''];
      return `| ${cells.join(' | ')} |`;
    };
    blocks.push(
      [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`,
       ...nodes.map((n, i) => row(n, i === 0))].join('\n')
    );
  }

  if (o.gantt) {
    const tops = nodes.filter((n) => n.level === 1);
    blocks.push(
      ['```mermaid', 'gantt', '    dateFormat YYYY-MM-DD',
       ...tops.flatMap((n) => [
         `    section ${o.ids ? n.id : 'section'}`,
         `    task :${o.start ?? '2026-01-01'}, 3d`,
       ]),
       '```'].join('\n')
    );
  }

  const body = blocks.join('\n\n');
  const [from, to] = lineSpan(s);
  const blank = s.text.slice(from, to).trim() === '';
  const head = s.text.slice(0, blank ? from : to);
  const lead = blank ? '' : '\n';
  const text = head + lead + body + s.text.slice(blank ? to : to);
  // End of the first item — where the typing starts.
  const caret = head.length + lead.length + list[0].length;
  return { text, start: caret, end: caret };
}

// ── 表の列を編集する（spec §3「列の追加/削除・整列」）───────────────────
//
// 三つとも引数を取らない。**どの列かはカーソルが決める**ので、ポップオーバーが
// 要らない（引数が要る部品だけポップオーバー、という線を跨がない）。整列は開くたび
// 選ばせるのではなく押すたび回す ── 押し直せるものは、訊くより回すほうが速い。

/** The delimiter cell for an alignment, as GFM writes it. */
const DELIM: Record<string, string> = {
  null: '---',
  left: ':---',
  center: ':---:',
  right: '---:',
};

/** Rebuild a table block from its parts. Widths are not padded: the preview does that. */
function renderTable(header: string[], align: Align[], rows: string[][]): string {
  const n = header.length;
  const line = (cells: string[]) =>
    `| ${Array.from({ length: n }, (_, i) => cells[i] ?? '').join(' | ')} |`;
  const delim = `| ${Array.from({ length: n }, (_, i) => DELIM[String(align[i] ?? null)]).join(' | ')} |`;
  return [line(header), delim, ...rows.map(line)].join('\n');
}

/**
 * Which column the caret is in, by counting the pipes to its left on its own
 * line. Counting beats looking the cell up: it also answers on the `---` row and
 * in the padding between cells, where there is no cell to be inside of.
 */
function caretColumn(text: string, pos: number): number {
  const lineStart = text.lastIndexOf('\n', Math.max(0, pos - 1)) + 1;
  const lead = /^\s*\|/.test(text.slice(lineStart)) ? 1 : 0;
  const pipes = (text.slice(lineStart, pos).match(/(?<!\\)\|/g) ?? []).length;
  return Math.max(0, pipes - lead);
}

/** The table the caret sits in, plus that column — or null when it sits in none. */
function tableAt(s: Sel): { table: TableBlock; col: number } | null {
  const [from, to] = blockSpan(s);
  const table = findTables(s.text).find((t) => t.from <= to && t.to >= from);
  if (!table) return null;
  const n = table.header.length;
  return { table, col: Math.min(caretColumn(s.text, s.start), n - 1) };
}

/** Replace the table block and leave the caret in the same column's header cell. */
function putTable(s: Sel, table: TableBlock, text: string, col: number): Sel {
  const head = text.split('\n')[0];
  let seen = 0;
  let caret = table.from;
  for (let i = 0; i < head.length; i++) {
    if (head[i] !== '|') continue;
    seen += 1;
    if (seen === col + 1) { caret = table.from + i + 2; break; }
  }
  return { text: s.text.slice(0, table.from) + text + s.text.slice(table.to), start: caret, end: caret };
}

/** Add an empty column after the caret's own. */
export function addTableColumn(s: Sel): Sel | null {
  const found = tableAt(s);
  if (!found) return null;
  const { table, col } = found;
  const at = col + 1;
  const ins = <T,>(arr: T[], v: T) => [...arr.slice(0, at), v, ...arr.slice(at)];
  const text = renderTable(
    ins(table.header.map((c) => c.text), ''),
    ins(table.align, null),
    table.rows.map((r) => ins(r.map((c) => c.text), ''))
  );
  return putTable(s, table, text, at);
}

/**
 * Delete the caret's column. Refuses on a one-column table — a table with no
 * columns is not a table, and there is no undo inside a pure transform.
 */
export function deleteTableColumn(s: Sel): Sel | null {
  const found = tableAt(s);
  if (!found) return null;
  const { table, col } = found;
  if (table.header.length <= 1) return null;
  const del = <T,>(arr: T[]) => arr.filter((_, i) => i !== col);
  const text = renderTable(
    del(table.header.map((c) => c.text)),
    del(table.align),
    table.rows.map((r) => del(r.map((c) => c.text)))
  );
  return putTable(s, table, text, Math.min(col, table.header.length - 2));
}

const ALIGN_CYCLE: Align[] = [null, 'left', 'center', 'right'];

/** Cycle the caret column's alignment: none → left → center → right → none. */
export function cycleTableAlign(s: Sel): Sel | null {
  const found = tableAt(s);
  if (!found) return null;
  const { table, col } = found;
  const align = [...table.align];
  const now = ALIGN_CYCLE.indexOf(align[col] ?? null);
  align[col] = ALIGN_CYCLE[(now + 1) % ALIGN_CYCLE.length];
  const text = renderTable(
    table.header.map((c) => c.text),
    align,
    table.rows.map((r) => r.map((c) => c.text))
  );
  return putTable(s, table, text, col);
}

/**
 * An ID already sitting at the head of an item (`1.`, `1.2`, `2.3.1)`). Stripped
 * before renumbering, so running the conversion twice renumbers instead of
 * stacking `1. 1. 1.` — that is what "ID の振り直し" means (spec §3).
 */
const WBS_ID = /^\d+(?:\.\d+)*[.)]?\s+/;

/**
 * A list block → a WBS: the same lines, renumbered `1`, `1.1`, `1.2`, `2`, …
 *
 * The counterpart of `listToTable`, which flattens. **This one keeps the
 * hierarchy** — the nesting is the work breakdown, so it is the whole point
 * here — and reads the depth from the indent rather than guessing.
 * Checkboxes are carried through unchanged: renumbering is not a state change.
 *
 * Re-running it is safe and is the normal way to use it: delete an item, run it
 * again, and the gaps close (spec §3 "番号詰め直し"). The bullet marker is
 * normalised to `-`, because `1. 1.1 …` reads as two competing numbers.
 *
 * Returns null when the block isn't a list, so the caller can leave the text alone.
 */
export function taskListToWbs(s: Sel): Sel | null {
  const [from, to] = blockSpan(s);
  const lines = s.text.slice(from, to).split('\n');
  const items = lines.map((l) => LIST_ITEM.exec(l));
  if (items.length === 0 || items.some((m) => m === null)) return null;

  // One counter per depth. `widths` holds the indent that opened each depth, so
  // an outdent pops back to the level it belongs to rather than to the parent.
  const counters: number[] = [];
  const widths: number[] = [];

  const out = lines.map((line, i) => {
    const indent = /^[ \t]*/.exec(line)![0];
    const width = indent.replace(/\t/g, '    ').length;
    while (widths.length > 0 && width < widths[widths.length - 1]) {
      widths.pop();
      counters.pop();
    }
    if (widths.length === 0 || width > widths[widths.length - 1]) {
      widths.push(width);
      counters.push(0);
    }
    counters[counters.length - 1] += 1;

    const body = items[i]![1];
    const task = TASK_MARK.exec(body);
    const rest = (task ? body.slice(task[0].length) : body).replace(WBS_ID, '');
    return `${indent}- ${task ? `[${task[1]}] ` : ''}${counters.join('.')} ${rest}`;
  });

  const wbs = out.join('\n');
  return { text: s.text.slice(0, from) + wbs + s.text.slice(to), start: from, end: from + wbs.length };
}

// Which column is which, by what the header says. Both languages, because these
// documents are written in both.
const COL = {
  start: /開始|着手|start|from/i,
  end: /終了|完了予定|期限|締切|end|due|finish/i,
  duration: /期間|日数|duration|length/i,
  section: /セクション|section|分類|フェーズ|phase|区分|カテゴリ/i,
  status: /状態|ステータス|status|進捗/i,
};
const DATE = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/;
const DURATION = /^(\d+)\s*(d|day|days|日|w|week|weeks|週|週間|h|hour|hours|時間)?$/i;

function isoDate(cell: string): string | null {
  const m = DATE.exec(cell);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
}

/** `3` / `3日` / `2週` → what mermaid's gantt understands (`3d`, `2w`). */
function duration(cell: string): string | null {
  const m = DURATION.exec(cell.trim());
  if (!m) return null;
  const unit = (m[2] ?? 'd').toLowerCase();
  if (/^(w|week|weeks|週|週間)$/.test(unit)) return `${m[1]}w`;
  if (/^(h|hour|hours|時間)$/.test(unit)) return `${m[1]}h`;
  return `${m[1]}d`;
}

function findCol(header: string[], re: RegExp): number {
  return header.findIndex((h) => re.test(h));
}

/** 完了 → `done`, 進行中 → `active`. Anything else carries no tag. */
function ganttTag(cell: string): string {
  if (/完了|済|done|closed/i.test(cell)) return 'done';
  if (/進行|着手|作業中|doing|wip|active|in progress/i.test(cell)) return 'active';
  return '';
}

/**
 * A table becomes a mermaid gantt block. Columns are found by what the header
 * says (開始 / 期限 / 期間 / 状態 / セクション, and the English equivalents), so
 * the table can stay the shape a person wants to read.
 *
 * **The table is kept.** The gantt is written *after* it, and re-running the
 * conversion replaces that block rather than adding another — the table stays
 * the thing you edit, and the chart is a rendering of it (spec §4: no round-trip
 * write-back, so the diff stays readable).
 *
 * Returns null when the caret isn't in a table, or the table has no dates to
 * put on an axis.
 */
export function tableToGantt(s: Sel): Sel | null {
  const [from, to] = blockSpan(s);
  const table = findTables(s.text).find((t) => t.from <= to && t.to >= from);
  if (!table) return null;

  const header = table.header.map((c) => c.text);
  const cols = {
    start: findCol(header, COL.start),
    end: findCol(header, COL.end),
    duration: findCol(header, COL.duration),
    section: findCol(header, COL.section),
    status: findCol(header, COL.status),
  };
  const taken = new Set(Object.values(cols).filter((i) => i >= 0));

  // No 開始 column named as such: take the first column whose cells hold dates.
  if (cols.start === -1) {
    cols.start = header.findIndex(
      (_, i) => !taken.has(i) && table.rows.some((r) => r[i] && isoDate(r[i].text))
    );
    if (cols.start >= 0) taken.add(cols.start);
  }
  if (cols.start === -1) return null; // nothing to put on a time axis

  const nameCol = header.findIndex((_, i) => !taken.has(i));
  if (nameCol === -1) return null;

  const body: string[] = [];
  let section: string | null = null;
  for (const row of table.rows) {
    const cell = (i: number) => (i >= 0 ? (row[i]?.text ?? '') : '');
    const start = isoDate(cell(cols.start));
    if (!start) continue; // a row without a date has nothing to draw

    if (cols.section >= 0 && cell(cols.section) !== section) {
      section = cell(cols.section);
      body.push(`    section ${section}`);
    }
    // `:` separates a gantt task's name from its fields, so it can't stay in one.
    const name = cell(nameCol).replace(/:/g, '：').trim() || '(無題)';
    const span = isoDate(cell(cols.end)) ?? duration(cell(cols.duration)) ?? '1d';
    const tag = ganttTag(cell(cols.status));
    body.push(`    ${name} :${tag ? `${tag}, ` : ''}${start}, ${span}`);
  }
  if (body.length === 0) return null;

  const block = ['```mermaid', 'gantt', '    dateFormat YYYY-MM-DD', ...body, '```'].join('\n');

  // Re-running the conversion overwrites the gantt this table already has,
  // instead of stacking a second one under it.
  const after = s.text.slice(table.to);
  const existing = /^\n(\s*\n)*```mermaid\n\s*gantt\b[\s\S]*?\n```/.exec(after);
  const gap = existing ? existing[0].slice(0, existing[0].indexOf('```')) : '\n\n';
  const at = table.to + gap.length;
  const until = existing ? table.to + existing[0].length : table.to;

  return {
    text: s.text.slice(0, table.to) + gap + block + s.text.slice(until),
    start: at,
    end: at + block.length,
  };
}
