// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeDiff } from "./CodeDiff";
import { DiffView } from "./DiffView";

class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();

  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this);
  }

  emit(entries: Array<{ target: Element; width: number; height: number }>) {
    this.callback(
      entries.map(
        ({ target, width, height }) =>
          ({
            target,
            contentRect: { width, height },
          }) as ResizeObserverEntry,
      ),
      this as unknown as ResizeObserver,
    );
  }
}

beforeEach(() => {
  localStorage.clear();
  TestResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.stubGlobal(
    "PointerEvent",
    class extends MouseEvent {
      pointerId = 1;
    },
  );
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  TestResizeObserver.instances = [];
});

describe("CodeDiff 变高换行", () => {
  it("大差异只挂载当前视口附近的行", () => {
    const patch = [
      "@@ -1,5000 +1,5000 @@",
      ...Array.from({ length: 5_000 }, (_, index) => ` context ${index}`),
    ].join("\n");
    const { container } = render(
      <div className="diff-result">
        <CodeDiff patch={patch} layout="unified" />
      </div>,
    );

    expect(container.querySelectorAll(".virtual-code-row").length).toBeLessThan(
      40,
    );
  });

  it("大冲突只挂载可见原始行，保留真实行号与空行", () => {
    const lines = Array.from({ length: 10_000 }, (_, index) => ({
      line: 700 + index,
      text: index === 1 ? "" : `冲突代码 ${index}`,
    }));
    const { container } = render(
      <div className="diff-result">
        <DiffView
          data={{
            patch: "",
            truncated: false,
            binary: false,
            note: null,
            conflict: {
              kind: "内容冲突",
              note: null,
              blocks: [
                {
                  startLine: 700,
                  endLine: 10_699,
                  ours: lines,
                  base: [],
                  theirs: lines,
                  incoming: "feature",
                },
              ],
            },
          }}
        />
      </div>,
    );

    const viewports = Array.from(
      container.querySelectorAll<HTMLElement>(".raw-code-viewport"),
    );
    expect(viewports).toHaveLength(2);
    for (const viewport of viewports) {
      expect(
        viewport.querySelectorAll(".virtual-code-row").length,
      ).toBeLessThan(40);
      const firstRow = viewport.querySelector<HTMLElement>(
        '[data-virtual-index="0"].code-row',
      )!;
      expect(firstRow.querySelectorAll(".line-number")).toHaveLength(1);
      expect(firstRow.querySelector(".line-number")?.textContent).toBe("700");
      expect(firstRow.classList.contains("add")).toBe(false);
      expect(firstRow.classList.contains("remove")).toBe(false);
      expect(
        viewport.querySelector('[data-virtual-index="1"] .code-text')
          ?.textContent,
      ).toBe("");
    }
  });

  it("左右配对行共享实测最大高度，并在隐藏恢复时保留测量", () => {
    const { container, unmount } = render(
      <div className="diff-result">
        <CodeDiff patch={"@@ -8,1 +17,1 @@\n-old\n+new"} layout="split" />
      </div>,
    );
    const observer = TestResizeObserver.instances[0];
    const viewports = Array.from(
      container.querySelectorAll<HTMLElement>(".code-diff-viewport"),
    );
    const left = container.querySelector<HTMLElement>(
      '[data-virtual-index="1"][data-virtual-side="0"]',
    )!;
    const right = container.querySelector<HTMLElement>(
      '[data-virtual-index="1"][data-virtual-side="1"]',
    )!;

    expect(left.querySelector(".line-number")?.textContent).toBe("8");
    expect(right.querySelector(".line-number")?.textContent).toBe("17");
    act(() => {
      observer.emit([
        { target: viewports[0], width: 500, height: 300 },
        { target: viewports[1], width: 500, height: 300 },
      ]);
      observer.emit([
        { target: left, width: 200, height: 48 },
        { target: right, width: 200, height: 72 },
      ]);
    });
    expect(left.parentElement!.style.minHeight).toBe("72px");
    expect(right.parentElement!.style.minHeight).toBe("72px");

    act(() => {
      observer.emit([
        { target: viewports[0], width: 0, height: 0 },
        { target: viewports[1], width: 0, height: 0 },
      ]);
      observer.emit([
        { target: viewports[0], width: 500, height: 300 },
        { target: viewports[1], width: 500, height: 300 },
      ]);
    });
    expect(left.parentElement!.style.minHeight).toBe("72px");

    act(() => {
      observer.emit([{ target: viewports[0], width: 460, height: 300 }]);
    });
    expect(left.parentElement!.style.minHeight).toBe("24px");
    expect(right.parentElement!.style.minHeight).toBe("24px");

    unmount();
    expect(observer.disconnect).toHaveBeenCalled();
  });

  it("同批宽度和自然行高变化会立即更新，变宽可以缩回高度", () => {
    const { container } = render(
      <div className="diff-result">
        <CodeDiff patch={"@@ -1,1 +1,1 @@\n-old\n+new"} layout="split" />
      </div>,
    );
    const observer = TestResizeObserver.instances[0];
    const viewport = container.querySelector<HTMLElement>(
      ".code-diff-viewport",
    )!;
    const row = container.querySelector<HTMLElement>(
      '[data-virtual-index="1"][data-virtual-side="0"]',
    )!;
    act(() =>
      observer.emit([
        { target: viewport, width: 500, height: 300 },
        { target: row, width: 500, height: 48 },
      ]),
    );
    act(() =>
      observer.emit([
        { target: viewport, width: 300, height: 300 },
        { target: row, width: 300, height: 120 },
      ]),
    );
    expect(row.parentElement!.style.minHeight).toBe("120px");
    act(() =>
      observer.emit([
        { target: viewport, width: 600, height: 300 },
        { target: row, width: 600, height: 24 },
      ]),
    );
    expect(row.parentElement!.style.minHeight).toBe("24px");
  });

  it.each(["unified", "split"] as const)(
    "替换后重测复用的长行并保留下一行位置（%s）",
    (layout) => {
      const patchFor = (tail: string) =>
        `@@ -10,2 +20,2 @@\n ${"long text ".repeat(20)}\n ${tail}`;
      const { container, rerender } = render(
        <div className="diff-result">
          <CodeDiff patch={patchFor("tail")} layout={layout} />
        </div>,
      );
      const observer = TestResizeObserver.instances[0];
      const viewports = Array.from(
        container.querySelectorAll<HTMLElement>(".code-diff-viewport"),
      );
      const rowAt = (index: number, side: number) =>
        container.querySelector<HTMLElement>(
          `[data-virtual-index="${index}"][data-virtual-side="${side}"]`,
        )!;
      const topAt = (index: number, side: number) =>
        rowAt(index, side).parentElement!.style.top;
      const leftLong = rowAt(1, 0);
      const rightLong = layout === "split" ? rowAt(1, 1) : null;
      expect(leftLong.querySelectorAll(".line-number")[0]?.textContent).toBe(
        "10",
      );
      if (rightLong)
        expect(rightLong.querySelector(".line-number")?.textContent).toBe("20");
      act(() =>
        observer.emit([
          ...viewports.map((target) => ({
            target,
            width: 500,
            height: 300,
          })),
          { target: leftLong, width: 300, height: 96 },
          ...(rightLong ? [{ target: rightLong, width: 200, height: 72 }] : []),
        ]),
      );
      expect(topAt(2, 0)).toBe("120px");
      if (layout === "split") expect(topAt(2, 1)).toBe("120px");

      const observedBefore = observer.observe.mock.calls.filter(
        ([node]) => node === leftLong,
      ).length;
      const unobservedBefore = observer.unobserve.mock.calls.filter(
        ([node]) => node === leftLong,
      ).length;
      rerender(
        <div className="diff-result">
          <CodeDiff patch={patchFor("tail updated")} layout={layout} />
        </div>,
      );
      const reusedLeft = rowAt(1, 0);
      expect(reusedLeft).toBe(leftLong);
      expect(
        observer.unobserve.mock.calls.filter(([node]) => node === leftLong),
      ).toHaveLength(unobservedBefore + 1);
      expect(
        observer.observe.mock.calls.filter(([node]) => node === leftLong),
      ).toHaveLength(observedBefore + 1);
      expect(topAt(2, 0)).toBe("48px");
      if (layout === "split") expect(topAt(2, 1)).toBe("48px");

      act(() =>
        observer.emit([
          { target: reusedLeft, width: 300, height: 96 },
          ...(rightLong ? [{ target: rightLong, width: 200, height: 72 }] : []),
        ]),
      );
      expect(topAt(2, 0)).toBe("120px");
      if (layout === "split") expect(topAt(2, 1)).toBe("120px");
    },
  );

  it("拖动通过 RAF 更新比例，pointerup 保存，取消或失焦恢复", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.delete(id);
    });
    const flushFrames = () => {
      const pending = [...frames.values()];
      frames.clear();
      act(() => pending.forEach((callback) => callback(0)));
    };
    let parentRenders = 0;
    function Harness() {
      parentRenders++;
      return (
        <div className="diff-result">
          <CodeDiff patch={"@@ -1,1 +1,1 @@\n-old\n+new"} layout="split" />
        </div>
      );
    }
    const { container } = render(<Harness />);
    const root = container.querySelector<HTMLElement>(".code-diff-split")!;
    Object.defineProperty(root, "clientWidth", {
      configurable: true,
      value: 1006,
    });
    const handle = screen.getByRole("separator", {
      name: "调整左右差异宽度",
    });

    expect(root.style.getPropertyValue("--diff-left-track")).toBe("0.5fr");
    fireEvent.pointerDown(handle, {
      button: 0,
      pointerId: 1,
      clientX: 500,
    });
    expect(HTMLElement.prototype.setPointerCapture).toHaveBeenCalledWith(1);
    const startRenders = parentRenders;
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 700 });
    expect(root.style.getPropertyValue("--diff-left-track")).toBe("0.5fr");
    flushFrames();
    expect(root.style.getPropertyValue("--diff-left-track")).toBe("0.7fr");
    expect(parentRenders).toBe(startRenders);
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(localStorage.getItem("oil-git.diff-split-ratio")).toBe("0.7");
    expect(handle.getAttribute("aria-valuenow")).toBe("70");

    fireEvent.pointerDown(handle, {
      button: 0,
      pointerId: 1,
      clientX: 700,
    });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 1200 });
    flushFrames();
    expect(root.style.getPropertyValue("--diff-left-track")).toBe("0.75fr");
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    expect(root.style.getPropertyValue("--diff-left-track")).toBe("0.7fr");
    expect(localStorage.getItem("oil-git.diff-split-ratio")).toBe("0.7");

    fireEvent.pointerDown(handle, {
      button: 0,
      pointerId: 1,
      clientX: 700,
    });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 600 });
    flushFrames();
    fireEvent.blur(window);
    expect(root.style.getPropertyValue("--diff-left-track")).toBe("0.7fr");
    expect(localStorage.getItem("oil-git.diff-split-ratio")).toBe("0.7");
  });

  it("分界可用键盘调整并限制在 25% 至 75%", () => {
    const { container } = render(
      <div className="diff-result">
        <CodeDiff patch={"@@ -1,1 +1,1 @@\n-old\n+new"} layout="split" />
      </div>,
    );
    const root = container.querySelector<HTMLElement>(".code-diff-split")!;
    const handle = screen.getByRole("separator", {
      name: "调整左右差异宽度",
    });

    fireEvent.keyDown(handle, { key: "Home" });
    expect(root.style.getPropertyValue("--diff-left-track")).toBe("0.25fr");
    expect(handle.getAttribute("aria-valuenow")).toBe("25");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(root.style.getPropertyValue("--diff-left-track")).toBe("0.27fr");
    fireEvent.keyDown(handle, { key: "End" });
    expect(root.style.getPropertyValue("--diff-left-track")).toBe("0.75fr");
    expect(localStorage.getItem("oil-git.diff-split-ratio")).toBe("0.75");
  });
});

