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

// --- the beats, in the order the landing page argues them -------------------

// 1. The start screen you come back to.
await pause(1200);

// 2. A document arrives by drag & drop.
await page.evaluate(() => window.__dropHandler({ payload: { type: 'enter', paths: [] } }));
await pause(450);
await page.evaluate(() => window.__dropHandler({ payload: { type: 'drop', paths: [window.__demo.README] } }));
await page.waitForSelector('#output h1');
await pause(1500);

// 3. Something else rewrites the file. The real 1.5s mtime poll picks it up.
await page.evaluate(() => window.__demo.rewriteReadme());
await page.waitForFunction(
  () =>
    [...document.querySelectorAll('#output h2')].some((h) =>
      h.textContent.includes(window.__demo.needles.appended)
    ),
  null,
  { timeout: 6000 }
);
await pause(1700);

// 4. Tick a task; the Markdown source is rewritten underneath.
await clickOn(page.locator('#output li > input[type=checkbox]').nth(1));
await pause(1400);

// 5. Follow a link to another local document — it opens in the app.
await clickOn(page.locator('#output a[href="./design.md"]'));
await page.waitForFunction(() => document.title === 'design.md');
await pause(1500);

// 6. Back to the checklist, then roll it back to an earlier save.
await clickOn(page.locator('#sidebar li').first());
await pause(900);
await clickOn(page.locator('#history-btn'));
await pause(800);
await clickOn(page.locator('#history-list li').last());
await pause(1100);
await clickOn(page.locator('#history-restore'));
await page.waitForFunction(() =>
  document.getElementById('output').textContent.includes(window.__demo.needles.oldest)
);
await pause(1800);

await browser.close(); // flushes the video

const raw = fs.readdirSync(OUT).find((f) => f.endsWith('.webm') && !f.startsWith('demo-'));
const dest = path.join(OUT, `demo-${LANG}.webm`);
fs.renameSync(path.join(OUT, raw), dest);
console.log(path.relative(process.cwd(), dest));
