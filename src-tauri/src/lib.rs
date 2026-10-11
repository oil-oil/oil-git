pub mod git;
pub mod lfs;
use git::{Error, Git, Result};
use notify::{RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
struct AppState {
    git: Mutex<Option<Git>>,
    sessions: Mutex<HashMap<String, PathBuf>>,
    recent_lock: Mutex<()>,
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
    watch_serial: Arc<AtomicU64>,
    launch: Mutex<Option<LaunchRequest>>,
}
#[derive(Clone, Serialize)]
struct LaunchRequest {
    path: String,
    view: String,
}
fn parse_launch(args: &[String]) -> Result<Option<LaunchRequest>> {
    if args.is_empty() {
        return Ok(None);
    }
    if args[0] != "open" || args.len() < 2 {
        return Err(Error::new(
            "arguments",
            "用法：oil-git open <项目路径> [--view changes|history]",
        ));
    }
    let view = if args.len() == 2 {
        "history"
    } else if args.len() == 4 && args[2] == "--view" {
        &args[3]
    } else {
        return Err(Error::new(
            "arguments",
            "请使用 --view changes 或 --view history。",
        ));
    };
    if !["history", "changes"].contains(&view) {
        return Err(Error::new("arguments", "视图必须是 changes 或 history。"));
    }
    let path = PathBuf::from(&args[1]);
    let path = if path.is_absolute() {
        path
    } else {
        std::env::current_dir()?.join(path)
    };
    Ok(Some(LaunchRequest {
        path: path.to_string_lossy().into(),
        view: view.into(),
    }))
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CliLanguage {
    English,
    Chinese,
}
fn system_language() -> CliLanguage {
    ["LC_ALL", "LC_MESSAGES", "LANG"]
        .iter()
        .filter_map(|key| std::env::var(key).ok())
        .find(|value| !value.is_empty())
        .map(|value| {
            if value.to_ascii_lowercase().starts_with("zh") {
                CliLanguage::Chinese
            } else {
                CliLanguage::English
            }
        })
        .unwrap_or(CliLanguage::English)
}
fn take_cli_language(args: &[String]) -> (Vec<String>, CliLanguage, bool) {
    let mut rest = Vec::with_capacity(args.len());
    let mut language = system_language();
    let mut valid = true;
    let mut index = 0;
    while index < args.len() {
        if args[index] == "--lang" {
            match args.get(index + 1).map(String::as_str) {
                Some("en") => language = CliLanguage::English,
                Some("zh-CN") => language = CliLanguage::Chinese,
                _ => valid = false,
            }
            index = (index + 2).min(args.len());
        } else {
            rest.push(args[index].clone());
            index += 1;
        }
    }
    (rest, language, valid)
}
fn cli_error(error: &Error, language: CliLanguage) -> String {
    if language == CliLanguage::Chinese {
        return error.message.clone();
    }
    match error.message_key.as_str() {
        "arguments" => "Invalid command arguments. Run `oil-git --help` for usage.".into(),
        "bare" => "Bare repositories are not supported. Open a Git project with a working tree.".into(),
        "binary" => "Line attribution is unavailable for this file.".into(),
        "changed" => "The file changed while it was being read. Try again.".into(),
        "changing" => "Git is changing. The repository will be read again shortly.".into(),
        "config" => "Could not read application configuration.".into(),
        "conflict" => "Line attribution is unavailable while this file has unresolved conflicts.".into(),
        "git" => "Git could not read the requested data.".into(),
        "gitMissing" => "Git was not found. Install Git, then check again.".into(),
        "gitUnavailable" => "Could not start Git. Check the Git installation and try again.".into(),
        "invalid" => "The Git read request is invalid.".into(),
        "io" => "The file system read failed.".into(),
        "lfsHelper" => "Could not safely locate the Git LFS helper.".into(),
        "missing" => "The project directory does not exist or cannot be accessed.".into(),
        "missingReference" => "The branch or tag has been removed.".into(),
        "notRepository" => "This folder is not a Git repository. Initialize it, then open it again.".into(),
        "open" => "Could not open the requested link.".into(),
        "partialCloneUnsupported" => "Partial clones are not supported in read-only mode because Git may download missing objects on demand.".into(),
        "path" => "The project path is invalid.".into(),
        "process" => "The Git process failed. Try again.".into(),
        "read" => "The read failed. Try again.".into(),
        "recent" => "Could not read recent project records.".into(),
        "session" => "The project session is closed. Open the project again.".into(),
        "staleHistory" => "Commit history changed while reading. Reload and try again.".into(),
        "symlink" => "Symbolic link contents are not read as regular text files.".into(),
        "timeout" => "The Git read timed out. Try again.".into(),
        "tooLarge" => "The Git result is too large to read completely.".into(),
        "unsafeFilter" => "This Git content filter is unsupported and cannot be read safely.".into(),
        "unsafePath" => "A repository path is outside the safe read boundary.".into(),
        "unsupportedLfsExtension" => "Git LFS pointer extensions are not supported.".into(),
        "lfsAttributeSourceUnsupported" => "Git could not read historical LFS attributes. The raw diff is still available.".into(),
        "watch" => "Could not watch for repository changes.".into(),
        _ => error.message.clone(),
    }
}
fn cli_error_payload(error: &Error, language: CliLanguage) -> serde_json::Value {
    serde_json::json!({
        "status": "error",
        "kind": error.kind,
        "messageKey": error.message_key,
        "message": cli_error(error, language),
        "diagnostic": error.message,
    })
}
fn invalid_language_message(language: CliLanguage) -> &'static str {
    if language == CliLanguage::Chinese {
        "--lang 仅支持 en 或 zh-CN。"
    } else {
        "--lang supports only en or zh-CN."
    }
}
fn invalid_language_payload(language: CliLanguage) -> serde_json::Value {
    let message = invalid_language_message(language);
    serde_json::json!({
        "status": "error",
        "kind": "arguments",
        "messageKey": "arguments",
        "message": message,
        "diagnostic": "--lang supports only en or zh-CN.",
    })
}
fn installed_skill_path(language: CliLanguage) -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        #[cfg(target_os = "macos")]
        let resource = exe.parent().and_then(|p| p.parent()).map(|p| {
            p.join(if language == CliLanguage::Chinese {
                "Resources/skills/oil-git/SKILL.zh-CN.md"
            } else {
                "Resources/skills/oil-git/SKILL.md"
            })
        });
        #[cfg(not(target_os = "macos"))]
        let resource = exe.parent().map(|p| {
            p.join(if language == CliLanguage::Chinese {
                "skills/oil-git/SKILL.zh-CN.md"
            } else {
                "skills/oil-git/SKILL.md"
            })
        });
        if let Some(path) = resource {
            if path.is_file() {
                return path;
            }
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(if language == CliLanguage::Chinese {
        "../skills/oil-git/SKILL.zh-CN.md"
    } else {
        "../skills/oil-git/SKILL.md"
    })
}
#[derive(Clone, Serialize, Deserialize)]
struct Recent {
    path: String,
    name: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Opened {
    repo_id: String,
    snapshot: git::Snapshot,
}
fn context(state: &AppState, id: &str) -> Result<(Git, PathBuf)> {
    let git = state
        .git
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| Error::new("gitMissing", "没有找到可用的 Git，请重新检测。"))?;
    let path = state
        .sessions
        .lock()
        .unwrap()
        .get(id)
        .cloned()
        .ok_or_else(|| Error::new("session", "项目已关闭，请重新打开。"))?;
    Ok((git, path))
}
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| Error::new("read", e.to_string()))?
}
fn recent_path(app: &tauri::AppHandle) -> Result<PathBuf> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| Error::new("config", e.to_string()))?
        .join("recent.json"))
}
fn read_recents(app: &tauri::AppHandle) -> Vec<Recent> {
    recent_path(app)
        .ok()
        .and_then(|p| fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}
fn forget_recent_file(file: &Path, path: &str) -> Result<Vec<Recent>> {
    if path.trim().is_empty() {
        return Err(Error::new("path", "最近项目路径不能为空。"));
    }
    if !Path::new(path).is_absolute() {
        return Err(Error::new("path", "最近项目路径必须是绝对路径。"));
    }

    let mut recent = match fs::read(file) {
        Ok(bytes) => serde_json::from_slice::<Vec<Recent>>(&bytes)
            .map_err(|e| Error::new("recent", format!("读取最近项目失败：{e}")))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(Error::new("recent", format!("读取最近项目失败：{e}"))),
    };
    let original_len = recent.len();
    recent.retain(|entry| entry.path != path);
    if recent.len() == original_len {
        return Ok(recent);
    }

    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| Error::new("recent", format!("保存最近项目失败：{e}")))?;
    }
    let body = serde_json::to_vec_pretty(&recent)
        .map_err(|e| Error::new("recent", format!("保存最近项目失败：{e}")))?;
    let temp = file.with_file_name(format!(".recent-{}.tmp", std::process::id()));
    fs::write(&temp, body).map_err(|e| Error::new("recent", format!("保存最近项目失败：{e}")))?;
    if let Err(e) = fs::rename(&temp, file) {
        let _ = fs::remove_file(&temp);
        return Err(Error::new("recent", format!("保存最近项目失败：{e}")));
    }
    Ok(recent)
}
#[tauri::command]
async fn check_git(state: State<'_, AppState>) -> Result<String> {
    let (git, version) = blocking(Git::discover).await?;
    *state.git.lock().unwrap() = Some(git);
    Ok(version)
}
#[tauri::command]
fn recent_repositories(app: tauri::AppHandle, state: State<'_, AppState>) -> Vec<Recent> {
    let _lock = state.recent_lock.lock().unwrap();
    read_recents(&app)
}
#[tauri::command]
fn forget_recent_repository(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<Recent>> {
    let _lock = state.recent_lock.lock().unwrap();
    forget_recent_file(&recent_path(&app)?, &path)
}
#[tauri::command]
fn take_launch_request(state: State<'_, AppState>) -> Option<LaunchRequest> {
    state.launch.lock().unwrap().take()
}
#[tauri::command]
async fn open_repository(state: State<'_, AppState>, path: String) -> Result<Opened> {
    let git = state
        .git
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| Error::new("gitMissing", "请先安装 Git 并重新检测。"))?;
    let (path, snapshot) = blocking(move || {
        let root = git.normalize(&PathBuf::from(path))?;
        let snapshot = git.snapshot(&root)?;
        Ok((root, snapshot))
    })
    .await?;
    let id = git::repo_id(&path);
    state.sessions.lock().unwrap().insert(id.clone(), path);
    Ok(Opened {
        repo_id: id,
        snapshot,
    })
}
fn noisy_git_event(relative: &Path) -> bool {
    let mut components = relative.components();
    match components.next().and_then(|c| c.as_os_str().to_str()) {
        Some("logs") => true,
        Some("objects") => components.next().and_then(|c| c.as_os_str().to_str()) != Some("info"),
        _ => false,
    }
}
fn event_path_is_in_scope(path: &Path, repo: &Path, git_dir: &Path, git_common: &Path) -> bool {
    // Git metadata is checked first because a normal repository's .git directory
    // lives inside the checkout. Object writes and reflog churn are noisy; refs,
    // index, shallow boundaries, grafts and replacement refs remain observable.
    if let Ok(relative) = path.strip_prefix(git_dir) {
        return !noisy_git_event(relative);
    }
    if let Ok(relative) = path.strip_prefix(git_common) {
        return !noisy_git_event(relative);
    }
    path.strip_prefix(repo).is_ok()
}
fn remember_repository(app: &tauri::AppHandle, repo: &Path) {
    let path = repo.to_string_lossy().into_owned();
    let mut recent = read_recents(app);
    recent.retain(|r| r.path != path);
    recent.insert(
        0,
        Recent {
            path: path.clone(),
            name: repo
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| "仓库".into()),
        },
    );
    recent.truncate(12);
    if let Ok(file) = recent_path(app) {
        if let Some(parent) = file.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(body) = serde_json::to_vec_pretty(&recent) {
            let _ = fs::write(file, body);
        }
    }
}
#[tauri::command]
fn activate_repository(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    remember: Option<bool>,
) -> Result<()> {
    let (git, repo) = context(&state, &repo_id)?;
    let serial = state.watch_serial.fetch_add(1, Ordering::SeqCst) + 1;
    if remember.unwrap_or(true) {
        let _lock = state.recent_lock.lock().unwrap();
        remember_repository(&app, &repo);
    }
    *state.watcher.lock().unwrap() = None;
    let expected = state.watch_serial.clone();
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let git_dir = PathBuf::from(git.text(&repo, &["rev-parse", "--git-dir"], false)?);
    let git_dir = if git_dir.is_absolute() {
        git_dir
    } else {
        repo.join(git_dir)
    };
    let git_dir = dunce::canonicalize(&git_dir).unwrap_or(git_dir);
    let common = PathBuf::from(git.text(&repo, &["rev-parse", "--git-common-dir"], false)?);
    let common = if common.is_absolute() {
        common
    } else {
        repo.join(common)
    };
    let common = dunce::canonicalize(&common).unwrap_or(common);
    let event_repo = repo.clone();
    let event_git_dir = git_dir.clone();
    let event_common = common.clone();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event {
            if matches!(event.kind, notify::EventKind::Access(_)) {
                return;
            }
            // Scope events to this checkout or Git metadata roots. Paths inside
            // the checkout are never filtered by generated-directory names:
            // those directories can contain tracked source files.
            let useful = event.paths.iter().any(|path| {
                event_path_is_in_scope(path, &event_repo, &event_git_dir, &event_common)
            });
            if useful {
                let _ = tx.try_send(());
            }
        }
    })
    .map_err(|e| Error::new("watch", e.to_string()))?;
    watcher
        .watch(&repo, RecursiveMode::Recursive)
        .map_err(|e| Error::new("watch", e.to_string()))?;
    if !git_dir.starts_with(&repo) {
        watcher
            .watch(&git_dir, RecursiveMode::Recursive)
            .map_err(|e| Error::new("watch", e.to_string()))?;
    }
    if !common.starts_with(&repo) && common != git_dir {
        let _ = watcher.watch(&common, RecursiveMode::Recursive);
    }
    *state.watcher.lock().unwrap() = Some(watcher);
    thread::spawn(move || {
        while rx.recv().is_ok() {
            thread::sleep(Duration::from_millis(300));
            while rx.try_recv().is_ok() {}
            if expected.load(Ordering::SeqCst) != serial {
                break;
            }
            let _ = app.emit("repository-invalidated", &repo_id);
        }
    });
    Ok(())
}
#[tauri::command]
async fn get_snapshot(state: State<'_, AppState>, repo_id: String) -> Result<git::Snapshot> {
    let (git, repo) = context(&state, &repo_id)?;
    blocking(move || git.snapshot(&repo)).await
}
#[tauri::command]
async fn get_history(
    state: State<'_, AppState>,
    repo_id: String,
    reference: String,
    offset: usize,
    expected: String,
) -> Result<git::HistoryPage> {
    let (git, repo) = context(&state, &repo_id)?;
    blocking(move || git.history(&repo, &reference, offset, &expected)).await
}
#[tauri::command]
async fn get_commit(
    state: State<'_, AppState>,
    repo_id: String,
    commit: String,
    expected_history_revision: Option<String>,
) -> Result<git::CommitDetail> {
    let (git, repo) = context(&state, &repo_id)?;
    blocking(move || git.commit_at_revision(&repo, &commit, expected_history_revision.as_deref()))
        .await
}
#[tauri::command]
async fn get_commit_view(
    state: State<'_, AppState>,
    repo_id: String,
    commit: String,
    path: Option<String>,
    expected_history_revision: Option<String>,
) -> Result<git::CommitView> {
    let (git, repo) = context(&state, &repo_id)?;
    blocking(move || {
        git.commit_view_at_revision(
            &repo,
            &commit,
            path.as_deref(),
            expected_history_revision.as_deref(),
        )
    })
    .await
}
#[tauri::command]
async fn get_diff(
    state: State<'_, AppState>,
    repo_id: String,
    mode: String,
    path: String,
    commit: Option<String>,
    expected_history_revision: Option<String>,
) -> Result<git::Diff> {
    let (git, repo) = context(&state, &repo_id)?;
    blocking(move || {
        git.diff_at_revision(
            &repo,
            &mode,
            &path,
            commit.as_deref(),
            expected_history_revision.as_deref(),
        )
    })
    .await
}
#[tauri::command]
async fn get_line_origin(
    state: State<'_, AppState>,
    repo_id: String,
    request: git::LineOriginRequest,
) -> Result<git::LineOrigin> {
    let (git, repo) = context(&state, &repo_id)?;
    blocking(move || git.line_origin(&repo, &request)).await
}
#[tauri::command]
fn open_git_install(app: tauri::AppHandle) -> Result<()> {
    #[cfg(target_os = "macos")]
    let url = "https://git-scm.com/download/mac";
    #[cfg(target_os = "windows")]
    let url = "https://git-scm.com/download/win";
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let url = "https://git-scm.com/downloads";
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| Error::new("open", e.to_string()))
}
pub fn run() {
    let raw_args: Vec<_> = std::env::args().skip(1).collect();
    if raw_args
        .first()
        .is_some_and(|arg| arg == lfs::CLEAN_COMMAND)
    {
        let status = if raw_args.len() == 1 {
            lfs::run_clean()
        } else {
            eprintln!("oil-git: invalid hidden LFS clean arguments");
            2
        };
        std::process::exit(status);
    }
    if raw_args
        .first()
        .is_some_and(|arg| arg == lfs::FILTER_PROCESS_COMMAND)
    {
        let status = if raw_args.len() == 1 {
            lfs::run_filter_process()
        } else {
            eprintln!("oil-git: invalid hidden LFS filter-process arguments");
            2
        };
        std::process::exit(status);
    }
    let (args, language, valid_language) = take_cli_language(&raw_args);
    if !valid_language {
        if args.first().is_some_and(|arg| arg == "inspect") {
            println!("{}", invalid_language_payload(language));
        } else {
            eprintln!("{}", invalid_language_message(language));
        }
        std::process::exit(2);
    }
    if args.first().is_some_and(|a| a == "--help" || a == "-h") {
        if language == CliLanguage::Chinese {
            println!("Oil Git 只读 Git 查看工具\n\n用法：\n打开：oil-git open <项目路径> [--view changes|history]\n读取：oil-git inspect <项目路径> --json\nSkill：oil-git skill [--path]\n语言：oil-git --lang en|zh-CN <命令>\n无参数启动桌面界面。");
        } else {
            println!("Oil Git read-only Git viewer\n\nUsage:\nOpen: oil-git open <project-path> [--view changes|history]\nInspect: oil-git inspect <project-path> --json\nSkill: oil-git skill [--path]\nLanguage: oil-git --lang en|zh-CN <command>\nRun without arguments to launch the desktop app.");
        }
        return;
    }
    if args.first().is_some_and(|a| a == "--version") {
        println!("oil-git {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    if args.first().is_some_and(|a| a == "skill") {
        if args.len() == 1 {
            if language == CliLanguage::Chinese {
                print!("{}", include_str!("../../skills/oil-git/SKILL.zh-CN.md"));
            } else {
                print!("{}", include_str!("../../skills/oil-git/SKILL.md"));
            }
        } else if args.len() == 2 && args[1] == "--path" {
            println!("{}", installed_skill_path(language).display());
        } else {
            if language == CliLanguage::Chinese {
                eprintln!("用法：oil-git skill [--path]");
            } else {
                eprintln!("Usage: oil-git skill [--path]");
            }
            std::process::exit(2);
        }
        return;
    }
    if args.first().is_some_and(|a| a == "inspect") {
        let result = if args.len() == 3 && args[2] == "--json" {
            Git::discover().and_then(|(git, _)| {
                git.normalize(&PathBuf::from(&args[1]))
                    .and_then(|repo| git.snapshot(&repo))
            })
        } else {
            Err(Error::new(
                "arguments",
                "用法：oil-git inspect <项目路径> --json",
            ))
        };
        match result {
            Ok(data) => println!("{}", serde_json::json!({"status":"ready","data":data})),
            Err(error) => {
                println!("{}", cli_error_payload(&error, language));
                std::process::exit(2);
            }
        }
        return;
    }
    let launch = match parse_launch(&args) {
        Ok(request) => request,
        Err(error) => {
            eprintln!("{}", cli_error(&error, language));
            std::process::exit(2);
        }
    };
    let state = AppState {
        launch: Mutex::new(launch),
        ..Default::default()
    };
    tauri::Builder::default()
        .manage(state)
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let raw: Vec<_> = args.into_iter().skip(1).collect();
            let (parsed, _, language_valid) = take_cli_language(&raw);
            // 第二个进程的相对路径由它自己的工作目录解释。
            let parsed = if parsed.first().is_some_and(|a| a == "open") && parsed.len() > 1 {
                let mut p = parsed;
                let path = PathBuf::from(&p[1]);
                if !path.is_absolute() {
                    p[1] = PathBuf::from(cwd).join(path).to_string_lossy().into();
                }
                p
            } else {
                parsed
            };
            if language_valid {
                if let Ok(Some(request)) = parse_launch(&parsed) {
                    *app.state::<AppState>().launch.lock().unwrap() = Some(request.clone());
                    let _ = app.emit("open-request", request);
                }
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            check_git,
            recent_repositories,
            forget_recent_repository,
            take_launch_request,
            open_repository,
            activate_repository,
            get_snapshot,
            get_history,
            get_commit,
            get_commit_view,
            get_diff,
            get_line_origin,
            open_git_install
        ])
        .run(tauri::generate_context!())
        .expect("无法启动 Oil Git");
}

