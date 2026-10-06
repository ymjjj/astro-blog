# 第一版验证报告

验收日期：2026-09-26。环境：Windows、Node 24.11.0、npm 11.6.1、Astro 7.3.5、Playwright 1.63.0、Chromium。验证对象为实际生成的 dist，最终保留根路径构建结果。

## 结果

| 要求                              | 实际证据与结果                                                                                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 独立项目、静态输出                | 所有新文件位于 astro-blog；未修改旧 blog。Astro output:static，dist 为 HTML/CSS/JS/图片/字体，无后端服务                                                                             |
| 安装可重现                        | 实际执行 npm ci 成功，安装 574 个包；使用项目附带的 package-lock.json                                                                                                                |
| 类型检查                          | [typecheck.log](validation/phase1/typecheck.log)：34 个文件，0 错误、0 警告、0 提示                                                                                                  |
| 文章、动态、标签、归档、关于、404 | 根路径和子路径各生成 26 个 HTML 页面，8 条公开内容（4 文章、4 动态）                                                                                                                 |
| 路径与资源                        | 两种 base 各验证 710 处链接，覆盖 HTML href/src、CSS 资源、锚点、搜索结果、RSS、sitemap；[根路径](validation/phase1/root-verify.log)、[子路径](validation/phase1/subpath-verify.log) |
| 中文搜索                          | 测试中文结果、无匹配、清空、查询 URL、进入结果、网络错误反馈；草稿关键词无结果                                                                                                       |
| 主题                              | 浅色切暗色及刷新持久化成功，桌面与手机均保存暗色截图                                                                                                                                 |
| 文章排版                          | 实际验证目录锚点和滚动位置、Shiki 代码、KaTeX 公式、图片加载；检查文章截图                                                                                                           |
| 短动态                            | 无标题动态有独立链接、正文和配图，标签链接可跳转                                                                                                                                     |
| SEO / RSS                         | 每页一个 h1、有 title/description/lang/canonical，RSS 8 条与搜索索引数量一致，订阅链接可解析                                                                                         |
| 草稿隔离                          | 扫描所有输出文件（含二进制）未发现测试草稿标记、文件名或专用 SVG；草稿 URL 返回 404                                                                                                  |
| 撤回资源                          | [draft-lifecycle.json](validation/phase1/draft-lifecycle.json)：先发布草稿确认图片确实存在，再撤回构建确认图片消失，原稿已恢复                                                       |
| 按文档写作                        | 执行 new 脚本，创建 first-publish 和无标题 small-discovery；检查详情、RSS 和最终构建，文件作为学习示例保留                                                                           |
| 开发体验                          | [dev-reload.json](validation/phase1/dev-reload.json)：实际运行开发服务、修改 Markdown、确认更新、恢复后确认页面恢复                                                                  |
| 响应式                            | 1440px 桌面与 390px 手机模拟，11 个主要路由均无全页横向溢出，图片完整加载；有代表性截图                                                                                              |
| 无脚本阅读                        | 禁用 JavaScript 后正文、目录、主导航与动态仍可访问，主题按钮隐藏                                                                                                                     |
| 浏览器验收                        | 每种 base 10 项（桌面 5 + 手机 5），合计 20 项通过；[根路径结果](validation/phase1/root-browser.log)、[子路径结果](validation/phase1/subpath-browser.log)                            |
| 文档                              | README 和 01—09 文档覆盖需求、环境、架构、内容、设计开发、部署、维护、决策、验收；内容与当前代码核对                                                                                 |
| 部署配置                          | 已配置 main 推送/手动触发、Node 24、npm ci、check、build、verify、Pages artifact 和 deploy。origin/base_path 从 configure-pages 读取                                                 |

机器可读执行汇总：[matrix.json](validation/phase1/matrix.json)。完整浏览器 JSON 为 [root-browser-results.json](validation/phase1/root-browser-results.json) 和 [subpath-browser-results.json](validation/phase1/subpath-browser-results.json)。日志中的终端颜色环境提示不影响检查结果；强制构建显示清空数据缓存是预期行为。

## 截图

- [桌面首页](screenshots/phase1/root-desktop-home.png)
- [手机首页](screenshots/phase1/root-mobile-home.png)
- [桌面暗色](screenshots/phase1/root-desktop-dark.png)
- [手机暗色](screenshots/phase1/root-mobile-dark.png)
- [桌面文章](screenshots/phase1/root-desktop-article.png)
- [手机文章](screenshots/phase1/root-mobile-article.png)
- [桌面动态](screenshots/phase1/root-desktop-moments.png)
- [手机动态](screenshots/phase1/root-mobile-moments.png)

子路径版本以 subpath- 开头，位于同一目录。已实际查看代表性首页、暗色、正文和动态截图；没有明显遮挡，长代码/表格/公式由自身容器滚动。

## 复现

```powershell
npm.cmd ci
npx.cmd playwright install chromium
npm.cmd run verify:all
```

verify:all 顺序执行类型检查、子路径构建/产物扫描/浏览器测试、根路径构建/扫描/浏览器测试。结束时 dist 恢复到根路径。运行前保证 4321 端口空闲。

另外两项有针对性的回归检查：

```powershell
node scripts/verify-draft-lifecycle.mjs
node scripts/verify-dev.mjs
```

前者临时发布测试草稿并自动恢复，不应在执行过程中手动把中间 dist 上传线上。后者使用 4322 端口，临时编辑练习文章并恢复，不应同时手动编辑该文件。

## 尚未进行和已知限制

没有建立远程仓库、公开发布、执行真实 GitHub Actions 或配置 DNS。工作流配置已经核对官方示例，实际云端成功仍需首次推送后验证。占位域名为 example.com；工作流会读取真实 Pages 地址，本地手动发布须正确设置 BLOG_SITE/BLOG_BASE。

仅在 Chromium 桌面和移动模拟环境验证，未宣称所有浏览器、真机、读屏软件都已通过。搜索、分页、草稿预览等功能边界见 [维护文档](07-maintenance.md)。公开源码仓库中的草稿不属于网站产物隔离的保护范围。

## 协作记录

GPT-6 Luna（max）只负责按明确字段规范创建 6 份示例内容和 2 份模板，以及只读核对文档命令/路径。主代理负责架构、全部页面与脚本、图片生成、草稿资源修复、文档主体、集成和最终验收。
