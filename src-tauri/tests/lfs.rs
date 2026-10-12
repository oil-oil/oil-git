use oil_git_lib::git::{Git, LfsDiff, LfsSideState};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};
use tempfile::TempDir;

struct Fixture {
    _temp: TempDir,
    repo: PathBuf,
    git: Git,
}

impl Fixture {
    fn new() -> Self {
        let temp = TempDir::new().unwrap();
        let repo = temp.path().join("仓库 with spaces");
        fs::create_dir(&repo).unwrap();
        let repo = dunce::canonicalize(repo).unwrap();

        let (discovered, _) = Git::discover().unwrap();
        let source = PathBuf::from(env!("CARGO_BIN_EXE_oil-git"));
        let helper_dir = temp.path().join("可信 helper 带 spaces");
        fs::create_dir_all(&helper_dir).unwrap();
        #[cfg(windows)]
        let helper = helper_dir.join("oil-git-lfs-test.exe");
        #[cfg(not(windows))]
        let helper = helper_dir.join("oil-git-lfs-test");
        fs::copy(source, &helper).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(&helper).unwrap().permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&helper, permissions).unwrap();
        }
        let git = Git::with_lfs_helper(discovered.binary, helper);
        let fixture = Self {
            _temp: temp,
            repo,
            git,
        };
        fixture.cmd(&["init", "-b", "main"]);
        fixture.cmd(&["config", "user.name", "LFS Test"]);
        fixture.cmd(&["config", "user.email", "lfs-test@example.invalid"]);
        fixture.cmd(&["config", "core.autocrlf", "false"]);
        fixture.cmd(&["config", "filter.lfs.process", "git-lfs filter-process"]);
        fixture.cmd(&["config", "filter.lfs.clean", "git-lfs clean -- %f"]);
        fixture.cmd(&["config", "filter.lfs.smudge", "git-lfs smudge -- %f"]);
        fixture.write(
            ".gitattributes",
            "*.bin filter=lfs diff=lfs merge=lfs -text\n",
        );
        fixture.cmd(&["add", "--", ".gitattributes"]);
        fixture.commit("添加 LFS 属性");
        fixture
    }

    fn cmd(&self, args: &[&str]) -> String {
        self.git.text(&self.repo, args, false).unwrap()
    }

    fn write(&self, path: &str, content: impl AsRef<[u8]>) {
        let target = self.repo.join(path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(target, content).unwrap();
    }

    fn commit(&self, message: &str) -> String {
        self.cmd(&["add", "."]);
        self.cmd(&["commit", "-m", message]);
        self.cmd(&["rev-parse", "HEAD"])
    }

    fn raw_git(&self, args: &[&str], input: Option<&[u8]>) -> Vec<u8> {
        let mut command = Command::new(&self.git.binary);
        command
            .arg("-C")
            .arg(&self.repo)
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(if input.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            });
        for (key, _) in std::env::vars_os().filter(|(key, _)| {
            key.to_string_lossy()
                .to_ascii_uppercase()
                .starts_with("GIT_")
        }) {
            command.env_remove(key);
        }
        let mut child = command.spawn().unwrap();
        if let Some(input) = input {
            child.stdin.take().unwrap().write_all(input).unwrap();
        }
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "raw git failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        output.stdout
    }

    fn raw_git_without_filters(&self, args: &[&str], input: Option<&[u8]>) -> std::process::Output {
        let mut command = Command::new(&self.git.binary);
        command
            .args([
                "-c",
                "filter.lfs.process=",
                "-c",
                "filter.lfs.clean=",
                "-c",
                "filter.lfs.smudge=",
                "-c",
                "filter.lfs.required=false",
                "-C",
            ])
            .arg(&self.repo)
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(if input.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            });
        for (key, _) in std::env::vars_os().filter(|(key, _)| {
            key.to_string_lossy()
                .to_ascii_uppercase()
                .starts_with("GIT_")
        }) {
            command.env_remove(key);
        }
        command
            .env(
                "GIT_CONFIG_GLOBAL",
                if cfg!(windows) { "NUL" } else { "/dev/null" },
            )
            .env("GIT_CONFIG_NOSYSTEM", "1");
        let mut child = command.spawn().unwrap();
        if let Some(input) = input {
            child.stdin.take().unwrap().write_all(input).unwrap();
        }
        child.wait_with_output().unwrap()
    }

    fn add_baseline(&self, path: &str, bytes: &[u8]) -> Pointer {
        self.write(path, bytes);
        self.cmd(&["add", "--", path]);
        let blob = self
            .git
            .run(&self.repo, &["show", &format!(":{path}")], 4096, false);
        let blob = blob.unwrap().bytes;
        let pointer = parse_pointer(&blob).expect("clean filter should write a pointer blob");
        assert_eq!(pointer.oid, sha256(bytes));
        assert_eq!(pointer.size, bytes.len() as u64);
        self.cmd(&["commit", "-m", "add LFS file"]);
        pointer
    }
}

