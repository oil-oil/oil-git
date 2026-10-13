import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Icon } from "./Icon";
import { CopyButton } from "./CopyButton";
import type { DiffOrigin } from "./types";
import { DiffView } from "./DiffView";
import type { FileState, Diff, GitError } from "./types";
import type { WorkingFile } from "./useWorkingCopy";
import { FileIcon } from "./FileIcon";
import { ReadStatus } from "./ReadStatus";
import { Collapse } from "./Collapse";
import { useI18n } from "./i18n";
import { ErrorMessage } from "./ErrorMessage";
import "./changes-tree.css";

type ChangeTreeDirectory = {
  name: string;
  path: string;
  entries: ChangeTreeEntry[];
  directories: Map<string, ChangeTreeDirectory>;
};
type ChangeTreeEntry =
  | { kind: "file"; file: FileState }
  | { kind: "directory"; directory: ChangeTreeDirectory };
type ChangeGroup = {
  title: string;
  mode: "conflict" | "staged" | "unstaged";
  files: FileState[];
  tree: ChangeTreeEntry[];
};

function buildChangeTree(files: FileState[]): ChangeTreeEntry[] {
  const root: ChangeTreeDirectory = {
    name: "",
    path: "",
    entries: [],
    directories: new Map(),
  };
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let current = root;
    for (const name of parts.slice(0, -1)) {
      let directory = current.directories.get(name);
      if (!directory) {
        directory = {
          name,
          path: current.path ? `${current.path}/${name}` : name,
          entries: [],
          directories: new Map(),
        };
        current.directories.set(name, directory);
        current.entries.push({ kind: "directory", directory });
      }
      current = directory;
    }
    current.entries.push({ kind: "file", file });
  }
  return root.entries;
}

function buildChangeGroups(files: FileState[]): ChangeGroup[] {
  const groups = [
    {
      title: "合并的更改",
      mode: "conflict" as const,
      files: files.filter((file) => file.conflict),
    },
    {
      title: "暂存的更改",
      mode: "staged" as const,
      files: files.filter((file) => file.staged),
    },
    {
      title: "更改",
      mode: "unstaged" as const,
      files: files.filter(
        (file) => !file.conflict && (file.unstaged || file.untracked),
      ),
    },
  ];
  return groups.map((group) => ({
    ...group,
    tree: buildChangeTree(group.files),
  }));
}

function sameFiles(previous: FileState[], next: FileState[]) {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;
  return previous.every((file, index) => {
    const other = next[index];
    return (
      file.path === other.path &&
      file.oldPath === other.oldPath &&
      file.xy === other.xy &&
      file.conflict === other.conflict &&
      file.untracked === other.untracked &&
      file.staged === other.staged &&
      file.unstaged === other.unstaged
    );
  });
}