const SAMPLE_PATCH = [
  "@@ -1,5 +1,5 @@",
  " keep",
  "-old foo",
  "+new foo",
  " middle",
  "-another foo",
  "+bar",
].join("\n");

// The search bar is collapsed by default, so tests that type into it open it
// through the visible toggle first (same entry a user clicks).
function openSearch() {
  fireEvent.click(screen.getByRole("button", { name: "在差异中搜索" }));
}

describe("CodeDiff 差异内搜索", () => {
  it("统一差异中高亮匹配行并显示匹配数量", () => {
    const { container } = render(
      <div className="diff-result">
        <CodeDiff patch={SAMPLE_PATCH} layout="unified" />
      </div>,
    );
    openSearch();
    fireEvent.change(screen.getByRole("textbox", { name: "在差异中搜索" }), {
      target: { value: "foo" },
    });

    expect(container.querySelectorAll("mark.diff-search-hit")).toHaveLength(3);
    expect(container.querySelectorAll('[data-search="match"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-search="current"]')).toHaveLength(
      1,
    );
    expect(container.querySelector(".diff-search-count")?.textContent).toBe(
      "1 / 3",
    );
    expect(container.querySelector("mark")?.textContent).toBe("foo");
  });

  it("上下按钮在匹配之间移动当前行，并可循环", () => {
    const { container } = render(
      <div className="diff-result">
        <CodeDiff patch={SAMPLE_PATCH} layout="unified" />
      </div>,
    );
    openSearch();
    fireEvent.change(screen.getByRole("textbox", { name: "在差异中搜索" }), {
      target: { value: "foo" },
    });
    const next = screen.getByRole("button", { name: "下一个匹配" });
    const prev = screen.getByRole("button", { name: "上一个匹配" });

    fireEvent.click(next);
    expect(container.querySelector(".diff-search-count")?.textContent).toBe(
      "2 / 3",
    );
    fireEvent.click(next);
    expect(container.querySelector(".diff-search-count")?.textContent).toBe(
      "3 / 3",
    );
    fireEvent.click(next);
    expect(container.querySelector(".diff-search-count")?.textContent).toBe(
      "1 / 3",
    );
    fireEvent.click(prev);
    expect(container.querySelector(".diff-search-count")?.textContent).toBe(
      "3 / 3",
    );
  });

  it("无匹配时禁用导航并提示", () => {
    const { container } = render(
      <div className="diff-result">
        <CodeDiff patch={SAMPLE_PATCH} layout="unified" />
      </div>,
    );
    openSearch();
    fireEvent.change(screen.getByRole("textbox", { name: "在差异中搜索" }), {
      target: { value: "zzz" },
    });
    expect(container.querySelector(".diff-search-count")?.textContent).toBe(
      "无匹配",
    );
    expect(
      (
        screen.getByRole("button", {
          name: "下一个匹配",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(container.querySelectorAll("mark")).toHaveLength(0);
  });

  it("清除查询后移除高亮与计数", () => {
    const { container } = render(
      <div className="diff-result">
        <CodeDiff patch={SAMPLE_PATCH} layout="unified" />
      </div>,
    );
    openSearch();
    fireEvent.change(screen.getByRole("textbox", { name: "在差异中搜索" }), {
      target: { value: "foo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "清除搜索" }));
    expect(container.querySelectorAll("mark")).toHaveLength(0);
    expect(container.querySelector(".diff-search-count")).toBeNull();
    expect(
      (
        screen.getByRole("textbox", {
          name: "在差异中搜索",
        }) as HTMLInputElement
      ).value,
    ).toBe("");
  });

  it("Enter 跳到下一个匹配，Shift+Enter 上一个", () => {
    const { container } = render(
      <div className="diff-result">
        <CodeDiff patch={SAMPLE_PATCH} layout="unified" />
      </div>,
    );
    openSearch();
    const input = screen.getByRole("textbox", { name: "在差异中搜索" });
    fireEvent.change(input, { target: { value: "foo" } });
    expect(container.querySelector(".diff-search-count")?.textContent).toBe(
      "1 / 3",
    );
    fireEvent.keyDown(input, { key: "Enter" });
    expect(container.querySelector(".diff-search-count")?.textContent).toBe(
      "2 / 3",
    );
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(container.querySelector(".diff-search-count")?.textContent).toBe(
      "1 / 3",
    );
  });

  it("在大差异中把当前匹配滚动进视口", () => {
    const patch = [
      "@@ -1,100 +1,100 @@",
      ...Array.from({ length: 100 }, (_, i) => ` line${i} foo`),
    ].join("\n");
    const { container } = render(
      <div className="diff-result">
        <CodeDiff patch={patch} layout="unified" />
      </div>,
    );
    const viewport = container.querySelector<HTMLElement>(
      ".code-diff-viewport",
    )!;
    openSearch();
    fireEvent.change(screen.getByRole("textbox", { name: "在差异中搜索" }), {
      target: { value: "foo" },
    });
    // Rows measure at the 24px estimate without a ResizeObserver emit, so the
    // first match (row index 1) scrolls to ~24 - 8.
    expect(viewport.scrollTop).toBe(16);
    fireEvent.click(screen.getByRole("button", { name: "下一个匹配" }));
    expect(viewport.scrollTop).toBe(40);
  });

  it("分栏差异在命中的行两侧都高亮", () => {
    const { container } = render(
      <div className="diff-result">
        <CodeDiff
          patch={"@@ -1,3 +1,3 @@\n ctx\n-old foo left\n+new foo right\n ctx2"}
          layout="split"
        />
      </div>,
    );
    openSearch();
    fireEvent.change(screen.getByRole("textbox", { name: "在差异中搜索" }), {
      target: { value: "foo" },
    });
    // Both the before and after column render the matched pair, so the hit is
    // highlighted on each side independently. data-search sits on the wrapping
    // row while data-virtual-index sits on the measured inner row.
    const innerRows = container.querySelectorAll('[data-virtual-index="2"]');
    expect(innerRows).toHaveLength(2);
    for (const inner of innerRows) {
      expect(inner.parentElement!.getAttribute("data-search")).toBe("current");
      expect(inner.querySelectorAll("mark.diff-search-hit")).toHaveLength(1);
      expect(inner.querySelector("mark")?.textContent).toBe("foo");
    }
  });

  it("内容变化时计数、当前高亮与定位保持一致", () => {
    const { container, rerender } = render(
      <div className="diff-result">
        <CodeDiff patch={SAMPLE_PATCH} layout="unified" />
      </div>,
    );
    openSearch();
    fireEvent.change(screen.getByRole("textbox", { name: "在差异中搜索" }), {
      target: { value: "foo" },
    });
    const next = screen.getByRole("button", { name: "下一个匹配" });
    // Walk to the last of the three matches.
    fireEvent.click(next);
    fireEvent.click(next);
    expect(container.querySelector(".diff-search-count")?.textContent).toBe(
      "3 / 3",
    );
    // Switch to a diff that only has two matches.
    rerender(
      <div className="diff-result">
        <CodeDiff
          patch={[
            "@@ -1,4 +1,4 @@",
            " keep",
            "-old foo",
            "+new foo",
            " middle",
          ].join("\n")}
          layout="unified"
        />
      </div>,
    );
    // The cursor resets to the first hit, so the label and the highlight agree
    // instead of reading 2/2 while sitting on the first match.
    expect(container.querySelector(".diff-search-count")?.textContent).toBe(
      "1 / 2",
    );
    const current = container.querySelector('[data-search="current"]');
    expect(current).not.toBeNull();
    expect(current?.querySelector(".code-text")?.textContent).toContain(
      "old foo",
    );
  });

  it("输入法组合输入时 Enter 不触发匹配导航", () => {
    const { container } = render(
      <div className="diff-result">
        <CodeDiff patch={SAMPLE_PATCH} layout="unified" />
      </div>,
    );
    openSearch();
    const input = screen.getByRole("textbox", {
      name: "在差异中搜索",
    }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "foo" } });
    expect(container.querySelector(".diff-search-count")?.textContent).toBe(
      "1 / 3",
    );
    // Begin an IME composition: the visible field may update, but the query must
    // not run and Enter must complete the candidate instead of navigating.
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "bar" } });
    expect(input.value).toBe("bar");
    expect(container.querySelector(".diff-search-count")?.textContent).toBe(
      "1 / 3",
    );
    fireEvent.keyDown(input, { key: "Enter" });
    expect(container.querySelector(".diff-search-count")?.textContent).toBe(
      "1 / 3",
    );
    // Committing the composition runs the search.
    fireEvent.compositionEnd(input, { target: { value: "bar" } });
    expect(container.querySelector(".diff-search-count")?.textContent).toBe(
      "1 / 1",
    );
  });

  it.each([
    {
      patch: ["@@ -1,2 +1,3 @@", " ctx", "+İfoo"].join("\n"),
      query: "foo",
      want: "foo",
    },
    {
      patch: ["@@ -1,2 +1,3 @@", " ctx", "+İ x NAME"].join("\n"),
      query: "name",
      want: "NAME",
    },
  ])("特殊大小写不把原文高亮错位（$query）", ({ patch, query, want }) => {
    cleanup();
    const { container } = render(
      <div className="diff-result">
        <CodeDiff patch={patch} layout="unified" />
      </div>,
    );
    openSearch();
    fireEvent.change(screen.getByRole("textbox", { name: "在差异中搜索" }), {
      target: { value: query },
    });
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    // A length-changing lower-case fold ("İ" → "i̇") must not shift the slice:
    // the highlight stays on the real source, not "oo" / "AME".
    expect(marks[0].textContent).toBe(want);
  });

  it("保留搜索输入的实际含义，包括两端空白与纯空白", () => {
    const patch = ["@@ -1,5 +1,5 @@", " keep", " foobar", "+foo bar"].join(
      "\n",
    );
    const { container } = render(
      <div className="diff-result">
        <CodeDiff patch={patch} layout="unified" />
      </div>,
    );
    openSearch();
    const input = screen.getByRole("textbox", { name: "在差异中搜索" });
    // A trailing space is significant: "foo " matches "foo bar" but not "foobar".
    fireEvent.change(input, { target: { value: "foo " } });
    expect(container.querySelector(".diff-search-count")?.textContent).toBe(
      "1 / 1",
    );
    // A pure-whitespace query still searches instead of being treated as empty:
    // a numeric count appears rather than the control collapsing to no search.
    fireEvent.change(input, { target: { value: " " } });
    expect(container.querySelector(".diff-search-count")?.textContent).toMatch(
      /^\d+ \/ \d+$/,
    );
    // An empty query shows no count at all.
    fireEvent.change(input, { target: { value: "" } });
    expect(container.querySelector(".diff-search-count")).toBeNull();
  });

  it("统一差异按源码匹配，不把控制标记算作源码", () => {
    const patch = [
      "@@ -1,5 +1,5 @@",
      " keep",
      "-old foo",
      "+new foo",
      " middle",
    ].join("\n");
    const { container } = render(
      <div className="diff-result">
        <CodeDiff patch={patch} layout="unified" />
      </div>,
    );
    openSearch();
    const input = screen.getByRole("textbox", { name: "在差异中搜索" });
    // Searching the marker joined to the code must not hit the source line.
    fireEvent.change(input, { target: { value: "+new" } });
    expect(container.querySelector(".diff-search-count")?.textContent).toBe(
      "无匹配",
    );
    expect(container.querySelectorAll("mark")).toHaveLength(0);
    // The code itself is still found.
    fireEvent.change(input, { target: { value: "new" } });
    expect(container.querySelector(".diff-search-count")?.textContent).toBe(
      "1 / 1",
    );
  });

  it("同一行的多个匹配按出现次数计数与导航", () => {
    const patch = ["@@ -1,2 +1,3 @@", " keep", "+foo foo foo"].join("\n");
    const { container } = render(
      <div className="diff-result">
        <CodeDiff patch={patch} layout="unified" />
      </div>,
    );
    openSearch();
    fireEvent.change(screen.getByRole("textbox", { name: "在差异中搜索" }), {
      target: { value: "foo" },
    });
    // Three hits on one line report three, not one.
    expect(container.querySelector(".diff-search-count")?.textContent).toBe(
      "1 / 3",
    );
    expect(container.querySelectorAll("mark")).toHaveLength(3);
    const currentMarks = () =>
      container.querySelectorAll("mark.diff-search-hit-current");
    expect(currentMarks()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "下一个匹配" }));
    expect(container.querySelector(".diff-search-count")?.textContent).toBe(
      "2 / 3",
    );
    expect(currentMarks()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "下一个匹配" }));
    expect(container.querySelector(".diff-search-count")?.textContent).toBe(
      "3 / 3",
    );
    expect(currentMarks()).toHaveLength(1);
  });

  it("默认收起，Cmd+F 打开并聚焦，再次按下选中文本", () => {
    render(
      <div className="diff-result">
        <CodeDiff patch={SAMPLE_PATCH} layout="unified" active />
      </div>,
    );
    // Collapsed by default: only the toggle shows, no textbox yet.
    expect(screen.queryByRole("textbox", { name: "在差异中搜索" })).toBeNull();
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    // Cmd+F opens the bar and focuses the input.
    const input = screen.getByRole("textbox", {
      name: "在差异中搜索",
    }) as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    // Typing a query, then Cmd+F again, selects it so typing replaces it.
    fireEvent.change(input, { target: { value: "foo" } });
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("foo".length);
  });

  it("隐藏差异不抢 Cmd+F 键盘事件", () => {
    const { container } = render(
      <div className="diff-result">
        <CodeDiff patch={SAMPLE_PATCH} layout="unified" />
      </div>,
    );
    // Not active and collapsed: there is no shortcut owner at all.
    expect(container.querySelectorAll("[data-find-shortcut]")).toHaveLength(0);
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    // The inactive view never opens its bar or steals focus.
    expect(screen.queryByRole("textbox", { name: "在差异中搜索" })).toBeNull();
  });

  it("纯新增行在双栏只归属右侧（变更后），左侧（变更前）保持为空", () => {
    const { container } = render(
      <div className="diff-result">
        <CodeDiff patch={"@@ -0,0 +1,2 @@\n+first\n+second"} layout="split" />
      </div>,
    );
    // The before column (side 0) stays empty for the added lines.
    expect(
      container.querySelector(
        '[data-virtual-index="1"][data-virtual-side="0"] .code-text',
      )?.textContent,
    ).toBe("");
    expect(
      container.querySelector(
        '[data-virtual-index="2"][data-virtual-side="0"] .code-text',
      )?.textContent,
    ).toBe("");
    // The after column (side 1) holds the added source.
    expect(
      container.querySelector(
        '[data-virtual-index="1"][data-virtual-side="1"] .code-text',
      )?.textContent,
    ).toBe("first");
    expect(
      container.querySelector(
        '[data-virtual-index="2"][data-virtual-side="1"] .code-text',
      )?.textContent,
    ).toBe("second");
    // Search respects the same attribution: the hit lands on the after column.
    openSearch();
    fireEvent.change(screen.getByRole("textbox", { name: "在差异中搜索" }), {
      target: { value: "first" },
    });
    expect(
      container.querySelector(
        '[data-virtual-index="1"][data-virtual-side="1"] mark',
      )?.textContent,
    ).toBe("first");
    expect(
      container.querySelector(
        '[data-virtual-index="1"][data-virtual-side="0"] mark',
      ),
    ).toBeNull();
  });

  it("大小写展开字符的部分匹配高亮整个原文，且展示原文一字不变", () => {
    const { container } = render(
      <div className="diff-result">
        <CodeDiff patch={"@@ -1,2 +1,3 @@\n ctx\n+İfoo"} layout="unified" />
      </div>,
    );
    openSearch();
    fireEvent.change(screen.getByRole("textbox", { name: "在差异中搜索" }), {
      target: { value: "i" },
    });
    // "İ" folds to "i̇"; matching just its "i" must still highlight the whole
    // "İ", never an empty mark.
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("İ");
    // The displayed source (marker + İfoo) is unchanged.
    expect(marks[0].closest(".code-text")?.textContent).toBe("+İfoo");
  });
});

