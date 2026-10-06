# 首次正式部署

日期：2026-10-06。用户授权公开仓库 `ymjjj/astro-blog`、`main` 分支及 GitHub Pages。

- 正式地址：<https://ymjjj.github.io/astro-blog/>
- 源码：<https://github.com/ymjjj/astro-blog>
- 部署记录：<https://github.com/ymjjj/astro-blog/actions>
- Pages 来源为 GitHub Actions，现有工作流只上传 `dist/`。
- 站名、作者、简介未收到替换内容，暂保留“页间小记”“小站主人”及现有说明；8 条公开示例继续保留。

## 首次推送前检查

正式 `BLOG_SITE=https://ymjjj.github.io`、`BLOG_BASE=/astro-blog/` 下，类型检查 79 个文件无错误或警告；静态构建成功，产物检查覆盖 27 个 HTML 页面、745 个链接、8 条公开内容，未发现草稿泄漏。桌面与手机的 24 项浏览器测试通过，包括明暗主题、搜索、图片放大、目录、复制和草稿隔离。

首次 Git 索引排除 `.blog/`、`.cache/`、环境变量文件、构建产物、依赖、本地测试日志与历史截图；两篇本地草稿及其专用 SVG 也已排除并保留在本机。索引内容均为 `draft:false`，常见令牌及私钥格式扫描未命中。提交和上线结果以 Actions 中对应提交的实际结论为准，不能以本地预检代替。

## 日常操作

双击 `start-studio.cmd` 写作。公开源码仓库能被任何人读取，因此不要直接执行未审查的 `git add .` 后推送：新草稿不会自动加入 `.gitignore`，已提交内容即使改为草稿，也仍留在 Git 历史中。发布网站和保护源码是两件事。

真实发布接口仍需要本机可用的 `gh` 命令和 GitHub 身份。此次首次部署可以通过系统已有 Git 凭据完成，但不能因此假定写作台已具备持续远程发布能力。配置向导保存默认关闭远程操作；后续接入参见 [发布中心指南](21-publish-center-guide.md)。

本地历史截图和详细测试日志因可能包含草稿内容，不上传公共仓库；旧文档中的对应链接仅在原工作目录中有效。
