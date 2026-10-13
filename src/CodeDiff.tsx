import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { patchRows } from "./patch";
import { VariableHeightIndex } from "./variableVirtualizer";
import type { ConflictLine } from "./types";
import { useI18n } from "./i18n";
import { Icon } from "./Icon";
import "./code-diff.css";

type Row = ReturnType<typeof patchRows>[number];
type CodeRow = Row | ConflictLine;
export type SplitRow = { left: Row | null; right: Row | null; meta?: string };
type PatchCodeDiffProps = {
  patch: string;
  layout: "split" | "unified";
  labels?: [string, string];
  includeMetadata?: boolean;
  ariaLabel?: string;
  onLineSelect?: (side: "before" | "after", line: number) => void;
  active?: boolean;
};
type RawCodeDiffProps = {
  rawLines: ConflictLine[];
  ariaLabel: string;
  active?: boolean;
};

function isPatchRow(row: CodeRow): row is Row {
  return "kind" in row;
}

// A split item always carries `left`; unified/raw rows never do. Split rows pair
// a before/after column, so their searchable text spans both sides and the meta.
function isSplitRowItem(item: CodeRow | SplitRow): item is SplitRow {
  return "left" in item;
}

// Only add/remove/context lines carry a leading diff control marker (+/-/space).
// Those markers are presentation, not source, so search must skip them.
function isCodeKind(kind: string): kind is "add" | "remove" | "context" {
  return kind === "add" || kind === "remove" || kind === "context";
}

// The searchable text of an item, as a fixed positional list. Split code rows
// always yield [before, after] — an empty string for a missing side — so the
// render's `segIdx = side` lines up with the same side here. Collapsing the
// missing side would shift the after column onto the before track (a pure
// addition rendering its new code under "before"). Code rows drop their leading
// control marker so a search matches real source (e.g. "new"), never the marker
// joined to the text (e.g. "+new"). Meta and raw lines are matched as shown.
function itemSegments(item: CodeRow | SplitRow): string[] {
  if (isSplitRowItem(item)) {
    if (item.meta != null) return [item.meta];
    return [
      item.left ? item.left.text.slice(1) : "",
      item.right ? item.right.text.slice(1) : "",
    ];
  }
  if (isPatchRow(item) && isCodeKind(item.kind)) return [item.text.slice(1)];
  return [item.text];
}

// The leading control marker (+/-/space) of a unified code row, or "" for meta,
// hunk and raw lines. Rendered verbatim so the diff gutter stays intact.
function codeMarker(item: CodeRow | SplitRow): string {
  if (isSplitRowItem(item)) return "";
  if (isPatchRow(item) && isCodeKind(item.kind)) return item.text.slice(0, 1);
  return "";
}

type Span = { start: number; end: number };

function findSpans(haystack: string, needle: string): Span[] {
  const spans: Span[] = [];
  if (!needle) return spans;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    spans.push({ start: at, end: at + needle.length });
    at = haystack.indexOf(needle, at + needle.length);
  }
  return spans;
}

// toLowerCase can change a string's length (e.g. "İ" → "i̇", two code units), so
// haystack offsets must be mapped back to original indices or every highlight
// after such a character drifts off the source. This records, per lowercased
// code unit, which original index it came from.
function lowerIndexMap(text: string): number[] {
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const lowered = text[i].toLowerCase();
    for (let k = 0; k < lowered.length; k++) map.push(i);
  }
  return map;
}

// Wrap every case-insensitive occurrence of the needle in <mark>, preserving the
// source's original casing. `currentStart` (a haystack offset) marks the active
// hit; pass -1 for none. Returns a plain string when nothing matches so
// unchanged rows keep their exact text content.
function highlightOccurrences(
  text: string,
  needle: string,
  currentStart: number,
): ReactNode {
  if (!needle) return text;
  const spans = findSpans(text.toLowerCase(), needle);
  if (spans.length === 0) return text;
  const map = lowerIndexMap(text);
  const nodes: ReactNode[] = [];
  let from = 0;
  let key = 0;
  for (const span of spans) {
    // A lower-cased char can expand to several code units ("İ" → "i̇"), so map
    // the hit back to the whole original character(s) it covers: start at the
    // char holding the first unit, end just past the char holding the last unit.
    // Using the next unit's origin for the end collapses a partial-fold match
    // (e.g. just the "i" of "İ") to an empty mark.
    const start = map[span.start] ?? span.start;
    const end = (map[span.end - 1] ?? span.end - 1) + 1;
    if (start > from) nodes.push(text.slice(from, start));
    nodes.push(
      <mark
        key={key++}
        className={
          span.start === currentStart
            ? "diff-search-hit diff-search-hit-current"
            : "diff-search-hit"
        }
      >
        {text.slice(start, end)}
      </mark>,
    );
    from = end;
  }
  if (from < text.length) nodes.push(text.slice(from));
  return nodes;
}

