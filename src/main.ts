import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { homeDir, resolveResource } from '@tauri-apps/api/path';
import { open, save as saveDialog, confirm as confirmDialog } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { marked } from 'marked';
import markedFootnote from 'marked-footnote';
import markedKatex from 'marked-katex-extension';
import 'katex/dist/katex.min.css';
import DOMPurify from 'dompurify';
import { SUPPORTED, isSupported, basename, dirname, tildify, resolveImagePath, resolveDocLink, sanitizeFilename } from './paths';
import {
  slugify,
  firstHeadingTitle,
  extractFrontmatter,
  frontmatterToHtml,
  docStats,
  toggleTaskListItem,
} from './markdown';
import { buildMatcher, findMatches, sliceMatches, type FindOpts } from './find';
import {
  sideBySide,
  inlineSegments,
  foldUnchanged,
  diffStats,
  threeWay,
  threeWayStats,
  foldThreeWay,
  isGap,
  type DiffRow,
  type ThreeRow,
  type Seg,
} from './diff';
import { t, getLang, setLang, isSystemLang, type Lang, type Key } from './i18n';
import {
  toggleWrap,
  toggleLinePrefix,
  insertLink,
  insertImage,
  insertFence,
  insertTable,
  insertHr,
  listContinue,
  listIndent,
  autoPair,
  linkFromPaste,
  type Sel,
} from './editor-ops';
import {
  buildExportDocument,
  collectCss,
  inlineCssUrls,
  inlineImages,
  stripFindHighlights,
  stripInteractive,
} from './export';

// Markdown extensions, registered once. Footnotes (`[^1]`) render as a linked
// section at the end; `$…$` / `$$…$$` become KaTeX. A malformed formula is left
// as plain text rather than throwing and losing the rest of the document.
marked.use(markedFootnote());
marked.use(markedKatex({ throwOnError: false }));

const sidebarBtn = document.getElementById('sidebar-btn')!;
const openBtn = document.getElementById('open-btn')!;
const newBtn = document.getElementById('new-btn')!;
const reloadBtn = document.getElementById('reload-btn') as HTMLButtonElement;
const editBtn = document.getElementById('edit-btn') as HTMLButtonElement;
const editLabel = document.getElementById('edit-label')!;
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
const deleteBtn = document.getElementById('delete-btn') as HTMLButtonElement;
const editor = document.getElementById('editor') as HTMLTextAreaElement;
const editorHighlights = document.getElementById('editor-highlights')!;
const formatBar = document.getElementById('format-bar')!;
const settingsBtn = document.getElementById('settings-btn')!;
const settingsOverlay = document.getElementById('settings-overlay') as HTMLElement;
const settingsClose = document.getElementById('settings-close')!;
const toolbarOptions = document.getElementById('toolbar-options')!;
const langOptions = document.getElementById('lang-options')!;
const widthOption = document.getElementById('width-option')!;
const accentOption = document.getElementById('accent-option')!;
const bgOption = document.getElementById('bg-option')!;
const textOption = document.getElementById('text-option')!;
const fontOption = document.getElementById('font-option')!;
const fontsizeOption = document.getElementById('fontsize-option')!;
const outlinePosOption = document.getElementById('outline-pos-option')!;
const output = document.getElementById('output')!;
const docStatsEl = document.getElementById('doc-stats')!;
const emptyState = document.getElementById('empty-state')!;
const recentBox = document.getElementById('recent')!;
const filepath = document.getElementById('filepath')!;
const divider = document.getElementById('divider')!;
const historyBtn = document.getElementById('history-btn') as HTMLButtonElement;
const historyOverlay = document.getElementById('history-overlay') as HTMLElement;
const historyClose = document.getElementById('history-close')!;
const historyList = document.getElementById('history-list')!;
const historySide = document.getElementById('history-side')!;
const historyDiff = document.getElementById('history-diff')!;
const historyActions = document.getElementById('history-actions')!;
const conflictActions = document.getElementById('conflict-actions')!;
const diffTitle = document.getElementById('diff-title')!;
const diffStatsEl = document.getElementById('diff-stats')!;
const historyRestore = document.getElementById('history-restore') as HTMLButtonElement;
const conflictBar = document.getElementById('conflict-bar')!;
const historyPanel = document.querySelector<HTMLElement>('.history-panel')!;
const findBar = document.getElementById('find-bar') as HTMLElement;
const findInput = document.getElementById('find-input') as HTMLInputElement;
const findCount = document.getElementById('find-count')!;
const findPrevBtn = document.getElementById('find-prev')!;
const findNextBtn = document.getElementById('find-next')!;
const findCloseBtn = document.getElementById('find-close')!;
const replaceInput = document.getElementById('replace-input') as HTMLInputElement;
const replaceOneBtn = document.getElementById('replace-one')!;
const replaceAllBtn = document.getElementById('replace-all')!;
const optCaseBtn = document.getElementById('opt-case')!;
const optWordBtn = document.getElementById('opt-word')!;
const optRegexBtn = document.getElementById('opt-regex')!;
const appWindow = getCurrentWindow();

// Home directory, used to abbreviate paths to ~ (resolved once on startup).
let home = '';
homeDir()
  .then((h) => {
    home = h.replace(/[\\/]$/, '');
    updateStatus();
  })
  .catch(() => {});
const docList = document.getElementById('doc-list')!;
const folderBtn = document.getElementById('folder-btn')!;
const folderTree = document.getElementById('folder-tree') as HTMLElement;
const folderHead = document.getElementById('folder-head') as HTMLElement;
const folderName = document.getElementById('folder-name')!;
const folderCloseBtn = document.getElementById('folder-close-btn') as HTMLButtonElement;
const contentArea = document.querySelector('.content-area') as HTMLElement;

// A document open in the session. `workingText` is the editor buffer, which
// may differ from what's on disk (`savedSource`) until saved. `path` is null
// for a new, never-saved ("untitled") document.
interface Doc {
  path: string | null;
  name: string;
  savedSource: string;
  workingText: string;
  mtime: number;
  /**
   * Something rewrote the file on disk while this buffer had unsaved edits — an
   * AI agent, most often. Three texts now exist (savedSource, this, workingText)
   * and the user has to say which wins, so nothing is written or discarded until
   * they do.
   */
  conflict?: { content: string; mtime: number } | null;
}

let docs: Doc[] = [];
let active: Doc | null = null;
let isEditing = false;
let lastActiveDirty = false;
let untitledCount = 0;

const isDirty = (d: Doc) => d.workingText !== d.savedSource;

// Give headings ids so in-document anchor links (and the outline) work.
function addHeadingIds() {
  const used = new Set<string>();
  output.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6').forEach((h) => {
    if (h.id) return;
    const base = slugify(h.textContent || '') || 'section';
    let id = base;
    for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
    used.add(id);
    h.id = id;
  });
}

// Copy the text of a code block. `navigator.clipboard` needs a secure context,
// which the webview may not report, so fall back to a hidden textarea + execCommand.
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(scratch);
    scratch.select();
    const ok = document.execCommand('copy');
    scratch.remove();
    return ok;
  }
}

// Give every rendered code block a copy button. Re-run after each render, since
// the preview's innerHTML is replaced wholesale.
function addCopyButtons() {
  output.querySelectorAll('pre').forEach((pre) => {
    const code = pre.querySelector('code');
    if (!code) return; // Mermaid diagrams and the frontmatter card have no <code>
    const btn = document.createElement('button');
    btn.className = 'code-copy';
    btn.type = 'button';
    // `applyI18n` relabels every [data-i18n] node, so the button follows a
    // language switch without re-rendering the preview.
    btn.dataset.i18n = 'copyCode';
    btn.textContent = t('copyCode');
    btn.addEventListener('click', async () => {
      if (!(await copyText(code.textContent ?? ''))) return;
      btn.textContent = t('copied');
      btn.classList.add('done');
      setTimeout(() => {
        btn.textContent = t('copyCode');
        btn.classList.remove('done');
      }, 1400);
    });
    pre.appendChild(btn);
  });
}

