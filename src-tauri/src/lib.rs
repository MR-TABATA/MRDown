use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager};

const ALLOWED_EXTENSIONS: [&str; 3] = ["md", "markdown", "txt"];

/// Path of a file the app was asked to open (via double-click / "Open With"),
/// held until the frontend is ready to pick it up on startup.
#[derive(Default)]
struct PendingFile(Mutex<Option<String>>);

/// Whether a document is currently open. Menu items that act on the active
/// document are greyed out while this is false, and a menu rebuilt for a
/// language switch has to come back in the same state.
#[derive(Default)]
struct DocOpen(AtomicBool);

fn is_supported(path: &str) -> bool {
    std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| ALLOWED_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    if !is_supported(&path) {
        return Err("Unsupported file type".to_string());
    }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Write content back to a Markdown file (Update). Guards the extension so the
/// app never writes to unexpected file types.
#[tauri::command]
fn save_file(path: String, content: String) -> Result<(), String> {
    if !is_supported(&path) {
        return Err("Unsupported file type".to_string());
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

/// Write an exported document to disk. Guards the extension so this can't be
/// used to write arbitrary files, mirroring `save_file`'s restriction.
#[tauri::command]
fn export_file(path: String, content: String) -> Result<(), String> {
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    if !["html", "htm"].contains(&ext.as_str()) {
        return Err("Unsupported export type".to_string());
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

/// Open the native print dialog for the webview's contents. macOS routes this
/// through NSPrintOperation, where "Save as PDF" is the standard destination —
/// which is how MRDown exports PDF without bundling a renderer.
#[tauri::command]
fn print_document(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

/// Write pasted image bytes to disk (creating the parent folder if needed), used
/// when the user pastes an image into the editor. Guards the extension to common
/// image types so the command can't be coerced into writing arbitrary files.
#[tauri::command]
fn save_image(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    if !["png", "jpg", "jpeg", "gif", "webp"].contains(&ext.as_str()) {
        return Err("Unsupported image type".to_string());
    }
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

/// Move a Markdown file to the OS trash (the Delete of CRUD) and drop it from
/// the recent-files list. Uses the trash, not an unrecoverable delete, so a
/// misclick is recoverable from the system's Trash/Recycle Bin.
#[tauri::command]
fn delete_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    if !is_supported(&path) {
        return Err("Unsupported file type".to_string());
    }
    trash::delete(&path).map_err(|e| e.to_string())?;
    if let Some(store) = recent_store(&app) {
        let list: Vec<String> = get_recent_files(app.clone())
            .into_iter()
            .filter(|p| p != &path)
            .collect();
        if let Ok(json) = serde_json::to_string(&list) {
            let _ = std::fs::write(store, json);
        }
    }
    Ok(())
}

/// Last-modified time of a file in milliseconds, used by the frontend to poll
/// for external edits and auto-reload.
#[tauri::command]
fn file_mtime(path: String) -> Result<u64, String> {
    let modified = std::fs::metadata(&path)
        .and_then(|m| m.modified())
        .map_err(|e| e.to_string())?;
    modified
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .map_err(|e| e.to_string())
}

/// One immediate child of a directory in the folder tree.
#[derive(serde::Serialize)]
struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
}

/// List the immediate children of `dir` for the folder tree: subdirectories and
/// supported Markdown files only. Hidden entries (dotfiles like `.git`,
/// `.obsidian`) are skipped, and the listing is one level deep — subfolders are
/// fetched lazily on expand so large vaults never fan out eagerly. Sorted with
/// folders first, then files, each case-insensitively by name.
#[tauri::command]
fn read_dir(dir: String) -> Result<Vec<DirEntry>, String> {
    let mut entries: Vec<DirEntry> = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let path = entry.path().to_string_lossy().into_owned();
        if !is_dir && !is_supported(&path) {
            continue;
        }
        entries.push(DirEntry { name, path, is_dir });
    }
    sort_dir_entries(&mut entries);
    Ok(entries)
}

/// Order tree entries: folders first, then files, each case-insensitively by name.
fn sort_dir_entries(entries: &mut [DirEntry]) {
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
}

const MAX_RECENT: usize = 10;

fn recent_store(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("recent.json"))
}

/// Most-recently-opened file paths, newest first.
#[tauri::command]
fn get_recent_files(app: tauri::AppHandle) -> Vec<String> {
    recent_store(&app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
}

/// Move `path` to the front of the recent list, deduped and capped at `max`.
/// Pure (no I/O) so it can be unit-tested.
fn compute_recent(mut list: Vec<String>, path: String, max: usize) -> Vec<String> {
    list.retain(|p| p != &path);
    list.insert(0, path);
    list.truncate(max);
    list
}

/// Record an opened file at the front of the recent list (deduped, capped).
#[tauri::command]
fn add_recent_file(app: tauri::AppHandle, path: String) -> Vec<String> {
    let list = compute_recent(get_recent_files(app.clone()), path, MAX_RECENT);
    if let Some(store) = recent_store(&app) {
        if let Some(dir) = store.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string(&list) {
            let _ = std::fs::write(store, json);
        }
    }
    list
}

/// Called by the frontend on startup to retrieve the file the app was launched
/// with (if any), covering both the CLI-argument and macOS "Opened" cases.
#[tauri::command]
fn get_pending_file(state: tauri::State<PendingFile>) -> Option<String> {
    state.0.lock().unwrap().take()
}

/// Remember an opened file and notify a running frontend.
fn handle_opened_file(app: &tauri::AppHandle, path: String) {
    if !is_supported(&path) {
        return;
    }
    if let Some(state) = app.try_state::<PendingFile>() {
        *state.0.lock().unwrap() = Some(path.clone());
    }
    // If the frontend is already listening, render it immediately.
    let _ = app.emit("open-file", path);
}

/// Menu items that act on the active document, and so are dead without one.
/// Their frontend handlers all bail out when nothing is open, which made them
/// look clickable but do nothing; `set_doc_items_enabled` greys them out instead.
const DOC_ITEMS: [&str; 9] = [
    "save",
    "save_as",
    "reload",
    "export_html",
    "export_pdf",
    "delete",
    "close",
    "edit",
    "outline",
];

/// The OS language, narrowed to the two the menu speaks. The frontend re-applies
/// the menu in its own resolved language (which may be a saved override) as soon
/// as it loads; this only keeps the first paint from being wrong.
fn system_lang() -> &'static str {
    match sys_locale::get_locale() {
        Some(l) if l.to_lowercase().starts_with("ja") => "ja",
        _ => "en",
    }
}

/// Build the native menu in the given language ("ja" or anything else = en).
/// Custom items carry stable ids that the frontend maps back to actions; the
/// About item shows the compiled crate version so it can never go stale.
fn build_menu(app: &tauri::AppHandle, lang: &str, has_doc: bool) -> tauri::Result<Menu<tauri::Wry>> {
    let ja = lang == "ja";
    let pick = |j: &'static str, e: &'static str| -> &'static str { if ja { j } else { e } };
    let sep = || PredefinedMenuItem::separator(app);

    let about_meta = AboutMetadata {
        name: Some("MRDown".into()),
        version: Some(env!("CARGO_PKG_VERSION").into()),
        copyright: Some("© 2026 TABATA Hitoshi".into()),
        // Shown in the macOS About panel's credits area (localized).
        credits: Some(pick("軽量・高速な Markdown ビューア", "A minimal, fast Markdown viewer").into()),
        ..Default::default()
    };
    let app_menu = Submenu::with_items(
        app,
        "MRDown",
        true,
        &[
            &PredefinedMenuItem::about(app, Some(pick("MRDown について", "About MRDown")), Some(about_meta))?,
            &sep()?,
            &MenuItem::with_id(app, "settings", pick("設定…", "Settings…"), true, Some("CmdOrCtrl+,"))?,
            &sep()?,
            &PredefinedMenuItem::hide(app, Some(pick("MRDown を隠す", "Hide MRDown")))?,
            &PredefinedMenuItem::hide_others(app, Some(pick("ほかを隠す", "Hide Others")))?,
            &PredefinedMenuItem::show_all(app, Some(pick("すべてを表示", "Show All")))?,
            &sep()?,
            &PredefinedMenuItem::quit(app, Some(pick("MRDown を終了", "Quit MRDown")))?,
        ],
    )?;

    let file_menu = Submenu::with_items(
        app,
        pick("ファイル", "File"),
        true,
        &[
            &MenuItem::with_id(app, "new", pick("新規", "New"), true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "open", pick("開く…", "Open…"), true, Some("CmdOrCtrl+O"))?,
            // Not in DOC_ITEMS: comparing two files on disk needs no open document.
            &MenuItem::with_id(app, "compare", pick("2つのファイルを比較…", "Compare Two Files…"), true, Some("CmdOrCtrl+Shift+D"))?,
            &sep()?,
            &MenuItem::with_id(app, "save", pick("保存", "Save"), has_doc, Some("CmdOrCtrl+S"))?,
            &MenuItem::with_id(app, "save_as", pick("別名で保存…", "Save As…"), has_doc, Some("CmdOrCtrl+Shift+S"))?,
            &MenuItem::with_id(app, "reload", pick("再読み込み", "Reload"), has_doc, Some("CmdOrCtrl+R"))?,
            &sep()?,
            &MenuItem::with_id(app, "export_html", pick("HTML として書き出す…", "Export as HTML…"), has_doc, Some("CmdOrCtrl+Shift+E"))?,
            &MenuItem::with_id(app, "export_pdf", pick("PDF として書き出す…", "Export as PDF…"), has_doc, Some("CmdOrCtrl+P"))?,
            &sep()?,
            // No accelerator: ⌘⌫ stays the editor's "delete to line start".
            &MenuItem::with_id(app, "delete", pick("ゴミ箱に移動", "Move to Trash"), has_doc, None::<&str>)?,
            &MenuItem::with_id(app, "close", pick("閉じる", "Close"), has_doc, Some("CmdOrCtrl+W"))?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        pick("編集", "Edit"),
        true,
        &[
            &PredefinedMenuItem::undo(app, Some(pick("取り消す", "Undo")))?,
            &PredefinedMenuItem::redo(app, Some(pick("やり直す", "Redo")))?,
            &sep()?,
            &PredefinedMenuItem::cut(app, Some(pick("カット", "Cut")))?,
            &PredefinedMenuItem::copy(app, Some(pick("コピー", "Copy")))?,
            &PredefinedMenuItem::paste(app, Some(pick("ペースト", "Paste")))?,
            &PredefinedMenuItem::select_all(app, Some(pick("すべてを選択", "Select All")))?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        app,
        pick("表示", "View"),
        true,
        &[
            &MenuItem::with_id(app, "sidebar", pick("サイドバー", "Sidebar"), true, Some("CmdOrCtrl+1"))?,
            &MenuItem::with_id(app, "outline", pick("アウトライン", "Outline"), has_doc, Some("CmdOrCtrl+2"))?,
            &MenuItem::with_id(app, "edit", pick("編集 / プレビュー", "Edit / Preview"), has_doc, Some("CmdOrCtrl+E"))?,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        pick("ウインドウ", "Window"),
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some(pick("しまう", "Minimize")))?,
            &PredefinedMenuItem::maximize(app, Some(pick("拡大／縮小", "Zoom")))?,
        ],
    )?;

    Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu])
}

/// Rebuild and apply the menu in the requested language (called by the frontend
/// on startup and whenever the in-app language changes). Carries the current
/// document state over, so a language switch doesn't silently re-enable items.
#[tauri::command]
fn apply_menu(app: tauri::AppHandle, lang: String) -> Result<(), String> {
    let has_doc = has_doc(&app);
    let menu = build_menu(&app, &lang, has_doc).map_err(|e| e.to_string())?;
    app.set_menu(menu).map_err(|e| e.to_string())?;
    Ok(())
}

fn has_doc(app: &tauri::AppHandle) -> bool {
    app.try_state::<DocOpen>()
        .is_some_and(|s| s.0.load(Ordering::Relaxed))
}

/// Grey out (or restore) every `DOC_ITEMS` entry in the live menu. Walking the
/// existing menu rather than rebuilding keeps the accelerators registered.
fn set_doc_items_enabled(app: &tauri::AppHandle, enabled: bool) {
    let Some(menu) = app.menu() else { return };
    let Ok(submenus) = menu.items() else { return };
    for kind in submenus {
        let Some(submenu) = kind.as_submenu() else { continue };
        let Ok(children) = submenu.items() else { continue };
        for child in children {
            if let Some(item) = child.as_menuitem() {
                if DOC_ITEMS.contains(&item.id().as_ref()) {
                    let _ = item.set_enabled(enabled);
                }
            }
        }
    }
}

/// Called by the frontend whenever the last document closes or the first one
/// opens, so document actions are only clickable when they'd actually do
/// something.
#[tauri::command]
fn set_document_open(app: tauri::AppHandle, open: bool) {
    if let Some(state) = app.try_state::<DocOpen>() {
        state.0.store(open, Ordering::Relaxed);
    }
    set_doc_items_enabled(&app, open);
}

// ── Local History ───────────────────────────────────────────────────────────
// On every successful save we keep a timestamped copy of the file's content in
// the app's data dir — never next to the file itself, which would litter the
// user's Git repos (the very repos the diff features care about). Users can then
// list past versions and restore or diff them. No Git required.


/// Stable, dependency-free FNV-1a hash of the absolute path, hex-encoded, used
/// as a per-file folder name. Deliberately not `DefaultHasher` (whose output is
/// not guaranteed stable across Rust releases) so history survives app updates.
fn path_key(path: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in path.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn history_dir(app: &tauri::AppHandle, path: &str) -> Option<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("history").join(path_key(path)))
}

/// Where a version came from. Worth keeping: with an agent writing to the same
/// files, a timeline that can't tell your own save from something that appeared
/// on disk behind your back isn't much of a record.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
enum Kind {
    /// You pressed ⌘S.
    Save,
    /// The content appeared on disk without MRDown writing it — an agent, an
    /// editor, something. macOS does not record which process wrote a file
    /// (`stat` has no writer, `lsof` is empty once the writer closed it, and the
    /// only real answer, Endpoint Security, needs an entitlement no Markdown
    /// viewer will get), so this stays honestly anonymous.
    External,
    /// An external change whose content is byte-identical to the file at HEAD.
    /// That is a fact we can prove rather than a guess about who did it: the file
    /// was put back to its committed state (`git checkout`, a branch switch, a
    /// stash pop). Nothing else lands on the committed bytes by accident.
    Git,
    /// Unsaved edits, rescued before being discarded (you chose to take the
    /// disk's version). These exist nowhere else, so they're never dropped first.
    Draft,
}

impl Kind {
    fn tag(self) -> &'static str {
        match self {
            Kind::Save => "save",
            Kind::External => "external",
            Kind::Git => "git",
            Kind::Draft => "draft",
        }
    }

    fn parse(s: &str) -> Option<Kind> {
        match s {
            "save" => Some(Kind::Save),
            "external" => Some(Kind::External),
            "git" => Some(Kind::Git),
            "draft" => Some(Kind::Draft),
            _ => None,
        }
    }

    /// Each kind is capped on its own. Sharing one budget would let an agent
    /// that rewrites a file in a loop evict every save the user ever made.
    fn budget(self) -> usize {
        match self {
            Kind::Save => 50,
            Kind::External => 30,
            Kind::Git => 20,
            Kind::Draft => 10,
        }
    }
}

