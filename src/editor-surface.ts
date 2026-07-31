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
  drawSelection,
  highlightActiveLine,
} from '@codemirror/view';
import { EditorState, StateEffect, StateField, Prec, type Extension } from '@codemirror/state';
import { history, historyKeymap, undo, redo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';

/** A find match, in source offsets — the same shape find.ts produces. */
export interface Hit {
  start: number;
  end: number;
}

// --- Live preview decorations ---------------------------------------------
// The source stays plain text; only its *appearance* changes. Markup on the
// line the caret is on is left alone, so the moment you go to edit a heading
// its `##` is right there — no mode to leave, nothing to reveal.

const dimMark = Decoration.mark({ class: 'cm-md-marker' });
const strongMark = Decoration.mark({ class: 'cm-md-strong' });
const emphasisMark = Decoration.mark({ class: 'cm-md-em' });
const codeMark = Decoration.mark({ class: 'cm-md-code' });
const linkMark = Decoration.mark({ class: 'cm-md-link' });
const lineDeco = (cls: string) => Decoration.line({ class: cls });

/** Node names whose *content* (not markup) carries an inline style. */
const INLINE: Record<string, Decoration> = {
  StrongEmphasis: strongMark,
  Emphasis: emphasisMark,
  InlineCode: codeMark,
  URL: linkMark,
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
      const inline = INLINE[n.name];
      if (inline && n.to > n.from) {
        ranges.push(inline.range(n.from, n.to));
        return;
      }
      // Markup characters: dimmed, except on the caret's own line.
      if (!/Mark$/.test(n.name) || n.to <= n.from) return;
      if (state.doc.lineAt(n.from).number === caretLine) return;
      ranges.push(dimMark.range(n.from, n.to));
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
  { decorations: (v) => v.decorations }
);

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
          ...historyKeymap,
        ])
      ),
      markdown(),
      livePreview,
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
