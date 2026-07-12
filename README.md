# MRDown

Tauri + TypeScript で作られた、ミニマルで高速な Markdown ビューア & エディタ。
A minimal, fast Markdown viewer & editor built with Tauri + TypeScript.

## 特徴 / Features

- Markdown ファイル（`.md` / `.markdown` / `.txt`）を開いて表示。 / Open and render Markdown files (`.md`, `.markdown`, `.txt`).
- 新規作成（`⌘N`）して保存ダイアログから任意の場所へ保存。無題の文書は最初の `#` 見出しがファイル名の候補になります。 / Create a new document (`⌘N`) and save it anywhere via a save dialog; an untitled doc's first `#` heading is offered as the file name.
- 現在のファイルをシステムのゴミ箱へ削除（`⌘⌫` またはゴミ箱ボタン、確認あり）。間違えてもゴミ箱から復元できます。 / Delete the current file to the system Trash (`⌘⌫` or the trash button), with a confirmation — recoverable from the Trash if it was a mistake.
- 分割エディタ＋ライブプレビューで編集（`⌘E` で切替）、`⌘S` で保存、「別名で保存…」（`⌘⇧S`）で別の場所へコピーを書き出し。仕切りをドラッグしてペイン幅を調整。 / Edit with a split editor + live preview (`⌘E` to toggle), save with `⌘S` or "Save As…" (`⌘⇧S`) to write a copy elsewhere; drag the divider to resize the panes.
- 文書内の検索＆置換（`⌘F`）：編集中はソースを検索して全ヒットをハイライト（現在位置を強調）、プレビューではレンダリング後のテキストを検索するのでインライン装飾をまたいだマッチも可能（例：`**bold**` を跨ぐ）。正規表現・大小区別・単語単位のトグル（記憶される）、`Enter` / `⇧Enter` で移動、編集中は1件ずつ／一括で置換（`⌘Z` で取り消し可）。 / Find & replace in the current document (`⌘F`): while editing it searches the source and highlights every hit (the current one emphasized); in preview it searches the rendered text so matches can span inline formatting (e.g. across `**bold**`). Regex, case-sensitive and whole-word toggles (remembered); step with `Enter` / `⇧Enter`; replace one or all while editing (undoable with `⌘Z`).
- **履歴と差分**：保存するたび、そして**外部から書き換えられるたび**に、タイムスタンプ付きの版を静かに記録。履歴パネル（時計アイコン）で**任意の2版を選んで差分を並べて読めます**（変わった語だけを強調、無変更行は折りたたみ）。Git リポジトリなら `HEAD` も同じ一覧に並ぶので、**コミット済みとの差分**もそのまま見られます。任意の版はワンクリックでエディタに復元でき、非破壊（保存するまで何も書き込まれません）。版はアプリのデータディレクトリに保存されるので、ファイルや Git リポジトリを汚しません。**Git は無くても動きます。** / **History and diffs**: every save — and every rewrite from outside the app — quietly keeps a timestamped version. The History panel (clock icon) puts **any two versions side by side** so you can read what changed (only the words that differ are marked; unchanged runs are folded away). In a Git repository, `HEAD` joins the same list, so **the diff against what's committed** is right there. Restore any version into the editor in one click, non-destructively (nothing is written until you save). Versions live in the app's data directory, so they never clutter your files or Git repos. **Git is optional.**
- **編集中に書き換えられても、どちらも失いません**：AI エージェントなどがディスク上のファイルを書き換えたとき、あなたに未保存の編集があれば、黙って上書きすることも黙って読み直すこともしません。ディスク側の版はその場で履歴に退避され、あなたの未保存編集も捨てる前に退避されます。**「最後の保存 / ディスク / 自分の編集」を3列で並べ**、双方が同じ行を別々に直したところだけを衝突として示します。版には出所（保存／外部の書き換え／コミット済みの版に戻った／退避した下書き）が記録されます。なお**どのアプリが書き換えたかは macOS が記録していないため分かりません**が、内容がコミット済みの版と一致した場合だけは Git の仕業と断定できます。 / **Nothing is lost when an agent rewrites the file under you**: if something changes the file on disk while you have unsaved edits, MRDown neither overwrites it silently nor reloads over you. The disk's version is snapshotted the moment it's seen, and your unsaved edits are snapshotted before they're discarded. **Three columns — last save, what's on disk, your edits** — with only the lines you both rewrote differently marked as conflicts. Versions record where they came from (saved / changed elsewhere / back to the committed version / rescued draft). *Which* application wrote a file isn't knowable — macOS doesn't record it — except for Git: content matching the committed blob byte-for-byte was Git putting the file back.
- エディタ上部の書式ツールバー：太字（`⌘B`）、斜体（`⌘I`）、見出し、リスト、引用、リンクなど。選択範囲の Markdown 記法をトグル／挿入します（`⌘Z` で取り消し可）。 / Formatting toolbar above the editor: bold (`⌘B`), italic (`⌘I`), heading, list, quote, link, and more — each toggles/inserts the Markdown syntax around the selection (undoable with `⌘Z`).
- 書き味を整えるタイピング支援：リストは `Enter` で自動継続（順序付きは採番、タスクは未チェックで開始、空項目で `Enter` すると解除）、`Tab` / `⇧Tab` でインデント、`[` `(` `` ` `` は対の閉じを自動挿入（選択範囲があれば囲む）。すべて `⌘Z` で取り消せます。 / Typing niceties: `Enter` continues a list (ordered items renumber, task items start unchecked, `Enter` on an empty item exits), `Tab` / `⇧Tab` indent, and `[`, `(`, `` ` `` auto-close — wrapping the selection when there is one. All undoable with `⌘Z`.
- テキストを選択して URL を貼るとリンク（`[選択](url)`）に変換。画像を貼り付けると、文書と同じ場所の `assets/` に保存して `![]()` を挿入します。 / Paste a URL over selected text to turn it into a link (`[selection](url)`); paste an image to save it beside the document in `assets/` and insert the `![]()` for it.
- 文字数と推定読了時間をツールバーに表示（日本語は1文字ずつ、英語は語数で見積もり）。編集中は編集ペインとプレビューのスクロールが同期します。 / Character count and estimated reading time in the toolbar (CJK counted per character, space-delimited text by words). While editing, the editor and preview scroll in sync.
- 設定（`⌘,`）でツールバーをカスタマイズ：14 種の Markdown アクション（取り消し線、番号付き／チェックリスト、コードブロック、画像、表、水平線 …）のオン／オフを切替（選択は記憶されます）。 / Customise the toolbar in Settings (`⌘,`): turn any of the 14 Markdown actions (strikethrough, ordered/checklist, code block, image, table, horizontal rule, …) on or off; the choice is remembered.
- 日本語／英語 UI：既定では OS の言語に従い、設定で切替可能。ネイティブメニュー（File / Edit / View）もローカライズ済み。 / Japanese / English UI: follows your OS language by default and can be switched in Settings; the native menu (File / Edit / View) is localized too.
- 外観を設定（`⌘,`）でカスタマイズ：アクセントカラー（macOS のシステムアクセント色に追従、またはプリセット／任意の色）、背景色・文字色（プリセット＋カラーピッカー）、本文フォント（システム／セリフ／ラウンド）と文字サイズ。背景・文字色はドキュメントだけでなく、サイドバーやツールバーを含むウィンドウ全体に反映されます。 / Customise the look in Settings (`⌘,`): accent color (follows the macOS system accent, or a preset / any custom color), background and text colors (presets + a color picker), body font (system / serif / rounded) and size — background and text apply to the whole window, sidebar and toolbar included, not just the document.
- 複数の文書をサイドバーに並べて保持（BBEdit 風）：クリックで切替、丸い × で閉じる（`⌘W`）、`⌘1` でサイドバーを開閉。開いていたセットは次回起動時に復元。 / Keep multiple documents open in a sidebar (BBEdit-style): click to switch, close with the circled × (`⌘W`), toggle the sidebar with `⌘1`; the open set is restored on next launch.
- 「フォルダを開く」でフォルダ内の Markdown をまとめて閲覧：左のツリーからファイルを選んで切替、サブフォルダは展開／折りたたみできます。開いていたフォルダは次回起動時に復元。 / Open a folder to browse its Markdown files as a set: pick files from a left-hand tree and expand/collapse subfolders; the opened folder is restored on next launch.
- 見出しのアウトライン（目次）を本文の右に独立した列で表示：クリックでその見出しへスクロールし、読んでいる位置の見出しが自動でハイライトされます。`⌘2` で開閉、編集中も内容にライブ追従。分割エディタにプレビューの幅を譲るため**編集中は既定で非表示**ですが、`⌘2` で出せばそのまま覚えます（表示状態はプレビュー／編集それぞれで記憶）。設定（`⌘,`）で左サイドバー内に戻すこともできます（そのときは折りたたみ可）。 / Outline (table of contents) in a column of its own, to the right of the document: click a heading to jump to it, and the heading you're reading is highlighted as you scroll. Toggle it with `⌘2`; it follows the document live while you edit. It's **hidden by default while editing**, so the split editor and preview keep their width — bring it back with `⌘2` and it stays (visibility is remembered separately for preview and edit). Settings (`⌘,`) can move it back into the left sidebar instead (where it stays collapsible).
- 未保存の作業を失わない：編集中の内容（およびディスクに未書き出しの無題文書）は下書きとして継続的に保持され、次回起動時に復元。終了やクラッシュでも書きかけを失いません。 / Never lose unsaved work: in-progress edits (and untitled documents that were never written to disk) are continuously kept as drafts and restored on next launch, so a quit or crash won't discard what you were writing.
- ダブルクリックや「このアプリで開く」（対象拡張子のハンドラとして登録）、ボタン、`⌘O`、ウィンドウへのドラッグでファイルを開けます。 / Open files by double-clicking or "Open With" (registered as a handler for those extensions), the button, `⌘O`, or by dragging a file onto the window.
- 開いているファイルがディスク上で変更されると自動リロード（スクロール位置は保持）。 / Auto-reloads when the open file changes on disk (scroll position preserved).
- スタート画面に最近使ったファイル一覧を表示し、素早く再オープン。 / Recent files list on the start screen for quick reopening.
- 表、コードブロック、引用、ローカル画像をレンダリング（相対パスはファイル基準で解決）。 / Renders tables, code blocks, quotes, and local images (relative paths resolve against the file).
- 文書の YAML frontmatter（先頭の `---` … `---` ブロック）を、`title:` / `tags:` を本文に漏らさず、畳んだメタ情報カードとして表示。 / Renders a document's YAML frontmatter (the leading `---` … `---` block) as a tidy collapsed metadata card instead of leaking `title:`/`tags:` lines into the body.
- フェンス付きコードブロックを [highlight.js](https://highlightjs.org/) でシンタックスハイライト（共通バンドルを遅延読み込み、ダークテーマに調整）。 / Syntax-highlights fenced code blocks with [highlight.js](https://highlightjs.org/) (lazy-loaded common bundle; tuned to the dark theme).
- ```` ```mermaid ```` コードブロック内の [Mermaid](https://mermaid.js.org/) 図をレンダリング（遅延読み込み、構文エラー時はソースにフォールバック）。 / Renders [Mermaid](https://mermaid.js.org/) diagrams in ```` ```mermaid ```` code blocks (lazy-loaded; falls back to source on syntax errors).
- 数式を [KaTeX](https://katex.org/) で組版（`$…$` はインライン、`$$…$$` はブロック。不正な式は例外を投げずそのまま表示）。脚注（`[^1]`）は末尾のセクションに相互リンク付きで描画。`- [ ]` / `- [x]` のタスクリストはチェックボックスで表示。 / Typesets maths with [KaTeX](https://katex.org/) (`$…$` inline, `$$…$$` display; a malformed formula is left as text rather than throwing). Footnotes (`[^1]`) render as a cross-linked section at the end, and `- [ ]` / `- [x]` task lists render as checkboxes.
- **HTML として書き出す**（`⌘⇧E`）：レンダリング結果を自己完結した 1 枚の HTML に保存。スタイル・画像・（数式があれば）KaTeX のフォントまで埋め込むので、アプリの外でもそのまま開けます。 / **Export as HTML** (`⌘⇧E`): save the rendered document as one self-contained file — styles, images and (when there's maths) KaTeX's fonts are all embedded, so it opens anywhere.
- **PDF として書き出す**（`⌘P`）：OS の印刷ダイアログを開き、「PDF として保存」で書き出します。印刷時は自動で白地・明るいコード配色に切り替わり、コードブロックや表・数式がページ跨ぎで割れません。 / **Export as PDF** (`⌘P`): opens the system print dialog — choose "Save as PDF". Printing switches to a light page with a light code palette, and keeps code blocks, tables and maths from splitting across pages.
- リンクはアプリ内で完結：外部リンクはブラウザで開き、文書内アンカーはスクロール、ローカルの Markdown ファイルへのリンク（`[text](./other.md)`）はアプリ外に出ずそのままアプリ内で開きます。 / Links stay in the app: external links open in your browser, in-document anchors scroll, and links to local Markdown files (`[text](./other.md)`) open that file right in the app instead of leaving it.
- HTML 出力は DOMPurify でサニタイズし、厳格な CSP でロックダウン（信頼できないファイルも安全に開けます）。 / HTML output sanitized with DOMPurify and locked down with a strict CSP (safe to open untrusted files).
- 現在のファイルを再読み込み（`⌘R`）。 / Reload the current file (`⌘R`).

## インストール / Install

macOS 版（Apple Silicon / Intel、macOS 10.15 以降）のビルドを [Releases](https://github.com/MR-TABATA/MRDown/releases) ページからダウンロードできます。
Download the macOS build (Apple Silicon / Intel, macOS 10.15+) from the [Releases](https://github.com/MR-TABATA/MRDown/releases) page.

バイナリは Apple Developer ID で署名・公証（notarization）済みなので、ダウンロードしてそのまま起動できます。
The binaries are signed and notarized with an Apple Developer ID, so they open normally once downloaded.

## 開発 / Development

```bash
npm install
npm run tauri dev
```

## ビルド / Build

```bash
npm run tauri build
```

## ライセンス / License

MRDown 本体は [MIT ライセンス](LICENSE)です。ただし **MRDown の名称とロゴはライセンスに含まれません**。フォークを配布する場合は別の名前とアイコンをお使いください。
MRDown itself is [MIT licensed](LICENSE). **The MRDown name and logo are not covered by that license** — please rename and re-icon any fork you distribute.

配布物には第三者のオープンソースソフトウェアを同梱しています。その一覧と著作権表示は [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) にあり、アプリの設定（`⌘,`）からも読めます。この一覧は `npm run notice` で生成されます。
The binaries bundle third-party open-source software; its inventory and copyright notices are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), also readable from Settings (`⌘,`) inside the app. Regenerate it with `npm run notice`.

MRDown は open-core です。**このリポジトリにあるものが MRDown であり、すべて MIT で、これからも MIT です。** 将来の有料機能（AI による差分の説明、プロジェクト全体の横断検索、GitHub / SSH などの認証を伴うリモート）は別リポジトリに置かれ、ここには入りません。どこに線を引いているかは [CONTRIBUTING.md](CONTRIBUTING.md) に書いてあります。
MRDown is open-core. **What is in this repository is MRDown, all of it MIT, and it stays MIT.** The paid features that are planned — AI explaining a diff, project-wide search, authenticated remotes like GitHub and SSH — will live in a separate repository and will not land here. [CONTRIBUTING.md](CONTRIBUTING.md) says exactly where the line is drawn.

## 推奨 IDE 構成 / Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)





