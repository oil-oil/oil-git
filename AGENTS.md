# Engineering constraints

## Product and repository access

- Oil Git is an independent, read-only desktop tool. Read real Git data from the repository selected by the user. Do not add Git write operations, a browser product, or simulated successful data.
- Viewing must not change observed files, the index, refs, configuration, or the LFS object store. Do not download content or invoke external repository converters. Use the bundled read-only filter for standard LFS. Tests use independent temporary repositories.
- Discover changes through Git rather than scanning all working-directory file contents. Bound diff memory and label truncated output.
- Child-process timeouts observe only the Child started by that request. Do not register a global SIGCHLD handler.
- Unloaded parents at pagination boundaries must not appear as root commits. Branch filtering does not switch branches. Remote status describes locally available records only.

- `site/` holds the static landing page for https://git.oiloil.org, deployed on Vercel from that directory. It is not part of the application bundle; the application must not load anything from it.
- `src-tauri/icons/src/` holds the icon mark and the composed 1024 px master. Keep `icon.png`, `icon.icns`, and `icon.ico` in step with the master.

## Requests and state

- Repository, worktree, filter, pagination, and detail requests have explicit ownership. Only responses for the latest selection may take effect. On failure, retain prior results and mark them as not updated.
- Read commit details and their default diff using the same effective history version, then present them together. When a failed cross-commit read retains prior content, identify both the requested and displayed commits. Switching files within a commit preserves the diff viewport and replaces content only when the complete result arrives; do not key the container by file path.
- Short reads show no skeleton. Delayed hints appear only in the owning region. Refreshing the same comparison retains its content. Diff caches bind to repository, path, staging scope, and change revision, with a capacity limit.
- Removing a recent project only changes application records; it must not alter repository files or close the current project. Late responses from old open requests cannot restore a removed record; an explicit reopen can. Startup requests take priority over automatic restoration, and active user selections take priority over unfinished restoration.
- The CLI supports opening, read-only JSON snapshots, and bundled Skill discovery. Open requests reuse the existing window.

## Interface and rendering

- Support Light, Dark, and Green themes, defaulting to neutral Dark. Maintain colors in `scripts/theme-palettes.json`; do not weaken text through reduced opacity. Use existing Material Icon Theme assets. Prioritize commit titles, branches, and file changes; reveal hashes, author details, and complete paths on demand.
- Support English and Simplified Chinese for user-facing text and accessible names. Preserve original Git messages, paths, ref names, and identities. Keep JSON fields, error kinds, and message keys independent of locale.
- Group the workspace into Staged changes, Changes, and Merge changes. Select the same file independently in each scope. Preserve actual line numbers in both comparison sides. Render only visible code and history.
- Keep the workspace sidebar persistent; switch Changes and History on the right. Preserve file selection, filters, and scroll positions when switching. Hidden views do not capture keyboard input or run continuous animations.
- Do not draw focus outlines; retain selected backgrounds for keyboard navigation. Commit details slide as a whole according to the vertical order of the displayed and newly selected nodes. Pending requests, same-commit file changes, and background refreshes do not trigger this motion. Stop animations in hidden views and under reduced-motion settings.
- Each commit-animation frame processes only visible elements and their edge endpoints.
- Code wraps by default. Measure virtual rows at their natural height; use the larger corresponding row height for split comparisons. Handle size changes and batched height notifications; do not treat an alignment minimum as natural height.
- Store preferred pane widths separately from viewport-constrained widths. Cancelled drags, blur, and lost pointer capture do not commit temporary widths. Coalesce continuous input through RAF.

## Verification

- Verify the CLI and native window separately. A CLI pass does not replace desktop-process reads.
- Record platform builds, real desktop operations, and visual checks separately. A configured Windows workflow does not establish Windows acceptance.
- CI installation checks run the program and launcher from the actual package. A build-directory binary does not prove resource packaging. Reports record platform, architecture, and installer digest. Never count unrun or skipped remote jobs as passing.
- Do not invoke browser automation unless the user explicitly requests it.
