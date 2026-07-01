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

## Planned — text transforms (act on the selection)

Small "in-place, manual, local" commands that transform the current selection
(right-click menu / shortcuts), sitting next to the formatting toolbar. All free,
all cheap in Tauri + TS. (Culled from the `MrEditor` idea backlog — the rest of
that backlog is a separate product and does not belong here.)

- [ ] **Case convert** — camelCase ⇄ snake_case ⇄ kebab-case ⇄ CONSTANT ⇄ Title
- [ ] **Sort lines** — alphabetical / numeric / by line length (great for lists)
- [ ] **Join / split lines** — merge selected lines into one (comma/space) and back
- [ ] **Reflow / indent** — wrap to a width, dedent, normalize indentation
- [ ] **Entity / URL decode** — turn `&amp;` / `%20` back into readable text

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
- [ ] Export / import settings as a `.json` file (toolbar config, language) — easy
      to share ("use my setup"), no cloud needed

## Considering — philosophy calls (not committed)

Ideas that fit "your data local" but stretch "small & fast" — decide before building.

- [ ] **Local history** — on save, keep a quiet local timeline of versions with
      diff + one-click restore. Same "automatic safety-net undo" idea that worked
      well in cli2ui; a candidate flagship feature, but adds scope.
- [ ] **Single-shot AI on a selection (BYOK)** — "summarize / explain this" with
      the user's own API key. Lines up with the core use case (reading the `.md`
      Claude Code generates), but steps beyond "small, fast, local" — needs a call.

## Positioning — who we're actually up against

Notes on the competitive landscape, so the differentiation stays sharp.

- **Not a real competitor: Bear (and note apps like it).** Bear is a *note
  manager* — it stores your writing in its own library (SQLite + iCloud sync),
  Apple-only, subscription. MRDown opens *plain `.md` files that already exist on
  disk*, anywhere, no library or lock-in. Different job. You don't drop someone
  else's `.md` folder into Bear to read it.
- **Direct competitors: local Markdown editors** — Typora, MacDown, Mark Text.
  Same "open a `.md` on disk" job. Win on speed, no lock-in, and the "read a
  whole set" features.
- **The real incumbent for our core use case: VS Code's Markdown preview** —
  that's what people use today to read what Claude Code emits. Beating it means
  being lighter and more pleasant for *just reading*.
- **Closest in philosophy: Obsidian** — also treats a local `.md` folder as the
  unit (a vault). As MRDown grows folder + tree support it converges here, so
  Obsidian is a closer reference than Bear. Stay differentiated by being *small,
  fast, zero-config* — no plugins, no vault ceremony.

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
