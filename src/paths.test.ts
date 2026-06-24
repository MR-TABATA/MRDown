import { describe, it, expect } from 'vitest';
import { isSupported, basename, resolveImagePath } from './paths';

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