export function ChangesSidebar({
  files,
  file,
  onFile,
}: {
  files: FileState[];
  file: WorkingFile | null;
  onFile: (value: WorkingFile) => void;
}) {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const { t } = useI18n();
  const treeCache = useRef<{
    files: FileState[];
    groups: ChangeGroup[];
  } | null>(null);
  const groups = useMemo(() => {
    const cached = treeCache.current;
    if (cached && sameFiles(cached.files, files)) {
      cached.files = files;
      return cached.groups;
    }
    const next = buildChangeGroups(files);
    treeCache.current = { files, groups: next };
    return next;
  }, [files]);
  const needle = query.toLowerCase();
  const filtering = needle.length > 0;
  const visibleGroups = useMemo(
    () =>
      groups.map((group) => {
        const visible = filtering
          ? group.files.filter((entry) =>
              entry.path.toLowerCase().includes(needle),
            )
          : group.files;
        return {
          ...group,
          total: group.files.length,
          files: visible,
          tree: filtering ? buildChangeTree(visible) : group.tree,
        };
      }),
    [groups, filtering, needle],
  );
  const selectionHidden =
    filtering &&
    !!file &&
    !visibleGroups.some(
      (group) =>
        group.mode === file.mode &&
        group.files.some((entry) => entry.path === file.path),
    );
  const clearFilter = () => {
    setQuery("");
    input.current?.focus();
  };
  const Heading = filtering ? "div" : "button";
  return (
    <div className="changes-tree" aria-label={t("源代码管理文件列表")}>
      {(files.length > 0 || filtering) && (
        <div className="changes-filter">
          <Icon name="filter" size={13} />
          <input
            ref={input}
            type="search"
            value={query}
            spellCheck={false}
            placeholder={t("按路径筛选文件")}
            aria-label={t("按路径筛选文件")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              clearFilter();
            }}
          />
          {filtering && (
            <button
              type="button"
              className="icon-button"
              aria-label={t("清除筛选")}
              title={t("清除筛选")}
              onClick={clearFilter}
            >
              <Icon name="close" size={13} />
            </button>
          )}
        </div>
      )}
      {selectionHidden && (
        <p className="changes-filter-note">{t("已选中的文件不在筛选结果中")}</p>
      )}
      {!files.length && (
        <div className="source-clean">
          <Icon name="check" size={24} />
          <p>{t("没有待提交的更改")}</p>
        </div>
      )}
      {files.length > 0 &&
        visibleGroups.every((group) => !group.files.length) && (
          <div className="source-clean" role="status">
            <Icon name="filter" size={24} />
            <p>{t("没有匹配的文件")}</p>
          </div>
        )}
      {visibleGroups
        .filter((g) => g.files.length)
        .map((g) => (
          <section className="change-group" key={g.mode}>
            <Heading
              className="change-group-heading"
              aria-expanded={
                filtering ? undefined : !collapsed.includes(g.mode)
              }
              onClick={
                filtering
                  ? undefined
                  : () =>
                      setCollapsed((old) =>
                        old.includes(g.mode)
                          ? old.filter((v) => v !== g.mode)
                          : [...old, g.mode],
                      )
              }
            >
              <Icon name="right" size={12} />
              <strong>{t(g.title)}</strong>
              <span title={filtering ? t("匹配 / 总数") : undefined}>
                {filtering ? `${g.files.length}/${g.total}` : g.files.length}
              </span>
            </Heading>
            <Collapse expanded={filtering || !collapsed.includes(g.mode)}>
              {renderChangeEntries(
                g.tree,
                g.mode,
                file,
                onFile,
                collapsed,
                setCollapsed,
                t,
                needle,
              )}
            </Collapse>
          </section>
        ))}
    </div>
  );
}

function highlightMatch(text: string, needle: string): ReactNode {
  if (!needle) return text;
  const pattern = new RegExp(
    needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "gi",
  );
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    parts.push(<mark key={match.index}>{match[0]}</mark>);
    cursor = match.index + match[0].length;
  }
  if (!parts.length) return text;
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function renderChangeEntries(
  entries: ChangeTreeEntry[],
  mode: "conflict" | "staged" | "unstaged",
  selected: WorkingFile | null,
  onFile: (value: WorkingFile) => void,
  collapsed: string[],
  setCollapsed: (update: (old: string[]) => string[]) => void,
  t: (key: string) => string,
  needle = "",
  depth = 0,
): ReactNode {
  const filtering = needle.length > 0;
  const Heading = filtering ? "div" : "button";
  return entries.map((entry) => {
    if (entry.kind === "file") {
      const f = entry.file;
      const name = f.path.split("/").pop();
      const status = f.conflict
        ? "U"
        : f.untracked
          ? "U"
          : f.xy[mode === "staged" ? 0 : 1];
      return (
        <button
          key={f.path}
          className={
            "source-file " +
            (selected?.path === f.path && selected.mode === mode
              ? "selected"
              : "")
          }
          style={{ "--change-tree-indent": `${depth * 12}px` } as CSSProperties}
          aria-label={
            f.path +
            " · " +
            (mode === "staged"
              ? t("已暂存")
              : mode === "conflict"
                ? t("冲突")
                : f.untracked
                  ? t("未跟踪")
                  : t("未暂存"))
          }
          title={f.path + (f.oldPath ? " ← " + f.oldPath : "")}
          onClick={() => onFile({ path: f.path, mode })}
        >
          <FileIcon path={f.path} />
          <span className="source-file-name">
            {highlightMatch(name ?? "", needle)}
          </span>
          <span
            className={
              "source-status " +
              (f.conflict
                ? "conflict"
                : f.untracked || status === "A"
                  ? "added"
                  : "")
            }
          >
            {status.trim() || "M"}
          </span>
        </button>
      );
    }

    let terminal = entry.directory;
    const labelParts = [terminal.name];
    while (
      terminal.entries.length === 1 &&
      terminal.entries[0].kind === "directory"
    ) {
      terminal = terminal.entries[0].directory;
      labelParts.push(terminal.name);
    }

    const folderPath = terminal.path;
    const folderKey = `folder:${mode}:${entry.directory.path}`;
    const isCollapsed = !filtering && collapsed.includes(folderKey);
    return (
      <div className="change-directory" key={entry.directory.path}>
        <Heading
          className="change-directory-heading"
          style={{ "--change-tree-indent": `${depth * 12}px` } as CSSProperties}
          aria-label={folderPath}
          aria-expanded={filtering ? undefined : !isCollapsed}
          title={folderPath}
          onClick={
            filtering
              ? undefined
              : () =>
                  setCollapsed((old) =>
                    old.includes(folderKey)
                      ? old.filter((value) => value !== folderKey)
                      : [...old, folderKey],
                  )
          }
        >
          <Icon name="right" size={12} />
          <span>{highlightMatch(labelParts.join("/"), needle)}</span>
        </Heading>
        <Collapse expanded={!isCollapsed}>
          {renderChangeEntries(
            terminal.entries,
            mode,
            selected,
            onFile,
            collapsed,
            setCollapsed,
            t,
            needle,
            depth + 1,
          )}
        </Collapse>
      </div>
    );
  });
}

