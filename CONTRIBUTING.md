# コントリビューション / Contributing

MRDown への関心をありがとうございます。Issue も Pull Request も歓迎します。
Thanks for your interest in MRDown. Issues and pull requests are welcome.

## スコープ / Scope

MRDown は **手元の Markdown を見る・直す** アプリです。開く、描画する、編集する、保存する、フォルダを辿る、アウトライン、開いている文書の中の検索・置換、外観の設定、HTML/PDF 書き出し、ローカル履歴とその差分。
MRDown is an app for **reading and editing the Markdown in front of you**: open, render, edit, save, walk a folder, outline, find/replace within the documents you have open, appearance settings, HTML/PDF export, local history and its diffs.

MIT で、**全機能が 1 つのリポジトリにあります。** 有償版も、機能の出し分けもありません。どの機能にも PR を歓迎します。フォークして Windows 版を出す自由もあります（[名前とロゴだけは別](README.md#ライセンス--license)）。
MIT licensed, and **every feature lives in this one repository.** There is no paid edition and no feature gating. Pull requests are welcome on any part of it, and you are free to fork it and ship, say, a Windows build ([the name and logo are the one exception](README.md#ライセンス--license)).

## 歓迎するもの / What is welcome

バグ修正、レンダリングの正確さ、パフォーマンス、アクセシビリティ、i18n、エディタの書き味、外観、書き出しの品質 — どれも歓迎です。
Bug fixes, rendering correctness, performance, accessibility, i18n, editor ergonomics, appearance, export quality — all welcome.

大きめの変更を考えている場合は、**先に Issue を立ててください**。手を動かす前に、方向が合っているかを一緒に確認できます。
If you are planning something substantial, **open an issue first** — so we can check the direction together before you write the code.

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
