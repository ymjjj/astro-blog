# 发布中心与首次配置向导

本轮提供本地配置、修改预览、预检和发布任务处理。网站仍是 Astro 静态产物；工作台、CLI、MCP 和 `.blog` 都不成为线上运行依赖。本轮没有推送、真实部署或撤回线上内容。

## 从工作台开始

双击项目根目录 `start-studio.cmd`，或运行 `npm.cmd run studio`，打开 `http://127.0.0.1:4323/`，点击页首“发布中心”。

### 1. 填写目标

展开“首次配置与目标检查”。填写你准备使用的目标，例如：

| 字段 | 示例 | 含义 |
| --- | --- | --- |
| GitHub 仓库 | `your-name/astro-blog` | 所有者与仓库名，不填 Git URL |
| 发布分支 | `main` | 未来已授权的发布分支 |
| HTTPS 站点源 | `https://your-name.github.io` | 不含子路径、用户名密码、查询参数或片段 |
| 站点子路径 | `/astro-blog/` | 项目站点路径，必须以前后斜线包围；根路径填 `/` |

用户站点 `your-name.github.io` 通常使用 `/`。自定义域名按自己的 Pages 设置填写。示例不代表已替你配置这些账号或地址。

“检查候选配置”不保存。“保存配置（远程关闭）”写入本机 `.blog/publish.json`，始终设置 `enabled:false`，包括原来手工开启远程的配置。其他窗口或 Hermes 改过配置时，保存返回 `CONFIG_CONFLICT`；先“重新读取配置”，比较后再保存。

检查覆盖字段格式、本地独立 Git 仓库、当前分支、origin 是否匹配、暂存区、工作流文件存在性及常见 Pages 子路径。检查不回显 origin 原始地址，避免其中可能含有凭据。工作流“存在”不代表 YAML、GitHub 权限或 Pages 设置已经验证；非 main 分支会提醒检查工作流触发条件。

配置向导不初始化 Git、不提交、不创建仓库、不联网检查身份或改 GitHub 设置。真实发布还需要明确授权，并按[部署指南](06-writing-deployment.md)完成配置。凭据使用本机 Git/GitHub CLI 的认证设施，不放入任何博客配置、正文或前端。

### 2. 查看待发布修改

展开“待发布内容与修改预览”，可以搜索标题或内容 ID，查看草稿、新内容、本地修改、与本地提交相同、基线未知、内容错误和本地已移除的条目。

比较基线是 **本地 Git HEAD**，不是线上内容。项目没有独立 Git 仓库或首次提交时，明确显示基线未知；不会因为源文件写了 `draft:false` 就说它已上线。演练也不会清除待审查状态。删掉源文件只表示本地删除，不自动撤回线上内容。

“打开并预览修改”读取该内容的当前磁盘版本。编辑器有未保存修改时会拒绝切换，先保存或处理冲突。

### 3. 预检与演练

选择“发布 / 更新当前内容”或“撤回当前内容”：

- **预览当前修改**：校验项目中全部正文及 Markdown 图片引用，显示这篇内容即将使用的源码、相对本地 HEAD 的逐行差异、本地图片及大小。未知基线时以空基线显示完整源码。发布预览的 `draft:false` 和撤回预览的 `draft:true` 只存在于副本中。
- **完整发布前检查**：在上一步基础上构建隔离副本，并扫描链接、图片和草稿隔离。它不改源文件、正式 `dist` 或线上状态。
- **演练发布 / 演练撤回**：对所选操作进行演练，并保留任务记录。使用现有完整发布核心，仍然不提交、不推送、不上线。预览选择撤回后，按钮相应显示“演练撤回”。CLI/MCP 用 `action:"withdraw"` 演练撤回。

预计地址仅显示为文本，标明“未上线”。真实任务只有确认对应部署成功，才提供“查看网站”链接。完整检查和演练都构建整站：其他已标记公开的本地内容也会参与；其他草稿及其专用图片保持隔离。远程发布核心还会阻止夹带目标正文与配图以外的工作区修改。

每次预检返回 `reviewToken`，绑定目标内容、操作、构建输入、配置和 Git 基线。工作台将其传给 `publish.expectedReview`。检查后其他正文、图片、配置或构建代码变化会使检查过期，返回 `REVIEW_STALE`，需要重新预检。完整构建结束后也再次检查。该令牌不是持久授权，也不替代 `expectedRevision`。

