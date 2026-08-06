// Starting points for the documents MRDown is built to carry: a design doc and
// a requirements doc. Deliberately skeletons — headings, empty tables and a
// prompt of what belongs in each section, and no prose. A filled-in template
// reads as "this is how MRDown thinks a spec should be written", which is
// exactly wrong for a company whose format differs; an empty one is a scaffold
// either kind of reader can work with.
//
// The frontmatter is the point of contact with the document header: the keys
// here are the ones parseDocHeader() draws as the band, so a document started
// from a template shows its letterhead the moment a title is typed.

import type { Lang } from './i18n';
import { docHeaderFieldFor } from './markdown';

export type TemplateKind = 'design' | 'requirements';
export const TEMPLATE_KINDS: TemplateKind[] = ['design', 'requirements'];

/** `YYYY-MM-DD` in local time — a document is dated where its author is. */
export function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const JA = {
  design: `---
タイトル:
文書番号:
版数: 0.1
日付: {{date}}
作成者:
機密区分: 社外秘
---

## 1. 目的

<!-- この設計で何を実現するか -->

## 2. 背景

<!-- なぜ今これをやるのか。現状の何が困っているのか -->

## 3. 全体構成

<!-- 主要な要素と、その関係 -->

## 4. 詳細

### 4.1

## 5. 検討した代替案

<!-- 採らなかった案も残す。後から「なぜこうなっているのか」を辿れるように -->

| 案 | 採否 | 理由 |
| --- | --- | --- |
|  |  |  |

## 6. 影響範囲

| 対象 | 影響 | 対応 |
| --- | --- | --- |
|  |  |  |

## 7. 未決事項

- [ ]
`,
  requirements: `---
タイトル:
文書番号:
版数: 0.1
日付: {{date}}
作成者:
機密区分: 社外秘
---

## 1. 背景

<!-- 現状と、その何が問題なのか -->

## 2. 目的とゴール

<!-- 達成された状態を、判定できる書き方で -->

## 3. 対象範囲

| 項目 | 対象 | 備考 |
| --- | --- | --- |
|  |  |  |

## 4. 機能要件

| ID | 要件 | 優先度 |
| --- | --- | --- |
| FR-1 |  |  |

## 5. 非機能要件

| 項目 | 要求 |
| --- | --- |
| 性能 |  |
| 可用性 |  |
| セキュリティ |  |

## 6. 制約・前提

## 7. 受け入れ条件

<!-- これが満たされたら完了、と言い切れるもの -->

- [ ]

## 8. 未決事項

- [ ]
`,
};

const EN = {
  design: `---
title:
doc:
version: 0.1
date: {{date}}
author:
classification: Confidential
---

## 1. Purpose

<!-- What this design sets out to achieve -->

## 2. Background

<!-- Why now. What the current situation makes difficult -->

## 3. Overview

<!-- The main pieces, and how they relate -->

## 4. Detail

### 4.1

## 5. Alternatives considered

<!-- Keep the ones you rejected. Later readers need to know why it looks like this -->

| Option | Decision | Reasoning |
| --- | --- | --- |
|  |  |  |

## 6. Impact

| Area | Effect | Action |
| --- | --- | --- |
|  |  |  |

## 7. Open questions

- [ ]
`,
  requirements: `---
title:
doc:
version: 0.1
date: {{date}}
author:
classification: Confidential
---

## 1. Background

<!-- Where things stand, and what about it is a problem -->

## 2. Goals

<!-- The finished state, written so you can tell whether you got there -->

## 3. Scope

| Item | In scope | Notes |
| --- | --- | --- |
|  |  |  |

## 4. Functional requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-1 |  |  |

## 5. Non-functional requirements

| Aspect | Requirement |
| --- | --- |
| Performance |  |
| Availability |  |
| Security |  |

## 6. Constraints and assumptions

## 7. Acceptance criteria

<!-- The things that let you say it is done -->

- [ ]

## 8. Open questions

- [ ]
`,
};

/**
 * The template body for a kind, in the app's language. Bilingual side-by-side
 * would only mean deleting half of it before writing, so each language gets its
 * own; the header keys differ to match (parseDocHeader accepts both).
 *
 * Still holds its placeholders — fillTemplate() resolves them, so the built-ins
 * and a template the user wrote take exactly the same path.
 */
export function docTemplate(kind: TemplateKind, lang: Lang): string {
  return (lang === 'ja' ? JA : EN)[kind];
}

