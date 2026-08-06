import { describe, it, expect } from 'vitest';
import { docTemplate, fillTemplate, isoDate, toTemplateSkeleton, TEMPLATE_KINDS } from './templates';
import { extractFrontmatter, parseDocHeader } from './markdown';

describe('isoDate', () => {
  it('formats local time as YYYY-MM-DD, zero-padded', () => {
    expect(isoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(isoDate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('fillTemplate', () => {
  it('resolves {{date}}, tolerating inner spaces, every time it appears', () => {
    const out = fillTemplate('a {{date}} b {{ date }}', new Date(2026, 7, 6));
    expect(out).toBe('a 2026-08-06 b 2026-08-06');
  });
  it('leaves anything else alone — one placeholder, not a template language', () => {
    expect(fillTemplate('{{author}} {{ year }}')).toBe('{{author}} {{ year }}');
  });
  it('runs the built-ins through the same path a user template takes', () => {
    const out = fillTemplate(docTemplate('design', 'ja'), new Date(2026, 0, 5));
    expect(out).toContain('日付: 2026-01-05');
    expect(out).not.toContain('{{');
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

  it('leaves the date as a placeholder for fillTemplate to resolve', () => {
    expect(docTemplate('requirements', 'ja')).toContain('日付: {{date}}');
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

describe('toTemplateSkeleton', () => {
  const DOC = `---
タイトル: 在庫管理システム 要件定義書
文書番号: KY-REQ-2026-014
版数: 1.2
機密区分: 社外秘
tags:
  - 要件
---

## 1. 背景

現行の在庫管理は Excel 台帳で運用されており、拠点間の在庫が見えない。

> 2026 年度の重点課題として挙がっている。

## 2. 対象範囲

| 項目 | 対象 | 備考 |
| --- | --- | --- |
| 入出庫登録 | ○ | バーコード対応 |
| 棚卸 | ○ | 月次 |

\`\`\`sql
SELECT * FROM stock;
\`\`\`

## 3. 受け入れ条件

<!-- 判定できる書き方で -->

- [x] 拠点をまたいだ在庫が 5 秒以内に反映される
- [ ] 棚卸差異のレポートが出力できる
`;

  it('keeps the frontmatter keys but blanks what was filled in', () => {
    const s = toTemplateSkeleton(DOC);
    expect(s).toContain('タイトル:\n');
    expect(s).toContain('文書番号:\n');
    expect(s).toContain('版数:\n');
    expect(s).not.toContain('KY-REQ-2026-014');
    expect(s).not.toContain('1.2');
  });

  it('keeps the confidentiality marking, which belongs to the format', () => {
    // Losing this silently is the failure the header band exists to prevent.
    expect(toTemplateSkeleton(DOC)).toContain('機密区分: 社外秘');
  });

  it('drops nested YAML — it is this document\'s data, not a field to fill in', () => {
    const s = toTemplateSkeleton(DOC);
    expect(s).not.toContain('要件');
    expect(s).not.toContain('tags:');
  });

  it('keeps every heading', () => {
    const s = toTemplateSkeleton(DOC);
    expect(s).toContain('## 1. 背景');
    expect(s).toContain('## 2. 対象範囲');
    expect(s).toContain('## 3. 受け入れ条件');
  });

  it('keeps a table header and empties its body', () => {
    const s = toTemplateSkeleton(DOC);
    expect(s).toContain('| 項目 | 対象 | 備考 |');
    expect(s).toContain('| --- | --- | --- |');
    expect(s).toContain('|  |  |  |');
    expect(s).not.toContain('入出庫登録');
  });

  it('drops prose, quotes and code', () => {
    const s = toTemplateSkeleton(DOC);
    expect(s).not.toContain('Excel 台帳');
    expect(s).not.toContain('重点課題');
    expect(s).not.toContain('SELECT');
  });

  it('keeps the instructions already written as comments', () => {
    expect(toTemplateSkeleton(DOC)).toContain('<!-- 判定できる書き方で -->');
  });

  it('collapses a checklist to one unchecked item', () => {
    const s = toTemplateSkeleton(DOC);
    expect(s.match(/- \[ \]/g)).toHaveLength(1);
    expect(s).not.toContain('- [x]');
    expect(s).not.toContain('棚卸差異');
  });

  it('leaves a document with no structure empty rather than inventing one', () => {
    expect(toTemplateSkeleton('just a paragraph\n\nand another\n')).toBe('');
  });

  it('is idempotent — extracting from a skeleton gives the same skeleton', () => {
    const once = toTemplateSkeleton(DOC);
    expect(toTemplateSkeleton(once)).toBe(once);
  });

  it('turns a filled-in document into something the header still reads', () => {
    const { frontmatter } = extractFrontmatter(toTemplateSkeleton(DOC));
    const { fields, rest } = parseDocHeader(frontmatter!);
    expect(fields.classification).toBe('社外秘');
    expect(fields.title).toBeUndefined(); // blanked, and swallowed rather than shown
    expect(rest.trim()).toBe('');
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
