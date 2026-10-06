# 写作、预览与发布

日常使用本地写作台、CLI、MCP 与发布工具，请看[写作台操作指南](13-writing-and-agents.md)；当前实现结构见[开发工作坊](14-development-workshop.md)。下面保留手工 Markdown 与 GitHub Pages 的学习练习，仍可用于理解静态站点的内容和部署方式。

## 练习：增加一篇文章和一条无标题动态

在项目根目录运行：

```powershell
npm.cmd run new -- post first-publish
npm.cmd run new -- moment small-discovery
```

脚本复制 templates 并填入当前时间，默认 draft:true。文件已存在会报错，不会覆盖旧内容。它仍是轻量脚手架；本项目现已另有本地可视化写作台，操作方式见上面的指南。

将 `src/content/posts/first-publish.md` 替换为：

```markdown
---
title: '第一次发布练习'
description: '从 Markdown 文件到静态页面的一次完整练习。'
date: '2026-09-18T10:00:00+08:00'
tags: [发布练习]
draft: false
---

这是一篇教程练习示例，用来验证写作、预览与构建流程。

## 从文字开始

保存文件后，可以在文章列表找到它。试着搜索「发布练习」。

![窗边笔记的示例配图](/media/window-notes.webp)
```

将 `src/content/moments/small-discovery.md` 替换为（故意没有 title）：

```markdown
---
date: '2026-09-18T11:00:00+08:00'
tags: [发布练习]
draft: false
---

示例动态：一两句话也可以拥有自己的链接。今天的发布练习完成了。
```

交付项目已经按以上步骤生成了这两个练习文件，复做时请换一个文件名，或直接编辑已有练习。

```powershell
npm.cmd run check
npm.cmd run build
npm.cmd run verify
npm.cmd run preview
```

检查 `/posts/first-publish/`、`/moments/small-discovery/`、`/tags/发布练习/` 和搜索。`npm run dev` 会自动更新；`npm run preview` 展示最近一次 build 生成的 `dist`，其中不含草稿，源文件改动后需重新 build。

`npm run dev` 默认只监听 `127.0.0.1`，在本机打开 `http://127.0.0.1:4321/` 可看到导航中的草稿箱。草稿箱路径是 `/drafts/`，可直接打开草稿文章和动态（包括无标题动态）；详情页会显示草稿标记。开发服务仅供本机使用，不要暴露到公网。首页、列表、标签、归档、搜索、RSS 和 sitemap 始终只包含已发布内容。

## 发布前替换示例信息

在 src/site.config.js 修改 title、subtitle、author、description、intro、about。删掉不需要的示例 Markdown，或改为草稿。首页主标题在 `src/components/HomeFeed.astro`，个人介绍在配置中。确认 Markdown 中没有本机绝对路径。

## GitHub Pages 首次上线

1. 在 GitHub 建立新仓库。普通仓库名可以是 astro-blog；也可用 `用户名.github.io` 做根域名站点。
2. 将**项目根目录的内容**作为仓库根提交，包括 package-lock.json 和 .github/workflows/deploy.yml，排除 node_modules、dist 和 .astro（已有 .gitignore）。
3. 在仓库 Settings → Pages → Build and deployment 选择 **GitHub Actions**。
4. 推送 main 分支，或在 Actions 中手动运行 Deploy static blog to GitHub Pages。成功后从 Pages 页面获取网址。

可选的本地 Git 初始化命令如下，远程 URL 需要你替换：

```powershell
git init -b main
git add .
git commit -m "Create static blog"
git remote add origin https://github.com/YOUR_NAME/YOUR_REPO.git
git push -u origin main
```

后续更新就是编辑 Markdown、检查本地效果、commit 和 push。工作流先 npm ci，再检查、构建、遍历静态产物，最后上传 dist 并部署。检查失败时不进入部署步骤。认证使用 GitHub 的内置工作流权限，不需要在代码中写访问令牌。

本项目未实际创建远程仓库、运行线上 Actions 或配置域名；本地验证不能宣称线上已成功部署。

## 域名和 base

工作流使用 configure-pages 的 origin/base_path 自动提供 BLOG_SITE/BLOG_BASE，因此通常不需要手工猜仓库路径。

| 站点           | BLOG_SITE                 | BLOG_BASE   |
| -------------- | ------------------------- | ----------- |
| 个人根站       | https://name.github.io    | /           |
| 普通仓库       | https://name.github.io    | /astro-blog |
| 自定义域名根站 | https://notes.example.org | /           |

手动测试仓库路径，在 PowerShell 中：

```powershell
$env:BLOG_SITE='https://example.com'
$env:BLOG_BASE='/astro-blog'
npm.cmd run build
npm.cmd run verify
npm.cmd run preview
```

访问 `http://127.0.0.1:4321/astro-blog/`。测试结束恢复环境并重新构建：

```powershell
Remove-Item Env:BLOG_BASE -ErrorAction SilentlyContinue
Remove-Item Env:BLOG_SITE -ErrorAction SilentlyContinue
npm.cmd run build
```

Windows PowerShell 的环境变量只在当前终端及其子进程中生效。普通 `.env` 文件不是本项目 BLOG_SITE/BLOG_BASE 的自动配置入口；请用上述终端环境或工作流。

自定义域名需在 GitHub Pages 配置 DNS；该部分依赖你持有的域名，遵循 [GitHub Pages 官方文档](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site)。确认域名后检查 canonical、RSS 和 sitemap 使用真实网址。

## 发布失败先看什么

- 草稿未显示：运行 `npm run dev`，从导航进入 `/drafts/` 并打开条目；不要为了预览临时把 `draft` 改成 `false`。生产 preview 不包含草稿；已发布内容未显示时检查 `draft: false`、文件名和是否重新 build。
- 图片只在本地正常：检查 Markdown 路径、大小写和 base，不要引用 D 盘文件。
- Actions 报依赖错误：确保 lockfile 已提交，Node 使用 24。
- Pages 404：确认 Source 为 GitHub Actions、部署任务成功、访问地址带正确仓库名。
- 本地正常线上旧内容：确认推送分支、最新工作流是否完成，再检查浏览器缓存。
