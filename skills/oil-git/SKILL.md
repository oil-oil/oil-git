---
name: oil-git
description: Open a user's local Git project in Oil Git and inspect real branches, commits, changes, and conflicts. Use when the user asks to inspect a project with Oil Git or to locate the repository they are working on in the desktop view. Read-only display only; do not use for Git write operations, website browsing, or cloud repository management.
license: MIT
metadata:
  version: "0.1.0"
---

# Oil Git

This Skill requires the local Oil Git desktop app, system Git, and permission to run local commands.

Determine which local project the user means from the current workspace or a path they gave you. Ask only if there are multiple plausible projects and context does not resolve the choice.

## Find the app

Check whether `oil-git` is already available. If it is, use that command without reinstalling.

On macOS, the app includes this launcher:

    "/Applications/Oil Git.app/Contents/Resources/bin/oil-git"

If the app is installed elsewhere, use that app's corresponding path. On Windows, use `oil-git.exe` in the app's installation directory. The optional PowerShell launcher is `bin/oil-git.ps1`; it accepts the same arguments. Do not change a user or machine execution policy to run it.

Run `oil-git --version` to confirm the command works. If the app is missing or cannot start, explain what is missing and stop. Installing the app or changing the agent host's Skill configuration requires the user's authorization.

## Read or open a project

1.  Use `inspect` to read a real repository snapshot. Pass the path as its own argument and quote paths that contain spaces:

        oil-git inspect "/path/to/project" --json

    Success returns `status=ready` and `data`. Failure returns `status=error`, a stable `kind` and `messageKey`, a localized `message`, the original `diagnostic`, and a nonzero exit code. Handle a failure as reported; do not invent branch or commit data. Initializing an uninitialized project belongs to the normal development workflow.

2.  Open the view that fits the user's task. Use `changes` to inspect edits or conflicts and `history` to inspect commits and branch relationships:

        oil-git open "/path/to/project" --view changes
        oil-git open "/path/to/project" --view history

    The command sends an open request to the desktop app and reuses its existing window. A successful request does not prove that the view finished loading or that it was visually checked.

3.  Explain the snapshot using its real data. `data.branch` is the current branch, `data.head` is the current commit, and `data.files` reports staged and unstaged changes separately. A file may appear in both scopes. `inspect` does not return full source diffs.

4.  When code details are needed, use the host's existing read-only Git access or inspect the corresponding file in the app. Unstaged changes compare the working tree with the index; staged changes compare the index with `HEAD`.

5.  State what was actually read and which view was requested. Without a successful read, do not claim that the worktree is clean, a conflict is resolved, or a commit exists.

The CLI reads the locale environment on each invocation and defaults to English when unset; it does not use the saved interface language. Pass `--lang en` or `--lang zh-CN` before or after the command to choose CLI messages explicitly, for example:

    oil-git --lang en inspect "/path/to/project" --json
    oil-git inspect "/path/to/project" --json --lang en

The `kind`, `messageKey`, snapshot data, and original diagnostic remain stable across languages.

## Boundaries

- Repository data stays on the local computer. No account or cloud sync is needed.
- Ahead and behind counts use existing local remote-tracking records; they do not mean that a fetch occurred.
- Branch filters and worktree selection change only the observed view. They do not run `checkout`.
- Standard Git LFS pointers use the app's built-in read-only filter. It does not run repository LFS programs, download content, or write to the LFS object store. Unsupported custom filters and LFS extensions are reported as read errors.
- Removing text conflict markers does not mark a conflict resolved in Git. Use Git's actual conflict state.
- This Skill does not authorize staging, committing, merging, resetting, or pushing. Handle those only through the user's separately authorized development workflow.

Run `oil-git --help` for CLI usage. `oil-git skill` prints this document; `oil-git skill --path` prints the installed file path.
