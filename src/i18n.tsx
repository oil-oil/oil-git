import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Language = "en" | "zh-CN";
type Values = Record<string, string | number>;
type Translation = string | { one: string; other: string };

// Chinese phrases are the source keys; each visible string has one English
// translation here so component state and presentation stay independent.
const en: Record<string, Translation> = {
  打开项目: "Open Project",
  "打开 Git 项目": "Open Git project",
  打开其他项目: "Open Another Project",
  "打开本地项目，查看分支、提交和文件变化。":
    "Open a local project to inspect branches, commits, and file changes.",
  源代码管理: "Source Control",
  源代码管理文件列表: "Source control files",
  当前工作区: "Current workspace",
  仓库内容: "Repository content",
  仓库视图: "Repository views",
  仓库历史: "Repository history",
  发生变化的文件数量: "Changed file count",
  "{count} 个文件": { one: "{count} file", other: "{count} files" },
  源码: "Changes",
  分支: "History",
  切换主题: "Change theme",
  深色: "Dark",
  浅色: "Light",
  绿色: "Green",
  切换语言: "Change language",
  英文: "English",
  简体中文: "简体中文",
  所有分支与标签: "All branches and tags",
  "当前 HEAD 的历史": "Current HEAD history",
  本地分支: "Local branches",
  远程分支: "Remote branches",
  标签: "Tags",
  最近打开: "Recent projects",
  观察工作树: "View worktree",
  工作树: "Worktree",
  "分离 HEAD": "Detached HEAD",
  "返回 HEAD": "Go to HEAD",
  刷新仓库: "Refresh repository",
  "刷新 · ⌘ / Ctrl R": "Refresh · ⌘ / Ctrl R",
  重试: "Retry",
  "当前保留上次读取的结果。": "Showing the previous result.",
  "当前保留上次加载的历史。": "Showing the previously loaded history.",
  "未更新，保留上次读取结果。": "Not updated; showing the previous result.",
  "正在检测 Git…": "Checking for Git…",
  查看安装方式: "How to install Git",
  重新检测: "Check again",
  "打开 →": "Open →",
  从最近打开移除: "Remove from recent projects",
  "从最近打开移除 {name}": "Remove {name} from recent projects",
  筛选提交历史: "Filter commit history",
  调整侧栏宽度: "Resize sidebar",
  调整详情宽度: "Resize details panel",
  "提交历史，使用上下方向键选择，回车查看详情":
    "Commit history. Use the up and down arrow keys to select a commit, then press Enter to view details.",
  加载更多提交: "Load more commits",
  "已加载 {count} 个提交": {
    one: "Loaded {count} commit",
    other: "Loaded {count} commits",
  },
  "当前筛选没有提交。": "No commits match this filter.",
  "还没有提交。": "No commits yet.",
  "在编辑器或终端中提交后，这里会自动更新。":
    "This view updates after you create a commit in your editor or terminal.",
  临时保存: "Stashes",
  进行中: "In progress",
  "暂停 · {count} 个冲突文件": {
    one: "Paused · {count} conflicted file",
    other: "Paused · {count} conflicted files",
  },
  没有待提交的更改: "No pending changes",
  合并的更改: "Merge changes",
  暂存的更改: "Staged changes",
  更改: "Changes",
  已暂存: "Staged",
  冲突: "Conflict",
  未跟踪: "Untracked",
  未暂存: "Unstaged",
  上次提交: "Last commit",
  暂存区: "Staging area",
  尚不存在: "Does not exist yet",
  工作区: "Working tree",
  未跟踪的新文件: "Untracked new file",
  "暂存区 → 工作区": "Staging area → Working tree",
  "上次提交 → 暂存区": "Last commit → Staging area",
  尚未解决的冲突: "Unresolved conflict",
  提交差异: "Commit diff",
  差异展示方式: "Diff layout",
  加宽窗口后可以左右对照: "Widen the window to compare side by side",
  左右对照: "Side by side",
  统一差异: "Unified diff",
  " 当前保留上次读取的差异。": " Showing the previously read diff.",
  "正在更新差异…": "Updating diff…",
  "正在读取差异…": "Reading diff…",
  "选择文件，查看修改": "Select a file to inspect its changes",
  工作区干净: "Working tree clean",
  提交信息: "Commit information",
  复制提交信息: "Copy commit information",
  "提交：{value}": "Commit: {value}",
  "作者：{value}": "Author: {value}",
  "提交者：{value}": "Committer: {value}",
  "时间：{value}": "Date: {value}",
  "父提交：{value}": "Parent commits: {value}",
  "比较：{value}": "Comparison: {value}",
  "变更文件：": "Changed files:",
  作者: "Author",
  提交者: "Committer",
  时间: "Date",
  "提交 ID": "Commit ID",
  "复制完整提交 ID": "Copy full commit ID",
  父提交: "Parent commits",
  "复制父提交 ID": "Copy parent commit ID",
  无: "None",
  首次提交: "Initial commit",
  "首次提交，全部为新增内容": "Initial commit; all files are added",
  相对第一个父提交: "Compared with the first parent",
  已复制: "Copied",
  "复制失败，点击重试": "Copy failed. Click to retry.",
  搜索名称或路径: "Search names or paths",
  搜索: "Search",
  没有匹配的结果: "No matching results",
  所选对象详情: "Selected item details",
  无法读取提交: "Could not read commit",
  复制提交标题: "Copy commit subject",
  "复制提交标题与 ID": "Copy commit subject and ID",
  "关闭详情 · Esc": "Close details · Esc",
  关闭详情: "Close details",
  "正在读取提交…": "Reading commit…",
  "正在读取：{subject}": "Reading: {subject}",
  "读取 {old} 失败，当前显示 {new} 的内容。":
    "Could not read {old}; showing content from {new}.",
  "相对比较基准没有文件变化。":
    "No files changed relative to the comparison base.",
  "原路径：{path}": "Old path: {path}",
  新增: "Added",
  删除: "Deleted",
  修改: "Modified",
  重命名: "Renamed",
  类型变化: "Type changed",
  变更文件列表: "Changed files",
  复制文件路径: "Copy file path",
  无提交说明: "No commit message",
  统一代码差异: "Unified code diff",
  调整左右差异宽度: "Resize diff panes",
  "这部分内容为空。": "This side is empty.",
  "Git LFS 对象变化": "Git LFS object changes",
  "Git 保存的是文件指针。此处显示对象信息，不下载文件内容。":
    "Git stores a pointer to this file. Object details are shown here; file contents are not downloaded.",
  大小: "Size",
  "SHA-256": "SHA-256",
  字节: "bytes",
  文件不存在: "File does not exist",
  此侧是普通文件内容: "This side contains a regular file",
  "此侧不是受支持的 LFS 指针": "This side is not a supported LFS pointer",
  "无 LFS 对象": "No LFS object",
  原始指针冲突: "Raw pointer conflict",
  原始指针差异: "Raw pointer diff",
  变更前: "Before",
  变更后: "After",
  当前分支: "Current branch",
  合入分支: "Incoming branch",
  共同起点: "Common base",
  当前分支的内容: "Current branch content",
  合入的内容: "Incoming content",
  "Git 原始差异": "Raw Git diff",
  "二进制文件发生变化，无法显示文本差异。":
    "A binary file changed; text diff is unavailable.",
  "差异较大，仅展示前 240 KB。": "Diff is large; showing the first 240 KB.",
  "冲突 {index}": "Conflict {index}",
  "第 {start}–{end} 行": "Lines {start}–{end}",
  未解决冲突: "Unresolved conflict",
  代码行归属: "Line attribution",
  关闭行归属: "Close line attribution",
  "正在读取最后修改者…": "Reading last change…",
  复制代码行归属: "Copy line attribution",
  正在同步仓库: "Syncing repository",
  "无法解码此格式，可在下方查看字节差异。":
    "This format could not be decoded. Byte differences are available below.",
  "此格式显示文件信息和字节差异。":
    "This format shows file information and byte differences.",
  "正在计算像素差异…": "Calculating pixel difference…",
  "缩小采样 · ": "Downsampled · ",
  "{percent}% 像素变化 · 黑色表示相同，亮色表示变化":
    "{percent}% pixels changed · black is unchanged; bright pixels changed",
  "无法计算此格式的像素差异，请使用并排或滑动对比。":
    "Pixel differences are unavailable for this format. Use side-by-side or wipe comparison.",
  像素差异图: "Pixel difference image",
  图片差异: "Image differences",
  图片对比方式: "Image comparison mode",
  上下: "Top and bottom",
  并排: "Side by side",
  滑动: "Wipe",
  叠加: "Overlay",
  像素差异: "Pixel difference",
  图片缩放: "Image zoom",
  适应: "Fit",
  图片已删除: "Image deleted",
  新增图片: "New image",
  "无法解码此格式，请使用字节差异。":
    "This format could not be decoded. Use the byte diff.",
  对比分界: "Comparison divider",
  不透明度: "opacity",
  "{label}的不透明度": "{label} opacity",
  图片对比分界: "Image comparison divider",
  叠加不透明度: "Overlay opacity",
  字节差异: "Byte differences",
  仅显示变化: "Show changes only",
  "每侧仅比较前 4 KiB，偏移以十六进制显示。":
    "Only the first 4 KiB on each side is compared. Offsets are hexadecimal.",
  "前 4 KiB 没有字节变化，后续内容未比较。":
    "No byte changes in the first 4 KiB; the remaining content was not compared.",
  "内容字节相同，变化可能来自路径或文件模式。":
    "File bytes are identical; the path or file mode may have changed.",
  偏移: "Offset",
  大小不变: "Size unchanged",
  源码差异: "Source diff",
  来源差异: "Source diff",
  读取超时: "The read timed out. Try again.",
  "读取失败。请重试。": "The read failed. Try again.",
  "没有找到可用的 Git，请重新检测。":
    "Git was not found. Check again after installing Git.",
  "请先安装 Git 并重新检测。": "Install Git, then check again.",
  "项目已关闭，请重新打开。": "The project is closed. Open it again.",
  "最近项目路径无效。": "The recent project path is invalid.",
  "请在 Oil Git 桌面应用中打开。本地仓库读取需要桌面环境。":
    "Open this in the Oil Git desktop app. Reading local repositories requires the desktop environment.",
  "这个项目目录不存在或无法访问。":
    "This project directory does not exist or cannot be accessed.",
  "第一版暂不支持裸仓库，请选择带工作目录的 Git 项目。":
    "Bare repositories are not supported. Choose a Git project with a working tree.",
  "这个文件夹尚未初始化 Git。请在编辑器或终端中初始化后重新打开。":
    "This folder is not a Git repository yet. Initialize it in an editor or terminal, then open it again.",
  "Git 正在变化，稍后自动重新读取。":
    "Git is changing. The repository will be read again shortly.",
  "提交历史已变化，正在重新加载。":
    "Commit history changed and is being reloaded.",
  "这个分支或标签已被移除。": "This branch or tag has been removed.",
  "提交 ID 无效。": "The commit ID is invalid.",
  "该提交中没有这个变更文件。": "This changed file is not part of the commit.",
  "提交内容读取失败。": "Could not read commit contents.",
  "当前比较范围没有差异。": "No changes in this comparison.",
  "该文件已没有待提交修改。": "This file no longer has pending changes.",
  "这个对象不是普通文件，无法展示文本差异。":
    "This item is not a regular file, so a text diff is unavailable.",
  "文件超过 8 MiB 预览上限，显示文件信息和前 4 KiB 字节。":
    "The file exceeds the 8 MiB preview limit. Showing file details and the first 4 KiB.",
  "图片超过 1600 万像素预览上限，显示文件信息和字节。":
    "The image exceeds the 16-megapixel preview limit. Showing file details and bytes.",
  双方修改: "Both modified",
  双方新增: "Both added",
  "当前分支修改，合入方删除":
    "Modified on current branch, deleted on incoming branch",
  "当前分支删除，合入方修改":
    "Deleted on current branch, modified on incoming branch",
  当前分支新增: "Added on current branch",
  合入方新增: "Added on incoming branch",
  双方删除: "Both deleted",
  "当前文件已删除，Git 仍记录着未解决冲突。":
    "The file was deleted, but Git still records an unresolved conflict.",
  "非普通文件冲突，无法按文本行展示。":
    "This is a non-regular-file conflict and cannot be shown as text lines.",
  "二进制文件冲突，无法按文本行展示。":
    "This is a binary-file conflict and cannot be shown as text lines.",
  "文件中没有完整冲突标记；Git 暂存区仍有未解决记录。":
    "The file has no complete conflict markers, but Git still records an unresolved conflict.",
  "文件较大，只展示前 240 KB 内的完整冲突段。":
    "The file is large. Only complete conflict blocks in the first 240 KB are shown.",
  "暂不支持含 Git LFS 扩展字段的指针文件。":
    "Git LFS pointer extensions are not supported.",
  "当前 Git 无法读取历史属性，以下是 Git 原始差异，未确认 LFS 状态。":
    "Git could not read historical attributes. The raw Git diff is shown; LFS status could not be confirmed.",
  "裸仓库暂不支持。请打开带工作目录的 Git 项目。":
    "Bare repositories are not supported. Open a Git project with a working tree.",
  "此文件不能按 Git 文本行查询作者。":
    "Line attribution is unavailable for this file.",
  "文件在读取期间发生变化，请重试。":
    "The file changed while it was being read. Try again.",
  "应用配置读取失败。": "Could not read application configuration.",
  "冲突解决前无法确定行归属。":
    "Line attribution is unavailable while this file has unresolved conflicts.",
  "无法找到请求的项目或对象。":
    "The requested project or object could not be found.",
  "无法打开相关链接。": "Could not open the requested link.",
  "只读模式暂不支持部分克隆仓库，避免按需下载 Git 对象。":
    "Partial clones are not supported in read-only mode because Git may download missing objects on demand.",
  "项目路径无效。": "The project path is invalid.",
  "无法安全定位 Git LFS helper。":
    "Could not safely locate the Git LFS helper.",
  "Git 子进程发生错误。请重试。": "The Git process failed. Try again.",
  "无法读取最近项目记录。": "Could not read recent project records.",
  "符号链接内容不按普通文本文件读取。":
    "Symbolic link contents are not read as regular text files.",
  "Git 文件过滤器不受支持，无法安全读取。":
    "This Git content filter is unsupported and cannot be read safely.",
  "无法监听仓库变化。": "Could not watch for repository changes.",
  "Git 读取请求无效。": "The Git read request is invalid.",
  "文件系统读取失败。": "The file system read failed.",
  "命令参数无效。运行 oil-git --help 查看用法。":
    "Invalid command arguments. Run `oil-git --help` for usage.",
  "Git 读取失败。": "Git could not read the requested data.",
  "无法启动 Git。请检查 Git 安装并重试。":
    "Could not start Git. Check the Git installation and try again.",
  "Git 无法读取历史 LFS 属性。原始 Git 差异仍可查看。":
    "Git could not read historical LFS attributes. The raw diff is still available.",
  "读取结果过大，无法完整显示。":
    "The read result is too large to display completely.",
  "项目包含无法安全读取的路径。":
    "The project contains a path that cannot be read safely.",
  尚未提交的内容: "Uncommitted content",
  此行尚未提交: "This line is uncommitted",
  "搜索{label}": "Search {label}",
  "文本内容相同，编码或字节表示发生变化。":
    "Text is identical; encoding or byte representation changed.",
  "文本内容相同，变化来自路径或文件模式。":
    "Text is identical; the path or file mode changed.",
  变基: "Rebase",
  合并: "Merge",
  挑选提交: "Cherry-pick",
  撤销提交: "Revert",
  "正在读取提交历史…": "Reading commit history…",
  原始内容: "Original content",
  修改后的内容: "Modified content",
  "查看第 {line} 行最后修改者": "View the last change to line {line}",
  "{side}第 {line} 行归属": "{side} line {line} attribution",
  "第 {line} 行": "Line {line}",
  按文本比较: "compared as text",
  像素变化结果:
    "{downsampled}{percent}% pixels changed · black is unchanged; bright pixels changed",
  尚未提交: "Not committed",
  "标题：{value}": "Subject: {value}",
  查看原始诊断: "View original diagnostic",
  "原提交行号：{line}": "Original commit line: {line}",
};