// Task-list checkboxes render disabled; enable them and write a tick back into
// the Markdown source. The nth checkbox maps to the nth task line (fenced code
// and frontmatter are skipped on both sides), so no source positions are stored.
function enableTaskCheckboxes() {
  output.querySelectorAll<HTMLInputElement>('li > input[type="checkbox"]').forEach((box, index) => {
    box.disabled = false;
    box.addEventListener('change', () => {
      const next = active && toggleTaskListItem(active.workingText, index);
      if (!next) {
        box.checked = !box.checked; // nothing to rewrite — don't lie about the source
        return;
      }
      if (isEditing) {
        // Route through the editor so the tick lands on the native undo stack.
        const caret = editor.selectionStart;
        replaceEditorText(next, caret, caret);
      } else {
        editor.value = next;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  });
}

// --- Outline / TOC — the active document's headings, with click-to-scroll and
// a scroll-spy that marks the heading you're reading.
//
// It lives in a column of its own to the right of the content (the default: in
// the sidebar it had to share 230px with the folder tree and the open-documents
// list, which left headings wrapping), or stacked inside the sidebar as it used
// to. Switching position moves the one #outline node between the two parents. ---
const bodyRow = document.querySelector<HTMLElement>('.body-row')!;
const sidebar = document.getElementById('sidebar')!;
const outlinePane = document.getElementById('outline')!;
const outlineHead = document.getElementById('outline-head')!;
const outlineList = document.getElementById('outline-list')!;
const OUTLINE_KEY = 'mrdown.outlineCollapsed';
let outlineCollapsed = localStorage.getItem(OUTLINE_KEY) === '1';
let outlineHeads: HTMLElement[] = [];
let outlineScrollEl: HTMLElement | null = null;
let outlineRaf = 0;
let outlineClickLock = 0;

type OutlinePos = 'left' | 'right';
const OUTLINE_POS_KEY = 'mrdown.outlinePos';
let outlinePos: OutlinePos = localStorage.getItem(OUTLINE_POS_KEY) === 'left' ? 'left' : 'right';

// Visibility is remembered per mode, because the two modes have very different
// room for it. Editing splits the content area into editor + preview, so at the
// default 1100px window an outline column leaves the preview about 320px wide —
// narrow enough to break headings mid-word. So it starts hidden while editing
// and shown in preview. ⌘2 overrides that for whichever mode you're in, and the
// override sticks: on a wide display you turn it on once while editing and it
// stays on, without a width threshold second-guessing you.
const outlineHiddenKey = (editing: boolean) =>
  editing ? 'mrdown.outlineHidden.edit' : 'mrdown.outlineHidden.preview';

function outlineHiddenIn(editing: boolean): boolean {
  const stored = localStorage.getItem(outlineHiddenKey(editing));
  return stored === null ? editing : stored === '1';
}

function applyOutlinePos() {
  document.body.classList.toggle('outline-right', outlinePos === 'right');
  // index.html ships it in the right column, so "left" is the move. Appending is
  // enough in both directions: the sidebar's outline sits below the open-docs
  // list, and the right column is the last child of the row.
  (outlinePos === 'left' ? sidebar : bodyRow).appendChild(outlinePane);
  applyOutlineCollapsed();
}

function applyOutlineHidden() {
  document.body.classList.toggle('outline-hidden', outlineHiddenIn(isEditing));
}

function toggleOutline() {
  const next = !outlineHiddenIn(isEditing);
  localStorage.setItem(outlineHiddenKey(isEditing), next ? '1' : '0');
  applyOutlineHidden();
}

function markOutlineActive(id: string) {
  for (const li of Array.from(outlineList.children) as HTMLElement[]) {
    li.classList.toggle('active', li.dataset.id === id);
  }
}

// Scroll-spy: highlight the heading you're reading. The active one is the last
// whose top has passed a line just below the viewport top; near the bottom the
// trailing headings can't reach that line, so clamp to the final heading (keeps
// a click on the last outline item highlighted). rAF-throttled.
function updateOutlineActive() {
  outlineRaf = 0;
  // A click sets the active item and smooth-scrolls; keep the clicked item lit
  // through that scroll instead of letting the spy override it mid-flight.
  if (Date.now() - outlineClickLock < 600) return;
  const root = outlineScrollEl;
  if (!root || outlineHeads.length === 0) return;
  const rootTop = root.getBoundingClientRect().top;
  let id = outlineHeads[0].id;
  for (const h of outlineHeads) {
    if (h.getBoundingClientRect().top - rootTop <= 90) id = h.id;
    else break;
  }
  if (root.scrollTop + root.clientHeight >= root.scrollHeight - 4) {
    id = outlineHeads[outlineHeads.length - 1].id;
  }
  markOutlineActive(id);
}

function onOutlineScroll() {
  if (!outlineRaf) outlineRaf = requestAnimationFrame(updateOutlineActive);
}

// Bind the scroll-spy to the active scroll container — the content area in
// preview, the #output pane while editing (they differ) — so it is re-bound on
// every rebuild and whenever the edit/preview mode flips.
function bindOutlineSpy() {
  outlineScrollEl?.removeEventListener('scroll', onOutlineScroll);
  if (outlineHeads.length === 0) {
    outlineScrollEl = null;
    return;
  }
  outlineScrollEl = isEditing ? output : contentArea;
  outlineScrollEl.addEventListener('scroll', onOutlineScroll, { passive: true });
  updateOutlineActive();
}

// Collapsing only means something in the sidebar, where the outline is one
// section among several. In the right column the pane is the outline, so ⌘2
// takes it away wholesale and the chevron is hidden (see styles.css).
function applyOutlineCollapsed() {
  const collapsed = outlinePos === 'left' && outlineCollapsed;
  outlineHead.classList.toggle('collapsed', collapsed);
  outlineList.hidden = collapsed || outlineHeads.length === 0;
}

// Rebuild from the rendered headings. Called after every render (open, reload,
// debounced live edit) so the outline always mirrors the current document.
function buildOutline() {
  // The footnotes section carries its own generated heading; it isn't part of
  // the document's structure, so keep it out of the outline.
  outlineHeads = Array.from(output.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')).filter(
    (h) => !h.closest('.footnotes')
  );
  outlineList.innerHTML = '';
  if (outlineHeads.length === 0) {
    outlineHead.hidden = true;
    outlineList.hidden = true;
    bindOutlineSpy();
    return;
  }
  outlineHead.hidden = false;
  // Indent relative to the shallowest heading present, so a doc that starts at
  // ## isn't pushed in needlessly.
  const minLevel = Math.min(...outlineHeads.map((h) => Number(h.tagName[1])));
  for (const h of outlineHeads) {
    const level = Number(h.tagName[1]);
    const li = document.createElement('li');
    li.className = 'outline-item';
    li.dataset.id = h.id;
    li.dataset.level = String(level);
    li.style.paddingLeft = `${10 + (level - minLevel) * 14}px`;
    li.textContent = h.textContent || '';
    li.title = li.textContent;
    li.addEventListener('click', () => {
      markOutlineActive(h.id);
      outlineClickLock = Date.now();
      document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    outlineList.appendChild(li);
  }
  applyOutlineCollapsed();
  bindOutlineSpy();
}

function clearOutline() {
  outlineHeads = [];
  outlineList.innerHTML = '';
  outlineHead.hidden = true;
  outlineList.hidden = true;
  bindOutlineSpy();
}

outlineHead.addEventListener('click', () => {
  if (outlinePos !== 'left') return;
  outlineCollapsed = !outlineCollapsed;
  localStorage.setItem(OUTLINE_KEY, outlineCollapsed ? '1' : '0');
  applyOutlineCollapsed();
});

// Lazily load Mermaid only when a document actually contains a diagram, so the
// large dependency never slows down opening plain Markdown.
let mermaidLoader: Promise<typeof import('mermaid')['default']> | null = null;
function getMermaid() {
  if (!mermaidLoader) {
    mermaidLoader = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'strict',
        // Throw on invalid input instead of injecting Mermaid's "bomb" graphic,
        // so our own fallback handles errors.
        suppressErrorRendering: true,
      });
      return mermaid;
    });
  }
  return mermaidLoader;
}

// Lazily load highlight.js (the smaller "common" bundle of ~35 languages) only
// when a document actually has a code block, mirroring the Mermaid loader.
let hljsLoader: Promise<typeof import('highlight.js/lib/common')['default']> | null = null;
function getHljs() {
  if (!hljsLoader) {
    hljsLoader = import('highlight.js/lib/common').then(({ default: hljs }) => hljs);
  }
  return hljsLoader;
}

// Syntax-highlight fenced code blocks. Runs after sanitize, so the spans
// highlight.js injects are our own trusted output, not user HTML. Mermaid
// blocks are skipped — renderMermaid() replaces those with diagrams instead.
async function highlightCode() {
  const blocks = (Array.from(output.querySelectorAll('pre code')) as HTMLElement[])
    .filter((b) => !b.classList.contains('language-mermaid'));
  if (blocks.length === 0) return;
  const hljs = await getHljs();
  for (const block of blocks) hljs.highlightElement(block);
}

// Turn ```mermaid code blocks into rendered diagrams (falling back to the
// source on error so a bad diagram never blanks the document).
async function renderMermaid() {
  const blocks = Array.from(output.querySelectorAll('code.language-mermaid'));
  if (blocks.length === 0) return;
  const mermaid = await getMermaid();
  let i = 0;
  for (const block of blocks) {
    const host = block.closest('pre') ?? block;
    const source = block.textContent || '';
    try {
      // Validate first so invalid diagrams never reach render() (no DOM injection).
      if ((await mermaid.parse(source, { suppressErrors: true })) === false) {
        throw new Error('Invalid Mermaid syntax');
      }
      const { svg } = await mermaid.render(`mermaid-${Date.now()}-${i++}`, source);
      const diagram = document.createElement('div');
      diagram.className = 'mermaid-diagram';
      diagram.innerHTML = svg;
      host.replaceWith(diagram);
    } catch (e) {
      const fallback = document.createElement('div');
      fallback.className = 'mermaid-error';
      const msg = document.createElement('p');
      msg.textContent = `Mermaid render error: ${e instanceof Error ? e.message : e}`;
      fallback.append(msg, host.cloneNode(true));
      host.replaceWith(fallback);
    }
  }
}

// Resolve local (relative/absolute) image paths against the file's directory
// and route them through the asset protocol so they actually load.
function resolveLocalImages(filePath: string) {
  output.querySelectorAll('img').forEach((img) => {
    const abs = resolveImagePath(filePath, img.getAttribute('src') || '');
    if (abs) img.src = convertFileSrc(abs);
  });
}

// Render Markdown source into the preview pane (no disk I/O).
async function renderSource(source: string, filePath: string) {
  // Pull any leading YAML frontmatter out so it renders as a tidy collapsed
  // panel instead of the broken <hr> + text marked would make of `--- … ---`.
  const { frontmatter, body } = extractFrontmatter(source);
  const meta = frontmatter ? frontmatterToHtml(frontmatter, t('frontmatter')) : '';
  const html = meta + (await marked.parse(body));
  output.innerHTML = DOMPurify.sanitize(html);
  addHeadingIds();
  buildOutline();
  resolveLocalImages(filePath);
  enableTaskCheckboxes();
  await highlightCode();
  await renderMermaid();
  // After Mermaid, so a diagram's <pre> — now a <div> — gets no copy button.
  addCopyButtons();
  // A re-render wipes the preview highlights; rebuild them if the find bar is
  // open in preview mode. (Source mode searches the editor, not this pane.)
  if (!findBar.hidden && !isEditing && findInput.value) runFind(true);
}

// --- Session UI state ---

// The native menu's document actions (Save, Export, Close, …) follow the same
// rule as the toolbar buttons below: alive only while a document is open. Rust
// holds the state, so a menu rebuilt for a language switch comes back greyed
// out too. Deduped because `showDocUI` runs on every document switch.
let menuDocState: boolean | null = null;
function setMenuDocState(open: boolean) {
  if (menuDocState === open) return;
  menuDocState = open;
  invoke('set_document_open', { open }).catch(() => {});
}

function showDocUI() {
  emptyState.style.display = 'none';
  output.style.display = 'block';
  reloadBtn.disabled = false;
  editBtn.disabled = false;
  setMenuDocState(true);
}

function showEmpty() {
  setEditing(false);
  clearOutline();
  output.style.display = 'none';
  output.innerHTML = '';
  editor.value = '';
  emptyState.style.display = '';
  reloadBtn.disabled = true;
  editBtn.disabled = true;
  setMenuDocState(false);
  saveBtn.disabled = true;
  deleteBtn.disabled = true;
  historyBtn.disabled = true;
  findBar.hidden = true;
  filepath.textContent = '';
  appWindow.setTitle('MRDown').catch(() => {});
  invoke<string[]>('get_recent_files').then(renderRecent).catch(() => {});
}

// Reflect the active document + dirty state in the toolbar.
// Toolbar reading stats for the active document, e.g. "1,234 字 · 約2分" /
// "1,234 chars · ~2 min". Empty for an empty document.
function formatDocStats(text: string): string {
  const { chars, minutes } = docStats(text);
  if (chars === 0) return '';
  return `${chars.toLocaleString()} ${t('statsChars')} · ${t('statsReadPrefix')}${minutes}${t('statsMin')}`;
}

function updateStatus() {
  const dirty = active ? isDirty(active) : false;
  saveBtn.disabled = !dirty;
  saveBtn.classList.toggle('dirty', dirty);
  // Delete and History act on the on-disk file, so they're only available once saved.
  deleteBtn.disabled = !(active && active.path);
  historyBtn.disabled = !(active && active.path);
  filepath.textContent = '';
  docStatsEl.textContent = active ? formatDocStats(active.workingText) : '';
  // Window title shows the file name; the toolbar shows the full (~) path.
  appWindow.setTitle(active ? active.name : 'MRDown').catch(() => {});
  if (!active) return;
  if (dirty) {
    const dot = document.createElement('span');
    dot.className = 'dirty-dot';
    dot.textContent = '●';
    filepath.appendChild(dot);
  }
  filepath.append(active.path ? tildify(active.path, home) : active.name);
}

function setEditing(on: boolean) {
  isEditing = on;
  contentArea.classList.toggle('editing', on);
  editLabel.textContent = on ? t('preview') : t('edit');
  // The outline is remembered per mode (hidden while editing unless you asked
  // for it there), so the mode flip has to re-read it.
  applyOutlineHidden();
  if (on) editor.focus();
  // The outline's scroll-spy watches a different scroll container per mode.
  bindOutlineSpy();
  // Find switches between source (editor) and preview search with the mode.
  if (!findBar.hidden) runFind();
}

// --- Sidebar (open documents) ---

function renderSidebar() {
  docList.innerHTML = '';
  for (const doc of docs) {
    const li = document.createElement('li');
    if (doc === active) li.classList.add('active');
    if (isDirty(doc)) li.classList.add('dirty');
    li.title = doc.path ?? doc.name;

    const name = document.createElement('span');
    name.className = 'doc-name';
    name.textContent = doc.name;

    const close = document.createElement('span');
    close.className = 'doc-close';
    close.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
    close.title = t('close');
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeDoc(doc);
    });

    li.append(name);
    if (isDirty(doc)) {
      const dot = document.createElement('span');
      dot.className = 'doc-dirty';
      dot.textContent = '●';
      li.append(dot);
    }
    li.append(close);
    li.addEventListener('click', () => setActive(doc));
    docList.appendChild(li);
  }
}

// --- Folder tree (open a folder, browse its Markdown as a set) ---

interface TreeEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

const FOLDER_KEY = 'mrdown.folder';
let folderRoot: string | null = null;
// Expanded subfolders (by absolute path) and a cache of each listed directory's
// children, so re-rendering the tree never re-hits the disk.
const expandedFolders = new Set<string>();
const treeChildren = new Map<string, TreeEntry[]>();

const listDir = (dir: string) => invoke<TreeEntry[]>('read_dir', { dir }).catch(() => []);

function saveFolderState() {
  if (!folderRoot) {
    localStorage.removeItem(FOLDER_KEY);
    return;
  }
  try {
    localStorage.setItem(
      FOLDER_KEY,
      JSON.stringify({ root: folderRoot, expanded: [...expandedFolders] }),
    );
  } catch {
    // Non-fatal: a lost folder state just means the tree starts collapsed.
  }
}

// Open (or restore) a folder as the tree root. Fetches the root listing plus any
// still-expanded subfolders up front so the restored tree renders in one pass.
async function loadFolder(root: string, expanded: string[] = []) {
  folderRoot = root;
  expandedFolders.clear();
  treeChildren.clear();
  await Promise.all([root, ...expanded].map(async (d) => treeChildren.set(d, await listDir(d))));
  for (const p of expanded) expandedFolders.add(p);
  updateFolderHeader();
  renderTree();
}

function closeFolder() {
  folderRoot = null;
  expandedFolders.clear();
  treeChildren.clear();
  updateFolderHeader();
  renderTree();
  saveFolderState();
}

function updateFolderHeader() {
  // The header (folder name + close) only exists while a folder is open; opening
  // is driven by the labeled toolbar button, so there's nothing to show when none.
  folderHead.hidden = !folderRoot;
  if (folderRoot) {
    folderName.textContent = basename(folderRoot);
    folderName.title = folderRoot;
  }
}