/// The one writer we can name. We cannot tell an agent from an editor — the OS
/// does not keep that — but a file whose new content is byte-for-byte the
/// committed blob was put back by Git. That is a claim about the content, which
/// we can prove, rather than a guess about the process, which we cannot.
fn classify(path: &str, content: &str, kind: Kind) -> Kind {
    if kind == Kind::External && git_head_content(path.to_string()).as_deref() == Some(content) {
        Kind::Git
    } else {
        kind
    }
}

#[derive(serde::Serialize)]
struct Version {
    /// Epoch-ms timestamp; doubles as the snapshot's filename stem.
    id: u64,
    bytes: u64,
    kind: Kind,
}

struct Snap {
    id: u64,
    kind: Kind,
    file: std::path::PathBuf,
}

/// Parse a snapshot filename ("1719900000000.save.snap") into its id and kind.
/// Rejects anything else, so junk files are ignored and the id can never carry
/// path separators.
fn parse_version(name: &str) -> Option<(u64, Kind)> {
    let stem = name.strip_suffix(".snap")?;
    match stem.split_once('.') {
        Some((id, kind)) => Some((id.parse().ok()?, Kind::parse(kind)?)),
        // Written before versions carried a kind: back then every snapshot was a
        // save, so that's what they are.
        None => Some((stem.parse().ok()?, Kind::Save)),
    }
}

