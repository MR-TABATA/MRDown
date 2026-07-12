// The diff engine behind every "what changed?" view: Local History (two saved
// versions), Git diff (HEAD vs the working tree), and later the reload flash.
// Pure and dependency-free — this is the core of what MRDown is for, so it isn't
// farmed out to a library, and it stays trivially testable.

export type OpType = 'eq' | 'del' | 'ins';
export interface Op<T> {
  type: OpType;
  value: T;
}

/**
 * Cap on the number of differences Myers will chase. Beyond this the two texts
 * have little in common and a minimal diff is neither achievable in reasonable
 * memory nor useful to read, so we fall back to "the middle was replaced".
 */
const MAX_EDITS = 2000;

/**
 * Myers' O(ND) diff. `k` only ever ranges over [-d, d], so the frontier array is
 * sized by the edit cap rather than by the input length — sizing it by input
 * (the textbook `2 * (n + m) + 1`) makes the recorded trace cost hundreds of
 * megabytes on a large file, which is exactly when a diff must not fall over.
 */
function myers<T>(a: T[], b: T[]): Op<T>[] | null {
  const n = a.length;
  const m = b.length;
  const limit = Math.min(n + m, MAX_EDITS);
  const off = limit + 1;
  const size = 2 * limit + 3;

  const v = new Int32Array(size);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= limit; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      // Step down (from k+1) when we must, otherwise right (from k-1).
      let x: number;
      if (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) x = v[off + k + 1];
      else x = v[off + k - 1] + 1;
      let y = x - k;
      // Follow the diagonal for as long as the two sides agree.
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) return backtrack(a, b, trace, d, off);
    }
  }
  return null; // over the edit cap
}

/** Walk the recorded frontiers backwards to turn the edit script into ops. */
function backtrack<T>(a: T[], b: T[], trace: Int32Array[], d: number, off: number): Op<T>[] {
  const ops: Op<T>[] = [];
  let x = a.length;
  let y = b.length;

  for (let depth = d; depth > 0; depth--) {
    const v = trace[depth];
    const k = x - y;
    const prevK = k === -depth || (k !== depth && v[off + k - 1] < v[off + k + 1]) ? k + 1 : k - 1;
    const prevX = v[off + prevK];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      ops.push({ type: 'eq', value: a[--x] });
      y--;
    }
    if (x > prevX) ops.push({ type: 'del', value: a[--x] });
    else if (y > prevY) ops.push({ type: 'ins', value: b[--y] });
  }
  while (x > 0 && y > 0) {
    ops.push({ type: 'eq', value: a[--x] });
    y--;
  }
  while (x > 0) ops.push({ type: 'del', value: a[--x] });
  while (y > 0) ops.push({ type: 'ins', value: b[--y] });

  return ops.reverse();
}

/**
 * Diff two sequences. Identical heads and tails are matched off first: they are
 * the common case (an edit in the middle of a document) and they keep Myers away
 * from the parts that never changed.
 */
export function diff<T>(a: T[], b: T[]): Op<T>[] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;

  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }

  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);

  const middle =
    myers(midA, midB) ??
    // Over the edit cap: say the middle was replaced wholesale. Honest, and it
    // still renders — better than refusing to show a diff at all.
    ([
      ...midA.map((value): Op<T> => ({ type: 'del', value })),
      ...midB.map((value): Op<T> => ({ type: 'ins', value })),
    ] as Op<T>[]);

  return [
    ...a.slice(0, head).map((value): Op<T> => ({ type: 'eq', value })),
    ...middle,
    ...a.slice(a.length - tail).map((value): Op<T> => ({ type: 'eq', value })),
  ];
}

// ── Line diff, aligned for a side-by-side view ───────────────────────────────

export type RowType = 'eq' | 'del' | 'ins' | 'mod';

export interface DiffRow {
  type: RowType;
  /** Old text, or null where the row exists only on the new side. */
  left: string | null;
  right: string | null;
  /** 1-based line numbers, null on the side where the row doesn't exist. */
  leftNo: number | null;
  rightNo: number | null;
}

