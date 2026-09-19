/* Pure graph operations, shared by the viewer and the validation script. */
(function (root) {
  "use strict";
  const limits = Object.freeze({ nodes: 500000, hierarchy: 100000, edges: 1000000, documents: 100000 });
  const indexes = new WeakMap();

  /** Read-only indexes for immutable model snapshots. Descendant lists are
   * computed on demand so a shallow view does not materialize every subtree. */
  function index(model) {
    if (indexes.has(model)) return indexes.get(model);
    const nodes = new Map(model.nodes.map(item => [item.id, item]));
    const containers = new Map((model.hierarchy || model.groups).map(item => [item.id, item]));
    const all = new Map([...containers, ...nodes]);
    const children = new Map(), parents = new Map(), depths = new Map();
    for (const [id, item] of all) {
      const parentId = item.parentId || (nodes.has(id) ? item.group : null) || null;
      if (parentId && !all.has(parentId)) throw new Error("Unknown hierarchy parent.");
      parents.set(id, parentId);
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId).push(item);
    }
    for (const id of all.keys()) {
      if (depths.has(id)) continue;
      const trail = [], pending = new Set();
      let cursor = id;
      while (cursor && !depths.has(cursor)) {
        if (pending.has(cursor)) throw new Error("Hierarchy contains a cycle.");
        pending.add(cursor); trail.push(cursor); cursor = parents.get(cursor);
      }
      let depth = cursor ? depths.get(cursor) : 0;
      for (let i = trail.length - 1; i >= 0; i--) depths.set(trail[i], ++depth);
    }
    const edges = new Map(), incoming = new Map(), outgoing = new Map();
    for (const edge of model.edges) {
      edges.set(edge.id, edge);
      if (!incoming.has(edge.target)) incoming.set(edge.target, []);
      if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
      incoming.get(edge.target).push(edge); outgoing.get(edge.source).push(edge);
    }
    const memberCache = new Map();
    function getMembers(id) {
      if (memberCache.has(id)) return memberCache.get(id);
      const result = [], stack = all.has(id) ? [id] : [];
      while (stack.length) {
        const current = stack.pop();
        if (nodes.has(current)) result.push(current);
        const descendants = children.get(current) || [];
        for (let i = descendants.length - 1; i >= 0; i--) stack.push(descendants[i].id);
      }
      memberCache.set(id, result);
      return result;
    }
    function incident(id) {
      if (nodes.has(id)) return { incoming: incoming.get(id) || [], outgoing: outgoing.get(id) || [] };
      const members = new Set(getMembers(id)), inEdges = [], outEdges = [];
      for (const member of members) {
        for (const edge of incoming.get(member) || []) if (!members.has(edge.source)) inEdges.push(edge);
        for (const edge of outgoing.get(member) || []) if (!members.has(edge.target)) outEdges.push(edge);
      }
      return { incoming: inEdges, outgoing: outEdges };
    }
    function boundary(id, type = "all") {
      const members = new Set(getMembers(id));
      const result = { incoming: [], outgoing: [], internal: [] };
      for (const member of members) {
        for (const edge of incoming.get(member) || [])
          if ((type === "all" || edge.type === type) && !members.has(edge.source))
            result.incoming.push(edge.id);
        for (const edge of outgoing.get(member) || []) {
          if (type !== "all" && edge.type !== type) continue;
          result[members.has(edge.target) ? "internal" : "outgoing"].push(edge.id);
        }
      }
      return result;
    }
    const result = Object.freeze({ nodes, containers, all, children, parents, depths, edges,
      incoming, outgoing, getMembers, incident, boundary });
    indexes.set(model, result);
    return result;
  }
  function adjacency(edges, direction = "downstream") {
    const graph = new Map();
    for (const edge of edges) {
      const from = direction === "upstream" ? edge.target : edge.source;
      const to = direction === "upstream" ? edge.source : edge.target;
      if (!graph.has(from)) graph.set(from, []);
      graph.get(from).push({ to, id: edge.id });
    }
    return graph;
  }
  function reachable(edges, start, direction = "downstream") {
    if (!["upstream", "downstream"].includes(direction))
      throw new Error("Unknown traversal direction.");
    const seen = new Set([start]),
      queue = [start],
      edgeIds = new Set();
    const graph = adjacency(edges, direction);
    for (let head = 0; head < queue.length; head++) {
      for (const { to, id } of graph.get(queue[head]) || []) {
        edgeIds.add(id);
        if (!seen.has(to)) {
          seen.add(to);
          queue.push(to);
        }
      }
    }
    return { nodes: [...seen], edges: [...edgeIds] };
  }
  function shortestPath(edges, start, end) {
    const queue = [start],
      prior = new Map([[start, null]]);
    const graph = adjacency(edges);
    for (let head = 0; head < queue.length; head++) {
      const id = queue[head];
      if (id === end) {
        const nodes = [],
          edgeIds = [];
        let cursor = end;
        while (cursor !== null) {
          nodes.push(cursor);
          const step = prior.get(cursor);
          if (!step) break;
          edgeIds.push(step.edge);
          cursor = step.node;
        }
        return { nodes: nodes.reverse(), edges: edgeIds.reverse() };
      }
      for (const edge of graph.get(id) || [])
        if (!prior.has(edge.to)) {
          prior.set(edge.to, { node: id, edge: edge.id });
          queue.push(edge.to);
        }
    }
    return null;
  }
  function validate(model) {
    const fail = (message) => {
      throw new Error(message);
    };
    const object = (value, name) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        fail(`${name} 必须是对象。`);
    };
    const array = (value, name, limit) => {
      if (!Array.isArray(value)) fail(`${name} 必须是数组。`);
      if (value.length > limit) fail(`${name} 超过 ${limit} 项上限。`);
      return value;
    };
    const optionalText = (item, fields) => {
      for (const field of fields)
        if (item[field] !== undefined && typeof item[field] !== "string")
          fail(`${field} 必须是文字。`);
    };
    const id = (value, name) => {
      if (typeof value !== "string" || !/^[\w.:-]{1,160}$/.test(value))
        fail(`${name} ID 无效。`);
    };
    const textList = (value, name, limit = 2000) => {
      for (const item of array(value, name, limit))
        if (typeof item !== "string") fail(`${name} 必须只包含文字。`);
    };
    const checkEvidence = (item) => {
      if (item.evidence === undefined) return;
      for (const entry of array(item.evidence, "evidence", 2000)) {
        object(entry, "evidence");
        if (typeof entry.file !== "string" || typeof entry.excerpt !== "string")
          fail("依据需要 file 和 excerpt 文字。");
        if (
          !Number.isSafeInteger(entry.lineStart) ||
          !Number.isSafeInteger(entry.lineEnd) ||
          entry.lineStart < 1 ||
          entry.lineEnd < entry.lineStart
        )
          fail("依据行号必须是有效的正整数范围。");
      }
    };
    const named = (item, name) => {
      object(item, name);
      id(item.id, name);
      if (typeof item.label !== "string" || !item.label.trim())
        fail(`${name} 需要非空 label。`);
      optionalText(item, [
        "description",
        "summary",
        "path",
        "kind",
        "originalGroup",
      ]);
      if (item.parentId !== undefined && item.parentId !== null)
        id(item.parentId, "parentId");
      if (
        item.level !== undefined &&
        (!Number.isSafeInteger(item.level) || item.level < 1 || item.level > 64)
      )
        fail("level 必须是 1 至 64 的整数。");
      checkEvidence(item);
    };
    object(model, "模型");
    array(model.nodes, "nodes", limits.nodes);
    array(model.edges, "edges", limits.edges);
    array(model.groups, "groups", 256);
    if (!model.nodes.length || !model.groups.length)
      fail("模型至少需要一个组件和一个分组。");
    if (model.meta !== undefined) {
      object(model.meta, "meta");
      optionalText(model.meta, ["title", "description", "evidenceNote"]);
    }
    const groups = new Set();
    for (const group of model.groups) {
      named(group, "group");
      if (groups.has(group.id)) fail("分组 ID 重复。");
      if (group.parentId)
        fail("groups 只可包含顶层分组；子容器应放在 hierarchy。");
      // Colors enter inline CSS and SVG attributes. Restrict them to a literal
      // hexadecimal color instead of accepting arbitrary imported CSS markup.
      if (
        group.color !== undefined &&
        (typeof group.color !== "string" ||
          !/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(group.color))
      )
        fail("分组 color 必须是十六进制颜色（例如 #84a98c）。");
      groups.add(group.id);
    }
    const containers =
      model.hierarchy === undefined
        ? model.groups
        : array(model.hierarchy, "hierarchy", limits.hierarchy);
    const all = new Map();
    for (const item of [...containers, ...model.nodes]) {
      named(item, "node");
      if (all.has(item.id)) fail("节点 ID 重复。");
      all.set(item.id, item);
    }
    const leaves = new Set(model.nodes.map((item) => item.id));
    const containerIds = new Set(containers.map((item) => item.id));
    for (const groupId of groups)
      if (!containerIds.has(groupId) || all.get(groupId).parentId)
        fail("每个分组必须对应一个顶层容器。");
    const ancestry = new Map();
    function ancestryOf(id) {
      const trail = [], pending = new Set();
      let cursor = id;
      while (!ancestry.has(cursor)) {
        const item = all.get(cursor);
        if (!item) fail("父容器不存在。");
        if (pending.has(cursor)) fail("层级包含循环。");
        if (!item.parentId) {
          ancestry.set(cursor, { rootId: leaves.has(cursor) ? item.group : cursor, depth: 1 });
          break;
        }
        if (!containerIds.has(item.parentId)) fail("父容器不存在。");
        pending.add(cursor); trail.push(cursor); cursor = item.parentId;
      }
      let result = ancestry.get(cursor);
      for (let i = trail.length - 1; i >= 0; i--) {
        result = { rootId: result.rootId, depth: result.depth + 1 };
        if (result.depth > 64) fail("层级深度超过 64 层。");
        ancestry.set(trail[i], result);
      }
      return ancestry.get(id);
    }
    for (const item of all.values()) {
      if (item.parentId && !containerIds.has(item.parentId))
        fail("父容器不存在。");
      const { rootId } = ancestryOf(item.id);
      if (!groups.has(rootId)) fail("层级必须归属于一个顶层分组。");
      if (leaves.has(item.id) && !groups.has(item.group))
        fail("组件的 group 必须存在。");
      if (item.group !== undefined && item.group !== rootId)
        fail("group 与父容器所属分组不一致。");
      for (const field of ["inputs", "outputs"])
        if (item[field] !== undefined) textList(item[field], field);
      if (item.functions !== undefined)
        for (const fn of array(item.functions, "functions", limits.nodes)) {
          object(fn, "function");
          if (typeof fn.name !== "string" || !fn.name.trim())
            fail("函数需要非空 name。");
          optionalText(fn, ["description", "desc"]);
          for (const field of ["inputs", "outputs"])
            if (fn[field] !== undefined)
              textList(fn[field], `function.${field}`);
          checkEvidence(fn);
        }
    }
    const documents =
      model.documents === undefined
        ? []
        : array(model.documents, "documents", limits.documents);
    const documentIds = new Set();
    for (const doc of documents) {
      object(doc, "document");
      id(doc.id, "document");
      if (documentIds.has(doc.id)) fail("文档 ID 重复。");
      if (typeof doc.title !== "string" || typeof doc.content !== "string")
        fail("文档需要 title 和 content 文字。");
      optionalText(doc, ["path", "status"]);
      documentIds.add(doc.id);
    }
    for (const item of all.values())
      if (item.documentIds !== undefined) {
        textList(item.documentIds, "documentIds", limits.documents);
        if (item.documentIds.some((docId) => !documentIds.has(docId)))
          fail("节点引用了未知文档。");
      }
    const edgeMap = new Map();
    for (const edge of model.edges) {
      object(edge, "edge");
      id(edge.id, "edge");
      if (
        edgeMap.has(edge.id) ||
        !leaves.has(edge.source) ||
        !leaves.has(edge.target)
      )
        fail("关系端点无效或关系 ID 重复。");
      if (typeof edge.type !== "string" || !edge.type.trim())
        fail("关系需要非空 type。");
      optionalText(edge, ["label"]);
      checkEvidence(edge);
      edgeMap.set(edge.id, edge);
    }
    const flows =
      model.flows === undefined ? [] : array(model.flows, "flows", 256);
    const flowIds = new Set();
    for (const flow of flows) {
      named(flow, "flow");
      if (flowIds.has(flow.id)) fail("流程 ID 重复。");
      flowIds.add(flow.id);
      textList(flow.nodes, "flow.nodes", limits.nodes);
      if (
        !flow.nodes.length ||
        flow.nodes.some((nodeId) => !leaves.has(nodeId))
      )
        fail("场景必须包含已知节点。");
      const selectedNodes = new Set(flow.nodes);
      if (flow.edgeIds !== undefined) {
        textList(flow.edgeIds, "flow.edgeIds", limits.edges);
        if (flow.edgeIds.some((edgeId) => !edgeMap.has(edgeId)))
          fail("场景包含未知关系。");
        if (
          flow.edgeIds.some((edgeId) => {
            const edge = edgeMap.get(edgeId);
            return (
              !selectedNodes.has(edge.source) || !selectedNodes.has(edge.target)
            );
          })
        )
          fail("场景关系端点必须包含在场景节点中。");
      }
      // A scenario is a set of documented components, possibly disconnected or
      // branching. Only an explicitly declared path promises adjacent links.
      if (flow.kind === "directed-path") {
        const allowed =
          flow.edgeIds === undefined
            ? model.edges
            : flow.edgeIds.map((edgeId) => edgeMap.get(edgeId));
        const links = new Map();
        for (const edge of allowed) {
          if (!links.has(edge.source)) links.set(edge.source, new Set());
          links.get(edge.source).add(edge.target);
        }
        for (let i = 1; i < flow.nodes.length; i++)
          if (!links.get(flow.nodes[i - 1])?.has(flow.nodes[i]))
            fail("路径中的相邻节点没有有向关系。");
      }
    }
    return true;
  }
  root.AtlasGraph = { reachable, shortestPath, validate, index, limits };
})(typeof window !== "undefined" ? window : globalThis);
