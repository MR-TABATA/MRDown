// Pure text-selection transforms for the editor toolbar — no DOM or Tauri
// dependencies, so the markdown-formatting logic is unit-testable. Each takes
// and returns a `Sel` (the textarea value plus selection range) so the caller
// only has to push the result back into the element.

import { findTables } from './table';

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
