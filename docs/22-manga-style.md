# 黑白漫画与视觉简化

2026-09-27，本轮范围已完成。目标是保留柔和蓝色，用少量日本黑白漫画点缀页面，让笔记与日常内容成为主体。

## 设计与实现

- 首页去除胶带、贴纸、重复图注与装饰文案；保留主要标题、简短介绍和阅读入口。
- 首页插画桌面最大宽度 320px，手机宽度 160px。缩小首屏占幅，避免插画压过内容。
- 卡片与侧栏装饰减轻，文章摘要、碎碎念正文仍按时间平行混排。
- 黑白墨线、少量网点与留白替代彩色渲染。浅色背景采用混合方式融入页面，深色保留纸面以保持墨线可读。
- 关于页与三个示例内容的旧彩色配图统一为新漫画。正文文字保留；旧资源也保留，避免破坏已有引用。
- 示例漫画在正文和动态中限制显示宽度；点击放大功能保持可用。其他用户图片不套用这一尺寸限制。

主要实现位置：`src/components/HomeFeed.astro`、`src/styles/global.css`、`src/site.config.js`。网站仍输出静态文件，本轮未修改编辑界面、CLI、MCP 或发布逻辑。

## 插画与性能

使用内置 imagegen 生成两幅原创题材插画，仍属于 AI 生成，不宣称人工绘制。完整提示词见 [生成记录](assets/image-generation.md)。sharp 只用于缩放和 WebP 编码。

| 资源 | 尺寸 | 文件大小 |
| --- | --- | --- |
| manga-writer.webp | 960 × 640 | 48,884 bytes |
| manga-writer-small.webp | 480 × 320 | 16,122 bytes |
| manga-cat.webp | 960 × 640 | 33,152 bytes |
| manga-cat-small.webp | 480 × 320 | 9,138 bytes |

网页资源均在 `public/media/`。首页使用 srcset，手机可以选择小图；原始 PNG 保存在 `src/assets/`，不直接作为首页下载资源。

## 前后对比

| 场景 | 修改前 | 修改后 |
| --- | --- | --- |
| 桌面浅色 | [之前](screenshots/manga-before-desktop.png) | [现在](screenshots/manga-desktop-light.png) |
| 手机浅色 | [之前](screenshots/manga-before-mobile.png) | [现在](screenshots/manga-mobile-light.png) |
| 桌面深色 | — | [现在](screenshots/manga-desktop-dark.png) |
| 手机深色 | — | [现在](screenshots/manga-mobile-dark.png) |

修改前截图来自上轮子路径验收，修改后来自本轮根路径验收；此处用于比较视觉，并不表示本轮重新运行了子路径测试。

## 验证

- `npm.cmd run build`：通过，生成 27 个静态页面。首次沙箱内执行遇到依赖加载异常，沙箱外构建通过。
- `node scripts/verify-build.mjs`：通过，检查 101 个文件、745 个链接、8 条公开内容，未发现草稿泄漏。
- `npx.cmd playwright test`：24 / 24 通过，涵盖桌面与手机、深浅主题、页面与图片、混排分页、搜索、无脚本阅读、复制、目录、图片放大、更新时间与草稿隔离。[完整浏览器结果](validation/manga-browser.json)
- 人工查看桌面浅色、桌面深色、手机浅色、手机深色截图，确认图片大小、留白和内容层级。
- 本轮测试使用根路径；没有执行真实远程推送或上线操作。

体验：项目目录运行 `npm.cmd run dev`，打开终端显示的本地地址。日常写作仍可使用 `start-studio.cmd`。