### 4. 任务与失败处理

任务可按全部、失败、本地演练、真实发布筛选。展开详情查看时间线、任务 ID、请求 ID、送检版本、提交号、目标及失败建议。

| 状态 | 可以确认的事实 |
| --- | --- |
| 已保存 | 任务已记录，不代表上线 |
| 检查中 | 正在构建或校验 |
| 演练通过 | 本地隔离副本通过，无提交、推送或上线 |
| 已提交 | 本地 Git 已产生或确认提交 |
| 已推送 | 推送成功，部署结果尚未确认 |
| 部署中 | 等待对应 Actions 结果 |
| 已上线 / 已撤回 | 对应提交、分支、事件及任务的部署成功 |
| 失败 | 展示失败前阶段与处理建议，不等同于回滚或毫无执行 |

失败后“读取当前内容并重新检查”只读取和快速预检，不自动重发。修复后可手动执行完整检查或演练。远程状态查询需要手动点击，不后台轮询。查询失败保留原任务状态，不伪造上线。

| 错误 | 下一步 |
| --- | --- |
| `CONFIG_CONFLICT` | 重新读取并比较配置后保存 |
| `REVISION_CONFLICT` | 读取正文，合并外部修改后保存 |
| `REVIEW_STALE` | 重新预检并使用新令牌 |
| `BUILD_FAILED` | 在本地运行 `npm run check`、`npm run build` 查看字段/Markdown 错误 |
| `VERIFY_FAILED` | 构建后运行 `npm run verify`；检查坏链接、图片与草稿泄露 |
| `REMOTE_DISABLED` | 使用演练；真实发布需要另行授权目标 |
| `REQUEST_INTERRUPTED` | 先查返回的 jobId 或最近任务，确认是否执行过 |
| `STATUS_UNAVAILABLE` | 核对本机身份与网络，再手动查询，保留原状态 |
| 提交/推送后失败 | 保留提交号，先核对本地与远程结果；不要重新创建内容或盲目推送 |

HTTP 超时不等于服务器没有执行。回到“刷新任务”核对相同内容、时间及请求 ID；CLI/MCP 对丢失响应使用相同 requestId 和完全相同参数可回放原结果。已经返回失败且完成修复后，使用新 requestId。

## CLI 与 Hermes/MCP

新增4个操作，共30个 MCP 工具；`config.interfaceVersion` 为3。CLI 输出单个 JSON，失败退出码为1。MCP 名称为 `blog_` 加操作名，参数和规则与界面相同。

| 操作 | 主要参数 | 输出 |
| --- | --- | --- |
| `setup` | 可选 `target` | 本机配置版本、检查项、候选检查结果 |
| `configure` | `target, expectedConfig, requestId` | 保存后的配置；远程始终关闭 |
| `pending` | 可选 `query` | 本地基线和待审查条目 |
| `preflight` | `id, expectedRevision, action?, build?` | `passed`、检查、差异、图片、`reviewToken`、预计地址 |
| `publish`（扩展） | 原参数加可选 `expectedReview` | 原任务结构，加送检版本与建议 |
| `status`（扩展） | 原参数不变 | 任务状态与 `nextSteps` |

`preflight` 成功返回数据不代表检查通过：必须读取 `data.passed`。`buildRequested:false` 表示只做快速检查。为了兼容旧调用方，`publish.expectedReview` 仍可选；旧调用仍检查正文 revision 并执行完整构建，但没有这次新增的“从已审查项目到执行”令牌保护。新客户端与 Hermes 应始终传它。

下面的 PowerShell 示例仅本地配置、检查和演练。先把示例目标换成自己的目标，ID 从 `list` 获取；项目目录内执行：