#[cfg(test)]
mod cli_tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn forgetting_a_recent_path_does_not_require_the_checkout_to_exist() {
        let directory = tempdir().unwrap();
        let file = directory.path().join("recent.json");
        let missing = directory.path().join("removed-project");
        let missing_path = missing.to_string_lossy().into_owned();
        let other_path = directory
            .path()
            .join("kept-project")
            .to_string_lossy()
            .into_owned();
        let recent = vec![
            Recent {
                path: missing_path.clone(),
                name: "removed-project".into(),
            },
            Recent {
                path: other_path.clone(),
                name: "kept-project".into(),
            },
        ];
        fs::write(&file, serde_json::to_vec(&recent).unwrap()).unwrap();

        let remaining = forget_recent_file(&file, &missing_path).unwrap();

        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].path, other_path);
        let remaining: Vec<Recent> = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].path, other_path);
        assert!(!missing.exists());
    }

    #[test]
    fn forgetting_a_recent_path_rejects_relative_paths_without_writing() {
        let directory = tempdir().unwrap();
        let file = directory.path().join("recent.json");
        let recent = vec![Recent {
            path: "/existing/recent".into(),
            name: "recent".into(),
        }];
        let original = serde_json::to_vec(&recent).unwrap();
        fs::write(&file, &original).unwrap();

        let error = match forget_recent_file(&file, "relative/project") {
            Ok(_) => panic!("relative paths should be rejected"),
            Err(error) => error,
        };

        assert_eq!(error.kind, "path");
        assert_eq!(fs::read(&file).unwrap(), original);
    }

    #[test]
    fn accepts_open_views_and_rejects_invalid_commands() {
        let request = parse_launch(&[
            "open".into(),
            "项目 with space".into(),
            "--view".into(),
            "changes".into(),
        ])
        .unwrap()
        .unwrap();
        assert_eq!(request.view, "changes");
        assert!(PathBuf::from(request.path).is_absolute());
        assert_eq!(
            parse_launch(&["open".into(), ".".into()])
                .unwrap()
                .unwrap()
                .view,
            "history"
        );
        assert!(parse_launch(&["commit".into(), ".".into()]).is_err());
        assert!(
            parse_launch(&["open".into(), ".".into(), "--view".into(), "unknown".into()]).is_err()
        );
    }

    #[test]
    fn language_flag_can_appear_before_or_after_cli_command() {
        let (args, language, valid) = take_cli_language(&[
            "--lang".into(),
            "en".into(),
            "inspect".into(),
            "/repo".into(),
            "--json".into(),
        ]);
        assert!(valid);
        assert_eq!(language, CliLanguage::English);
        assert_eq!(args, ["inspect", "/repo", "--json"]);

        let (args, language, valid) = take_cli_language(&[
            "inspect".into(),
            "/repo".into(),
            "--json".into(),
            "--lang".into(),
            "zh-CN".into(),
        ]);
        assert!(valid);
        assert_eq!(language, CliLanguage::Chinese);
        assert_eq!(args, ["inspect", "/repo", "--json"]);
    }

    #[test]
    fn invalid_language_on_inspect_keeps_the_json_error_contract() {
        let (args, language, valid) = take_cli_language(&[
            "inspect".into(),
            "/repo".into(),
            "--json".into(),
            "--lang".into(),
            "fr".into(),
        ]);
        assert!(!valid);
        assert_eq!(args, ["inspect", "/repo", "--json"]);
        let payload = invalid_language_payload(language);
        assert_eq!(payload["status"], "error");
        assert_eq!(payload["kind"], "arguments");
        assert_eq!(payload["messageKey"], "arguments");
        assert!(payload["message"].as_str().unwrap().contains("--lang"));
        assert_eq!(payload["diagnostic"], "--lang supports only en or zh-CN.");

        let english_payload = invalid_language_payload(CliLanguage::English);
        let chinese_payload = invalid_language_payload(CliLanguage::Chinese);
        assert_eq!(
            english_payload["diagnostic"], chinese_payload["diagnostic"],
            "the diagnostic is stable across locales"
        );
        assert_ne!(english_payload["message"], chinese_payload["message"]);

        let (_, _, valid) = take_cli_language(&[
            "inspect".into(),
            "/repo".into(),
            "--json".into(),
            "--lang".into(),
        ]);
        assert!(!valid);
    }

    #[test]
    fn inspect_error_payload_keeps_the_raw_diagnostic() {
        let error = Error::new(
            "unsafeFilter",
            "filter.demo.clean may modify repository files",
        );
        let payload = cli_error_payload(&error, CliLanguage::English);
        assert_eq!(payload["kind"], "unsafeFilter");
        assert_eq!(payload["messageKey"], "unsafeFilter");
        assert!(payload["message"].as_str().unwrap().contains("unsupported"));
        assert_eq!(
            payload["diagnostic"],
            "filter.demo.clean may modify repository files"
        );
    }

    #[test]
    fn watcher_scope_uses_repository_and_git_roots() {
        let repo = Path::new("/projects/build/my-repo");
        let common = Path::new("/projects/shared/my-repo.git");
        let git_dir = common;
        assert!(event_path_is_in_scope(
            &repo.join("target/generated.rs"),
            repo,
            git_dir,
            common
        ));
        assert!(event_path_is_in_scope(
            &repo.join("build/src/main.rs"),
            repo,
            git_dir,
            common
        ));
        assert!(!event_path_is_in_scope(
            &common.join("objects/pack/pack.idx"),
            repo,
            git_dir,
            common
        ));
        assert!(!event_path_is_in_scope(
            &common.join("logs/refs/heads/main"),
            repo,
            git_dir,
            common
        ));
        assert!(event_path_is_in_scope(
            &common.join("objects/info/alternates"),
            repo,
            git_dir,
            common
        ));
        assert!(event_path_is_in_scope(
            &common.join("refs/replace/abc"),
            repo,
            git_dir,
            common
        ));
        assert!(!event_path_is_in_scope(
            Path::new("/projects/build/other-repo/src/main.rs"),
            repo,
            git_dir,
            common
        ));
    }
}