async function toggleFolder(path: string) {
  if (expandedFolders.has(path)) {
    expandedFolders.delete(path);
  } else {
    expandedFolders.add(path);
    if (!treeChildren.has(path)) treeChildren.set(path, await listDir(path));
  }
  saveFolderState();
  renderTree();
}

const TREE_CHEVRON =
  '<svg class="tree-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>';
const TREE_FOLDER =
  '<svg class="tree-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
const TREE_FILE =
  '<svg class="tree-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

// Rebuild the whole tree from the cache (synchronous). Only expanded folders
// recurse, so collapsed branches cost nothing.
function renderTree() {
  folderTree.innerHTML = '';
  folderTree.hidden = !folderRoot;
  if (!folderRoot) return;
  const roots = treeChildren.get(folderRoot) ?? [];
  if (roots.length === 0) {
    const li = document.createElement('li');
    li.className = 'tree-empty';
    li.textContent = t('folderEmpty');
    folderTree.appendChild(li);
    return;
  }
  for (const entry of roots) appendTreeRows(entry, 0);
}

function appendTreeRows(entry: TreeEntry, depth: number) {
  const li = document.createElement('li');
  li.className = 'tree-row';
  li.style.paddingLeft = `${6 + depth * 14}px`;
  li.title = entry.path;
  const label = `<span class="tree-name"></span>`;

  if (entry.is_dir) {
    if (expandedFolders.has(entry.path)) li.classList.add('expanded');
    li.innerHTML = `${TREE_CHEVRON}${TREE_FOLDER}${label}`;
    li.querySelector('.tree-name')!.textContent = entry.name;
    li.addEventListener('click', () => toggleFolder(entry.path));
    folderTree.appendChild(li);
    if (expandedFolders.has(entry.path)) {
      for (const child of treeChildren.get(entry.path) ?? []) appendTreeRows(child, depth + 1);
    }
  } else {
    if (entry.path === active?.path) li.classList.add('active');
    li.innerHTML = `<span class="tree-spacer"></span>${TREE_FILE}${label}`;
    li.querySelector('.tree-name')!.textContent = entry.name;
    li.addEventListener('click', () => openFile(entry.path));
    folderTree.appendChild(li);
  }
}

folderBtn.addEventListener('click', async () => {
  const dir = await open({ directory: true, multiple: false });
  if (typeof dir === 'string') {
    await loadFolder(dir);
    saveFolderState();
  }
});
folderCloseBtn.addEventListener('click', closeFolder);

// Restore a previously opened folder tree on startup.
try {
  const raw = localStorage.getItem(FOLDER_KEY);
  if (raw) {
    const saved = JSON.parse(raw) as { root?: unknown; expanded?: unknown };
    if (typeof saved.root === 'string') {
      loadFolder(saved.root, Array.isArray(saved.expanded) ? (saved.expanded as string[]) : []);
    }
  }
} catch {
  // Corrupt folder state: ignore and start with no tree.
}

const SESSION_KEY = 'mrdown.session';

// Persist the full working state of every open document — untitled buffers and
// unsaved edits included — so a quit or crash never loses a draft. `savedSource`
// travels alongside `workingText` so restore can tell a draft from a clean file
// even if that file later changed on disk or vanished.
function saveSession() {
  const openDocs = docs.map((d) => ({
    path: d.path,
    name: d.name,
    workingText: d.workingText,
    savedSource: d.savedSource,
    mtime: d.mtime,
  }));
  try {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ docs: openDocs, activeIndex: active ? docs.indexOf(active) : -1 }),
    );
  } catch {
    // localStorage full/unavailable: a lost session is non-fatal, so swallow it.
  }
}

// While typing we only need to checkpoint the draft occasionally; debounce so a
// long editing burst isn't one localStorage write per keystroke.
let sessionSaveTimer: number | undefined;
function scheduleSessionSave() {
  clearTimeout(sessionSaveTimer);
  sessionSaveTimer = window.setTimeout(saveSession, 400);
}
// Last-chance flush so the final keystrokes before a close survive the debounce.
window.addEventListener('beforeunload', saveSession);

async function setActive(doc: Doc) {
  if (active === doc) {
    if (isEditing) editor.focus();
    return;
  }
  active = doc;
  lastActiveDirty = isDirty(doc);
  editor.value = doc.workingText;
  await renderSource(doc.workingText, doc.path ?? '');
  showDocUI();
  updateStatus();
  renderSidebar();
  renderTree();
  saveSession();
  contentArea.scrollTop = 0;
  if (isEditing) editor.focus();
}

// `recent: false` opens a document without listing it on the start screen —
// for files that live inside the app bundle, whose path changes on every update.
async function openFile(path: string, opts: { recent?: boolean } = {}) {
  const existing = docs.find((d) => d.path === path);
  if (existing) {
    await setActive(existing);
    return;
  }
  let content: string;
  try {
    content = await invoke<string>('read_file', { path });
  } catch (e) {
    filepath.textContent = t('openFailed', { e: String(e) });
    return;
  }
  const mtime = await invoke<number>('file_mtime', { path }).catch(() => 0);
  const doc: Doc = { path, name: basename(path), savedSource: content, workingText: content, mtime };
  docs.push(doc);
  active = doc;
  lastActiveDirty = false;
  editor.value = content;
  await renderSource(content, path);
  showDocUI();
  updateStatus();
  renderSidebar();
  renderTree();
  saveSession();
  contentArea.scrollTop = 0;
  if (opts.recent !== false) invoke<string[]>('add_recent_file', { path }).then(renderRecent).catch(() => {});
}

// Drop a document from the session (no prompting), switching away if it was
// active. Shared by close and delete.
async function removeDoc(doc: Doc) {
  const idx = docs.indexOf(doc);
  if (idx === -1) return;
  docs.splice(idx, 1);
  if (active === doc) {
    const next = docs[idx] ?? docs[idx - 1] ?? null;
    active = null;
    if (next) await setActive(next);
    else showEmpty();
  }
  renderSidebar();
  saveSession();
}

async function closeDoc(doc: Doc) {
  if (isDirty(doc) && !confirm(t('closeConfirm', { name: doc.name }))) {
    return;
  }
  await removeDoc(doc);
}

// Move the active document's file to the trash (the Delete of CRUD), then drop
// it from the session. Recoverable from the system Trash if it was a mistake.
async function deleteActive() {
  if (!active || !active.path) return;
  const doc = active;
  const ok = await confirmDialog(t('deleteConfirm', { name: doc.name }), {
    title: t('deleteTitle'),
    kind: 'warning',
    okLabel: t('deleteOk'),
    cancelLabel: t('cancel'),
  });
  if (!ok) return;
  try {
    await invoke('delete_file', { path: doc.path });
  } catch (e) {
    filepath.textContent = t('deleteFailed', { e: String(e) });
    return;
  }
  await removeDoc(doc);
  // Refresh the recent list (the backend dropped the deleted path).
  invoke<string[]>('get_recent_files').then(renderRecent).catch(() => {});
}

// Create a new, empty "untitled" document and start editing it.
function newDoc() {
  untitledCount++;
  const name = untitledCount === 1 ? 'untitled' : `untitled ${untitledCount}`;
  const doc: Doc = { path: null, name, savedSource: '', workingText: '', mtime: 0 };
  docs.push(doc);
  active = doc;
  lastActiveDirty = false;
  editor.value = '';
  renderSource('', '');
  showDocUI();
  setEditing(true);
  updateStatus();
  renderSidebar();
  renderTree();
  saveSession();
  contentArea.scrollTop = 0;
}

// Write the active document to `path`, switch it to that file, and refresh
// all the UI/session state that depends on the saved location.
async function persistTo(path: string) {
  if (!active) return;
  const saved = active.workingText;
  try {
    await invoke('save_file', { path, content: saved });
  } catch (e) {
    filepath.textContent = t('saveFailed', { e: String(e) });
    return;
  }

  // Local History: record this saved version (out of band — a history failure
  // must never break a successful save). The backend dedupes and prunes; refresh
  // an open panel only once the snapshot is actually written.
  invoke('snapshot_version', { path, content: saved })
    .then(() => {
      if (historyPanelOpen && active?.path === path) refreshHistory();
    })
    .catch(() => {});

  active.path = path;
  active.name = basename(path);
  active.savedSource = active.workingText;
  active.mtime = await invoke<number>('file_mtime', { path }).catch(() => 0);
  lastActiveDirty = false;
  updateStatus();
  renderSidebar();
  saveSession();
  invoke<string[]>('add_recent_file', { path }).then(renderRecent).catch(() => {});
}

// Default name offered in the save dialog: an untitled doc's first heading,
// otherwise the current file/buffer name.
function suggestedSaveName(): string {
  if (!active) return 'untitled.md';
  if (active.path) return basename(active.path);
  const title = firstHeadingTitle(active.workingText);
  return `${title ? sanitizeFilename(title) : active.name}.md`;
}

async function save() {
  if (!active) return;
  // Titled doc with no changes: nothing to do. Untitled always offers a save.
  if (active.path && !isDirty(active)) return;
  // The file moved under us. Writing now would destroy whatever did it — which
  // is precisely the bug this exists to prevent — so make the choice explicit.
  if (active.conflict) {
    updateConflictBanner();
    conflictBar.scrollIntoView({ block: 'nearest' });
    return;
  }

  let path = active.path;
  if (!path) {
    const chosen = await saveDialog({
      defaultPath: suggestedSaveName(),
      filters: [{ name: 'Markdown', extensions: SUPPORTED }]
    });
    if (!chosen) return; // cancelled
    path = chosen;
  }
  await persistTo(path);
}

// Save As: always prompt for a new location and switch the document to it.
async function saveAs() {
  if (!active) return;
  const chosen = await saveDialog({
    defaultPath: suggestedSaveName(),
    filters: [{ name: 'Markdown', extensions: SUPPORTED }]
  });
  if (!chosen) return; // cancelled
  await persistTo(chosen);
}

// Re-read the active document from disk into the editor and preview.
async function refreshActiveFromDisk(preserveScroll: boolean) {
  if (!active || !active.path) return;
  const content = await invoke<string>('read_file', { path: active.path }).catch(() => null);
  if (content == null) return;
  const scrollTop = contentArea.scrollTop;
  active.savedSource = content;
  active.workingText = content;
  editor.value = content;
  active.mtime = await invoke<number>('file_mtime', { path: active.path }).catch(() => 0);
  lastActiveDirty = false;
  await renderSource(content, active.path);
  updateStatus();
  renderSidebar();
  if (preserveScroll) contentArea.scrollTop = scrollTop;
}

// Re-read from disk, but never silently discard unsaved edits.
async function reload() {
  if (!active || !active.path || isDirty(active)) return;
  await refreshActiveFromDisk(true);
}

// --- Conflict: the file changed on disk while we held unsaved edits ----------
// This is the case MRDown is for. An agent rewrites the .md you are in the
// middle of editing, and neither version may be thrown away without asking. So:
// snapshot what's on disk into Local History the moment we see it (an agent's
// work is never ours to lose), then stop and let the user decide.

async function noteDiskChange(doc: Doc, mtime: number) {
  const path = doc.path;
  if (!path || doc.conflict?.mtime === mtime) return; // already known

  const content = await invoke<string>('read_file', { path }).catch(() => null);
  if (content === null) return;

  // The two converged on the same text (you typed what the agent wrote, or it
  // rewrote the file with what you already had). Nothing to resolve.
  if (content === doc.workingText) {
    doc.savedSource = content;
    doc.mtime = mtime;
    doc.conflict = null;
    if (doc === active) updateConflictBanner();
    renderSidebar();
    return;
  }

  // Preserve the on-disk version before anything can overwrite it. From here on
  // it is a version in the timeline, recoverable even if the user picks "keep
  // mine" and never looks at it again.
  await invoke('snapshot_version', { path, content }).catch(() => {});
  doc.conflict = { content, mtime };
  if (doc === active) updateConflictBanner();
}

function updateConflictBanner() {
  conflictBar.hidden = !active?.conflict;
}

/** Keep my buffer and write it over the file. The disk version is already in history. */
async function resolveKeepMine() {
  const doc = active;
  if (!doc?.path || !doc.conflict) return;
  doc.mtime = doc.conflict.mtime; // acknowledge what we're overwriting
  doc.conflict = null;
  updateConflictBanner();
  await persistTo(doc.path);
}

/** Take the file as it now stands, dropping my edits — after preserving them. */
async function resolveTakeTheirs() {
  const doc = active;
  if (!doc?.path || !doc.conflict) return;
  // My unsaved edits were never saved, so they exist nowhere else. Snapshot them
  // before they go, or "take theirs" would be the very data loss we're fixing.
  if (isDirty(doc)) {
    await invoke('snapshot_version', { path: doc.path, content: doc.workingText }).catch(() => {});
  }
  doc.conflict = null;
  updateConflictBanner();
  await refreshActiveFromDisk(true);
}

