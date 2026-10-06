# 环境、启动与目录

## 先理解三个命令

`dev` 提供开发预览，文件修改后自动更新。`build` 读取内容与模板，生成最终 HTML、CSS、JS 与资源。`preview` 只用于检查已经生成的结果，修改源码后应先重新 build。

首次安装使用 Node 24 LTS 与 `npm ci`。ci 严格采用 package-lock.json 中的依赖树，别人和 CI 可以重现相同版本。修改依赖才使用 npm install，并同时保存 lockfile。

```powershell
cd D:\projects\astro-blog
npm.cmd ci
npm.cmd run dev
```

如果 4321 端口占用，Astro 可能选择下一端口，以终端提示为准。指定端口可用 `npm.cmd run dev -- --port 4322`。不要运行两个争抢同一端口的预览服务。

## 目录地图

```text
astro.config.mjs          构建、域名、base、Markdown 处理器
src/site.config.js       名称、作者、简介、时区等个人配置
src/content.config.ts    内容字段校验
src/content/posts/       文章 Markdown
src/content/moments/     短动态 Markdown
src/assets/              随内容引用的资源，不会整目录公开复制
src/lib/content.ts       发布过滤、排序、URL、日期、摘要等共用逻辑
src/lib/published-loader.ts 生产渲染前过滤草稿，dev 允许本地预览
src/scripts/reading-tools.ts 图片放大、代码复制、目录高亮
src/lib/remark-local-paths.mjs  Markdown 站内路径处理
src/layouts/Base.astro   HTML 外壳、导航、SEO、主题、页脚
src/components/          可复用展示组件
src/styles/global.css   色彩、排版、布局、响应式样式
src/pages/              URL 对应的页面及构建时输出的 JSON/XML
public/                 原样复制到 dist 的公开资源
templates/              写作模板，不参与构建
scripts/                新建内容与构建结果验证脚本
tests/                  真实浏览器行为检查
docs/                   学习文档、截图、验证记录
assets/source/          插画原图，不部署
.github/workflows/      自动发布配置
dist/                   构建输出，不提交 Git
.astro/                 Astro 生成的类型和缓存，不提交 Git
```

## 日常修改的最短路径

- 改站名与自我介绍：site.config.js，不必逐页替换。
- 写内容：content 下的 Markdown；不用动页面代码。
- 改首页结构：pages/index.astro；重复区块到 components 中找。
- 改颜色与尺寸：global.css 的语义变量和相应组件样式。
- 新增页面：pages 下新增 `.astro` 文件并套用 Base。

这些分层将内容、外观与构建逻辑分开。换配色无需重写笔记，未来写作工具也无需懂页面组件。

## 检查命令

`npm run check` 检查 Astro/TypeScript 类型；`npm run build` 检查实际渲染；`npm run verify` 遍历 dist 核对链接和草稿；`npm test` 启动生产预览并用 Chromium 执行桌面/手机测试。第一次运行浏览器测试先执行 `npx.cmd playwright install chromium`。浏览器测试前必须 build，且 4321 端口空闲。

查看最终验收使用的命令与结果：[验证报告](09-validation.md)。

第二阶段新增本地草稿箱及阅读工具，当前验收见 [第二阶段验证](11-phase-two-validation.md)。`npm run verify:all` 现在还会在每种 base 下启动本地开发服务验证草稿，再构建生产版本检查隔离；确保 4321 和 4324 端口空闲。