const CONFLICT_DIFF = {
  patch: "@@ -1,3 +1,3 @@\n ctx\n-old\n+new\n ctx2",
  truncated: false,
  binary: false,
  note: null,
  conflict: {
    kind: "内容冲突",
    note: null,
    blocks: [
      {
        startLine: 1,
        endLine: 3,
        ours: [
          { line: 1, text: "ctx" },
          { line: 2, text: "old ours" },
        ],
        base: [
          { line: 1, text: "ctx" },
          { line: 2, text: "base" },
        ],
        theirs: [
          { line: 1, text: "ctx" },
          { line: 2, text: "new theirs" },
        ],
        incoming: "feature",
      },
    ],
  },
};

describe("差异内搜索快捷键接入", () => {
  it("冲突双方可见差异响应 Cmd+F 打开搜索，折叠的共同起点与原始差异不抢焦点", () => {
    const { container } = render(<DiffView data={CONFLICT_DIFF} />);
    // Only the two visible sides own the shortcut (as collapsed toggles); the
    // collapsed base and the collapsed raw diff do not.
    const owners = container.querySelectorAll("[data-find-shortcut]");
    expect(owners).toHaveLength(2);
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    // Cmd+F opens the first visible owner (the "ours" side) and focuses its
    // input; the other sides stay collapsed with no input rendered.
    const inputs = container.querySelectorAll(".diff-search-input");
    expect(inputs).toHaveLength(1);
    expect(document.activeElement).toBe(inputs[0]);
  });

  it("隐藏的差异视图不响应 Cmd+F", () => {
    const { container } = render(
      <DiffView data={CONFLICT_DIFF} active={false} />,
    );
    // Not active: no shortcut owner and nothing rendered open.
    expect(container.querySelectorAll("[data-find-shortcut]")).toHaveLength(0);
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    expect(container.querySelectorAll(".diff-search-input")).toHaveLength(0);
  });

  it("展开原始差异后其搜索入口获得快捷键", () => {
    const { container } = render(<DiffView data={CONFLICT_DIFF} />);
    const rawDiff = container.querySelector(".raw-diff") as HTMLDetailsElement;
    // Collapsed: the raw diff's search toggle is not a shortcut owner.
    expect(rawDiff.querySelector("[data-find-shortcut]")).toBeNull();
    // Open the disclosure: its diff becomes active and its toggle claims it.
    rawDiff.open = true;
    fireEvent(rawDiff, new Event("toggle"));
    expect(rawDiff.querySelector("[data-find-shortcut]")).not.toBeNull();
  });
});

