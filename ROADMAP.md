# MRDown roadmap

A living list of where MRDown is and where it might go. Not a promise — a place
to keep ideas so they aren't lost. Philosophy stays the same: **small, fast,
your data local.**

## Shipped

- **CRUD**: open & render (R), edit with split live preview (U), new document (C),
  move-to-trash delete (D)
- Multi-document sidebar with session restore; recent files
- Drag & drop, "Open With", auto-reload on external change
- Formatting toolbar (14 Markdown actions) + Settings panel (`⌘,`) to customize it
- Mermaid diagrams; local image resolution; sanitized HTML + strict CSP
- Undo-safe editing (changes go through the native undo stack)
- Japanese / English i18n (UI + native menu), localized About with version

## Planned — next axis: "read a whole set, not one file"

The real use case is reading the `.md` files Claude Code generates. These three
turn MRDown from a single-file viewer into something you actually navigate.

- [ ] **Open a folder + file tree** — browse a project's `.md` files together
      (biggest jump in substance)
- [ ] **Outline / table-of-contents panel** — jump by heading; headings already
      get ids, so this is cheap
- [ ] **Find (`⌘F`) and Replace (`⌘⌥F`)** — in-document first, then across open docs

## Planned — editor depth

- [x] Code-block syntax highlighting (highlight.js, lazy-loaded common bundle)
- [ ] Editor ⇄ preview scroll sync
- [ ] List auto-continue (Enter continues `- `), Tab / Shift-Tab indent
- [ ] Auto-close pairs (`**`, `` ` ``, `[`, `(`)
- [ ] Paste a URL onto a selection → link; paste an image → save + insert
- [ ] Word / character count, reading time
- [ ] Focus / Zen mode; font size & line-width settings; word-wrap toggle

## Planned — output & preview

- [ ] Export to HTML (standalone) and PDF / Print
- [ ] Copy as rich text / HTML
- [ ] Math via KaTeX (already pulled in by Mermaid)
- [ ] Footnotes; clickable task-list checkboxes in the preview
- [ ] Preview themes (e.g. GitHub light/dark), optional custom CSS

## Smaller polish (from the backlog)

- [ ] Open multiple files at once from the Open dialog
- [ ] Clear / prune dead entries from the recent-files list
- [ ] Reuse closed "untitled" numbers instead of always incrementing

## Distribution / 1.0

Spending is gated on traction (a free article first); see the signing notes.

- [ ] **v1.0**: Apple Developer ID signing + notarization (removes the Gatekeeper
      warning). Requires the paid Apple Developer Program ($99/yr).
- [ ] At 1.0, go macOS-only (drop Windows/Linux release artifacts).
- [ ] **Maybe later — Mac App Store**: needs App Sandbox. The blocker is that
      *recent files* and *session restore* reopen paths by string; under the
      sandbox those need **security-scoped bookmarks**. Design that in if MAS
      becomes the goal. App Review may also flag "minimum functionality" — the
      "read a whole set" features above are the answer.
