import { describe, it, expect } from 'vitest';
import {
  slugify,
  firstHeadingTitle,
  extractFrontmatter,
  frontmatterToHtml,
  parseDocHeader,
  docHeaderToHtml,
  type DocHeaderField,
  docStats,
  toggleTaskListItem,
} from './markdown';

describe('slugify', () => {
  it('lowercases and hyphenates whitespace', () => {
    expect(slugify('Hello World')).toBe('hello-world');
    expect(slugify('  Trim  Me  ')).toBe('trim-me');
  });
  it('drops punctuation but keeps unicode letters/numbers', () => {
    expect(slugify('Section B!')).toBe('section-b');
    expect(slugify('日本語 見出し 2')).toBe('日本語-見出し-2');
  });
});

describe('firstHeadingTitle', () => {
  it('returns the first heading text, ignoring leading body', () => {
    expect(firstHeadingTitle('intro line\n\n## My Notes\n\n# Later')).toBe('My Notes');
  });
  it('strips trailing closing hashes', () => {
    expect(firstHeadingTitle('# Title #')).toBe('Title');
  });
  it('returns null when there is no heading', () => {
    expect(firstHeadingTitle('just a paragraph\n- a list')).toBeNull();
  });
});

describe('extractFrontmatter', () => {
  it('splits a leading YAML block from the body', () => {
    const { frontmatter, body } = extractFrontmatter('---\ntitle: Hi\ndate: 2026\n---\n# Body\n\ntext');
    expect(frontmatter).toBe('title: Hi\ndate: 2026');
    expect(body).toBe('# Body\n\ntext');
  });
  it('accepts a "..." closing fence', () => {
    const { frontmatter, body } = extractFrontmatter('---\na: 1\n...\nbody');
    expect(frontmatter).toBe('a: 1');
    expect(body).toBe('body');
  });
  it('tolerates a BOM and CRLF line endings', () => {
    const { frontmatter, body } = extractFrontmatter('﻿---\r\ntitle: Hi\r\n---\r\nbody');
    expect(frontmatter).toBe('title: Hi');
    expect(body).toBe('body');
  });
  it('returns the source unchanged when there is no closing fence', () => {
    const src = '---\ntitle: Hi\n\n# Just a doc that opens with a rule';
    expect(extractFrontmatter(src)).toEqual({ frontmatter: null, body: src });
  });
  it('ignores a --- that is not on the first line', () => {
    const src = 'intro\n---\ntitle: no\n---';
    expect(extractFrontmatter(src)).toEqual({ frontmatter: null, body: src });
  });
});

describe('frontmatterToHtml', () => {
  it('renders flat key: value pairs as table rows', () => {
    const html = frontmatterToHtml('title: Hi\ntags: a, b', 'Metadata');
    expect(html).toContain('<summary>Metadata</summary>');
    expect(html).toContain('<tr><th>title</th><td>Hi</td></tr>');
    expect(html).toContain('<tr><th>tags</th><td>a, b</td></tr>');
  });
  it('escapes HTML in keys and values', () => {
    const html = frontmatterToHtml('title: <b>x</b> & "y"', 'M');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;');
    expect(html).not.toContain('<b>x</b>');
  });
  it('shows nested/list lines verbatim across both columns', () => {
    const html = frontmatterToHtml('tags:\n  - a\n  - b', 'M');
    // A key with no inline value and its list items are all shown raw, not split.
    expect(html).toContain('<td colspan="2"><code>tags:</code></td>');
    expect(html).toContain('<td colspan="2"><code>  - a</code></td>');
    expect(html).not.toContain('<th>tags</th>');
  });
});

const LABELS: Record<DocHeaderField, string> = {
  title: 'Title',
  docNumber: 'Document No.',
  version: 'Version',
  date: 'Date',
  author: 'Author',
  classification: 'Classification',
};

describe('parseDocHeader', () => {
  it('picks up English header keys', () => {
    const { fields } = parseDocHeader('title: Spec\ndoc: DOC-14\nversion: 1.2\nauthor: Ada');
    expect(fields).toEqual({ title: 'Spec', docNumber: 'DOC-14', version: '1.2', author: 'Ada' });
  });
  it('picks up Japanese header keys', () => {
    const { fields } = parseDocHeader('タイトル: 要件定義書\n文書番号: DOC-14\n版数: 1.2\n機密区分: 社外秘');
    expect(fields).toEqual({
      title: '要件定義書',
      docNumber: 'DOC-14',
      version: '1.2',
      classification: '社外秘',
    });
  });
  it('matches keys case-insensitively and trims the value', () => {
    const { fields } = parseDocHeader('Version:   2.0   ');
    expect(fields.version).toBe('2.0');
  });
  it('leaves unknown keys for the metadata panel', () => {
    const { fields, rest } = parseDocHeader('title: Spec\ntags: a, b\ndraft: true');
    expect(fields).toEqual({ title: 'Spec' });
    expect(rest).toBe('tags: a, b\ndraft: true');
  });
  it('keeps a duplicate of a known key rather than dropping it', () => {
    // `updated` and `date` share a field: first wins, the loser stays visible.
    const { fields, rest } = parseDocHeader('date: 2026-08-04\nupdated: 2026-08-05');
    expect(fields.date).toBe('2026-08-04');
    expect(rest).toBe('updated: 2026-08-05');
  });
  it('does not read indented nested YAML as a header field', () => {
    const { fields, rest } = parseDocHeader('meta:\n  title: Nested');
    expect(fields.title).toBeUndefined();
    expect(rest).toBe('meta:\n  title: Nested');
  });
  it('treats a key with an empty value as not set', () => {
    const { fields, rest } = parseDocHeader('title:');
    expect(fields.title).toBeUndefined();
    expect(rest).toBe('title:');
  });
});

