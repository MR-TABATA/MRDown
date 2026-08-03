// The editing surface: CodeMirror 6, wrapped in the small API the rest of the
// app already spoke to a <textarea> with (`value`, `selectionStart`, `focus()`,
// `scrollTop`). Keeping that shape means the swap-layout position carry, the
// format bar and the find bar go on working against source offsets — the thing
// that made the textarea worth keeping in the first place — while the text can
// finally be *styled* as you write it (headings big, markup dimmed), which a
// textarea can never do.
//
// Two pieces of machinery the textarea needed are gone as a result: the hidden
// mirror that drew find highlights under the text, and the execCommand dance
// that kept edits on the WebView's native undo stack. CodeMirror does both.
import {
  EditorView,
  keymap,
  Decoration,
  type DecorationSet,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
  drawSelection,
  highlightActiveLine,
} from '@codemirror/view';
import { EditorState, StateEffect, StateField, Prec, type Extension } from '@codemirror/state';
import { history, historyKeymap, undo, redo } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { findTables, inlineSegments, type TableBlock, type Cell } from './table';

/** A find match, in source offsets — the same shape find.ts produces. */
export interface Hit {
  start: number;
  end: number;
}

// --- Live preview decorations ---------------------------------------------
// The source stays plain text; only its *appearance* changes. Markup on the
// line the caret is on is left alone, so the moment you go to edit a heading
// its `##` is right there — no mode to leave, nothing to reveal.

// Off the caret's line, markup is *hidden* rather than dimmed — that is the
// difference between "styled source" and something you can read as a document.
// `Decoration.replace` removes it from the layout; the text is still in the
// buffer, so the file on disk and every offset-based feature are untouched.
const hideMark = Decoration.replace({});
const dimMark = Decoration.mark({ class: 'cm-md-marker' });
/** Markup that still reads better left in place: list bullets and quote bars
 *  carry the shape of the block they mark. */
const KEEP_DIM = new Set(['ListMark', 'QuoteMark']);
const strongMark = Decoration.mark({ class: 'cm-md-strong' });
const emphasisMark = Decoration.mark({ class: 'cm-md-em' });
const codeMark = Decoration.mark({ class: 'cm-md-code' });
const linkMark = Decoration.mark({ class: 'cm-md-link' });
const lineDeco = (cls: string) => Decoration.line({ class: cls });

// --- Widgets ---------------------------------------------------------------
// Where markup *is* the content — a task's checkbox, an image — hiding it is
// not enough; something has to stand in its place.

/** `[ ]` / `[x]` drawn as a real checkbox. Clicking it rewrites the source. */
class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly from: number) {
    super();
  }
  eq(other: TaskWidget) {
    return other.checked === this.checked && other.from === this.from;
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-md-task';
    box.checked = this.checked;
    box.addEventListener('mousedown', (e) => {
      // The editor would otherwise move the caret here and re-render us away
      // mid-click.
      e.preventDefault();
      view.dispatch({ changes: { from: this.from + 1, to: this.from + 2, insert: this.checked ? ' ' : 'x' } });
    });
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

/** An inline image, drawn where its `![alt](src)` sits. */
class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string) {
    super();
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt;
  }
  toDOM(): HTMLElement {
    const img = document.createElement('img');
    img.className = 'cm-md-image';
    img.src = resolveImageSrc(this.src);
    img.alt = this.alt;
    return img;
  }
}

// How to turn a Markdown image path into something the WebView can load. The
// app knows (it depends on the document's folder and the asset protocol); the
// editor only needs to be told.
let resolveImageSrc: (src: string) => string = (src) => src;
export function setImageResolver(fn: (src: string) => string) {
  resolveImageSrc = fn;
}

/** Node names whose *content* (not markup) carries an inline style. */
const INLINE: Record<string, Decoration> = {
  StrongEmphasis: strongMark,
  Emphasis: emphasisMark,
  InlineCode: codeMark,
  Link: linkMark,
};

