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

// ── Context folding ──────────────────────────────────────────────────────────

/** A run of unchanged lines that was folded away. */
export interface Gap {
  type: 'gap';
  count: number;
}

export type DiffLine = DiffRow | Gap;

/**
 * Keep `context` unchanged lines either side of every change and fold the rest
 * into a gap. Two edits in a two-thousand-line document should not make the
 * reader scroll past two thousand identical lines to find them — and it keeps
 * the DOM proportional to what changed rather than to the file.
 */
export function foldUnchanged(rows: DiffRow[], context = 3): DiffLine[] {
  const keep = new Array<boolean>(rows.length).fill(false);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].type === 'eq') continue;
    for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) {
      keep[j] = true;
    }
  }

  const out: DiffLine[] = [];
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