#[derive(Debug, PartialEq, Eq)]
struct Pointer {
    oid: String,
    size: u64,
}

fn parse_pointer(bytes: &[u8]) -> Option<Pointer> {
    let text = std::str::from_utf8(bytes).ok()?;
    let mut version = false;
    let mut oid = None;
    let mut size = None;
    for line in text.lines() {
        if line == "version https://git-lfs.github.com/spec/v1" {
            version = true;
        } else if let Some(value) = line.strip_prefix("oid sha256:") {
            oid = Some(value.to_owned());
        } else if let Some(value) = line.strip_prefix("size ") {
            size = value.parse().ok();
        }
    }
    if !version {
        return None;
    }
    Some(Pointer {
        oid: oid?,
        size: size?,
    })
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn tree_bytes(root: &Path) -> Vec<(PathBuf, Vec<u8>)> {
    fn visit(root: &Path, current: &Path, files: &mut Vec<(PathBuf, Vec<u8>)>) {
        for entry in fs::read_dir(current).unwrap() {
            let entry = entry.unwrap();
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).unwrap();
            if metadata.file_type().is_symlink() {
                files.push((
                    path.strip_prefix(root).unwrap().to_path_buf(),
                    fs::read_link(path)
                        .unwrap()
                        .to_string_lossy()
                        .as_bytes()
                        .to_vec(),
                ));
            } else if metadata.is_dir() {
                visit(root, &path, files);
            } else if metadata.is_file() {
                files.push((
                    path.strip_prefix(root).unwrap().to_path_buf(),
                    fs::read(path).unwrap(),
                ));
            }
        }
    }
    let mut files = Vec::new();
    visit(root, root, &mut files);
    files.sort_by(|left, right| left.0.cmp(&right.0));
    files
}

#[test]
fn bundled_process_cleans_content_and_preserves_empty_and_pointer_only_files() {
    let f = Fixture::new();
    let content = b"ordinary bytes\0and binary data";
    f.write("materialized.bin", content);
    f.cmd(&["add", "--", "materialized.bin"]);
    let pointer = parse_pointer(
        &f.git
            .run(&f.repo, &["show", ":materialized.bin"], 4096, false)
            .unwrap()
            .bytes,
    )
    .unwrap();
    assert_eq!(pointer.oid, sha256(content));
    assert_eq!(pointer.size, content.len() as u64);

    let supplied_pointer = format!(
        "version https://git-lfs.github.com/spec/v1\noid sha256:{}\nsize 12\n",
        "a".repeat(64)
    );
    f.write("pointer-only.bin", supplied_pointer.as_bytes());
    f.cmd(&["add", "--", "pointer-only.bin"]);
    let stored = f
        .git
        .run(&f.repo, &["show", ":pointer-only.bin"], 4096, false)
        .unwrap()
        .bytes;
    assert_eq!(stored, supplied_pointer.as_bytes());

    let unknown_pointer_text = format!(
        "version https://git-lfs.github.com/spec/v1\nextra-field this is file content\noid sha256:{}\nsize 12\n",
        "c".repeat(64)
    );
    f.write("unknown-pointer.bin", unknown_pointer_text.as_bytes());
    f.cmd(&["add", "--", "unknown-pointer.bin"]);
    let cleaned_unknown = f
        .git
        .run(&f.repo, &["show", ":unknown-pointer.bin"], 4096, false)
        .unwrap()
        .bytes;
    let cleaned_unknown = parse_pointer(&cleaned_unknown).unwrap();
    assert_eq!(cleaned_unknown.oid, sha256(unknown_pointer_text.as_bytes()));
    assert_eq!(cleaned_unknown.size, unknown_pointer_text.len() as u64);
    f.cmd(&[
        "commit",
        "-m",
        "clean unknown pointer text as ordinary content",
    ]);
    assert!(!f
        .git
        .snapshot(&f.repo)
        .unwrap()
        .files
        .iter()
        .any(|file| file.path == "unknown-pointer.bin"));

    f.write("empty.bin", []);
    f.cmd(&["add", "--", "empty.bin"]);
    assert!(f
        .git
        .run(&f.repo, &["show", ":empty.bin"], 16, false)
        .unwrap()
        .bytes
        .is_empty());
    assert!(!f.repo.join(".git/lfs").exists());
}