// Recent files are shown in the empty state for quick reopening.
function renderRecent(list: string[]) {
  recentBox.innerHTML = '';
  if (!list || list.length === 0) return;
  const title = document.createElement('div');
  title.className = 'recent-title';
  title.textContent = t('recentTitle');
  recentBox.appendChild(title);
  const ul = document.createElement('ul');
  for (const p of list) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'recent-name';
    name.textContent = basename(p);
    const path = document.createElement('span');
    path.className = 'recent-path';
    // The box is `direction: rtl` so a long path is elided from the left. That
    // flips the leading "/" of a path that fits to the far right, unless the
    // text is bidi-isolated as its own (LTR) run.
    const isolated = document.createElement('bdi');
    isolated.textContent = p;
    path.appendChild(isolated);
    li.append(name, path);
    li.addEventListener('click', () => openFile(p));
    ul.appendChild(li);
  }
  recentBox.appendChild(ul);
}

openBtn.addEventListener('click', async () => {
  const selected = await open({
    multiple: false,
    filters: [{ name: 'Markdown', extensions: SUPPORTED }]
  });
  if (selected) await openFile(selected as string);
});

newBtn.addEventListener('click', newDoc);
reloadBtn.addEventListener('click', reload);
saveBtn.addEventListener('click', save);
deleteBtn.addEventListener('click', deleteActive);
editBtn.addEventListener('click', () => {
  if (active) setEditing(!isEditing);
});

// Live preview while typing, debounced so large documents stay responsive.
let previewTimer: number | undefined;
editor.addEventListener('input', () => {
  if (!active) return;
  active.workingText = editor.value;
  updateStatus();
  if (isDirty(active) !== lastActiveDirty) {
    lastActiveDirty = isDirty(active);
    renderSidebar();
  }
  // Checkpoint the draft so unsaved edits survive a quit/crash.
  scheduleSessionSave();
  // Keep the find count live as the source changes, without moving the caret.
  if (!findBar.hidden && isEditing && findInput.value) refreshSourceMatches();
  clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    if (active) renderSource(active.workingText, active.path ?? '');
  }, 250);
});

// Editor typing niceties: list auto-continue (Enter), list indent (Tab), and
// bracket/quote auto-pairing. Each pure transform returns the new text+selection
// (or null to fall through to the default keypress); applying it through
// replaceEditorText keeps the change on the native undo stack and fires `input`.
editor.addEventListener('keydown', (e) => {
  if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return; // leave IME & shortcuts alone
  const s: Sel = { text: editor.value, start: editor.selectionStart, end: editor.selectionEnd };
  let r: Sel | null = null;
  if (e.key === 'Enter' && !e.shiftKey) r = listContinue(s);
  else if (e.key === 'Tab') r = listIndent(s, e.shiftKey);
  else if (e.key.length === 1) r = autoPair(s, e.key);
  if (r) {
    e.preventDefault();
    replaceEditorText(r.text, r.start, r.end);
  }
});

// Save a pasted image next to the document (in an `assets/` folder) and insert
// a relative `![]()` so the existing image resolver renders it.
async function pasteImage(file: File, docPath: string) {
  try {
    const ext = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1] || 'png';
    const name = `pasted-${Date.now()}.${ext}`;
    const sep = docPath.includes('\\') ? '\\' : '/';
    const abs = `${dirname(docPath)}${sep}assets${sep}${name}`;
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    await invoke('save_image', { path: abs, bytes });
    const s: Sel = { text: editor.value, start: editor.selectionStart, end: editor.selectionEnd };
    const md = `![${s.text.slice(s.start, s.end)}](assets/${name})`;
    const caret = s.start + md.length;
    replaceEditorText(s.text.slice(0, s.start) + md + s.text.slice(s.end), caret, caret);
  } catch (err) {
    console.error('image paste failed', err);
  }
}

// Paste handling: an image is saved and linked; otherwise a URL pasted over a
// selection becomes a Markdown link. Anything else pastes normally.
editor.addEventListener('paste', (e) => {
  const img = [...(e.clipboardData?.items ?? [])].find(
    (it) => it.kind === 'file' && it.type.startsWith('image/')
  );
  if (img) {
    const file = img.getAsFile();
    // Images need a folder to live next to, so only handle a saved document.
    if (file && active?.path) {
      e.preventDefault();
      void pasteImage(file, active.path);
    }
    return;
  }
  const s: Sel = { text: editor.value, start: editor.selectionStart, end: editor.selectionEnd };
  const r = linkFromPaste(s, e.clipboardData?.getData('text') ?? '');
  if (r) {
    e.preventDefault();
    replaceEditorText(r.text, r.start, r.end);
  }
});

// --- Export ---------------------------------------------------------------

// Write the rendered document out as one self-contained HTML file: the preview's
// own CSS, its images and (when there is maths) KaTeX's fonts are all embedded.
async function exportHtml() {
  if (!active) return;
  const article = output.cloneNode(true) as HTMLElement;
  stripFindHighlights(article);
  stripInteractive(article);
  await inlineImages(article);

  const needsKatex = !!article.querySelector('.katex');
  let css = collectCss(needsKatex);
  if (needsKatex) css = await inlineCssUrls(css);

  const title = firstHeadingTitle(active.workingText) || active.name;
  const html = buildExportDocument({
    lang: getLang(),
    title,
    css,
    rootStyle: document.documentElement.getAttribute('style') ?? '',
    body: article.innerHTML,
  });

  const path = await saveDialog({
    defaultPath: `${sanitizeFilename(title)}.html`,
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (!path) return;
  await invoke('export_file', { path, content: html });
}

// PDF goes through the platform's print dialog (macOS: "Save as PDF"), so no
// PDF renderer has to be bundled. The @media print rules strip the app chrome
// and force a light page — a dark PDF is unusable on paper.
async function exportPdf() {
  if (!active) return;
  await invoke('print_document');
}

// Editor ⇄ preview scroll sync (edit mode only). Proportional: match the
// scrolled fraction of one pane onto the other. Exact source-line mapping is
// impractical against a soft-wrapping <textarea>, and proportional tracks well
// for prose (it only drifts around tall images / code blocks). A "driver" pane
// is latched while it scrolls so its echo on the other pane doesn't feed back.
let scrollDriver: HTMLElement | null = null;
let scrollDriverTimer: number | undefined;
function bindScrollSync(from: HTMLElement, to: HTMLElement) {
  from.addEventListener(
    'scroll',
    () => {
      if (!isEditing || (scrollDriver && scrollDriver !== from)) return;
      scrollDriver = from;
      clearTimeout(scrollDriverTimer);
      scrollDriverTimer = window.setTimeout(() => (scrollDriver = null), 120);
      const fromMax = from.scrollHeight - from.clientHeight;
      const toMax = to.scrollHeight - to.clientHeight;
      to.scrollTop = fromMax > 0 ? (from.scrollTop / fromMax) * toMax : 0;
    },
    { passive: true }
  );
}
bindScrollSync(editor, output);
bindScrollSync(output, editor);

// Replace the editor's text through execCommand so the change lands on the
// WebView's native undo stack — assigning `editor.value` directly would wipe
// it, breaking ⌘Z and Edit ▸ Undo. Only the differing middle span is replaced
// (common prefix/suffix preserved). Falls back to a plain assignment if the
// command is unavailable.
function replaceEditorText(newText: string, selStart: number, selEnd: number) {
  const old = editor.value;
  let p = 0;
  while (p < old.length && p < newText.length && old[p] === newText[p]) p++;
  let s = 0;
  while (
    s < old.length - p &&
    s < newText.length - p &&
    old[old.length - 1 - s] === newText[newText.length - 1 - s]
  ) {
    s++;
  }
  editor.focus();
  editor.setSelectionRange(p, old.length - s);
  if (!document.execCommand('insertText', false, newText.slice(p, newText.length - s))) {
    editor.value = newText;
  }
  editor.setSelectionRange(selStart, selEnd);
}

// All Markdown formatting actions the toolbar can offer. `group` drives the
// visual separators (inline vs. block) and the grouping in Settings; `run`
// transforms the current selection. Registry order is the display order.
interface FmtAction {
  id: string;
  titleKey: 'fmtBold' | 'fmtItalic' | 'fmtStrike' | 'fmtCode' | 'fmtLink' | 'fmtImage'
    | 'fmtHeading' | 'fmtList' | 'fmtOrdered' | 'fmtChecklist' | 'fmtQuote'
    | 'fmtCodeblock' | 'fmtTable' | 'fmtHr';
  group: 'inline' | 'block';
  svg: string;
  run: (s: Sel) => Sel;
}

const ICON =
  (paths: string, attrs = 'fill="none" stroke="currentColor" stroke-width="2"') =>
    `<svg viewBox="0 0 24 24" ${attrs}>${paths}</svg>`;

const FMT_ACTIONS: FmtAction[] = [
  { id: 'bold', titleKey: 'fmtBold', group: 'inline',
    svg: ICON('<path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/>'),
    run: (s) => toggleWrap(s, '**') },
  { id: 'italic', titleKey: 'fmtItalic', group: 'inline',
    svg: ICON('<line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>'),
    run: (s) => toggleWrap(s, '*') },
  { id: 'strike', titleKey: 'fmtStrike', group: 'inline',
    svg: ICON('<path d="M16 5H9a3 3 0 0 0-2.8 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/>'),
    run: (s) => toggleWrap(s, '~~') },
  { id: 'code', titleKey: 'fmtCode', group: 'inline',
    svg: ICON('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'),
    run: (s) => toggleWrap(s, '`') },
  { id: 'link', titleKey: 'fmtLink', group: 'inline',
    svg: ICON('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
    run: (s) => insertLink(s) },
  { id: 'image', titleKey: 'fmtImage', group: 'inline',
    svg: ICON('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>'),
    run: (s) => insertImage(s) },
  { id: 'heading', titleKey: 'fmtHeading', group: 'block',
    svg: ICON('<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>'),
    run: (s) => toggleLinePrefix(s, '# ', /^#{1,6} /) },
  { id: 'list', titleKey: 'fmtList', group: 'block',
    svg: ICON('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>'),
    run: (s) => toggleLinePrefix(s, '- ', /^[-*+] /) },
  { id: 'ordered', titleKey: 'fmtOrdered', group: 'block',
    svg: ICON('<line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18v-1a1 1 0 0 0-2 0M4 18h2"/>'),
    run: (s) => toggleLinePrefix(s, '1. ', /^\d+\. /) },
  { id: 'checklist', titleKey: 'fmtChecklist', group: 'block',
    svg: ICON('<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),
    run: (s) => toggleLinePrefix(s, '- [ ] ', /^[-*+] \[[ xX]\] /) },
  { id: 'quote', titleKey: 'fmtQuote', group: 'block',
    svg: ICON('<path d="M7 17h3l2-4V7H6v6h3zm8 0h3l2-4V7h-6v6h3z"/>', 'fill="currentColor" stroke="none"'),
    run: (s) => toggleLinePrefix(s, '> ', /^> /) },
  { id: 'codeblock', titleKey: 'fmtCodeblock', group: 'block',
    svg: ICON('<rect x="3" y="4" width="18" height="16" rx="2"/><polyline points="9 9 7 12 9 15"/><polyline points="15 9 17 12 15 15"/>'),
    run: (s) => insertFence(s) },
  { id: 'table', titleKey: 'fmtTable', group: 'block',
    svg: ICON('<rect x="3" y="3" width="18" height="18" rx="1"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>'),
    run: (s) => insertTable(s) },
  { id: 'hr', titleKey: 'fmtHr', group: 'block',
    svg: ICON('<line x1="3" y1="12" x2="21" y2="12"/>'),
    run: (s) => insertHr(s) },
];
const FMT_BY_ID = new Map(FMT_ACTIONS.map((a) => [a.id, a]));
const FMT_DEFAULT = ['heading', 'bold', 'italic', 'code', 'list', 'quote', 'link'];
const groupLabel = (g: FmtAction['group']) => t(g === 'inline' ? 'groupInline' : 'groupBlock');

// Which buttons the user has chosen to show, persisted across sessions and
// always kept in registry order.
const TOOLBAR_KEY = 'mrdown.toolbar';
function enabledIds(): string[] {
  const raw = localStorage.getItem(TOOLBAR_KEY);
  if (raw) {
    try {
      const ids = JSON.parse(raw);
      if (Array.isArray(ids)) return FMT_ACTIONS.filter((a) => ids.includes(a.id)).map((a) => a.id);
    } catch {
      // fall through to default
    }
  }
  return FMT_DEFAULT;
}

function renderFormatBar() {
  const enabled = new Set(enabledIds());
  formatBar.innerHTML = '';
  let prevGroup: string | null = null;
  for (const a of FMT_ACTIONS) {
    if (!enabled.has(a.id)) continue;
    if (prevGroup && a.group !== prevGroup) {
      const sep = document.createElement('span');
      sep.className = 'format-sep';
      formatBar.appendChild(sep);
    }
    prevGroup = a.group;
    const btn = document.createElement('button');
    btn.dataset.fmt = a.id;
    const key = a.id === 'bold' ? ' (⌘B)' : a.id === 'italic' ? ' (⌘I)' : '';
    btn.title = t(a.titleKey) + key;
    btn.innerHTML = a.svg;
    formatBar.appendChild(btn);
  }
}

// Apply a Markdown formatting action to the editor's current selection, then
// re-sync the model and preview as if the text had been typed.
function applyFmt(id: string) {
  if (!active) return;
  const action = FMT_BY_ID.get(id);
  if (!action) return;
  if (!isEditing) setEditing(true);
  const before: Sel = { text: editor.value, start: editor.selectionStart, end: editor.selectionEnd };
  const after = action.run(before);
  replaceEditorText(after.text, after.start, after.end);
  active.workingText = editor.value;
  updateStatus();
  if (isDirty(active) !== lastActiveDirty) {
    lastActiveDirty = isDirty(active);
    renderSidebar();
  }
  scheduleSessionSave();
  renderSource(active.workingText, active.path ?? '');
}

formatBar.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  const kind = btn?.dataset.fmt;
  if (kind) applyFmt(kind);
});

// --- Settings (⌘,): customise which formatting buttons show ---

function buildToolbarOptions() {
  const enabled = new Set(enabledIds());
  toolbarOptions.innerHTML = '';
  let prevGroup: string | null = null;
  for (const a of FMT_ACTIONS) {
    if (a.group !== prevGroup) {
      const head = document.createElement('div');
      head.className = 'opt-group-title';
      head.textContent = groupLabel(a.group);
      toolbarOptions.appendChild(head);
      prevGroup = a.group;
    }
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = enabled.has(a.id);
    cb.addEventListener('change', () => {
      const next = FMT_ACTIONS.filter((x) =>
        x.id === a.id ? cb.checked : enabled.has(x.id)
      ).map((x) => x.id);
      enabled.clear();
      next.forEach((id) => enabled.add(id));
      localStorage.setItem(TOOLBAR_KEY, JSON.stringify(next));
      renderFormatBar();
    });
    const icon = document.createElement('span');
    icon.className = 'opt-icon';
    icon.innerHTML = a.svg;
    const name = document.createElement('span');
    name.textContent = t(a.titleKey);
    label.append(cb, icon, name);
    toolbarOptions.appendChild(label);
  }
}

// Preview width: a slider from a readable column up to full width. The slider's
// top maps to the actual content-area width (so the whole travel is meaningful
// on any window size) and means "no limit"; anything below centres a fixed-width
// column. Stored in localStorage as a pixel number or 'full'; defaults to full.
const WIDTH_KEY = 'mrdown.previewWidth';
const WIDTH_MIN = 480;
const WIDTH_STEP = 20;
type PreviewWidth = number | 'full';

function storedWidth(): PreviewWidth {
  const raw = localStorage.getItem(WIDTH_KEY);
  if (raw === null || raw === 'full') return 'full';
  const n = Number(raw);
  return Number.isFinite(n) && n >= WIDTH_MIN ? n : 'full';
}

function applyPreviewWidth(val: PreviewWidth) {
  document.documentElement.style.setProperty('--preview-width', val === 'full' ? 'none' : `${val}px`);
}

function buildWidthOption() {
  // Largest useful column: the content area minus its horizontal padding.
  const maxW = Math.max(WIDTH_MIN + WIDTH_STEP, Math.round(contentArea.clientWidth) - 80);
  const stored = storedWidth();
  const current = stored === 'full' ? maxW : Math.min(stored, maxW);
  const atFull = (v: number) => v >= maxW;
  const label = (v: number) => (atFull(v) ? t('widthFull') : `${v}px`);

  widthOption.innerHTML = '';
  const value = document.createElement('div');
  value.className = 'width-value';
  value.textContent = label(current);
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(WIDTH_MIN);
  slider.max = String(maxW);
  slider.step = String(WIDTH_STEP);
  slider.value = String(current);
  slider.addEventListener('input', () => {
    const v = Number(slider.value);
    const next: PreviewWidth = atFull(v) ? 'full' : v;
    value.textContent = label(v);
    localStorage.setItem(WIDTH_KEY, String(next));
    applyPreviewWidth(next);
  });
  widthOption.append(value, slider);
}

// Outline placement: its own column on the right, or stacked in the sidebar.
function buildOutlinePosOption() {
  const choices: Array<{ value: OutlinePos; label: string }> = [
    { value: 'right', label: t('outlinePosRight') },
    { value: 'left', label: t('outlinePosLeft') },
  ];
  outlinePosOption.innerHTML = '';
  for (const c of choices) {
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'outline-pos';
    radio.checked = c.value === outlinePos;
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      outlinePos = c.value;
      localStorage.setItem(OUTLINE_POS_KEY, c.value);
      applyOutlinePos();
    });
    const name = document.createElement('span');
    name.textContent = c.label;
    label.append(radio, name);
    outlinePosOption.appendChild(label);
  }
}

// Language picker: System (follow the OS) / 日本語 / English.
function buildLangOptions() {
  const choices: Array<{ value: Lang | 'system'; label: string }> = [
    { value: 'system', label: t('langSystem') },
    { value: 'ja', label: '日本語' },
    { value: 'en', label: 'English' },
  ];
  const current: Lang | 'system' = isSystemLang() ? 'system' : getLang();
  langOptions.innerHTML = '';
  for (const c of choices) {
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'lang';
    radio.checked = c.value === current;
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      setLang(c.value);
      applyI18n();
    });
    const name = document.createElement('span');
    name.textContent = c.label;
    label.append(radio, name);
    langOptions.appendChild(label);
  }
}