export function SourceEditor({
  files,
  file,
  diff,
  error,
  retry,
  loading = false,
  requestKey,
  origin,
  active = true,
}: {
  files: FileState[];
  file: WorkingFile | null;
  diff: Diff | null;
  error: GitError | null;
  retry: () => void;
  loading?: boolean;
  requestKey?: string;
  origin?: DiffOrigin;
  active?: boolean;
}) {
  const { t } = useI18n();
  const [preferSplit, setPreferSplit] = useState(true),
    [wide, setWide] = useState(false);
  const editor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = editor.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth > 0) setWide(el.clientWidth >= 660);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const selected = files.find((f) => f.path === file?.path);
  const labels: [string, string] =
    file?.mode === "staged"
      ? [t("上次提交"), t("暂存区")]
      : selected?.untracked
        ? [t("尚不存在"), t("工作区")]
        : [t("暂存区"), t("工作区")];
  const captions = {
    unstaged: selected?.untracked ? t("未跟踪的新文件") : t("暂存区 → 工作区"),
    staged: t("上次提交 → 暂存区"),
    conflict: t("尚未解决的冲突"),
    commit: t("提交差异"),
  };
  return (
    <div className="changes-editor" ref={editor}>
      {file ? (
        <>
          <header className="editor-heading">
            <div>
              <div className="file-heading-line">
                <strong title={file.path}>{file.path.split("/").pop()}</strong>
                <CopyButton text={file.path} label={t("复制文件路径")} />
              </div>
              <span>{captions[file.mode]}</span>
            </div>
            {!selected?.conflict &&
              !diff?.lfs &&
              !diff?.preview &&
              !diff?.binary && (
                <div className="diff-tabs" aria-label={t("差异展示方式")}>
                  <button
                    aria-pressed={wide && preferSplit}
                    disabled={!wide}
                    title={!wide ? t("加宽窗口后可以左右对照") : undefined}
                    onClick={() => setPreferSplit(true)}
                  >
                    {t("左右对照")}
                  </button>
                  <button
                    aria-pressed={!wide || !preferSplit}
                    onClick={() => setPreferSplit(false)}
                  >
                    {t("统一差异")}
                  </button>
                </div>
              )}
          </header>
          {error && (
            <div className="history-error" role="status">
              <ErrorMessage error={error} />
              {diff && t(" 当前保留上次读取的差异。")}
              <button onClick={retry}>{t("重试")}</button>
            </div>
          )}
          <div className="working-diff" key={file.path + file.mode}>
            <ReadStatus
              busy={loading && !error}
              requestKey={requestKey ?? file.path + file.mode}
              label={diff ? t("正在更新差异…") : t("正在读取差异…")}
            />
            {diff ? (
              <DiffView
                data={diff}
                layout={wide && preferSplit ? "split" : "unified"}
                labels={labels}
                origin={origin}
                active={active}
              />
            ) : null}
          </div>
        </>
      ) : (
        <div className="editor-empty">
          <Icon name="changes" size={25} />
          <p>{files.length ? t("选择文件，查看修改") : t("工作区干净")}</p>
        </div>
      )}
    </div>
  );
}
