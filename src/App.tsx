import { useCallback, useEffect, useRef, useState } from "react";
import { useRepository } from "./useRepository";
import { useWorkingCopy } from "./useWorkingCopy";
import { ChangesSidebar, SourceEditor } from "./WorkingChanges";
import { request } from "./api";
import { HistoryGraph } from "./HistoryGraph";
import { Details, type DetailState } from "./Details";
import { usePaneLayout } from "./usePaneLayout";
import { Icon } from "./Icon";
import { Dropdown, type MenuOption } from "./Dropdown";
import type { Selection } from "./types";
import { useTheme, type Theme } from "./theme";
import { ReadStatus } from "./ReadStatus";
import { SyncIndicator } from "./SyncIndicator";
import { useI18n } from "./i18n";
import { ErrorMessage } from "./ErrorMessage";
export default function App() {
  const repo = useRepository();
  const { theme, setTheme } = useTheme();
  const { language, setLanguage, t } = useI18n();
  const [view, setView] = useState<"source" | "history">("history");
  const working = useWorkingCopy(repo.project, view === "source");
  const [selection, setSelection] = useState<Selection>(null);
  const selectionOwner = useRef<string | null>(null);
  const [panel, setPanel] = useState<{
    selection: Selection;
    repoId: string;
  } | null>(null);
  const [locate, setLocate] = useState(0);
  const shell = useRef<HTMLDivElement>(null);
  const panes = usePaneLayout(shell);
  const [detailState, setDetailState] = useState<
    DetailState & { owner: string }
  >({ owner: "", ready: false, loading: false, error: null });
  const wasDetailOpen = useRef(false);
  const locatePending = useRef<{
      repoId: string;
      requestId: number;
      head: string;
    } | null>(null),
    locateFrame = useRef(0);
  const s = repo.project?.snapshot;
  const readError = repo.error;
  const syncing = repo.syncing;
  const graphSnapshot = repo.history.snapshot ?? s;
  const viewRef = useRef(view),
    repoIdRef = useRef(repo.project?.repoId),
    repoPathRef = useRef(s?.path),
    viewRequestSerialRef = useRef(repo.viewRequest?.serial ?? null),
    locateFrameToken = useRef(0);
  viewRef.current = view;
  repoIdRef.current = repo.project?.repoId;
  repoPathRef.current = s?.path;
  viewRequestSerialRef.current = repo.viewRequest?.serial ?? null;
  const clearLocate = () => {
    locatePending.current = null;
    locateFrameToken.current++;
    cancelAnimationFrame(locateFrame.current);
    locateFrame.current = 0;
  };
  const switchView = (next: "source" | "history") => {
    if (next !== "history") clearLocate();
    setView(next);
  };
  const effectiveSelection =
    selectionOwner.current === repo.project?.repoId ? selection : null;
  const shownPanel = panel?.repoId === repo.project?.repoId ? panel : null;
  const detailOwner = repo.project?.repoId + JSON.stringify(effectiveSelection);
  const detailOpen =
    !!effectiveSelection &&
    (effectiveSelection.kind === "stashes" ||
      (detailState.owner === detailOwner && detailState.ready));
  const reportDetail = useCallback(
    (state: DetailState) => {
      setDetailState((old) =>
        old.owner === detailOwner &&
        old.ready === state.ready &&
        old.loading === state.loading &&
        old.error === state.error
          ? old
          : { ...state, owner: detailOwner },
      );
    },
    [detailOwner],
  );
  const selectedSubject =
    effectiveSelection?.kind === "commit"
      ? repo.history.commits.find(
          (commit) => commit.hash === effectiveSelection.hash,
        )?.subject
      : undefined;
  const pick = (value: Selection) => {
    selectionOwner.current = repo.project?.repoId ?? null;
    setSelection(value);
  };
  useEffect(() => {
    setSelection(null);
    clearLocate();
  }, [repo.project?.repoId]);
  useEffect(() => {
    if (repo.viewRequest?.repoId === repo.project?.repoId && repo.viewRequest) {
      setSelection(null);
      switchView(repo.viewRequest.view === "changes" ? "source" : "history");
    }
  }, [repo.viewRequest]);
  useEffect(() => {
    if (effectiveSelection && repo.project)
      setPanel({ selection: effectiveSelection, repoId: repo.project.repoId });
  }, [effectiveSelection, repo.project?.repoId]);
  useEffect(() => {
    if (!effectiveSelection) wasDetailOpen.current = false;
    else if (detailOpen) wasDetailOpen.current = true;
  }, [detailOpen, effectiveSelection]);
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        clearLocate();
        void repo.choose();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r") {
        e.preventDefault();
        void repo.refresh(true);
      }
      if (e.key === "Escape") {
        setSelection(null);
        clearLocate();
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [repo.choose, repo.refresh]);
  useEffect(
    () => () => {
      locateFrameToken.current++;
      cancelAnimationFrame(locateFrame.current);
    },
    [],
  );
  useEffect(() => {
    const pending = locatePending.current;
    if (!pending) return;
    const cancel = () => {
      locatePending.current = null;
    };
    if (
      pending.repoId !== repo.project?.repoId ||
      repo.history.requestId !== pending.requestId ||
      view !== "history"
    ) {
      cancel();
      return;
    }
    if (repo.history.loading) return;
    if (
      repo.history.error ||
      repo.history.requestedReference !== "HEAD" ||
      repo.history.reference !== "HEAD" ||
      repo.history.snapshot?.head !== pending.head
    ) {
      cancel();
      return;
    }
    cancel();
    if (repo.history.commits.some((c) => c.hash === pending.head))
      setLocate((n) => n + 1);
  }, [repo.history, repo.project?.repoId, view]);
  useEffect(() => {
    if (view !== "history") {
      clearLocate();
    }
  }, [view]);
  const selectHistoryFilter = (ref: string) => {
    clearLocate();
    repo.filter(ref);
  };
  const locateHead = () => {
    switchView("history");
    setSelection(null);
    clearLocate();
    if (
      graphSnapshot?.historyRevision === s?.historyRevision &&
      graphSnapshot?.head === s?.head &&
      repo.history.commits.some((c) => c.hash === s?.head)
    ) {
      const repoId = repo.project?.repoId;
      const repoPath = s?.path;
      const viewRequestSerial = repo.viewRequest?.serial ?? null;
      const token = ++locateFrameToken.current;
      locateFrame.current = requestAnimationFrame(() => {
        if (token !== locateFrameToken.current) return;
        locateFrame.current = 0;
        if (
          repoId &&
          repoIdRef.current === repoId &&
          repoPathRef.current === repoPath &&
          viewRequestSerialRef.current === viewRequestSerial &&
          viewRef.current === "history"
        )
          setLocate((n) => n + 1);
      });
      return;
    }
    if (repo.project && s?.head) {
      const requestId = repo.filter("HEAD");
      locatePending.current = {
        repoId: repo.project.repoId,
        requestId,
        head: s.head,
      };
    }
  };
  const conflicts = s?.files.filter((f) => f.conflict).length ?? 0;
  const themes = [
    { value: "dark", label: t("深色") },
    { value: "light", label: t("浅色") },
    { value: "green", label: t("绿色") },
  ];
  const languages = [
    { value: "en", label: t("英文") },
    { value: "zh-CN", label: t("简体中文") },
  ];
  const filters: MenuOption[] = [
    { value: "all", label: t("所有分支与标签") },
    { value: "HEAD", label: t("当前 HEAD 的历史") },
    ...(s?.refs ?? []).map((r) => ({
      value: r.fullName,
      label: r.name,
      group:
        r.kind === "branch"
          ? t("本地分支")
          : r.kind === "remote"
            ? t("远程分支")
            : t("标签"),
    })),
  ];
  const recentOptions: MenuOption[] = [
    { value: "__choose", label: t("打开其他项目"), description: "⌘ / Ctrl O" },
    ...repo.recents.map((r) => ({
      value: r.path,
      label: r.name,
      description: r.path,
      group: t("最近打开"),
      removable: true,
    })),
  ];
  const mac = navigator.userAgent.includes("Macintosh");
  return (
    <div
      ref={shell}
      className={
        "app " +
        (mac ? "mac " : "") +
        (detailOpen && view === "history" ? "has-details " : "") +
        (panes.dragging ? "resizing" : "")
      }
    >
      <header className="toolbar" data-tauri-drag-region>
        <Dropdown
          className="project-dropdown"
          value={s?.path ?? ""}
          options={recentOptions}
          onChange={(v) => {
            clearLocate();
            v === "__choose" ? void repo.choose() : void repo.openPath(v);
          }}
          onRemoveOption={repo.forgetRecent}
          message={
            repo.recentError ? (
              <ErrorMessage error={repo.recentError} />
            ) : undefined
          }
          busy={repo.forgettingRecent}
          label={s?.name || t("打开项目")}
          icon="folder"
          disabled={!repo.gitStatus.version}
        />
        {s && (
          <>
            <span className="toolbar-divider" />
            <span className="current-branch" title={s.branch || t("分离 HEAD")}>
              <Icon name="branch" size={16} />
              {s.branch || t("分离 HEAD")}
            </span>
            <span className="toolbar-spacer" data-tauri-drag-region />
            {s.worktrees.length > 1 && (
              <Dropdown
                className="tree-dropdown"
                value={s.path}
                options={s.worktrees.map((w) => ({
                  value: w.path,
                  label: w.detached ? t("分离 HEAD") : w.branch || t("工作树"),
                  description: w.path,
                  disabled: !w.available || w.bare,
                }))}
                onChange={(v) => void repo.openPath(v)}
                label={t("观察工作树")}
                icon="stack"
              />
            )}
            <button
              className="icon-button"
              onClick={locateHead}
              disabled={!s.head}
              aria-label={t("返回 HEAD")}
              title={t("返回 HEAD")}
            >
              <Icon name="target" />
            </button>
            <button
              className="icon-button"
              onClick={() => void repo.refresh(true)}
              title={t("刷新 · ⌘ / Ctrl R")}
              aria-label={t("刷新仓库")}
            >
              <Icon name="refresh" />
            </button>
          </>
        )}
        {!s && <span className="toolbar-spacer" data-tauri-drag-region />}
        <Dropdown
          className="theme-dropdown"
          value={theme}
          options={themes}
          onChange={(v) => setTheme(v as Theme)}
          label={t("切换主题")}
          icon="palette"
        />
        <Dropdown
          className="language-dropdown"
          value={language}
          options={languages}
          onChange={(value) => setLanguage(value as "en" | "zh-CN")}
          label={t("切换语言")}
          icon="language"
        />
        <SyncIndicator busy={syncing} requestKey={repo.project?.repoId ?? ""} />
      </header>
      {readError && (
        <div className="error-banner" role="status">
          <div>
            <ErrorMessage error={readError} />
            {s && " " + t("当前保留上次读取的结果。")}
          </div>
          <button onClick={repo.retryError}>{t("重试")}</button>
        </div>
      )}
      {!repo.project ? (
        <main className="welcome">
          <img
            className="welcome-mark"
            src="/app-icon.png"
            width={88}
            height={88}
            alt=""
          />
          <h1>Oil Git</h1>
          <p>
            {(repo.gitStatus.error && (
              <ErrorMessage error={repo.gitStatus.error} />
            )) ||
              t("打开本地项目，查看分支、提交和文件变化。")}
          </p>
          {repo.gitStatus.loading ? (
            <span className="subtle">{t("正在检测 Git…")}</span>
          ) : repo.gitStatus.error ? (
            <div className="welcome-actions">
              {repo.gitStatus.error.kind === "gitMissing" && (
                <button
                  className="primary"
                  onClick={() => void request("open_git_install")}
                >
                  {t("查看安装方式")}
                </button>
              )}
              <button onClick={() => void repo.checkGit()}>
                {t("重新检测")}
              </button>
            </div>
          ) : (
            <>
              <button
                className="primary"
                onClick={() => void repo.choose()}
                disabled={repo.opening}
              >
                <Icon name="folder" />
                {t("打开 Git 项目")}
              </button>
              {repo.recents.length > 0 && (
                <div className="welcome-recents">
                  {repo.recentError && (
                    <div className="welcome-recent-error" role="status">
                      <ErrorMessage error={repo.recentError} />
                    </div>
                  )}
                  {repo.recents.slice(0, 4).map((r) => (
                    <div className="welcome-recent-row" key={r.path}>
                      <button
                        className="welcome-recent-open"
                        title={r.path}
                        disabled={repo.forgettingRecent}
                        onClick={() => void repo.openPath(r.path)}
                      >
                        <strong>{r.name}</strong>
                        <span>{t("打开 →")}</span>
                      </button>
                      <button
                        type="button"
                        className="welcome-recent-remove"
                        aria-label={t("从最近打开移除 {name}", {
                          name: r.name,
                        })}
                        title={t("从最近打开移除")}
                        disabled={repo.forgettingRecent}
                        onClick={() => void repo.forgetRecent(r.path)}
                      >
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </main>
      ) : (
        <main className="repository-workbench" data-view={view}>
          <aside className="persistent-sidebar" aria-label={t("当前工作区")}>
            <header className="sidebar-heading">
              <h1>{t("源代码管理")}</h1>
              <span title={t("发生变化的文件数量")}>
                {t("{count} 个文件", { count: s!.files.length })}
              </span>
            </header>
            {s!.operation && (
              <div
                className={
                  "operation-status " + (conflicts ? "conflict-text" : "")
                }
              >
                {t(s!.operation)}
                {conflicts
                  ? t("暂停 · {count} 个冲突文件", { count: conflicts })
                  : t("进行中")}
              </div>
            )}
            <ChangesSidebar
              key={repo.project.repoId}
              files={s!.files}
              file={working.file}
              onFile={(file) => {
                working.choose(file);
                switchView("source");
              }}
            />
          </aside>
          <div
            className="resize-handle sidebar-resize-handle"
            role="separator"
            aria-label={t("调整侧栏宽度")}
            aria-orientation="vertical"
            tabIndex={0}
            {...panes.handle("sidebar")}
          />
          <section className="repository-main" aria-label={t("仓库内容")}>
            <header className="viewbar">
              <div
                className="view-tabs"
                role="tablist"
                aria-label={t("仓库视图")}
                data-view={view}
              >
                <i aria-hidden="true" />
                <button
                  role="tab"
                  aria-selected={view === "source"}
                  aria-controls="source-view"
                  id="source-tab"
                  onClick={() => switchView("source")}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowRight") {
                      switchView("history");
                      document.getElementById("history-tab")?.focus();
                    }
                  }}
                >
                  <Icon name="changes" size={15} />
                  {t("源码")}
                </button>
                <button
                  role="tab"
                  aria-selected={view === "history"}
                  aria-controls="history-view"
                  id="history-tab"
                  onClick={() => switchView("history")}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowLeft") {
                      switchView("source");
                      document.getElementById("source-tab")?.focus();
                    }
                  }}
                >
                  <Icon name="branch" size={15} />
                  {t("分支")}
                </button>
              </div>
              <span className="toolbar-spacer" />
              {view === "history" && (
                <Dropdown
                  value={repo.reference}
                  options={filters}
                  onChange={selectHistoryFilter}
                  label={t("筛选提交历史")}
                  searchable
                  icon="filter"
                />
              )}
            </header>
            <div
              className={"view-source " + (view === "source" ? "active" : "")}
              id="source-view"
              role="tabpanel"
              aria-labelledby="source-tab"
              inert={view !== "source"}
            >
              <SourceEditor
                files={s!.files}
                file={working.file}
                diff={working.diff}
                error={working.error}
                loading={working.loading}
                requestKey={working.requestKey}
                retry={working.retry}
                active={view === "source"}
                origin={
                  repo.project && working.file
                    ? {
                        repoId: repo.project.repoId,
                        path: working.file.path,
                        mode: working.file.mode,
                        changesRevision: working.diffRevision,
                      }
                    : undefined
                }
              />
            </div>
            <div
              className={"view-history " + (view === "history" ? "active" : "")}
              id="history-view"
              role="tabpanel"
              aria-labelledby="history-tab"
              inert={view !== "history"}
            >
              <div className="workspace" data-expanded={detailOpen}>
                <section className="history-panel" aria-label={t("仓库历史")}>
                  <div className="detail-pending">
                    <ReadStatus
                      busy={
                        !!effectiveSelection &&
                        detailState.owner === detailOwner &&
                        detailState.loading &&
                        !detailOpen
                      }
                      requestKey={detailOwner}
                      label={
                        selectedSubject
                          ? t("正在读取：{subject}", {
                              subject: selectedSubject,
                            })
                          : t("正在读取提交…")
                      }
                    />
                  </div>
                  {repo.history.error && (
                    <div className="history-error" role="status">
                      <ErrorMessage error={repo.history.error} />{" "}
                      {t("当前保留上次加载的历史。")}
                      <button onClick={repo.retryHistory}>{t("重试")}</button>
                    </div>
                  )}
                  <ReadStatus
                    busy={repo.history.loading}
                    requestKey={repo.project.repoId + repo.reference}
                    label={t("正在读取提交历史…")}
                  />
                  {repo.history.commits.length ? (
                    <HistoryGraph
                      active={
                        view === "history" && !(panes.compact && detailOpen)
                      }
                      commits={repo.history.commits}
                      snapshot={graphSnapshot!}
                      selected={
                        effectiveSelection?.kind === "commit"
                          ? effectiveSelection.hash
                          : null
                      }
                      onSelect={(hash) => pick({ kind: "commit", hash })}
                      locate={locate}
                      resetKey={repo.project.repoId + repo.history.reference}
                    />
                  ) : !repo.history.loading && !repo.history.error ? (
                    <div className="history-empty">
                      <Icon name="branch" size={28} />
                      <p>
                        {s!.head ? t("当前筛选没有提交。") : t("还没有提交。")}
                      </p>
                      {!s!.head && (
                        <span>
                          {t("在编辑器或终端中提交后，这里会自动更新。")}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="history-empty" />
                  )}
                  <div className="history-bottom">
                    <span>
                      {repo.history.commits.length > 0 &&
                        (repo.history.hasMore || repo.history.loading) &&
                        t("已加载 {count} 个提交", {
                          count: repo.history.commits.length,
                        })}
                    </span>
                    {repo.history.hasMore && (
                      <button
                        onClick={repo.more}
                        aria-label={t("加载更多提交")}
                        title={t("加载更多提交")}
                        disabled={
                          repo.history.loading ||
                          !!repo.history.error ||
                          repo.history.reference !== repo.reference
                        }
                      >
                        <Icon name="chevron" />
                      </button>
                    )}
                    {s!.stashes.length > 0 && (
                      <button onClick={() => pick({ kind: "stashes" })}>
                        <Icon name="stack" size={14} />
                        {t("临时保存")}
                        <span className="count-bubble">
                          {s!.stashes.length}
                        </span>
                      </button>
                    )}
                  </div>
                </section>
                <div
                  className="resize-handle"
                  role="separator"
                  aria-label={t("调整详情宽度")}
                  aria-orientation="vertical"
                  tabIndex={detailOpen ? 0 : -1}
                  {...panes.handle("detail")}
                />
                <div
                  className="detail-shell"
                  aria-hidden={!detailOpen}
                  inert={!detailOpen}
                >
                  <Details
                    commits={repo.history.commits}
                    key={repo.project.repoId}
                    project={repo.project}
                    selection={
                      effectiveSelection ?? shownPanel?.selection ?? null
                    }
                    active={!!effectiveSelection && view === "history"}
                    keepPrevious={wasDetailOpen.current}
                    subject={selectedSubject}
                    onStateChange={reportDetail}
                    onClose={() => setSelection(null)}
                  />
                </div>
              </div>
            </div>
          </section>
        </main>
      )}
    </div>
  );
}