```powershell
node tools/blog/cli.mjs setup --json
node tools/blog/cli.mjs pending --json
node tools/blog/cli.mjs list --json

# 统一用临时文件传 JSON，避免命令行引号与中文编码问题。
function Invoke-Blog($Operation, $Arguments) {
  $requestFile = [IO.Path]::GetTempFileName()
  try {
    $Arguments | ConvertTo-Json -Depth 20 | Set-Content -Encoding utf8 -LiteralPath $requestFile
    $response = node tools/blog/cli.mjs $Operation --input $requestFile --json | ConvertFrom-Json
    if (-not $response.ok) { throw ($response.error | ConvertTo-Json -Depth 10) }
    return $response.data
  } finally { Remove-Item -LiteralPath $requestFile }
}
$settings = Invoke-Blog 'setup' @{}
$saved = Invoke-Blog 'configure' @{
  target = @{ repository='your-name/astro-blog'; branch='main'; site='https://your-name.github.io'; base='/astro-blog/' }
  expectedConfig = $settings.revision
  requestId = [guid]::NewGuid().ToString()
}
$entry = Invoke-Blog 'read' @{ id='posts/first-publish' }
$review = Invoke-Blog 'preflight' @{ id=$entry.id; expectedRevision=$entry.revision; build=$true }
if (-not $review.passed) { throw ($review.checks | ConvertTo-Json -Depth 10) }
$publishArgs = @{
  id=$entry.id; expectedRevision=$entry.revision; expectedReview=$review.reviewToken
  action='publish'; mode='simulate'; requestId=[guid]::NewGuid().ToString()
}
$job = Invoke-Blog 'publish' $publishArgs
Invoke-Blog 'status' @{ jobId=$job.jobId }
# 响应丢失时可用同一份 $publishArgs 重放，不能修改后仍复用原 requestId。
```

Hermes 建议工作流：

1. `blog_setup({})` 读取现状，缺目标时向用户获取目标，不猜测账号。
2. 用用户指定目标执行 `blog_setup({target})` 检查，保存时 `blog_configure` 携带读取到的 revision（首次不存在为 null）。保存不构成远程授权。
3. `blog_pending` → `blog_read` → `blog_preflight`。向用户准确说明基线、检查通过与否、预计链接是否上线。
4. 明确要求演练后调用 `blog_publish`，使用 `mode:"simulate"` 和刚取得的 expectedRevision / expectedReview。
5. 查询 `blog_status`；失败时按 nextSteps 处理，不自动转为 remote，不跳过过期保护。本轮接口通过标准 MCP 客户端验证，Hermes 实机仍待实际安装信息。

## 开发思路

`tools/blog/contracts.mjs` 定义输入契约，UI/CLI/MCP 共用；`publish-center.mjs` 提供 setup、configure、pending、preflight 和失败建议；`publishing.mjs` 继续负责构建、提交/推送与部署状态，不复制一套发布流程。

配置保存是乐观并发控制：读取文件字节哈希作为版本，保存前匹配版本，再原子替换。敏感输入的 schema 校验在幂等日志之前完成，不把非法凭据请求存入 `.blog/requests`。配置无效时只返回诊断，不回显原文件，工作台的写作/恢复仍可启动。

预检在项目锁中执行，分别校验所有内容，避免一个错误使其他正常条目完全不可见。Git 比较仅运行本地只读命令，没有 fetch、认证查询或网络操作。构建输入哈希包括 src/public/scripts、Astro/包/TS 配置、工作流和本地发布配置，排除运行日志与任务文件，避免任务自身使令牌失效。历史差异复用已有有界行比较算法。

`tools/studio/public/publish-center.js` 渲染配置检查、差异和任务，用 textContent 显示用户正文；代码仅由本机 server 白名单提供。长清单和差异可滚动，沿用原有深浅主题和手机布局。新私有资料不在 public，不会进入生产产物。

缓存也是隔离的一部分：Astro 默认缓存在 node_modules 下，演练副本复用依赖链接时可能共享可写内容缓存。本轮发现并修复了这个问题：Astro/Vite 缓存分别置于每个项目或副本自己的 `.cache/astro`、`.cache/vite`。产物扫描还要求搜索索引与当前公开源文件列表完全一致，拒绝混入其他副本的条目。并发正式构建与演练已有真实构建测试。

局限：Git HEAD 不是部署快照；本地检查不能验证线上 Pages/权限；工作流只检查存在性与常见分支提醒；Markdown 图片检查沿用现有内联图片规则；文件系统外部直接写入不遵守项目锁，虽然前后哈希降低风险，仍无法保证多文件跨进程的绝对原子性。真实发布继续执行原有严格远程检查。本轮无真实远程验收。

验收与截图见 [20号进度记录](20-publish-center-progress.md)。
