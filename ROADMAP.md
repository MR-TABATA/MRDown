# MRDown roadmap

A living list of where MRDown is and where it might go. Not a promise — a place
to keep ideas so they aren't lost. Philosophy stays the same: **small, fast,
your data local.**

## Shipped

- **CRUD**: open & render (R), edit with split live preview (U), new document (C),
  move-to-trash delete (D)
- Multi-document sidebar with session restore; recent files; per-document
  reading position (reopen a file and land where you left off, not at the top)
- Drag & drop, "Open With", auto-reload on external change
- Formatting toolbar (14 Markdown actions) + Settings panel (`⌘,`) to customize it
- Mermaid diagrams; local image resolution; sanitized HTML + strict CSP
- Undo-safe editing (changes go through the native undo stack)
- Japanese / English i18n (UI + native menu), localized About with version

## Planned — next axis: "read a whole set, not one file"

The real use case is reading the `.md` files Claude Code generates. These three
turn MRDown from a single-file viewer into something you actually navigate.

- [x] **Open a folder + file tree** — browse a project's `.md` files together
      (biggest jump in substance)
- [x] **Outline / table-of-contents panel** — jump by heading, with a scroll-spy
      that highlights the heading you're reading
- [x] **Find (`⌘F`) and Replace** — in-document; searching across open docs is
      still planned

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

> Pillars 1 and 2 — together with the two unplanned essentials (4 and 5) below —
> **shipped in v1.2.0**; v1.3.0 adds compare-any-two-files (6); v1.4.0 adds
> compare-against-any-Git-ref (7); v1.4.1 rounds the diff out with an in-diff
> filter and change-to-change navigation. Only pillar 3 (AI explains the diff)
> is still to come.

1. [x] **Local History** ★ — on save, keep a quiet local timeline of versions;
   pick any two versions → diff → one-click restore. **No Git required**, so it
   helps *every* user, not just those inside a repo. This is the retention
   feature (the "safety net" that worked well in cli2ui), and building it gives
   us the two-version diff renderer the next pillar reuses.
2. [x] **Git diff** — the file at `HEAD` vs the working tree. As predicted, this
   cost almost nothing once the renderer existed: `HEAD` is simply one more
   version in the same list, handed to the same diff. **v1.4.0 generalises it**
   to any ref (see 7).
3. [ ] **AI explains the diff (BYOK)** — with the user's own API key, narrate
   *what changed and why* in a revision. Plain AI summary is crowded; "AI that
   explains what your AI just changed" is MRDown-specific and finishes the
   story. Zero cost to us (BYOK). Heaviest to wire, so it goes last. **Pro.**

Two things the build turned up that weren't planned, and that the axis doesn't
work without:

4. [x] **Never lose a version to an agent.** A file rewritten on disk while the
   buffer held unsaved edits used to be reloaded silently or overwritten
   silently, and the other version was gone for good — the exact failure the
   whole axis exists to prevent. The disk's version is now snapshotted the moment
   it's seen, unsaved edits are snapshotted before they're discarded, and a save
   into a changed file asks first.
5. [x] **A three-way view** (last save / on disk / my edits). Two columns cannot
   express a conflict: there is no single "before" to compare against. Only lines
   both sides rewrote differently are marked as conflicts — those are the only
   ones a human has to resolve.

Versions also record **where they came from** (saved / changed elsewhere / back
to the committed version / rescued draft), each kind capped on its own budget so
an agent writing in a loop can't evict the user's own saves. Which *application*
wrote a file is not knowable: macOS doesn't record it (`stat` has no writer,
`lsof` is empty once the writer closed the file, and Endpoint Security needs an
entitlement no Markdown viewer will get). Git is the one exception — content that
matches the committed blob byte-for-byte was Git putting the file back — and it's
labelled as a statement about the content, not a guess about the process.

6. [x] **Compare any two files** (`⌘⇧D`) — shipped v1.3.0. Not a pillar of its
   own: the two-version diff renderer already existed, so pointing it at two
   arbitrary files on disk (nothing open required) cost almost nothing.
   File ▸ "Compare Two Files…".
7. [x] **Compare against any Git ref** — shipped v1.4.0. The version panel could
   already diff `HEAD`; a picker now pulls any **local branch or commit** into the
   same list, so you can review a branch an agent pushed *before* merging it.
   Still **free-core** (local Git, no auth) — the remote GitHub/PR review stays
   Pro. Only files tracked at `HEAD` offer the picker for now (a file that exists
   only on another branch is a later extension).

## Planned — editor depth

- [x] Code-block syntax highlighting (highlight.js, lazy-loaded common bundle)
- [x] Editor ⇄ preview scroll sync (proportional)
- [x] List auto-continue (Enter continues `- `), Tab / Shift-Tab indent
- [x] Auto-close pairs (`` ` ``, `[`, `(`; wrap the selection, type-over the close)
- [x] Paste a URL onto a selection → link; paste an image → save + insert
- [x] Word / character count, reading time
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

- [x] Export to HTML (standalone, everything embedded) and PDF via the print dialog
- [ ] Copy as rich text / HTML
- [x] Math via KaTeX (`$…$` inline, `$$…$$` display)
- [x] Footnotes (`[^1]`), rendered as a cross-linked section
- [ ] Clickable task-list checkboxes in the preview (they render, but are read-only)
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
- **Reach:** one/open document = free; act across the *whole project* = Pro.

One line to teach: **look at & edit what's in front of you = free; reach across a
whole corpus, cross an auth boundary, or have AI answer = Pro.**

What that means concretely for MRDown:

- **Free (local core):** open/render, edit, folder + tree, outline, **in-document
  and open-tab find/replace**, themes, text transforms, **Local History**, **local
  Git diff** (`HEAD` vs working tree — Git is still local), HTML/PDF export, and
  opening a **public URL / raw file** (anonymous one-off read — Glow does this free,
  so we match it rather than look stingier than a terminal tool). The complete local
  reader/editor.
- **Pro (remote, whole-project reach, + answers):** **remote Markdown over SSH**
  (browse/read/diff a remote box's `.md` tree — a *different job* from MrEditor's
  remote *log* tailing, so they coexist), **GitHub remote / PR diff review** and
  **private repos**, **project-wide `vault-grep`** (ripgrep a whole folder incl.
  unopened files, regex/lookaround, cross-file replace — the heavy multi-doc reach),
  and the **AI-explains-the-diff / AI-summarize** features (BYOK; "hand you an answer").
- **The line to hold:** never ship SSH/private-remote for free — MrEditor sells
  remote as its Pro flagship, and giving it away here would undercut our own paywall.
  (Public/anonymous/one-off reads are the one carve-out; authenticated/private/
  persistent remote stays Pro.)
- **Launch:** 1.0 ships **all-free** — no Pro feature or licensing exists yet, so the
  paywall (licensing + first Pro feature) lands after 1.0. The line is drawn now so
  every feature we add falls on the right side.

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

- [x] **Apple Developer ID signing + notarization** (removes the Gatekeeper
      warning). Shipped in v0.18.1; the macOS release build signs and notarizes
      via the App Store Connect API key in CI.
- [ ] At 1.0, go macOS-only (drop Windows/Linux release artifacts).
- [ ] **Maybe later — Mac App Store**: needs App Sandbox. The blocker is that
      *recent files* and *session restore* reopen paths by string; under the
      sandbox those need **security-scoped bookmarks**. Design that in if MAS
      becomes the goal. App Review may also flag "minimum functionality" — the
      "read a whole set" features above are the answer.
