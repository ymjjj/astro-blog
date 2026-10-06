# 发布中心与首次配置向导进度

目标：复用现有发布核心，提供仅本地的配置向导、修改预览、发布前检查和清晰的任务/失败处理。保持静态网站与视觉。不执行远程推送、真实发布或线上撤回。

- [x] 检查上轮记录及现有核心、CLI/MCP、工作台和测试设施。
- [x] P0 配置检查与版本保护保存；不通过向导开启远程权限。
- [x] P0 待发布内容、Git 本地基线差异及预检，检查结果防过期。
- [x] P1 工作台配置向导、发布中心、任务详情及失败处理。
- [x] P1 CLI/MCP 共用接口、错误与幂等保护。
- [x] P2 桌面/手机和深浅主题浏览器验收，必要测试及静态隔离验证。
- [x] P2 中文使用/开发指南、接口示例、截图和验证记录。

设计决策：配置保存始终关闭远程发布；基线是本地 Git HEAD，不把它描述为线上版本。未配置 Git 时展示完整本地内容并明确基线未知。预检可以执行隔离构建，演练复用既有 publish。错误提供下一步，不自动重试推送。向导不存凭据、不修改 Git 仓库或 GitHub 设置。

当前：授权范围全部完成，2026-09-27 最终验收通过。42项工具测试、20项工作台浏览器测试、52项网站双路径测试，共114项；根路径与子路径构建及扫描通过，最终 dist 保留根路径。79个文件类型检查零错误、零警告、零提示。中文指南、截图、CLI/MCP示例齐备，无本地阻塞。本轮没有创建真实项目 Git 仓库或填写假目标，仅测试副本使用示例配置；没有远程推送、发布或撤回。

## 回归中发现的问题与修复

1. 向导原先单独初始化，编辑器刚解锁又被短暂锁定，影响快速输入。改为一次初始化，配置/任务/恢复读取完成后再展示可操作的内容列表；四项日常写作浏览器测试先行复验通过。
2. 并行运行演练与网站构建时，共享 node_modules 链接也共享了 Astro 默认内容缓存，导致正式构建读到测试副本的演练条目。改为每个项目/副本独立的 `.cache/astro` 与 `.cache/vite`，增加并发构建测试和源文件—产物索引严格一致性检查。新并发测试实际完成两个构建，确认原稿草稿状态不变、正式产物8条、演练9条，没有混入私有正文。
3. 多套 Playwright 默认输出目录存在父子关系，并行启动会清理其他测试的轨迹文件。改为 `test-results/site`、`test-results/dev`、`test-results/studio` 三个独立目录。最终统一验收顺序执行，避免资源争用；并发构建风险另有专门测试。
4. 搜索框失焦和点击刷新同时发起任务，忙碌保护可能吞掉后一个刷新。待审查内容改为明确点击“刷新修改清单”应用搜索，避免同一操作触发两次请求。

上述失败不是上线结果，没有执行远程操作；均先定位原因后复验。最终工具、工作台及网站矩阵全部通过，补跑不重复计入114项。新增7项工具测试（含并发构建）和6项浏览器测试，较上轮101项增加13项。

## 验证证据入口

- [统一结果](validation/publish-center-complete.json)
- [工具与协议测试](validation/publish-center-tools.log)
- [工作台浏览器测试](validation/publish-center-studio.log)
- [网站双路径矩阵](validation/publish-center-site-matrix.log)
- [文档本地链接检查](validation/publish-center-doc-links.json)
- [中文使用、开发思路和 CLI/MCP/Hermes 示例](21-publish-center-guide.md)

工具覆盖配置默认关闭、配置版本冲突/幂等、非法凭据请求不落日志、损坏配置修复、Git 新增/修改/删除/未知基线、全内容预检、构建输入改变导致检查过期、真实并发构建隔离。协议测试使用官方 MCP SDK 实际发现30个工具并调用配置与预检，CLI 实际读取 pending JSON。

浏览器覆盖配置检查/保存/冲突、修改搜索与源码差异、完整构建、过期检查拒绝、发布/撤回预览、演练不改草稿、坏链接真实失败、失败阶段/建议及读取新版本再检查。桌面与手机分别运行，同时回归自动保存、误关恢复、图片、历史、备份和回收站。测试使用独立副本。

主代理目视检查桌面预检深色与配置浅色、手机配置与预检深色截图；沿用原有蓝色系，长路径换行，未见横向溢出。新流程监听未捕获页面异常，验收结果为空。两种生产路径均扫描98个文件、27个HTML页面、745个本地链接，确认8条公开内容和 draftLeak=false。私有发布配置不进入网站的真实构建测试已通过。文档检查23份文档、165个非代码示例本地链接，无缺失。

## 界面截图

| 场景 | 桌面 | 手机 |
| --- | --- | --- |
| 配置向导浅色 | [查看](screenshots/publish-desktop-setup-light.png) | [查看](screenshots/publish-mobile-setup-light.png) |
| 配置向导深色 | [查看](screenshots/publish-desktop-setup-dark.png) | [查看](screenshots/publish-mobile-setup-dark.png) |
| 修改预检浅色 | [查看](screenshots/publish-desktop-review-light.png) | [查看](screenshots/publish-mobile-review-light.png) |
| 修改预检深色 | [查看](screenshots/publish-desktop-review-dark.png) | [查看](screenshots/publish-mobile-review-dark.png) |
| 失败处理 | [查看](screenshots/publish-desktop-failure.png) | [查看](screenshots/publish-mobile-failure.png) |

## 复现

```powershell
$env:BLOG_VERIFY_LABEL='publish-center'
npm.cmd run verify:complete
```

缺少真实仓库/分支/部署授权及 Hermes 实机信息，不妨碍本轮本地交付。后续真正上线前再由用户指定目标并授权；不把示例配置、预计链接、模拟任务当作已上线。
