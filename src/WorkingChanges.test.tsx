// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { ChangesSidebar, SourceEditor } from "./WorkingChanges";
import type { Diff, FileState } from "./types";
import type { WorkingFile } from "./useWorkingCopy";

const makeFile = (
  path: string,
  options: Partial<FileState> = {},
): FileState => ({
  path,
  oldPath: null,
  xy: " M",
  conflict: false,
  untracked: false,
  staged: false,
  unstaged: true,
  ...options,
});

function StatefulSidebar({ files }: { files: FileState[] }) {
  const [file, setFile] = useState<WorkingFile | null>(null);
  return <ChangesSidebar files={files} file={file} onFile={setFile} />;
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("LFS 对象展示不提供无效的代码布局切换，普通差异保留切换入口", () => {
  const files = [makeFile("素材.bin")];
  const diff: Diff = {
    patch: "",
    truncated: false,
    binary: false,
    note: null,
    conflict: null,
  };
  const props = {
    files,
    file: { path: "素材.bin", mode: "unstaged" } as WorkingFile,
    error: null,
    retry: () => {},
  };
  const view = render(
    <SourceEditor
      {...props}
      diff={{
        ...diff,
        lfs: { before: null, after: { oid: "a".repeat(64), size: 42 } },
      }}
    />,
  );
  expect(screen.getByRole("region", { name: "Git LFS 对象变化" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "统一差异" })).toBeNull();
  view.rerender(<SourceEditor {...props} diff={diff} />);
  expect(screen.getByRole("button", { name: "统一差异" })).toBeTruthy();
});

describe("更改目录树", () => {
  it("根目录文件直接显示，连续单目录链合并，文件名只显示 basename", () => {
    const files = [
      makeFile("README.md"),
      makeFile("apps/mobile/src/main.tsx"),
      makeFile("apps/mobile/src/routes/home.tsx"),
    ];
    render(<ChangesSidebar files={files} file={null} onFile={() => {}} />);

    const rootFile = screen.getByRole("button", {
      name: "README.md · 未暂存",
    });
    const nestedFile = screen.getByRole("button", {
      name: "apps/mobile/src/main.tsx · 未暂存",
    });
    expect(rootFile.closest(".change-directory")).toBeNull();
    expect(rootFile.querySelector(".source-file-name")?.textContent).toBe(
      "README.md",
    );
    expect(nestedFile.querySelector(".source-file-name")?.textContent).toBe(
      "main.tsx",
    );
    expect(nestedFile.getAttribute("title")).toBe("apps/mobile/src/main.tsx");
    expect(
      screen
        .getByRole("button", { name: "apps/mobile/src" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "apps/mobile/src/routes" }),
    ).toBeTruthy();
  });

  it("同一路径的暂存与未暂存选择独立，目录折叠在刷新后保留", () => {
    const files = [makeFile("src/shared.ts", { staged: true, xy: "MM" })];
    const view = render(<StatefulSidebar files={files} />);
    const folders = screen.getAllByRole("button", { name: "src" });

    fireEvent.click(folders[0]);
    expect(folders[0].getAttribute("aria-expanded")).toBe("false");
    expect(folders[1].getAttribute("aria-expanded")).toBe("true");

    view.rerender(
      <StatefulSidebar files={files.map((file) => ({ ...file }))} />,
    );
    const refreshedFolders = screen.getAllByRole("button", { name: "src" });
    expect(refreshedFolders[0].getAttribute("aria-expanded")).toBe("false");
    expect(refreshedFolders[1].getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(refreshedFolders[0]);
    const staged = screen.getByRole("button", {
      name: "src/shared.ts · 已暂存",
    });
    const unstaged = screen.getByRole("button", {
      name: "src/shared.ts · 未暂存",
    });
    fireEvent.click(staged);
    expect(staged.classList.contains("selected")).toBe(true);
    expect(unstaged.classList.contains("selected")).toBe(false);
    fireEvent.click(unstaged);
    expect(staged.classList.contains("selected")).toBe(false);
    expect(unstaged.classList.contains("selected")).toBe(true);

    const expandedFolder = screen.getAllByRole("button", { name: "src" })[0];
    view.rerender(<StatefulSidebar files={files} />);
    expect(screen.getAllByRole("button", { name: "src" })[0]).toBe(
      expandedFolder,
    );
    expect(screen.getByRole("button", { name: "src/shared.ts · 未暂存" })).toBe(
      unstaged,
    );
    expect(unstaged.classList.contains("selected")).toBe(true);
  });
});

describe("按路径筛选更改", () => {
  it("三个范围按完整路径筛选，不区分大小写，并显示匹配数与总数", () => {
    const files = [
      makeFile("src/conflict.ts", { conflict: true, xy: "UU" }),
      makeFile("src/staged.ts", { staged: true, unstaged: false, xy: "M " }),
      makeFile("docs/staged.md", { staged: true, unstaged: false, xy: "M " }),
      makeFile("src/working.ts"),
      makeFile("README.md"),
    ];
    render(<ChangesSidebar files={files} file={null} onFile={() => {}} />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "SRC/" },
    });

    expect(
      screen.getByRole("button", { name: "src/conflict.ts · 冲突" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "src/staged.ts · 已暂存" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "src/working.ts · 未暂存" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "docs/staged.md · 已暂存" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "README.md · 未暂存" }),
    ).toBeNull();
    for (const [title, count] of [
      ["合并的更改", "1/1"],
      ["暂存的更改", "1/2"],
      ["更改", "1/2"],
    ]) {
      const section = screen.getByText(title).closest("section")!;
      expect(within(section).getByTitle("匹配 / 总数").textContent).toBe(count);
    }
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(
      screen.getByRole("button", { name: "README.md · 未暂存" }),
    ).toBeTruthy();
  });

  it("筛选不触发文件选择，清空后恢复原选择及范围", () => {
    const files = [
      makeFile("src/shared.ts", { staged: true, xy: "MM" }),
      makeFile("README.md"),
    ];
    const onFile = vi.fn();
    const file: WorkingFile = { path: "src/shared.ts", mode: "staged" };
    render(<ChangesSidebar files={files} file={file} onFile={onFile} />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "missing" },
    });
    expect(screen.getByRole("status").textContent).toContain("没有匹配的文件");
    expect(screen.getByText("已选中的文件不在筛选结果中")).toBeTruthy();
    expect(onFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(
      screen
        .getByRole("button", { name: "src/shared.ts · 已暂存" })
        .classList.contains("selected"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "src/shared.ts · 未暂存" })
        .classList.contains("selected"),
    ).toBe(false);
    expect(onFile).not.toHaveBeenCalled();
  });

  it("筛选自动展开匹配项，清空后恢复分组及目录的折叠状态", () => {
    render(
      <ChangesSidebar
        files={[makeFile("src/main.ts"), makeFile("README.md")]}
        file={null}
        onFile={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "src" }));
    fireEvent.click(screen.getByRole("button", { name: /^更改/ }));
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "main" },
    });
    expect(
      screen.getByRole("button", { name: "src/main.ts · 未暂存" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    const group = screen.getByRole("button", { name: /^更改/ });
    expect(group.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(group);
    expect(
      screen.getByRole("button", { name: "src" }).getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("按字面匹配标点和空格，并高亮可见的命中内容", () => {
    render(
      <ChangesSidebar
        files={[makeFile("src/[draft] copy.ts"), makeFile("src/draft.ts")]}
        file={null}
        onFile={() => {}}
      />,
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "[DRAFT] " },
    });
    expect(
      screen.getByRole("button", { name: "src/[draft] copy.ts · 未暂存" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "src/draft.ts · 未暂存" }),
    ).toBeNull();
    expect(screen.getByText("[draft]").textContent).toBe("[draft] ");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: " " } });
    expect(
      screen.getByRole("button", { name: "src/[draft] copy.ts · 未暂存" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "src/draft.ts · 未暂存" }),
    ).toBeNull();
  });

  it("刷新沿用筛选；工作区变干净后仍能清除筛选", () => {
    const view = render(
      <ChangesSidebar
        files={[makeFile("src/main.ts")]}
        file={null}
        onFile={() => {}}
      />,
    );
    const input = screen.getByRole("searchbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "src/" } });
    view.rerender(
      <ChangesSidebar
        files={[makeFile("src/new.ts"), makeFile("README.md")]}
        file={null}
        onFile={() => {}}
      />,
    );
    expect(input.value).toBe("src/");
    expect(
      screen.getByRole("button", { name: "src/new.ts · 未暂存" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "README.md · 未暂存" }),
    ).toBeNull();
    view.rerender(<ChangesSidebar files={[]} file={null} onFile={() => {}} />);
    expect(screen.getByText("没有待提交的更改")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    view.rerender(
      <ChangesSidebar
        files={[makeFile("README.md")]}
        file={null}
        onFile={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: "README.md · 未暂存" }),
    ).toBeTruthy();
  });

  it("Esc 清除并保留输入焦点，不触发工作区的快捷键", () => {
    const onKeyDown = vi.fn();
    render(
      <div onKeyDown={onKeyDown}>
        <ChangesSidebar
          files={[makeFile("README.md")]}
          file={null}
          onFile={() => {}}
        />
      </div>,
    );
    const input = screen.getByRole("searchbox") as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "missing" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "README.md · 未暂存" }),
    ).toBeTruthy();
  });
});
