/* Parser text in the map's language (docs/AUTHORING.md § Presentation).
 *
 * Ingestion writes its reader-visible notes in English: a declaration's "<name> · function ·
 * lines a–b. Static source declaration; not a runtime trace.", a file's "python · 40 source
 * lines", the "Source · <file>" label of a file whose declarations it contains, edge and
 * external-dependency boilerplate, and the titles of the automatic guides. An authored model
 * written in Chinese shows those texts through the deterministic templates below. Nothing here
 * is authored and nothing is inferred: each template restates exactly what the English note
 * says, so the text stays derived and ungraded. A sentence no template knows is kept as written.
 *
 * The stored model is never changed: `localizeModel` returns a view whose changed items are
 * copies (unchanged items are shared), and every field it rewrites keeps its English value
 * next to it under `derivedText`. A declaration whose parser summary is its own docstring
 * shows the declaration template instead, and the docstring moves to `sourceDocstring`: it is
 * quoted source, shown as such in the inspector, not a caption in another language.
 *
 * Loaded by the workbench (window.SkylenseDerivedText) and by lib/interpretation.mjs for the
 * terminal, CLI and MCP surfaces, so every surface uses the same wording. */
(function (root) {
  "use strict";

  const KIND = Object.freeze({
    function: "函数", method: "方法", class: "类", section: "章节", module: "模块", interface: "接口",
    struct: "结构体", enum: "枚举", type: "类型", trait: "特征", protocol: "协议", variable: "变量",
    constant: "常量", property: "属性", field: "字段", macro: "宏", namespace: "命名空间", schema: "结构定义",
    document: "文档", file: "文件", external: "外部依赖", record: "记录", object: "对象", union: "联合体",
    extension: "扩展", impl: "实现", package: "包", component: "组件", test: "测试", cell: "单元格",
  });
  const kindText = kind => (Object.hasOwn(KIND, kind) ? KIND[kind] : kind);

  /* Whole sentences of ingestion boilerplate, matched exactly after trimming. */
  const SENTENCES = new Map([
    ["Static source declaration; not a runtime trace.", "静态源码声明，不是运行轨迹。"],
    ["File metadata only; contents were not analyzed.", "只有文件元数据，内容未分析。"],
    ["Declared external dependency reference; package contents were not fetched or indexed, and runtime availability is not verified.", "声明的外部依赖引用；没有取回或索引包的内容，也没有核实运行时是否可用。"],
    ["Declared external references; dependency contents are not part of the indexed source.", "声明的外部引用；依赖的内容不在已索引的源码里。"],
    ["The source declares this external dependency reference.", "源码声明了这个外部依赖引用。"],
    ["Its contents and runtime binding were not inspected; this does not count as a resolved local-code relationship.", "没有检查它的内容和运行时绑定；这不算已解析的本地代码关系。"],
    ["A source call expression resolves lexically to this unique included declaration.", "源码中的调用表达式按词法解析到这个唯一的已收录声明。"],
    ["Decorators, rebinding and runtime behavior are not verified; this is not an observed execution or ordering claim.", "装饰器、重新绑定和运行时行为没有核实；这不是观察到的执行或先后顺序。"],
    ["A static semantic binding resolves this call site to a unique included source declaration.", "静态语义绑定把这个调用点解析到唯一的已收录源码声明。"],
    ["Runtime dispatch and execution order are not observed.", "没有观察运行时派发和执行顺序。"],
    ["A unique same-file name match is a candidate, not a static proof of the callee or an execution trace.", "同一文件内唯一的同名匹配只是候选，不是被调用方的静态证明，也不是执行轨迹。"],
    ["A declared class or interface heritage reference resolves through the project symbol table to this unique included source definition.", "声明的类或接口继承引用经项目符号表解析到这个唯一的已收录源码定义。"],
    ["This is a structural relationship, not an execution sequence or proof that the implementation satisfies the contract.", "这是结构关系，不是执行顺序，也不证明实现满足契约。"],
    ["static source reference resolves to an included local file.", "静态源码引用解析到一个已收录的本地文件。"],
    ["unique included path inside this snapshot.", "在这个快照里解析到唯一的已收录路径。"],
    ["This is a lexical dependency candidate, not a verified execution, call or runtime flow.", "这是词法依赖候选，不是核实过的执行、调用或运行时流程。"],
    ["This is a static source binding, not proof of execution.", "这是静态源码绑定，不证明会执行。"],
    ["This is a candidate, not a resolved relationship.", "这是候选，不是已解析的关系。"],
    ["This is a candidate for the configurations that enable it, not a resolved relationship.", "这是启用它的配置下的候选，不是已解析的关系。"],
    ["Source-backed static dependency neighborhood.", "有源码依据的静态依赖邻域。"],
    ["Reading order is for navigation only, not an execution trace.", "阅读顺序只用于导航，不是执行轨迹。"],
    ["Every displayed relationship retains its original direction and source evidence.", "显示的每条关系都保留原来的方向和源码依据。"],
    ["Source hierarchy · expand folders to inspect files.", "源码层级 · 展开文件夹查看文件。"],
    ["Containment does not imply execution.", "包含关系不代表执行。"],
    ["Source file boundary · declarations are contained here; containment does not imply a call.", "源码文件边界 · 声明包含在这里；包含关系不代表调用。"],
    ["Directory boundary · actual source path", "目录边界 · 实际源码路径"],
    ["Authored page section · source text, not an inferred component", "页面章节 · 源码文本，不是推断出的组件"],
    ["Collected page · source, authored sections and hyperlink references", "收集的页面 · 源文本、章节与超链接引用"],
    ["Automatically collected source hierarchy and bounded static reference analysis.", "自动收集的源码层级与有界的静态引用分析。"],
    ["Automatically analyzed source text.", "自动分析的源码文本。"],
    ["Imports and hyperlinks are lexical candidates resolved against included files; Call-site bindings report their static or lexical provenance and do not form a complete runtime call graph.", "导入和超链接是按已收录文件解析的词法候选；调用点绑定注明其静态或词法来源，不构成完整的运行时调用图。"],
    ["No code was executed and no runtime flow is inferred.", "没有执行任何代码，也没有推断运行时流程。"],
    ["Excerpts may be partial when preview budgets are reached; bounded source previews are available in documents.", "预览预算用完时摘录可能不完整；有界的源码预览可在文档中查看。"],
    ["Preview limits, skipped files and unresolved references are recorded in the ingestion report.", "预览上限、跳过的文件和未解析的引用记录在分析报告里。"],
  ]);
  const GUIDE_INTENT = Object.freeze({ "Module dependencies": "模块依赖", "Callable relationships": "调用关联", "Linked resources": "文档引用", "Related source": "关联概览" });
  const LABELS = Object.freeze({ "External dependencies": "外部依赖" });

  /* Whole-text templates, tried in order; each returns the Chinese text or null. */
  const TEMPLATES = [
    [/^(.+) · ([a-z][a-z -]*) · lines (\d+)–(\d+)\. Static source declaration; not a runtime trace\.$/, (m) => `${m[1]}：${kindText(m[2])}，第 ${m[3]}–${m[4]} 行。静态源码声明，不是运行轨迹。`],
    [/^(.+) · (\d+) source lines( · preview truncated)?$/, (m) => `${m[1]} 源码，共 ${m[2]} 行${m[3] ? "，预览已截断" : ""}`],
    [/^(.+) · binary · (\d+) bytes$/, (m) => `${m[1]}，二进制文件，${m[2]} 字节`],
    [/^Lexical ([a-z][a-z -]*) scope · (.+)$/, (m) => `${kindText(m[1])}作用域 · ${m[2]}`],
    [/^Unfetched (resource|hyperlink) reference · target contents were not inspected$/, (m) => `未取回的${m[1] === "resource" ? "资源" : "超链接"}引用 · 没有查看目标内容`],
    [/^(\d+) source objects · (\d+) static relationships$/, (m) => `${m[1]} 个源码对象，${m[2]} 条静态关系`],
  ];

  /** Sentences of a note: split after a period that ends a sentence (". " followed by text),
   *  and before a resolver's closing "This is a …" sentence, which may follow a reason that
   *  has no final period. */
  function sentences(text) {
    return text.split(/(?<=\.)\s+(?=[A-Z])|\s+(?=This is a )/);
  }

  /* Resolver reasons that name modules and files; tried on one sentence each. */
  const SENTENCE_TEMPLATES = [
    [/^(\S+) binds the package and (\d+) unbound name\(s\) could load a submodule of it\.?$/, (m) => `${m[1]} 绑定了这个包，另有 ${m[2]} 个未绑定的名字可能加载它的子模块。`],
    [/^The (\S+) entry names the module (\S+); (\S+) is that module only if the project's package root is the manifest directory, which this entry does not state\.?$/,
      (m) => `${m[1]} 条目指向模块 ${m[2]}；只有当项目的包根目录就是清单所在目录时，${m[3]} 才是这个模块，而这个条目没有说明这一点。`],
  ];

  /** One English note in Chinese; the text itself when no template or sentence applies. A
   *  resolver note "<form>: <sentences>" keeps its form name (an identifier). */
  function translate(value) {
    if (typeof value !== "string" || !value) return value;
    const text = value.trim();
    if (Object.hasOwn(LABELS, text)) return LABELS[text];
    for (const [pattern, render] of TEMPLATES) {
      const match = pattern.exec(text);
      if (match) return render(match);
    }
    const form = /^([a-z][\w-]*): (.+)$/s.exec(text);
    const body = form ? form[2] : text;
    let changed = false;
    const parts = sentences(body).map((sentence) => {
      if (SENTENCES.has(sentence)) { changed = true; return SENTENCES.get(sentence); }
      for (const [pattern, render] of SENTENCE_TEMPLATES) {
        const match = pattern.exec(sentence);
        if (match) { changed = true; return render(match); }
      }
      return sentence;
    });
    if (!changed) return value;
    const joined = parts.reduce((out, part, index) => out + (index && !/[。；]$/.test(out) ? " " : "") + part, "");
    return form ? `${form[1]}：${joined}` : joined;
  }

  /** The title of an automatic guide: "<anchor> · <intent>" with the intent in Chinese. */
  function guideLabel(value) {
    if (typeof value !== "string") return value;
    const match = /^(.+) · (Module dependencies|Callable relationships|Linked resources|Related source)$/.exec(value);
    return match ? `${match[1]} · ${GUIDE_INTENT[match[2]]}` : value;
  }

  const CJK = /[\u3400-\u9fff]/;
  const ENGLISH_TEMPLATE = /Static source declaration|source lines|File metadata only|Declared external|external dependency reference|resolves lexically|static source reference|Source file boundary|Source hierarchy|Directory boundary|Callable relationships|Related source|Module dependencies|Linked resources|^Source · /;
  /** Whether a shown text is English parser boilerplate or untranslated English prose: a known
   *  English template, or text with no Chinese in it holding three or more plain English words
   *  once URLs and code-shaped tokens (identifiers, paths, calls) are set aside. */
  function isEnglish(text) {
    if (typeof text !== "string" || !text.trim()) return false;
    if (ENGLISH_TEMPLATE.test(text)) return true;
    if (CJK.test(text)) return false;
    const prose = text.replace(/[a-z][\w+.-]*:\/\/\S+/gi, " ").replace(/\S*[_./:\\()[\]{}<>=#@`$]\S*/g, " ");
    return (prose.match(/\b[A-Za-z]{2,}\b/g) || []).length >= 3;
  }

  /** The declaration template of a symbol node, from its own kind, name and span. */
  function declarationText(node) {
    const span = node.sourceSpan || {};
    const name = node.qualifiedName || node.label;
    const lines = Number.isInteger(span.lineStart) ? `，第 ${span.lineStart}–${Number.isInteger(span.lineEnd) ? span.lineEnd : span.lineStart} 行` : "";
    return `${name}：${kindText(node.kind)}${lines}。静态源码声明，不是运行轨迹。`;
  }

  const own = (record, key) => (record && typeof record === "object" && Object.hasOwn(record, key) ? record[key] : undefined);
  /** Fields an `interpretation` marks as authored are never touched. */
  const authoredField = (item, field) => {
    const fields = own(own(item, "interpretation"), "fields");
    return Boolean(fields && typeof fields === "object" && Object.hasOwn(fields, field));
  };

  /** A copy of one item with its derived reader-visible fields in Chinese, or the item itself. */
  function localizeItem(item, kind) {
    if (!item || typeof item !== "object") return item;
    let copy = null;
    const set = (field, value) => {
      if (value === item[field]) return;
      copy ||= { ...item, derivedText: { ...(own(item, "derivedText") || {}) } };
      if (!Object.hasOwn(copy.derivedText, field)) copy.derivedText[field] = item[field];
      copy[field] = value;
    };
    for (const field of ["summary", "description", "derivedSummary", "derivedDescription"]) {
      if (typeof item[field] !== "string" || authoredField(item, field)) continue;
      set(field, translate(item[field]));
    }
    // A declaration's own docstring is quoted source: kept aside, shown as such.
    if (kind === "node" && item.sourceRole === "symbol" && !authoredField(item, "summary") && typeof item.summary === "string"
      && !CJK.test(item.summary) && translate(item.summary) === item.summary) {
      copy ||= { ...item, derivedText: { ...(own(item, "derivedText") || {}) } };
      copy.sourceDocstring = item.summary;
      set("summary", declarationText(item));
    }
    if (typeof item.label === "string") {
      if (kind === "node" && item.sourceRole === "file" && item.label.startsWith("Source · ")) set("label", `源码 · ${item.label.slice("Source · ".length)}`);
      else if (kind === "container" && Object.hasOwn(LABELS, item.label)) set("label", LABELS[item.label]);
      else if (kind === "edge") {
        const heritage = /^(extends|implements) (.+)$/.exec(item.label);
        if (heritage && ["inherits", "implements"].includes(item.type)) set("label", `${heritage[1] === "extends" ? "继承" : "实现"} ${heritage[2]}`);
      } else if (kind === "flow" && item.kind !== "authored-scenario") set("label", guideLabel(item.label));
    }
    if (kind === "flow" && item.kind !== "authored-scenario" && typeof item.title === "string") set("title", guideLabel(item.title));
    return copy || item;
  }

  /** Whether a model's parser text is shown in Chinese: an authored layer written in zh. The
   *  caller decides trust; an untrusted layer is shown through its derived-only view instead. */
  function applies(model) {
    const authoring = own(own(model, "meta"), "authoring");
    return Boolean(authoring && typeof authoring === "object" && own(authoring, "lang") !== "en");
  }

  /** The view of a model with every derived reader-visible text in Chinese. */
  function localizeModel(model) {
    if (!applies(model)) return model;
    const map = (list, kind) => (Array.isArray(list) ? list.map((item) => localizeItem(item, kind)) : list);
    const view = { ...model, nodes: map(model.nodes, "node"), hierarchy: map(model.hierarchy, "container"), edges: map(model.edges, "edge"), flows: map(model.flows, "flow"), groups: map(model.groups, "container") };
    if (model.meta && typeof model.meta === "object") {
      const meta = { ...model.meta };
      for (const field of ["description", "derivedDescription", "derivedEvidenceNote"])
        if (typeof meta[field] === "string" && !authoredField(meta, field)) meta[field] = translate(meta[field]);
      // evidenceNote = derived note + the authoring note (Chinese already).
      if (typeof meta.evidenceNote === "string" && typeof model.meta.derivedEvidenceNote === "string" && meta.evidenceNote.startsWith(model.meta.derivedEvidenceNote))
        meta.evidenceNote = translate(model.meta.derivedEvidenceNote) + meta.evidenceNote.slice(model.meta.derivedEvidenceNote.length);
      view.meta = meta;
    }
    return view;
  }

  root.SkylenseDerivedText = Object.freeze({ translate, guideLabel, localizeItem, localizeModel, applies, isEnglish, declarationText });
})(typeof window !== "undefined" ? window : globalThis);