#[test]
fn diffs_report_lfs_pointer_metadata_for_staged_unstaged_deleted_and_untracked_files() {
    let f = Fixture::new();
    let baseline_bytes = b"baseline materialized file";
    let baseline = f.add_baseline("asset.bin", baseline_bytes);

    let staged_bytes = b"staged materialized bytes";
    f.write("asset.bin", staged_bytes);
    f.cmd(&["add", "--", "asset.bin"]);
    let working_bytes = b"working materialized bytes\0with binary content";
    f.write("asset.bin", working_bytes);
    let before = tree_bytes(&f.repo);
    let snapshot = f.git.snapshot(&f.repo).unwrap();
    assert!(snapshot.files.iter().any(|file| file.path == "asset.bin"));
    let staged = f.git.diff(&f.repo, "staged", "asset.bin", None).unwrap();
    let staged_lfs = staged.lfs.expect("staged LFS diff metadata");
    assert_pointer(
        &staged_lfs,
        true,
        &baseline,
        sha256(staged_bytes),
        staged_bytes.len() as u64,
    );
    assert!(staged.patch.contains(&sha256(staged_bytes)));
    assert!(!staged.patch.contains("staged materialized bytes"));

    let unstaged = f.git.diff(&f.repo, "unstaged", "asset.bin", None).unwrap();
    let unstaged_lfs = unstaged.lfs.expect("unstaged LFS diff metadata");
    assert_pointer(
        &unstaged_lfs,
        true,
        &Pointer {
            oid: sha256(staged_bytes),
            size: staged_bytes.len() as u64,
        },
        sha256(working_bytes),
        working_bytes.len() as u64,
    );
    assert!(!unstaged.binary);
    assert_eq!(
        tree_bytes(&f.repo),
        before,
        "Git inspection must not write files or index data"
    );

    fs::remove_file(f.repo.join("asset.bin")).unwrap();
    let before_delete_diff = tree_bytes(&f.repo);
    let deleted = f.git.diff(&f.repo, "unstaged", "asset.bin", None).unwrap();
    let deleted_lfs = deleted.lfs.unwrap();
    assert_eq!(deleted_lfs.before_state, LfsSideState::Pointer);
    assert_eq!(deleted_lfs.after_state, LfsSideState::Missing);
    assert!(deleted_lfs.before.is_some());
    assert!(deleted_lfs.after.is_none());
    assert_eq!(tree_bytes(&f.repo), before_delete_diff);

    let untracked = vec![0x5a; 2 * 1024 * 1024 + 7];
    f.write("untracked.bin", &untracked);
    let before_untracked_diff = tree_bytes(&f.repo);
    let untracked_diff = f
        .git
        .diff(&f.repo, "unstaged", "untracked.bin", None)
        .unwrap();
    let untracked_lfs = untracked_diff.lfs.unwrap();
    assert_eq!(untracked_lfs.before_state, LfsSideState::Missing);
    assert_eq!(untracked_lfs.after_state, LfsSideState::Pointer);
    assert_eq!(
        untracked_lfs.after.unwrap(),
        oil_git_lib::git::LfsPointer {
            oid: sha256(&untracked),
            size: untracked.len() as u64,
        }
    );
    assert!(!untracked_diff.binary);
    assert_eq!(tree_bytes(&f.repo), before_untracked_diff);
}

