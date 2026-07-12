// Tiny i18n for the window UI — a ja/en dictionary plus a `t()` lookup, no
// dependency. Language defaults to the OS locale and can be overridden (and
// persisted) from Settings; clearing the override falls back to the OS again.

export type Lang = 'ja' | 'en';

const DICT = {
  ja: {
    // toolbar
    btnSidebar: '文書一覧 (⌘1)',
    btnOpen: 'ファイルを開く',
    btnNew: '新規作成 (⌘N)',
    btnNewLabel: '新規',
    btnReload: '再読み込み (⌘R)',
    btnSave: '保存',
    btnDelete: 'ゴミ箱に移動 (⌘⌫)',
    btnHistory: '履歴',
    btnSettings: '設定 (⌘,)',
    edit: '編集',
    preview: 'プレビュー',
    // find
    findPlaceholder: '検索',
    findPrev: '前へ',
    findNext: '次へ',
    replacePlaceholder: '置換',
    replaceOne: '置換',
    replaceAll: 'すべて置換',
    optCase: '大文字と小文字を区別',
    optWord: '単語単位で検索',
    optRegex: '正規表現',
    // history
    historyTitle: '履歴',
    historyRestore: '基準の版に戻す',
    historyEmpty: 'まだ保存された版がありません。保存すると版が記録されます。',
    historyReadFailed: 'この版を読み込めませんでした。',
    // diff
    diffBase: '基準',
    diffCompare: '比較',
    historyCurrent: '現在の本文',
    diffNoChanges: 'この2つの版に違いはありません。',
    diffGap: '{n} 行省略',
    diffSamePick: '同じ版どうしは比較できません。',
    gitHead: 'HEAD（Git）',
    // conflict (the file changed on disk while editing)
    conflictText: 'ディスク上のファイルが、あなたの編集中に書き換えられました。',
    conflictView: '差分を見る',
    conflictKeepMine: '自分の編集で上書き',
    conflictTakeTheirs: 'ディスクを読み直す',
    conflictSafe: 'どちらを選んでも、両方の版は履歴に残ります。',
    threeBase: '最後の保存',
    threeTheirs: 'ディスク（外部の変更）',
    threeOurs: '自分の編集',
    threeConflicts: '衝突 {n} 行',
    threeNone: '衝突はありません。',
    backToVersions: '版の比較に戻る',
    // sidebar
    sidebarHeader: '開いている文書',
    folderOpen: 'フォルダを開く',
    folderClose: 'フォルダを閉じる',
    folderEmpty: 'Markdown ファイルがありません',
    close: '閉じる',
    // empty state
    emptyTitle: 'Markdownファイルを開いてください',
    emptyHint: '⌘O ・ボタン ・ドラッグ&ドロップ',
    recentTitle: '最近のファイル',
    // preview
    frontmatter: 'メタデータ',
    // settings
    settingsTitle: '設定',
    toolbarSection: 'ツールバーに表示するボタン',
    widthSection: 'プレビューの幅',
    widthFull: '全幅',
    licensesSection: 'ライセンス',
    licensesOpen: 'サードパーティ・ライセンス',
    outlineHeader: 'アウトライン',
    copyCode: 'コピー',
    copied: 'コピーしました',
    statsChars: '字',
    statsReadPrefix: '約',
    statsMin: '分',
    appearanceSection: '外観',
    accentLabel: 'アクセントカラー',
    bgLabel: '背景色',
    textLabel: '文字色',
    fontLabel: '本文フォント',
    fontSizeLabel: '本文サイズ',
    colorSystem: 'システム',
    colorDefault: '既定',
    colorCustom: 'カスタム…',
    fontSystem: 'システム (SF)',
    fontSerif: 'セリフ',
    fontRounded: 'ラウンド',
    outlinePosLabel: 'アウトラインの位置',
    outlinePosLeft: '左サイドバー内',
    outlinePosRight: '右',
    langSection: '言語',
    langSystem: 'システムに従う',
    groupInline: 'インライン',
    groupBlock: 'ブロック',
    // format actions
    fmtBold: '太字',
    fmtItalic: '斜体',
    fmtStrike: '取り消し線',
    fmtCode: 'コード',
    fmtLink: 'リンク',
    fmtImage: '画像',
    fmtHeading: '見出し',
    fmtList: 'リスト',
    fmtOrdered: '番号付きリスト',
    fmtChecklist: 'チェックリスト',
    fmtQuote: '引用',
    fmtCodeblock: 'コードブロック',
    fmtTable: '表',
    fmtHr: '水平線',
    // dialogs / messages
    openFailed: '開けませんでした: {e}',
    saveFailed: '保存できませんでした: {e}',
    deleteFailed: '削除できませんでした: {e}',
    deleteConfirm: '「{name}」をゴミ箱に移動します。',
    deleteTitle: 'ファイルを削除',
    deleteOk: 'ゴミ箱に入れる',
    cancel: 'キャンセル',
    closeConfirm: '「{name}」は未保存です。閉じますか？',
  },
  en: {
    btnSidebar: 'Documents (⌘1)',
    btnOpen: 'Open File',
    btnNew: 'New (⌘N)',
    btnNewLabel: 'New',
    btnReload: 'Reload (⌘R)',
    btnSave: 'Save',
    btnDelete: 'Move to Trash (⌘⌫)',
    btnHistory: 'History',
    btnSettings: 'Settings (⌘,)',
    edit: 'Edit',
    preview: 'Preview',
    findPlaceholder: 'Find',
    findPrev: 'Previous',
    findNext: 'Next',
    replacePlaceholder: 'Replace',
    replaceOne: 'Replace',
    replaceAll: 'Replace all',
    optCase: 'Match case',
    optWord: 'Match whole word',
    optRegex: 'Regular expression',
    historyTitle: 'History',
    historyRestore: 'Restore the base version',
    historyEmpty: 'No saved versions yet. Versions are recorded when you save.',
    historyReadFailed: 'Could not read this version.',
    diffBase: 'Base',
    diffCompare: 'Compare',
    historyCurrent: 'Current text',
    diffNoChanges: 'These two versions are identical.',
    diffGap: '{n} unchanged lines',
    diffSamePick: "A version can't be compared with itself.",
    gitHead: 'HEAD (Git)',
    conflictText: 'This file was rewritten on disk while you were editing it.',
    conflictView: 'Show the differences',
    conflictKeepMine: 'Overwrite with my edits',
    conflictTakeTheirs: 'Reload from disk',
    conflictSafe: 'Either way, both versions are kept in the history.',
    threeBase: 'Last save',
    threeTheirs: 'On disk (changed elsewhere)',
    threeOurs: 'My edits',
    threeConflicts: '{n} conflicting lines',
    threeNone: 'No conflicting lines.',
    backToVersions: 'Back to comparing versions',
    sidebarHeader: 'Open Documents',
    folderOpen: 'Open folder',
    folderClose: 'Close folder',
    folderEmpty: 'No Markdown files here',
    close: 'Close',
    emptyTitle: 'Open a Markdown file',
    emptyHint: '⌘O · button · drag & drop',
    recentTitle: 'Recent Files',
    frontmatter: 'Metadata',
    settingsTitle: 'Settings',
    toolbarSection: 'Toolbar buttons',
    widthSection: 'Preview width',
    widthFull: 'Full',
    licensesSection: 'Licenses',
    licensesOpen: 'Third-party licenses',
    outlineHeader: 'Outline',
    copyCode: 'Copy',
    copied: 'Copied',
    statsChars: 'chars',
    statsReadPrefix: '~',
    statsMin: ' min',
    appearanceSection: 'Appearance',
    accentLabel: 'Accent color',
    bgLabel: 'Background',
    textLabel: 'Text color',
    fontLabel: 'Body font',
    fontSizeLabel: 'Body size',
    colorSystem: 'System',
    colorDefault: 'Default',
    colorCustom: 'Custom…',
    fontSystem: 'System (SF)',
    fontSerif: 'Serif',
    fontRounded: 'Rounded',
    outlinePosLabel: 'Outline position',
    outlinePosLeft: 'In the left sidebar',
    outlinePosRight: 'Right',
    langSection: 'Language',
    langSystem: 'Use system language',
    groupInline: 'Inline',
    groupBlock: 'Block',
    fmtBold: 'Bold',
    fmtItalic: 'Italic',
    fmtStrike: 'Strikethrough',
    fmtCode: 'Code',
    fmtLink: 'Link',
    fmtImage: 'Image',
    fmtHeading: 'Heading',
    fmtList: 'List',
    fmtOrdered: 'Numbered list',
    fmtChecklist: 'Checklist',
    fmtQuote: 'Quote',
    fmtCodeblock: 'Code block',
    fmtTable: 'Table',
    fmtHr: 'Horizontal rule',
    openFailed: "Couldn't open: {e}",
    saveFailed: "Couldn't save: {e}",
    deleteFailed: "Couldn't delete: {e}",
    deleteConfirm: 'Move “{name}” to the Trash.',
    deleteTitle: 'Delete file',
    deleteOk: 'Move to Trash',
    cancel: 'Cancel',
    closeConfirm: '“{name}” has unsaved changes. Close it?',
  },
} as const;

export type Key = keyof (typeof DICT)['ja'];

const LANG_KEY = 'mrdown.lang';

/** OS-derived language when there's no explicit override. */
function systemLang(): Lang {
  return (navigator.language || '').toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

function resolve(): Lang {
  const stored = localStorage.getItem(LANG_KEY);
  return stored === 'ja' || stored === 'en' ? stored : systemLang();
}

let lang: Lang = resolve();

export function getLang(): Lang {
  return lang;
}

/** True when following the OS language (no explicit override stored). */
export function isSystemLang(): boolean {
  const stored = localStorage.getItem(LANG_KEY);
  return stored !== 'ja' && stored !== 'en';
}

/** Set an explicit language, or pass 'system' to follow the OS again. */
export function setLang(value: Lang | 'system') {
  if (value === 'system') localStorage.removeItem(LANG_KEY);
  else localStorage.setItem(LANG_KEY, value);
  lang = resolve();
}

export function t(key: Key, params?: Record<string, string>): string {
  let s: string = DICT[lang][key] ?? DICT.ja[key];
  if (params) for (const k in params) s = s.split(`{${k}}`).join(params[k]);
  return s;
}
