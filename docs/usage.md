# Using Oil Git

[Home](../README.md) · [简体中文](zh-CN/usage.md)

## Install and open a repository

On macOS, open the DMG and drag Oil Git to Applications. On Windows, run the setup executable. Check the release tag and notes for the package’s feature scope. Your computer needs Git, but running the packaged application does not require Node, Rust, or Python. The application detects Git in PATH and common installation locations. The Windows installer can download Microsoft's WebView2 runtime if it is missing.

Use the project button or `⌘ O` / `Ctrl O` to select a repository. Selecting a subdirectory opens its enclosing repository. Recent projects are stored locally, and the last project is restored on restart. Removing a recent item only removes the application's record. It does not delete files or close the current project.

macOS may request access to Desktop or other protected folders. Respond to the system prompt and retry if the initial read times out.

## Explore changes and history

- The persistent sidebar separates **Staged changes**, **Changes**, and **Merge changes** when present. A file can appear in both staged and unstaged scopes; each selection compares the appropriate bytes.
- Filter changed files by any part of their path, without case sensitivity. Matching folders expand automatically; group counts show matches/total. Filtering preserves the selected file and its diff. Clear the field or press Esc to restore the complete list and its previous collapsed folders.
- **Changes** and **History** share the right-hand workspace. Switching views preserves file selection, history filters, and scroll positions. Selecting a changed file opens Changes.
- The commit graph shows actual parents, branches, tags, and HEAD. Filtering a branch changes the view without checking it out. **Go to HEAD** locates the current commit.
- Select a commit to read its changed files. Ordinary and merge commits compare against their first parent; an initial commit shows added content.
- Commit metadata comes from local Git. Expand it to see email and committer information. Click a text-diff line number to inspect who last changed that line on the selected side. Copy controls beside commit titles, IDs, and file paths make relevant context easy to share with an AI agent. No GitHub login is needed.
- Worktree selection changes the observed directory. Stashes are read from the repository's actual stash list.

## Compare files

Text wraps by default, with original line numbers and aligned rows in side-by-side view. Text diffs are capped at 240 KB and show when output is truncated. UTF-16 BOM text is decoded for comparison; encoding-only changes remain visible. Line attribution is unavailable when decoded line numbers cannot reliably map to Git's original text.

Images support side-by-side, swipe, overlay, and pixel-difference modes. In side-by-side mode, selecting 100% size stacks the two versions vertically. Added or deleted images show a single preview. Audio and video use the system WebView decoder and do not autoplay. Media reads are limited to 8 MiB per side; images with known dimensions are limited to 16 million pixels. Pixel comparison samples at most 2048 × 2048 pixels and labels this limit. Decode support depends on the system WebView. Oversized or undecodable media and other binary files show metadata and a byte comparison of the first 4 KiB.

Text conflicts show the actual conflict sections and line numbers. LFS conflicts show object IDs and sizes. Removing textual conflict markers does not mean Git considers the conflict resolved.

## Preferences and navigation

Use the toolbar menus to choose English or Simplified Chinese and Light, Dark, or Green themes. Language follows the system on first launch; explicit choices are saved locally. Switching language does not translate repository content. File icons are bundled [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme) assets.

Drag pane dividers, or use arrow keys on a selected divider, to adjust widths. Preferences survive temporary constraints in narrow windows; cancelling a drag does not save its temporary size. Use arrow keys to select commits, Enter to inspect, Esc to close details or cancel a drag, and `⌘ R` / `Ctrl R` to refresh.

## CLI and AI agents

On macOS, use the bundled `bin/oil-git` launcher directly or put it in your PATH. Set `OIL_GIT_APP` to the full `.app` path when it is installed elsewhere. On Windows, use the installed `oil-git.exe` or `bin/oil-git.ps1`. The launcher accepts the same arguments. Paths containing spaces need quotes.

```sh
oil-git open "/path/to/repository" --view changes
oil-git open "/path/to/repository" --view history
oil-git inspect "/path/to/repository" --json
oil-git inspect "/path/to/repository" --json --lang en
oil-git skill
oil-git skill --path
```

`open` sends a request to the desktop application, reusing its existing window. `inspect` reads a real snapshot without opening a window; it does not return full code diffs. Success returns `status=ready` with `data`; failure returns `status=error`, a stable `kind` and `messageKey`, a localized `message`, an original `diagnostic`, and a nonzero exit code. `--lang en` or `--lang zh-CN` selects CLI and Skill text without changing repository data or the interface language preference.

On each invocation without `--lang`, the CLI reads the first nonempty environment variable in this order: `LC_ALL`, `LC_MESSAGES`, `LANG`. A value beginning with `zh` selects Simplified Chinese; other values or no locale select English. The CLI does not save a language preference.

To invoke the optional Windows launcher without changing system execution policy:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\path\to\bin\oil-git.ps1" inspect "C:\path\to\repository" --json
```

The launcher and Skill are packaged under `Contents/Resources` on macOS and the installation directory on Windows. You can give the complete `skills/oil-git` directory to your agent host for installation according to its rules. Installing Oil Git does not change another application's Skill settings.

## Read-only scope

Oil Git does not commit, checkout, fetch, merge, or undo changes. Ahead/behind counts describe locally available remote-tracking records. Bare and partial-clone repositories are unsupported, including partial clones whose objects have already been downloaded.

Standard Git LFS uses a bundled read-only filter: it does not run the repository's LFS program, download content, or write to the LFS object store. Pointers and expanded content are compared in their actual staged or unstaged scope. Custom LFS conversions and extensions are unsupported.

Other active external `clean` or `process` filters are rejected with `unsafeFilter`; unused filter configuration does not prevent reading. Reads do not invoke pagers, external diff/text converters, or signature-verification helpers. Repository-routing environment variables cannot override the directory selected by the user.