function splitLines(text: string): string[] {
  // An empty document has no lines. `''.split('\n')` says otherwise (`['']`),
  // which would pair the void against the first line of a new file as a
  // rewrite rather than as an insertion.
  if (text === '') return [];
  // A trailing newline shouldn't show up as a phantom empty last line either.
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Align two texts into rows for a side-by-side view. A run of deletions sitting
 * against a run of insertions is paired up into `mod` rows — that's what makes a
 * rewritten paragraph read as "this became that" instead of as an unrelated
 * removal followed by an unrelated addition.
 */
export function sideBySide(oldText: string, newText: string): DiffRow[] {
  const ops = diff(splitLines(oldText), splitLines(newText));
  const rows: DiffRow[] = [];
  let leftNo = 0;
  let rightNo = 0;

  for (let i = 0; i < ops.length; ) {
    const op = ops[i];
    if (op.type === 'eq') {
      rows.push({
        type: 'eq',
        left: op.value,
        right: op.value,
        leftNo: ++leftNo,
        rightNo: ++rightNo,
      });
      i++;
      continue;
    }

    // Gather the whole run of deletions, then the insertions that follow it.
    const dels: string[] = [];
    while (i < ops.length && ops[i].type === 'del') dels.push(ops[i++].value);
    const inses: string[] = [];
    while (i < ops.length && ops[i].type === 'ins') inses.push(ops[i++].value);

    const paired = Math.min(dels.length, inses.length);
    for (let j = 0; j < paired; j++) {
      rows.push({
        type: 'mod',
        left: dels[j],
        right: inses[j],
        leftNo: ++leftNo,
        rightNo: ++rightNo,
      });
    }
    for (let j = paired; j < dels.length; j++) {
      rows.push({ type: 'del', left: dels[j], right: null, leftNo: ++leftNo, rightNo: null });
    }
    for (let j = paired; j < inses.length; j++) {
      rows.push({ type: 'ins', left: null, right: inses[j], leftNo: null, rightNo: ++rightNo });
    }
  }

  return rows;
}

// ── Intra-line diff, so a one-word change doesn't light up the whole line ─────

export interface Seg {
  text: string;
  changed: boolean;
}

/**
 * Split for word-level comparison. Latin words stay whole, runs of whitespace
 * stay whole, and everything else — CJK above all, which has no spaces to split
 * on — is compared character by character.
 */
function tokenize(line: string): string[] {
  return line.match(/[A-Za-z0-9_]+|\s+|[\s\S]/g) ?? [];
}

/** The two sides of one `mod` row, marked up with what actually differs. */
export function inlineSegments(oldLine: string, newLine: string): { left: Seg[]; right: Seg[] } {
  const ops = diff(tokenize(oldLine), tokenize(newLine));
  const left: Seg[] = [];
  const right: Seg[] = [];

  // Merge neighbouring tokens of the same kind so the DOM gets a handful of
  // spans per line rather than one per character.
  const push = (segs: Seg[], text: string, changed: boolean) => {
    const last = segs[segs.length - 1];
    if (last && last.changed === changed) last.text += text;
    else segs.push({ text, changed });
  };

  for (const op of ops) {
    if (op.type === 'eq') {
      push(left, op.value, false);
      push(right, op.value, false);
    } else if (op.type === 'del') {
      push(left, op.value, true);
    } else {
      push(right, op.value, true);
    }
  }

  return { left, right };
}

// ── Three-way ────────────────────────────────────────────────────────────────
// When something rewrites the file on disk while you have unsaved edits — an AI
// agent, most often, which is the case MRDown exists for — there is no single
// "before". There are three texts: the version you both started from (the last
// save), what the file says now (theirs), and what your buffer says (ours). Same
// shape as a Git merge, and the same question: who touched what, and where do
// they collide?

export interface ThreeRow {
  base: string | null;
  theirs: string | null;
  ours: string | null;
  baseNo: number | null;
  theirsNo: number | null;
  oursNo: number | null;
  /** The line differs from base on that side. */
  theirsChanged: boolean;
  oursChanged: boolean;
  /** Both sides changed this line, and not into the same thing. */
  conflict: boolean;
}

/** One side projected back onto the base's line numbering. */
interface Side {
  /** `map[i]` is what base line `i` became, or null if that side deleted it. */
  map: (string | null)[];
  /** `no[i]` is that side's line number for base line `i`. */
  no: (number | null)[];
  /** `ins[i]` are the lines that side added *before* base line `i`. */
  ins: string[][];
  /** Line numbers for the above. */
  insNo: number[][];
}

function project(base: string[], other: string[]): Side {
  const side: Side = {
    map: new Array(base.length).fill(null),
    no: new Array(base.length).fill(null),
    ins: Array.from({ length: base.length + 1 }, () => [] as string[]),
    insNo: Array.from({ length: base.length + 1 }, () => [] as number[]),
  };

  const ops = diff(base, other);
  let bi = 0;
  let oi = 0;

  for (let k = 0; k < ops.length; ) {
    if (ops[k].type === 'eq') {
      side.map[bi] = other[oi];
      side.no[bi] = oi + 1;
      bi++;
      oi++;
      k++;
      continue;
    }

    // A rewritten line comes out of the line diff as a deletion plus an
    // insertion. Left as-is, one edited line would occupy two rows — a phantom
    // "they deleted this" next to a phantom "they added that" — and every count
    // built on it would be doubled. So pair the run up: the nth deleted base
    // line became the nth inserted line.
    const dels: string[] = [];
    const inss: string[] = [];
    while (k < ops.length && ops[k].type !== 'eq') {
      (ops[k].type === 'del' ? dels : inss).push(ops[k].value);
      k++;
    }

    const from = oi;
    const paired = Math.min(dels.length, inss.length);
    for (let j = 0; j < paired; j++) {
      side.map[bi + j] = inss[j];
      side.no[bi + j] = from + j + 1;
    }
    // Base lines with no counterpart: this side deleted them (map stays null).
    // Surplus insertions belong after the region, not inside it.
    const at = bi + dels.length;
    for (let j = paired; j < inss.length; j++) {
      side.ins[at].push(inss[j]);
      side.insNo[at].push(from + j + 1);
    }

    bi += dels.length;
    oi += inss.length;
  }

  return side;
}

/**
 * Line up three texts against their common base. A base line that only one side
 * touched is that side's change; a line both sides rewrote differently is a
 * conflict, and that's the only kind of row a human actually has to resolve.
 */
export function threeWay(baseText: string, theirsText: string, oursText: string): ThreeRow[] {
  const base = splitLines(baseText);
  const theirs = project(base, splitLines(theirsText));
  const ours = project(base, splitLines(oursText));
  const rows: ThreeRow[] = [];

  const addInsertions = (at: number) => {
    const n = Math.max(theirs.ins[at].length, ours.ins[at].length);
    for (let j = 0; j < n; j++) {
      const t = theirs.ins[at][j] ?? null;
      const o = ours.ins[at][j] ?? null;
      rows.push({
        base: null,
        theirs: t,
        ours: o,
        baseNo: null,
        theirsNo: theirs.insNo[at][j] ?? null,
        oursNo: ours.insNo[at][j] ?? null,
        theirsChanged: t !== null,
        oursChanged: o !== null,
        // Both sides inserted something here, and not the same thing.
        conflict: t !== null && o !== null && t !== o,
      });
    }
  };

  for (let i = 0; i < base.length; i++) {
    addInsertions(i);
    const t = theirs.map[i];
    const o = ours.map[i];
    const theirsChanged = t !== base[i];
    const oursChanged = o !== base[i];
    rows.push({
      base: base[i],
      theirs: t,
      ours: o,
      baseNo: i + 1,
      theirsNo: theirs.no[i],
      oursNo: ours.no[i],
      theirsChanged,
      oursChanged,
      conflict: theirsChanged && oursChanged && t !== o,
    });
  }
  addInsertions(base.length);

  return rows;
}

export function threeWayStats(rows: ThreeRow[]): {
  theirs: number;
  ours: number;
  conflicts: number;
} {
  let theirs = 0;
  let ours = 0;
  let conflicts = 0;
  for (const row of rows) {
    if (row.conflict) conflicts++;
    if (row.theirsChanged) theirs++;
    if (row.oursChanged) ours++;
  }
  return { theirs, ours, conflicts };
}

// ── Context folding ──────────────────────────────────────────────────────────

/** A run of unchanged lines that was folded away. */
export interface Gap {
  type: 'gap';
  count: number;
}

/** `ThreeRow` carries no tag of its own, so the union needs a guard. */
export function isGap(row: object): row is Gap {
  return (row as Gap).type === 'gap';
}

export type DiffLine = DiffRow | Gap;
export type ThreeLine = ThreeRow | Gap;

/**
 * Keep `context` rows either side of every changed one and fold the rest into a
 * gap. Two edits in a two-thousand-line document should not make the reader
 * scroll past two thousand identical lines to find them — and it keeps the DOM
 * proportional to what changed rather than to the file.
 */
export function foldRows<T>(rows: T[], changed: (row: T) => boolean, context = 3): (T | Gap)[] {
  const keep = new Array<boolean>(rows.length).fill(false);
  for (let i = 0; i < rows.length; i++) {
    if (!changed(rows[i])) continue;
    for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) {
      keep[j] = true;
    }
  }

  const out: (T | Gap)[] = [];
  for (let i = 0; i < rows.length; ) {
    if (keep[i]) {
      out.push(rows[i++]);
      continue;
    }
    let run = 0;
    while (i < rows.length && !keep[i]) {
      run++;
      i++;
    }
    // A gap has to earn its keep: folding one line away saves nothing and costs
    // the reader a line of chrome.
    if (run > 1) out.push({ type: 'gap', count: run });
    else out.push(rows[i - 1]);
  }
  return out;
}

export function foldUnchanged(rows: DiffRow[], context = 3): DiffLine[] {
  return foldRows(rows, (r) => r.type !== 'eq', context);
}

export function foldThreeWay(rows: ThreeRow[], context = 3): ThreeLine[] {
  return foldRows(rows, (r) => r.theirsChanged || r.oursChanged, context);
}

/** Changed-line counts for the summary line ("+12 −3"). */
export function diffStats(rows: DiffRow[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.type === 'ins') added++;
    else if (row.type === 'del') removed++;
    else if (row.type === 'mod') {
      added++;
      removed++;
    }
  }
  return { added, removed };
}