/// Given ids sorted newest-first, return the ones beyond `max` (to delete).
fn prune_ids(sorted_desc: &[u64], max: usize) -> Vec<u64> {
    if sorted_desc.len() <= max {
        Vec::new()
    } else {
        sorted_desc[max..].to_vec()
    }
}

fn snaps(dir: &std::path::Path) -> Vec<Snap> {
    let mut all: Vec<Snap> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_str()?.to_string();
            let (id, kind) = parse_version(&name)?;
            Some(Snap { id, kind, file: dir.join(name) })
        })
        .collect();
    all.sort_unstable_by(|a, b| b.id.cmp(&a.id)); // newest first
    all
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Record a version. Skips a snapshot identical to the latest one, keeps ids
/// monotonic (guards against same-ms writes / clock skew), and prunes within the
/// version's own kind.
#[tauri::command]
fn snapshot_version(
    app: tauri::AppHandle,
    path: String,
    content: String,
    kind: String,
) -> Result<(), String> {
    let kind = classify(&path, &content, Kind::parse(&kind).unwrap_or(Kind::Save));
    let dir = history_dir(&app, &path).ok_or("no data dir")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let all = snaps(&dir);
    if let Some(latest) = all.first() {
        if std::fs::read_to_string(&latest.file).ok().as_deref() == Some(content.as_str()) {
            return Ok(()); // the file already says this — nothing new to record
        }
    }

    // Ids double as timestamps *and* as the sort key, so two snapshots taken in
    // the same millisecond (before + after an external write, say) must not
    // collide or arrive out of order.
    let id = match all.first() {
        Some(latest) if now_ms() <= latest.id => latest.id + 1,
        _ => now_ms(),
    };
    std::fs::write(dir.join(format!("{id}.{}.snap", kind.tag())), &content)
        .map_err(|e| e.to_string())?;
    // The folder name is a hash; keep the human path for display/debugging.
    let _ = std::fs::write(dir.join("path"), &path);

    // Prune within the kind we just added to, and only that one.
    let mut ids: Vec<u64> = all
        .iter()
        .filter(|s| s.kind == kind)
        .map(|s| s.id)
        .collect();
    ids.insert(0, id);
    let doomed = prune_ids(&ids, kind.budget());
    for snap in all.iter().filter(|s| doomed.contains(&s.id)) {
        let _ = std::fs::remove_file(&snap.file);
    }
    Ok(())
}

