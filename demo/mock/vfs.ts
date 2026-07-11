// An in-memory stand-in for the Rust backend, so the real UI can run in a plain
// browser and be driven by Playwright. `src/` is untouched: the demo Vite config
// aliases every `@tauri-apps/*` entrypoint to the mocks in this directory.
//
// The app polls `file_mtime` every 1.5s and re-renders when it grows, so
// `demo.rewrite()` reproduces the genuine auto-reload path rather than faking it.

export interface Entry {
  content: string;
  mtime: number;
}

export interface Version {
  id: number;
  bytes: number;
  content: string;
}

const HOME = '/Users/you';
const NOTES = `${HOME}/notes`;

export const files = new Map<string, Entry>();
export const versions = new Map<string, Version[]>();
export let recents: string[] = [];

const README = `${NOTES}/README.md`;
const DESIGN = `${NOTES}/design.md`;

/** The app picks its UI language from navigator.language; the fixtures follow. */
export const LANG: 'ja' | 'en' =
  typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en';

const README_V1_JA = `# リリース前チェック

タグを打つ前に、真であってほしいことを並べる。

## ブロッカー

- [ ] 第三者ライセンス表記を同梱する
- [ ] Developer ID で notarize する
- [ ] Windows ビルドを落とす

## 検証

\`\`\`bash
npm run notice
npm test
\`\`\`

判断の背景は [設計メモ](./design.md) に書いてある。
`;

const README_V1_EN = `# Release checklist

What has to be true before we tag.

## Blockers

- [ ] Bundle the third-party notices
- [ ] Notarize with a Developer ID
- [ ] Drop the Windows build

## Verify

\`\`\`bash
npm run notice
npm test
\`\`\`

The reasoning lives in the [design notes](./design.md).
`;

// What the "other tool" leaves behind: a decisions section, appended.
const APPENDED_JA = `
## 決めたこと

コアは MIT のまま open-core にする。分岐点は 1.0 ではなく、最初の Pro コミット。
`;
const APPENDED_EN = `
## Decisions

The core stays MIT — open-core. The line isn't 1.0, it's the first Pro commit.
`;

const DESIGN_JA = `# 設計メモ

## なぜ open-core か

MIT を外した瞬間に、LP と README が積み上げてきた物語も、
フォークが別プラットフォーム版を出せる自由も、同時に失われる。

守るのはコアの秘匿性ではなく、Pro 機能の所在。
`;
const DESIGN_EN = `# Design notes

## Why open-core

Drop MIT and you lose the story the site and README have been telling,
and the freedom for a fork to ship the platform you dropped.

What you protect isn't the core's secrecy. It's where the Pro features live.
`;

const README_V1 = LANG === 'ja' ? README_V1_JA : README_V1_EN;
const README_V2 = README_V1 + (LANG === 'ja' ? APPENDED_JA : APPENDED_EN);
const DESIGN_DOC = LANG === 'ja' ? DESIGN_JA : DESIGN_EN;

/** Strings the recording script waits on, so it never hardcodes a language. */
export const needles =
  LANG === 'ja'
    ? { appended: '決めたこと', oldest: 'まだ何も決まっていない' }
    : { appended: 'Decisions', oldest: 'Nothing decided yet' };

const NOTICE_STUB = `# サードパーティ・ライセンス / Third-Party Notices

同梱パッケージ数 / Bundled packages: **566** (npm: 110, Rust: 456)
`;

/** Reset to the state every recording starts from. */
export function seed() {
  files.clear();
  versions.clear();
  recents = [README, DESIGN];

  const t0 = Date.UTC(2026, 6, 10, 9, 0, 0);
  files.set(README, { content: README_V1, mtime: t0 });
  files.set(DESIGN, { content: DESIGN_DOC, mtime: t0 });
  files.set('/app/resources/THIRD-PARTY-NOTICES.md', { content: NOTICE_STUB, mtime: t0 });

  // A history worth opening: two earlier saves of the checklist.
  const oldest =
    LANG === 'ja'
      ? '# リリース前チェック\n\nまだ何も決まっていない。\n'
      : '# Release checklist\n\nNothing decided yet.\n';
  versions.set(README, [
    { id: t0 - 3_600_000, bytes: oldest.length, content: oldest },
    { id: t0 - 600_000, bytes: README_V1.length, content: README_V1 },
  ]);
}

seed();

/** Control surface the Playwright scenario drives. */
export const demo = {
  HOME,
  NOTES,
  README,
  DESIGN,
  LANG,
  needles,

  /** Simulate another process rewriting the file, tripping the mtime poll. */
  rewrite(path: string, content: string) {
    const e = files.get(path);
    files.set(path, { content, mtime: (e?.mtime ?? 0) + 60_000 });
  },

  /** The rewrite the demo performs, kept next to the fixtures it belongs to. */
  rewriteReadme() {
    demo.rewrite(README, README_V2);
  },

  seed,
};

declare global {
  interface Window {
    __demo: typeof demo;
    __dropHandler?: (event: { payload: { type: string; paths?: string[] } }) => void;
    /** Last `set_document_open` the app sent — a browser has no native menu to inspect. */
    __menuDocOpen?: boolean;
    /** Fire a Tauri event the app listens for, e.g. `__emit('menu', 'outline')`. */
    __emit?: (event: string, payload: unknown) => void;
  }
}

if (typeof window !== 'undefined') window.__demo = demo;