// --- Appearance: accent colour, reading background/text, content font & size.
// Each override is stored as a value in localStorage and applied as an inline
// custom property on <html>; a missing key means "use the default", which we
// express by clearing the inline property so the stylesheet's :root value wins
// (System accent, dark background, the SF stack, 16px). The derived surface and
// hover tokens in styles.css are computed from these, so they follow along. ---
const ACCENT_KEY = 'mrdown.accent';
const BG_KEY = 'mrdown.bg';
const TEXT_KEY = 'mrdown.text';
const FONT_KEY = 'mrdown.contentFont';
const FONTSIZE_KEY = 'mrdown.contentSize';

// Preset swatches. Accent mirrors the macOS accent choices; background/text are
// a few coherent pairings, but any two can be combined (or a custom colour set).
const ACCENT_PRESETS = ['#007aff', '#bf5af2', '#ff2d55', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#8e8e93'];
const BG_PRESETS = ['#1e1e1e', '#000000', '#282c34', '#f4ecd8', '#ffffff'];
const TEXT_PRESETS = ['#d4d4d4', '#ffffff', '#c9d1d9', '#5b4636', '#24292f'];

const FONT_CHOICES: Array<{ id: string; labelKey: Key; stack: string }> = [
  { id: 'system', labelKey: 'fontSystem', stack: '' },
  { id: 'serif', labelKey: 'fontSerif', stack: "'New York', 'Iowan Old Style', Georgia, 'Times New Roman', serif" },
  { id: 'rounded', labelKey: 'fontRounded', stack: "'SF Pro Rounded', ui-rounded, 'Hiragino Maru Gothic ProN', -apple-system, sans-serif" },
];
const FONTSIZE_MIN = 13;
const FONTSIZE_MAX = 22;
const FONTSIZE_DEFAULT = 16;

// Set (or, for null, clear) an inline custom property on the document root.
function applyVar(cssVar: string, value: string | null) {
  if (value === null || value === '') document.documentElement.style.removeProperty(cssVar);
  else document.documentElement.style.setProperty(cssVar, value);
}

// Stored value meaning "follow the macOS accent colour" rather than a fixed hex.
const SYSTEM_ACCENT = 'AccentColor';

// The accent also drives its own foreground. AccentColorText is only a legible
// pairing for AccentColor, so any chosen colour falls back to the white default.
function applyAccent(value: string | null) {
  applyVar('--mrd-accent', value);
  applyVar('--mrd-accent-text', value === SYSTEM_ACCENT ? 'AccentColorText' : null);
}

function applyContentFont(id: string | null) {
  const choice = FONT_CHOICES.find((f) => f.id === id);
  applyVar('--mrd-content-font', choice ? choice.stack : null);
}
function applyContentSize(px: string | null) {
  const n = Number(px);
  applyVar('--mrd-content-size', Number.isFinite(n) && n > 0 ? `${n}px` : null);
}

// Read the persisted appearance overrides and push them onto <html>. Called once
// at startup so a customised look is in place before the first document renders.
function applyStoredAppearance() {
  applyAccent(localStorage.getItem(ACCENT_KEY));
  applyVar('--mrd-bg', localStorage.getItem(BG_KEY));
  applyVar('--mrd-text', localStorage.getItem(TEXT_KEY));
  applyContentFont(localStorage.getItem(FONT_KEY));
  applyContentSize(localStorage.getItem(FONTSIZE_KEY));
}

// Build one colour row: a "reset to default" chip, an optional System chip, the
// preset swatches, and a custom picker. `apply` lets the accent row pair the
// foreground colour with its fill; the others just set their variable.
function buildColorOption(
  container: HTMLElement,
  opts: {
    storageKey: string;
    cssVar: string;
    presets: string[];
    resetKey: Key;
    systemKey?: Key;
    apply?: (value: string | null) => void;
  }
) {
  const stored = localStorage.getItem(opts.storageKey); // null => default
  const isPreset = stored !== null && opts.presets.includes(stored);
  const isSystem = stored === SYSTEM_ACCENT;
  const apply = opts.apply ?? ((v: string | null) => applyVar(opts.cssVar, v));
  container.innerHTML = '';

  const select = (value: string | null) => {
    if (value === null) localStorage.removeItem(opts.storageKey);
    else localStorage.setItem(opts.storageKey, value);
    apply(value);
    buildColorOption(container, opts); // re-render to move the selection ring
  };

  const reset = document.createElement('button');
  reset.className = 'color-reset' + (stored === null ? ' selected' : '');
  reset.textContent = t(opts.resetKey);
  reset.addEventListener('click', () => select(null));
  container.appendChild(reset);

  // "System" follows the macOS accent colour — only offered where the WebView
  // understands the AccentColor keyword.
  if (opts.systemKey && CSS.supports('color', 'AccentColor')) {
    const sys = document.createElement('button');
    sys.className = 'color-reset' + (isSystem ? ' selected' : '');
    sys.textContent = t(opts.systemKey);
    sys.addEventListener('click', () => select(SYSTEM_ACCENT));
    container.appendChild(sys);
  }

  for (const c of opts.presets) {
    const sw = document.createElement('button');
    sw.className = 'color-swatch' + (stored === c ? ' selected' : '');
    sw.style.background = c;
    sw.title = c;
    sw.addEventListener('click', () => select(c));
    container.appendChild(sw);
  }

  // Custom picker — selected whenever a stored colour is neither a preset nor System.
  const custom = stored !== null && !isPreset && !isSystem;
  const wrap = document.createElement('label');
  wrap.className = 'color-custom' + (custom ? ' selected has-value' : '');
  wrap.title = t('colorCustom');
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.value = custom ? stored : isPreset ? stored : '#888888';
  if (custom) wrap.style.background = stored;
  picker.addEventListener('input', () => select(picker.value));
  wrap.appendChild(picker);
  container.appendChild(wrap);
}

function buildFontOption() {
  const current = localStorage.getItem(FONT_KEY) ?? 'system';
  fontOption.innerHTML = '';
  for (const f of FONT_CHOICES) {
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'content-font';
    radio.checked = f.id === current;
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      if (f.id === 'system') localStorage.removeItem(FONT_KEY);
      else localStorage.setItem(FONT_KEY, f.id);
      applyContentFont(f.id);
    });
    const name = document.createElement('span');
    name.textContent = t(f.labelKey);
    label.append(radio, name);
    fontOption.appendChild(label);
  }
}

