import { describe, it, expect } from 'vitest';
import { slugify, firstHeadingTitle, extractFrontmatter, frontmatterToHtml } from './markdown';

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