export function detectLanguage(locale?: string | null): Language {
  return locale?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function loadLanguage(): Language {
  try {
    const saved = localStorage.getItem("oil-git.language");
    if (saved === "en" || saved === "zh-CN") return saved;
  } catch {}
  return detectLanguage(
    typeof navigator === "undefined" ? "en" : navigator.language,
  );
}

export function translate(
  language: Language,
  key: string,
  values?: Values,
): string {
  const entry =
    language === "en" && Object.prototype.hasOwnProperty.call(en, key)
      ? en[key]
      : key;
  const result =
    typeof entry === "string"
      ? entry
      : values?.count === 1
        ? entry.one
        : entry.other;
  if (!values) return result;
  return result.replace(/\{([^{}]+)\}/g, (token, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name)
      ? String(values[name])
      : token,
  );
}

const errorMessages: Record<string, string> = {
  desktopRequired: "请在 Oil Git 桌面应用中打开。本地仓库读取需要桌面环境。",
  arguments: "命令参数无效。运行 oil-git --help 查看用法。",
  bare: "裸仓库暂不支持。请打开带工作目录的 Git 项目。",
  binary: "此文件不能按 Git 文本行查询作者。",
  changed: "文件在读取期间发生变化，请重试。",
  changing: "Git 正在变化，稍后自动重新读取。",
  config: "应用配置读取失败。",
  conflict: "冲突解决前无法确定行归属。",
  git: "Git 读取失败。",
  gitMissing: "没有找到可用的 Git，请重新检测。",
  gitUnavailable: "无法启动 Git。请检查 Git 安装并重试。",
  invalid: "Git 读取请求无效。",
  io: "文件系统读取失败。",
  lfsAttributeSourceUnsupported:
    "Git 无法读取历史 LFS 属性。原始 Git 差异仍可查看。",
  lfsHelper: "无法安全定位 Git LFS helper。",
  missing: "无法找到请求的项目或对象。",
  missingReference: "这个分支或标签已被移除。",
  notRepository:
    "这个文件夹尚未初始化 Git。请在编辑器或终端中初始化后重新打开。",
  open: "无法打开相关链接。",
  partialCloneUnsupported:
    "只读模式暂不支持部分克隆仓库，避免按需下载 Git 对象。",
  path: "项目路径无效。",
  process: "Git 子进程发生错误。请重试。",
  read: "读取失败。请重试。",
  recent: "无法读取最近项目记录。",
  session: "项目已关闭，请重新打开。",
  staleHistory: "提交历史已变化，正在重新加载。",
  symlink: "符号链接内容不按普通文本文件读取。",
  timeout: "读取超时",
  tooLarge: "读取结果过大，无法完整显示。",
  unsafeFilter: "Git 文件过滤器不受支持，无法安全读取。",
  unsafePath: "项目包含无法安全读取的路径。",
  unsupportedLfsExtension: "暂不支持含 Git LFS 扩展字段的指针文件。",
  watch: "无法监听仓库变化。",
};

type LocalizedError = {
  kind?: string;
  messageKey?: string;
  message?: string;
};

export function localizedErrorSummary(
  language: Language,
  error?: LocalizedError | null,
): string {
  if (!error) return "";
  const key = error.messageKey ?? error.kind ?? "";
  const source = Object.prototype.hasOwnProperty.call(errorMessages, key)
    ? errorMessages[key]
    : "读取失败。请重试。";
  return translate(language, source);
}

export function originalErrorDiagnostic(
  error?: LocalizedError | null,
): string | null {
  if (!error?.message) return null;
  const key = error.messageKey ?? error.kind ?? "";
  return errorMessages[key] === error.message ? null : error.message;
}

const defaultContext = {
  language: "zh-CN" as Language,
  setLanguage: (_language: Language) => {},
  t: (key: string, values?: Values) => translate("zh-CN", key, values),
  error: (
    error?: { kind?: string; messageKey?: string; message?: string } | null,
  ) => error?.message ?? "",
  errorDiagnostic: (
    _error?: { kind?: string; messageKey?: string; message?: string } | null,
  ) => null as string | null,
};
const LanguageContext = createContext(defaultContext);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(loadLanguage);
  const setLanguage = (value: Language) => {
    try {
      localStorage.setItem("oil-git.language", value);
    } catch {}
    setLanguageState(value);
  };
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t: (key: string, values?: Values) => translate(language, key, values),
      error: (error?: LocalizedError | null) =>
        localizedErrorSummary(language, error),
      errorDiagnostic: (error?: LocalizedError | null) =>
        originalErrorDiagnostic(error),
    }),
    [language],
  );
  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useI18n() {
  return useContext(LanguageContext);
}