/// Past versions of `path`, newest first.
#[tauri::command]
fn list_versions(app: tauri::AppHandle, path: String) -> Vec<Version> {
    let Some(dir) = history_dir(&app, &path) else {
        return Vec::new();
    };
    snaps(&dir)
        .into_iter()
        .map(|s| {
            let bytes = std::fs::metadata(&s.file).map(|m| m.len()).unwrap_or(0);
            Version { id: s.id, bytes, kind: s.kind }
        })
        .collect()
}

/// Content of one past version, found by id whatever kind it turned out to be.
#[tauri::command]
fn read_version(app: tauri::AppHandle, path: String, id: u64) -> Result<String, String> {
    let dir = history_dir(&app, &path).ok_or("no data dir")?;
    let snap = snaps(&dir)
        .into_iter()
        .find(|s| s.id == id)
        .ok_or("no such version")?;
    std::fs::read_to_string(&snap.file).map_err(|e| e.to_string())
}

// ── Git ─────────────────────────────────────────────────────────────────────
// HEAD is just one more version of the file, so it feeds the same diff renderer
// the local history does. We shell out to `git` rather than linking libgit2 or
// gix: reading one blob doesn't justify the dependency (or its entry in the
// third-party notices), and every Mac that has Xcode's tools has `git`.

