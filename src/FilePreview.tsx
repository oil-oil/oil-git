import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { CodeDiff } from "./CodeDiff";
import type { FilePreview, PreviewSide } from "./types";
import { useI18n } from "./i18n";
import { ErrorMessage } from "./ErrorMessage";
import "./file-preview.css";

export function fileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MiB`;
}
function SideInfo({
  side,
  label,
}: {
  side: PreviewSide | null;
  label: string;
}) {
  const { t } = useI18n();
  return (
    <header className="preview-side-heading">
      <strong>{label}</strong>
      <span>
        {side
          ? [
              side.width && side.height
                ? `${side.width} × ${side.height}`
                : null,
              fileSize(side.size),
            ]
              .filter(Boolean)
              .join(" · ")
          : t("文件不存在")}
      </span>
    </header>
  );
}
function Media({
  side,
  label,
  zoom,
  active,
  onDecodeFailure,
}: {
  side: PreviewSide | null;
  label: string;
  zoom: boolean;
  active: boolean;
  onDecodeFailure: () => void;
}) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const media = useRef<HTMLMediaElement | null>(null);
  useEffect(() => {
    setFailed(false);
  }, [side?.dataUrl]);
  useEffect(() => {
    // Hidden views cannot keep playing; visibility follows the existing tab container.
    const element = media.current;
    if (!element) return;
    const stop = () => {
      if (document.hidden || !element.getClientRects().length) element.pause();
    };
    const observer = new IntersectionObserver(stop);
    observer.observe(element);
    document.addEventListener("visibilitychange", stop);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", stop);
      element.pause();
    };
  }, [side?.dataUrl, active]);
  if (!active) return null;
  const decodeFailed = () => {
    setFailed(true);
    onDecodeFailure();
  };
  if (!side) return <div className="preview-empty">{t("文件不存在")}</div>;
  if (!side.dataUrl || failed)
    return (
      <div className="preview-empty">
        {(side.note && t(side.note)) ||
          (failed
            ? t("无法解码此格式，可在下方查看字节差异。")
            : t("此格式显示文件信息和字节差异。"))}
      </div>
    );
  if (side.kind === "image")
    return (
      <div className={"image-surface" + (zoom ? " image-original" : "")}>
        <img
          src={side.dataUrl}
          alt={label}
          decoding="async"
          onError={decodeFailed}
        />
      </div>
    );
  if (side.kind === "audio")
    return (
      <div className="audio-surface">
        <audio
          ref={(element) => {
            media.current = element;
          }}
          src={side.dataUrl}
          controls
          preload="metadata"
          aria-label={label}
          onError={decodeFailed}
        />
      </div>
    );
  return (
    <div className="video-surface">
      <video
        ref={(element) => {
          media.current = element;
        }}
        src={side.dataUrl}
        controls
        preload="metadata"
        aria-label={label}
        onError={decodeFailed}
      />
    </div>
  );
}
type ImageMode = "split" | "wipe" | "overlay" | "difference";
function PixelDifference({
  before,
  after,
  onDecodeFailure,
}: {
  before: string;
  after: string;
  onDecodeFailure: () => void;
}) {
  const { t } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [note, setNote] = useState<
    | { kind: "loading" }
    | { kind: "error" }
    | { kind: "result"; downsampled: boolean; percent: string }
  >({ kind: "loading" });
  useEffect(() => {
    let live = true;
    if (canvas.current) canvas.current.width = canvas.current.height = 0;
    setNote({ kind: "loading" });
    const decode = (src: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = src;
      });
    void Promise.all([decode(before), decode(after)])
      .then(([old, next]) => {
        if (!live || !canvas.current) return;
        const maxWidth = Math.max(old.naturalWidth, next.naturalWidth);
        const maxHeight = Math.max(old.naturalHeight, next.naturalHeight);
        const scale = Math.min(1, 2048 / maxWidth, 2048 / maxHeight);
        const width = Math.max(1, Math.ceil(maxWidth * scale));
        const height = Math.max(1, Math.ceil(maxHeight * scale));
        const layer = document.createElement("canvas");
        layer.width = width;
        layer.height = height;
        const context = layer.getContext("2d", { willReadFrequently: true });
        const output = canvas.current.getContext("2d");
        if (!context || !output) throw new Error("canvas unavailable");
        const pixels = (image: HTMLImageElement) => {
          context.clearRect(0, 0, width, height);
          context.drawImage(
            image,
            0,
            0,
            image.naturalWidth * scale,
            image.naturalHeight * scale,
          );
          return context.getImageData(0, 0, width, height);
        };
        const left = pixels(old),
          right = pixels(next);
        let changed = 0;
        for (let index = 0; index < left.data.length; index += 4) {
          let different = false;
          const alphaDifference = Math.abs(
            left.data[index + 3] - right.data[index + 3],
          );
          for (let channel = 0; channel < 3; channel++) {
            const difference = Math.abs(
              (left.data[index + channel] * left.data[index + 3]) / 255 -
                (right.data[index + channel] * right.data[index + 3]) / 255,
            );
            different ||= difference > 0 || alphaDifference > 0;
            left.data[index + channel] = Math.max(difference, alphaDifference);
          }
          left.data[index + 3] = 255;
          if (different) changed++;
        }
        canvas.current.width = width;
        canvas.current.height = height;
        output.putImageData(left, 0, 0);
        setNote({
          kind: "result",
          downsampled: scale < 1,
          percent: ((changed / (width * height)) * 100).toFixed(2),
        });
        layer.width = layer.height = 0;
      })
      .catch(() => {
        if (live) {
          if (canvas.current) canvas.current.width = canvas.current.height = 0;
          setNote({ kind: "error" });
          onDecodeFailure();
        }
      });
    return () => {
      live = false;
    };
  }, [before, after]);
  return (
    <div className="pixel-difference">
      <canvas ref={canvas} aria-label={t("像素差异图")} />
      <p role="status">
        {note.kind === "loading"
          ? t("正在计算像素差异…")
          : note.kind === "error"
            ? t("无法计算此格式的像素差异，请使用并排或滑动对比。")
            : (note.downsampled ? t("缩小采样 · ") : "") +
              t("{percent}% 像素变化 · 黑色表示相同，亮色表示变化", {
                percent: note.percent,
              })}
      </p>
    </div>
  );
}
function ImageComparison({
  preview,
  labels,
  active,
  onDecodeFailure,
}: {
  preview: FilePreview;
  labels: [string, string];
  active: boolean;
  onDecodeFailure: () => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<ImageMode>("split");
  const [zoom, setZoom] = useState(false);
  const [position, setPosition] = useState(50);
  const [layerError, setLayerError] = useState(false);
  const [sizes, setSizes] = useState<Record<string, [number, number]>>({});
  const { before, after } = preview;
  const comparable =
    before?.kind === "image" &&
    after?.kind === "image" &&
    !!before.dataUrl &&
    !!after.dataUrl;
  const currentMode = comparable ? mode : "split";
  useEffect(() => {
    setLayerError(false);
    setPosition(50);
    setSizes({});
  }, [before?.dataUrl, after?.dataUrl]);
  const oldSize = (before?.dataUrl && sizes[before.dataUrl]) || [
    before?.width || 1,
    before?.height || 1,
  ];
  const nextSize = (after?.dataUrl && sizes[after.dataUrl]) || [
    after?.width || 1,
    after?.height || 1,
  ];
  const width = Math.max(oldSize[0], nextSize[0]),
    height = Math.max(oldSize[1], nextSize[1]);
  if (!active) return null;
  return (
    <section className="image-comparison" aria-label={t("图片差异")}>
      <div className="preview-toolbar">
        <div className="diff-tabs" aria-label={t("图片对比方式")}>
          {(
            [
              ["split", zoom ? t("上下") : t("并排")],
              ["wipe", t("滑动")],
              ["overlay", t("叠加")],
              ["difference", t("像素差异")],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              aria-pressed={currentMode === value}
              disabled={value !== "split" && !comparable}
              onClick={() => setMode(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {currentMode === "split" && (
          <div className="diff-tabs" aria-label={t("图片缩放")}>
            <button aria-pressed={!zoom} onClick={() => setZoom(false)}>
              {t("适应")}
            </button>
            <button aria-pressed={zoom} onClick={() => setZoom(true)}>
              100%
            </button>
          </div>
        )}
      </div>
      {currentMode === "split" ? (
        <>
          {(!before || !after) && (
            <p className="inline-note">
              {before ? t("图片已删除") : t("新增图片")} ·{" "}
              {labels[before ? 1 : 0]} · {t("文件不存在")}
            </p>
          )}
          <div
            className={
              "preview-sides" +
              (!before || !after ? " single-side" : "") +
              (zoom ? " image-vertical" : "")
            }
          >
            {[before, after].map(
              (side, index) =>
                side && (
                  <section
                    className="preview-side"
                    data-side={index === 0 ? "before" : "after"}
                    key={index}
                    aria-label={labels[index]}
                  >
                    <SideInfo side={side} label={labels[index]} />
                    <Media
                      side={side}
                      label={labels[index]}
                      zoom={zoom}
                      active={active}
                      onDecodeFailure={onDecodeFailure}
                    />
                  </section>
                ),
            )}
          </div>
        </>
      ) : currentMode === "difference" ? (
        <PixelDifference
          key={`${before!.dataUrl}\0${after!.dataUrl}`}
          before={before!.dataUrl!}
          after={after!.dataUrl!}
          onDecodeFailure={onDecodeFailure}
        />
      ) : (
        <>
          <div className="layer-labels">
            <SideInfo side={before} label={labels[0]} />
            <SideInfo side={after} label={labels[1]} />
          </div>
          {layerError ? (
            <p className="inline-note">
              {t("无法解码此格式，请使用字节差异。")}
            </p>
          ) : (
            <div className="image-layer-surface image-surface">
              <div
                className="image-layer-stage"
                style={{
                  width: `min(100%, ${width}px)`,
                  aspectRatio: `${width} / ${height}`,
                }}
              >
                {[before!, after!].map((side, index) => (
                  <img
                    key={index}
                    src={side.dataUrl!}
                    alt={labels[index]}
                    decoding="async"
                    onError={() => {
                      setLayerError(true);
                      onDecodeFailure();
                    }}
                    onLoad={(event) => {
                      const image = event.currentTarget;
                      setSizes((old) => ({
                        ...old,
                        [side.dataUrl!]: [
                          image.naturalWidth,
                          image.naturalHeight,
                        ],
                      }));
                    }}
                    style={
                      {
                        width: `${((index ? nextSize : oldSize)[0] / width) * 100}%`,
                        height: `${((index ? nextSize : oldSize)[1] / height) * 100}%`,
                        ...(index
                          ? currentMode === "wipe"
                            ? {
                                clipPath: `inset(0 ${Math.max(0, 100 - (position * width) / nextSize[0])}% 0 0)`,
                              }
                            : { opacity: position / 100 }
                          : {}),
                      } as CSSProperties
                    }
                  />
                ))}
                {currentMode === "wipe" && (
                  <div
                    className="image-wipe-line"
                    style={{ left: `${position}%` }}
                  />
                )}
              </div>
            </div>
          )}
          <label className="image-slider">
            <span>
              {currentMode === "wipe"
                ? t("对比分界")
                : t("{label}的不透明度", { label: labels[1] })}
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={position}
              aria-label={
                currentMode === "wipe" ? t("图片对比分界") : t("叠加不透明度")
              }
              onChange={(event) => setPosition(Number(event.target.value))}
            />
            <output>{position}%</output>
          </label>
        </>
      )}
    </section>
  );
}
function HexDiff({
  preview,
  labels,
}: {
  preview: FilePreview;
  labels: [string, string];
}) {
  const { t } = useI18n();
  const [changedOnly, setChangedOnly] = useState(true);
  const [scrollTop, setScrollTop] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const before = preview.before?.hex.match(/.{2}/g) ?? [],
    after = preview.after?.hex.match(/.{2}/g) ?? [];
  const rows = Array.from(
    { length: Math.ceil(Math.max(before.length, after.length) / 16) },
    (_, index) => index * 16,
  );
  const shown = rows.filter(
    (offset) =>
      !changedOnly ||
      Array.from({ length: 16 }, (_, i) => i + offset).some(
        (i) => before[i] !== after[i],
      ),
  );
  const start = Math.max(
    0,
    Math.min(Math.floor(scrollTop / 24) - 4, shown.length - 15),
  );
  const visible = shown.slice(start, start + 23);
  const empty = shown.length === 0;
  useLayoutEffect(() => {
    // An empty filter unmounts the viewport; its next DOM scroll position is zero.
    if (viewport.current) viewport.current.scrollTop = 0;
    setScrollTop(0);
  }, [changedOnly, empty]);
  return (
    <section className="hex-diff" aria-label={t("字节差异")}>
      <header>
        <strong>{t("字节差异")}</strong>
        <label>
          <input
            type="checkbox"
            checked={changedOnly}
            onChange={(event) => setChangedOnly(event.target.checked)}
          />
          {t("仅显示变化")}
        </label>
      </header>
      {(preview.before?.hexTruncated || preview.after?.hexTruncated) && (
        <p className="inline-note">
          {t("每侧仅比较前 4 KiB，偏移以十六进制显示。")}
        </p>
      )}
      {!shown.length ? (
        <p className="inline-note">
          {preview.before?.hexTruncated || preview.after?.hexTruncated
            ? t("前 4 KiB 没有字节变化，后续内容未比较。")
            : t("内容字节相同，变化可能来自路径或文件模式。")}
        </p>
      ) : (
        <div className="hex-table">
          <div className="hex-labels">
            <span>{t("偏移")}</span>
            <span>{labels[0]}</span>
            <span>{labels[1]}</span>
          </div>
          <div
            className="hex-viewport"
            ref={viewport}
            style={{ height: Math.min(360, shown.length * 24) }}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          >
            <div className="hex-rows" style={{ height: shown.length * 24 }}>
              {visible.map((offset, index) => (
                <div
                  className="hex-row"
                  key={offset}
                  style={{ top: (start + index) * 24 }}
                >
                  <code>{offset.toString(16).padStart(8, "0")}</code>
                  {[before, after].map((bytes, side) => (
                    <code className="hex-bytes" key={side}>
                      {Array.from({ length: 16 }, (_, i) => {
                        const index = offset + i;
                        return (
                          <span
                            key={i}
                            className={
                              before[index] !== after[index]
                                ? side
                                  ? "add"
                                  : "remove"
                                : ""
                            }
                          >
                            {bytes[index] ?? "··"}
                          </span>
                        );
                      })}
                    </code>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
export function FilePreviewDiff({
  preview,
  patch,
  note,
  noteKey,
  encoding,
  active = true,
  labels,
}: {
  preview: FilePreview;
  patch: string;
  note?: string | null;
  noteKey?: string;
  encoding?: string;
  active?: boolean;
  labels?: [string, string];
}) {
  const { t } = useI18n();
  const sidesLabels = labels ?? [t("变更前"), t("变更后")];
  const sides = [preview.before, preview.after];
  const image = sides.some((side) => side?.kind === "image");
  const media = sides.some(
    (side) => side?.kind === "audio" || side?.kind === "video",
  );
  const [failedFor, setFailedFor] = useState<{
    before: string | null | undefined;
    after: string | null | undefined;
  } | null>(null);
  // The source diff lives in a collapsed disclosure, so it only owns the find
  // shortcut while the view is shown and this section is open.
  const [sourceOpen, setSourceOpen] = useState(false);
  const beforeUrl = preview.before?.dataUrl,
    afterUrl = preview.after?.dataUrl;
  const decodeFailure = () =>
    setFailedFor({ before: beforeUrl, after: afterUrl });
  const showBytes =
    (!image && !media) ||
    sides.some((side) => side && !side.dataUrl) ||
    (failedFor !== null &&
      failedFor.before === beforeUrl &&
      failedFor.after === afterUrl);
  const delta = (preview.after?.size ?? 0) - (preview.before?.size ?? 0);
  return (
    <div className="file-preview-diff">
      <div className="preview-summary">
        <span>
          {preview.conflict ? t("未解决冲突") + " · " : ""}
          {delta
            ? `${delta > 0 ? "+" : "−"}${fileSize(Math.abs(delta))}`
            : t("大小不变")}
        </span>
      </div>
      {(note || encoding) && (
        <div className="inline-note">
          {encoding && <span>{encoding} · </span>}
          {note &&
            (noteKey ? (
              <ErrorMessage
                error={{ kind: noteKey, messageKey: noteKey, message: note }}
              />
            ) : (
              <span>{t(note)}</span>
            ))}
        </div>
      )}
      {image ? (
        <ImageComparison
          preview={preview}
          labels={sidesLabels}
          active={active}
          onDecodeFailure={decodeFailure}
        />
      ) : (
        <div className="preview-sides">
          {sides.map((side, index) => (
            <section
              className="preview-side"
              data-side={index === 0 ? "before" : "after"}
              key={index}
              aria-label={sidesLabels[index]}
            >
              <SideInfo side={side} label={sidesLabels[index]} />
              {media ? (
                <Media
                  side={side}
                  label={sidesLabels[index]}
                  zoom={false}
                  active={active}
                  onDecodeFailure={decodeFailure}
                />
              ) : (
                <p className="binary-format">
                  {side?.mime || t("文件不存在")}
                  {side?.note && <span>{t(side.note)}</span>}
                </p>
              )}
            </section>
          ))}
        </div>
      )}
      {showBytes && (
        <div className="preview-byte-fallback">
          <HexDiff preview={preview} labels={sidesLabels} />
        </div>
      )}
      {patch && !patch.includes("Binary files ") && (
        <details
          className="raw-diff"
          open={sourceOpen}
          onToggle={(event) => setSourceOpen(event.currentTarget.open)}
        >
          <summary>{t("源码差异")}</summary>
          <CodeDiff
            patch={patch}
            layout="unified"
            includeMetadata
            active={active && sourceOpen}
          />
        </details>
      )}
    </div>
  );
}