function buildFontSizeOption() {
  const stored = Number(localStorage.getItem(FONTSIZE_KEY));
  const current = Number.isFinite(stored) && stored > 0 ? stored : FONTSIZE_DEFAULT;
  fontsizeOption.innerHTML = '';
  const value = document.createElement('div');
  value.className = 'fontsize-value';
  value.textContent = `${current}px`;
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(FONTSIZE_MIN);
  slider.max = String(FONTSIZE_MAX);
  slider.step = '1';
  slider.value = String(current);
  slider.addEventListener('input', () => {
    const v = Number(slider.value);
    value.textContent = `${v}px`;
    if (v === FONTSIZE_DEFAULT) localStorage.removeItem(FONTSIZE_KEY);
    else localStorage.setItem(FONTSIZE_KEY, String(v));
    applyContentSize(String(v));
  });
  fontsizeOption.append(value, slider);
}

function buildAppearanceOptions() {
  buildColorOption(accentOption, {
    storageKey: ACCENT_KEY,
    cssVar: '--mrd-accent',
    presets: ACCENT_PRESETS,
    resetKey: 'colorDefault',
    systemKey: 'colorSystem',
    apply: applyAccent,
  });
  buildColorOption(bgOption, { storageKey: BG_KEY, cssVar: '--mrd-bg', presets: BG_PRESETS, resetKey: 'colorDefault' });
  buildColorOption(textOption, { storageKey: TEXT_KEY, cssVar: '--mrd-text', presets: TEXT_PRESETS, resetKey: 'colorDefault' });
  buildFontOption();
  buildFontSizeOption();
}

// Re-localise the whole UI: static [data-i18n]/[data-i18n-title] nodes plus the
// pieces built in JS. Called on startup and whenever the language changes.
function applyI18n() {
  document.documentElement.lang = getLang();
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n as Key);
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle as Key);
  });
  document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder as Key);
  });
  renderFormatBar();
  editLabel.textContent = isEditing ? t('preview') : t('edit');
  updateStatus();
  if (active) renderSidebar();
  updateFolderHeader();
  buildToolbarOptions();
  buildLangOptions();
  buildAppearanceOptions();
  buildOutlinePosOption();
  invoke<string[]>('get_recent_files').then(renderRecent).catch(() => {});
  // Keep the native menu in the same language.
  invoke('apply_menu', { lang: getLang() }).catch(() => {});
}

function openSettings() {
  buildToolbarOptions();
  buildLangOptions();
  buildWidthOption();
  buildAppearanceOptions();
  buildOutlinePosOption();
  settingsOverlay.hidden = false;
}
function closeSettings() {
  settingsOverlay.hidden = true;
}

// The bundled notices are Markdown, so show them in the viewer itself.
const licensesBtn = document.getElementById('licenses-btn') as HTMLButtonElement;
licensesBtn.addEventListener('click', async () => {
  const path = await resolveResource('THIRD-PARTY-NOTICES.md').catch(() => null);
  if (!path) return;
  closeSettings();
  await openFile(path, { recent: false });
});

settingsBtn.addEventListener('click', openSettings);
settingsClose.addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) closeSettings();
});

// --- Local History (saved versions, restore) ---

interface Version {
  id: number; // epoch ms, also the snapshot id
  bytes: number;
}

let historyPanelOpen = false;
/** `conflict` shows the three-way view instead of the two-version comparison. */
let historyMode: 'versions' | 'conflict' = 'versions';

// Human-friendly relative time ("3 minutes ago"), localized via the OS locale.
function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const rtf = new Intl.RelativeTimeFormat(getLang(), { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86400000],
    ['hour', 3600000],
    ['minute', 60000],
  ];
  for (const [unit, span] of units) {
    if (diff >= span) return rtf.format(-Math.floor(diff / span), unit);
  }
  return rtf.format(0, 'second'); // "now"
}

// Everything you might compare is a "version" of the file, and they all go in
// one list: the snapshots, the working buffer, and — when the file is in a Git
// repository — its content at HEAD. That's what makes Git diff cheap: it's not
// another feature, it's another version handed to the same renderer.
const CURRENT: 'current' = 'current';
const HEAD: 'head' = 'head';
type Pick = number | typeof CURRENT | typeof HEAD;

/** The two versions being compared: `base` on the left, `compare` on the right. */
let basePick: Pick | null = null;
let comparePick: Pick = CURRENT;
/** The open document's content at HEAD; null when there's no Git to ask. */
let headContent: string | null = null;

async function contentOf(pick: Pick): Promise<string | null> {
  if (pick === CURRENT) return active?.workingText ?? null;
  if (pick === HEAD) return headContent;
  const path = active?.path;
  if (!path) return null;
  return invoke<string>('read_version', { path, id: pick }).catch(() => null);
}

function labelOf(pick: Pick): string {
  if (pick === CURRENT) return t('historyCurrent');
  if (pick === HEAD) return t('gitHead');
  // The clock time is what tells two versions apart: relative time alone rounds
  // to the day, so every save from yesterday reads "yesterday" and the list
  // stops being a list of distinct things.
  const clock = new Date(pick).toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit' });
  return `${relativeTime(pick)} ${clock}`;
}

async function refreshHistory() {
  const path = active?.path;
  // In conflict mode the panel is showing three columns and no version picker;
  // a save landing in the background must not redraw it as a two-way diff.
  if (!path || historyMode === 'conflict') return;
  const [versions, head] = await Promise.all([
    invoke<Version[]>('list_versions', { path }).catch(() => []),
    // Null for every ordinary reason — no Git, not a repo, no commits, or the
    // file is untracked — and none of them is an error worth showing.
    invoke<string | null>('git_head_content', { path }).catch(() => null),
  ]);
  headContent = head;
  historyList.innerHTML = '';

  // A file with no snapshots can still have a HEAD to compare against, which is
  // exactly the case for a document you've opened from a repo but never saved.
  if (versions.length === 0 && headContent === null) {
    const li = document.createElement('li');
    li.className = 'history-empty';
    li.textContent = t('historyEmpty');
    historyList.appendChild(li);
    historyDiff.innerHTML = '';
    diffTitle.textContent = '';
    diffStatsEl.textContent = '';
    historyRestore.disabled = true;
    basePick = null;
    return;
  }

  const picks: Pick[] = [
    CURRENT,
    ...(headContent === null ? [] : [HEAD]),
    ...versions.map((v) => v.id),
  ];
  // Default: the newest snapshot against the working buffer — "what have I
  // changed since I last saved?". But a save *is* a snapshot, so right after one
  // those two are the same text and that default answers with an empty diff. In
  // that case step back one version, and the panel opens on "what did that save
  // change?" instead — still a question, still an answer. With no snapshots at
  // all, HEAD is the only thing to stand on.
  if (basePick === null || !picks.includes(basePick)) {
    const clean = active && !isDirty(active);
    basePick = (clean && versions[1]?.id) || versions[0]?.id || HEAD;
  }
  if (!picks.includes(comparePick)) comparePick = CURRENT;

  for (const pick of picks) {
    const li = document.createElement('li');
    if (typeof pick === 'number') li.title = new Date(pick).toLocaleString(getLang());

    const base = document.createElement('input');
    base.type = 'radio';
    base.name = 'diff-base';
    base.checked = pick === basePick;
    base.addEventListener('change', () => setPick('base', pick));

    const cmp = document.createElement('input');
    cmp.type = 'radio';
    cmp.name = 'diff-compare';
    cmp.checked = pick === comparePick;
    cmp.addEventListener('change', () => setPick('compare', pick));

    const when = document.createElement('span');
    when.className = 'history-when';
    when.textContent = labelOf(pick);
    if (pick === CURRENT) when.classList.add('is-current');
    if (pick === HEAD) when.classList.add('is-head');

    li.append(when, base, cmp);
    historyList.appendChild(li);
  }

  await renderDiff();
}

/**
 * Move one end of the comparison. Picking the version that already holds the
 * other end would ask for a diff of something against itself, so that end steps
 * aside instead of the click being silently ignored.
 */
function setPick(end: 'base' | 'compare', pick: Pick) {
  if (end === 'base') {
    if (comparePick === pick) comparePick = basePick ?? CURRENT;
    basePick = pick;
  } else {
    if (basePick === pick) basePick = comparePick;
    comparePick = pick;
  }
  refreshHistory();
}

function segmentsTo(el: HTMLElement, segs: Seg[]) {
  for (const seg of segs) {
    if (!seg.changed) {
      el.append(seg.text);
      continue;
    }
    const mark = document.createElement('span');
    mark.className = 'diff-seg';
    mark.textContent = seg.text;
    el.appendChild(mark);
  }
}

function diffRowEl(row: DiffRow): HTMLElement {
  const el = document.createElement('div');
  el.className = `diff-row ${row.type}`;

  const leftNo = document.createElement('span');
  leftNo.className = 'diff-no';
  leftNo.textContent = row.leftNo === null ? '' : String(row.leftNo);
  const left = document.createElement('span');
  left.className = 'diff-line diff-left';

  const rightNo = document.createElement('span');
  rightNo.className = 'diff-no';
  rightNo.textContent = row.rightNo === null ? '' : String(row.rightNo);
  const right = document.createElement('span');
  right.className = 'diff-line diff-right';

  if (row.type === 'mod') {
    // Only the words that actually differ get marked, so a one-word edit in a
    // long paragraph doesn't light up the whole line.
    const segs = inlineSegments(row.left ?? '', row.right ?? '');
    segmentsTo(left, segs.left);
    segmentsTo(right, segs.right);
  } else {
    left.textContent = row.left ?? '';
    right.textContent = row.right ?? '';
  }

  el.append(leftNo, left, rightNo, right);
  return el;
}

async function renderDiff() {
  if (basePick === null) return;
  const [oldText, newText] = await Promise.all([contentOf(basePick), contentOf(comparePick)]);

  diffTitle.textContent = `${labelOf(basePick)} → ${labelOf(comparePick)}`;
  historyDiff.innerHTML = '';

  if (oldText === null || newText === null) {
    diffStatsEl.textContent = '';
    historyDiff.textContent = t('historyReadFailed');
    historyRestore.disabled = true;
    return;
  }

  const rows = sideBySide(oldText, newText);
  const { added, removed } = diffStats(rows);
  diffStatsEl.textContent = added || removed ? `+${added} −${removed}` : '';

  if (!added && !removed) {
    const empty = document.createElement('div');
    empty.className = 'diff-empty';
    empty.textContent = t('diffNoChanges');
    historyDiff.appendChild(empty);
  } else {
    for (const line of foldUnchanged(rows)) {
      if (line.type === 'gap') {
        const gap = document.createElement('div');
        gap.className = 'diff-gap';
        gap.textContent = t('diffGap', { n: String(line.count) });
        historyDiff.appendChild(gap);
      } else {
        historyDiff.appendChild(diffRowEl(line));
      }
    }
  }

  // Restore puts the *base* (the left, older side) back into the buffer — a
  // snapshot, or HEAD, which reverts the document to what was committed. The
  // working buffer isn't a version to go back to, and restoring what's already
  // there would be a no-op. Nothing is written until the user saves either way.
  historyRestore.disabled = basePick === CURRENT || oldText === active?.workingText;
}

// --- Three-way view: last save / on disk / my edits --------------------------
// A two-column diff can't express a conflict, because there is no single
// "before" to compare against. Three columns can: base in the middle of the
// argument, and each side's answer beside it.

function threeCell(text: string | null, changed: boolean, conflict: boolean): HTMLElement {
  const cell = document.createElement('span');
  cell.className = 'diff-line';
  if (text === null) cell.classList.add('void'); // that side has no such line
  else if (conflict) cell.classList.add('clash');
  else if (changed) cell.classList.add('touched');
  cell.textContent = text ?? '';
  return cell;
}

function threeRowEl(row: ThreeRow): HTMLElement {
  const el = document.createElement('div');
  el.className = 'diff-row three';
  if (row.conflict) el.classList.add('conflict');

  const no = (n: number | null) => {
    const span = document.createElement('span');
    span.className = 'diff-no';
    span.textContent = n === null ? '' : String(n);
    return span;
  };

  el.append(
    no(row.baseNo),
    threeCell(row.base, false, false),
    no(row.theirsNo),
    threeCell(row.theirs, row.theirsChanged, row.conflict),
    no(row.oursNo),
    threeCell(row.ours, row.oursChanged, row.conflict),
  );
  return el;
}

