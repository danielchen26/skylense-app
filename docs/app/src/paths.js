/* Bounded, deterministic path exploration. Original edge directions are never rewritten. */
(function (root) {
  "use strict";
  const limits = Object.freeze({ nodes: 500000, edges: 1000000, stops: 8, hops: 48, expansions: 60000, alternatives: 3 });
  const stepKey = (step) => `${step.edge}:${step.reverse ? 1 : 0}`;
  const signature = (path) => JSON.stringify(path.steps.map(stepKey));
  const order = (a, b) => a.steps.length - b.steps.length || signature(a).localeCompare(signature(b));
  function normalize(options = {}) {
    if (!Array.isArray(options.stops) || options.stops.length < 2 || options.stops.length > limits.stops) throw new Error("请选择起点和终点，最多添加 6 个必经节点。");
    const stops = options.stops.slice();
    if (stops.some(id => typeof id !== "string" || !id || id.length > 160)) throw new Error("路径组件 ID 无效。");
    const direction = options.direction || "downstream";
    if (!["downstream", "upstream", "both"].includes(direction)) throw new Error("未知路径方向。");
    const maxHops = options.maxHops === undefined ? 24 : Number(options.maxHops);
    if (!Number.isInteger(maxHops) || maxHops < 1 || maxHops > limits.hops) throw new Error("总跳数上限必须在 1–48 之间。");
    if (options.types != null && (!Array.isArray(options.types) || options.types.length > 100)) throw new Error("关系类型筛选无效。");
    const types = options.types == null ? null : [...new Set(options.types)];
    if (types && (types.length > 100 || types.some(type => typeof type !== "string"))) throw new Error("关系类型筛选无效。");
    return { stops, direction, types, maxHops, limit: Math.min(limits.alternatives, Math.max(1, Math.floor(Number(options.limit) || 3))) };
  }
  function search(model, input = {}) {
    let options;
    try { options = normalize(input); } catch (error) { return { paths: [], segments: [], error: { code: "INVALID_OPTIONS", message: error.message }, limited: false, expansions: 0 }; }
    const result = { options, paths: [], segments: [], error: null, limited: false, expansions: 0 };
    const fail = (code, message, extra = {}) => { result.error = { code, message, ...extra }; return result; };
    if (!Array.isArray(model?.nodes) || !Array.isArray(model?.edges)) return fail("INVALID_MODEL", "模型缺少节点或关系。");
    if (model.nodes.length > limits.nodes || model.edges.length > limits.edges) return fail("MODEL_LIMIT", "模型超过路径索引的安全上限；未执行搜索。");
    const ids = new Set(model.nodes.map(n => n.id));
    if (ids.size !== model.nodes.length) return fail("INVALID_MODEL", "节点 ID 重复。");
    if (options.stops.some(id => !ids.has(id))) return fail("UNKNOWN_STOP", "路径中有当前模型不存在的组件；请重新选择。");
    const availableTypes = new Set(model.edges.map(e => e.type));
    if (options.types?.some(type => !availableTypes.has(type))) return fail("UNKNOWN_TYPE", "路径包含当前模型不存在的关系类型。");
    const graph = new Map();
    const add = (from, to, edge, reverse) => {
      if (!graph.has(from)) graph.set(from, []);
      graph.get(from).push({ from, to, edge: edge.id, source: edge.source, target: edge.target, type: edge.type, label: edge.label || edge.id, reverse });
    };
    const edgeIds = new Set();
    for (const edge of model.edges) {
      if (!ids.has(edge.source) || !ids.has(edge.target) || edgeIds.has(edge.id)) return fail("INVALID_MODEL", "关系 ID 或端点无效。");
      edgeIds.add(edge.id);
      if (options.types && !options.types.includes(edge.type)) continue;
      if (options.direction !== "upstream") add(edge.source, edge.target, edge, false);
      if (options.direction !== "downstream" && edge.source !== edge.target) add(edge.target, edge.source, edge, true);
    }
    for (const list of graph.values()) list.sort((a, b) => stepKey(a).localeCompare(stepKey(b)));
    function shortest(start, end, hops, bannedNodes = new Set(), bannedSteps = new Set()) {
      if (start === end) return { nodes: [start], steps: [] };
      const queue = [{ id: start, depth: 0 }], prior = new Map([[start, null]]);
      for (let head = 0; head < queue.length; head++) {
        const current = queue[head];
        if (current.depth >= hops) continue;
        for (const step of graph.get(current.id) || []) {
          if (result.expansions >= limits.expansions) { result.limited = true; return null; }
          result.expansions++;
          if (bannedNodes.has(step.to) || bannedSteps.has(stepKey(step)) || prior.has(step.to)) continue;
          prior.set(step.to, step);
          if (step.to === end) {
            const route = { nodes: [end], steps: [] };
            let cursor = end;
            while (prior.get(cursor)) { const found = prior.get(cursor); route.steps.unshift(found); route.nodes.unshift(found.from); cursor = found.from; }
            return route;
          }
          queue.push({ id: step.to, depth: current.depth + 1 });
        }
      }
      return null;
    }
    // Yen's bounded loopless alternatives: at most 3 paths, 48 spur positions,
    // and a shared hard expansion budget across every requested segment.
    function alternatives(start, end) {
      const first = shortest(start, end, options.maxHops);
      if (!first) return [];
      const accepted = [first], candidates = new Map(), known = new Set([signature(first)]);
      for (let k = 1; k < options.limit && !result.limited; k++) {
        const previous = accepted[k - 1];
        for (let index = 0; index < previous.steps.length && !result.limited; index++) {
          const prefix = previous.steps.slice(0, index), prefixKey = JSON.stringify(prefix.map(stepKey));
          const banned = new Set(accepted.filter(path => JSON.stringify(path.steps.slice(0, index).map(stepKey)) === prefixKey && path.steps[index]).map(path => stepKey(path.steps[index])));
          const tail = shortest(previous.nodes[index], end, options.maxHops - index, new Set(previous.nodes.slice(0, index)), banned);
          if (!tail) continue;
          const candidate = { nodes: [...previous.nodes.slice(0, index), ...tail.nodes], steps: [...prefix, ...tail.steps] }, key = signature(candidate);
          if (!known.has(key)) candidates.set(key, candidate);
        }
        const next = [...candidates.values()].sort(order)[0];
        if (!next) break;
        candidates.delete(signature(next)); known.add(signature(next)); accepted.push(next);
      }
      return accepted;
    }
    let combined = [{ nodes: [options.stops[0]], steps: [], segments: [] }];
    for (let index = 0; index < options.stops.length - 1; index++) {
      const from = options.stops[index], to = options.stops[index + 1], choices = alternatives(from, to);
      result.segments.push({ index, from, to, alternatives: choices.length });
      if (!choices.length) return fail(result.limited ? "SEARCH_LIMIT" : "UNREACHABLE", result.limited ? "已达到搜索预算，无法确认这一段是否可达。" : "当前方向、关系筛选和跳数上限下，这一段没有可用路径。", { index, from, to });
      const next = combined.flatMap(prefix => choices.map(choice => ({ nodes: [...prefix.nodes, ...choice.nodes.slice(1)], steps: [...prefix.steps, ...choice.steps], segments: [...prefix.segments, { index, from, to, nodes: choice.nodes, steps: choice.steps }] }))).filter(path => path.steps.length <= options.maxHops).sort(order);
      const unique = new Map();
      for (const route of next) if (!unique.has(signature(route))) unique.set(signature(route), route);
      combined = [...unique.values()].slice(0, options.limit);
      if (!combined.length) return fail("HOP_LIMIT", "连接到这一段后，路径总跳数超过设定上限；请提高上限或调整必经节点。", { index, from, to });
    }
    result.paths = combined.map(route => ({ ...route, edges: route.steps.map(step => step.edge), key: signature(route) }));
    return result;
  }
  root.SkylensePaths = Object.freeze({ search, normalize, signature, limits });
})(typeof window !== "undefined" ? window : globalThis);
