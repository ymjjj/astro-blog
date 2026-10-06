# 日常写作与工具操作

这份指南介绍本地写作台、命令行、MCP 和发布流程。内容的正式来源始终是项目里的 Markdown 文件；写作台和命令行只是帮你读写这些文件。

## 打开本地写作台

需要 Node.js 22.12 或更新版本。首次使用或依赖有变化时，在项目根目录运行 `npm.cmd ci`，然后启动写作台：

```powershell
npm.cmd run studio
```

Windows 也可以双击项目根目录的 `start-studio.cmd`。浏览器打开终端显示的写作台地址，默认是 `http://127.0.0.1:4323/`；本地预览默认使用 `http://127.0.0.1:4325/`。两个服务都只监听本机。保持终端窗口打开，结束时在窗口按 `Ctrl+C`。

写作台中点“新建”，选择“文章”或“碎碎念”，填写日期、标签和正文，再点“保存草稿”。文章必须有标题和摘要；碎碎念可以不填标题。新内容默认是草稿，不会自动上线。草稿可在本地预览；公开列表、搜索和生产站点只显示已发布内容。

点“保存并预览”会先保存当前内容，再打开本地预览。文章或碎碎念已保存后，可以点“插入图片”选择电脑中的图片，写一段替代文本。工具会压缩图片、把 Markdown 图片引用插入正文；这一步还没有保存正文，完成后要再点“保存”。支持 JPEG、PNG、WebP、GIF 和 AVIF，单张原图最多 10 MB；图片会转换为 WebP，最长边不超过 1800 像素，GIF 只取第一帧。

修改已有内容时，保存只更新本地 Markdown。若它原本已标记为发布，线上网站仍不会因此更新；需要另行完成远程发布。文件名创建后就是内容的稳定地址，不要为了改标题而随意改文件名。

## 命令行：10 个操作

机器调用建议直接运行 `node tools/blog/cli.mjs ...`；`npm run blog -- ...` 会额外输出 npm 的启动横幅，适合人在终端使用，不适合直接把完整 stdout 交给 JSON.parse。仓库提供了 [新建文章输入样例](../examples/create-post.json)。

命令行输入和输出都是 JSON。Windows 建议把 JSON 存成 UTF-8 文件，再用 `--input` 读取，避免 PowerShell 控制台编码改坏中文；带 UTF-8 BOM 的文件也支持。`--stdin` 也可用，但输入必须是 UTF-8。`--root` 必须是项目目录的绝对路径；省略时默认使用 CLI 所在的项目目录。`--json` 是可选标记，输出本来就始终是 JSON。

```powershell
npm.cmd run blog -- <操作> --input "C:\path\to\request.json" --root "D:\projects\astro-blog" --json
```

可用操作如下：

| 操作      | 用途                                           |
| --------- | ---------------------------------------------- |
| `list`    | 列出或搜索文章、碎碎念，可按类型和草稿状态筛选 |
| `read`    | 读取一条内容及其 `revision`                    |
| `create`  | 新建草稿                                       |
| `update`  | 按 `revision` 更新内容                         |
| `image`   | 导入图片并返回 Markdown 引用                   |
| `check`   | 校验内容字段和本地图片；可选做隔离构建         |
| `preview` | 返回本地开发预览地址                           |
| `publish` | 默认做发布演练；明确指定时才进入远程模式       |
| `status`  | 查看发布任务；可查询对应的 GitHub Actions 运行 |
| `config`  | 查看脱敏后的发布配置状态                       |

### 新建文章或碎碎念

把下面内容保存为 `create-post.json`。换成你自己的文件名、标题和正文；`slug` 使用英文小写、数字和连字符。

```json
{
  "kind": "posts",
  "slug": "first-note",
  "title": "我的第一篇文章",
  "description": "记录一个今天想清楚的问题。",
  "date": "2026-09-27T10:00:00+08:00",
  "tags": ["日常写作"],
  "body": "# 从一句话开始\n\n这里写 Markdown 正文。",
  "requestId": "post-create-20260927-01"
}
```

运行：

```powershell
npm.cmd run blog -- create --input "C:\path\to\create-post.json" --root "D:\projects\astro-blog" --json
```

新建碎碎念时，`kind` 改成 `moments`，并把 `slug` 和正文换成自己的内容。可以省略 `title` 和 `description`：

```json
{
  "kind": "moments",
  "slug": "small-discovery",
  "date": "2026-09-27T11:00:00+08:00",
  "tags": ["生活"],
  "body": "今天发现，慢一点也能把事情做好。",
  "requestId": "moment-create-20260927-01"
}
```

两种内容都需要非空 `body` 和 `requestId`；文章还需要 `title` 与 `description`。日期使用带时区的 ISO 格式。省略 `slug` 时工具会自动生成 ID。创建结果里的 `id` 是后续读取、插图、检查和发布要使用的稳定标识，例如 `posts/first-note`。

### 读取、修改与 revision