function buildDecorations(view: EditorView): DecorationSet {
  // Line and inline ranges interleave, so they are collected and handed to
  // `Decoration.set(_, true)` to sort — RangeSetBuilder demands ascending input.
  const ranges: Array<ReturnType<Decoration['range']>> = [];
  const { state } = view;
  const caretLine = state.doc.lineAt(state.selection.main.head).number;

  for (let i = 1; i <= state.doc.lines; i++) {
    const l = state.doc.line(i);
    const h = /^(#{1,6})\s/.exec(l.text);
    if (h) ranges.push(lineDeco(`cm-md-h${h[1].length}`).range(l.from));
    else if (/^\s*(```|~~~)/.test(l.text) || /^\s{4,}\S/.test(l.text)) {
      ranges.push(lineDeco('cm-md-fence').range(l.from));
    } else if (/^\s*>/.test(l.text)) ranges.push(lineDeco('cm-md-quote').range(l.from));
  }

  syntaxTree(state).iterate({
    enter: (n) => {
      const onCaretLine = state.doc.lineAt(n.from).number === caretLine;

      // `- [ ]` becomes a checkbox you can click. On the caret's line it stays
      // text, so the source is always reachable by moving the caret there.
      if (n.name === 'TaskMarker' && !onCaretLine) {
        const checked = /[xX]/.test(state.doc.sliceString(n.from, n.to));
        ranges.push(
          Decoration.replace({ widget: new TaskWidget(checked, n.from) }).range(n.from, n.to)
        );
        return false;
      }

      // An image draws itself; its `![alt](src)` collapses into the picture.
      if (n.name === 'Image' && !onCaretLine) {
        const raw = state.doc.sliceString(n.from, n.to);
        const m = /^!\[([^\]]*)\]\(([^)\s]+)/.exec(raw);
        if (m) {
          ranges.push(
            Decoration.replace({ widget: new ImageWidget(m[2], m[1]) }).range(n.from, n.to)
          );
          return false;
        }
      }

      // A link keeps its text and loses its plumbing: `[text](url)` reads as
      // `text`, coloured like a link.
      if (n.name === 'URL' && !onCaretLine) {
        ranges.push(hideMark.range(n.from, n.to));
        return false;
      }

      const inline = INLINE[n.name];
      if (inline && n.to > n.from) {
        ranges.push(inline.range(n.from, n.to));
        return;
      }
      // Markup characters. On the caret's own line they stay as typed — that
      // line is the one being edited, and hiding what you are typing is the
      // thing every WYSIWYG editor gets wrong.
      if (!/Mark$/.test(n.name) || n.to <= n.from) return;
      if (onCaretLine) return;
      // A task's `- ` is redundant once its checkbox is drawn, so it goes with
      // the rest of the markup; a plain list keeps its bullet.
      const isTaskBullet =
        n.name === 'ListMark' && /^\s*\[[ xX]\]/.test(state.doc.sliceString(n.to, n.to + 5));
      const keep = KEEP_DIM.has(n.name) && !isTaskBullet;
      ranges.push((keep ? dimMark : hideMark).range(n.from, n.to));
    },
  });
  return Decoration.set(ranges, true);
}

const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(u: ViewUpdate) {
      // The caret moving changes which line shows its markup, so selection
      // changes rebuild too.
      if (u.docChanged || u.selectionSet || u.viewportChanged) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    // Hidden markup should not swallow the caret: arrow keys step over it in
    // one go instead of landing inside text that is not on screen.
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
  }
);

// --- Tables ----------------------------------------------------------------
// The one construct the rest of this file's approach can't reach: a table's
// markup is not decoration *around* content, it *is* the grid, and a grid spans
// lines. Hiding pipes line by line would leave columns that don't line up, so a
// whole table is replaced by one block widget that draws real ruled borders.
//
// The caret rule stays the same in spirit — the text you are editing is never
// hidden — but its unit is the block: while the caret (or a selection) is inside
// a table, the table goes back to being rows of pipes, all of it at once. Click
// a cell to put the caret there; ↑/↓ across the border does the same.

/** A whole table, drawn where its rows sit. */
class TableWidget extends WidgetType {
  /** Where it starts plus its own source: same key, same table, no re-render —
   *  and never a reused grid whose cells point at stale offsets. */
  constructor(readonly block: TableBlock, readonly key: string) {
    super();
  }
  eq(other: TableWidget) {
    return other.key === this.key;
  }
  toDOM(view: EditorView): HTMLElement {
    // A wrapper, so a table wider than the pane scrolls sideways instead of
    // stretching the editor.
    const wrap = document.createElement('div');
    wrap.className = 'cm-md-tablewrap';
    const table = document.createElement('table');
    table.className = 'cm-md-table';
    const head = document.createElement('thead');
    head.appendChild(this.buildRow(view, this.block.header, 'th'));
    table.appendChild(head);
    if (this.block.rows.length) {
      const body = document.createElement('tbody');
      for (const row of this.block.rows) body.appendChild(this.buildRow(view, row, 'td'));
      table.appendChild(body);
    }
    wrap.appendChild(table);
    return wrap;
  }
  private buildRow(view: EditorView, cells: Cell[], tag: 'th' | 'td'): HTMLElement {
    const tr = document.createElement('tr');
    cells.forEach((cell, i) => {
      const el = document.createElement(tag);
      const align = this.block.align[i];
      if (align) el.style.textAlign = align;
      // Built as nodes, never as HTML: a cell is source text, and this editor
      // is not in the business of parsing it into markup.
      for (const seg of inlineSegments(cell.text)) {
        if (seg.style === 'plain') {
          el.appendChild(document.createTextNode(seg.text));
        } else if (seg.style === 'image') {
          const img = document.createElement('img');
          img.className = 'cm-md-image cm-md-cell-image';
          img.src = resolveImageSrc(seg.src ?? '');
          img.alt = seg.text;
          el.appendChild(img);
        } else {
          const span = document.createElement('span');
          span.className = `cm-md-${seg.style}`;
          span.textContent = seg.text;
          el.appendChild(span);
        }
      }
      // Clicking a cell is the way *into* the table: the caret lands in that
      // cell's source, which turns the block back into text under your hands.
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        view.dispatch({ selection: { anchor: cell.from } });
        view.focus();
      });
      tr.appendChild(el);
    });
    return tr;
  }
  /** Our own listeners handle the clicks; the editor should keep out. */
  ignoreEvent() {
    return true;
  }
}

interface TableState {
  deco: DecorationSet;
  /** Every table in the document, drawn or not — ↑/↓ needs the ones nearby. */
  blocks: TableBlock[];
}

/** `cached` is last update's parse, reusable when only the selection moved. */
function buildTables(state: EditorState, cached: TableBlock[] | null): TableState {
  const blocks = cached ?? findTables(state.doc.toString());
  const ranges: Array<ReturnType<Decoration['range']>> = [];
  for (const b of blocks) {
    if (state.selection.ranges.some((r) => r.from <= b.to && r.to >= b.from)) continue;
    const key = `${b.from}:${state.doc.sliceString(b.from, b.to)}`;
    ranges.push(
      Decoration.replace({ widget: new TableWidget(b, key), block: true }).range(b.from, b.to)
    );
  }
  return { deco: Decoration.set(ranges, true), blocks };
}

// A StateField rather than a ViewPlugin: decorations that swallow line breaks
// change the block structure, which CodeMirror only accepts from the state.
const tableField = StateField.define<TableState>({
  create: (state) => buildTables(state, null),
  update: (value, tr) => {
    if (!tr.docChanged && !tr.selection) return value;
    // Moving the caret changes which tables are drawn, not where they are, so
    // only an edit is worth re-reading the document for.
    return buildTables(tr.state, tr.docChanged ? null : value.blocks);
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

/**
 * ↑/↓ off the line next to a drawn table land inside it instead of stepping
 * over it. Without this the table is a wall to the keyboard: its lines have no
 * place on screen for the caret to be, so the cursor skips the whole block.
 *
 * Only the *neighbouring* table is considered, and only once the normal move
 * would leave the current line — a long wrapped line still scrolls through its
 * own rows first, and a mis-measured move can never throw the caret further
 * than the table next door.
 */
const stepIntoTable = (forward: boolean) => (view: EditorView): boolean => {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) return false;
  const line = state.doc.lineAt(range.head);
  const target = view.moveVertically(range, forward).head;
  if (forward ? target <= line.to : target >= line.from) return false;
  for (const b of state.field(tableField).blocks) {
    const next = forward ? b.from === line.to + 1 : b.to === line.from - 1;
    if (!next) continue;
    const anchor = forward ? b.from : state.doc.lineAt(b.to).from;
    view.dispatch({ selection: { anchor }, scrollIntoView: true });
    return true;
  }
  return false;
};

// --- Find highlights -------------------------------------------------------
// Decorations rather than a mirrored copy of the text under the editor: the
// same information, none of the "keep two elements pixel-identical" upkeep.

const setHits = StateEffect.define<{ hits: Hit[]; current: number }>();
const hitMark = Decoration.mark({ class: 'find-hit' });
const hitCurrentMark = Decoration.mark({ class: 'find-hit find-hit-current' });

const findField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (!e.is(setHits)) continue;
      const { hits, current } = e.value;
      return Decoration.set(
        hits.map((h, i) => (i === current ? hitCurrentMark : hitMark).range(h.start, h.end)),
        true
      );
    }
    return tr.docChanged ? Decoration.none : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// --- The surface -----------------------------------------------------------

export interface SurfaceHooks {
  /** The document changed because the user typed (never for programmatic sets). */
  onInput: () => void;
  onScroll: () => void;
  /** Return true to swallow the key (the app handled it). */
  onKeydown: (e: KeyboardEvent) => boolean;
  /** Return true to swallow the paste. */
  onPaste: (e: ClipboardEvent) => boolean;
}

export class EditorSurface {
  readonly view: EditorView;
  /** Set while the app writes the document itself, so hooks stay quiet. */
  private programmatic = false;

  constructor(parent: HTMLElement, hooks: SurfaceHooks) {
    const appTheme = EditorView.theme({
      '&': { height: '100%', backgroundColor: 'var(--mrd-bg)', color: 'var(--mrd-text)' },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': {
        fontFamily: 'var(--mrd-content-font)',
        fontSize: 'var(--mrd-content-size)',
        lineHeight: '1.75',
      },
      '.cm-content': { padding: '24px 28px', caretColor: 'var(--mrd-accent)' },
    });

    const extensions: Extension[] = [
      history(),
      // Ours first: list continuation and bracket pairing have to beat the
      // defaults, and the app owns undo/redo through the native menu too.
      Prec.highest(
        keymap.of([
          { key: 'Mod-z', run: undo, preventDefault: true },
          { key: 'Mod-Shift-z', run: redo, preventDefault: true },
          { key: 'ArrowDown', run: stepIntoTable(true) },
          { key: 'ArrowUp', run: stepIntoTable(false) },
          ...historyKeymap,
        ])
      ),
      // GFM, so task lists / tables / strikethrough parse the way the preview
      // (marked, also GFM) renders them.
      markdown({ base: markdownLanguage }),
      livePreview,
      tableField,
      findField,
      drawSelection(),
      highlightActiveLine(),
      EditorView.lineWrapping,
      appTheme,
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !this.programmatic) hooks.onInput();
      }),
      Prec.highest(
        EditorView.domEventHandlers({
          keydown: (e) => hooks.onKeydown(e),
          paste: (e) => hooks.onPaste(e),
          scroll: () => {
            hooks.onScroll();
            return false;
          },
        })
      ),
    ];

    this.view = new EditorView({ state: EditorState.create({ doc: '', extensions }), parent });
  }

  // --- the textarea-shaped API the app already speaks ---

  get value(): string {
    return this.view.state.doc.toString();
  }

  /** Replaces the whole document without notifying the app (as `.value =` did). */
  set value(text: string) {
    this.programmatic = true;
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: text },
      selection: { anchor: 0 },
    });
    this.programmatic = false;
  }

  get selectionStart(): number {
    return this.view.state.selection.main.from;
  }

  get selectionEnd(): number {
    return this.view.state.selection.main.to;
  }

  setSelectionRange(start: number, end: number) {
    const max = this.view.state.doc.length;
    const anchor = Math.min(Math.max(start, 0), max);
    const head = Math.min(Math.max(end, 0), max);
    this.view.dispatch({ selection: { anchor, head } });
  }

  focus() {
    this.view.focus();
  }

  /** Is the caret in the editor? (⌘⌫ and ⌘↑/↓ mean different things there.) */
  get focused(): boolean {
    return this.view.hasFocus;
  }

  /** The scrolling element, for the split layout's editor⇄preview sync. */
  get scroller(): HTMLElement {
    return this.view.scrollDOM;
  }

  get scrollTop(): number {
    return this.view.scrollDOM.scrollTop;
  }

  set scrollTop(y: number) {
    this.view.scrollDOM.scrollTop = y;
  }

  get clientWidth(): number {
    return this.view.scrollDOM.clientWidth;
  }

  get clientHeight(): number {
    return this.view.scrollDOM.clientHeight;
  }

  // --- what the textarea could not do ---

  /** Put `pos` at the top of the pane (the mode flip's landing). */
  scrollToOffset(pos: number) {
    const at = Math.min(Math.max(pos, 0), this.view.state.doc.length);
    this.view.dispatch({ effects: EditorView.scrollIntoView(at, { y: 'start', yMargin: 8 }) });
  }

  /**
   * Replace a range and place the caret, as one undoable step. Replaces the
   * old execCommand('insertText') trick: CodeMirror's own history is the undo
   * stack, so ⌘Z and Edit ▸ Undo both land here.
   */
  replaceRange(from: number, to: number, insert: string, caret?: { start: number; end: number }) {
    this.view.dispatch({
      changes: { from, to, insert },
      selection: caret ? { anchor: caret.start, head: caret.end } : undefined,
      scrollIntoView: true,
    });
  }

  /** Highlight find matches; `current` is the index to mark as the active one. */
  setHighlights(hits: Hit[], current: number) {
    this.view.dispatch({ effects: setHits.of({ hits, current }) });
  }

  clearHighlights() {
    this.setHighlights([], -1);
  }
}
