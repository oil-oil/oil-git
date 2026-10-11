---
name: oil-git
description: 用 Oil Git 打开用户的本地 Git 项目，查看真实分支、提交、待提交修改和冲突。用户要求用 Oil Git 查看项目，或将当前处理的仓库定位到桌面视图时使用。只负责读取与展示，不执行 Git 写操作、网站浏览或云端仓库管理。
license: MIT
metadata:
  version: "0.1.0"
---

# Oil Git

此 Skill 需要本地 Oil Git 桌面应用、系统 Git 和本地命令执行能力。

根据当前工作区或用户明确给出的路径，判断用户要查看哪个本地项目。只有存在多个候选且上下文无法判断时才询问。

## 发现应用

先检查本机是否已有 `oil-git` 命令。已有时直接使用，不重新安装。

macOS 安装包提供以下启动器：

    "/Applications/Oil Git.app/Contents/Resources/bin/oil-git"

若应用安装在其他位置，使用对应 `.app` 中的相同相对路径。Windows 使用应用安装目录中的 `oil-git.exe`。可选 PowerShell 启动器为 `bin/oil-git.ps1`，参数相同；不要为运行它修改用户或系统执行策略。

运行 `oil-git --version` 确认命令可用。若找不到应用或无法启动，说明缺少项后停止。安装应用或修改 Agent 宿主的 Skill 配置需要用户授权。

## 读取或打开项目

1.  使用 `inspect` 读取真实仓库快照。路径作为独立参数传入，包含空格时加引号：

        oil-git inspect "/项目路径" --json

    成功返回 `status=ready` 和 `data`。失败返回 `status=error`、稳定的 `kind` 与 `messageKey`、本地化 `message`、原始 `diagnostic`，并以非零状态退出。按真实错误处理，不编造分支或提交信息。未初始化项目的初始化由正常开发流程处理。

2.  根据用户任务打开对应视图。查看修改或冲突时用 `changes`，查看提交与分支关系时用 `history`：

        oil-git open "/项目路径" --view changes
        oil-git open "/项目路径" --view history

    命令向桌面应用发送打开请求并复用已有窗口。请求成功不代表视图已完成读取或经过视觉检查。

3.  按快照真实数据说明情况。`data.branch` 是当前分支，`data.head` 是当前提交，`data.files` 分别记录暂存与未暂存变化。同一文件可能同时出现在两个范围。`inspect` 不返回完整代码差异。

4.  需要了解代码细节时，使用宿主已有的只读 Git 能力，或在应用中查看对应文件。未暂存差异比较工作区与暂存区；已暂存差异比较暂存区与 `HEAD`。

5.  说明实际读取到的内容和请求的视图。未成功读取时，不声称工作区干净、冲突已解决或提交已存在。

CLI 每次调用根据区域环境变量选择语言，未设置时使用英文；不沿用界面语言偏好。可在命令前或命令后加 `--lang en` 或 `--lang zh-CN` 指定 CLI 文案，例如：

    oil-git --lang zh-CN inspect "/项目路径" --json
    oil-git inspect "/项目路径" --json --lang zh-CN

无论语言如何，`kind`、`messageKey`、快照数据和原始诊断都保持稳定。

## 边界

- 仓库信息保留在本机，不需要账号或云同步。
- 领先与落后数量来自本地已有的远程跟踪记录，不代表执行过 fetch。
- 分支筛选和工作树选择只改变观察视图，不执行 `checkout`。
- 标准 Git LFS 指针由应用自带的只读过滤器读取，不运行仓库 LFS 程序、不下载内容、不写入 LFS 对象库。遇到不支持的自定义过滤器或 LFS 扩展时按读取错误处理。
- 清除文本冲突标记不会自动改变 Git 的冲突状态；以 Git 的真实记录为准。
- 本 Skill 不授权暂存、提交、合并、重置或推送。只有用户另行授权时，才通过正常开发流程处理这些操作。

运行 `oil-git --help` 查看 CLI 用法。`oil-git skill` 输出本文件，`oil-git skill --path` 输出已安装文件路径。