function renderThreeWay() {
  const doc = active;
  if (!doc?.conflict) return;

  const rows = threeWay(doc.savedSource, doc.conflict.content, doc.workingText);
  const stats = threeWayStats(rows);

  diffTitle.textContent = doc.name;
  diffStatsEl.textContent = stats.conflicts
    ? t('threeConflicts', { n: String(stats.conflicts) })
    : t('threeNone');
  diffStatsEl.classList.toggle('has-clash', stats.conflicts > 0);

  historyDiff.innerHTML = '';
  historyDiff.classList.add('is-three');

  // Name the columns, and keep the names on screen while scrolling: three
  // columns of near-identical Markdown are unreadable without them.
  const head = document.createElement('div');
  head.className = 'three-head';
  for (const [key, cls] of [
    ['threeBase', ''],
    ['threeTheirs', 'three-head-theirs'],
    ['threeOurs', ''],
  ] as const) {
    head.appendChild(document.createElement('span')); // line-number gutter
    const label = document.createElement('span');
    if (cls) label.className = cls;
    label.textContent = t(key);
    head.appendChild(label);
  }
  historyDiff.appendChild(head);

  for (const line of foldThreeWay(rows)) {
    if (isGap(line)) {
      const gap = document.createElement('div');
      gap.className = 'diff-gap';
      gap.textContent = t('diffGap', { n: String(line.count) });
      historyDiff.appendChild(gap);
    } else {
      historyDiff.appendChild(threeRowEl(line));
    }
  }

  historyRestore.disabled = true;
}

function openHistory(mode: 'versions' | 'conflict' = 'versions') {
  if (!active?.path) return;
  historyPanelOpen = true;
  historyOverlay.hidden = false;
  historyMode = mode === 'conflict' && active.conflict ? 'conflict' : 'versions';
  const three = historyMode === 'conflict';
  historySide.hidden = three;
  historyDiff.classList.toggle('is-three', three);
  historyActions.hidden = three;
  conflictActions.hidden = !three;
  historyPanel.classList.toggle('wide', three); // three columns need the room

  if (historyMode === 'conflict') {
    renderThreeWay();
    return;
  }
  // A fresh open asks the question you almost always have: what changed since
  // the last save? Stale picks from a previous document don't leak in.
  basePick = null;
  comparePick = CURRENT;
  refreshHistory();
}
function closeHistory() {
  historyPanelOpen = false;
  historyOverlay.hidden = true;
}

// Bare `openHistory` would take the click event as its `mode` argument.
historyBtn.addEventListener('click', () => openHistory());
historyClose.addEventListener('click', closeHistory);

// The conflict banner, and the same choices repeated at the foot of the
// three-way view — the point where the user can actually see what they're
// choosing between.
document.getElementById('conflict-view')!.addEventListener('click', () => openHistory('conflict'));
document.getElementById('conflict-mine')!.addEventListener('click', resolveKeepMine);
document.getElementById('conflict-theirs')!.addEventListener('click', resolveTakeTheirs);
document.getElementById('conflict-back')!.addEventListener('click', () => openHistory('versions'));
document.getElementById('conflict-mine2')!.addEventListener('click', async () => {
  await resolveKeepMine();
  closeHistory();
});
document.getElementById('conflict-theirs2')!.addEventListener('click', async () => {
  await resolveTakeTheirs();
  closeHistory();
});
historyOverlay.addEventListener('click', (e) => {
  if (e.target === historyOverlay) closeHistory();
});
historyRestore.addEventListener('click', async () => {
  if (basePick === null || basePick === CURRENT) return;
  const content = await contentOf(basePick);
  if (content === null || !active) return;
  // Non-destructive: load the old version into the working buffer and mark it
  // dirty. Nothing is written until the user saves, so a restore is undoable by
  // simply not saving (or with ⌘Z once we route through the editor).
  active.workingText = content;
  editor.value = content;
  await renderSource(content, active.path ?? '');
  updateStatus();
  renderSidebar();
  saveSession();
  closeHistory();
  if (!isEditing) setEditing(true);
});

// --- In-document find & replace (⌘F) ---
// Two modes driven by `isEditing`: in preview mode we search the rendered pane
// and wrap matches in <mark>s (spanning tag boundaries); in source mode we
// search the editor buffer, select matches in the textarea, and allow replace.
// Both share one matcher (literal/regex, case, whole-word) from ./find.

const FIND_OPTS_KEY = 'mrdown.findOpts';
let findOpts: FindOpts = loadFindOpts();
// The current match list, in the coordinate space of whichever mode is active
// (character offsets into the editor buffer, or into the preview haystack).
let findMatchList: { start: number; end: number }[] = [];
let findIdx = -1;
// Preview marks grouped by match index, so a match split across tags highlights
// (and scrolls) as one unit.
let findMarks: HTMLElement[][] = [];

function loadFindOpts(): FindOpts {
  try {
    const o = JSON.parse(localStorage.getItem(FIND_OPTS_KEY) || '{}');
    return { regex: !!o.regex, caseSensitive: !!o.caseSensitive, wholeWord: !!o.wholeWord };
  } catch {
    return { regex: false, caseSensitive: false, wholeWord: false };
  }
}

// Inline elements don't introduce a text break; anything else does. Used to
// decide where a phrase may legitimately span a tag boundary vs. where two
// blocks should stay separate (so "ab" across two paragraphs isn't a match).
const INLINE_TAGS = new Set([
  'A', 'ABBR', 'B', 'BDI', 'BDO', 'CITE', 'CODE', 'DATA', 'DEL', 'DFN', 'EM', 'I',
  'INS', 'KBD', 'MARK', 'Q', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP',
  'TIME', 'U', 'VAR', 'WBR',
]);
function blockOf(node: Node): Node {
  let el = node.parentElement;
  while (el && el !== output && INLINE_TAGS.has(el.tagName)) el = el.parentElement;
  return el ?? output;
}

// Flatten the preview into one searchable string plus a map back to the source
// text nodes. A newline is inserted between nodes in different blocks so a query
// can span inline tags but never silently merge across block boundaries.
function buildPreviewHay(): { hay: string; segs: { node: Text; start: number }[] } {
  const walker = document.createTreeWalker(output, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const segs: { node: Text; start: number }[] = [];
  let hay = '';
  let prevBlock: Node | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text;
    const block = blockOf(node);
    if (segs.length && block !== prevBlock) hay += '\n';
    segs.push({ node, start: hay.length });
    hay += node.nodeValue as string;
    prevBlock = block;
  }
  return { hay, segs };
}

// Remove any highlight <mark>s, merging their text back into the surrounding node.
function clearFindHighlights() {
  for (const m of output.querySelectorAll('mark.find-hit')) {
    const parent = m.parentNode;
    if (!parent) continue;
    parent.replaceChild(document.createTextNode(m.textContent || ''), m);
    parent.normalize();
  }
  findMarks = [];
}

function updateFindCount() {
  const q = findInput.value;
  const invalid = !!q && buildMatcher(q, findOpts) === null;
  findBar.classList.toggle('no-results', !!q && (invalid || findMatchList.length === 0));
  findCount.textContent = findMatchList.length
    ? `${findIdx + 1}/${findMatchList.length}`
    : q
      ? '0/0'
      : '';
}

// Wrap every preview match in <mark>s, splitting each match across the text
// nodes it touches so tag-spanning matches highlight fully.
function renderPreviewHighlights() {
  clearFindHighlights();
  const matcher = buildMatcher(findInput.value, findOpts);
  const { hay, segs } = buildPreviewHay();
  findMatchList = findMatches(hay, matcher);
  if (!findMatchList.length) return;

  const perNode = new Map<Text, { s: number; e: number; mid: number }[]>();
  for (const slice of sliceMatches(segs.map((seg) => ({ start: seg.start, len: seg.node.length })), findMatchList)) {
    const node = segs[slice.seg].node;
    let ranges = perNode.get(node);
    if (!ranges) perNode.set(node, (ranges = []));
    ranges.push({ s: slice.s, e: slice.e, mid: slice.mid });
  }

  findMarks = findMatchList.map(() => []);
  for (const [node, ranges] of perNode) {
    ranges.sort((a, b) => a.s - b.s);
    const text = node.nodeValue as string;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const r of ranges) {
      if (r.s > last) frag.appendChild(document.createTextNode(text.slice(last, r.s)));
      const mark = document.createElement('mark');
      mark.className = 'find-hit';
      mark.textContent = text.slice(r.s, r.e);
      frag.appendChild(mark);
      findMarks[r.mid].push(mark);
      last = r.e;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode?.replaceChild(frag, node);
  }
}

function setCurrentPreview(scroll = true) {
  findMarks.forEach((marks, i) => {
    for (const m of marks) m.classList.toggle('find-hit-current', i === findIdx);
  });
  const cur = findMarks[findIdx]?.[0];
  if (cur && scroll) cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
  updateFindCount();
}

// Scroll the editor so the line containing `pos` sits roughly centered.
function scrollEditorTo(pos: number) {
  const line = editor.value.slice(0, pos).split('\n').length - 1;
  const cs = getComputedStyle(editor);
  const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
  editor.scrollTop = Math.max(0, line * lh - editor.clientHeight / 2);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

// Keep the highlight layer scrolled in lockstep with the textarea.
function syncEditorHighlights() {
  editorHighlights.style.transform = `translateY(${-editor.scrollTop}px)`;
}

// Paint every source match onto the backdrop layer behind the textarea. The
// layer's text is transparent — only the <mark> rects show, under the real
// text. Width is pinned to the textarea's content box so wrapping lines up.
function renderSourceHighlights() {
  if (findBar.hidden || !isEditing) {
    editorHighlights.innerHTML = '';
    return;
  }
  editorHighlights.style.width = `${editor.clientWidth}px`;
  const text = editor.value;
  let html = '';
  let last = 0;
  findMatchList.forEach((m, i) => {
    html += escapeHtml(text.slice(last, m.start));
    const cls = i === findIdx ? 'find-hit find-hit-current' : 'find-hit';
    html += `<mark class="${cls}">${escapeHtml(text.slice(m.start, m.end))}</mark>`;
    last = m.end;
  });
  // Trailing "\n" keeps the layer's height in step with the textarea when the
  // document ends on a newline.
  editorHighlights.innerHTML = html + escapeHtml(text.slice(last)) + '\n';
  syncEditorHighlights();
}

function selectSourceMatch(scroll = true) {
  const mt = findMatchList[findIdx];
  if (mt) {
    editor.setSelectionRange(mt.start, mt.end);
    if (scroll) scrollEditorTo(mt.start);
  }
  renderSourceHighlights();
  updateFindCount();
}

// Recompute source matches without disturbing the caret (used on live edits).
function refreshSourceMatches() {
  findMatchList = findMatches(editor.value, buildMatcher(findInput.value, findOpts));
  if (findIdx >= findMatchList.length) findIdx = findMatchList.length - 1;
  renderSourceHighlights();
  updateFindCount();
}

editor.addEventListener('scroll', syncEditorHighlights);
// The split divider or window can resize the editor; re-pin width/wrapping.
new ResizeObserver(() => {
  if (!findBar.hidden && isEditing) renderSourceHighlights();
}).observe(editor);

// Rebuild the match list for the current query and mode. Keeps the current
// index when asked (e.g. re-run after an edit), otherwise resets to the first.
function runFind(keepIdx = false) {
  const prevIdx = findIdx;
  const source = isEditing;
  findBar.classList.toggle('replace-mode', source);
  if (source) {
    clearFindHighlights();
    findMatchList = findMatches(editor.value, buildMatcher(findInput.value, findOpts));
  } else {
    editorHighlights.innerHTML = '';
    renderPreviewHighlights();
  }
  if (findMatchList.length) {
    findIdx = keepIdx ? Math.min(Math.max(prevIdx, 0), findMatchList.length - 1) : 0;
    if (source) selectSourceMatch(!keepIdx);
    else setCurrentPreview(!keepIdx);
  } else {
    findIdx = -1;
    if (source) renderSourceHighlights();
    updateFindCount();
  }
}

function stepFind(dir: 1 | -1) {
  if (!findMatchList.length) return;
  findIdx = (findIdx + dir + findMatchList.length) % findMatchList.length;
  if (isEditing) selectSourceMatch();
  else setCurrentPreview();
}

// Push replaced text into the editor via the shared helper so it lands on the
// native undo stack, then update state and re-render the preview.
function applyEditorReplace(newText: string, caret = 0) {
  if (!active) return;
  replaceEditorText(newText, caret, caret);
  active.workingText = editor.value;
  updateStatus();
  if (isDirty(active) !== lastActiveDirty) {
    lastActiveDirty = isDirty(active);
    renderSidebar();
  }
  scheduleSessionSave();
  renderSource(active.workingText, active.path ?? '');
}

// For regex mode, expand $1/$& in the replacement against the matched text;
// literal mode inserts the replacement verbatim.
function expandReplacement(matched: string, matcher: RegExp, replacement: string): string {
  if (!findOpts.regex) return replacement;
  return matched.replace(new RegExp(matcher.source, matcher.flags.replace('g', '')), replacement);
}

function doReplaceOne() {
  if (!isEditing || !active) return;
  const matcher = buildMatcher(findInput.value, findOpts);
  const mt = findMatchList[findIdx];
  if (!matcher || !mt) return;
  const text = editor.value;
  const rep = expandReplacement(text.slice(mt.start, mt.end), matcher, replaceInput.value);
  const caret = mt.start + rep.length;
  applyEditorReplace(text.slice(0, mt.start) + rep + text.slice(mt.end), caret);
  // Recompute and jump to the next match at or after the replacement.
  findMatchList = findMatches(editor.value, matcher);
  findIdx = findMatchList.findIndex((m) => m.start >= caret);
  if (findIdx < 0) findIdx = findMatchList.length ? 0 : -1;
  if (findIdx >= 0) selectSourceMatch();
  else updateFindCount();
}

function doReplaceAll() {
  if (!isEditing || !active) return;
  const matcher = buildMatcher(findInput.value, findOpts);
  if (!matcher) return;
  const text = editor.value;
  const newText = findOpts.regex
    ? text.replace(matcher, replaceInput.value)
    : text.replace(matcher, () => replaceInput.value);
  if (newText === text) return;
  applyEditorReplace(newText);
  findMatchList = findMatches(editor.value, buildMatcher(findInput.value, findOpts));
  findIdx = findMatchList.length ? 0 : -1;
  if (findIdx >= 0) selectSourceMatch(false);
  else updateFindCount();
}

function reflectOpts() {
  optCaseBtn.classList.toggle('active', findOpts.caseSensitive);
  optWordBtn.classList.toggle('active', findOpts.wholeWord);
  optRegexBtn.classList.toggle('active', findOpts.regex);
}
function toggleOpt(key: keyof FindOpts) {
  findOpts[key] = !findOpts[key];
  localStorage.setItem(FIND_OPTS_KEY, JSON.stringify(findOpts));
  reflectOpts();
  runFind();
  findInput.focus();
}

function openFind() {
  if (!active) return;
  findBar.hidden = false;
  reflectOpts();
  findInput.focus();
  findInput.select();
  runFind();
}

function closeFind() {
  findBar.hidden = true;
  clearFindHighlights();
  editorHighlights.innerHTML = '';
  findMatchList = [];
  findIdx = -1;
  if (isEditing) editor.focus();
}

findInput.addEventListener('input', () => runFind());
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    stepFind(e.shiftKey ? -1 : 1);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeFind();
  }
});
replaceInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    doReplaceOne();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeFind();
  }
});
findPrevBtn.addEventListener('click', () => stepFind(-1));
findNextBtn.addEventListener('click', () => stepFind(1));
findCloseBtn.addEventListener('click', closeFind);
replaceOneBtn.addEventListener('click', doReplaceOne);
replaceAllBtn.addEventListener('click', doReplaceAll);
optCaseBtn.addEventListener('click', () => toggleOpt('caseSensitive'));
optWordBtn.addEventListener('click', () => toggleOpt('wholeWord'));
optRegexBtn.addEventListener('click', () => toggleOpt('regex'));

