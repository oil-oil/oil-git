# Oil Git 官网

GitHub Pages 首页：https://oil-oil.github.io/oil-git/

本分支只保存网站静态文件。仓库的 Pages 发布来源为 `gh-pages` 分支的根目录。推送到本分支后，GitHub 自动发布；`.nojekyll` 跳过站点生成。

## 更新

编辑 `index.html`，提交所需的 `assets/` 与 `vendor/` 文件，再推送到 `gh-pages`。图片、脚本和图标使用相对路径，支持 `/oil-git/` 子目录。公开内容只包含选定的首页及其依赖，不包含对比页、设计记录与验收录屏。

动画在鼠标移入、聚焦、离屏或页面后台时暂停；系统减少动画偏好受支持。命令行示例仍使用可执行名称 `oil-git`。

Alpine.js 的 MIT 许可在 `vendor/alpine.LICENSE.md`。
