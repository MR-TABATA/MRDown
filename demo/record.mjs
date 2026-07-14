// Records the landing-page demo by driving the real UI against the mocked
// backend (see demo/mock/). Deterministic: same beats, same frames, every run.
//
//   npx vite -c demo/vite.config.ts &        # http://localhost:1421
//   node demo/record.mjs                     # -> demo/out/demo.webm
//
// A screencast never captures the real mouse pointer, so we draw one and move
// it ourselves; every click walks the cursor to its target first.

import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const URL = 'http://localhost:1421/';
const SIZE = { width: 1100, height: 760 }; // the app's default window size

// The app takes its UI language from navigator.language, and the fixtures follow,
// so each landing page gets a demo whose chrome and content are in its language.
const LANG = process.argv.includes('--lang=en') ? 'en' : 'ja';
const LOCALE = LANG === 'ja' ? 'ja-JP' : 'en-US';

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: SIZE,
  locale: LOCALE,
  recordVideo: { dir: OUT, size: SIZE },
});

// The app saves its session on `beforeunload`, so a previous run would leak into
// this one. Wipe storage before any app code runs.
await context.addInitScript(() => localStorage.clear());

const page = await context.newPage();
await page.goto(URL);
// `#output` stays hidden behind the start screen until a document is open.
await page.waitForSelector('#output', { state: 'attached' });
await page.waitForFunction(() => typeof window.__dropHandler === 'function');

await page.evaluate((size) => {
  const cursor = document.createElement('div');
  cursor.innerHTML =
    '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M5 2l6 16 2.2-6.2L19.5 9.5z" fill="#fff" stroke="#000" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  cursor.style.cssText =
    'position:fixed;left:0;top:0;z-index:99999;pointer-events:none;' +
    'transition:transform .55s cubic-bezier(.4,0,.2,1);filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))';
  document.body.appendChild(cursor);

  const ring = document.createElement('div');
  ring.style.cssText =
    'position:fixed;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;' +
    'z-index:99998;pointer-events:none;opacity:0;background:rgba(109,94,252,.55)';
  document.body.appendChild(ring);

  window.__cursorTo = (x, y) => {
    cursor.style.transform = `translate(${x}px, ${y}px)`;
  };
  window.__ripple = (x, y) => {
    ring.style.transition = 'none';
    ring.style.transform = `translate(${x}px, ${y}px) scale(.4)`;
    ring.style.opacity = '1';
    requestAnimationFrame(() => {
      ring.style.transition = 'transform .4s ease-out, opacity .4s ease-out';
      ring.style.transform = `translate(${x}px, ${y}px) scale(1.6)`;
      ring.style.opacity = '0';
    });
  };
  window.__cursorTo(size.width / 2, size.height / 2);
}, SIZE);

const pause = (ms) => page.waitForTimeout(ms);

async function cursorTo(x, y) {
  await page.evaluate(([x, y]) => window.__cursorTo(x, y), [x, y]);
  await pause(620); // let the CSS transition land before acting
}

/** Walk the drawn cursor to an element, then really click it. */
async function clickOn(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element not visible');
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await cursorTo(x, y);
  await page.evaluate(([x, y]) => window.__ripple(x, y), [x, y]);
  await locator.click();
  await pause(200);
}

// --- the beats: the one thing this app does that the others don't -----------
//
// The old cut showed opening a file, ticking a task, following a link. Every
// Markdown app does those. It never once showed the reason this one exists.
//
// This one tells a single story: you are editing, an agent rewrites the file
// underneath you, and neither of you loses anything.

// 1. The start screen you come back to.
await pause(1000);

// 2. A document arrives by drag & drop.
await page.evaluate(() => window.__dropHandler({ payload: { type: 'enter', paths: [] } }));
await pause(400);
await page.evaluate(() => window.__dropHandler({ payload: { type: 'drop', paths: [window.__demo.README] } }));
await page.waitForSelector('#output h1');
await pause(1300);

// 3. You tick a blocker. The Markdown source is rewritten underneath — and the
//    document is now unsaved.
await clickOn(page.locator('#output li > input[type=checkbox]').nth(2));
await page.waitForFunction(() => document.querySelector('#doc-list li.dirty') !== null);
await pause(1200);

// 4. An agent rewrites the file on disk. It ticks a different blocker, and it
//    rewrites the very line you just ticked.
await page.evaluate(() => window.__demo.agentRewrite());

// 5. Nothing is silently overwritten, and nothing is silently reloaded. The
//    real 1.5s mtime poll finds it and stops.
await page.waitForSelector('#conflict-bar:not([hidden])', { timeout: 8000 });
await pause(1800);

// 6. See what the two of you did.
await clickOn(page.locator('#conflict-view'));
await page.waitForSelector('.diff-row.three');
await pause(700);

// 7. Three columns: the last save, what's on disk, your edits. Only the line you
//    both rewrote differently is marked as a conflict.
await page.waitForSelector('.diff-row.three.conflict');
await pause(3200);

// 8. Keep yours. The agent's version is not thrown away.
await clickOn(page.locator('#conflict-mine2'));
await pause(1200);

// 9. It's in the history, as what it was: a rewrite from outside.
await clickOn(page.locator('#history-btn'));
await page.waitForSelector('#history-list .history-kind.external');
await pause(1400);

// 10. Read it back — the change the agent made, still there.
await clickOn(page.locator('#history-list li').filter({ has: page.locator('.history-kind.external') }).first().locator('input[name=diff-base]'));
await page.waitForSelector('#history-diff .diff-row');
await pause(2600);

await browser.close(); // flushes the video

const raw = fs.readdirSync(OUT).find((f) => f.endsWith('.webm') && !f.startsWith('demo-'));
const dest = path.join(OUT, `demo-${LANG}.webm`);
fs.renameSync(path.join(OUT, raw), dest);
console.log(path.relative(process.cwd(), dest));