// One match location. Counting is per occurrence (like a browser find), so a
// line with three hits reports three and navigation walks each in turn. `start`
// is the hit's offset within the segment's lowercased text.
type Occurrence = { item: number; seg: number; start: number };

const BASE_ROW_HEIGHT = 24;
const OVERSCAN = 5;
const SPLIT_RATIO_KEY = "oil-git.diff-split-ratio";
const MIN_SPLIT_RATIO = 0.25;
const MAX_SPLIT_RATIO = 0.75;

function clampSplitRatio(value: number) {
  return Math.max(MIN_SPLIT_RATIO, Math.min(MAX_SPLIT_RATIO, value));
}

function readSplitRatio() {
  try {
    const value = Number(localStorage.getItem(SPLIT_RATIO_KEY));
    return Number.isFinite(value) &&
      value >= MIN_SPLIT_RATIO &&
      value <= MAX_SPLIT_RATIO
      ? value
      : 0.5;
  } catch {
    return 0.5;
  }
}

type VirtualizerState<T> = {
  items: T[];
  index: VariableHeightIndex;
  sideHeights: [Float64Array, Float64Array];
  sideGenerations: [Uint32Array, Uint32Array];
  generation: number;
};

function makeVirtualizer<T>(items: T[]): VirtualizerState<T> {
  return {
    items,
    index: new VariableHeightIndex(items.length, BASE_ROW_HEIGHT),
    sideHeights: [
      new Float64Array(items.length),
      new Float64Array(items.length),
    ],
    sideGenerations: [
      new Uint32Array(items.length),
      new Uint32Array(items.length),
    ],
    generation: 1,
  };
}

export function splitRows(rows: Row[]): SplitRow[] {
  const result: SplitRow[] = [],
    removed: Row[] = [],
    added: Row[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(removed.length, added.length); i++)
      result.push({ left: removed[i] ?? null, right: added[i] ?? null });
    removed.length = 0;
    added.length = 0;
  };
  for (const row of rows) {
    if (row.kind === "remove") {
      removed.push(row);
      continue;
    }
    if (row.kind === "add") {
      added.push(row);
      continue;
    }
    flush();
    if (row.kind === "context") result.push({ left: row, right: row });
    else result.push({ left: null, right: null, meta: row.text });
  }
  flush();
  return result;
}