describe('docHeaderToHtml', () => {
  it('renders nothing when no known field is present', () => {
    expect(docHeaderToHtml({}, LABELS, true)).toBe('');
  });
  it('draws the title, marking and labelled meta', () => {
    const html = docHeaderToHtml(
      { title: '要件定義書', classification: '社外秘', docNumber: 'DOC-14', version: '1.2' },
      LABELS,
      false,
    );
    expect(html).toContain('<div class="doc-header-title">要件定義書</div>');
    expect(html).toContain('<span class="doc-header-mark">社外秘</span>');
    expect(html).toContain('>Document No.</span><span class="doc-header-val">DOC-14<');
    expect(html).not.toContain('doc-header-logo');
  });
  it('emits the logo without a src, for the caller to fill after sanitizing', () => {
    const html = docHeaderToHtml({ title: 'Spec' }, LABELS, true);
    expect(html).toContain('<img class="doc-header-logo" alt="">');
    expect(html).not.toContain('src=');
  });
  it('does not draw a band for the logo alone', () => {
    expect(docHeaderToHtml({}, LABELS, true)).toBe('');
  });
  it('escapes HTML in field values', () => {
    const html = docHeaderToHtml({ title: '<b>x</b> & "y"' }, LABELS, false);
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;');
    expect(html).not.toContain('<b>x</b>');
  });
});

describe('docStats', () => {
  it('counts words and characters for space-delimited text', () => {
    const s = docStats('the quick brown fox');
    expect(s.chars).toBe(19);
    expect(s.words).toBe(4);
  });
  it('counts CJK characters individually (no word split)', () => {
    const s = docStats('日本語のテスト');
    expect(s.chars).toBe(7);
    expect(s.words).toBe(0);
  });
  it('counts code points, not UTF-16 units', () => {
    expect(docStats('😀😀').chars).toBe(2);
  });
  it('is zero for empty text', () => {
    expect(docStats('')).toEqual({ chars: 0, words: 0, minutes: 0 });
  });
  it('rounds reading time up to at least one minute', () => {
    expect(docStats('hello world').minutes).toBe(1);
  });
  it('estimates longer reading time from volume', () => {
    const words = Array(600).fill('word').join(' ');
    expect(docStats(words).minutes).toBe(3); // 600 / 200 wpm
  });
});

describe('toggleTaskListItem', () => {
  it('checks an unchecked item', () => {
    expect(toggleTaskListItem('- [ ] a', 0)).toBe('- [x] a');
  });
  it('unchecks a checked item, preserving the marker style', () => {
    expect(toggleTaskListItem('* [x] a', 0)).toBe('* [ ] a');
    expect(toggleTaskListItem('- [X] a', 0)).toBe('- [ ] a');
  });
  it('targets the nth item and leaves the others alone', () => {
    const src = '- [ ] a\n- [ ] b\n- [ ] c';
    expect(toggleTaskListItem(src, 1)).toBe('- [ ] a\n- [x] b\n- [ ] c');
  });
  it('preserves indentation of nested items', () => {
    expect(toggleTaskListItem('- [ ] a\n  - [ ] b', 1)).toBe('- [ ] a\n  - [x] b');
  });
  it('ignores task syntax inside fenced code blocks', () => {
    const src = '```\n- [ ] not a task\n```\n- [ ] real';
    expect(toggleTaskListItem(src, 0)).toBe('```\n- [ ] not a task\n```\n- [x] real');
  });
  it('ignores task syntax inside leading frontmatter', () => {
    const src = '---\nlist:\n- [ ] meta\n---\n- [ ] real';
    expect(toggleTaskListItem(src, 0)).toBe('---\nlist:\n- [ ] meta\n---\n- [x] real');
  });
  it('returns null when the index is out of range', () => {
    expect(toggleTaskListItem('- [ ] a', 3)).toBeNull();
    expect(toggleTaskListItem('no tasks here', 0)).toBeNull();
  });
});
