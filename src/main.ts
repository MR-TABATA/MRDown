import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { SUPPORTED, isSupported, basename, resolveImagePath } from './paths';
import { slugify } from './markdown';

const openBtn = document.getElementById('open-btn')!;
const reloadBtn = document.getElementById('reload-btn') as HTMLButtonElement;
const editBtn = document.getElementById('edit-btn') as HTMLButtonElement;
const editLabel = document.getElementById('edit-label')!;
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
const editor = document.getElementById('editor') as HTMLTextAreaElement;
const output = document.getElementById('output')!;
const emptyState = document.getElementById('empty-state')!;
const recentBox = document.getElementById('recent')!;
const filepath = document.getElementById('filepath')!;
const divider = document.getElementById('divider')!;
const contentArea = document.querySelector('.content-area') as HTMLElement;

let currentFilePath: string | null = null;
let currentMtime = 0;
let savedSource = '';
let isEditing = false;

const isDirty = () => editor.value !== savedSource;

// Give headings ids so in-document anchor links (and a future TOC) work.
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
  const html = await marked.parse(source);
  output.innerHTML = DOMPurify.sanitize(html);
  addHeadingIds();
  resolveLocalImages(filePath);
  await renderMermaid();
}

// Reflect the open file + dirty state in the toolbar.
function updateStatus() {
  saveBtn.disabled = !isDirty();
  saveBtn.classList.toggle('dirty', isDirty());
  filepath.textContent = '';
  if (!currentFilePath) return;
  if (isDirty()) {
    const dot = document.createElement('span');
    dot.className = 'dirty-dot';
    dot.textContent = '●';
    filepath.appendChild(dot);
  }
  filepath.append(basename(currentFilePath));
}

function setEditing(on: boolean) {
  isEditing = on;
  contentArea.classList.toggle('editing', on);
  editLabel.textContent = on ? 'プレビュー' : '編集';
  if (on) editor.focus();
}

async function openFile(filePath: string, opts: { preserveScroll?: boolean } = {}) {
  let content: string;
  try {
    content = await invoke<string>('read_file', { path: filePath });
  } catch (e) {
    filepath.textContent = `開けませんでした: ${e}`;
    return;
  }
  const scrollTop = contentArea.scrollTop;
  currentFilePath = filePath;
  savedSource = content;
  editor.value = content;
  setEditing(false);
  await renderSource(content, filePath);
  output.style.display = 'block';
  emptyState.style.display = 'none';
  reloadBtn.disabled = false;
  editBtn.disabled = false;
  currentMtime = await invoke<number>('file_mtime', { path: filePath }).catch(() => 0);
  updateStatus();
  contentArea.scrollTop = opts.preserveScroll ? scrollTop : 0;
  invoke<string[]>('add_recent_file', { path: filePath }).then(renderRecent).catch(() => {});
}

async function save() {
  if (!currentFilePath || !isDirty()) return;
  try {
    await invoke('save_file', { path: currentFilePath, content: editor.value });
  } catch (e) {
    filepath.textContent = `保存できませんでした: ${e}`;
    return;
  }
  savedSource = editor.value;
  currentMtime = await invoke<number>('file_mtime', { path: currentFilePath }).catch(() => 0);
  updateStatus();
}

// Re-read from disk, but never silently discard unsaved edits.
async function reload() {
  if (!currentFilePath || isDirty()) return;
  await openFile(currentFilePath, { preserveScroll: true });
}

// Recent files are shown in the empty state for quick reopening.
function renderRecent(list: string[]) {
  recentBox.innerHTML = '';
  if (!list || list.length === 0) return;
  const title = document.createElement('div');
  title.className = 'recent-title';
  title.textContent = '最近のファイル';
  recentBox.appendChild(title);
  const ul = document.createElement('ul');
  for (const p of list) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'recent-name';
    name.textContent = basename(p);
    const path = document.createElement('span');
    path.className = 'recent-path';
    path.textContent = p;
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

reloadBtn.addEventListener('click', reload);
saveBtn.addEventListener('click', save);
editBtn.addEventListener('click', () => {
  if (currentFilePath) setEditing(!isEditing);
});

// Live preview while typing, debounced so large documents stay responsive.
let previewTimer: number | undefined;
editor.addEventListener('input', () => {
  updateStatus();
  clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    if (currentFilePath) renderSource(editor.value, currentFilePath);
  }, 250);
});

document.addEventListener('keydown', async (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  if (e.key === 'o') {
    e.preventDefault();
    openBtn.click();
  } else if (e.key === 's') {
    e.preventDefault();
    await save();
  } else if (e.key === 'e' && currentFilePath) {
    e.preventDefault();
    setEditing(!isEditing);
  } else if (e.key === 'r') {
    e.preventDefault();
    await reload();
  }
});

// Keep clicks inside the document: external links open in the default browser,
// internal anchors scroll, so the webview never navigates away from the app.
output.addEventListener('click', async (e) => {
  const anchor = (e.target as HTMLElement).closest('a');
  if (!anchor) return;
  const href = anchor.getAttribute('href');
  if (!href) return;
  e.preventDefault();
  if (href.startsWith('#')) {
    const target = document.getElementById(decodeURIComponent(href.slice(1)));
    target?.scrollIntoView({ behavior: 'smooth' });
  } else {
    await openUrl(href);
  }
});

// Draggable split: drag the divider to resize the editor/preview panes,
// persisting the ratio across sessions.
const SPLIT_KEY = 'mdcrud.split';
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
    const file = p.paths.find(isSupported);
    if (file) openFile(file);
  } else {
    contentArea.classList.remove('drag-over');
  }
});

// Auto-reload: re-render when the open file changes on disk. Paused while
// editing or with unsaved changes so it never clobbers the user's work.
setInterval(async () => {
  if (!currentFilePath || isEditing || isDirty()) return;
  try {
    const m = await invoke<number>('file_mtime', { path: currentFilePath });
    if (m > currentMtime) await openFile(currentFilePath, { preserveScroll: true });
  } catch {
    // File may have been moved/removed; leave the last render in place.
  }
}, 1500);

// Open files passed by the OS via double-click / "Open With".
// Runtime opens (app already running) arrive as an event...
listen<string>('open-file', (e) => {
  if (e.payload) openFile(e.payload);
});

// ...while a file the app was launched with is fetched once on startup.
invoke<string | null>('get_pending_file').then((path) => {
  if (path) openFile(path);
});

// Populate the recent-files list shown in the empty state.
invoke<string[]>('get_recent_files').then(renderRecent).catch(() => {});