export function CodeDiff(props: PatchCodeDiffProps | RawCodeDiffProps) {
  const { t } = useI18n();
  const rawLines = "rawLines" in props ? props.rawLines : undefined;
  const patch = "patch" in props ? props.patch : "";
  const layout = "layout" in props ? props.layout : "unified";
  const labels =
    ("labels" in props ? props.labels : undefined) ??
    ([t("原始内容"), t("修改后的内容")] as [string, string]);
  const includeMetadata =
    "includeMetadata" in props ? (props.includeMetadata ?? false) : false;
  const ariaLabel = "ariaLabel" in props ? props.ariaLabel : undefined;
  const onLineSelect = "onLineSelect" in props ? props.onLineSelect : undefined;
  const active = "active" in props ? (props.active ?? false) : false;
  const lineNumber = (value: number | string, side: "before" | "after") =>
    onLineSelect && typeof value === "number" && value > 0 ? (
      <button
        className="line-number line-origin-button"
        title={t("查看第 {line} 行最后修改者", { line: value })}
        aria-label={t("{side}第 {line} 行归属", {
          side: t(side === "before" ? "变更前" : "变更后"),
          line: value,
        })}
        onClick={() => onLineSelect(side, value)}
      >
        {value}
      </button>
    ) : (
      <span className="line-number">{value}</span>
    );
  const renderLayout = rawLines ? "unified" : layout;
  const rows = useMemo<CodeRow[]>(
    () => rawLines ?? patchRows(patch),
    [patch, rawLines],
  );
  const hasHunk = rows.some((row) => isPatchRow(row) && row.kind === "hunk");
  const visibleRows = useMemo(
    () =>
      hasHunk && !includeMetadata
        ? rows.filter(
            (row) =>
              !isPatchRow(row) ||
              row.kind !== "meta" ||
              row.text.startsWith("\\"),
          )
        : rows,
    [hasHunk, includeMetadata, rows],
  );
  const split = useMemo(
    () =>
      renderLayout === "split" ? splitRows(visibleRows.filter(isPatchRow)) : [],
    [renderLayout, visibleRows],
  );
  const items: (CodeRow | SplitRow)[] =
    renderLayout === "split" ? split : visibleRows;
  const leftViewport = useRef<HTMLDivElement>(null);
  const rightViewport = useRef<HTMLDivElement>(null);
  const viewports = useMemo(() => [leftViewport, rightViewport] as const, []);
  const splitRoot = useRef<HTMLDivElement>(null);
  const divider = useRef<HTMLDivElement>(null);
  const [splitRatio, setSplitRatio] = useState(readSplitRatio);
  const splitRatioRef = useRef(splitRatio);
  const [search, setSearch] = useState("");
  const [searchCursor, setSearchCursor] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const [composingValue, setComposingValue] = useState<string | null>(null);
  const inputValue = composingValue ?? search;
  // The search bar is collapsed by default: nothing is rendered, so it leaves
  // no icon, height, border or blank strip. Cmd/Ctrl+F opens it and focuses the
  // input; Esc or the close button collapses it and clears the query.
  const [searchOpen, setSearchOpen] = useState(false);
  // Points at whichever element currently represents this diff's search entry —
  // the hidden marker while collapsed, the bar while open — so the Cmd/F
  // listener can tell whether it is the first visible owner.
  const searchBarRef = useRef<HTMLDivElement>(null);
  const searchMarkerRef = useRef<HTMLSpanElement>(null);
  // Mirrored into a ref so the Cmd/F listener (keyed only on `active`) reads the
  // live open/collapsed state without re-subscribing.
  const searchOpenRef = useRef(false);
  useEffect(() => {
    searchOpenRef.current = searchOpen;
  }, [searchOpen]);
  // Opening the bar via Cmd/Ctrl+F focuses and selects the input so typing or a
  // paste continues straight in.
  useEffect(() => {
    if (!searchOpen) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [searchOpen]);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startRatio: number;
    width: number;
    target: HTMLDivElement;
  } | null>(null);
  const pendingRatio = useRef<number | null>(null);
  const splitFrame = useRef<number | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const lastWidths = useRef<[number | null, number | null]>([null, null]);
  const rowNodes = useRef(new Map<string, HTMLDivElement>());
  const rowCallbacks = useRef(
    new Map<string, (node: HTMLDivElement | null) => void>(),
  );
  const raf = useRef<number | null>(null);
  const pendingTop = useRef(0);
  const virtualizerRef = useRef<VirtualizerState<CodeRow | SplitRow> | null>(
    null,
  );
  if (!virtualizerRef.current || virtualizerRef.current.items !== items)
    virtualizerRef.current = makeVirtualizer<CodeRow | SplitRow>(items);

  // Preserve the exact query: no trimming, so surrounding whitespace keeps its
  // meaning (including a pure-whitespace needle) and only an empty string means
  // "no search".
  const searchNeedle = search.toLowerCase();
  const matches = useMemo(() => {
    if (!searchNeedle) return [] as Occurrence[];
    const found: Occurrence[] = [];
    items.forEach((item, index) => {
      itemSegments(item).forEach((segment, seg) => {
        for (const span of findSpans(segment.toLowerCase(), searchNeedle))
          found.push({ item: index, seg, start: span.start });
      });
    });
    return found;
  }, [items, searchNeedle]);
  const matchItems = useMemo(
    () => new Set(matches.map((match) => match.item)),
    [matches],
  );
  const currentOccurrence =
    matches.length > 0
      ? matches[Math.min(searchCursor, matches.length - 1)]
      : null;
  const currentItem = currentOccurrence?.item ?? -1;

  const scrollToMatch = useCallback((index: number) => {
    const virtualizer = virtualizerRef.current;
    const viewport = leftViewport.current;
    if (!virtualizer || !viewport) return;
    if (index < 0 || index >= virtualizer.items.length) return;
    viewport.scrollTop = Math.max(0, virtualizer.index.prefix(index) - 8);
  }, []);

  const goToCursor = useCallback(
    (cursor: number) => {
      setSearchCursor(cursor);
      const occurrence = matches[cursor];
      if (occurrence) scrollToMatch(occurrence.item);
    },
    [matches, scrollToMatch],
  );

  const nextMatch = useCallback(() => {
    if (matches.length === 0) return;
    goToCursor(
      (Math.min(searchCursor, matches.length - 1) + 1) % matches.length,
    );
  }, [matches.length, searchCursor, goToCursor]);

  const prevMatch = useCallback(() => {
    if (matches.length === 0) return;
    goToCursor(
      (Math.min(searchCursor, matches.length - 1) - 1 + matches.length) %
        matches.length,
    );
  }, [matches.length, searchCursor, goToCursor]);

  // Resetting to the first hit whenever the query OR the compared content/layout
  // changes keeps the count, current highlight and location consistent. Without
  // this, moving to a diff with fewer matches leaves the cursor past the end, so
  // the label reads 2/2 while the highlight sits on the first hit.
  useEffect(() => {
    setSearchCursor(0);
  }, [searchNeedle, items]);
  // A fresh query scrolls the first hit into view so long diffs don't land the
  // user on an unrelated screen.
  useEffect(() => {
    if (searchNeedle && matches.length > 0) scrollToMatch(matches[0].item);
  }, [searchNeedle, matches, scrollToMatch]);

  // Common find shortcut. Only active diffs claim the key, so a hidden view or a
  // collapsed <details> never steals it. A view can hold several active diffs at
  // once (a conflict shows both sides), so the first active search box in DOM
  // order owns the shortcut and the rest stand down — Cmd+F lands in a
  // deterministic, visible target instead of every listener fighting for focus.
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        (event.key === "f" || event.key === "F")
      ) {
        const first = document.querySelector<HTMLElement>(
          "[data-find-shortcut]",
        );
        // The entry ref points at the hidden marker while collapsed and the bar
        // while open, and each active diff renders exactly one such element, so
        // the first match in DOM order owns the shortcut and the rest stand down.
        const mine = searchOpenRef.current
          ? searchBarRef.current
          : searchMarkerRef.current;
        if (first !== mine) return;
        event.preventDefault();
        if (searchOpenRef.current) {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        } else {
          setSearchOpen(true);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);

  const initialMetrics = { top: 0, height: 600, revision: 0 };
  const [metrics, setMetrics] = useState(initialMetrics);
  const metricsRef = useRef(metrics);

  const publishMetrics = useCallback(
    (top: number, height: number, force = false) => {
      const current = metricsRef.current;
      const next = {
        top: Math.max(0, top),
        height: height > 0 ? height : current.height,
        revision: current.revision + 1,
      };
      if (!force && next.top === current.top && next.height === current.height)
        return;
      metricsRef.current = next;
      setMetrics(next);
    },
    [],
  );

  const applySplitRatio = useCallback((ratio: number) => {
    const next = clampSplitRatio(ratio);
    splitRatioRef.current = next;
    splitRoot.current?.style.setProperty("--diff-left-track", `${next}fr`);
    splitRoot.current?.style.setProperty("--diff-right-track", `${1 - next}fr`);
    divider.current?.setAttribute(
      "aria-valuenow",
      String(Math.round(next * 100)),
    );
  }, []);

  const commitSplitRatio = useCallback(
    (ratio: number) => {
      const next = Number(clampSplitRatio(ratio).toFixed(4));
      applySplitRatio(next);
      setSplitRatio(next);
      try {
        localStorage.setItem(SPLIT_RATIO_KEY, String(next));
      } catch {
        /* 当前窗口仍可调整。 */
      }
    },
    [applySplitRatio],
  );

  const finishSplitDrag = useCallback(
    (accept: boolean) => {
      const current = drag.current;
      if (!current) return;
      if (splitFrame.current !== null) cancelAnimationFrame(splitFrame.current);
      splitFrame.current = null;
      const desired = pendingRatio.current;
      pendingRatio.current = null;
      drag.current = null;
      splitRoot.current?.removeAttribute("data-resizing");
      if (accept) commitSplitRatio(desired ?? current.startRatio);
      else applySplitRatio(current.startRatio);
      if (current.target.hasPointerCapture?.(current.pointerId))
        current.target.releasePointerCapture(current.pointerId);
    },
    [applySplitRatio, commitSplitRatio],
  );

  useLayoutEffect(() => {
    if (renderLayout === "split") applySplitRatio(splitRatio);
    else finishSplitDrag(false);
  }, [applySplitRatio, finishSplitDrag, renderLayout, splitRatio]);

  useEffect(() => {
    const cancel = () => finishSplitDrag(false);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("blur", cancel);
      if (splitFrame.current !== null) cancelAnimationFrame(splitFrame.current);
      splitFrame.current = null;
      const current = drag.current;
      drag.current = null;
      pendingRatio.current = null;
      if (current?.target.hasPointerCapture?.(current.pointerId))
        current.target.releasePointerCapture(current.pointerId);
    };
  }, [finishSplitDrag]);

  const onDividerPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !splitRoot.current) return;
      event.preventDefault();
      finishSplitDrag(false);
      const width = splitRoot.current.clientWidth - 6;
      if (width <= 0) return;
      drag.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startRatio: splitRatioRef.current,
        width,
        target: event.currentTarget,
      };
      splitRoot.current.setAttribute("data-resizing", "true");
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [finishSplitDrag],
  );

  const onDividerPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      event.preventDefault();
      pendingRatio.current = clampSplitRatio(
        current.startRatio + (event.clientX - current.startX) / current.width,
      );
      if (splitFrame.current !== null) return;
      splitFrame.current = requestAnimationFrame(() => {
        splitFrame.current = null;
        if (pendingRatio.current !== null)
          applySplitRatio(pendingRatio.current);
      });
    },
    [applySplitRatio],
  );

  const onDividerPointerEnd = useCallback(
    (event: PointerEvent<HTMLDivElement>, accept: boolean) => {
      if (drag.current?.pointerId === event.pointerId) finishSplitDrag(accept);
    },
    [finishSplitDrag],
  );

  const onDividerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        if (drag.current) {
          event.preventDefault();
          finishSplitDrag(false);
        }
        return;
      }
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      event.preventDefault();
      const ratio =
        event.key === "Home"
          ? MIN_SPLIT_RATIO
          : event.key === "End"
            ? MAX_SPLIT_RATIO
            : splitRatioRef.current +
              (event.key === "ArrowRight" ? 0.02 : -0.02);
      commitSplitRatio(ratio);
    },
    [commitSplitRatio, finishSplitDrag],
  );

  const getRowRef = useCallback((index: number, side: number) => {
    const key = `${index}:${side}`;
    let callback = rowCallbacks.current.get(key);
    if (!callback) {
      callback = (node) => {
        const previous = rowNodes.current.get(key);
        if (previous === node) return;
        if (previous) {
          observerRef.current?.unobserve(previous);
          rowNodes.current.delete(key);
        }
        if (node) {
          rowNodes.current.set(key, node);
          observerRef.current?.observe(node);
        } else {
          rowCallbacks.current.delete(key);
        }
      };
      rowCallbacks.current.set(key, callback);
    }
    return callback;
  }, []);

  const syncScrollTop = useCallback(
    (top: number) => {
      for (const ref of viewports) {
        const viewport = ref.current;
        if (viewport && Math.abs(viewport.scrollTop - top) > 0.5)
          viewport.scrollTop = top;
      }
    },
    [viewports],
  );

  const onScroll = useCallback(
    (top: number, side: number) => {
      const other = viewports[1 - side]?.current;
      if (other && Math.abs(other.scrollTop - top) > 0.5) other.scrollTop = top;
      pendingTop.current = top;
      if (raf.current !== null) return;
      raf.current = requestAnimationFrame(() => {
        raf.current = null;
        publishMetrics(pendingTop.current, metricsRef.current.height);
      });
    },
    [publishMetrics, viewports],
  );

  useLayoutEffect(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    pendingTop.current = 0;
    syncScrollTop(0);
    const viewportHeight = viewports[0].current?.clientHeight ?? 0;
    publishMetrics(0, viewportHeight || 600, true);
    const observer = observerRef.current;
    if (observer) {
      // The index was reset for these items. Re-observe mounted rows so
      // unchanged natural heights are reported into the new index as well.
      for (const row of rowNodes.current.values()) {
        observer.unobserve?.(row);
        observer.observe(row);
      }
    }
  }, [items, renderLayout, publishMetrics, syncScrollTop, viewports]);

  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const viewEntries = entries.filter((entry) =>
        viewports.some((ref) => ref.current === entry.target),
      );
      let widthChanged = false;
      let viewportHeight = metricsRef.current.height;
      for (const entry of viewEntries) {
        const side = viewports.findIndex((ref) => ref.current === entry.target);
        const width = entry.contentRect.width;
        if (width > 0) {
          const previous = lastWidths.current[side];
          if (previous !== null && Math.abs(previous - width) > 0.5)
            widthChanged = true;
          lastWidths.current[side] = width;
        }
        if (side === 0 && entry.contentRect.height > 0)
          viewportHeight = entry.contentRect.height;
      }

      const state = virtualizerRef.current;
      if (!state) return;
      const viewport = viewports[0].current;
      const scrollTop = viewport?.scrollTop ?? metricsRef.current.top;
      const anchor = state.index.anchorAt(scrollTop);
      if (widthChanged) {
        state.index.reset();
        if (state.generation === 0xffff_ffff) {
          state.sideGenerations[0].fill(0);
          state.sideGenerations[1].fill(0);
          state.generation = 1;
        } else {
          state.generation++;
        }
        if (raf.current !== null) cancelAnimationFrame(raf.current);
        raf.current = null;
      }

      const rowEntries = entries.filter((entry) =>
        entry.target.hasAttribute("data-virtual-index"),
      );
      let changed = widthChanged;
      const updates = new Map<number, [number | null, number | null]>();
      for (const entry of rowEntries) {
        const target = entry.target as HTMLElement;
        const index = Number(target.dataset.virtualIndex);
        const side = Number(target.dataset.virtualSide);
        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >= state.items.length ||
          (side !== 0 && side !== 1) ||
          entry.contentRect.height <= 0
        )
          continue;
        const pair = updates.get(index) ?? [null, null];
        pair[side] = Math.max(
          BASE_ROW_HEIGHT,
          Math.ceil(entry.contentRect.height),
        );
        updates.set(index, pair);
      }

      for (const [index, sides] of updates) {
        for (const side of [0, 1] as const) {
          if (sides[side] !== null) {
            state.sideHeights[side][index] = sides[side]!;
            state.sideGenerations[side][index] = state.generation;
          }
        }
        const leftHeight =
          state.sideGenerations[0][index] === state.generation
            ? state.sideHeights[0][index]
            : BASE_ROW_HEIGHT;
        const rightHeight =
          state.sideGenerations[1][index] === state.generation
            ? state.sideHeights[1][index]
            : BASE_ROW_HEIGHT;
        const pairHeight = Math.max(leftHeight, rightHeight);
        changed = state.index.setHeight(index, pairHeight) || changed;
      }
      if (changed) {
        const nextTop = state.index.offsetForAnchor(anchor);
        pendingTop.current = nextTop;
        if (Math.abs(nextTop - scrollTop) > 0.5) syncScrollTop(nextTop);
        publishMetrics(nextTop, viewportHeight, true);
      } else if (viewportHeight !== metricsRef.current.height) {
        publishMetrics(scrollTop, viewportHeight, true);
      }
    });

    observerRef.current = observer;
    viewports.forEach((ref) => {
      const viewport = ref.current;
      if (!viewport) return;
      observer.observe(viewport);
      viewport
        .querySelectorAll<HTMLElement>("[data-virtual-index]")
        .forEach((row) => observer.observe(row));
    });
    return () => {
      observer.disconnect();
      if (observerRef.current === observer) observerRef.current = null;
      lastWidths.current = [null, null];
    };
  }, [renderLayout, publishMetrics, syncScrollTop, viewports]);

  useLayoutEffect(
    () => () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      observerRef.current?.disconnect();
      rowNodes.current.clear();
      rowCallbacks.current.clear();
    },
    [],
  );

  const state = virtualizerRef.current;
  const visible = state.index.range(metrics.top, metrics.height, OVERSCAN);
  const rowStyle = (index: number) => ({
    top: state.index.prefix(index),
    minHeight: state.index.heightAt(index),
  });

  // Highlight one searchable segment of an item, marking the active occurrence
  // (matched by item, segment and its offset within the segment).
  const renderSegment = (index: number, seg: number, text: string) => {
    const currentStart =
      currentOccurrence &&
      currentOccurrence.item === index &&
      currentOccurrence.seg === seg
        ? currentOccurrence.start
        : -1;
    return highlightOccurrences(text, searchNeedle, currentStart);
  };

  const closeSearch = () => {
    // Closing is a full reset boundary: drop any in-flight IME composition so a
    // stray compositionEnd from the now-unmounted input can't leak composing
    // state (or a stale query) into the next open. Real IME ordering still needs
    // native verification.
    composing.current = false;
    setComposingValue(null);
    setSearch("");
    setSearchOpen(false);
  };

  const searchBar =
    items.length > 0 &&
    (searchOpen ? (
      <div
        className="diff-search"
        role="search"
        ref={searchBarRef}
        data-find-shortcut={active ? "" : undefined}
        onKeyDown={(event) => {
          // Esc collapses the bar from any focus position (the input or a
          // navigation/close button) and must not bubble to the app's global
          // "close detail" shortcut. The IME guard lets an unfinished
          // composition pass Esc through to the input method instead.
          if (event.key !== "Escape") return;
          if (event.nativeEvent.isComposing || composing.current) return;
          event.stopPropagation();
          closeSearch();
        }}
      >
        <Icon name="search" size={15} />
        <input
          ref={searchInputRef}
          className="diff-search-input"
          type="text"
          value={inputValue}
          spellCheck={false}
          placeholder={t("在差异中搜索")}
          aria-label={t("在差异中搜索")}
          onChange={(event) => {
            // While an IME composition is in flight, show the in-progress text but
            // don't run the query yet, so matches stay stable until it commits.
            if (composing.current) setComposingValue(event.target.value);
            else setSearch(event.target.value);
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={(event) => {
            // Only commit a live composition; a late compositionEnd that arrives
            // after closeSearch already cancelled the composition must not
            // resurrect a query on the (possibly reopened) input.
            if (!composing.current) return;
            composing.current = false;
            setComposingValue(null);
            setSearch(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            // Swallow Enter mid-composition so the IME can commit the candidate
            // instead of jumping between matches. Esc is handled on the bar so it
            // also covers focus sitting on a navigation button.
            if (event.nativeEvent.isComposing || composing.current) return;
            if (event.key === "Enter") {
              event.preventDefault();
              if (event.shiftKey) prevMatch();
              else nextMatch();
            }
          }}
        />
        {search.length > 0 && (
          <span className="diff-search-count" aria-live="polite">
            {matches.length > 0
              ? `${Math.min(searchCursor, matches.length - 1) + 1} / ${matches.length}`
              : t("无匹配")}
          </span>
        )}
        <button
          type="button"
          className="diff-search-btn"
          onClick={prevMatch}
          disabled={matches.length === 0}
          aria-label={t("上一个匹配")}
          title={t("上一个匹配（Shift+Enter）")}
        >
          <Icon name="up" size={16} />
        </button>
        <button
          type="button"
          className="diff-search-btn"
          onClick={nextMatch}
          disabled={matches.length === 0}
          aria-label={t("下一个匹配")}
          title={t("下一个匹配（Enter）")}
        >
          <Icon name="down" size={16} />
        </button>
        {search && (
          <button
            type="button"
            className="diff-search-btn diff-search-clear"
            onClick={() => setSearch("")}
            aria-label={t("清除搜索")}
            title={t("清除搜索")}
          >
            <Icon name="close" size={15} />
          </button>
        )}
        <button
          type="button"
          className="diff-search-btn diff-search-close"
          onClick={closeSearch}
          aria-label={t("关闭搜索")}
          title={t("关闭搜索（Esc）")}
        >
          <Icon name="close" size={15} />
        </button>
      </div>
    ) : active ? (
      // Collapsed renders nothing visible — just a zero-footprint marker so the
      // Cmd/F first-owner logic can still locate this diff in DOM order.
      <span
        ref={searchMarkerRef}
        className="diff-search-marker"
        data-find-shortcut=""
        aria-hidden="true"
      />
    ) : null);

  if (renderLayout === "unified")
    return (
      <>
        {searchBar}
        <div
          className={
            "code-viewport code-diff-viewport unified-code" +
            (includeMetadata ? " raw-patch-viewport" : "") +
            (rawLines ? " raw-code-viewport" : "")
          }
          ref={leftViewport}
          tabIndex={0}
          aria-label={ariaLabel ?? t("统一代码差异")}
          onScroll={(e) => onScroll(e.currentTarget.scrollTop, 0)}
        >
          <div className="code-spacer" style={{ height: visible.totalHeight }}>
            {visibleRows
              .slice(visible.start, visible.end)
              .map((row, offset) => {
                const index = visible.start + offset;
                const isPatch = isPatchRow(row);
                const kind = isPatch ? row.kind : "source";
                const searchState =
                  index === currentItem
                    ? "current"
                    : matchItems.has(index)
                      ? "match"
                      : undefined;
                return (
                  <div
                    key={index}
                    className={`virtual-code-row code-line-slot ${kind}`}
                    data-search={searchState}
                    style={rowStyle(index)}
                  >
                    <div
                      ref={getRowRef(index, 0)}
                      data-virtual-index={index}
                      data-virtual-side={0}
                      className={`code-row code-line-measure ${kind}`}
                    >
                      {isPatch ? (
                        lineNumber(row.a, "before")
                      ) : (
                        <span className="line-number">{row.line}</span>
                      )}
                      {isPatch && lineNumber(row.b, "after")}
                      <span className="code-text">
                        {codeMarker(row)}
                        {renderSegment(index, 0, itemSegments(row)[0] ?? "")}
                      </span>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </>
    );

  return (
    <>
      {searchBar}
      <div className="split-editor code-diff-split" ref={splitRoot}>
        {[0, 1].map((side) => (
          <section className="split-side" key={side}>
            <div className="split-label">{labels[side]}</div>
            <div
              className="code-viewport code-diff-viewport"
              ref={viewports[side]}
              tabIndex={0}
              aria-label={labels[side]}
              onScroll={(e) => onScroll(e.currentTarget.scrollTop, side)}
            >
              <div
                className="code-spacer"
                style={{ height: visible.totalHeight }}
              >
                {split.slice(visible.start, visible.end).map((pair, offset) => {
                  const index = visible.start + offset;
                  const row = side === 0 ? pair.left : pair.right;
                  const searchState =
                    index === currentItem
                      ? "current"
                      : matchItems.has(index)
                        ? "match"
                        : undefined;
                  const segments = itemSegments(pair);
                  const segIdx = pair.meta != null ? 0 : side;
                  const segText = segments[segIdx] ?? "";
                  return (
                    <div
                      className={
                        "virtual-code-row code-line-slot " +
                        (row?.kind ?? (pair.meta ? "meta" : "spacer"))
                      }
                      data-search={searchState}
                      key={index}
                      style={rowStyle(index)}
                    >
                      <div
                        ref={getRowRef(index, side)}
                        data-virtual-index={index}
                        data-virtual-side={side}
                        className={
                          "code-row code-line-measure " +
                          (row?.kind ?? (pair.meta ? "meta" : "spacer"))
                        }
                      >
                        {lineNumber(
                          row ? (side === 0 ? row.a : row.b) : "",
                          side === 0 ? "before" : "after",
                        )}
                        <span className="code-text">
                          {renderSegment(index, segIdx, segText)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        ))}
        <div
          ref={divider}
          className="code-diff-divider"
          role="separator"
          aria-label={t("调整左右差异宽度")}
          aria-orientation="vertical"
          aria-valuemin={25}
          aria-valuemax={75}
          aria-valuenow={Math.round(splitRatio * 100)}
          tabIndex={0}
          onPointerDown={onDividerPointerDown}
          onPointerMove={onDividerPointerMove}
          onPointerUp={(event) => onDividerPointerEnd(event, true)}
          onPointerCancel={(event) => onDividerPointerEnd(event, false)}
          onLostPointerCapture={(event) => onDividerPointerEnd(event, false)}
          onKeyDown={onDividerKeyDown}
        />
      </div>
    </>
  );
}

export function CodeLines({
  lines,
  label,
  active,
}: {
  lines: ConflictLine[];
  label: string;
  active?: boolean;
}) {
  return <CodeDiff rawLines={lines} ariaLabel={label} active={active} />;
}