fn git(dir: &std::path::Path, args: &[&str]) -> Option<String> {
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8(out.stdout).ok()
}

/// The repository root and the file's path relative to it (forward slashes, the
/// spelling `git show` and `git log` want). `None` when the file isn't inside a
/// Git repository at all — not an error, just nothing to compare against.
fn repo_rel(path: &str) -> Option<(std::path::PathBuf, String)> {
    let file = std::path::Path::new(path);
    let dir = file.parent()?;

    let root = git(dir, &["rev-parse", "--show-toplevel"])?;
    let root = std::path::PathBuf::from(root.trim());

    // Resolve symlinks on both sides first (on macOS /tmp is a symlink to
    // /private/tmp, and the two spellings would never strip to a relative).
    let file = file.canonicalize().ok()?;
    let root = root.canonicalize().ok()?;
    let rel = file.strip_prefix(&root).ok()?;
    let rel = rel.to_str()?.replace('\\', "/");
    Some((root, rel))
}

/// The file's content at an arbitrary revision (a branch name, tag, or commit
/// sha). `None` when there's no Git to ask; `Some("")` when the revision is real
/// but the file didn't exist there yet (so a diff reads it as wholly added,
/// rather than as a read failure). Callers treat `None` as "no comparison to
/// offer", never as a fault.
#[tauri::command]
fn git_ref_content(path: String, rev: String) -> Option<String> {
    let (root, rel) = repo_rel(&path)?;
    if let Some(content) = git(&root, &["show", &format!("{rev}:{rel}")]) {
        return Some(content);
    }
    // The blob didn't resolve. Distinguish "the file isn't in that revision"
    // (a valid answer — empty side) from "that revision doesn't exist" (None).
    match git(&root, &["rev-parse", "--verify", "--quiet", &format!("{rev}^{{commit}}")]) {
        Some(_) => Some(String::new()),
        None => None,
    }
}

/// The file's content as of `HEAD`, or `None` when there's nothing to compare
/// against: no Git, not a repository, no commits yet, or the file is untracked
/// (a brand new note). Kept as its own command because the version panel asks it
/// on every refresh just to learn whether Git is available at all.
#[tauri::command]
fn git_head_content(path: String) -> Option<String> {
    let (root, rel) = repo_rel(&path)?;
    git(&root, &["show", &format!("HEAD:{rel}")])
}

/// One comparison target the version panel can offer: a local branch, or a
/// commit that touched this file. `id` is what `git_ref_content` resolves;
/// `label` is what the user sees.
#[derive(serde::Serialize)]
struct GitRef {
    /// A branch name or a full commit sha — passed straight back as `rev`.
    id: String,
    /// "branch" or "commit", so the UI can tell them apart.
    kind: String,
    /// Branch name, or a short sha for a commit.
    label: String,
    /// A commit's subject line; absent for branches.
    subject: Option<String>,
}

