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

## Planned — flagship axis: the time machine ("what changed?")

The sharpest differentiation MRDown can carry, and the one no lightweight Mac
Markdown editor (MacDown / Typora / MarkText) has: **read Markdown by its
changes.** Every pillar answers the same question — *what changed, and (later)
why?* — which fits the core use case of reading the `.md` that Claude Code and
other AI keep rewriting. Cherry-picked from the `MrEditor` backlog; the
giant-file / log / remote parts of that backlog stay over there (there is no
10 GB Markdown — those don't belong here).

Build order matters: **Local History is the foundation**, and it hands the diff
renderer to the other two nearly for free.

1. [ ] **Local History** ★ — on save, keep a quiet local timeline of versions;
   pick any two versions → diff → one-click restore. **No Git required**, so it
   helps *every* user, not just those inside a repo. This is the retention
   feature (the "safety net" that worked well in cli2ui), and building it gives
   us the two-version diff renderer the next pillar reuses.
2. [ ] **Git diff** — `HEAD` vs working tree of the open `.md`, add/remove
   highlight in the preview, toggle diff-mode ⇄ normal preview. Once Local
   History exists this is almost free: feed the same diff renderer a different
   pair of versions. (Bonus: extend the existing auto-reload-on-disk-change to
   flash the changed lines — cheapest first taste.)
3. [ ] **AI explains the diff (BYOK)** — with the user's own API key, narrate
   *what changed and why* in a revision. Plain AI summary is crowded; "AI that
   explains what your AI just changed" is MRDown-specific and finishes the
   story. Zero cost to us (BYOK). Heaviest to wire, so it goes last.

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

- **Local History / AI** — decided: promoted to the committed "time machine"
  flagship axis above (Local History → Git diff → AI-explains-diff). Kept here
  only as a pointer.
- [ ] **Single-shot AI on a selection (BYOK)** — "summarize / explain this"
      selection (distinct from the diff-narration pillar above), with the user's
      own API key. Lines up with reading the `.md` Claude Code generates, but
      stretches "small, fast, local" — still a philosophy call.

## Business model — freemium (aligned with MrEditor)

MRDown uses the **same freemium line as its brand sibling MrEditor**, so the two
products teach users one consistent rule. Two axes, same boundary:

- **Local = free / Remote = Pro.**
- **"Change how it's shown" = free / "reduce the content or hand you an answer" = Pro.**

What that means concretely for MRDown:

- **Free (local core):** open/render, edit, folder + tree, outline, find/replace,
  themes, text transforms, **Local History**, and **local Git diff** (`HEAD` vs
  working tree — Git is still local). The complete local tool.
- **Pro (remote + answers):** **remote Markdown over SSH** (browse/read/diff a
  remote box's `.md` tree — a *different job* from MrEditor's remote *log* tailing,
  so they coexist), **GitHub remote / PR diff review**, and the **AI-explains-the-diff /
  AI-summarize** features (that's "hand you an answer", the Pro side of the second axis).
- **The line to hold:** never ship SSH/remote for free — MrEditor sells remote as
  its Pro flagship, and giving it away here would undercut our own paywall.

Remote transport (SSH, Git/GitHub) is fine for MRDown because the brand split is
by **job** (Markdown docs vs logs), not by pipe; MrEditor keeps the log/giant-file/
S3/DB remotes. See [[mrdown-brand-family-not-merge]] — bundle by brand, don't merge code.

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