修改前先用 `read` 读取最新版本：

```json
{ "id": "posts/first-note" }
```

```powershell
npm.cmd run blog -- read --input "C:\path\to\read.json" --root "D:\projects\astro-blog" --json
```

结果中的 `revision` 是这份 Markdown 当前版本的校验值。把它连同新的正文、`id` 和全新的 `requestId` 放进 `update` 请求。以下只是结构示例；将 revision 替换成刚才 `read` 返回的完整值：

```json
{
  "id": "posts/first-note",
  "expectedRevision": "替换为 read 返回的 64 位 revision",
  "requestId": "post-update-20260927-01",
  "title": "我的第一篇文章",
  "description": "更新后的摘要。",
  "body": "# 更新后的正文\n\n继续写 Markdown。"
}
```

`update` 会保留原来的草稿或发布状态。如果 revision 冲突，先重新 `read`，对照最新正文合并自己的修改，再用最新 revision 和新的 requestId 保存。不要拿旧 revision 盲目重试覆盖别人刚保存的内容。

### 插图后保存

对已存在的内容调用 `image`。`file` 建议填写图片的绝对路径；也可以用 `base64`，但两者只能选一个。

```json
{
  "id": "posts/first-note",
  "file": "C:\\Users\\you\\Pictures\\window.jpg",
  "alt": "窗边的一本笔记",
  "requestId": "post-image-20260927-01"
}
```

```powershell
npm.cmd run blog -- image --input "C:\path\to\image.json" --root "D:\projects\astro-blog" --json
```

结果会包含 `markdown`，例如 `![窗边的一本笔记](../../assets/uploads/....webp)`。图片已写入 `src/assets/uploads/`，但正文还没有变化。将返回的 Markdown 插入正文，再用 `update` 保存；更新时仍要提供 `id`、最近一次读取的 `expectedRevision`、新的 `requestId` 和完整 `body`。写作台的图片按钮会帮你插入这段 Markdown，但也需要再点一次“保存”。

## 检查与本地预览

`check` 不带 `id` 时检查全部内容和本地图片；提供 `id` 时只检查一条。加上 `"build": true` 会在隔离副本中做生产构建和产物扫描，检查不会替你发布：

```json
{ "id": "posts/first-note", "build": true }
```

运行 `preview` 前先启动写作台，或在另一个终端运行 `npm.cmd run dev`。它返回的是本机开发地址；草稿只有在开发模式中可见。生产构建和 `npm.cmd run preview` 不会显示草稿。

## 发布演练、远程发布和状态

`publish` 必须带内容 `id`、最近一次 `read` 得到的 `expectedRevision` 和新的 `requestId`。默认 `mode` 是 `simulate`，默认 `action` 是 `publish`。演练会在临时隔离副本中构建“若发布后会是什么样”，不会修改原 Markdown 的草稿状态，不会提交、推送或上线：

```json
{
  "id": "posts/first-note",
  "expectedRevision": "替换为 read 返回的 64 位 revision",
  "requestId": "post-simulate-20260927-01"
}
```

只有在内容所有者明确授权目标仓库和操作后，才使用 `"mode":"remote"`；撤回时再加 `"action":"withdraw"`。远程配置文件 `.blog/publish.json` 的格式可参考项目根目录的 `blog.publish.example.json`。示例本身 `enabled` 为 `false`，其中仓库名、网址和 base 都是占位内容；复制格式不等于获得发布授权。本指南不会替你创建或启用远程配置。

远程发布会检查 `origin`、当前分支、GitHub CLI 登录状态和工作区。发布前应有干净的 Git 基线：暂存区必须为空，本地 `HEAD` 必须与配置的 `origin` 分支一致；未提交改动只能是本次目标 Markdown 和它引用的图片，其他已修改或未跟踪文件都会阻止发布。先检查并处理好其他改动，再考虑远程模式。用 `gh auth login` 配置本机 GitHub CLI 身份；不要把 token 写进 `.blog/publish.json`、命令、Markdown 或仓库文件。Git 提交还需要本机已设置提交者姓名和邮箱。

示例工作流在 `.github/workflows/deploy.yml` 中，默认发布分支是 `main`。自定义分支时，`.blog/publish.json` 的 `branch`、工作流的触发分支和实际要部署的分支必须一致。`site` 填站点的 HTTPS 根网址；仓库子路径放在 `base`，例如 `/my-blog/`。不要把仓库路径重复写入 `site`。

发布结果里的 `jobId` 可用于查询状态。`status` 不带参数会列出最近任务；要刷新一个远程任务，使用：

```json
{ "jobId": "替换为 publish 返回的 jobId", "refresh": true }
```

