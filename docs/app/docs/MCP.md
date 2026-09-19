# Skylense MCP · 本地只读图查询

Skylense 0.2.0 提供一个依赖 Node.js 22+ 的本地 **stdio MCP server**。CLI、TUI 和 MCP 共用 `lib/workspace.mjs` 查询核心。生产代码不依赖 MCP SDK，也不运行被展示仓库的源码。

默认读取随项目发布的 `autoresearch`、`langgraph`、`vllm` 三个固定提交模型。它们是人工整理的精选源码地图，包含层级、关系、函数卡和证据永久链接；不是完整仓库调用图，也不是运行轨迹。MCP 不联网更新模型。

## 启动与客户端配置

从项目根目录启动：

```sh
node server/mcp.mjs
```

进程等待客户端从 stdin 发送消息。stdout 只写 MCP JSON-RPC，诊断写 stderr。不要把该命令当作交互 shell。客户端关闭 stdin 后，服务进程退出。

在支持 **本地 stdio MCP** 的客户端中使用下列配置形状，并把两个路径替换成你机器上的绝对路径。客户端实际配置文件的位置、字段包装和重启方式由该客户端决定；此项目不会修改任何全局客户端配置。

```json
{
  "mcpServers": {
    "skylense": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/skylense/server/mcp.mjs"]
    }
  }
}
```

可以在终端运行 `node -p process.execPath` 查看 Node 可执行文件的绝对路径。无需依赖客户端的工作目录。

加载自己的模型时，在**进程启动配置**中追加参数：

```json
{
  "command": "/absolute/path/to/node",
  "args": [
    "/absolute/path/to/skylense/server/mcp.mjs",
    "--model",
    "/absolute/path/to/model.json"
  ]
}
```

自定义模型固定使用仓库 ID `custom`，即使文件里的 `meta.id` 与内置模型相同，也不会替换内置模型。文件必须是 ≤15 MiB 的有效 UTF-8 JSON，通过项目现有的 `AtlasGraph.validate` 校验，且边 ID 不得与节点或容器 ID 冲突。文件在启动时读取一次；修改后需重启进程。不会执行 JavaScript 模型文件。

## 六个工具

| 工具 | 参数 | 返回内容 |
| --- | --- | --- |
| `skylense_list` | 无 | 仓库、提交、计数、可用场景 ID |
| `skylense_search` | `repo`, `query`, 可选 `limit`（默认 20，1–100） | 节点、容器和边的字面搜索结果；空白分词后取 AND，包含函数名和说明 |
| `skylense_inspect` | `repo`, `id` | 原始详情、祖先、子项和来源证据；节点返回直接关系，容器返回后代叶节点的跨界入边/出边及独立的内部边，边返回两端摘要 |
| `skylense_traverse` | `repo`, `id`, 可选 `direction`、`depth` | 从节点做上游、下游或双向遍历；默认下游、深度 3；深度 0–12 |
| `skylense_flow` | `repo`, `id` | 场景指定的节点和边，保留分支、反馈和原始排列 |
| `skylense_view` | `repo`, 可选 `selection` | 当前 Web 视图的本地 URL；不会启动服务或打开浏览器 |

所有工具声明 `readOnlyHint: true`、`destructiveHint: false`、`idempotentHint: true`、`openWorldHint: false`。每次成功调用同时返回 `structuredContent` 和内容相同的 JSON 文本块，便于新旧客户端读取。

示例参数：

```json
{"repo":"vllm","id":"VL_SCHEDULER"}
```

```json
{"repo":"langgraph","id":"LG_STREAM","direction":"downstream","depth":2}
```

```json
{"repo":"autoresearch","selection":{"focus":"AR_gpt_forward","tab":"evidence"}}
```

`selection` 接受 `focus`（节点/容器）、`scope`（容器或 `system`）、`flow`、`edge`、`mode`（`hierarchy` / `components` / `flow`）、`tab`。`flow` 模式需要场景 ID，默认聚焦该场景的首节点；指定场景内节点时，会同步讲解步骤，场景外节点会明确报错。`edge` 会选择其源节点和关系。节点/容器支持 `overview`、`connections`、`contracts`、`context`、`evidence`；关系支持 `overview`、`members`、`context`、`evidence`，默认 `overview`。未知字段、ID 或冲突的选择会明确报错。

Web URL 指向 `http://127.0.0.1:4173/index.html?example=...#...`。请先在项目根目录运行 `node scripts/serve.mjs`。自定义模型只存在于当前查询进程，`view` 会返回 `supported: false` 与 `url: null`；要在 Web 中查看，应通过页面的 Import 控件导入同一份 JSON。

遍历以最少跳数限制可达节点，并返回这些节点间的原始有向关系，包括循环、平行边和回边。`truncated: true` 表示深度边界外还有可达节点。容器查询会聚合所有后代叶节点的真实跨界关系，`incoming` / `outgoing` 的 `node` 是外部端点；`internal` 保留内部原始边，`descendants` 列出后代叶节点。不会虚构一条容器运行时边。进一步遍历时，从具体叶节点开始。

## 协议与边界

实现遵循官方 [stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)、[lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle) 和 [tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) 规范：UTF-8、每行一个 JSON-RPC 消息，先 `initialize`，再 `notifications/initialized`，随后使用工具。`ping` 可在初始化前使用。

支持协商 `2025-11-25`、`2025-06-18`、`2025-03-26`；客户端请求已支持版本时原样返回，否则建议最新支持版本，由客户端决定是否继续。只声明 `tools` capability；未实现 HTTP、resources、prompts、sampling 或异步 tasks。

单条输入最多 1 MiB，返回内容有 4 MiB 的传输上限预算；请求采用每秒补充 64 次、突发 128 次的进程内限流。解析错误、非法 JSON-RPC、未知方法和未知工具返回协议错误；已知工具的参数错误和查询失败使用 `isError: true`，同时给出机器可读的错误代码。未知通知不会产生响应。

工具参数不能指定任意文件、网络 URL 或 shell 命令。源码片段和文档可能包含命令或指令，它们始终是被引用的数据。来源链接是可核对的证据入口；MCP 不自动打开链接，也不将它们当作待执行指令。

## 验证

```sh
node scripts/verify-mcp.mjs
node scripts/verify-mcp.mjs --sdk-root /absolute/path/to/mcp-client-sdk
```

第二条命令要求 SDK 位于该目录的 `node_modules/@modelcontextprotocol/sdk`。本次验证使用官方 SDK **1.30.0**，完成初始化、工具发现、六类工具调用和错误结果解析。SDK 仅安装在工作区临时验证目录；项目生产依赖不包含它。

测试还覆盖深度/方向/循环/平行边、只读模型、自定义 JSON 校验、源码指令注入作为纯文本、未知 ID、协议版本协商、初始化顺序、通知、分片/合并消息、畸形 UTF-8、超长输入、EOF 和 stdout 纯协议输出。

验证范围是本地 stdio 协议和共享查询核心。没有据此声称已配置或实测所有桌面 MCP 客户端。