/**
 * Resolve the placeholders a template may carry, on the way into the editor.
 *
 * Deliberately one placeholder. `{{date}}` is the one a document can't sensibly
 * ship without and can't be typed once and reused; everything past it —
 * `{{author}}`, `{{year}}`, conditionals — is the start of a small template
 * language, and a Markdown editor is the wrong place to grow one.
 */
export function fillTemplate(text: string, today: Date = new Date()): string {
  return text.replace(/\{\{\s*date\s*\}\}/g, isoDate(today));
}

/**
 * Strip a filled-in document down to its shape, so a document you liked — one
 * you wrote, or one a client sent — can become a template without retyping it.
 * This is the mechanical half of what turning a real spec into a skeleton
 * involves; the judgement half stays with the author.
 *
 * Kept: frontmatter keys, headings, table headers, one task-list item per run,
 * HTML comments (already instructions), thematic breaks.
 * Dropped: prose, quotes, code, images, plain lists, table bodies.
 *
 * The one place it can't be right by construction is prose — a single line
 * under a heading may be the section's instructions or may be its content, and
 * nothing in the text says which. It is dropped, which is why the caller must
 * open the result for review instead of saving it: a wrong guess then costs one
 * undo, not a bad template kept forever.
 */
export function toTemplateSkeleton(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  let i = 0;

  if (/^---[ \t]*$/.test(lines[0] ?? '')) {
    let end = -1;
    for (let n = 1; n < lines.length; n++) {
      if (/^(---|\.\.\.)[ \t]*$/.test(lines[n])) {
        end = n;
        break;
      }
    }
    if (end > 0) {
      const kept: string[] = [];
      const fm = lines.slice(1, end);
      for (let n = 0; n < fm.length; n++) {
        // Flat `key: value` only. Nested YAML is this document's own data, not
        // a field the next author is meant to fill in.
        const m = /^([^\s:][^:]*?)[ \t]*:[ \t]*(.*)$/.exec(fm[n]);
        if (!m) continue;
        // `tags:` with its list indented underneath is that same data wearing a
        // flat key. Keeping the bare key would leave the new document showing a
        // metadata panel holding one empty word.
        if (m[2].trim() === '' && /^[ \t]+\S/.test(fm[n + 1] ?? '')) continue;
        // The confidentiality marking belongs to the format rather than to the
        // document, and a template that quietly drops it is exactly the failure
        // the header band exists to prevent. Every other value starts blank.
        const keepValue = docHeaderFieldFor(m[1]) === 'classification' && m[2].trim() !== '';
        kept.push(keepValue ? `${m[1]}: ${m[2].trim()}` : `${m[1]}:`);
      }
      if (kept.length) blocks.push(['---', ...kept, '---'].join('\n'));
      i = end + 1;
    }
  }

  let table: string[] = [];
  const flushTable = () => {
    // A header and its delimiter make a table; a stray pipe line is prose.
    const sep = table[1] ?? '';
    if (table.length >= 2 && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(sep)) {
      const cols = sep.split('|').filter((c) => c.trim() !== '').length;
      blocks.push([table[0].trimEnd(), sep.trimEnd(), `|${'  |'.repeat(Math.max(1, cols))}`].join('\n'));
    }
    table = [];
  };

  let lastWasTask = false;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const text = line.trim();

    if (/^(```|~~~)/.test(text)) {
      // Skip the fence whole — a code block is never the shape of a document.
      for (i++; i < lines.length && !/^(```|~~~)/.test(lines[i].trim()); i++);
      continue;
    }

    if (text.startsWith('|')) {
      table.push(line);
      continue;
    }
    if (table.length) flushTable();

    if (/^#{1,6}\s/.test(text)) {
      blocks.push(text);
      lastWasTask = false;
      continue;
    }
    if (text.startsWith('<!--')) {
      const comment = [line.trimEnd()];
      while (!comment.join('\n').includes('-->') && i + 1 < lines.length) comment.push(lines[++i].trimEnd());
      blocks.push(comment.join('\n'));
      lastWasTask = false;
      continue;
    }
    if (/^[-*+][ \t]+\[[ xX]\]/.test(text)) {
      // The shape is "there is a checklist here", not how long this one ran.
      if (!lastWasTask) blocks.push('- [ ]');
      lastWasTask = true;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(text)) {
      blocks.push('---');
      lastWasTask = false;
      continue;
    }
    if (text !== '') lastWasTask = false;
  }
  if (table.length) flushTable();

  return blocks.length ? `${blocks.join('\n\n')}\n` : '';
}