“已推送”只表示 Git 推送完成，不代表部署成功或网站已更新。刷新后只有匹配本次提交的 Actions 成功，状态才会变为“已上线”或“已撤回”。如果远程任务失败或中断，先保留 `jobId` 和提交号，用 `status` 刷新并人工查看对应的 GitHub Actions、`git status` 与远程分支；确认线上结果和本地内容后，再决定下一步。不要重复创建内容、强行重置分支或盲目重试旧请求。requestId 相同且参数完全相同的重复请求会返回原结果；同一 requestId 改了参数会报 `REQUEST_CONFLICT`。中断请求会要求先读取内容或发布状态，再用新 requestId 操作。

远程发布配置和线上授权尚未由本指南设置。遇到推送或部署结果不明确时，先停在人工核对，不要据一个本地成功提示宣称网站已上线。

## 常见问题与恢复

| 提示                             | 处理方式                                                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `REVISION_CONFLICT`              | 保留编辑框文字，重新读取原稿并合并；不要只拿新 revision 覆盖                                                                            |
| `REQUEST_CONFLICT`               | 同一 requestId 已用于其他参数；新的操作使用新的 ID                                                                                      |
| `REQUEST_INTERRUPTED`            | 查源文件与 job 结果；有可能已写入，不能盲目重做                                                                                         |
| `BUSY`                           | 等当前操作结束。若进程异常退出，先查看 `.blog/lock/owner.json`，确认对应进程和构建都已停止，才人工移除 `.blog/lock`；不要删整份 `.blog` |
| `REMOTE_DISABLED`                | 尚未配置授权发布目标，可继续写作和演练；不要为了消除报错擅自启用                                                                        |
| `DIRTY_INDEX` / `DIRTY_WORKTREE` | 审查其他暂存或修改；发布器只提交当前内容与配图                                                                                          |
| `UNSYNCED_BRANCH`                | 先审查并同步本地与远程，不强推或强行重置                                                                                                |
| `BUILD_FAILED` / `VERIFY_FAILED` | 检查元数据、正文图片、重复一级标题和站内链接；本次原稿状态未被演练改变，修复后使用新 requestId                                          |
| 预览空白                         | 确认 4325 预览服务已启动且未被占用；先独立窗口打开。新文件路由更新可能稍有延迟                                                          |

如果已经生成发布任务，失败响应也会带 `data` 和错误详情中的 `jobId`；可以从任务列表查询。参数或配置在任务创建前就失败时不会生成 job。CLI 对失败响应返回非零退出码，MCP 标记 isError。工作台的任务面板同样显示失败原因。

手动触发且没有新提交的部署使用 `blog_request_id` 工作流输入与运行标题关联本次 job。不要删除模板中的输入和 `run-name`；直接手动重跑时也要核对任务 ID，避免把上次成功当成本次成功。底层使用 GitHub CLI 的 [工作流触发](https://cli.github.com/manual/gh_workflow_run) 与 [运行查询](https://cli.github.com/manual/gh_run_list)。

## 源文件与部署产物

文章和碎碎念分别保存在 `src/content/posts/` 与 `src/content/moments/` 下的 Markdown 文件中。图片导入到 `src/assets/uploads/`；草稿图片留在源码目录，不会因为导入动作就公开。生产构建会过滤草稿 Markdown、处理内容引用的 `src/assets/` 图片，并将 `public/` 中的文件复制到 `dist/`。部署工作流上传的是 `dist/`，不是整个项目目录。`.blog/` 存放本机请求幂等记录、发布任务和临时数据，已被 `.gitignore` 排除；不要把 `dist/` 当作内容源手工编辑。

## 通用 MCP 主机配置

可复制的配置文件见 [examples/mcp-config.json](../examples/mcp-config.json)。给 Agent 的完整操作约定与任务示例见 [hermes-agent.md](hermes-agent.md)。

项目实现了标准 MCP stdio 服务。支持 `mcpServers` 配置格式的主机可以按下面方式启动它；将两个路径都换成实际的绝对路径。Windows JSON 配置里的反斜线要写成 `\\`：

```json
{
  "mcpServers": {
    "astro-blog": {
      "command": "node",
      "args": [
        "D:\\projects\\astro-blog\\tools\\blog\\mcp.mjs",
        "--root",
        "D:\\projects\\astro-blog"
      ]
    }
  }
}
```

主机需要能在 PATH 中找到 Node，并支持通过标准输入、标准输出启动 MCP 服务。服务提供 `blog_list`、`blog_read`、`blog_create`、`blog_update`、`blog_image`、`blog_check`、`blog_preview`、`blog_publish`、`blog_status` 和 `blog_config` 工具，和命令行共用同一套参数校验及内容核心。Hermes 的具体版本与配置格式目前未知，因此这里只给通用 stdio 配置，不能据此声称已经原生集成 Hermes；请按你安装的 Hermes 版本文档确认它是否支持这种 MCP 启动方式。

## 自动保存与历史功能补充

工作台现已支持防抖自动保存、误关找回、粘贴/拖拽配图与版本比较恢复；CLI/MCP 新增七个共用接口。操作步骤、并发保护和恢复示例见 [日常写作指南](17-daily-writing.md)。以下原有发布与配置流程继续适用。
