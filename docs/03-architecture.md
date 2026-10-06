# 架构：从一段文字到一个网页

## 请求发生之前，页面已经存在

本项目采用 Astro 静态模式。构建机器运行 Node，读取 Markdown、验证字段、渲染组件，最后将静态文件写入 dist。读者访问 GitHub Pages 时获取现成的 HTML，不触发数据库查询，也不运行 Astro 服务端。

```mermaid
flowchart LR
  A[Markdown 与图片] --> B[集合校验]
  B --> C[统一 published 过滤]
  C --> D[文章与动态页面]
  C --> E[搜索 JSON / RSS / sitemap]
  D --> F[dist 静态文件]
  E --> F
  F --> G[GitHub Pages]
```

生产加载阶段先验证元数据并剔除草稿，再渲染已发布正文，避免草稿图片成为依赖。生产构建强制清理缓存，并实际扫描 dist 验证隔离，不能仅凭页面没有链接就认定私有附件未输出。本地 dev 可加载草稿，通过 readable() 提供给详情和草稿箱；公开出口继续使用 published()。

## 内容集合解决什么问题

`src/content.config.ts` 通过自定义 publishedLoader 递归读取 Markdown，Zod 检查字段。与直接读任意文本相比，集合让错写日期、遗漏摘要等问题尽早暴露。文章和动态分开，是因为文章必须有标题和摘要，动态允许只写正文。两者都要求日期、支持标签，缺省 draft 为 true。

这里没有直接采用默认 glob 加载器：实际验证发现，默认加载会渲染草稿并导入其图片，即便页面查询过滤了草稿。自定义加载器依次调用 parseData、判断 draft、renderMarkdown、store.set，并记录已发布内容的图片依赖；开发模式监听 Markdown 增删改。这样将发布判断放在资源处理之前。实现使用 Astro 公开 Loader API，没有修改框架内部代码。

`src/lib/content.ts` 的 published() 是公开内容入口。列表、详情路由、归档、标签、搜索、RSS 与 sitemap 都从这里获得条目。新增输出时也必须使用这个入口，而不能直接 getCollection 后忘记过滤。

## 一个文章路由如何产生

`src/pages/posts/[...id].astro` 中 getStaticPaths() 返回每篇已发布文章的 id 和 entry。Astro 据此产生 `/posts/static-garden/index.html` 等文件。正文通过 render(entry) 生成 Content 组件，同时获得 headings，目录复用这些标题和锚点，所以不需要在浏览器重新解析标题。

`Base.astro` 管网站外壳，`PostCard` 管列表摘要，文章详情页管正文和目录。这使列表换版不会影响正文渲染。

## Markdown 管线

当前安装 Astro 7.3.5。为了使用 remark-math 与 rehype-katex，显式安装 `@astrojs/markdown-remark` 并配置 `unified()`。remark 将公式标记转换为语法节点，rehype-katex 将其渲染为 HTML/MathML，KaTeX CSS 和字体在本站提供；浏览器不需要加载第三方公式脚本。代码高亮同样在构建时完成。

`remark-local-paths.mjs` 遍历 Markdown 链接和图片节点，为以单斜杠开头的站内路径添加部署 base。这样正文里的 `/media/window-notes.webp` 在仓库站点变成 `/astro-blog/media/window-notes.webp`。外部地址和相对图片引用不变。原始 HTML 不经过这条节点规则，写内容时应优先用 Markdown 语法。

## 哪些逻辑在浏览器运行

主题切换、搜索、图片放大、代码复制和目录高亮使用少量原生客户端脚本。搜索页按需读取构建生成的 search-index.json，以 Unicode NFKC 规范化后的大小写无关子串匹配中文、英文和标签。空格分隔的多个词必须同时匹配。它不提供中文分词、拼音或模糊纠错；适合个人博客的初始规模。

搜索结果通过 textContent 插入，不把查询或内容字符串作为 HTML 执行。主题在 head 里先读取偏好，避免页面加载后突然换色；存储不可用时仍可切换当前页。

## 路径、域名与时区

site 是域名 origin，base 是路径前缀，两者不能混为一谈。`BLOG_SITE=https://name.github.io`、`BLOG_BASE=/notes` 会得到 `https://name.github.io/notes/`。组件统一调用 url()；Markdown 用路径插件；RSS、SEO 和 sitemap 使用相同配置。

日期保存带时区的 ISO 时间，展示和归档使用 site.config.js 中的 Asia/Hong_Kong。排序依据时间戳，避免部署机器时区改变文章顺序。

## 参考资料

- [Astro 内容集合](https://docs.astro.build/en/guides/content-collections/)
- [Astro 7 Markdown 处理器变化](https://docs.astro.build/en/guides/upgrade-to/v7/)
- [Astro GitHub Pages 部署](https://docs.astro.build/en/guides/deploy/github/)

这些资料说明框架机制；本项目的具体字段、命令和目录以当前源码和文档为准。
