# 页间小记 · Astro 静态博客

一个用于长笔记和短动态的独立博客。采用纸白与雾蓝配色，搭配小幅黑白漫画插画，支持明暗主题和手机阅读。站名、作者和文章均为可替换示例。

## 本地开始

需要 Node.js **22.12+**（建议 24 LTS）和 npm。在 PowerShell 中：

```powershell
cd D:\projects\astro-blog
npm.cmd ci
npm.cmd run dev
```

打开终端显示的地址（默认 `http://127.0.0.1:4321/`）。停止服务按 Ctrl+C。普通终端也可以使用 `npm`，Windows 执行策略拦截 npm.ps1 时使用 `npm.cmd`。

```powershell
npm.cmd run check
npm.cmd run build
npm.cmd run verify
npm.cmd run preview
```

`dist/` 是唯一需要部署的目录。`preview` 是本地检查生产结果的服务，不是线上后端。

## 写一条内容

```powershell
npm.cmd run new -- post my-first-note
npm.cmd run new -- moment a-small-discovery
```

在 `src/content/posts/` 或 `src/content/moments/` 编辑新文件；文章填写标题和摘要，动态不用标题。完成后改为 `draft: false`。详见 [写作和发布](docs/06-writing-deployment.md)。

写作中可保持 `draft: true`，用 `npm run dev` 打开导航中的**草稿箱**（`/drafts/`）查看。`npm run preview` 展示生产构建，不含草稿。

第二阶段已加入图片放大、代码复制、目录当前章节高亮，以及文章可选 `updated` 日期。参见 [第二阶段开发教程](docs/10-phase-two.md) 与 [第二阶段验收](docs/11-phase-two-validation.md)。

## 写作台与 Hermes 接口

主页按时间混排文章摘要和碎碎念全文，并支持静态分页。界面保留雾蓝配色，黑白漫画小作家与白猫作为少量点缀，详见 [视觉简化与对比记录](docs/22-manga-style.md)。

运行 `npm.cmd run studio`（或双击 `start-studio.cmd`），打开 `http://127.0.0.1:4323/`，即可新建、编辑、插图、保存预览和演练发布。它只在本机运行，线上仍然只部署 `dist/`。

Agent 可调用 `node tools/blog/cli.mjs --help` 查看 JSON CLI，或通过 `node tools/blog/mcp.mjs` 启动 stdio MCP。两个接口与写作台共用内容规则。默认仅保存草稿与模拟发布，远程配置模板为 `blog.publish.example.json`；当前没有关联或推送远程仓库。

- [日常写作、CLI 与 Hermes/MCP 接入](docs/13-writing-and-agents.md)
- [本轮完整开发教程](docs/14-development-workshop.md)
- [进度与决策](docs/12-progress.md) · [本轮验证记录](docs/15-validation.md)
- [自动保存、误关恢复、图片粘贴/拖拽与修改历史](docs/17-daily-writing.md) · [日常写作迭代进度](docs/16-writing-progress.md)
- [恢复中心、备份与图片管理指南](docs/19-maintenance-guide.md) · [本轮进度与验收](docs/18-maintenance-progress.md)
- [发布中心、首次配置向导与 CLI/MCP 示例](docs/21-publish-center-guide.md) · [发布中心验收](docs/20-publish-center-progress.md)

## 学习路线

| 顺序 | 文档                                                | 读完可以做什么                   |
| ---- | --------------------------------------------------- | -------------------------------- |
| 1    | [需求和验收](docs/01-requirements.md)               | 理解本期边界与完成标准           |
| 2    | [环境和目录](docs/02-getting-started.md)            | 启动项目、找到要改的文件         |
| 3    | [架构原理](docs/03-architecture.md)                 | 理解 Markdown 怎样变成静态网页   |
| 4    | [内容规范](docs/04-content.md)                      | 写文章、动态，正确组织图片和草稿 |
| 5    | [视觉设计与开发教程](docs/05-design-development.md) | 修改组件、样式、搜索和主题       |
| 6    | [写作与部署](docs/06-writing-deployment.md)         | 添加内容并部署到 GitHub Pages    |
| 7    | [维护与扩展](docs/07-maintenance.md)                | 排查问题、升级、规划本地编辑器   |
| 8    | [设计决策](docs/08-decisions.md)                    | 理解取舍及未选择的方案           |
| 9    | [验证报告](docs/09-validation.md)                   | 查看已验证内容、截图与已知限制   |

插画原图在 `src/assets/` 和 `assets/source/`，网页压缩图在 `public/media/`；[生成提示词与来源](docs/assets/image-generation.md)。截图在 `docs/screenshots/`。

## 配置与部署

个人文案集中于 `src/site.config.js`。默认域名 `https://example.com` 仅用于本地占位，不能直接作为正式发布域名。GitHub 工作流从 Pages 设置读取实际域名与仓库子路径。

首次上线需要你创建仓库、推送代码，并在 Settings → Pages 选择 GitHub Actions。本次交付不创建远程仓库或公开发布。草稿不会进入网站，但源码仓库若公开，别人仍能读取仓库中的草稿；敏感内容不要提交到公开仓库。