fn assert_pointer(
    lfs: &LfsDiff,
    before_pointer: bool,
    before: &Pointer,
    after_oid: String,
    after_size: u64,
) {
    assert_eq!(
        lfs.before_state,
        if before_pointer {
            LfsSideState::Pointer
        } else {
            LfsSideState::Missing
        }
    );
    assert_eq!(lfs.before.as_ref().unwrap().oid, before.oid);
    assert_eq!(lfs.before.as_ref().unwrap().size, before.size);
    assert_eq!(lfs.after_state, LfsSideState::Pointer);
    assert_eq!(lfs.after.as_ref().unwrap().oid, after_oid);
    assert_eq!(lfs.after.as_ref().unwrap().size, after_size);
}

#[cfg(unix)]
#[test]
fn custom_lfs_commands_and_extension_configuration_are_rejected_before_execution() {
    use std::os::unix::fs::PermissionsExt;

    let f = Fixture::new();
    f.write("tracked.bin", b"baseline");
    f.cmd(&["add", "--", "tracked.bin"]);
    f.cmd(&["commit", "-m", "tracked LFS file"]);

    let marker = f._temp.path().join("custom-filter-invoked");
    let malicious = f._temp.path().join("custom-lfs-filter.sh");
    fs::write(
        &malicious,
        format!("#!/bin/sh\nprintf ran >> '{}'\ncat\n", marker.display()),
    )
    .unwrap();
    let mut permissions = fs::metadata(&malicious).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&malicious, permissions).unwrap();
    f.cmd(&["config", "filter.lfs.process", malicious.to_str().unwrap()]);
    let before = tree_bytes(&f.repo);
    let error = f.git.snapshot(&f.repo).err().unwrap();
    assert_eq!(error.kind, "unsafeFilter");
    assert!(!marker.exists());
    assert_eq!(tree_bytes(&f.repo), before);

    let ext = Fixture::new();
    ext.write("tracked.bin", b"baseline");
    ext.cmd(&["add", "--", "tracked.bin"]);
    ext.cmd(&["commit", "-m", "tracked LFS file"]);
    ext.cmd(&["config", "lfs.extension.gzip.clean", "gzip"]);
    ext.cmd(&["config", "lfs.extension.gzip.smudge", "gunzip"]);
    let error = ext.git.snapshot(&ext.repo).err().unwrap();
    assert_eq!(error.kind, "unsupportedLfsExtension");
}

#[test]
fn staged_extension_pointer_is_rejected_without_downloading_or_mutating_the_repository() {
    let f = Fixture::new();
    let extension_pointer = format!(
        "version https://git-lfs.github.com/spec/v1\next-0-demo sha256:{}\noid sha256:{}\nsize 12\n",
        "a".repeat(64),
        "b".repeat(64)
    );
    let oid = String::from_utf8(f.raw_git(
        &["hash-object", "-w", "--stdin"],
        Some(extension_pointer.as_bytes()),
    ))
    .unwrap()
    .trim()
    .to_owned();
    f.raw_git(
        &[
            "update-index",
            "--add",
            "--cacheinfo",
            &format!("100644,{oid},extension.bin"),
        ],
        None,
    );
    f.write("extension.bin", extension_pointer.as_bytes());
    let before = tree_bytes(&f.repo);
    let error = f.git.snapshot(&f.repo).err().unwrap();
    assert_eq!(error.kind, "unsupportedLfsExtension");
    assert_eq!(tree_bytes(&f.repo), before);
    assert!(!f.repo.join(".git/lfs").exists());
}

#[test]
fn staged_rename_and_commit_diffs_use_each_revision_attributes() {
    let f = Fixture::new();
    let baseline = f.add_baseline("old.bin", b"baseline materialized bytes");
    f.cmd(&["mv", "--", "old.bin", "renamed.bin"]);
    let rename = f.git.diff(&f.repo, "staged", "renamed.bin", None).unwrap();
    let rename_lfs = rename.lfs.unwrap();
    assert_eq!(rename_lfs.before_state, LfsSideState::Pointer);
    assert_eq!(rename_lfs.after_state, LfsSideState::Pointer);
    assert_eq!(rename_lfs.before, rename_lfs.after);
    let rename_commit = f.commit("rename LFS file");
    let commit_rename = f
        .git
        .diff(&f.repo, "commit", "renamed.bin", Some(&rename_commit))
        .unwrap();
    assert_eq!(commit_rename.lfs.unwrap().before.unwrap().oid, baseline.oid);

    fs::remove_file(f.repo.join(".gitattributes")).unwrap();
    f.write(
        "renamed.bin",
        b"plain content after removing LFS attributes",
    );
    f.cmd(&["add", "-A"]);
    let plain_commit = f.commit("remove LFS attributes");
    let historical = f
        .git
        .diff(&f.repo, "commit", "renamed.bin", Some(&plain_commit))
        .unwrap();
    let historical_lfs = historical.lfs.expect("parent revision had LFS attributes");
    assert_eq!(historical_lfs.before_state, LfsSideState::Pointer);
    assert_eq!(historical_lfs.before.unwrap().oid, baseline.oid);
    assert_eq!(historical_lfs.after_state, LfsSideState::Regular);
    assert!(historical_lfs.after.is_none());
}