describe("差异内搜索栏开合", () => {
  it("默认收起：只显示搜索入口，不显示输入框与导航按钮", () => {
    const { container } = render(
      <div className="diff-result">
        <CodeDiff patch={SAMPLE_PATCH} layout="unified" />
      </div>,
    );
    expect(screen.getByRole("button", { name: "在差异中搜索" })).not.toBeNull();
    expect(screen.queryByRole("textbox", { name: "在差异中搜索" })).toBeNull();
    expect(screen.queryByRole("button", { name: "下一个匹配" })).toBeNull();
    expect(screen.queryByRole("button", { name: "关闭搜索" })).toBeNull();
    expect(container.querySelector(".diff-search-count")).toBeNull();
  });

  it("点击搜索入口展开并聚焦输入框", () => {
    render(
      <div className="diff-result">
        <CodeDiff patch={SAMPLE_PATCH} layout="unified" />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "在差异中搜索" }));
    const input = screen.getByRole("textbox", { name: "在差异中搜索" });
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole("button", { name: "下一个匹配" })).not.toBeNull();
  });

  it("关闭按钮收起搜索栏并清空查询", () => {
    const { container } = render(
      <div className="diff-result">
        <CodeDiff patch={SAMPLE_PATCH} layout="unified" />
      </div>,
    );
    openSearch();
    fireEvent.change(screen.getByRole("textbox", { name: "在差异中搜索" }), {
      target: { value: "foo" },
    });
    expect(container.querySelector(".diff-search-count")?.textContent).toBe(
      "1 / 3",
    );
    fireEvent.click(screen.getByRole("button", { name: "关闭搜索" }));
    // Bar collapses back to the toggle; the query and highlights are gone.
    expect(screen.queryByRole("textbox", { name: "在差异中搜索" })).toBeNull();
    expect(container.querySelector(".diff-search-count")).toBeNull();
    expect(container.querySelectorAll("mark")).toHaveLength(0);
    // Reopening starts from a clean slate.
    openSearch();
    expect(
      (
        screen.getByRole("textbox", {
          name: "在差异中搜索",
        }) as HTMLInputElement
      ).value,
    ).toBe("");
  });

  it("Esc 收起搜索栏并清空查询", () => {
    const { container } = render(
      <div className="diff-result">
        <CodeDiff patch={SAMPLE_PATCH} layout="unified" />
      </div>,
    );
    openSearch();
    const input = screen.getByRole("textbox", { name: "在差异中搜索" });
    fireEvent.change(input, { target: { value: "foo" } });
    expect(container.querySelectorAll("mark")).toHaveLength(3);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "在差异中搜索" })).toBeNull();
    expect(container.querySelectorAll("mark")).toHaveLength(0);
    // The toggle is back and owns the shortcut again.
    expect(screen.getByRole("button", { name: "在差异中搜索" })).not.toBeNull();
  });

  it("收起后再按 Cmd+F 能重新打开并聚焦", () => {
    render(
      <div className="diff-result">
        <CodeDiff patch={SAMPLE_PATCH} layout="unified" active />
      </div>,
    );
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    const input = screen.getByRole("textbox", { name: "在差异中搜索" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "在差异中搜索" })).toBeNull();
    // Reopen via the shortcut; focus lands back in the input.
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    const reopened = screen.getByRole("textbox", { name: "在差异中搜索" });
    expect(document.activeElement).toBe(reopened);
  });

  it.each(["下一个匹配", "上一个匹配", "清除搜索", "关闭搜索"])(
    "焦点在「%s」按钮上时 Esc 收起搜索栏，且不冒泡到外层",
    (label) => {
      const { container } = render(
        <div className="diff-result">
          <CodeDiff patch={SAMPLE_PATCH} layout="unified" />
        </div>,
      );
      openSearch();
      fireEvent.change(screen.getByRole("textbox", { name: "在差异中搜索" }), {
        target: { value: "foo" },
      });
      const button = screen.getByRole("button", { name: label });
      button.focus();
      expect(document.activeElement).toBe(button);
      // A window-level Escape listener (like the app's close-detail handler)
      // must not fire: the bar swallows Esc before it reaches the window.
      const seen = vi.fn();
      window.addEventListener("keydown", seen);
      fireEvent.keyDown(button, { key: "Escape" });
      window.removeEventListener("keydown", seen);
      expect(seen).not.toHaveBeenCalled();
      // The bar collapses and the query/highlights are cleared.
      expect(
        screen.queryByRole("textbox", { name: "在差异中搜索" }),
      ).toBeNull();
      expect(container.querySelector(".diff-search-count")).toBeNull();
      expect(container.querySelectorAll("mark")).toHaveLength(0);
      // The toggle is shown again, ready to reopen.
      expect(
        screen.getByRole("button", { name: "在差异中搜索" }),
      ).not.toBeNull();
    },
  );

  it("组合输入未结束就关闭，重开后搜索与 Esc 都恢复正常", () => {
    const { container } = render(
      <div className="diff-result">
        <CodeDiff patch={SAMPLE_PATCH} layout="unified" />
      </div>,
    );
    openSearch();
    const input = screen.getByRole("textbox", {
      name: "在差异中搜索",
    }) as HTMLInputElement;
    // Begin a composition but never end it (as if compositionEnd never arrives).
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "中" } });
    // Close mid-composition via the close button.
    fireEvent.click(screen.getByRole("button", { name: "关闭搜索" }));
    // Reopen: no residual composed text leaks into the fresh input.
    openSearch();
    const reopened = screen.getByRole("textbox", {
      name: "在差异中搜索",
    }) as HTMLInputElement;
    expect(reopened.value).toBe("");
    // Ordinary typing runs the search again (no stale composing flag).
    fireEvent.change(reopened, { target: { value: "foo" } });
    expect(container.querySelector(".diff-search-count")?.textContent).toBe(
      "1 / 3",
    );
    // Esc is no longer swallowed by a stale composing flag and collapses the bar.
    fireEvent.keyDown(reopened, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "在差异中搜索" })).toBeNull();
  });
});
