# 第三至第五阶段验收记录

日期：2026-09-27，Asia/Hong_Kong。环境：Windows、Node 24.11.0、Astro 7.3.5、Playwright Chromium；手机使用 iPhone 13 尺寸模拟。真实远程仓库与 Hermes 主机尚未配置，本报告严格区分本地实现、协议验证和实际上线。

## 交付与证据

| 目标 | 实现与验收方式 |
| --- | --- |
| 平行混合主页 | 文章标题/摘要、碎碎念完整 Markdown 同一条时间流；浏览器验证跨页时间排序、无重复、图片放大和第二页导航 |
| 静态分页 | 每页 6 条；主页、文章列表、碎碎念列表共用页数和路径函数；独立副本增长到 14 条时验证根路径与子路径的完整构建和链接 |
| 萌系视觉 | 原创蓝发小作家与白猫插画、圆润卡片、小标签，保留雾蓝配色；1200/600 两份 WebP 分别约 85/27 KiB |
| 写作工作台 | 桌面/手机真实浏览器创建无标题碎碎念、插图、保存预览、校验、演练发布、查看状态、处理并发冲突；同时检查横向溢出与页面脚本错误 |
| 内容核心 | 草稿默认、文章必填字段、稳定 ID、requestId 幂等、revision 冲突、搜索筛选、图片导入与路径边界 |
| CLI | 独立 Node 子进程、绝对 root、不同 cwd、UTF-8 BOM 输入、单个 JSON 输出、失败退出码 |
| MCP | 官方 SDK 客户端实际启动 stdio 服务、握手、发现 10 个工具、创建/读取/更新/重试与冲突错误；不是仅检查 JSON 配置 |
| 发布演练 | 真实隔离构建与扫描，模拟发布/撤回不修改原稿与正式 dist；坏链接阻止发布并留下可查询失败任务 |
| 发布状态 | 区分保存、检查、模拟、提交、推送、部署、上线、撤回与失败；测试同 SHA 的其他手动任务和旧运行不能冒充本次部署 |
| 生产隔离 | 从实际草稿清单核对路由与专用图片；保留公开索引检查；草稿能被明确演练发布，不因文件名含 unpublished 而永久禁止发布 |
| 本地 HTTP 边界 | 缺 token、跨源请求、网页任意路径导图被拒绝；私有目录不提供 HTTP 访问 |
| 原功能回归 | 搜索、明暗主题、目录定位、数学公式、图片查看、剪贴板、最后更新日期、无 JS 阅读，以及默认草稿过滤 |

## 运行记录

**结果：70 项测试全部通过，类型检查 67 个文件，0 错误、0 警告、0 提示。附件撤回检查通过。**

本轮统一入口为 `npm.cmd run verify:complete`。它顺序运行工具测试、工作台浏览器测试、网站双路径矩阵，保存日志与机器可读状态；以 [phase3-complete.json](validation/phase3-complete.json) 的 `complete` 和退出码为准。

- 工具测试：16 项，见 [完整日志](validation/phase3-tools.log)。
- 工作台浏览器：桌面和手机共 2 项，见 [报告](validation/studio-browser.json) 与 [日志](validation/phase3-studio.log)。
- 网站矩阵：每种路径 2 项本地草稿测试、24 项生产浏览器测试，两种路径共 52 项，见 [matrix.json](validation/matrix.json)。
- 合计 70 项测试。类型检查见 [typecheck.log](validation/typecheck.log)。
- 根路径与子路径每次生产构建为 27 个 HTML 页面、8 条公开内容，检查 745 处链接和资源，见 [根路径扫描](validation/root-verify.log)、[子路径扫描](validation/subpath-verify.log)。
- [根路径浏览器报告](validation/root-browser-results.json)、[子路径浏览器报告](validation/subpath-browser-results.json)、[根路径草稿报告](validation/root-dev-browser-results.json)、[子路径草稿报告](validation/subpath-dev-browser-results.json)。
- 草稿附件发布后撤回的独立检查见 [draft-lifecycle.json](validation/draft-lifecycle.json)。

