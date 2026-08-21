# リリースノート / Release notes

`vX.Y.Z.md` が、そのタグの GitHub リリース本文になります。ファイル名はタグ名そのままです（`v1.11.0` → `v1.11.0.md`）。

One file per tag, named exactly after it. `.github/workflows/release.yml` reads it when the tag is pushed and uses it as the release body.

`docs/` ではなくここに置くのは、**`docs/` が GitHub Pages の公開ルート**だからです。あちらに置くと、この手順書まで LP のサイトに 1 ページとして出てしまいます。

These live here rather than in `docs/` because **`docs/` is the GitHub Pages root** — putting them there would publish this how-to as a page on the site.

## 機能を作った PR の中で書く

タグを打ってから web の編集画面で書くと、いちばん覚えていない時に書くことになります。**変更を入れる PR の中で、この下にファイルを足してください。**レビューできて、git に残って、あとから直せます。

Write it in the pull request that makes the change, not after the tag. That is when you still remember why it matters — and it means the notes get reviewed like anything else.

## 書くもの・書かないもの

- **日英併記**で書きます（公開テキストの掟）。
- **ダウンロード欄と Full changelog は書きません。** 実際に上がった資産からワークフローが組み立てて末尾に足します。手で書くと版番号とファイル名を打ち間違えるので。
- 何が変わったかより、**それが何を変えるか**を書きます。

Bilingual, Japanese first. **Do not write the download list or the changelog link** — the workflow appends those from the assets that actually got uploaded, so the filenames and version numbers cannot drift.

## 無かったら

リリースは止まりません。本文が既定の一行になり、ワークフローが警告を出します。どのみち draft で止まるので、公開する前に気づきます。

Nothing breaks: the body falls back to a single default line and the run logs a warning. The release is a draft until you publish it, so you will see it.