#[test]
fn unresolved_lfs_conflict_uses_index_stage_pointers_and_never_hashes_markers() {
    let f = Fixture::new();
    f.add_baseline("conflict.bin", b"base materialized content");
    let base_commit = f.cmd(&["rev-parse", "HEAD"]);
    let ours_content = b"current branch materialized content";
    let theirs_content = b"incoming branch materialized content";
    let switched = f.raw_git_without_filters(&["switch", "-c", "current"], None);
    assert!(
        switched.status.success(),
        "switch current failed: {}",
        String::from_utf8_lossy(&switched.stderr)
    );
    f.write("conflict.bin", ours_content);
    f.cmd(&["add", "--", "conflict.bin"]);
    f.commit("current branch LFS change");
    let pointer = f
        .git
        .run(&f.repo, &["show", "current:conflict.bin"], 4096, false)
        .unwrap()
        .bytes;
    let indexed = f
        .git
        .run(&f.repo, &["show", ":conflict.bin"], 4096, false)
        .unwrap()
        .bytes;
    assert_eq!(pointer, indexed);
    f.write("conflict.bin", pointer);
    f.cmd(&["add", "--", "conflict.bin"]);

    let switched = f.raw_git_without_filters(&["switch", "-c", "incoming", &base_commit], None);
    assert!(
        switched.status.success(),
        "switch incoming failed: {}",
        String::from_utf8_lossy(&switched.stderr)
    );
    f.write("conflict.bin", theirs_content);
    f.cmd(&["add", "--", "conflict.bin"]);
    f.commit("incoming branch LFS change");
    let pointer = f
        .git
        .run(&f.repo, &["show", "incoming:conflict.bin"], 4096, false)
        .unwrap()
        .bytes;
    f.write("conflict.bin", pointer);
    f.cmd(&["add", "--", "conflict.bin"]);

    let switched = f.raw_git_without_filters(&["switch", "current"], None);
    assert!(
        switched.status.success(),
        "switch back to current failed: {}",
        String::from_utf8_lossy(&switched.stderr)
    );
    let merged = f.raw_git_without_filters(&["merge", "--no-commit", "incoming"], None);
    assert!(!merged.status.success(), "binary LFS edits should conflict");
    let markers = b"<<<<<<< current\nmarker text must not become an LFS object\n=======\nincoming marker text\n>>>>>>> incoming\n";
    f.write("conflict.bin", markers);

    let before = tree_bytes(&f.repo);
    let snapshot = f.git.snapshot(&f.repo).unwrap();
    assert!(snapshot
        .files
        .iter()
        .any(|file| file.path == "conflict.bin" && file.conflict));
    let diff = f
        .git
        .diff(&f.repo, "conflict", "conflict.bin", None)
        .unwrap();
    let lfs = diff.lfs.expect("LFS conflict pointer metadata");
    assert_eq!(lfs.conflict, Some(true));
    assert_eq!(lfs.before_state, LfsSideState::Pointer);
    assert_eq!(lfs.after_state, LfsSideState::Pointer);
    assert_eq!(lfs.before.unwrap().oid, sha256(ours_content));
    assert_eq!(lfs.after.unwrap().oid, sha256(theirs_content));
    assert_ne!(sha256(markers), sha256(ours_content));
    assert_ne!(sha256(markers), sha256(theirs_content));
    assert!(diff.conflict.is_some());
    assert_eq!(tree_bytes(&f.repo), before);
    assert!(!f.repo.join(".git/lfs").exists());
}
