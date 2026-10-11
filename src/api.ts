import { invoke, isTauri } from "@tauri-apps/api/core";
import type { GitError } from "./types";
export function request<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauri())
    return Promise.reject({
      kind: "desktopRequired",
      messageKey: "desktopRequired",
      message: "请在 Oil Git 桌面应用中打开。本地仓库读取需要桌面环境。",
    });
  return invoke<T>(command, args);
}
export function errorOf(error: unknown): GitError {
  if (error && typeof error === "object" && "message" in error)
    return error as GitError;
  return { kind: "unknown", message: String(error) };
}
// 每个异步区域各自持有一个门闩，关闭和换对象立即使旧结果失效。
export class RequestGate {
  private serial = 0;
  next() {
    return ++this.serial;
  }
  invalidate() {
    this.serial++;
  }
  accepts(ticket: number) {
    return ticket === this.serial;
  }
}
