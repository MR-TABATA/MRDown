import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

const openBtn = document.getElementById('open-btn')!;
const reloadBtn = document.getElementById('reload-btn')!;
const output = document.getElementById('output')!;
const emptyState = document.getElementById('empty-state')!;
const filepath = document.getElementById('filepath')!;

let currentFilePath: string | null = null;

async function renderFile(filePath: string) {
  const content = await invoke<string>('read_file', { path: filePath });
  const html = await marked.parse(content);
  output.innerHTML = DOMPurify.sanitize(html);
  output.style.display = 'block';
  emptyState.style.display = 'none';
  (reloadBtn as HTMLButtonElement).disabled = false;
  currentFilePath = filePath;
  filepath.textContent = filePath.split('/').pop() || filePath;
  document.querySelector('.content-area')!.scrollTop = 0;
}

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