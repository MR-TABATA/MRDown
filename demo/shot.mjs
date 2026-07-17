// Captures still screenshots of two features for the Product Hunt gallery, by
// driving the real UI against the mocked backend (see demo/mock/), the same way
// demo/record.mjs drives the video. No drawn cursor — these are stills.
//
//   npx vite -c demo/vite.config.ts &     # http://localhost:1421
//   node demo/shot.mjs --lang=en          # -> docs/media/shot-*-en.png

import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MEDIA = path.resolve(HERE, '..', 'docs', 'media');
const URL = 'http://localhost:1421/';
const SIZE = { width: 1100, height: 760 };

const LANG = process.argv.includes('--lang=ja') ? 'ja' : 'en';
const LOCALE = LANG === 'ja' ? 'ja-JP' : 'en-US';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: SIZE,
  locale: LOCALE,
  deviceScaleFactor: 2, // crisp on retina / when PH scales the thumbnail
});
await context.addInitScript(() => localStorage.clear());

const page = await context.newPage();
await page.goto(URL);
await page.waitForSelector('#output', { state: 'attached' });
await page.waitForFunction(() => typeof window.__dropHandler === 'function');

const pause = (ms) => page.waitForTimeout(ms);

// Open the checklist so nothing sits on the empty start screen behind the panel.
await page.evaluate(() => window.__dropHandler({ payload: { type: 'drop', paths: [window.__demo.README] } }));
await page.waitForSelector('#output h1');
await pause(600);

// --- Shot 1: the version timeline (diff across time) ------------------------
// Open history, then pick the oldest save as the left end so the diff is the
// whole story of the document, not an empty "no change since last save".
await page.locator('#history-btn').click();
await page.waitForSelector('#history-list li');
await page.locator('#history-list li').last().locator('input[name=diff-base]').check();
await page.waitForSelector('#history-diff .diff-row');
await pause(500);
await page.screenshot({ path: path.join(MEDIA, `shot-timeline-${LANG}.png`) });

// Close the panel before opening the next one.
await page.locator('#history-close').click();
await pause(300);

// --- Shot 2: compare any two files (⌘⇧D) ------------------------------------
// The dialog is mocked: __pick is what the user would have chosen.
await page.evaluate(() => {
  window.__pick = [window.__demo.README, window.__demo.DESIGN];
  window.__emit('menu', 'compare');
});
await page.waitForSelector('#history-diff .diff-row');
await pause(500);
await page.screenshot({ path: path.join(MEDIA, `shot-compare-${LANG}.png`) });

await browser.close();
console.log(`wrote shot-timeline-${LANG}.png, shot-compare-${LANG}.png`);
