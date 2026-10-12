// Verify the actual installed package on native runners. Git writes only create fixtures.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "artifact-dir": { type: "string" },
    report: { type: "string" },
  },
});
if (!values["artifact-dir"] || !values.report) {
  throw new Error("Specify --artifact-dir and --report.");
}
const reportFile = path.resolve(values.report);
const report = {
  platform: process.platform,
  architecture: process.arch,
  status: "running",
  checks: [],
  limitations: [
    "Native windows, WebView rendering, file notifications, and visual interaction were not checked.",
  ],
};
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
// PowerShell emits CRLF for lines; compare Skill text without changing other bytes.
const normalizeLineEndings = (text) => text.replaceAll("\r\n", "\n");
function filesUnder(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}
function fixtureContents(root) {
  return Object.fromEntries(
    filesUnder(root)
      .sort()
      .map((file) => [
        path.relative(root, file),
        createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
      ]),
  );
}
function check(name, action) {
  action();
  report.checks.push(name);
}

let temporary;
let mounted = false;
let mountPoint;
try {
  assert.ok(["darwin", "win32"].includes(process.platform));
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "oil-git-installed-"));
  const candidates = filesUnder(path.resolve(values["artifact-dir"])).filter(
    (file) =>
      process.platform === "darwin"
        ? file.endsWith(".dmg")
        : file.endsWith("setup.exe"),
  );
  assert.equal(
    candidates.length,
    1,
    "Provide exactly one installer for the current platform",
  );
  report.installer = path.basename(candidates[0]);
  report.installerSha256 = createHash("sha256")
    .update(fs.readFileSync(candidates[0]))
    .digest("hex");
  let executable;
  let resources;
  if (process.platform === "darwin") {
    mountPoint = path.join(temporary, "mount");
    fs.mkdirSync(mountPoint);
    run("hdiutil", [
      "attach",
      candidates[0],
      "-readonly",
      "-nobrowse",
      "-mountpoint",
      mountPoint,
    ]);
    mounted = true;
    const app = path.join(temporary, "安装 with space", "Oil Git.app");
    run("ditto", [path.join(mountPoint, "Oil Git.app"), app]);
    run("hdiutil", ["detach", mountPoint]);
    mounted = false;
    executable = path.join(app, "Contents", "MacOS", "oil-git");
    resources = path.join(app, "Contents", "Resources");
    check("Universal application contains arm64 and x86_64", () => {
      const architectures = run("lipo", ["-archs", executable]).split(/\s+/);
      assert.ok(architectures.includes("arm64"));
      assert.ok(architectures.includes("x86_64"));
    });
  } else {
    assert.equal(
      process.env.GITHUB_ACTIONS,
      "true",
      "Windows installation checks require a disposable GitHub runner to avoid changing local installation records and shortcuts.",
    );
    resources = path.join(temporary, "安装 with space");
    // NSIS requires /D last, without quotes; it consumes the remaining full path.
    run(candidates[0], ["/S", `/D=${resources}`], {
      timeout: 300_000,
      windowsVerbatimArguments: true,
    });
    executable = path.join(resources, "oil-git.exe");
  }
  check("Installed executable exists", () =>
    assert.ok(fs.existsSync(executable)),
  );
  const cli = (args) => run(executable, args);
  const launcher =
    process.platform === "darwin"
      ? (args) =>
          run("/bin/sh", [path.join(resources, "bin", "oil-git"), ...args])
      : (args) =>
          run("powershell.exe", [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            path.join(resources, "bin", "oil-git.ps1"),
            ...args,
          ]);
  check("Version and help entry points", () => {
    report.version = cli(["--version"]);
    assert.match(report.version, /^oil-git \d+\.\d+\.\d+/);
    assert.match(cli(["--help"]), /inspect/);
    assert.equal(launcher(["--version"]), report.version);
  });
  check("English and Chinese CLI and bundled Skills", () => {
    for (const [locale, file, helpPattern] of [
      ["en", "SKILL.md", /^Oil Git read-only Git viewer\n\nUsage:/],
      ["zh-CN", "SKILL.zh-CN.md", /^Oil Git 只读 Git 查看工具\n\n用法：/],
    ]) {
      assert.match(
        normalizeLineEndings(cli(["--help", "--lang", locale])),
        helpPattern,
      );
      assert.match(
        normalizeLineEndings(launcher(["--lang", locale, "--help"])),
        helpPattern,
      );
      const skillPath = cli(["skill", "--path", "--lang", locale]);
      assert.equal(
        fs.realpathSync(skillPath),
        fs.realpathSync(path.join(resources, "skills", "oil-git", file)),
      );
      const content = normalizeLineEndings(
        fs.readFileSync(skillPath, "utf8"),
      ).trim();
      assert.equal(
        normalizeLineEndings(cli(["skill", "--lang", locale])),
        content,
      );
      assert.equal(
        normalizeLineEndings(launcher(["--lang", locale, "skill"])),
        content,
      );
    }
    assert.ok(fs.existsSync(path.join(resources, "LICENSE")));
    assert.ok(fs.existsSync(path.join(resources, "THIRD-PARTY-NOTICES.md")));
    assert.ok(
      fs.existsSync(
        path.join(resources, "docs", "zh-CN", "third-party-notices.md"),
      ),
    );
  });

  const repo = path.join(temporary, "项目 with space");
  fs.mkdirSync(repo);
  // Fixture writes disable maintenance; the audit includes all files and locks.
  const git = (args) =>
    run("git", [
      "-c",
      "maintenance.auto=false",
      "-c",
      "gc.auto=0",
      "-C",
      repo,
      ...args,
    ]);
  git(["init", "-b", "main"]);
  git(["config", "user.name", "CI fixture"]);
  git(["config", "user.email", "fixture@example.invalid"]);
  git(["config", "core.autocrlf", "false"]);
  const subdir = path.join(repo, "源码");
  fs.mkdirSync(subdir);
  const source = path.join(subdir, "应用.ts");
  fs.writeFileSync(source, "export const value = 1;\n");
  git(["add", "."]);
  git(["commit", "-m", "首次提交"]);
  git(["branch", "feature/中文"]);
  git(["tag", "v0.1-fixture"]);
  fs.writeFileSync(source, "export const value = 2;\n");
  git(["add", "."]);
  fs.writeFileSync(source, "export const value = 3;\n");
  fs.writeFileSync(path.join(repo, "新文件.md"), "临时文件\n");
  const before = fixtureContents(repo);
  const inspect = (command, target) =>
    JSON.parse(command(["inspect", target, "--json"]));
  const verifySnapshot = (response) => {
    assert.equal(response.status, "ready");
    const snapshot = response.data;
    // Windows TEMP may use an 8.3 alias while Rust returns the long path.
    // Compare actual directory identity, not two spellings of the same path.
    const expectedRoot = fs.statSync(repo, { bigint: true });
    const actualRoot = fs.statSync(snapshot.path, { bigint: true });
    assert.ok(actualRoot.isDirectory());
    assert.notEqual(
      expectedRoot.ino,
      0n,
      "Filesystem did not provide a verifiable directory identity",
    );
    assert.equal(actualRoot.dev, expectedRoot.dev);
    assert.equal(actualRoot.ino, expectedRoot.ino);
    assert.equal(snapshot.branch, "main");
    assert.equal(snapshot.files.length, 2);
    const tracked = snapshot.files.find((file) => file.path === "源码/应用.ts");
    assert.ok(tracked?.staged && tracked?.unstaged);
    assert.ok(
      snapshot.files.find((file) => file.path === "新文件.md")?.untracked,
    );
    assert.ok(snapshot.refs.some((ref) => ref.name === "feature/中文"));
    assert.ok(snapshot.refs.some((ref) => ref.name === "v0.1-fixture"));
    assert.ok(snapshot.historyRevision && snapshot.changesRevision);
  };
  check(
    "Unicode and space-containing paths with staged and unstaged changes",
    () => verifySnapshot(inspect(cli, repo)),
  );
  check("Resolve the repository from a subdirectory", () =>
    verifySnapshot(inspect(cli, subdir)),
  );
  check("Bundled launcher supports JSON snapshots in both languages", () => {
    verifySnapshot(inspect(launcher, repo));
    for (const locale of ["en", "zh-CN"]) {
      verifySnapshot(
        JSON.parse(launcher(["--lang", locale, "inspect", repo, "--json"])),
      );
    }
  });
  check(
    "Localized JSON errors preserve diagnostics and nonzero exit codes",
    () => {
      for (const [commandName, command] of [
        ["binary", cli],
        ["launcher", launcher],
      ]) {
        for (const target of [temporary, path.join(temporary, "不存在")]) {
          let previous;
          for (const locale of ["en", "zh-CN"]) {
            assert.throws(
              () => command(["inspect", target, "--json", "--lang", locale]),
              (error) => {
                assert.equal(error.status, 2);
                const response = JSON.parse(error.stdout);
                assert.equal(response.status, "error");
                assert.ok(
                  response.kind &&
                    response.messageKey &&
                    response.message &&
                    response.diagnostic,
                );
                if (locale === "en")
                  assert.doesNotMatch(response.message, /[\p{Script=Han}]/u);
                if (previous) {
                  assert.equal(response.kind, previous.kind);
                  assert.equal(response.messageKey, previous.messageKey);
                  assert.equal(response.diagnostic, previous.diagnostic);
                  assert.notEqual(response.message, previous.message);
                }
                previous = response;
                return true;
              },
              `${commandName} should reject directory: ${target} (${locale})`,
            );
          }
        }
      }
    },
  );
  check("Malformed inspect locale arguments still return JSON errors", () => {
    for (const command of [cli, launcher]) {
      for (const args of [
        ["inspect", repo, "--json", "--lang", "fr"],
        ["inspect", repo, "--json", "--lang"],
        ["--lang", "fr", "inspect", repo, "--json"],
      ]) {
        assert.throws(
          () => command(args),
          (error) => {
            assert.equal(error.status, 2);
            const response = JSON.parse(error.stdout);
            assert.equal(response.status, "error");
            assert.equal(response.kind, "arguments");
            assert.equal(response.messageKey, "arguments");
            assert.ok(response.message && response.diagnostic);
            return true;
          },
        );
      }
    }
  });
  check(
    "Files, index, refs, and configuration remain byte-for-byte unchanged",
    () => assert.deepEqual(fixtureContents(repo), before),
  );

  const lfsRepo = path.join(temporary, "LFS 项目 with space");
  fs.mkdirSync(lfsRepo);
  const lfsGit = (args) =>
    run("git", [
      "-c",
      "maintenance.auto=false",
      "-c",
      "gc.auto=0",
      "-c",
      "filter.lfs.process=",
      "-c",
      "filter.lfs.clean=",
      "-c",
      "filter.lfs.required=false",
      "-C",
      lfsRepo,
      ...args,
    ]);
  // Stage standard pointers directly; fixture creation does not require git-lfs.
  const stagePointers = () => lfsGit(["add", "."]);
  const pointer = (content) =>
    "version https://git-lfs.github.com/spec/v1\n" +
    `oid sha256:${createHash("sha256").update(content).digest("hex")}\n` +
    `size ${content.length}\n`;
  lfsGit(["init", "-b", "main"]);
  lfsGit(["config", "user.name", "CI fixture"]);
  lfsGit(["config", "user.email", "fixture@example.invalid"]);
  lfsGit(["config", "core.autocrlf", "false"]);
  lfsGit(["config", "filter.lfs.clean", "git-lfs clean -- %f"]);
  lfsGit(["config", "filter.lfs.smudge", "git-lfs smudge -- %f"]);
  lfsGit(["config", "filter.lfs.process", "git-lfs filter-process"]);
  lfsGit(["config", "filter.lfs.required", "true"]);
  fs.writeFileSync(
    path.join(lfsRepo, ".gitattributes"),
    "*.bin filter=lfs diff=lfs merge=lfs -text\n",
  );
  const lfsFile = path.join(lfsRepo, "中文 文件.bin");
  const original = Buffer.from("original\0LFS content\n");
  fs.writeFileSync(lfsFile, pointer(original));
  stagePointers();
  lfsGit(["commit", "-m", "LFS 首次提交"]);
  const inspectLfs = () => {
    const response = inspect(cli, lfsRepo);
    assert.equal(response.status, "ready");
    return response.data;
  };
  check(
    "LFS pointers without downloaded objects remain clean and read-only",
    () => {
      const unchanged = fixtureContents(lfsRepo);
      assert.equal(inspectLfs().files.length, 0);
      assert.deepEqual(fixtureContents(lfsRepo), unchanged);
    },
  );
  fs.writeFileSync(lfsFile, original);
  // Record expanded-file stat in the fixture; otherwise Git reports a changed pointer.
  // Use the bundled filter without git-lfs or writes to the LFS object store.
  const filterExecutable =
    process.platform === "win32"
      ? executable.replaceAll("\\", "/")
      : executable;
  const bundledFilter = `'${filterExecutable.replaceAll("'", "'\\''")}' __oil_lfs_filter_process`;
  lfsGit([
    "-c",
    `filter.lfs.process=${bundledFilter}`,
    "-c",
    "filter.lfs.required=true",
    "add",
    "--",
    "中文 文件.bin",
  ]);
  check("Expanded LFS content remains clean without writing objects", () => {
    const unchanged = fixtureContents(lfsRepo);
    assert.equal(inspectLfs().files.length, 0);
    assert.deepEqual(fixtureContents(lfsRepo), unchanged);
    assert.ok(!fs.existsSync(path.join(lfsRepo, ".git", "lfs")));
  });
  fs.writeFileSync(lfsFile, pointer(Buffer.from("staged\0content\n")));
  stagePointers();
  fs.writeFileSync(lfsFile, Buffer.from("working\0content\n"));
  check("LFS staged and unstaged changes remain separate and read-only", () => {
    const unchanged = fixtureContents(lfsRepo);
    const files = inspectLfs().files;
    assert.equal(files.length, 1);
    assert.ok(files[0].staged && files[0].unstaged);
    assert.deepEqual(fixtureContents(lfsRepo), unchanged);
    assert.ok(!fs.existsSync(path.join(lfsRepo, ".git", "lfs")));
  });
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  if (mounted) {
    try {
      run("hdiutil", ["detach", mountPoint]);
    } catch (error) {
      report.cleanupError = String(error);
      process.exitCode = 1;
    }
  }
  if (temporary) {
    try {
      fs.rmSync(temporary, { recursive: true, force: true });
    } catch (error) {
      report.cleanupError = String(error);
      process.exitCode = 1;
    }
  }
  if (report.cleanupError) report.status = "failed";
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### ${report.platform} / ${report.architecture}: ${report.status}\n\n` +
        report.checks.map((name) => `- ✅ ${name}\n`).join("") +
        `\n${report.limitations.join("\n")}\n`,
    );
  }
}
