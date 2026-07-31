// 試着用（このブランチ限定・出荷しない）。編集ペインの上に CodeMirror 6 の
// Live Preview を被せ、実機の WKWebView で日本語 IME が通るかだけを見る。
// 保存・検索・書式バーとは繋いでいない。
import { EditorView, keymap, Decoration, type DecorationSet, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';

let view: EditorView | null = null;
let host: HTMLElement | null = null;

const marker = Decoration.mark({ class: 'cm-md-marker' });
const lineDeco = (cls: string) => Decoration.line({ class: cls });

function build(v: EditorView): DecorationSet {
  const ranges: Array<ReturnType<Decoration['range']>> = [];
  const cursorLine = v.state.doc.lineAt(v.state.selection.main.head).number;
  for (let i = 1; i <= v.state.doc.lines; i++) {
    const l = v.state.doc.line(i);
    const m = /^(#{1,6})\s/.exec(l.text);
    if (m) ranges.push(lineDeco(`cm-h${m[1].length}`).range(l.from));
    else if (/^\s*```/.test(l.text)) ranges.push(lineDeco('cm-fence').range(l.from));
  }
  syntaxTree(v.state).iterate({
    enter: (n) => {
      if (!/Mark$/.test(n.name)) return;
      if (v.state.doc.lineAt(n.from).number === cursorLine) return;
      if (n.to > n.from) ranges.push(marker.range(n.from, n.to));
    },
  });
  return Decoration.set(ranges, true);
}

const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(v: EditorView) { this.decorations = build(v); }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations }
);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--mrd-content-size, 16px)', color: 'var(--mrd-text)', backgroundColor: 'var(--mrd-bg)' },
  '.cm-scroller': { fontFamily: 'var(--mrd-content-font)', lineHeight: '1.75' },
  '.cm-content': { padding: '24px 28px', caretColor: 'var(--mrd-accent)' },
  '.cm-md-marker': { color: 'var(--mrd-faint)', fontFamily: "'SF Mono',Menlo,monospace", fontSize: '0.85em' },
  '.cm-h1': { fontSize: '1.9em', fontWeight: '700', lineHeight: '1.35' },
  '.cm-h2': { fontSize: '1.4em', fontWeight: '700', lineHeight: '1.4' },
  '.cm-h3': { fontSize: '1.2em', fontWeight: '700' },
  '.cm-fence': { fontFamily: "'SF Mono',Menlo,monospace", fontSize: '0.88em', backgroundColor: 'var(--mrd-surface)' },
  '.cm-activeLine': { backgroundColor: 'var(--mrd-accent-faint)' },
  '&.cm-focused': { outline: 'none' },
});

export function mountSpike(area: HTMLElement, text: string) {
  unmountSpike();
  host = document.createElement('div');
  host.id = 'cm-spike';
  Object.assign(host.style, { position: 'absolute', inset: '0', zIndex: '5', background: 'var(--mrd-bg)' });
  area.appendChild(host);
  view = new EditorView({
    state: EditorState.create({
      doc: text,
      extensions: [history(), keymap.of([...defaultKeymap, ...historyKeymap]), markdown(), livePreview, theme, EditorView.lineWrapping],
    }),
    parent: host,
  });
  view.focus();
}

export function unmountSpike() {
  view?.destroy();
  view = null;
  host?.remove();
  host = null;
}
