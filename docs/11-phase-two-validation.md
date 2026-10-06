# 第二阶段验收记录

验证日期：2026-09-27（Asia/Hong_Kong）。运行环境为 Windows、Node 24.11.0、Astro 7.3.5、Chromium，手机为 390px 模拟视口。仍然是静态网站，没有添加服务器部署要求。

## 功能与证据

| 功能 | 验证范围 | 证据 |
| --- | --- | --- |
| 本地草稿箱 | dev 导航有入口，列表能打开文章和无标题动态，详情显示草稿提示和 noindex，草稿专用图片可加载 | root/subpath-dev-browser-results.json |
| 草稿编辑 | 保持 draft:true 修改正文，开发请求反映变化；恢复后变化消失，源文件恢复 | tests/dev/drafts.spec.ts，开发浏览器报告 |
| 公共出口过滤 | 即使在 dev，首页、文章/动态列表、标签、归档、搜索、RSS、sitemap 不包含草稿正文和专用标签 | 开发浏览器报告 |
| 生产隔离 | 先运行草稿预览再 build；草稿页和 /drafts/ 均不生成，导航无入口；遍历全产物未发现草稿标记、文件名、专用 SVG | root/subpath-verify.log，生产浏览器报告 |
| 构建模式约束 | 实际命令为 build 时，即使 --mode development 也不会启用草稿 | phase2-guardrails.json、phase2-development-mode-build.log |
| 图片查看 | 正文和动态图片、Enter 打开、Escape/按钮/背景关闭、焦点恢复、Tab 循环、滚动锁定/解除 | reading-tools.spec.ts，桌面/手机/明暗截图 |
| 代码复制 | 真实浏览器写入并读取系统剪贴板；受控成功与权限拒绝；保留空格和空行，失败选中原文 | 生产浏览器报告 |
| 目录高亮 | 滚动、到页尾、回到顶部、点击、刷新锚点、浏览器后退，始终只有一个当前章节 | 生产浏览器报告 |
| 更新日期 | 有值的文章在列表/详情/SEO/sitemap 一致；没有值不输出；排序保持按发布日期 | 生产浏览器报告 |
| 非法日期 | updated 早于 date 时构建失败并给出明确字段错误，测试后恢复源文件 | phase2-invalid-updated.log、phase2-guardrails.json |
| 渐进增强 | 无 JavaScript 时仍能看图、读代码、使用原目录与导航，不显示无效复制或图片按钮 | 两组无脚本浏览器测试 |
| 风格与适配 | 沿用语义色变量，无新客户端框架；桌面、手机、明暗模式截图经查看 | docs/screenshots/phase2-* |
| 文档 | 新增第二阶段教程，并同步更新内容规范、写作指南、架构与维护说明 | 10-phase-two.md 及相关旧文档 |

## 自动检查汇总

- 类型检查：44 个文件，0 错误、0 警告、0 提示。
- 根路径和 `/astro-blog/` 子路径：每种 2 项开发预览测试 + 22 项生产浏览器测试，共 **48 项通过**。
- 每种路径生产构建输出 26 个 HTML 页面、8 条已发布内容，检查 710 处链接与资源。
- 草稿资源撤回回归通过：先确认发布时图片存在，改回草稿后确认所有公开产物不包含它。
- 最终 dist 保留根路径构建结果，可直接 `npm run preview`。

实际执行状态以 [matrix.json](validation/phase2/matrix.json) 为准。原始日志与机器可读报告：

- [类型检查](validation/phase2/typecheck.log)
- [根路径构建](validation/phase2/root-build.log)、[子路径构建](validation/phase2/subpath-build.log)
- [根路径产物扫描](validation/phase2/root-verify.log)、[子路径产物扫描](validation/phase2/subpath-verify.log)
- [根路径开发测试](validation/phase2/root-dev-browser-results.json)、[子路径开发测试](validation/phase2/subpath-dev-browser-results.json)
- [根路径生产测试](validation/phase2/root-browser-results.json)、[子路径生产测试](validation/phase2/subpath-browser-results.json)
- [日期校验和模式隔离](validation/phase2/phase2-guardrails.json)
- [草稿附件撤回](validation/phase2/draft-lifecycle.json)

## 代表性截图

- [手机草稿预览](screenshots/phase2/phase2-dev-mobile-draft.png)
- [桌面草稿预览](screenshots/phase2/phase2-dev-desktop-draft.png)
- [桌面图片查看](screenshots/phase2/phase2-root-desktop-image.png)
- [手机图片查看](screenshots/phase2/phase2-root-mobile-image.png)
- [手机暗色阅读工具](screenshots/phase2/phase2-root-mobile-reading-dark.png)
- [桌面暗色图片查看](screenshots/phase2/phase2-root-desktop-image-dark.png)

开发截图底部可能出现 Astro 开发工具栏；生产截图不包含此工具栏。

## 本次发现与修复

1. 草稿图片默认延迟加载，测试不能只判断元素可见后立即读取 naturalWidth；先滚动到图片并等待实际加载，避免误把未开始加载当作损坏。
2. Windows 系统剪贴板会将 LF 转成 CRLF。实际复制保留了代码，测试对读回结果只统一行结束符，不删除其他空白。
3. 原生 dialog 的单控件 Tab 顺序可能把焦点交给浏览器界面，增加明确的 Tab/Shift+Tab 循环，Escape 继续正常关闭。
4. 隐藏弹层不设置 autofocus，打开时显式 focus，避免影响页面初始焦点。

## 复现命令与边界

```powershell
npm.cmd run verify:all
node scripts/verify-phase-two.mjs
node scripts/verify-draft-lifecycle.mjs
```

verify:all 需要 4321 和 4324 端口空闲。后两条脚本会临时修改测试内容并恢复，不要同时手动编辑它们，也不要在执行中把中间 dist 发布出去。单独测试开发草稿可用 `npx.cmd playwright test --config playwright.dev.config.ts`。

浏览器剪贴板需要安全上下文与权限；localhost 与 HTTPS 支持，拒绝权限会退回选中文本。图片工具提供适应视口的查看，不含相册轮播和拖拽缩放。图片本来是超链接时保留原链接行为。更新时间由作者维护，未自动接入 Git 历史。测试使用 Chromium 手机模拟，不宣称已覆盖所有真机和读屏软件。

本阶段没有执行公网部署，也没有制作完整本地可视化编辑器。Luna（max）仅承担 UpdatedDate 展示组件及指定文档段落更新；模式隔离、交互、集成和验收由主代理完成。
