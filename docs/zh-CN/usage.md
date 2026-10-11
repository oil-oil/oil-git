# 使用说明

[项目首页](../../README.zh-CN.md) · [English](../usage.md)

## 安装与打开

macOS 打开 DMG，将 Oil Git 拖入 Applications；Windows 运行 setup.exe。安装包功能范围以对应发布标签和说明为准。电脑需要已有 Git，应用会检测 PATH 和常见安装位置；运行安装后的应用不需要 Node、Rust 或 Python。Windows 缺少 WebView2 时，安装程序可下载微软运行组件。

点击项目按钮或使用 `⌘ O` / `Ctrl O` 选择仓库。选择子目录也能识别所属仓库。最近项目保存在本机，重启时恢复上次项目；移除最近记录不会删除文件或关闭当前项目。

macOS 首次访问桌面等受保护目录时可能询问权限。处理系统提示后，如果首次读取超时，点击重试。

## 浏览变化与历史

- 左侧常驻“暂存的更改”“更改”，以及出现时的“合并的更改”。同一文件可以分别出现在暂存与未暂存范围，选择时读取对应版本。
- 右侧切换“源码”和“分支”，保留文件选择、历史筛选和滚动位置。选择变化文件会打开源码。
- 提交图展示真实父子关系、分支、标签与 HEAD。筛选分支只改变视图，不执行 checkout；“返回 HEAD”定位当前提交。
- 选择提交查看变更文件。普通与合并提交默认比较第一个父提交，首次提交展示新增内容。
- 作者信息来自本地 Git，展开可查看邮箱和提交者。点击文本差异行号可查看该侧最后修改者。提交标题、ID、文件路径等位置的复制按钮便于向 AI Agent 提供上下文，无需 GitHub 登录。
- 工作树选择器只切换观察目录，临时保存列表来自仓库真实的 stash。

## 文件差异

文本默认自动换行，保留真实行号，左右对照的对应行保持对齐。文本差异最多 240 KB，超出时标明截断。UTF-16 BOM 文本解码后比较，仅编码变化仍然可见；无法可靠对应 Git 原始行号时不提供行归属。

图片支持并排、滑动、叠加与像素差异。并排对比切换到 100% 原尺寸时上下排列；新增和删除图片展示单侧。音视频使用系统 WebView 解码，不自动播放。媒体每侧最多读取 8 MiB，已知尺寸的图片最多 1600 万像素；像素比较最多按 2048 × 2048 采样并标注。具体格式能否解码取决于系统 WebView。超限、无法解码的媒体和其他二进制文件展示元信息和前 4 KiB 字节差异。

文本冲突展示实际冲突段与行号，LFS 冲突展示对象 ID 与大小。删除文本冲突标记不等于 Git 已认定冲突解决。

## 偏好与导航

在工具栏菜单中选择英文或简体中文，以及浅色、深色、绿色主题。首次启动语言跟随系统，手动选择保存在本机；切换语言不翻译仓库内容。文件图标随包提供，来自 [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme)。

分栏边界可拖动，也可选中后用方向键调整。窄窗口临时压缩后会恢复偏好宽度，取消拖拽不保存临时尺寸。方向键选择提交，Enter 查看，Esc 关闭详情或取消拖拽，`⌘ R` / `Ctrl R` 刷新。

## CLI 与 AI Agent

macOS 可直接使用随包 `bin/oil-git` 或放入 PATH；应用安装在其他位置时，用 `OIL_GIT_APP` 指定完整 `.app` 路径。Windows 使用安装目录的 `oil-git.exe`，或 `bin/oil-git.ps1`。启动器参数相同，带空格的路径需要引号。

```sh
oil-git open "/项目路径" --view changes
oil-git open "/项目路径" --view history
oil-git inspect "/项目路径" --json
oil-git inspect "/项目路径" --json --lang zh-CN
oil-git skill
oil-git skill --path
```

`open` 发送桌面打开请求，复用既有窗口。`inspect` 不打开窗口，读取真实快照，但不返回完整代码差异。成功返回 `status=ready` 和 `data`；失败返回 `status=error`、稳定的 `kind` 与 `messageKey`、本地化 `message` 和原始 `diagnostic`，以非零状态退出。`--lang en` 或 `--lang zh-CN` 选择 CLI 与 Skill 语言，不改变仓库数据或界面语言偏好。

每次调用未指定 `--lang` 时，按 `LC_ALL`、`LC_MESSAGES`、`LANG` 的顺序读取第一个非空环境变量。以 `zh` 开头时使用简体中文，其余值或均未设置时使用英文；CLI 不保存语言设置。

Windows 可按下面方式使用脚本，无需修改系统执行策略：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\安装目录\bin\oil-git.ps1" inspect "C:\项目路径" --json
```

启动器与 Skill 在 macOS 位于 `Contents/Resources`，Windows 位于安装目录。可将完整 `skills/oil-git` 目录交给 Agent 宿主按其规则安装。安装应用不会修改其他应用的 Skill 设置。

## 只读范围

应用不执行提交、checkout、fetch、合并或撤销。领先与落后数量基于本地已有远程跟踪记录。裸仓库和部分克隆仓库暂不支持，即使部分克隆的对象已经全部下载到本地。

标准 Git LFS 使用自带的只读过滤器：不运行仓库 LFS 程序、不下载内容、不写入 LFS 对象库。指针与已展开内容按真实暂存范围比较；自定义 LFS 转换和扩展暂不支持。

其他活动的外部 `clean` 或 `process` 过滤器会以 `unsafeFilter` 拒绝读取；未被使用的配置不影响查看。读取不运行分页器、外部差异或文本转换程序、签名校验 helper。仓库路由环境变量不能覆盖用户选择的目录。
