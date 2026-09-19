<div align="center">
<img src="docs/assets/hero.svg" alt="Skylense：看清系统，读懂连接" width="100%">

**让代码架构成为一张可以探索的地图。**

逐层展开结构、追踪上下游、查看源码依据。网页、终端与 Agent 共用同一份模型。

### [在线体验 ↗](https://danielchen26.github.io/skylense-app/app/?example=autoresearch) · [下载离线版 ↓](https://github.com/danielchen26/skylense-app/releases/download/v0.3.2/skylense-0.3.2-web-preview.zip)

无需账号 · 可离线运行 · 六套主题 · 源码依据

[English](README.md) · [产品主页](https://danielchen26.github.io/skylense-app/) · [发布记录](https://github.com/danielchen26/skylense-app/releases/tag/v0.3.2)
</div>

![Skylense 的真实 autoresearch 流程界面](docs/assets/captures/theme-midnight.png)

## 三步开始

1. 下载 **[Web ZIP](https://github.com/danielchen26/skylense-app/releases/download/v0.3.2/skylense-0.3.2-web-preview.zip)**。
2. 解压 `skylense-web` 文件夹。
3. 在现代桌面浏览器中打开 **`standalone.html`**。

网页版无需 Node.js、API Key 或构建步骤。也可以直接[在线打开](https://danielchen26.github.io/skylense-app/app/)。

## 把一个问题一路读下去

- **层级结构**：从系统到模块、组件，向下展开并保留父级与全局位置。
- **关系探索**：直角连线、上下游联动、类别分区与同层高亮；路径可以加入中间必经节点。
- **流程讲解**：按场景阅读，动态提示方向，随时暂停或进入讲解模式。
- **源码依据**：查看节点、函数与每条原始边的说明、短源码摘录和固定 commit 链接。
- **六套主题**：瓷白、青玉、砂岩、深海、石墨、极光。按 `T` 切换，位置与缩放保持不变。

![真实界面的关系流动示意](docs/assets/captures/flow.gif)

现在可以点击 **打开来源**，选择文件夹、多个文件，输入公开 GitHub / 网页 URL，或粘贴文本 / HTML。分析报告显示覆盖范围、截断、未解析关系与元数据文件，确认后进入同一套完整工作台。

自动分析提供目录层级、源码预览、Python / JS / TS 静态导入与声明，以及文档标题和链接；不声称理解任意语言的完整调用图，也不把动画当成运行记录。PDF、Office、图片、压缩包暂时仅展示元数据。[来源与限制](guides/SOURCES.md)。

仍内置 **autoresearch、LangGraph、vLLM** 三个固定版本的精选语义模型供体验。

## 终端与 Agent

下载 **[Agent / Terminal 工具包](https://github.com/danielchen26/skylense-app/releases/download/v0.3.2/skylense-0.3.2.tgz)**，需要 Node.js 22+：

```sh
npm install -g /absolute/path/to/skylense-0.3.2.tgz
skylense open /path/to/project
skylense open https://github.com/owner/repo
skylense open https://example.com
skylense config --root /path/to/project
```

`config` 打印本地 MCP 配置，复制到支持 stdio MCP 的客户端即可接入；不同客户端的配置位置不同。八个工具包括来源分析、模型导出、列表、搜索、详情、上下游、场景与网页定位。Agent 可按[模型契约](guides/MODEL.md)补充有依据的语义。

[Agent 接入与本地网页说明](guides/AGENTS.md) · [终端操作](guides/TERMINAL.md)。工具包已包含完整网页。MCP 的 analyzed/custom 地图可以直接返回本地完整工作台链接；公开内置示例的旧链接可用 `skylense serve --port 4173`。浏览器导入的模型不会自动同步到 Agent。

## 数据与发布方式

浏览器导入的 JSON 留在当前页面会话。MCP 将查询结果返回给你连接的 Agent，是否发送给模型服务商由该客户端决定。[数据说明](PRIVACY.md)。

Skylense 提供可下载、可运行的未修改应用预览，保留源码授权和后续商业化决定。**Skylense 本身不是 MIT 或 Apache 开源项目**；示例材料仍遵循各自的第三方许可证。[预览声明](NOTICE.md) · [示例来源与许可证](EXAMPLE_NOTICES.md)。

本次提供 Web 与本地 Node 工具包，尚无原生 macOS 安装包。[反馈问题](https://github.com/danielchen26/skylense-app/issues/new?template=bug_report.yml)。
