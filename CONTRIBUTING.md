# Contributing to Oil Git

[简体中文](docs/zh-CN/contributing.md)

Oil Git is a read-only desktop viewer for real Git repositories. Contributions should help people understand branches, commits, and changes without altering the repository they are viewing.

## Issues and proposals

For bugs, include your operating system and architecture, application version or commit, reproduction steps, and expected behavior. A small temporary repository is especially helpful for Git edge cases. Remove private paths, email addresses, and source code from logs or screenshots before sharing them.

For larger changes, describe the user need in an issue first. Keep pull requests focused and explain the resulting behavior and the checks you actually ran.

## Development

Follow the setup and checks in [Development](docs/development.md). [AGENTS.md](AGENTS.md) contains the repository's engineering constraints, including read-only access, request ownership, and rendering behavior. Use independent temporary repositories for tests.

Keep generated icons, theme CSS, build outputs, and local verification reports out of commits. Edit theme colors in `scripts/theme-palettes.json`; use the existing Material Icon Theme assets for file icons.

## Language and documentation

The application supports English and Simplified Chinese. Update both entries in `src/i18n.tsx` when adding user-facing text, including tooltips, accessible names, and errors. Git paths, commit messages, branch names, and author names are repository data and must retain their original text.

Update English and Chinese documentation together when behavior changes. The English README is the default entry point; `README.zh-CN.md` and `docs/zh-CN/` provide Chinese counterparts. Prefer durable usage and contribution guidance over dated test logs. Store local evidence outside the public documentation.

## Verification

Link the commit, actual results, and unchecked areas in the PR. Use independent temporary repositories and compare files, the index, refs, configuration, and LFS object storage before and after reads. Do not construct test changes in a personal repository.

- **Source**: run the relevant commands in [Development](docs/development.md#checks).
- **Installed package**: run the packaged program and launcher; check resources, CLI behavior, exit codes, and repository immutability. Exercise the same universal DMG on ARM64 and Intel, and the installed NSIS program on Windows. Record the platform, architecture, and installer SHA-256.
- **Native window**: interface changes require real interaction on the target platform. Check project opening and restoration, refresh and error ownership, file scopes, history navigation, wrapping and resizing, image comparison and line attribution, language, themes, copy feedback, and reduced motion. CLI checks do not replace these checks.

[Desktop CI](https://github.com/oil-oil/oil-git/actions/workflows/build.yml) covers source and installed CLI checks on all three platforms; it does not cover WebView rendering or native interaction. Configured or skipped jobs and local cross-compilation are not platform passes. Keep acceptance reports, screenshots, and machine-specific logs outside the repository; public docs describe durable behavior and methods.

## License

By contributing, you agree that your contributions are available under the project's [MIT license](LICENSE). Preserve applicable third-party notices when adding or updating dependencies or assets.