applyI18n();
applyPreviewWidth(storedWidth());
applyStoredAppearance();

// --- Sidebar visibility (default shown, persisted when hidden) ---
const SIDEBAR_KEY = 'mrdown.sidebar';
document.body.classList.toggle('sidebar-hidden', localStorage.getItem(SIDEBAR_KEY) === 'hidden');

// Outline: same deal — placement and visibility are both restored here (⌘2 and
// View ▸ Outline toggle it; Settings ▸ Appearance moves it).
applyOutlinePos();
applyOutlineHidden();
sidebarBtn.addEventListener('click', () => {
  const hidden = !document.body.classList.contains('sidebar-hidden');
  document.body.classList.toggle('sidebar-hidden', hidden);
  localStorage.setItem(SIDEBAR_KEY, hidden ? 'hidden' : 'shown');
});

// Most shortcuts (⌘N/O/S/R/W/E/1/,) are owned by the native menu accelerators
// now; only editor-context keys that no menu item claims live here.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !historyOverlay.hidden) {
    closeHistory();
    return;
  }
  if (e.key === 'Escape' && !settingsOverlay.hidden) {
    closeSettings();
    return;
  }
  if (e.key === 'Escape' && !findBar.hidden) {
    closeFind();
    return;
  }
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  if (e.key === 'f' && active) {
    e.preventDefault();
    openFind();
    return;
  }
  if (e.key === 'b' && active && isEditing) {
    e.preventDefault();
    applyFmt('bold');
  } else if (e.key === 'i' && active && isEditing) {
    e.preventDefault();
    applyFmt('italic');
  } else if (e.key === 'Backspace' && active?.path && document.activeElement !== editor) {
    // ⌘⌫ trashes the file — but only outside the editor, where it would
    // otherwise be the native "delete to start of line".
    e.preventDefault();
    deleteActive();
  }
});

// Keep clicks inside the document: internal anchors scroll, links to local
// Markdown files open in the app, everything else opens in the default browser,
// so the webview never navigates away from the app.
output.addEventListener('click', async (e) => {
  const anchor = (e.target as HTMLElement).closest('a');
  if (!anchor) return;
  const href = anchor.getAttribute('href');
  if (!href) return;
  e.preventDefault();
  if (href.startsWith('#')) {
    const target = document.getElementById(decodeURIComponent(href.slice(1)));
    target?.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  // A relative/absolute link to a local Markdown file we can open resolves
  // against the active document's folder and opens in-app; anything else
  // (remote URLs, mailto, non-Markdown files) goes to the default handler.
  const localDoc = active?.path ? resolveDocLink(active.path, href) : null;
  if (localDoc) {
    await openFile(localDoc);
  } else {
    await openUrl(href);
  }
});

// Draggable split: drag the divider to resize the editor/preview panes,
// persisting the ratio across sessions.
const SPLIT_KEY = 'mrdown.split';
const savedSplit = localStorage.getItem(SPLIT_KEY);
if (savedSplit) contentArea.style.setProperty('--split', savedSplit);

divider.addEventListener('mousedown', (e) => {
  e.preventDefault();
  contentArea.classList.add('resizing');
  const onMove = (ev: MouseEvent) => {
    const rect = contentArea.getBoundingClientRect();
    const pct = Math.min(80, Math.max(20, ((ev.clientX - rect.left) / rect.width) * 100));
    contentArea.style.setProperty('--split', `${pct}%`);
  };
  const onUp = () => {
    contentArea.classList.remove('resizing');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    const value = contentArea.style.getPropertyValue('--split');
    if (value) localStorage.setItem(SPLIT_KEY, value);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

// Drag a Markdown file onto the window to open it.
getCurrentWebview().onDragDropEvent((event) => {
  const p = event.payload;
  if (p.type === 'enter' || p.type === 'over') {
    contentArea.classList.add('drag-over');
  } else if (p.type === 'drop') {
    contentArea.classList.remove('drag-over');
    for (const file of p.paths.filter(isSupported)) openFile(file);
  } else {
    contentArea.classList.remove('drag-over');
  }
});

// Watch the active file on disk. With nothing in flight we just re-render the
// new content. With unsaved edits — or with the editor open — we can't: the file
// and the buffer have diverged, and picking a winner is the user's call, so it
// becomes a conflict rather than a silent reload or a silent overwrite.
setInterval(async () => {
  const doc = active;
  if (!doc?.path) return;
  try {
    const m = await invoke<number>('file_mtime', { path: doc.path });
    if (m <= doc.mtime) return;
    if (!isEditing && !isDirty(doc)) await refreshActiveFromDisk(true);
    else await noteDiskChange(doc, m);
  } catch {
    // File may have been moved/removed; leave the last render in place.
  }
}, 1500);

// A document's persisted form (see saveSession).
interface StoredDoc {
  path: string | null;
  name: string;
  workingText: string;
  savedSource: string;
  mtime: number;
}

// New untitled documents are numbered "untitled", "untitled 2", …; recover the
// index from a name so restored buffers keep their number and new ones don't collide.
function untitledIndex(name: string): number {
  if (name === 'untitled') return 1;
  const m = /^untitled (\d+)$/.exec(name);
  return m ? Number(m[1]) : 0;
}

// Restore the previous session, then handle a file the app was launched with.
// Untitled buffers and unsaved edits are brought back verbatim; on-disk files
// are re-read so external changes show, unless there's a draft to preserve.
async function restoreSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return;
  let data: { docs?: StoredDoc[]; activeIndex?: number; paths?: string[]; active?: string | null };
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }

  // Upgrade a legacy session (paths only) to the per-document shape; empty
  // working/saved text means "not a draft", so it re-reads cleanly from disk.
  const stored: StoredDoc[] = Array.isArray(data.docs)
    ? data.docs
    : (data.paths ?? []).map((p) => ({ path: p, name: basename(p), workingText: '', savedSource: '', mtime: 0 }));

  let activeDoc: Doc | null = null;

  // Number a rescued draft above every existing untitled buffer so the name
  // (and any later save) never collides with a real untitled document.
  let nextUntitled = 0;
  for (const s of stored) {
    if (s.path == null) nextUntitled = Math.max(nextUntitled, untitledIndex(s.name));
  }
  const newUntitledName = () => {
    nextUntitled += 1;
    return nextUntitled === 1 ? 'untitled' : `untitled ${nextUntitled}`;
  };

  for (let i = 0; i < stored.length; i++) {
    const s = stored[i];
    const hadDraft = s.workingText !== s.savedSource;
    let doc: Doc | null = null;

    if (s.path == null) {
      // Untitled buffer: nothing on disk, so bring the draft back as-is.
      doc = { path: null, name: s.name, savedSource: s.savedSource, workingText: s.workingText, mtime: 0 };
    } else {
      const disk = await invoke<string>('read_file', { path: s.path }).catch(() => null);
      if (disk == null) {
        // The file is gone. Rescue an unsaved draft as a fresh untitled buffer so
        // the work isn't lost; a clean doc has nothing to preserve, so drop it.
        // A new "untitled" name (not the old basename) keeps it from masquerading
        // as a saved file and avoids a doubled ".md.md" in the save dialog.
        if (hadDraft) {
          doc = { path: null, name: newUntitledName(), savedSource: '', workingText: s.workingText, mtime: 0 };
        }
      } else if (hadDraft) {
        // Keep the unsaved draft over the disk content. Preserve the baseline the
        // user was editing against so the dirty state stays meaningful; auto-reload
        // is paused while dirty, so any newer disk version waits until they resolve it.
        doc = { path: s.path, name: basename(s.path), savedSource: s.savedSource, workingText: s.workingText, mtime: s.mtime };
      } else {
        // No unsaved work: adopt the current disk content (picks up external edits).
        const mtime = await invoke<number>('file_mtime', { path: s.path }).catch(() => 0);
        doc = { path: s.path, name: basename(s.path), savedSource: disk, workingText: disk, mtime };
      }
    }

    if (!doc) continue;
    docs.push(doc);
    if (i === data.activeIndex) activeDoc = doc;
  }

  // Number new untitled docs above anything restored (or rescued) so names never collide.
  untitledCount = Math.max(untitledCount, nextUntitled);

  const target = activeDoc
    ?? docs.find((d) => d.path != null && d.path === data.active)
    ?? docs[0]
    ?? null;
  if (target) {
    active = target;
    lastActiveDirty = isDirty(target);
    editor.value = target.workingText;
    await renderSource(target.workingText, target.path ?? '');
    showDocUI();
    updateStatus();
  }
  renderSidebar();
}

// Runtime opens (app already running) arrive as an event.
listen<string>('open-file', (e) => {
  if (e.payload) openFile(e.payload);
});

// Native menu clicks/accelerators arrive here; map ids to the same actions as
// the toolbar. (Predefined items like Undo/Copy are handled natively.)
listen<string>('menu', (e) => {
  switch (e.payload) {
    case 'new': newDoc(); break;
    case 'open': openBtn.click(); break;
    case 'save': save(); break;
    case 'save_as': saveAs(); break;
    case 'export_html': exportHtml(); break;
    case 'export_pdf': exportPdf(); break;
    case 'reload': reload(); break;
    case 'delete': deleteActive(); break;
    case 'close': if (active) closeDoc(active); break;
    case 'sidebar': sidebarBtn.click(); break;
    case 'outline': toggleOutline(); break;
    case 'edit': if (active) setEditing(!isEditing); break;
    case 'settings': openSettings(); break;
  }
});

// Restore the previous session first, then open any file the app was launched
// with (added on top of / focused within the restored set).
restoreSession().then(() => {
  invoke<string | null>('get_pending_file').then((path) => {
    if (path) openFile(path);
  });
});

// Populate the recent-files list shown in the empty state.
invoke<string[]>('get_recent_files').then(renderRecent).catch(() => {});
