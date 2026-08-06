import { describe, it, expect } from 'vitest';
import { docTemplate, isoDate, TEMPLATE_KINDS } from './templates';
import { extractFrontmatter, parseDocHeader } from './markdown';

describe('isoDate', () => {
  it('formats local time as YYYY-MM-DD, zero-padded', () => {
    expect(isoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(isoDate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('docTemplate', () => {
  it('follows the app language', () => {
    expect(docTemplate('design', 'ja')).toContain('## 1. 目的');
    expect(docTemplate('design', 'en')).toContain('## 1. Purpose');
    // One language per document — a bilingual sheet would only mean deleting
    // half of it before writing.
    expect(docTemplate('design', 'ja')).not.toContain('## 1. Purpose');
  });

  it('stamps today into the date field', () => {
    const t = docTemplate('requirements', 'ja', new Date(2026, 7, 6));
    expect(t).toContain('日付: 2026-08-06');
  });

  it('leaves the fields the author must fill in empty', () => {
    const t = docTemplate('design', 'ja');
    expect(t).toMatch(/^タイトル:\s*$/m);
    expect(t).toMatch(/^作成者:\s*$/m);
  });

  it('carries no prose — only headings, prompts and empty tables', () => {
    for (const kind of TEMPLATE_KINDS) {
      for (const lang of ['ja', 'en'] as const) {
        for (const line of docTemplate(kind, lang).split('\n')) {
          const body = line.trim();
          if (
            body === '' ||
            body.startsWith('#') ||
            body.startsWith('<!--') ||
            body.startsWith('|') ||
            body.startsWith('- [ ]') ||
            body.startsWith('---') ||
            /:\s*\S*$/.test(body) // frontmatter key, filled or not
          ) {
            continue;
          }
          throw new Error(`unexpected prose in ${kind}/${lang}: ${line}`);
        }
      }
    }
  });
});

// The templates exist to feed the document header. If a key here and the ones
// parseDocHeader knows ever drift apart, a document started from a template
// silently stops drawing its band — so tie them together in a test.
describe('templates feed the document header', () => {
  for (const kind of TEMPLATE_KINDS) {
    for (const lang of ['ja', 'en'] as const) {
      it(`${kind}/${lang} frontmatter is all recognised header fields`, () => {
        const { frontmatter } = extractFrontmatter(docTemplate(kind, lang));
        expect(frontmatter).not.toBeNull();
        const { fields, rest } = parseDocHeader(frontmatter!);
        // Nothing in a template's frontmatter should fall through to the plain
        // metadata panel.
        expect(rest.trim()).toBe('');
        // The two that ship filled in are the two that shouldn't be blank.
        expect(fields.version).toBe('0.1');
        expect(fields.date).toBeTruthy();
        expect(fields.classification).toBeTruthy();
      });
    }
  }
});
