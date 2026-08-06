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

export type TemplateKind = 'design' | 'requirements';
export const TEMPLATE_KINDS: TemplateKind[] = ['design', 'requirements'];

/** `YYYY-MM-DD` in local time — a document is dated where its author is. */
export function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const JA = {
  design: (date: string) => `---
タイトル:
文書番号:
版数: 0.1
日付: ${date}
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
  requirements: (date: string) => `---
タイトル:
文書番号:
版数: 0.1
日付: ${date}
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
  design: (date: string) => `---
title:
doc:
version: 0.1
date: ${date}
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
  requirements: (date: string) => `---
title:
doc:
version: 0.1
date: ${date}
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
 * own; the header keys differ to match ([[parseDocHeader]] accepts both).
 */
export function docTemplate(kind: TemplateKind, lang: Lang, today: Date = new Date()): string {
  return (lang === 'ja' ? JA : EN)[kind](isoDate(today));
}
