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

export type VersionKind = 'save' | 'external' | 'git' | 'draft';

export interface Version {
  id: number;
  bytes: number;
  content: string;
  kind: VersionKind;
}

const HOME = '/Users/you';
const NOTES = `${HOME}/notes`;

export interface GitRef {
  id: string;
  kind: 'branch' | 'commit';
  label: string;
  subject: string | null;
}

export const files = new Map<string, Entry>();
export const versions = new Map<string, Version[]>();
/** Content at Git HEAD, for the files the fixtures treat as committed. */
export const committed = new Map<string, string>();
/** Branches and commits a file can be diffed against (`git_refs`). */
export const refs = new Map<string, GitRef[]>();
/** A file's content at a given ref, keyed `path\0rev` (`git_ref_content`). */
export const refContent = new Map<string, string>();
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

// What an agent leaves behind. It ticks a different blocker *and* rewrites the
// same line the user is about to touch — so the recording shows both a change
// that merges cleanly and one that genuinely collides.
const AGENT_JA = `# リリース前チェック

タグを打つ前に、真であってほしいことを並べる。

## ブロッカー

- [x] 第三者ライセンス表記を同梱する
- [ ] Developer ID で notarize する
- [ ] DMG を staple する

## 検証

\`\`\`bash
npm run notice
npm test
\`\`\`

判断の背景は [設計メモ](./design.md) に書いてある。
`;
const AGENT_EN = `# Release checklist

What has to be true before we tag.

## Blockers

- [x] Bundle the third-party notices
- [ ] Notarize with a Developer ID
- [ ] Staple the DMG

## Verify

\`\`\`bash
npm run notice
npm test
\`\`\`

The reasoning lives in the [design notes](./design.md).
`;

const README_V1 = LANG === 'ja' ? README_V1_JA : README_V1_EN;
const README_V2 = README_V1 + (LANG === 'ja' ? APPENDED_JA : APPENDED_EN);
const README_AGENT = LANG === 'ja' ? AGENT_JA : AGENT_EN;
const DESIGN_DOC = LANG === 'ja' ? DESIGN_JA : DESIGN_EN;

/** Strings the recording script waits on, so it never hardcodes a language. */
export const needles =
  LANG === 'ja'
    ? {
        appended: '決めたこと',
        oldest: 'まだ何も決まっていない',
        /** The line the user ticks — and the agent rewrites out from under them. */
        contested: 'Windows',
        agentLine: 'DMG',
      }
    : {
        appended: 'Decisions',
        oldest: 'Nothing decided yet',
        contested: 'Windows',
        agentLine: 'DMG',
      };

const NOTICE_STUB = `# サードパーティ・ライセンス / Third-Party Notices

同梱パッケージ数 / Bundled packages: **566** (npm: 110, Rust: 456)
`;

/** Reset to the state every recording starts from. */
export function seed() {
  files.clear();
  versions.clear();
  committed.clear();
  refs.clear();
  refContent.clear();
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
    { id: t0 - 3_600_000, bytes: oldest.length, content: oldest, kind: 'save' },
    { id: t0 - 600_000, bytes: README_V1.length, content: README_V1, kind: 'save' },
  ]);

  // The checklist is committed; the design notes are not, so the UI's "no Git to
  // compare against" path is exercised by the same fixtures.
  committed.set(README, oldest);

  // A branch an agent pushed, plus the two commits behind the file — the targets
  // the "add a Git version" picker offers, and the review case it's built for.
  const branch = 'agent/release-polish';
  const c1 = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
  const c0 = 'f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1';
  refs.set(README, [
    { id: branch, kind: 'branch', label: branch, subject: null },
    { id: c1, kind: 'commit', label: c1.slice(0, 7), subject: LANG === 'ja' ? '本文を追記' : 'flesh out the checklist' },
    { id: c0, kind: 'commit', label: c0.slice(0, 7), subject: LANG === 'ja' ? '最初のコミット' : 'first commit' },
  ]);
  refContent.set(`${README}\0${branch}`, README_AGENT);
  refContent.set(`${README}\0${c1}`, README_V1);
  refContent.set(`${README}\0${c0}`, oldest);
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

  /** Test hook: present a file as absent from HEAD (no committed content) yet
   *  alive in history (refs to compare against) — the pre-merge review case. */
  historyOnly(path: string, list: GitRef[], contents: Array<[string, string]>) {
    committed.delete(path);
    refs.set(path, list);
    for (const [rev, c] of contents) refContent.set(`${path}\0${rev}`, c);
  },

  /** The rewrite the demo performs, kept next to the fixtures it belongs to. */
  rewriteReadme() {
    demo.rewrite(README, README_V2);
  },

  /**
   * An agent rewrites the checklist while the user is editing it. It ticks a
   * blocker they didn't touch (which merges) and rewrites the very line they
   * just ticked (which collides) — the two cases the three-way view exists for.
   */
  agentRewrite() {
    demo.rewrite(README, README_AGENT);
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
    /** What the next file dialog should return — a browser has none. */
    __pick?: string[];
  }
}

if (typeof window !== 'undefined') window.__demo = demo;
