# Oil Git 官网

GitHub Pages 首页：https://oil-oil.github.io/oil-git/

本分支只保存网站静态文件。仓库的 Pages 发布来源为 `gh-pages` 分支的根目录。推送到本分支后，GitHub 自动发布；`.nojekyll` 跳过站点生成。

## 更新

编辑 `index.html`；产品演示的样式和交互分别在 `product-demo.css` 与 `product-demo.js`。提交所需的 `assets/` 与 `vendor/` 文件，再推送到 `gh-pages`。图片、脚本和图标使用相对路径，支持 `/oil-git/` 子目录。更新演示样式或脚本时，同步更新 `index.html` 资源链接中的 `v` 参数，避免混用浏览器缓存中的旧文件。公开内容只包含选定的首页及其依赖，不包含对比页、设计记录与验收录屏。

悬浮动画在鼠标移入或聚焦时暂停；界面演示在离屏或页面后台时暂停，手动操作也会暂停演示。系统减少动画偏好受支持。命令行示例仍使用可执行名称 `oil-git`。

Alpine.js 的 MIT 许可在 `vendor/alpine.LICENSE.md`。

下载按钮直接链接到已发布的 Release 安装包。更新版本时核对 macOS、Windows 的资产链接与 SHA256SUMS，下载区突出平台、架构和真实按钮；版本与 Git 依赖简短标注，不追加安装教程或多余状态说明。

Apple 与 Windows 图标来自 Font Awesome Free 6.7.2（Fonticons, Inc.），使用 CC BY 4.0；完整许可在 `vendor/font-awesome.LICENSE.txt`，SVG 中保留来源与版权说明。
产品演示使用 HTML、CSS 与 JavaScript 绘制，不依赖截图；点击节点、文件和主题可操作，自动演示直接切换界面内容，离屏与后台暂停。卡片随滚动轻微向后倾斜，上方收窄、下方展开；系统减少动画偏好下保持平面。文件图标来自 Material Icon Theme，其 MIT 许可在 `vendor/material-icon-theme.LICENSE.txt`。
