# MRDown

**English** | [日本語](README.ja.md)

**A Markdown viewer at heart — it edits, saves, and creates too, and the diff is the showpiece.**

It began with the `.md` files Claude Code generates. Opening a heavy editor and right-clicking to preview was a chore — so I asked Claude Code for help and had a **viewer-only 0.1 in two hours**. These days it's not only Claude Code: I read the `.md` I write in VSCode here too — **I write in an editor, and I read in MRDown**. From there, one "it'd be nice if it also…" after another, it grew — until it did something no other Markdown app does: **read the diff of what your AI just rewrote**.

Built with Tauri + TypeScript. macOS native.

## Features

- Open and render Markdown files (`.md`, `.markdown`, `.txt`).
- Create a new document (`⌘N`) and save it anywhere via a save dialog; an untitled doc's first `#` heading is offered as the file name.
- Delete the current file to the system Trash (`⌘⌫` or the trash button), with a confirmation — recoverable from the Trash if it was a mistake.
- Edit with a split editor + live preview (`⌘E` to toggle), save with `⌘S` or "Save As…" (`⌘⇧S`) to write a copy elsewhere; drag the divider to resize the panes.
- Find & replace in the current document (`⌘F`): while editing it searches the source and highlights every hit (the current one emphasized); in preview it searches the rendered text so matches can span inline formatting (e.g. across `**bold**`). Regex, case-sensitive and whole-word toggles (remembered); step with `Enter` / `⇧Enter`; replace one or all while editing (undoable with `⌘Z`).
- **Search across every open document** (`⌘⇧F`, or the 🔍 button ▸ "Search across open documents"): one field searches the whole set you have open, matching all your words on the same line whatever their order. Results are grouped by document, each with its line number and the line quoted; pick one and that document opens in the editor with the match selected. Whatever is in the `⌘F` box carries over, so `⌘F` → `⌘⇧F` widens the same query to every open document.
- **History and diffs**: every save — and every rewrite from outside the app — quietly keeps a timestamped version. The History panel (clock icon) puts **any two versions side by side** so you can read what changed (only the words that differ are marked; unchanged runs are folded away). In a Git repository, `HEAD` joins the same list, so **the diff against what's committed** is right there. Restore any version into the editor in one click, non-destructively (nothing is written until you save). Versions live in the app's data directory, so they never clutter your files or Git repos. **Git is optional.**
- **Compare any two files** (`⌘⇧D`): File ▸ "Compare Two Files…" — pick two, and read the difference in exactly the same view the version timeline uses. Works with nothing open.
- **Nothing is lost when an agent rewrites the file under you**: if something changes the file on disk while you have unsaved edits, MRDown neither overwrites it silently nor reloads over you. The disk's version is snapshotted the moment it's seen, and your unsaved edits are snapshotted before they're discarded. **Three columns — last save, what's on disk, your edits** — with only the lines you both rewrote differently marked as conflicts. Versions record where they came from (saved / changed elsewhere / back to the committed version / rescued draft). *Which* application wrote a file isn't knowable — macOS doesn't record it — except for Git: content matching the committed blob byte-for-byte was Git putting the file back.
- Formatting toolbar above the editor: bold (`⌘B`), italic (`⌘I`), heading, list, quote, link, and more — each toggles/inserts the Markdown syntax around the selection (undoable with `⌘Z`).
- Typing niceties: `Enter` continues a list (ordered items renumber, task items start unchecked, `Enter` on an empty item exits), `Tab` / `⇧Tab` indent, and `[`, `(`, `` ` `` auto-close — wrapping the selection when there is one. All undoable with `⌘Z`.
- Paste a URL over selected text to turn it into a link (`[selection](url)`); paste an image to save it beside the document in `assets/` and insert the `![]()` for it.
- A status bar along the bottom of the window carries the document's own details — the full path (`~`-shortened, with a dot when there are unsaved edits), character count and estimated reading time (CJK counted per character, space-delimited text by words) — leaving the toolbar to actions alone. While editing, the editor and preview scroll in sync.
- **Reading mode** (`⌘⇧M`): hides the toolbar, sidebar and outline and centres the text, for reading a generated `.md` with nothing else on screen. `Escape` brings the chrome back.
- Pick a **preview theme** in Settings (`⌘,`): the default MRDown look, or GitHub Light / GitHub Dark for a document that reads exactly as it will on GitHub.
- Customise the toolbar in Settings (`⌘,`): turn any of the 14 Markdown actions (strikethrough, ordered/checklist, code block, image, table, horizontal rule, …) on or off; the choice is remembered.
- Japanese / English UI: follows your OS language by default and can be switched in Settings; the native menu (File / Edit / View) is localized too.
- Customise the look in Settings (`⌘,`): accent color (follows the macOS system accent, or a preset / any custom color), background and text colors (presets + a color picker), body font (system / serif / rounded) and size — background and text apply to the whole window, sidebar and toolbar included, not just the document.
- Keep multiple documents open in a sidebar (BBEdit-style): click to switch — or `↑`/`↓` once the list has focus — close with the circled × (`⌘W`), toggle the sidebar with `⌘1`; the open set is restored on next launch.
- Put that list in the order you read it: drag a row, or move it with `⌘↑`/`⌘↓`. `⌘`-click and `⇧`-click select several rows, which then drag and move as one block. The order is remembered with the session.
- Open a folder to browse its Markdown files as a set: pick files from a left-hand tree and expand/collapse subfolders; the opened folder is restored on next launch.
- Outline (table of contents) in a column of its own, to the right of the document: click a heading to jump to it, and the heading you're reading is highlighted as you scroll. Toggle it with `⌘2`; it follows the document live while you edit. It's **hidden by default while editing**, so the split editor and preview keep their width — bring it back with `⌘2` and it stays (visibility is remembered separately for preview and edit). Settings (`⌘,`) can move it back into the left sidebar instead (where it stays collapsible).
- Never lose unsaved work: in-progress edits (and untitled documents that were never written to disk) are continuously kept as drafts and restored on next launch, so a quit or crash won't discard what you were writing.
- Open files by double-clicking or "Open With" (registered as a handler for those extensions), the button, `⌘O`, or by dragging a file onto the window.
- Auto-reloads when the open file changes on disk (scroll position preserved).
- Recent files list on the start screen for quick reopening.
- Renders tables, code blocks, quotes, and local images (relative paths resolve against the file).
- Renders a document's YAML frontmatter (the leading `---` … `---` block) as a tidy collapsed metadata card instead of leaking `title:`/`tags:` lines into the body.
- Syntax-highlights fenced code blocks with [highlight.js](https://highlightjs.org/) (lazy-loaded common bundle; tuned to the dark theme).
- Renders [Mermaid](https://mermaid.js.org/) diagrams in ```` ```mermaid ```` code blocks (lazy-loaded; falls back to source on syntax errors).
- Typesets maths with [KaTeX](https://katex.org/) (`$…$` inline, `$$…$$` display; a malformed formula is left as text rather than throwing). Footnotes (`[^1]`) render as a cross-linked section at the end, and `- [ ]` / `- [x]` task lists render as checkboxes.
- **Export as HTML** (`⌘⇧E`): save the rendered document as one self-contained file — styles, images and (when there's maths) KaTeX's fonts are all embedded, so it opens anywhere.
- **Export as PDF** (`⌘P`): opens the system print dialog — choose "Save as PDF". Printing switches to a light page with a light code palette, and keeps code blocks, tables and maths from splitting across pages.
- Links stay in the app: external links open in your browser, in-document anchors scroll, and links to local Markdown files (`[text](./other.md)`) open that file right in the app instead of leaving it.
- HTML output sanitized with DOMPurify and locked down with a strict CSP (safe to open untrusted files).
- Reload the current file (`⌘R`).

## Install

Download the macOS build (Apple Silicon / Intel, macOS 10.15+) from the [Releases](https://github.com/MR-TABATA/MRDown/releases) page.

The binaries are signed and notarized with an Apple Developer ID, so they open normally once downloaded.

## Development

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

## License

MRDown itself is [MIT licensed](LICENSE). **The MRDown name and logo are not covered by that license** — please rename and re-icon any fork you distribute.

The binaries bundle third-party open-source software; its inventory and copyright notices are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), also readable from Settings (`⌘,`) inside the app. Regenerate it with `npm run notice`.

MRDown is open-core. **What is in this repository is MRDown, all of it MIT, and it stays MIT.** The paid features that are planned — AI explaining a diff, project-wide search, authenticated remotes like GitHub and SSH — will live in a separate repository and will not land here. [CONTRIBUTING.md](CONTRIBUTING.md) says exactly where the line is drawn.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
