import { describe, it, expect } from 'vitest';
import { buildExportDocument } from './export';

const doc = (over: Partial<Parameters<typeof buildExportDocument>[0]> = {}) =>
  buildExportDocument({
    lang: 'ja',
    title: 'タイトル',
    css: '.mrdown h1 { color: red; }',
    rootStyle: '',
    body: '<h1>見出し</h1>',
    ...over,
  });

describe('buildExportDocument', () => {
  it('emits a standalone document with charset and language', () => {
    const html = doc();
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="ja">');
    expect(html).toContain('<meta charset="utf-8">');
  });

  it('inlines the collected css and the body', () => {
    const html = doc();
    expect(html).toContain('.mrdown h1 { color: red; }');
    expect(html).toContain('<article class="mrdown">');
    expect(html).toContain('<h1>見出し</h1>');
  });

  it('escapes the title', () => {
    expect(doc({ title: 'a & b <c>' })).toContain('<title>a &amp; b &lt;c&gt;</title>');
  });

  it("re-applies the user's appearance overrides after the base tokens", () => {
    const html = doc({ rootStyle: '--mrd-bg: #fff; --mrd-text: #111;' });
    expect(html).toContain(':root { --mrd-bg: #fff; --mrd-text: #111; }');
    // the override must come after the collected css so it wins
    expect(html.indexOf(':root {')).toBeGreaterThan(html.indexOf('.mrdown h1'));
  });

  it('omits the override block when nothing was customised', () => {
    expect(doc({ rootStyle: '' })).not.toContain(':root {  }');
  });

  it('gives the standalone page its own readable column', () => {
    const html = doc();
    expect(html).toContain('.mrdown { display: block;');
    expect(html).toContain('max-width: 760px');
  });
});
