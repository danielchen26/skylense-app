<div align="center">
<img src="docs/assets/hero.svg" alt="Skylense：看清系统，读懂连接" width="100%">

**让代码架构成为一张可以探索的地图。**

逐层展开结构、追踪上下游、查看源码依据。网页、终端与 Agent 共用同一份模型。

### [在线体验 ↗](https://danielchen26.github.io/skylense-app/app/?example=autoresearch) · [下载离线版 ↓](https://github.com/danielchen26/skylense-app/releases/download/v0.2.0/skylense-0.2.0-web-preview.zip)

无需账号 · 可离线运行 · 六套主题 · 源码依据

[English](README.md) · [产品主页](https://danielchen26.github.io/skylense-app/) · [发布记录](https://github.com/danielchen26/skylense-app/releases/tag/v0.2.0)
</div>

![Skylense 的真实 autoresearch 流程界面](docs/assets/captures/theme-midnight.png)

## 三步开始

1. 下载 **[Web ZIP](https://github.com/danielchen26/skylense-app/releases/download/v0.2.0/skylense-0.2.0-web-preview.zip)**。
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

当前包含 **autoresearch、LangGraph、vLLM** 三个精选源码模型。它们覆盖固定版本的核心路径，不是全仓库自动扫描结果；动画也不是程序运行轨迹。可导入兼容的 Skylense JSON，当前不支持直接扫描任意代码目录。

## 终端与 Agent

下载 **[Agent / Terminal 工具包](https://github.com/danielchen26/skylense-app/releases/download/v0.2.0/skylense-0.2.0.tgz)**，需要 Node.js 22+：

```sh
npm install -g /absolute/path/to/skylense-0.2.0.tgz
skylense tui autoresearch
skylense config
```

`config` 打印本地 MCP 配置，复制到支持 stdio MCP 的客户端即可接入；不同客户端的配置位置不同。六个只读工具提供模型列表、搜索、对象详情、上下游、流程和网页定位链接。

[Agent 接入与本地网页说明](guides/AGENTS.md) · [终端操作](guides/TERMINAL.md)。MCP 的网页定位链接需要另外在 `127.0.0.1:4173` 启动静态服务器；浏览器导入的模型不会自动同步到 Agent。

## 数据与发布方式

浏览器导入的 JSON 留在当前页面会话。MCP 将查询结果返回给你连接的 Agent，是否发送给模型服务商由该客户端决定。[数据说明](PRIVACY.md)。

Skylense 提供可下载、可运行的未修改应用预览，保留源码授权和后续商业化决定。**Skylense 本身不是 MIT 或 Apache 开源项目**；示例材料仍遵循各自的第三方许可证。[预览声明](NOTICE.md) · [示例来源与许可证](EXAMPLE_NOTICES.md)。

本次提供 Web 与本地 Node 工具包，尚无原生 macOS 安装包。[反馈问题](https://github.com/danielchen26/skylense-app/issues/new?template=bug_report.yml)。