统一执行结束后 `dist/` 为根路径构建。测试创建的内容位于独立临时目录或 `.cache/studio-fixture`，没有导入正式文章目录。`.cache`、`.blog` 均不部署。

## 前后对比与截图

| 视图 | 第二阶段 | 本轮 |
| --- | --- | --- |
| 桌面主页 | [之前](screenshots/phase2/root-desktop-home.png) | [混合信息流与新插画](screenshots/phase3-root-desktop-home.png) |
| 手机主页 | [之前](screenshots/phase2/root-mobile-home.png) | [混合信息流](screenshots/phase3-root-mobile-home.png) |

其他截图：[网站桌面暗色](screenshots/root-desktop-dark.png)、[网站手机暗色](screenshots/root-mobile-dark.png)、[桌面写作台](screenshots/phase3-studio-desktop.png)、[手机写作台](screenshots/phase3-studio-mobile.png)、[桌面写作台暗色](screenshots/phase3-studio-desktop-dark.png)、[手机写作台暗色](screenshots/phase3-studio-mobile-dark.png)。截图已用于实际复查布局；不是设计稿替代运行结果。

## 迭代中发现和修复的问题

1. 首页集成时的分页参数名不一致，由类型检查发现并修复。
2. 依赖的早期 Zod 3.25.0 包缺少实际入口，改为可运行的 3.25.76，并由真实 CLI/MCP 测试确认。
3. iframe 缺少自己的源导致 Astro 开发资源请求被拒绝；现使用不同端口隔离写作台与预览，允许预览按自己的源加载资源。
4. 新草稿保存后路由更新存在短暂延迟，预览 API 等待 URL 可读后再打开。
5. 隔离构建触发开发服务器重启，改为明确忽略 .blog 与项目内部测试缓存。
6. 手机测试误匹配了上一条演练任务，改为按当前内容 ID 匹配，等待操作完成后再测试冲突。
7. 保存期间继续输入可能被返回的旧表单覆盖，操作期间冻结编辑区域；无改动日期保留原始秒数与时区值。
8. 草稿扫描不应永久禁止特定文件名，改为依据当前 draft 状态保护，并加入原示例草稿可被明确演练发布的回归。
9. 仅凭相同提交 SHA 可能把上一次手动部署当成本次成功，工作流增加 jobId 关联标题，状态查询同时匹配提交、触发类型和本次任务。

## 未执行与边界

- 未创建 Git 仓库、远程仓库，未执行真实远程推送、公开部署或线上撤回。远程 Git/Actions 流程已实现，模板和状态关联已准备；首次真实联调需要明确的仓库、分支、域名、Pages 配置及用户授权。
- 没有 Hermes 的具体版本与安装位置，所以完成的是通用 CLI 和标准 stdio MCP 接口；尚未验证 Hermes 主机配置或其权限策略。它可依据 [Agent 操作约定](hermes-agent.md) 接入。
- 浏览器覆盖 Chromium 桌面和手机模拟，不代表所有真机、Safari 或读屏软件都已验证。
- 本地工具不是多人在线 CMS。锁协调工具间写入，revision 防止常见旧稿覆盖；任意外部文件编辑和断电仍需人工核对。正文是作者管理的 Markdown，未实现对任意 HTML 的内容沙箱化发布。
- 图片导入支持栅格图并转为 WebP，GIF 只取第一帧；没有图库管理、自动删除未引用图片或后台常驻部署监视服务。
- `.blog` 的幂等记录属于本机，不能在删除这些记录后仍假定旧 requestId 能自动去重；公开源码仓库本身也不会隐藏源码中的草稿。

## 重跑

```powershell
npm.cmd run verify:complete
node scripts/verify-draft-lifecycle.mjs
```

测试需要端口 4321、4324、4333、4336、4337 可用，不要同时启动第二份同端口测试。附件撤回脚本会短暂修改内置测试草稿后恢复，应单独执行，不要并行编辑该文件或发布中间产物。完成后启动 `npm.cmd run studio` 体验，或 `npm.cmd run preview` 检查最终静态构建。
