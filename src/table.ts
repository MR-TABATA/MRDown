// Pure GFM-table parsing for the live-preview editor — no DOM, no CodeMirror.
//
// The editor needs more than "is this a table": to draw one with ruled borders
// and still let you click into a cell to edit it, every cell has to carry the
// source offsets it came from. So this returns the block's own range plus a
// `from`/`to` for each cell's text, and editor-surface.ts turns that into DOM.

export type Align = 'left' | 'center' | 'right' | null;

/** One cell's trimmed text and where it sits in the source. */
export interface Cell {
  text: string;
  from: number;
  to: number;
}

export interface TableBlock {
  /** Start of the header row / end of the last body row, in source offsets. */
  from: number;
  to: number;
  align: Align[];
  header: Cell[];
  rows: Cell[][];
}

const FENCE = /^ {0,3}(```|~~~)/;
/** Blocks that end a table even without a blank line between them. */
const OTHER_BLOCK = /^ {0,3}(#{1,6}(\s|$)|>|(?:[-*_] *){3,}$)/;
const DELIM_CELL = /^:?-+:?$/;

/**
 * Split one table row into cells, in source offsets. Leading and trailing pipes
 * are optional (GFM), and a `\|` is content rather than a separator.
 */
export function splitRow(line: string, base: number): Cell[] {
  const cells: Cell[] = [];
  let start = 0;
  let escaped = false;
  const push = (from: number, to: number) => {
    const raw = line.slice(from, to);
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    cells.push({ text, from: base + from + lead, to: base + from + lead + text.length });
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === '\\') {
      escaped = true;
      continue;
    }
    if (c === '|') {
      push(start, i);
      start = i + 1;
    }
  }
  push(start, line.length);
  // A row written `| a | b |` opens and closes with a pipe, which yields an
  // empty cell at each end that was never a column.
  if (cells.length > 1 && cells[0].text === '') cells.shift();
  if (cells.length > 1 && cells[cells.length - 1].text === '') cells.pop();
  return cells;
}

/** Is `line` the `| --- | :--: |` row, with `columns` columns? */
function delimiterAlign(line: string, columns: number): Align[] | null {
  if (!line.includes('-') || !/^[\s|:-]+$/.test(line)) return null;
  const cells = splitRow(line, 0);
  if (cells.length !== columns) return null;
  const align: Align[] = [];
  for (const c of cells) {
    if (!DELIM_CELL.test(c.text)) return null;
    const left = c.text.startsWith(':');
    const right = c.text.endsWith(':');
    align.push(left && right ? 'center' : right ? 'right' : left ? 'left' : null);
  }
  return align;
}

/** Does this line still belong to the table body? */
function isBodyRow(line: string): boolean {
  return (
    /\S/.test(line) &&
    !FENCE.test(line) &&
    !OTHER_BLOCK.test(line) &&
    !/^ {4,}\S/.test(line) &&
    /(^|[^\\])\|/.test(line)
  );
}

/**
 * Every GFM table in `source`, in document order. A table is a header row, a
 * matching delimiter row, and the rows after it up to a blank line or the start
 * of another block; fenced code is skipped, so a `|---|` inside a code sample
 * can't grow a table around itself.
 */
export function findTables(source: string): TableBlock[] {
  const lines = source.split('\n');
  // Offset of the start of each line.
  const at: number[] = [];
  let pos = 0;
  for (const l of lines) {
    at.push(pos);
    pos += l.length + 1;
  }

  const tables: TableBlock[] = [];
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i])) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const head = lines[i];
    if (i + 1 >= lines.length || !isBodyRow(head) || /^ {4,}\S/.test(head)) continue;
    const header = splitRow(head, at[i]);
    const align = delimiterAlign(lines[i + 1], header.length);
    if (!align) continue;

    const rows: Cell[][] = [];
    let last = i + 1;
    for (let j = i + 2; j < lines.length && isBodyRow(lines[j]); j++) {
      rows.push(splitRow(lines[j], at[j]));
      last = j;
    }
    tables.push({ from: at[i], to: at[last] + lines[last].length, align, header, rows });
    i = last;
  }
  return tables;
}

// --- Inline formatting inside a cell ---------------------------------------
// A cell is not plain text: `**done**` in a table should read as bold there too.
// The document's real renderer (marked) is not reachable from the editor without
// dragging HTML sanitising in with it, so cells get this small tokenizer and are
// built as DOM nodes — nothing is ever parsed as HTML.

export type SegmentStyle = 'plain' | 'strong' | 'em' | 'code' | 'del' | 'link' | 'image';

export interface Segment {
  /** The text to show — for an image, its alt text. */
  text: string;
  style: SegmentStyle;
  /** Only for `image`: the path the source pointed at. */
  src?: string;
}

/** Unescape what a table cell escapes: `\|` is a literal pipe, not a column. */
const unescape = (s: string) => s.replace(/\\([|\\`*_~[\]])/g, '$1');

/** Is `c` a character an underscore can't be emphasis next to? */
const wordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

/**
 * The first construct at the head of `s`, if it starts with one. `prev` is the
 * character before it, because `_` in the middle of a word (`col_a_name`) is a
 * literal underscore, not emphasis.
 */
function matchInline(s: string, prev: string | undefined): { seg: Segment; length: number } | null {
  let m: RegExpExecArray | null;
  if ((m = /^!\[([^\]]*)\]\(\s*([^)\s]*)[^)]*\)/.exec(s)))
    return { seg: { text: m[1], style: 'image', src: m[2] }, length: m[0].length };
  if ((m = /^\[([^\]]*)\]\([^)]*\)/.exec(s)))
    return { seg: { text: unescape(m[1]), style: 'link' }, length: m[0].length };
  // Code spans keep their text verbatim — a backslash in there is content.
  if ((m = /^(`+)([\s\S]+?)\1/.exec(s))) return { seg: { text: m[2], style: 'code' }, length: m[0].length };
  const intraword = wordChar(prev);
  if ((m = /^\*\*([\s\S]+?)\*\*/.exec(s)) || (!intraword && (m = /^__([\s\S]+?)__(?![\p{L}\p{N}])/u.exec(s))))
    return { seg: { text: unescape(m[1]), style: 'strong' }, length: m[0].length };
  if ((m = /^~~([\s\S]+?)~~/.exec(s)))
    return { seg: { text: unescape(m[1]), style: 'del' }, length: m[0].length };
  if ((m = /^\*([^*]+?)\*/.exec(s)) || (!intraword && (m = /^_([^_]+?)_(?![\p{L}\p{N}])/u.exec(s))))
    return { seg: { text: unescape(m[1]), style: 'em' }, length: m[0].length };
  return null;
}

/** A cell's text as styled runs, in order. */
export function inlineSegments(text: string): Segment[] {
  const out: Segment[] = [];
  let plain = '';
  const flush = () => {
    if (plain) out.push({ text: unescape(plain), style: 'plain' });
    plain = '';
  };
  for (let i = 0; i < text.length; ) {
    // An escaped character is content, and can't open a construct.
    if (text[i] === '\\' && i + 1 < text.length) {
      plain += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    const m = matchInline(text.slice(i), text[i - 1]);
    if (!m) {
      plain += text[i];
      i += 1;
      continue;
    }
    flush();
    out.push(m.seg);
    i += m.length;
  }
  flush();
  return out;
}
