# 恢复中心、备份与图片管理进度

目标：恢复副本搜索/预览/空间统计；内容与图片、历史、恢复副本备份及校验；图片引用管理；可审查且可撤销的清理与备份恢复。无真实远程发布。

- [x] P0 共用核心：范围白名单、备份哈希校验、计划令牌、并发检查、事务回收站及撤销。
- [x] P0 图片引用：正文/历史/恢复/回收站及代码中的保守匹配，新图片保护。
- [x] P1 工作台恢复中心、图片缩略图、备份下载/导入、计划预览与确认执行。
- [x] P1 CLI/MCP 接口与协议验证。
- [x] P2 核心和浏览器必要测试，手机/桌面、深浅主题、纯静态及私有资料隔离验证。
- [x] P2 中文指南、开发说明、例子、截图及最终记录。

设计：备份使用有大小上限的 gzip JSON 格式，逐文件 SHA-256 与清单校验；只包含内容资料白名单，不含凭据、发布配置和操作日志。恢复为合并覆盖，不删除备份之外的新文件。批量修改前保存撤销资料，操作中断可在回收站核对并撤销；不自动永久清空回收站。仅受管理的导入图片可清理，存在任何已知引用或导入不足24小时的图片受保护。

当前：授权范围完成。35 项工具测试、14 项工作台浏览器测试和 52 项网站双路径测试全部通过，共101项；根路径与 GitHub Pages 子路径构建、产物扫描通过，保留最终根路径 dist。中文 [使用及开发指南](19-maintenance-guide.md) 已补齐。简单核心测试由 GPT-6 Luna（max）编写，主代理已审阅；复杂实现、安全测试、浏览器与协议验收由主代理完成。没有阻塞，没有执行真实远程发布。

## 验证记录

- [统一报告](validation/maintenance-complete.json)、[工具日志](validation/maintenance-tools.log)、[工作台日志](validation/maintenance-studio.log)、[网站矩阵日志](validation/maintenance-site-matrix.log)。
- 最后清理未使用导入后，[类型复查](validation/maintenance-typecheck-final.log) 确认75个文件零错误、警告及提示。截图检查后改善小文件大小单位与界面中文提示，相关4项浏览器测试再次通过并更新截图，见 [显示复验](validation/maintenance-visual-final.log)，不重复计入101项。
- 恢复和清理在独立测试目录执行，备份下载/导入通过浏览器真实请求，不使用假上线结果。
- 工具验证覆盖二进制图片清理后逐字节撤销、预览后新增引用导致计划过期、回收站引用保护、编码与大小写、跨项目导入恢复、篡改/穿越/危险路径拒绝、幂等执行和模拟中断后的撤销。
- 官方 MCP SDK 实际握手并发现26个工具，执行备份、计划与确认参数校验；CLI 实际校验备份并返回 JSON。
- 隔离项目的真实构建包含私有历史、恢复副本、备份及回收站资料，产物检查确认它们和仅历史引用的图片不进入网站。
- 浏览器确认恢复副本全文预览、搜索、空间显示、清理与撤销；图片缩略图与引用清单；备份下载、导入、校验、恢复及过期计划拒绝；同时回归既有写作功能。

## 截图

- [桌面恢复中心浅色](screenshots/maintenance-desktop-recovery-light.png) / [深色](screenshots/maintenance-desktop-recovery-dark.png)
- [手机恢复中心浅色](screenshots/maintenance-mobile-recovery-light.png) / [深色](screenshots/maintenance-mobile-recovery-dark.png)
- [桌面图片管理](screenshots/maintenance-desktop-images.png) / [手机图片管理](screenshots/maintenance-mobile-images.png)
- [桌面审查清单浅色](screenshots/maintenance-desktop-plan-light.png) / [深色](screenshots/maintenance-desktop-plan-dark.png)
- [手机审查清单浅色](screenshots/maintenance-mobile-plan-light.png) / [深色](screenshots/maintenance-mobile-plan-dark.png)

## 发现与处理

1. 新计划生成前可能仍显示旧计划：每份清单标记独立 planId，重新生成会取消勾选确认；浏览器测试等待对应计划完成，再确认或引入外部修改。
2. 图片引用中夹有普通百分号时，整体 URL 解码会失败：改为只解码合法百分号片段，再按不区分大小写的文件名保守匹配。
3. 原 discard 直接移除副本不便找回：保留原接口响应形状，内部改为先写事务资料再移除，回收站可撤销。
4. 新导入或刚恢复的图片尚未进入正文：保留24小时保护期；站点/手工图片不开放自动清理。
5. 小文件以 MiB 四舍五入后不直观：改为按 B/KiB/MiB 分级显示；界面用“执行”替代内部操作名。

主代理已目视检查桌面图片管理、手机深色清单，维持原有柔和蓝色与布局，无横向溢出。文档链接检查记录见 `docs/validation/maintenance-doc-links.json`。

## 复现与边界

```powershell
$env:BLOG_VERIFY_LABEL='maintenance'
npm.cmd run verify:complete
```

没有执行真实远程推送、公开发布或永久清空。恢复为合并覆盖，资料中可能恢复旧草稿标记，但不会提交或上线。备份不是整站代码镜像，也不包含回收站，大小上限和外部并发限制详见指南。Hermes 实机联调继续等待其实际安装信息，不是本轮本地实现的阻塞。
