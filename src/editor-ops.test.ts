import { describe, it, expect } from 'vitest';
import {
  toggleWrap,
  toggleLinePrefix,
  insertLink,
  insertImage,
  insertFence,
  insertTable,
  insertHr,
  listContinue,
  listIndent,
  autoPair,
  type Sel,
} from './editor-ops';

const sel = (text: string, start: number, end: number): Sel => ({ text, start, end });
// Build a Sel from a string with a `|` caret marker (two `|` = a selection).
const at = (marked: string): Sel => {
  const start = marked.indexOf('|');
  const rest = marked.slice(0, start) + marked.slice(start + 1);
  const end = rest.indexOf('|');
  if (end === -1) return { text: rest, start, end: start };
  return { text: rest.slice(0, end) + rest.slice(end + 1), start, end };
};

describe('toggleWrap', () => {
  it('wraps the selection and keeps it selected', () => {
    const r = toggleWrap(sel('a bold c', 2, 6), '**');
    expect(r.text).toBe('a **bold** c');
    expect(r.text.slice(r.start, r.end)).toBe('bold');
  });
  it('unwraps when markers sit just outside the selection', () => {
    const r = toggleWrap(sel('a **bold** c', 4, 8), '**');
    expect(r.text).toBe('a bold c');
    expect(r.text.slice(r.start, r.end)).toBe('bold');
  });
  it('unwraps when markers are inside the selection', () => {
    const r = toggleWrap(sel('a **bold** c', 2, 10), '**');
    expect(r.text).toBe('a bold c');
    expect(r.text.slice(r.start, r.end)).toBe('bold');
  });
  it('inserts empty markers with the caret between them', () => {
    const r = toggleWrap(sel('ab', 1, 1), '*');
    expect(r.text).toBe('a**b');
    expect(r.start).toBe(2);
    expect(r.end).toBe(2);
  });
});

describe('toggleLinePrefix', () => {
  it('adds a heading prefix to the current line', () => {
    const r = toggleLinePrefix(sel('hello', 0, 0), '# ', /^#{1,6} /);
    expect(r.text).toBe('# hello');
  });
  it('removes the prefix when every line already has one', () => {
    const r = toggleLinePrefix(sel('- a\n- b', 0, 7), '- ', /^[-*+] /);
    expect(r.text).toBe('a\nb');
  });
  it('strips any heading level', () => {
    const r = toggleLinePrefix(sel('### deep', 0, 0), '# ', /^#{1,6} /);
    expect(r.text).toBe('deep');
  });
  it('prefixes a multi-line block, skipping blank lines', () => {
    const r = toggleLinePrefix(sel('a\n\nb', 0, 4), '> ', /^> /);
    expect(r.text).toBe('> a\n\n> b');
    expect(r.text.slice(r.start, r.end)).toBe('> a\n\n> b');
  });
});

describe('insertLink', () => {
  it('wraps the selection and selects the url placeholder', () => {
    const r = insertLink(sel('see here now', 4, 8));
    expect(r.text).toBe('see [here](url) now');
    expect(r.text.slice(r.start, r.end)).toBe('url');
  });
});

describe('insertImage', () => {
  it('uses the selection as alt text and selects the url', () => {
    const r = insertImage(sel('logo', 0, 4));
    expect(r.text).toBe('![logo](url)');
    expect(r.text.slice(r.start, r.end)).toBe('url');
  });
});

describe('block inserts', () => {
  it('pads a horizontal rule onto its own line', () => {
    const r = insertHr(sel('a', 1, 1));
    expect(r.text).toBe('a\n---');
    expect(r.start).toBe(5);
  });
  it('does not double blank lines that already exist', () => {
    const r = insertHr(sel('a\n', 2, 2));
    expect(r.text).toBe('a\n---');
  });
  it('wraps a selection in a fenced code block with caret in the lang slot', () => {
    const r = insertFence(sel('x()', 0, 3));
    expect(r.text).toBe('```\nx()\n```');
    expect(r.start).toBe(3);
    expect(r.end).toBe(3);
  });
  it('inserts a table skeleton with the first header selected', () => {
    const r = insertTable(sel('', 0, 0));
    expect(r.text).toBe('| 見出し | 見出し |\n| --- | --- |\n| セル | セル |');
    expect(r.text.slice(r.start, r.end)).toBe('見出し');
  });
});

describe('listContinue', () => {
  it('continues an unordered list, preserving indent', () => {
    const r = listContinue(at('  - item|'));
    expect(r?.text).toBe('  - item\n  - ');
    expect(r?.start).toBe(r?.text.length);
  });
  it('increments an ordered list', () => {
    const r = listContinue(at('1. first|'));
    expect(r?.text).toBe('1. first\n2. ');
  });
  it('starts the next task item unchecked', () => {
    const r = listContinue(at('- [x] done|'));
    expect(r?.text).toBe('- [x] done\n- [ ] ');
  });
  it('exits the list when the item is empty', () => {
    const r = listContinue(at('- |'));
    expect(r?.text).toBe('');
    expect(r?.start).toBe(0);
  });
  it('carries the tail after the caret onto the new line', () => {
    const r = listContinue(at('- ab|cd'));
    expect(r?.text).toBe('- ab\n- cd');
  });
  it('returns null outside a list', () => {
    expect(listContinue(at('plain text|'))).toBeNull();
  });
  it('returns null when a range is selected', () => {
    expect(listContinue(at('- a|bc|d'))).toBeNull();
  });
});

describe('listIndent', () => {
  it('indents a list line by two spaces', () => {
    const r = listIndent(at('- item|'), false);
    expect(r?.text).toBe('  - item');
  });
  it('outdents a list line', () => {
    const r = listIndent(at('  - item|'), true);
    expect(r?.text).toBe('- item');
  });
  it('indents every line of a multi-line selection', () => {
    const r = listIndent(at('- a|\n- b|'), false);
    expect(r?.text).toBe('  - a\n  - b');
  });
  it('returns null when the block is not a list', () => {
    expect(listIndent(at('plain|'), false)).toBeNull();
  });
});

describe('autoPair', () => {
  it('inserts the matching close at a collapsed caret', () => {
    const r = autoPair(at('a|b'), '[');
    expect(r?.text).toBe('a[]b');
    expect(r?.start).toBe(2);
  });
  it('wraps a selection', () => {
    const r = autoPair(at('a|bc|d'), '`');
    expect(r?.text).toBe('a`bc`d');
    expect(r?.text.slice(r!.start, r!.end)).toBe('bc');
  });
  it('wraps a selection with asterisks', () => {
    expect(autoPair(at('|word|'), '*')?.text).toBe('*word*');
  });
  it('types over an existing close', () => {
    const r = autoPair(at('a[|]b'), ']');
    expect(r?.text).toBe('a[]b');
    expect(r?.start).toBe(3);
  });
  it('returns null for a plain character', () => {
    expect(autoPair(at('a|b'), 'x')).toBeNull();
  });
});
