# コントリビューション / Contributing

MRDown への関心をありがとうございます。Issue も Pull Request も歓迎します。
Thanks for your interest in MRDown. Issues and pull requests are welcome.

ただし**コアに入れないと決めている領域**があります。良い実装であっても、そこに触れる PR はマージできません。時間を無駄にしていただかないよう、先に線を書いておきます。
There is, however, a set of areas that are **deliberately out of scope for the core**. A pull request that lands in one of them will not be merged, however good the code is. The line is written down here so that nobody spends a weekend on the wrong side of it.

## コアのスコープ / What the core is

MRDown のコアは **手元の Markdown を見る・直す** アプリです。開く、描画する、編集する、保存する、フォルダを辿る、アウトライン、開いている文書の中の検索・置換、外観の設定、HTML/PDF 書き出し、ローカル履歴とその差分。
The core of MRDown is an app for **reading and editing the Markdown in front of you**: open, render, edit, save, walk a folder, outline, find/replace within the documents you have open, appearance settings, HTML/PDF export, local history and its diffs.

これらはすべて MIT で、これからも MIT です。
All of that is MIT licensed, and stays MIT licensed.

## コアのスコープ外 / What the core is not

以下は **MRDown Pro（別リポジトリ・別ライセンス）** に属します。**コアに対する PR は受け取れません。**
The following belong to **MRDown Pro** — a separate repository under a separate license. **Pull requests adding them to the core cannot be accepted.**

- **AI に答えさせるもの** — 差分の説明、要約、その他 LLM に問い合わせる機能。API キー・モデル・プロンプトなどの AI 設定画面を含みます。
  **Anything that has an AI answer for you** — explaining a diff, summarizing, or any other call out to an LLM. This includes the settings pane for API keys, models and prompts.
- **プロジェクト全体に効かせる横断検索（vault-grep）** — 開いていないファイルを含めてフォルダを丸ごと grep する、ファイルを跨いで置換する。
  **Project-wide search (vault-grep)** — grepping a whole folder including files you never opened, or replacing across files.
  （開いている文書の中の検索・置換、開いているタブを横断する検索は**コアの機能**です。線は「開いているもの」と「フォルダ全体」の間にあります。）
  (Find/replace inside a document, and search across the tabs you already have open, **are core features**. The line runs between "what you have open" and "the whole folder".)
- **認証の向こうにあるリモート** — GitHub / PR 差分レビュー、プライベートリポジトリ、SSH 越しのリモート Markdown。
  **Remote behind an authentication boundary** — GitHub and PR diff review, private repositories, Markdown over SSH.
  （公開 URL の Markdown を1枚開くのは**コアの機能**です。線は匿名の読み取りと認証の間にあります。）
  (Opening a single public URL **is a core feature**. The line runs between anonymous reads and authenticated ones.)

一行で言うと: **手元のものを見る・直す = コア / 束ねて効かせる・認証の向こう・AI に答えさせる = Pro。**
In one line: **look at and fix what's in front of you = core; reach across everything, cross an auth boundary, or have an AI answer for you = Pro.**

## なぜ open-core なのか / Why open-core

コアが本物の OSS であることが「open-core」の open です。MRDown は MIT のままで、それを外すつもりはありません。フォークして Windows 版を出す自由も残ります（[名前とロゴだけは別](README.md#ライセンス--license)）。
The "open" in open-core means the core is genuinely open source. MRDown stays MIT, and that is not going to change — including the freedom to fork it and ship, say, a Windows build ([the name and logo are the one exception](README.md#ライセンス--license)).

守っているのはコードの秘匿性ではなく、Pro 機能の所在です。上の3領域が売り物であり、それがこのアプリの開発を続けられる理由です。
What is being protected is not the secrecy of any code, but where the Pro features live. Those three areas are what is sold, and selling them is what keeps this app being worked on.

## それ以外は歓迎します / Everything else is welcome

バグ修正、レンダリングの正確さ、パフォーマンス、アクセシビリティ、i18n、エディタの書き味、外観、書き出しの品質 — どれも歓迎です。
Bug fixes, rendering correctness, performance, accessibility, i18n, editor ergonomics, appearance, export quality — all welcome.

大きめの変更を考えている場合は、**先に Issue を立ててください**。手を動かす前に、それがコア側かどうかを一緒に確認できます。
If you are planning something substantial, **open an issue first** — so we can check which side of the line it falls on before you write the code.

## 開発 / Development

セットアップとビルドは [README](README.md#開発--development) を参照してください。PR の前に:
See the [README](README.md#開発--development) for setup and build. Before opening a pull request:

```bash
npm test                                  # ユニットテスト / unit tests
npx tsc --noEmit                          # 型チェック / typecheck
cargo test --manifest-path src-tauri/Cargo.toml
npm run notice                            # 依存を足したときだけ / only if you added a dependency
```

依存を足した場合は `npm run notice` で [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) を再生成してコミットしてください。CI は表記が陳腐化していると失敗します（ライセンス表記の欠落は書式の粗ではなく違反なので）。
If you added a dependency, regenerate [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) with `npm run notice` and commit it. CI fails on a stale notices file — a missing attribution is a license violation, not a formatting nit.