/// Everything worth diffing this file against, beyond the versions already in
/// the local timeline: the repository's local branches, and the commits that
/// last touched this file. Empty when the file isn't in a Git repository — the
/// picker simply doesn't appear. Tags and unrelated commits are left out on
/// purpose: the list has to stay short enough to scan.
#[tauri::command]
fn git_refs(path: String) -> Vec<GitRef> {
    let Some((root, rel)) = repo_rel(&path) else {
        return Vec::new();
    };
    let mut refs = Vec::new();

    // Local branches, alphabetical. This is the review case MRDown exists for:
    // diff a branch an agent pushed against the working tree before merging.
    if let Some(out) = git(&root, &["for-each-ref", "--format=%(refname:short)", "refs/heads"]) {
        for name in out.lines().filter(|l| !l.is_empty()) {
            refs.push(GitRef {
                id: name.to_string(),
                kind: "branch".into(),
                label: name.to_string(),
                subject: None,
            });
        }
    }

    // Recent commits that touched this file. NUL between sha and subject so a
    // subject can hold anything (a tab, say) without breaking the split.
    if let Some(out) = git(
        &root,
        &["log", "-n", "20", "--format=%H%x00%s", "--", &rel],
    ) {
        for line in out.lines().filter(|l| !l.is_empty()) {
            let (sha, subject) = line.split_once('\0').unwrap_or((line, ""));
            refs.push(GitRef {
                id: sha.to_string(),
                kind: "commit".into(),
                label: sha.chars().take(7).collect(),
                subject: Some(subject.to_string()),
            });
        }
    }

    refs
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PendingFile::default())
        .manage(DocOpen::default())
        .invoke_handler(tauri::generate_handler![
            read_file,
            save_file,
            save_image,
            export_file,
            print_document,
            delete_file,
            file_mtime,
            read_dir,
            get_recent_files,
            add_recent_file,
            get_pending_file,
            apply_menu,
            set_document_open,
            snapshot_version,
            list_versions,
            read_version,
            git_head_content,
            git_ref_content,
            git_refs
        ])
        .on_menu_event(|app, event| {
            // Forward our custom item ids to the frontend, which maps them to
            // actions. Predefined items (undo/copy/…) are handled natively.
            let _ = app.emit("menu", event.id().as_ref());
        })
        .setup(|app| {
            #[cfg(desktop)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.set_title("MRDown").unwrap();

                // Initial menu, in the OS language and with no document open.
                // The frontend re-applies it in its resolved language (which may
                // be a saved override) right after load.
                if let Ok(menu) = build_menu(&app.handle(), system_lang(), false) {
                    let _ = app.set_menu(menu);
                }

                // Windows / Linux pass the file path as a launch argument.
                #[cfg(not(target_os = "macos"))]
                if let Some(path) = std::env::args().skip(1).find(|a| is_supported(a)) {
                    if let Some(state) = app.try_state::<PendingFile>() {
                        *state.0.lock().unwrap() = Some(path);
                    }
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, _event| {
            // macOS delivers double-click / "Open With" as an Apple event.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &_event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        if let Some(path) = path.to_str() {
                            handle_opened_file(_app, path.to_string());
                        }
                    }
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    /// Unique per call, not per millisecond: the tests run in parallel and
    /// `now_ms()` alone hands two of them the same directory to fight over.
    fn scratch(tag: &str) -> std::path::PathBuf {
        static N: AtomicUsize = AtomicUsize::new(0);
        std::env::temp_dir().join(format!(
            "mrdown-{tag}-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ))
    }

    /// A throwaway repository with one commit, to exercise `git_head_content`
    /// against the real `git` it shells out to rather than a stand-in.
    fn temp_repo() -> std::path::PathBuf {
        let dir = scratch("git");
        std::fs::create_dir_all(&dir).unwrap();
        let run = |args: &[&str]| {
            std::process::Command::new("git")
                .arg("-C")
                .arg(&dir)
                .args(args)
                .output()
                .unwrap();
        };
        run(&["init"]);
        run(&["config", "user.email", "t@example.com"]);
        run(&["config", "user.name", "t"]);
        std::fs::write(dir.join("note.md"), "committed\n").unwrap();
        run(&["add", "note.md"]);
        run(&["commit", "-m", "first"]);
        dir
    }

    #[test]
    fn git_head_content_reads_the_committed_version_not_the_working_tree() {
        let dir = temp_repo();
        let file = dir.join("note.md");
        // Change the file on disk: HEAD must still answer with what was committed.
        std::fs::write(&file, "edited\n").unwrap();

        let head = git_head_content(file.to_str().unwrap().to_string());
        assert_eq!(head.as_deref(), Some("committed\n"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn git_head_content_is_none_when_there_is_nothing_to_compare_against() {
        // An untracked file inside a repository — a brand new note.
        let dir = temp_repo();
        let fresh = dir.join("fresh.md");
        std::fs::write(&fresh, "never committed\n").unwrap();
        assert_eq!(git_head_content(fresh.to_str().unwrap().to_string()), None);
        let _ = std::fs::remove_dir_all(&dir);

        // A repository with no commits at all: HEAD doesn't resolve.
        let empty = scratch("empty");
        std::fs::create_dir_all(&empty).unwrap();
        let _ = std::process::Command::new("git")
            .arg("-C")
            .arg(&empty)
            .arg("init")
            .output()
            .unwrap();
        let file = empty.join("note.md");
        std::fs::write(&file, "unborn\n").unwrap();
        assert_eq!(git_head_content(file.to_str().unwrap().to_string()), None);
        let _ = std::fs::remove_dir_all(&empty);
    }

    /// Run a git command in `dir`, for tests that need to shape history.
    fn git_in(dir: &std::path::Path, args: &[&str]) {
        std::process::Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .unwrap();
    }

    #[test]
    fn git_ref_content_reads_a_branch_and_a_commit() {
        let dir = temp_repo();
        let file = dir.join("note.md");
        let path = file.to_str().unwrap().to_string();

        // A second commit on a feature branch changes the file.
        git_in(&dir, &["checkout", "-b", "feature"]);
        std::fs::write(&file, "on the branch\n").unwrap();
        git_in(&dir, &["commit", "-am", "second"]);
        // And the working tree is different again.
        std::fs::write(&file, "in the working tree\n").unwrap();

        // The branch tip sees the branch's version.
        assert_eq!(
            git_ref_content(path.clone(), "feature".into()).as_deref(),
            Some("on the branch\n")
        );
        // `main`/`master` (whatever init named it) still sees the first commit.
        let first_sha = git(&dir, &["rev-list", "--max-parents=0", "HEAD"]).unwrap();
        assert_eq!(
            git_ref_content(path.clone(), first_sha.trim().into()).as_deref(),
            Some("committed\n")
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn git_ref_content_is_empty_when_the_file_is_absent_from_a_real_revision() {
        let dir = temp_repo();
        // A commit that predates the file: it exists, but note.md doesn't.
        git_in(&dir, &["checkout", "-b", "before"]);
        git_in(&dir, &["rm", "note.md"]);
        git_in(&dir, &["commit", "-m", "remove"]);
        let sha = git(&dir, &["rev-parse", "HEAD"]).unwrap();
        git_in(&dir, &["checkout", "-"]);

        let file = dir.join("note.md");
        // Real revision, file not in it → empty (wholly added), not a failure.
        assert_eq!(
            git_ref_content(file.to_str().unwrap().to_string(), sha.trim().into()),
            Some(String::new())
        );
        // A revision that doesn't exist at all → None.
        assert_eq!(
            git_ref_content(file.to_str().unwrap().to_string(), "no-such-ref".into()),
            None
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn git_refs_lists_branches_and_commits_that_touched_the_file() {
        let dir = temp_repo();
        let file = dir.join("note.md");
        git_in(&dir, &["checkout", "-b", "feature"]);
        std::fs::write(&file, "changed\n").unwrap();
        git_in(&dir, &["commit", "-am", "tweak the note"]);

        let refs = git_refs(file.to_str().unwrap().to_string());

        let branches: Vec<&str> =
            refs.iter().filter(|r| r.kind == "branch").map(|r| r.label.as_str()).collect();
        assert!(branches.contains(&"feature"));

        let commits: Vec<&GitRef> = refs.iter().filter(|r| r.kind == "commit").collect();
        // Both commits touched note.md, and subjects come through.
        assert!(commits.iter().any(|c| c.subject.as_deref() == Some("tweak the note")));
        assert!(commits.iter().any(|c| c.subject.as_deref() == Some("first")));
        // Labels are short shas of the full id.
        assert!(commits.iter().all(|c| c.label.len() == 7 && c.id.starts_with(&c.label)));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn git_refs_is_empty_outside_a_repository() {
        let dir = scratch("norepo");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("note.md");
        std::fs::write(&file, "loose\n").unwrap();
        assert!(git_refs(file.to_str().unwrap().to_string()).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn supported_extensions_are_case_insensitive() {
        assert!(is_supported("a.md"));
        assert!(is_supported("A.MARKDOWN"));
        assert!(is_supported("notes.txt"));
        assert!(!is_supported("image.png"));
        assert!(!is_supported("Makefile"));
    }

    #[test]
    fn dir_entries_sort_folders_first_then_case_insensitive_name() {
        let mut e = vec![
            DirEntry { name: "zeta.md".into(), path: "zeta.md".into(), is_dir: false },
            DirEntry { name: "Beta".into(), path: "Beta".into(), is_dir: true },
            DirEntry { name: "alpha.md".into(), path: "alpha.md".into(), is_dir: false },
            DirEntry { name: "apple".into(), path: "apple".into(), is_dir: true },
        ];
        sort_dir_entries(&mut e);
        let order: Vec<&str> = e.iter().map(|d| d.name.as_str()).collect();
        assert_eq!(order, vec!["apple", "Beta", "alpha.md", "zeta.md"]);
    }

    fn v(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn recent_moves_existing_entry_to_front_without_duplicating() {
        let list = compute_recent(v(&["a", "b", "c"]), "c".into(), 10);
        assert_eq!(list, v(&["c", "a", "b"]));
    }

    #[test]
    fn recent_prepends_new_entry() {
        let list = compute_recent(v(&["a", "b"]), "z".into(), 10);
        assert_eq!(list, v(&["z", "a", "b"]));
    }

    #[test]
    fn recent_is_capped_at_max() {
        let list = compute_recent(v(&["a", "b", "c"]), "z".into(), 2);
        assert_eq!(list, v(&["z", "a"]));
    }

    #[test]
    fn save_file_writes_supported_and_rejects_others() {
        let path = std::env::temp_dir().join("mrdown_save_test.md");
        let path_str = path.to_str().unwrap().to_string();

        save_file(path_str.clone(), "# hello".to_string()).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "# hello");
        let _ = std::fs::remove_file(&path);

        assert!(save_file("/tmp/x.png".to_string(), "data".to_string()).is_err());
    }

    #[test]
    fn path_key_is_stable_and_distinct() {
        let a = path_key("/Users/x/notes/a.md");
        assert_eq!(a.len(), 16);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        // Deterministic across calls, and different paths differ.
        assert_eq!(a, path_key("/Users/x/notes/a.md"));
        assert_ne!(a, path_key("/Users/x/notes/b.md"));
    }

    #[test]
    fn parse_version_accepts_only_snap_numbers() {
        assert_eq!(parse_version("1719900000000.save.snap"), Some((1719900000000, Kind::Save)));
        assert_eq!(parse_version("42.external.snap"), Some((42, Kind::External)));
        assert_eq!(parse_version("7.draft.snap"), Some((7, Kind::Draft)));
        // Written before versions carried a kind: those were all saves.
        assert_eq!(parse_version("1719900000000.snap"), Some((1719900000000, Kind::Save)));
        assert_eq!(parse_version("path"), None); // the stored path file
        assert_eq!(parse_version("abc.snap"), None);
        assert_eq!(parse_version("123"), None);
        assert_eq!(parse_version("9.bogus.snap"), None);
        assert_eq!(parse_version("../evil.snap"), None); // no traversal
    }

    #[test]
    fn prune_keeps_newest_max() {
        // newest-first input
        let ids = [50u64, 40, 30, 20, 10];
        assert_eq!(prune_ids(&ids, 5), Vec::<u64>::new());
        assert_eq!(prune_ids(&ids, 10), Vec::<u64>::new());
        assert_eq!(prune_ids(&ids, 3), vec![20, 10]);
    }

    #[test]
    fn an_external_change_matching_the_committed_bytes_is_attributed_to_git() {
        let dir = temp_repo(); // note.md committed as "committed\n"
        let path = dir.join("note.md").to_str().unwrap().to_string();

        // Put back to exactly what's committed: that had to be Git.
        assert_eq!(classify(&path, "committed\n", Kind::External), Kind::Git);

        // Anything else stays anonymous — we have no idea who wrote it.
        assert_eq!(classify(&path, "something else\n", Kind::External), Kind::External);

        // Our own save is never re-attributed, even when it happens to match HEAD.
        assert_eq!(classify(&path, "committed\n", Kind::Save), Kind::Save);
        // Nor is a rescued draft, which by definition never touched the disk.
        assert_eq!(classify(&path, "committed\n", Kind::Draft), Kind::Draft);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_file_outside_git_is_never_attributed_to_git() {
        let dir = scratch("nogit");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("loose.md");
        std::fs::write(&file, "x\n").unwrap();
        let path = file.to_str().unwrap().to_string();
        assert_eq!(classify(&path, "x\n", Kind::External), Kind::External);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn each_kind_is_capped_on_its_own_budget() {
        // The point of separate budgets: an agent rewriting a file in a loop
        // must not evict the user's own saves.
        assert!(Kind::External.budget() < Kind::Save.budget());

        let external: Vec<u64> = (0..Kind::External.budget() as u64 + 5).rev().collect();
        let doomed = prune_ids(&external, Kind::External.budget());
        assert_eq!(doomed.len(), 5); // only externals are considered here

        // A save budget's worth of saves survives however many externals exist,
        // because pruning never looks outside the kind being written.
        let saves: Vec<u64> = (0..Kind::Save.budget() as u64).rev().collect();
        assert!(prune_ids(&saves, Kind::Save.budget()).is_empty());
    }
}
