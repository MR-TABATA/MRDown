import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

const openBtn = document.getElementById('open-btn')!;
const reloadBtn = document.getElementById('reload-btn')!;
const output = document.getElementById('output')!;
const emptyState = document.getElementById('empty-state')!;
const filepath = document.getElementById('filepath')!;

let currentFilePath: string | null = null;

// Build a URL-friendly id from heading text (keeps unicode letters/numbers).
function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '');
}

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

// Resolve local (relative/absolute) image paths against the file's directory
// and route them through the asset protocol so they actually load.
function resolveLocalImages(filePath: string) {
  const sep = filePath.includes('\\') ? '\\' : '/';
  const dir = filePath.slice(0, filePath.lastIndexOf(sep));
  output.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (!src || /^(https?:|data:|blob:|asset:|tauri:)/i.test(src)) return;
    const rel = src.replace(/^\.\//, '');
    const isAbsolute = rel.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(rel) || rel.startsWith('\\\\');
    const abs = isAbsolute ? rel : `${dir}${sep}${rel.split('/').join(sep)}`;
    img.src = convertFileSrc(abs);
  });
}

async function renderFile(filePath: string) {
  const content = await invoke<string>('read_file', { path: filePath });
  const html = await marked.parse(content);
  output.innerHTML = DOMPurify.sanitize(html);
  addHeadingIds();
  resolveLocalImages(filePath);
  output.style.display = 'block';
  emptyState.style.display = 'none';
  (reloadBtn as HTMLButtonElement).disabled = false;
  currentFilePath = filePath;
  filepath.textContent = filePath.split(/[\\/]/).pop() || filePath;
  document.querySelector('.content-area')!.scrollTop = 0;
}

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

openBtn.addEventListener('click', async () => {
  const selected = await open({
    multiple: false,
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }]
  });
  if (selected) await renderFile(selected as string);
});

reloadBtn.addEventListener('click', async () => {
  if (currentFilePath) await renderFile(currentFilePath);
});

document.addEventListener('keydown', async (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
    e.preventDefault();
    openBtn.click();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'r' && currentFilePath) {
    e.preventDefault();
    await renderFile(currentFilePath);
  }
});

// Open files passed by the OS via double-click / "Open With".
// Runtime opens (app already running) arrive as an event...
listen<string>('open-file', (e) => {
  if (e.payload) renderFile(e.payload);
});

// ...while a file the app was launched with is fetched once on startup.
invoke<string | null>('get_pending_file').then((path) => {
  if (path) renderFile(path);
});