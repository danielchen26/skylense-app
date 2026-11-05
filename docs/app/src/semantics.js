/* Display vocabulary only: canonical graph types and direction remain unchanged. */
(function (root) {
  "use strict";

  function entry(
    key,
    label,
    shortLabel,
    description,
    icon,
    color,
    darkColor,
    dash,
  ) {
    return Object.freeze({
      key,
      label,
      shortLabel,
      description,
      icon,
      color,
      darkColor,
      ...(dash === undefined ? {} : { dash }),
    });
  }

  const relations = Object.freeze({
    "call-candidate": entry("call-candidate", "派发候选", "候选", "静态作用域可见的 Julia 方法候选集合；不会选择或证明实际运行时派发目标。", "fanout", "#92400E", "#FCD34D", "5 4 1 4"),
    loads: entry('loads', '页面资源', '加载', 'HTML 明确声明的脚本或样式表资源；不表示资源已经执行或目标已经读取。', 'grid', '#7C2D12', '#FED7AA', '8 3'),
    links: entry('links', '文档链接', '链接', '来源文本中明确写出的超链接或文档引用；不表示程序调用或目标页面已被读取。', 'search', '#155E75', '#A5F3FC', '6 3 1 3'),
    calls: entry('calls', '静态调用', '调用', '源码中可见的调用；动态分派仍以成员说明为准，不代表运行观测。', 'arrow', '#14532D', '#BBF7D0', '14 2'),
    types: entry('types', '类型契约', '类型', '类型注解或数据契约引用，从使用者指向结构定义。', 'code', '#5B21B6', '#DDD6FE', '8 3 2 3'),
    constructs: entry('constructs', '对象构建', '构建', '源码中实例化或建立对象的关系。', 'box', '#854D0E', '#FDE68A', '12 3 3 3'),
    imports: entry('imports', '源码导入', '导入', '静态 import 或延迟导入依赖；不额外推断调用发生。', 'external', '#0C4A6E', '#BAE6FD', '3 5'),
    implements: entry("implements", "接口实现", "实现", "类型检查器解析的类到接口关系；接口声明必须存在于当前索引中，不表示运行时验证。", "check", "#3730A3", "#C7D2FE", "3 2 9 2"),
    inherits: entry('inherits', '类型继承', '继承', '派生类或接口指向其基类或父接口；是类型结构，不是执行流程。', 'layers', '#115E59', '#99F6E4', '10 3 2 3 2 3'),
    inferred: entry('inferred', '架构推导', '推导', '根据接口、协议或跨进程边界整理的概念关系；请阅读每条成员的推导依据。', 'eye', '#9F1239', '#FDA4AF', '1 5'),
    flow: entry(
      "flow",
      "流程关系",
      "流程",
      "原图中的请求、调用、调度或结果返回关系；箭头保留原始方向，不代表已验证的运行顺序。",
      "flow",
      "#166534",
      "#86EFAC",
      "",
    ),
    data: entry(
      "data",
      "数据与契约",
      "数据",
      "原图标注的数据、参数、校验或序列化关系；具体含义以成员边的标签为准。",
      "document",
      "#6D28D9",
      "#C4B5FD",
      "10 4",
    ),
    read: entry(
      "read",
      "读取关系",
      "读取",
      "原图标注为 read 的关系；读取方指向被读取对象，不按物理数据传送方向反转箭头。",
      "download",
      "#1D4ED8",
      "#93C5FD",
      "5 4",
    ),
    write: entry(
      "write",
      "写入关系",
      "写入",
      "原图标注的存储、更新或写入关系；具体操作与目标由原始成员边说明。",
      "upload",
      "#9A3412",
      "#FDBA74",
      "9 3 2 3",
    ),
    depends: entry(
      "depends",
      "依赖关系",
      "依赖",
      "原图标注的工具或组件依赖；依赖方向不额外表示执行先后或运行时观测。",
      "link",
      "#9D174D",
      "#F9A8D4",
      "2 4",
    ),
  });

  // Node color describes the node kind. It is independent of relation color
  // and of the separate group/boundary palette in the imported graph.
  const nodes = Object.freeze({
    file: entry('file', '文件', '文件', '来源文件或二进制元数据；分析状态和覆盖范围见详情。', 'document', '#475569', '#CBD5E1'),
    document: entry('document', '文档与章节', '文档', '采集到的文档、页面内容或明确的标题章节。', 'document', '#6D28D9', '#DDD6FE'),
    external: entry('external', '外部引用', '引用', '原文链接指向的目标；未读取目标时会明确标记，不能据此推断目标内容。', 'external', '#0E7490', '#A5F3FC'),
    function: entry('function', '函数', '函数', '源码函数或方法入口。', 'code', '#6D28D9', '#C4B5FD'),
    class: entry('class', '类', '类', '源码类及其状态和方法；详细接口见函数卡。', 'box', '#0369A1', '#7DD3FC'),
    container: entry(
      "container",
      "模块边界",
      "边界",
      "包含子模块或组件的层级边界；包含关系不等于调用关系。",
      "layers",
      "#475569",
      "#CBD5E1",
    ),
    interface: entry(
      "interface",
      "调用入口",
      "入口",
      "API、命令行、协议入口或交互组件。",
      "external",
      "#0369A1",
      "#7DD3FC",
    ),
    module: entry(
      "module",
      "功能模块",
      "模块",
      "模型中的路由、服务、作业或通用逻辑模块；具体职责见节点说明。",
      "box",
      "#4338CA",
      "#A5B4FC",
    ),
    schema: entry(
      "schema",
      "数据模型",
      "模型",
      "模型中的输入、输出或校验数据结构。",
      "document",
      "#A16207",
      "#FDE047",
    ),
    policy: entry(
      "policy",
      "策略实现",
      "策略",
      "模型中实现算法、调度或决策规则的策略组件。",
      "code",
      "#A21CAF",
      "#F0ABFC",
    ),
    store: entry(
      "store",
      "存储接口",
      "存储",
      "模型中的缓存、数据库或 CRUD 接口；不据此推断具体存储实现。",
      "database",
      "#0F766E",
      "#5EEAD4",
    ),
  });

  // Fact status is a third axis, independent of node kind and relation type: a route hop is
  // structurally stored, declared-satisfied, conditional, a candidate, or unlabelled. Colour is
  // always paired with an icon, a text label and a line style, so no meaning rests on colour.
  const certainties = Object.freeze({
    structural: entry('structural', '结构可达', '结构', '存在已存储的原始关系，方向未改写；结构上可达，不代表运行时已执行。', 'route', '#1F2937', '#E5E7EB', '14 2'),
    'declared-satisfied': entry('declared-satisfied', '声明条件已满足', '已满足', '关系组声明的共同参与条件在这条路径上已满足；仍然只是声明，不是实测执行。', 'check', '#065F46', '#A7F3D0', '10 3'),
    conditional: entry('conditional', '条件未满足', '有条件', '关系组要求的参与者尚未出现在这条路径上；这一段是有条件的，不能当作确定连接。', 'info', '#9A3412', '#FED7AA', '4 4'),
    candidate: entry('candidate', '候选之一', '候选', '来自 any-of 候选集的成员关系；只是候选之一，不能画成必然调用。', 'fanout', '#92400E', '#FCD34D', '2 3'),
    unspecified: entry('unspecified', '激活条件未声明', '未声明', '关系组没有声明 all/any 激活条件；保持未知，不默认视为已证明。', 'minus', '#3F3F46', '#D4D4D8', '1 4'),
  });

  // Declared activation of a semantic relation group. `all` and `any` are declarations about the
  // group definition; neither is a record of anything having run.
  const activations = Object.freeze({
    all: entry('all', '共同参与（all-of）', 'all-of', '组定义要求的共同参与条件；不自动证明运行时执行。', 'layers', '#1D4ED8', '#BFDBFE', '10 3'),
    any: entry('any', '候选集合（any-of）', 'any-of', '候选或替代参与者；不能画成全部必然调用。', 'fanout', '#92400E', '#FCD34D', '2 3'),
    unspecified: entry('unspecified', '未声明激活条件', '未声明', '导入模型没有给出 all/any；保持 unspecified。', 'minus', '#3F3F46', '#D4D4D8', '1 4'),
  });

  function custom(value, object) {
    const supplied = typeof value === "string" ? value.trim() : "";
    const category = object === "relation" ? "关系" : "节点";
    return entry(
      "unknown",
      supplied ? `自定义${category} · ${supplied}` : `未分类${category}`,
      supplied || `未分类${category}`,
      supplied
        ? `保留导入数据中的类型“${supplied}”；本工作台尚未为此类型定义专属展示语义。`
        : `导入数据未提供可识别的${category}类型。`,
      object === "relation" ? "link" : "box",
      "#52525B",
      "#D4D4D8",
      object === "relation" ? "3 3" : undefined,
    );
  }

  function relation(type) {
    return typeof type === "string" &&
      Object.prototype.hasOwnProperty.call(relations, type)
      ? relations[type]
      : custom(type, "relation");
  }

  function node(kind) {
    return typeof kind === "string" &&
      Object.prototype.hasOwnProperty.call(nodes, kind)
      ? nodes[kind]
      : custom(kind, "node");
  }

  function unlabelled(what) {
    return entry(
      "unknown",
      `未标注${what}`,
      "未标注",
      `导入数据没有给出${what}；保持未知，不能默认视为已证明。`,
      "info",
      "#52525B",
      "#D4D4D8",
      "3 3",
    );
  }

  /** An unknown fact status never degrades into a confident one. */
  function certainty(level) {
    return typeof level === "string" &&
      Object.prototype.hasOwnProperty.call(certainties, level)
      ? certainties[level]
      : unlabelled("可信度");
  }

  function activation(mode) {
    return typeof mode === "string" &&
      Object.prototype.hasOwnProperty.call(activations, mode)
      ? activations[mode]
      : unlabelled("激活条件");
  }

  function relationShape(edgeCount) {
    const count =
      typeof edgeCount === "number" && Number.isFinite(edgeCount)
        ? Math.max(0, Math.floor(edgeCount))
        : 0;
    return Object.freeze(
      count > 1
        ? {
            key: "bundle",
            label: "关系束",
            shortLabel: "关系束",
            description: `${count} 条原始有向边的展示聚合；成员端点配对保持独立。`,
            icon: "layers",
            count,
          }
        : count === 1
          ? {
              key: "single",
              label: "单条关系",
              shortLabel: "单边",
              description: "一条原始有向边。",
              icon: "arrow",
              count,
            }
          : {
              key: "none",
              label: "未选择关系",
              shortLabel: "无关系",
              description: "没有原始边可供展示。",
              icon: "minus",
              count,
            },
    );
  }

  root.CodeLoomSemantics = Object.freeze({
    relation,
    node,
    certainty,
    activation,
    relationShape,
    relationTypes: Object.freeze(Object.keys(relations)),
    nodeKinds: Object.freeze(Object.keys(nodes)),
    certaintyLevels: Object.freeze(Object.keys(certainties)),
    activationModes: Object.freeze(Object.keys(activations)),
  });
})(typeof window !== "undefined" ? window : globalThis);
