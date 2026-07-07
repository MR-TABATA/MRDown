import { describe, it, expect } from 'vitest';
import { isSupported, basename, dirname, tildify, resolveImagePath, resolveDocLink, sanitizeFilename } from './paths';

describe('isSupported', () => {
  it('accepts markdown extensions case-insensitively', () => {
    expect(isSupported('a.md')).toBe(true);
    expect(isSupported('A.MARKDOWN')).toBe(true);
    expect(isSupported('notes.txt')).toBe(true);
  });
  it('rejects other extensions and extensionless paths', () => {
    expect(isSupported('image.png')).toBe(false);
    expect(isSupported('Makefile')).toBe(false);
    expect(isSupported('')).toBe(false);
  });
});

describe('basename', () => {
  it('handles posix and windows separators', () => {
    expect(basename('/home/u/a.md')).toBe('a.md');
    expect(basename('C:\\docs\\a.md')).toBe('a.md');
    expect(basename('a.md')).toBe('a.md');
  });
});

describe('dirname', () => {
  it('returns the directory portion', () => {
    expect(dirname('/home/u/a.md')).toBe('/home/u');
    expect(dirname('C:\\docs\\a.md')).toBe('C:\\docs');
  });
  it('returns empty when there is no directory', () => {
    expect(dirname('a.md')).toBe('');
    expect(dirname('/a.md')).toBe('');
  });
});

describe('sanitizeFilename', () => {
  it('replaces path separators and reserved characters', () => {
    expect(sanitizeFilename('a/b:c?')).toBe('a-b-c-');
    expect(sanitizeFilename('Plan: Q3 <draft>')).toBe('Plan- Q3 -draft-');
  });
  it('collapses whitespace and trims', () => {
    expect(sanitizeFilename('  My   Notes  ')).toBe('My Notes');
  });
  it('falls back to untitled when nothing usable remains', () => {
    expect(sanitizeFilename('   ')).toBe('untitled');
    expect(sanitizeFilename('...')).toBe('untitled');
  });
});

describe('tildify', () => {
  const home = '/Users/h';
  it('replaces the home prefix with ~', () => {
    expect(tildify('/Users/h/notes/a.md', home)).toBe('~/notes/a.md');
    expect(tildify('/Users/h', home)).toBe('~');
  });
  it('leaves paths outside home untouched', () => {
    expect(tildify('/tmp/a.md', home)).toBe('/tmp/a.md');
    expect(tildify('/Users/hannah/a.md', home)).toBe('/Users/hannah/a.md');
  });
});

describe('resolveImagePath', () => {
  const doc = '/home/u/notes/readme.md';

  it('leaves remote and data sources untouched', () => {
    expect(resolveImagePath(doc, 'https://x/y.png')).toBeNull();
    expect(resolveImagePath(doc, 'data:image/png;base64,AAAA')).toBeNull();
    expect(resolveImagePath(doc, '')).toBeNull();
  });
  it('resolves relative paths against the document directory', () => {
    expect(resolveImagePath(doc, './pic.png')).toBe('/home/u/notes/pic.png');
    expect(resolveImagePath(doc, 'img/pic.png')).toBe('/home/u/notes/img/pic.png');
  });
  it('keeps absolute paths as-is', () => {
    expect(resolveImagePath(doc, '/abs/pic.png')).toBe('/abs/pic.png');
  });
  it('uses backslash separators for windows documents', () => {
    expect(resolveImagePath('C:\\docs\\a.md', 'img/p.png')).toBe('C:\\docs\\img\\p.png');
    expect(resolveImagePath('C:\\docs\\a.md', 'D:\\x\\p.png')).toBe('D:\\x\\p.png');
  });
});

describe('resolveDocLink', () => {
  const doc = '/home/u/notes/readme.md';

  it('resolves relative Markdown links against the document directory', () => {
    expect(resolveDocLink(doc, './other.md')).toBe('/home/u/notes/other.md');
    expect(resolveDocLink(doc, 'sub/deep.md')).toBe('/home/u/notes/sub/deep.md');
    expect(resolveDocLink(doc, 'other.md')).toBe('/home/u/notes/other.md');
  });
  it('collapses . and .. segments', () => {
    expect(resolveDocLink(doc, '../top.md')).toBe('/home/u/top.md');
    expect(resolveDocLink(doc, '../a/../b/c.md')).toBe('/home/u/b/c.md');
    expect(resolveDocLink(doc, './x/./y.md')).toBe('/home/u/notes/x/y.md');
  });
  it('keeps absolute Markdown links, still normalized', () => {
    expect(resolveDocLink(doc, '/abs/a.md')).toBe('/abs/a.md');
    expect(resolveDocLink(doc, '/abs/../a.md')).toBe('/a.md');
  });
  it('strips a #fragment or ?query before resolving', () => {
    expect(resolveDocLink(doc, './other.md#heading')).toBe('/home/u/notes/other.md');
    expect(resolveDocLink(doc, './other.md?v=2')).toBe('/home/u/notes/other.md');
  });
  it('decodes percent-encoded paths', () => {
    expect(resolveDocLink(doc, './my%20notes.md')).toBe('/home/u/notes/my notes.md');
  });
  it('accepts file:// URLs as local paths', () => {
    expect(resolveDocLink(doc, 'file:///abs/a.md')).toBe('/abs/a.md');
  });
  it('accepts the other supported extensions', () => {
    expect(resolveDocLink(doc, './log.txt')).toBe('/home/u/notes/log.txt');
    expect(resolveDocLink(doc, './readme.markdown')).toBe('/home/u/notes/readme.markdown');
  });
  it('returns null for in-page anchors', () => {
    expect(resolveDocLink(doc, '#section')).toBeNull();
  });
  it('returns null for remote and non-file schemes (even .md)', () => {
    expect(resolveDocLink(doc, 'https://x/y.md')).toBeNull();
    expect(resolveDocLink(doc, 'mailto:a@b.com')).toBeNull();
    expect(resolveDocLink(doc, 'data:text/plain,hi')).toBeNull();
  });
  it('returns null for file types we do not open', () => {
    expect(resolveDocLink(doc, './pic.png')).toBeNull();
    expect(resolveDocLink(doc, './archive.zip')).toBeNull();
  });
  it('returns null when there is no base directory to resolve against', () => {
    expect(resolveDocLink('', './other.md')).toBeNull();
  });
  it('resolves against a windows document with backslash separators', () => {
    expect(resolveDocLink('C:\\docs\\a.md', 'sub\\b.md')).toBe('C:\\docs\\sub\\b.md');
    expect(resolveDocLink('C:\\docs\\a.md', '..\\c.md')).toBe('C:\\c.md');
  });
});
