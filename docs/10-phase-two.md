# 第二阶段：写作预览与阅读工具

## 目标与实施约定

保持 Astro 静态输出、现有配色和页面结构。新增五项功能：

1. 仅本地 `dev` 提供草稿入口和详情预览；草稿标记明确，搜索、RSS、归档、标签仍只含已发布内容。生产构建不生成草稿入口、正文或专用附件。
2. 正文和动态配图可以点击/键盘打开放大层，支持关闭按钮、Escape、背景点击，关闭后恢复焦点；不改变有链接图片原本的导航行为。
3. 代码块有复制按钮，成功/失败均有提示，复制的是代码原文，不包含按钮文字；浏览器限制剪贴板时保留可选中复制的原文。
4. 目录根据滚动位置标示当前章节，锚点、键盘和无脚本阅读仍有效。
5. 文章支持可选 updated 日期，不能早于发布日期；未填写时不假装更新。详情与列表显示更新时间，SEO 和 sitemap 同步。

## 验收计划

- 类型检查、根路径及仓库子路径生产构建、全站链接扫描。
- 桌面和手机浏览器：图片层打开/关闭/焦点/暗色，复制成功和失败，目录滚动/锚点/历史定位，更新时间及无更新时间的文章。
- 本地 dev：草稿文章、无标题动态、专用图片可预览，保存后更新，公开索引保持过滤。
- 从已预览草稿的开发环境切换生产构建，扫描所有产物并检查草稿 URL 与入口不存在。
- 保存测试记录、截图，更新旧文档中与草稿预览冲突的说明。

## 本地草稿预览：两层边界

第一层位于 astro.config.mjs：`astro:config:setup` 获得实际运行命令，通过 Vite define 注入 `__LOCAL_DRAFTS__` 常量。仅 `dev` 为 true。相比判断 NODE_ENV，这种方式不会被 `build --mode development` 意外启用。类型声明在 src/env.d.ts。

第二层位于数据读取：published-loader.ts 在生产模式先排除草稿再渲染 Markdown，避免图片依赖泄露。本地模式才将草稿送入集合。content.ts 将公开 published() 与本地详情 readable() 分开，搜索、RSS、标签、归档和首页始终用前者。

`pages/drafts/[...page].astro` 利用可选剩余路由：dev 的 getStaticPaths 返回一个 page 为 undefined 的路径，生成 `/drafts/`；生产返回空数组，因此没有草稿箱文件。文章和动态详情读取 readable()，草稿页显示 DraftBanner 和 noindex。普通页面不会混入草稿。

练习：运行 dev，打开草稿箱，修改 unpublished-test.md 正文；不改 draft 即可看到更新。然后停止 dev，build + preview，同一地址应为 404，草稿箱入口也应消失。不要把本地开发服务当作公网托管服务。

## 图片放大：让原图保持原来的用途

ReadingTools.astro 提供空的原生 dialog，不预加载一份隐藏大图。reading-tools.ts 扫描 `.prose img`，为没有链接的图片增加按钮，点击时才放入 currentSrc 对应的图片。图片原本位于链接中时不劫持链接，封面装饰图不在扫描范围。

原生 showModal 提供模态语义；关闭按钮、Escape、背景点击都可以关闭。打开时锁定页面滚动并聚焦关闭按钮，Tab/Shift+Tab 在当前唯一的交互控件上循环，关闭时恢复原图按钮焦点和页面滚动。尺寸使用视口上限，手机和暗色模式沿用现有变量。这里提供适应屏幕的放大查看，不实现相册切换、拖拽或编辑。

练习：仅用键盘 Tab 到正文图片，Enter 打开，Escape 关闭，确认焦点回到同一张图片。新增可交互控件时必须同步更新弹层的焦点循环逻辑。

## 代码复制：成功提示必须有真实依据

脚本给每个 pre/code 增加外部工具条。按钮放在 pre 外，复制时读取 code.textContent，因此不会混入按钮文字，也不会删除空格和空行。Clipboard API 成功返回后才显示“已复制”；权限拒绝或 API 不可用时显示“请手动复制”，用 Range 选中原文。可见按钮提示与 aria-live 状态同时更新。

真实浏览器验收会写入并读取系统剪贴板；另外用受控失败验证错误分支。Windows 可能把 LF 转换为 CRLF，因此测试只对系统读回内容统一换行，仍严格比较其他字符。网页本身不修改代码文本。

## 目录高亮：位置状态不等于导航历史

目录仍是普通锚点链接。脚本将链接与标题元素对应，选择阅读线（距视口顶部 130px）之前最近的标题；到文章底部选中最后一项。通过 aria-current="location" 同时表达视觉与辅助技术状态。

滚动事件只预约一次 requestAnimationFrame，避免同一帧重复计算。resize、hashchange、pageshow、load 和正文 ResizeObserver 处理窗口变化、直接打开锚点、浏览器返回以及图片加载后的布局变化。自动高亮不改 hash，用户点击锚点时才由浏览器正常导航。

练习：拖动滚动条到不同章节，再点击目录，最后按浏览器返回。高亮应跟随真实位置，返回键也应保持原有作用。

## 最后更新日期：内容元数据也是产品约定

文章 schema 增加可选 updated，并通过 refine 拒绝早于 date 的时间。UpdatedDate 组件只负责格式化与展示；没有值时没有任何输出。详情提供 article:modified_time，站点地图对有更新日期的文章提供 lastmod。RSS pubDate 和列表排序继续表达首次发布日期，更新旧文不会伪装成新文章。

示例 markdown-notes.md 已填写 updated。作者实质修改文章后自行维护；模板中的注释说明格式。新增字段时要同时考虑校验、组件、元信息和教程，不能只改页面上显示的一行文字。

## 测试入口与参考

- `tests/reading-tools.spec.ts`：真实剪贴板、错误分支、图片层键盘交互、目录、更新日期、无脚本和生产过滤。
- `tests/dev/drafts.spec.ts`：开发环境草稿箱、文章、动态、图片、保存更新，以及所有公开出口的过滤。
- `scripts/verify-phase-two.mjs`：故意写入非法 updated 验证失败并恢复，再检查 development mode 构建不会开启草稿。
- `npm run verify:all`：两种路径各先测 dev，再测生产，实现从“看过草稿”到“生产输出”的连续验证。

实测数据与截图见 [第二阶段验收记录](11-phase-two-validation.md)。

参考：[Astro Integration API](https://docs.astro.build/en/reference/integrations-reference/)、[可选剩余路由参数](https://docs.astro.build/en/reference/errors/get-static-paths-invalid-route-param/)、[原生 dialog](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog)、[Clipboard.writeText](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText)。
