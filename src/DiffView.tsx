import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Diff, ConflictLine, DiffOrigin } from "./types";
import { LineAttribution } from "./LineAttribution";
import { CodeDiff, CodeLines } from "./CodeDiff";
import { FilePreviewDiff } from "./FilePreview";
import { useI18n } from "./i18n";
import { ErrorMessage } from "./ErrorMessage";
import "./lfs-diff.css";
export { patchRows } from "./patch";

function Patch({ patch, active }: { patch: string; active?: boolean }) {
  return (
    <CodeDiff patch={patch} layout="unified" includeMetadata active={active} />
  );
}
function ConflictCode({
  rows,
  label,
  active,
}: {
  rows: ConflictLine[];
  label: string;
  active?: boolean;
}) {
  const { t } = useI18n();
  return rows.length ? (
    <CodeLines lines={rows} label={label} active={active} />
  ) : (
    <p className="inline-note">{t("这部分内容为空。")}</p>
  );
}
// The common-origin disclosure is collapsed by default, so its diff only owns
// the find shortcut while the section is open (see RawDiff).
function ConflictBase({
  rows,
  label,
  active,
}: {
  rows: ConflictLine[];
  label: string;
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{label}</summary>
      <ConflictCode rows={rows} label={label} active={active && open} />
    </details>
  );
}
// A raw-diff disclosure owns the find shortcut only while it is the visible
// region: a collapsed <details> content must not claim Cmd+F, so the inner diff
// is active solely when the view is shown and this disclosure is open.
function RawDiff({
  summary,
  patch,
  active,
}: {
  summary: ReactNode;
  patch: string;
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="raw-diff"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{summary}</summary>
      <Patch patch={patch} active={active && open} />
    </details>
  );
}
function LfsDiff({
  data,
  labels,
  active,
}: {
  data: Diff;
  labels: [string, string];
  active?: boolean;
}) {
  const { t, language } = useI18n();
  const lfs = data.lfs!;
  const states = [lfs.beforeState, lfs.afterState];
  return (
    <section className="lfs-diff" aria-label={t("Git LFS 对象变化")}>
      <header>
        <h3>
          Git LFS
          {lfs.conflict && (
            <span className="lfs-conflict-state">{t("未解决冲突")}</span>
          )}
        </h3>
        <p>{t("Git 保存的是文件指针。此处显示对象信息，不下载文件内容。")}</p>
      </header>
      <div className="lfs-sides">
        {[lfs.before, lfs.after].map((pointer, index) => (
          <section className="lfs-side" key={index} aria-label={labels[index]}>
            <h4>{labels[index]}</h4>
            {pointer ? (
              <dl>
                <dt>{t("大小")}</dt>
                <dd>
                  {new Intl.NumberFormat(
                    language === "en" ? "en-US" : "zh-CN",
                  ).format(pointer.size)}{" "}
                  {t("字节")}
                </dd>
                <dt>SHA-256</dt>
                <dd>
                  <code>{pointer.oid}</code>
                </dd>
              </dl>
            ) : (
              <p>
                {states[index] === "missing"
                  ? t("文件不存在")
                  : states[index] === "regular"
                    ? t("此侧是普通文件内容")
                    : states[index] === "unsupported"
                      ? t("此侧不是受支持的 LFS 指针")
                      : t("无 LFS 对象")}
              </p>
            )}
          </section>
        ))}
      </div>
      {data.note && (
        <div className="lfs-note">
          {data.noteKey ? (
            <ErrorMessage
              error={{
                kind: data.noteKey,
                messageKey: data.noteKey,
                message: data.note,
              }}
            />
          ) : (
            t(data.note)
          )}
        </div>
      )}
      {data.patch && (
        <RawDiff
          active={active}
          patch={data.patch}
          summary={lfs.conflict ? t("原始指针冲突") : t("原始指针差异")}
        />
      )}
    </section>
  );
}
export function DiffView({
  data,
  layout = "unified",
  labels,
  origin,
  active = true,
}: {
  data: Diff;
  layout?: "split" | "unified";
  labels?: [string, string];
  origin?: DiffOrigin;
  active?: boolean;
}) {
  const { t } = useI18n();
  const [line, setLine] = useState<{
    side: "before" | "after";
    line: number;
  } | null>(null);
  const originKey = JSON.stringify(origin);
  useEffect(() => {
    setLine(null);
  }, [originKey, data.patch]);
  const selectLine =
    origin && (!data.encoding || data.encoding === "UTF-8")
      ? (side: "before" | "after", number: number) =>
          setLine({ side, line: number })
      : undefined;
  return (
    <div
      className={
        "diff-result " +
        (!data.conflict &&
        !data.lfs &&
        !data.preview &&
        !(data.note && data.patch)
          ? "virtual-diff"
          : "")
      }
    >
      {data.lfs ? (
        <LfsDiff
          data={data}
          active={active}
          labels={
            data.lfs.conflict
              ? [t("当前分支"), t("合入分支")]
              : (labels ?? [t("变更前"), t("变更后")])
          }
        />
      ) : data.preview ? (
        <FilePreviewDiff
          preview={data.preview}
          patch={data.patch}
          note={data.note}
          noteKey={data.noteKey}
          encoding={data.encoding}
          active={active}
          labels={
            data.preview.conflict ? [t("当前分支"), t("合入分支")] : labels
          }
        />
      ) : data.conflict ? (
        <>
          <p className="diff-caption">{t(data.conflict.kind)}</p>
          {data.conflict.blocks.map((b, i) => (
            <section className="conflict-block" key={b.startLine}>
              <h3>
                {t("冲突 {index}", { index: i + 1 })}{" "}
                <span>
                  {t("第 {start}–{end} 行", {
                    start: b.startLine,
                    end: b.endLine,
                  })}
                </span>
              </h3>
              <div className="conflict-label">{t("当前分支的内容")}</div>
              <ConflictCode
                rows={b.ours}
                label={t("当前分支的内容")}
                active={active}
              />
              {b.base.length > 0 && (
                <ConflictBase
                  rows={b.base}
                  label={t("共同起点")}
                  active={active}
                />
              )}
              <div className="conflict-label incoming">
                {t("合入的内容")} {b.incoming && <span>· {b.incoming}</span>}
              </div>
              <ConflictCode
                rows={b.theirs}
                label={t("合入的内容")}
                active={active}
              />
            </section>
          ))}
          {data.conflict.note && (
            <p className="inline-note">{t(data.conflict.note)}</p>
          )}
          <RawDiff
            summary={t("Git 原始差异")}
            patch={data.patch}
            active={active}
          />
        </>
      ) : data.patch && data.note && data.noteKey ? (
        <section className="unconfirmed-diff">
          {data.binary && (
            <p className="inline-note">
              {t("二进制文件发生变化，无法显示文本差异。")}
            </p>
          )}
          <div className="inline-note" role="status">
            <ErrorMessage
              error={{
                kind: data.noteKey,
                messageKey: data.noteKey,
                message: data.note,
              }}
            />
          </div>
          <RawDiff
            summary={t("Git 原始差异")}
            patch={data.patch}
            active={active}
          />
        </section>
      ) : data.binary ? (
        <p className="inline-note">
          {t("二进制文件发生变化，无法显示文本差异。")}
        </p>
      ) : data.patch && data.note ? (
        <section className="unconfirmed-diff">
          <p className="inline-note" role="status">
            {t(data.note)}
          </p>
          <RawDiff
            summary={t("Git 原始差异")}
            patch={data.patch}
            active={active}
          />
        </section>
      ) : data.patch ? (
        <>
          {origin && line && (
            <LineAttribution
              origin={origin}
              selection={line}
              onClose={() => setLine(null)}
              active={active}
            />
          )}
          {data.encoding && (
            <p className="encoding-note">
              {data.encoding} · {t("按文本比较")}
            </p>
          )}
          <CodeDiff
            patch={data.patch}
            layout={layout}
            labels={labels}
            onLineSelect={selectLine}
            active={active}
          />
        </>
      ) : data.note && data.noteKey ? (
        <div className="inline-note" role="status">
          <ErrorMessage
            error={{
              kind: data.noteKey,
              messageKey: data.noteKey,
              message: data.note,
            }}
          />
        </div>
      ) : (
        <p className="inline-note">
          {data.note ? t(data.note) : t("当前比较范围没有差异。")}
        </p>
      )}
      {data.truncated && (
        <p className="inline-note">{t("差异较大，仅展示前 240 KB。")}</p>
      )}
    </div>
  );
}
