/* Bounded, deterministic path exploration. Original edge directions are never rewritten.
 *
 * Every route reports two separate layers:
 *   structural reachability  a stored binary relation exists in the requested direction;
 *   semantic justification   the declared RelationGroup that owns the traversed relation, its
 *                            activation (all-of / any-of / unspecified), the roles of both ends
 *                            and the required participants this route has not met.
 *
 * `all` is the group's DECLARED joint participation condition and never a runtime execution
 * record; `any` names candidates and is never collapsed into one certain hop. A segment that
 * has no route is explained (disconnected / type-filtered / conditional-only / hop budget /
 * direction / search exhausted) and never bridged, and no requested stop is ever dropped.
 */
(function (root) {
  "use strict";
  const limits = Object.freeze({ nodes: 500000, edges: 1000000, stops: 8, hops: 48, expansions: 60000, probes: 20000, alternatives: 3 });
  const stepKey = (step) => `${step.edge}:${step.reverse ? 1 : 0}`;
  const signature = (path) => JSON.stringify(path.steps.map(stepKey));
  const order = (a, b) => a.steps.length - b.steps.length || signature(a).localeCompare(signature(b));
  // A route is only as certain as its least certain hop; "certain" never means "observed running".
  const RANK = Object.freeze({ structural: 0, "declared-satisfied": 1, unspecified: 2, candidate: 3, conditional: 4 });
  const CERTAIN = Object.freeze(["structural", "declared-satisfied"]);
  const weakest = (values) => values.reduce((worst, value) => (RANK[value] > RANK[worst] ? value : worst), "structural");
  const participantView = (participant) => ({ id: participant.id, nodeId: participant.nodeId, role: participant.role, direction: participant.direction || null });
  /** Outcomes a caller may branch on. `exhausted` is never a proof that no route exists. */
  const OUTCOMES = Object.freeze(["found", "unreachable", "exhausted", "invalid"]);
  const outcomeFor = (code, limited) =>
    code === "UNREACHABLE" ? (limited ? "exhausted" : "unreachable")
      : code === "SEARCH_LIMIT" ? "exhausted"
        : code === "HOP_LIMIT" ? "unreachable"
          : "invalid";
  /**
   * One declared condition for a whole route or one segment, in the vocabulary a reader and
   * the URL share: which activation mode is involved, which declared participants are
   * required, which are still missing, which alternatives an any-of set offers, and what a
   * satisfied condition actually proves — the declaration, never a run.
   */
  function conditionOf(steps) {
    const involved = [];
    for (const step of steps)
      for (const group of step.why.groups)
        if (!involved.some(seen => seen.id === group.id)) involved.push(group);
    if (!involved.length)
      return { mode: "none", satisfied: true, required: [], missing: [], candidates: [], groupIds: [], proves: "structural-reachability",
        note: "结构可达：存在一串真实关系，不代表任何声明条件或运行。" };
    const modes = new Set(involved.map(group => group.activation));
    const mode = modes.size === 1 ? [...modes][0] : "mixed";
    const required = [...new Set(involved.flatMap(group => (group.activation === "all" ? group.requiredParticipants.map(item => item.id) : [])))].sort();
    const missing = [...new Set(involved.flatMap(group => group.unmetParticipantIds))].sort();
    const candidates = [...new Set(involved.flatMap(group => (group.activation === "any" ? group.candidateNodeIds || [] : [])))].sort();
    const unevaluable = involved.some(group => group.activation !== "any" && (group.certainty === "unspecified" || group.missingParticipantRefs.length));
    return {
      mode, satisfied: !missing.length && !unevaluable && mode !== "any",
      required, missing, candidates,
      groupIds: involved.map(group => group.id),
      unevaluable,
      proves: mode === "any" ? "candidate-alternatives" : unevaluable ? "nothing-declared-condition-unread" : "declared-condition",
      note: mode === "any"
        ? "any-of 候选集：其中之一可能连接，不能读成全部都被调用。"
        : unevaluable
          ? "声明的共同参与条件无法判断，不能当作已满足。"
          : missing.length
            ? "声明的共同参与条件尚未满足：缺少的参与者已列出。"
            : "声明的共同参与条件已满足；这证明的是声明，不是一次运行。",
    };
  }
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
    const conditional = options.conditional === undefined ? "include" : options.conditional;
    if (!["include", "exclude"].includes(conditional)) throw new Error("条件关系只能设为 include 或 exclude。");
    /* `supplied` is the same statement as `satisfiedNodeIds` under the name the route
       builder uses: these components are present even though the route does not pass
       through them. Both spellings are accepted so one engine serves both callers. */
    const declaredSatisfied = options.satisfiedNodeIds ?? options.supplied ?? [];
    if (!Array.isArray(declaredSatisfied) || declaredSatisfied.length > 1000 || declaredSatisfied.some(id => typeof id !== "string" || !id)) throw new Error("已满足参与者所在组件的列表无效。");
    const satisfied = [...new Set(declaredSatisfied)].sort();
    /* A search budget is an input, so an exhausted search can offer a larger one instead of
       a verdict. Omitted means the full ceiling. */
    const budget = options.budget === undefined || options.budget === null
      ? limits.expansions
      : Math.min(limits.expansions, Math.max(1, Math.floor(Number(options.budget))));
    if (!Number.isInteger(budget)) throw new Error("搜索预算无效。");
    return { stops, direction, types, maxHops, conditional, satisfiedNodeIds: satisfied, supplied: satisfied, budget,
      limit: Math.min(limits.alternatives, Math.max(1, Math.floor(Number(options.limit) || 3))) };
  }
  /**
   * Declared RelationGroups that own each stored relation. Activation semantics are read through
   * the hypergraph projection, never re-derived here; when that module is absent the activation
   * stays `unspecified` instead of being guessed.
   */
  function ownership(model) {
    const declared = Array.isArray(model?.analysis?.groups) ? model.analysis.groups : [];
    const byEdge = new Map();
    const attach = (edgeId, view) => { if (!byEdge.has(edgeId)) byEdge.set(edgeId, []); byEdge.get(edgeId).push(view); };
    if (!declared.length) return { byEdge, semanticsRead: true, reason: null, groups: [] };
    const project = root.SkylenseHypergraph && root.SkylenseHypergraph.projectGroups;
    if (!project) {
      const groups = declared.map(group => ({
        id: group.id, semantics: group.semantics || null, activation: "unspecified", activationLabel: "unspecified",
        activationNote: "未加载语义关系组模块；激活条件未读取，不能当作已证明。",
        requiredParticipantIds: [], requiredBasis: "unread", requiredParticipants: [], optionalParticipants: [],
        participants: [], missingParticipantRefs: [], candidateNodeIds: null, candidateCompleteness: null,
        memberEdgeIds: [...(group.memberRelationIds || [])], memberCount: (group.memberRelationIds || []).length,
      }));
      for (const group of groups) for (const edgeId of group.memberEdgeIds) attach(edgeId, group);
      return { byEdge, semanticsRead: false, reason: "未加载 SkylenseHypergraph，声明的 all/any 激活条件未读取。", groups };
    }
    const groups = [];
    for (const projected of project(model.analysis, [])) {
      const participants = projected.participants || [];
      const byId = new Map(participants.map(item => [item.id, item]));
      const requiredIds = projected.requiredParticipantIds || [];
      // requiredParticipantIds names participant identities. Without it the declared inputs are
      // the obligation: an output participant is never promoted into a prerequisite.
      let required = requiredIds.map(id => byId.get(id)).filter(Boolean);
      let requiredBasis = "declared";
      if (!requiredIds.length) {
        required = participants.filter(item => item.direction === "input");
        requiredBasis = required.length ? "declared-inputs" : "none";
      }
      const requiredSet = new Set(required.map(item => item.id));
      const roles = projected.roles || {};
      groups.push({
        id: projected.id, semantics: projected.semantics || null, activation: projected.activation,
        activationLabel: projected.activationLabel, activationNote: projected.activationNote,
        requiredParticipantIds: [...requiredIds], requiredBasis,
        requiredParticipants: required.map(participantView),
        optionalParticipants: participants.filter(item => !requiredSet.has(item.id)).map(participantView),
        participants: participants.map(participantView),
        missingParticipantRefs: requiredIds.filter(id => !byId.has(id)),
        candidateNodeIds: projected.activation === "any"
          ? [...new Set(roles.candidate || roles.target || (projected.members || []).map(member => member.targetId).filter(Boolean))]
          : null,
        candidateCompleteness: projected.candidateCompleteness || null,
        memberEdgeIds: [...projected.memberEdgeIds], memberCount: projected.memberEdgeIds.length,
      });
    }
    for (const group of groups) for (const edgeId of group.memberEdgeIds) attach(edgeId, group);
    return { byEdge, semanticsRead: true, reason: null, groups };
  }
  function stepSentence(step, groups) {
    const head = `${step.type} 关系 ${step.edge}（${step.source} → ${step.target}）${step.reverse ? `，逆向阅读 ${step.from} → ${step.to}` : ""}`;
    if (!groups.length) return `${head}；已存储的二元关系，结构可达，不代表运行时已执行。`;
    return `${head}；${groups.map(group => {
      if (group.activation === "any")
        return `属于候选关系组 ${group.id}（any-of，共 ${group.memberCount} 条成员关系${group.candidateCompleteness ? `，候选集 ${group.candidateCompleteness}` : ""}）：只是候选之一，不能当作必然连接。`;
      if (group.certainty === "conditional")
        return `属于关系组 ${group.id}（all-of，声明需要参与者 ${group.requiredParticipantIds.join("、") || group.requiredParticipants.map(item => item.id).join("、")}）：缺少 ${group.unmetNodeIds.join("、")}，这一段是有条件的。`;
      if (group.certainty === "declared-satisfied")
        return `属于关系组 ${group.id}（all-of）：声明的共同参与条件已满足，但仍未实测执行。`;
      if (group.missingParticipantRefs.length)
        return `属于关系组 ${group.id}（all-of，但 requiredParticipantIds 引用了组内不存在的 participant ${group.missingParticipantRefs.join("、")}）：无法判断共同参与条件。`;
      return `属于关系组 ${group.id}（activation ${group.activationLabel}）：共同参与条件未声明，无法判断。`;
    }).join(" ")}`;
  }
  function search(model, input = {}) {
    let options;
    try { options = normalize(input); } catch (error) { return { paths: [], segments: [], error: { code: "INVALID_OPTIONS", message: error.message }, outcome: "invalid", continuation: null, limited: false, expansions: 0 }; }
    const result = { options, paths: [], segments: [], error: null, outcome: "invalid", continuation: null, limited: false, expansions: 0, probeExpansions: 0 };
    const fail = (code, message, extra = {}) => {
      result.error = { code, message, ...extra };
      result.outcome = outcomeFor(code, result.limited);
      /* A budget that ran out is an open question, so offer the larger search instead of a
         verdict. A proven-unreachable search has nothing to continue. */
      if (result.outcome === "exhausted" && options.budget < limits.expansions)
        result.continuation = { ...options, budget: Math.min(limits.expansions, Math.max(options.budget * 8, options.budget + 1)), resumedFrom: options.budget };
      return result;
    };
    if (!Array.isArray(model?.nodes) || !Array.isArray(model?.edges)) return fail("INVALID_MODEL", "模型缺少节点或关系。");
    if (model.nodes.length > limits.nodes || model.edges.length > limits.edges) return fail("MODEL_LIMIT", "模型超过路径索引的安全上限；未执行搜索。");
    const ids = new Set(model.nodes.map(n => n.id));
    if (ids.size !== model.nodes.length) return fail("INVALID_MODEL", "节点 ID 重复。");
    if (options.stops.some(id => !ids.has(id))) return fail("UNKNOWN_STOP", "路径中有当前模型不存在的组件；请重新选择。");
    const availableTypes = new Set(model.edges.map(e => e.type));
    if (options.types?.some(type => !availableTypes.has(type))) return fail("UNKNOWN_TYPE", "路径包含当前模型不存在的关系类型。");
    const edgeIds = new Set();
    const edgeById = new Map();
    for (const edge of model.edges) {
      if (!ids.has(edge.source) || !ids.has(edge.target) || edgeIds.has(edge.id)) return fail("INVALID_MODEL", "关系 ID 或端点无效。");
      edgeIds.add(edge.id);
      edgeById.set(edge.id, edge);
    }
    const groups = ownership(model);
    result.groupSemantics = { read: groups.semanticsRead, declaredGroups: groups.groups.length, reason: groups.reason };
    // An `any` candidate set and an unread activation are conditional justifications; an `all`
    // group stays traversable but reports its unmet obligations on the route itself.
    const conditionalOwners = (edgeId) => (groups.byEdge.get(edgeId) || []).filter(group => group.activation !== "all");
    function build(shape) {
      const graph = new Map();
      const add = (from, to, edge, reverse) => {
        if (!graph.has(from)) graph.set(from, []);
        graph.get(from).push({ from, to, edge: edge.id, source: edge.source, target: edge.target, type: edge.type, label: edge.label || edge.id, reverse });
      };
      for (const edge of model.edges) {
        if (shape.types && !shape.types.includes(edge.type)) continue;
        if (!shape.conditional && conditionalOwners(edge.id).length) continue;
        if (shape.direction !== "upstream") add(edge.source, edge.target, edge, false);
        if (shape.direction !== "downstream" && edge.source !== edge.target) add(edge.target, edge.source, edge, true);
      }
      for (const list of graph.values()) list.sort((a, b) => stepKey(a).localeCompare(stepKey(b)));
      return graph;
    }
    function bfs(graph, start, end, hops, budget, bannedNodes = new Set(), bannedSteps = new Set()) {
      if (start === end) return { nodes: [start], steps: [] };
      const queue = [{ id: start, depth: 0 }], prior = new Map([[start, null]]);
      for (let head = 0; head < queue.length; head++) {
        const current = queue[head];
        if (current.depth >= hops) continue;
        for (const step of graph.get(current.id) || []) {
          if (budget.used >= budget.limit) { budget.hit = true; return null; }
          budget.used++;
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
    const shape = { types: options.types, direction: options.direction, conditional: options.conditional === "include" };
    const graph = build(shape);
    const budget = { used: 0, limit: options.budget, hit: false };
    const shortest = (start, end, hops, bannedNodes, bannedSteps) => {
      const found = bfs(graph, start, end, hops, budget, bannedNodes, bannedSteps);
      result.expansions = budget.used;
      if (budget.hit) result.limited = true;
      return found;
    };
    // Yen's bounded loopless alternatives: at most 3 paths, 48 spur positions,
    // and a shared hard expansion budget across every requested segment.
    function alternatives(start, end) {
      const first = shortest(start, end, options.maxHops);
      if (!first) return { paths: [], exhaustive: false };
      const accepted = [first], candidates = new Map(), known = new Set([signature(first)]);
      let exhausted = false;
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
        if (!next) { exhausted = true; break; }
        candidates.delete(signature(next)); known.add(signature(next)); accepted.push(next);
      }
      // Exhaustive only when the spur search ran out of candidates inside the budget: reaching the
      // cap of 3, or hitting the expansion budget, means more alternatives may exist.
      return { paths: accepted, exhaustive: exhausted && !result.limited && accepted.length < options.limit };
    }
    /** Relax exactly one dimension to say WHY a stop pair has no route, without bridging it. */
    function probe(start, end, relax) {
      const probeBudget = { used: 0, limit: limits.probes, hit: false };
      const found = bfs(build({ ...shape, ...relax }), start, end, relax.maxHops || options.maxHops, probeBudget);
      result.probeExpansions += probeBudget.used;
      return { reachable: !!found, undetermined: !found && probeBudget.hit, hops: found ? found.steps.length : null, path: found };
    }
    const REASONS = { conditional: "conditional-only", types: "type-filtered", hops: "hop-budget", direction: "direction-filtered" };
    function diagnose(from, to) {
      const attempts = [];
      const run = (dimension, relax, detail) => {
        const outcome = probe(from, to, relax);
        attempts.push({ dimension, reachable: outcome.reachable, undetermined: outcome.undetermined, ...detail(outcome) });
      };
      if (options.conditional === "exclude")
        run("conditional", { conditional: true }, outcome => ({
          groupIds: outcome.path ? [...new Set(outcome.path.steps.flatMap(step => conditionalOwners(step.edge).map(group => group.id)))] : [],
        }));
      if (options.types)
        run("types", { types: null }, outcome => ({
          blockedTypes: outcome.path ? [...new Set(outcome.path.steps.map(step => step.type).filter(type => !options.types.includes(type)))] : [],
        }));
      if (options.maxHops < limits.hops)
        run("hops", { maxHops: limits.hops }, outcome => ({ requiredHops: outcome.hops }));
      if (options.direction !== "both")
        run("direction", { direction: "both" }, outcome => ({
          reversedSteps: outcome.path ? outcome.path.steps.filter(step => step.reverse).length : 0,
        }));
      const relaxable = attempts.find(attempt => attempt.reachable);
      const reason = relaxable ? REASONS[relaxable.dimension] : attempts.some(attempt => attempt.undetermined) ? "undetermined" : "disconnected";
      return { reason, relaxations: attempts, provenUnreachable: reason === "disconnected" };
    }
    const obligations = (steps) => {
      const found = new Map();
      for (const step of steps)
        for (const group of step.why.groups)
          for (const participant of group.requiredParticipants)
            if (group.unmetParticipantIds.includes(participant.id))
              found.set(`${group.id}:${participant.id}`, { groupId: group.id, participantId: participant.id, nodeId: participant.nodeId, role: participant.role, direction: participant.direction, activation: group.activation });
      return [...found.values()];
    };
    /** Why this hop connects: relation kind, traversal direction, and the owning group's condition. */
    function describe(step, known) {
      const owning = (groups.byEdge.get(step.edge) || []).map(group => {
        const unmet = group.activation === "all" ? group.requiredParticipants.filter(item => !known.has(item.nodeId)) : [];
        const met = group.activation === "all" ? group.requiredParticipants.filter(item => known.has(item.nodeId)) : [];
        // A requiredParticipantIds entry with no matching participant cannot be evaluated, so the
        // declared condition stays unknown instead of counting as satisfied.
        const certainty = group.activation === "any" ? "candidate"
          : group.activation === "all"
            ? (group.requiredBasis === "none" || group.missingParticipantRefs.length ? "unspecified" : unmet.length ? "conditional" : "declared-satisfied")
          : "unspecified";
        return {
          id: group.id, semantics: group.semantics, activation: group.activation, activationLabel: group.activationLabel,
          activationNote: group.activationNote, requiredParticipantIds: [...group.requiredParticipantIds], requiredBasis: group.requiredBasis,
          requiredParticipants: group.requiredParticipants, optionalParticipantIds: group.optionalParticipants.map(item => item.id),
          fromRoles: group.participants.filter(item => item.nodeId === step.from).map(item => ({ id: item.id, role: item.role, direction: item.direction })),
          toRoles: group.participants.filter(item => item.nodeId === step.to).map(item => ({ id: item.id, role: item.role, direction: item.direction })),
          metParticipantIds: met.map(item => item.id), unmetParticipantIds: unmet.map(item => item.id),
          unmetNodeIds: [...new Set(unmet.map(item => item.nodeId))],
          candidateNodeIds: group.candidateNodeIds, candidateCompleteness: group.candidateCompleteness,
          missingParticipantRefs: [...group.missingParticipantRefs],
          memberCount: group.memberCount, certainty,
        };
      });
      const certainty = owning.length ? weakest(owning.map(group => group.certainty)) : "structural";
      const why = {
        kind: step.type, direction: step.reverse ? "reverse" : "forward",
        relation: { source: step.source, target: step.target }, reading: { from: step.from, to: step.to },
        basis: owning.length ? "group-member" : "binary-relation",
        certainty, groups: owning, text: stepSentence(step, owning),
      };
      /* A step is only checkable if it carries the evidence of the stored fact it was built
         from, so the original references travel with it rather than being looked up again. */
      const original = edgeById.get(step.edge);
      return { ...step, direction: why.direction, why,
        evidence: original?.evidence ? [...original.evidence] : [],
        evidenceIds: original?.evidenceIds ? [...original.evidenceIds] : [] };
    }
    function annotate(route) {
      // Declared participation is met by a node the route actually passes through, or one the
      // caller states is present. Nothing else is assumed to be satisfied.
      const known = new Set([...route.nodes, ...options.satisfiedNodeIds]);
      const steps = route.steps.map(step => describe(step, known));
      const segments = route.segments.map(segment => {
        const inner = segment.steps.map(step => describe(step, known));
        const certainty = weakest(inner.map(step => step.why.certainty));
        return { ...segment, steps: inner, certainty, condition: conditionOf(inner), conditional: !CERTAIN.includes(certainty),
          reversedSteps: inner.filter(step => step.reverse).length,
          groupIds: [...new Set(inner.flatMap(step => step.why.groups.map(group => group.id)))],
          unmetObligations: obligations(inner),
          why: inner.length ? inner.map(step => step.why.text) : ["两个路标是同一组件，0 跳；没有关系被穿过。"] };
      });
      const certainty = weakest(steps.map(step => step.why.certainty));
      return { ...route, steps, segments, edges: steps.map(step => step.edge), key: signature(route),
        certainty, condition: conditionOf(steps), conditional: !CERTAIN.includes(certainty), reversedSteps: steps.filter(step => step.reverse).length,
        groupIds: [...new Set(steps.flatMap(step => step.why.groups.map(group => group.id)))],
        unmetObligations: obligations(steps) };
    }
    let combined = [{ nodes: [options.stops[0]], steps: [], segments: [] }];
    let exhaustive = true, capped = false;
    for (let index = 0; index < options.stops.length - 1; index++) {
      const from = options.stops[index], to = options.stops[index + 1], choices = alternatives(from, to);
      const segment = { index, from, to, alternatives: choices.paths.length, cap: options.limit, exhaustive: choices.exhaustive };
      result.segments.push(segment);
      if (!choices.exhaustive) exhaustive = false;
      if (!choices.paths.length) {
        const searchExhausted = result.limited;
        const diagnosis = searchExhausted
          ? { reason: "search-exhausted", relaxations: [], provenUnreachable: false }
          : diagnose(from, to);
        Object.assign(segment, { failed: true, ...diagnosis });
        result.completeness = { exhaustive: false, cap: options.limit, searchExhausted, combinedCapped: capped,
          note: searchExhausted ? "已达到搜索预算：这一段是否可达仍未确定，不能当作已证明不可达。" : "路径失败：未返回任何替代方案。" };
        return fail(searchExhausted ? "SEARCH_LIMIT" : "UNREACHABLE",
          searchExhausted ? "已达到搜索预算，无法确认这一段是否可达。" : "当前方向、关系筛选和跳数上限下，这一段没有可用路径。",
          { index, from, to, stops: [...options.stops], ...diagnosis, searchExhausted });
      }
      const next = combined.flatMap(prefix => choices.paths.map(choice => ({ nodes: [...prefix.nodes, ...choice.nodes.slice(1)], steps: [...prefix.steps, ...choice.steps], segments: [...prefix.segments, { index, from, to, nodes: choice.nodes, steps: choice.steps }] }))).sort(order);
      const fitting = next.filter(path => path.steps.length <= options.maxHops);
      const unique = new Map();
      for (const route of fitting) if (!unique.has(signature(route))) unique.set(signature(route), route);
      const distinct = [...unique.values()];
      if (distinct.length > options.limit) { capped = true; exhaustive = false; }
      combined = distinct.slice(0, options.limit);
      if (!combined.length) {
        const requiredHops = Math.min(...next.map(path => path.steps.length));
        result.completeness = { exhaustive: false, cap: options.limit, searchExhausted: result.limited, combinedCapped: capped,
          note: "接上这一段后总跳数超过上限；没有返回任何路径。" };
        Object.assign(segment, { failed: true, reason: "hop-budget", requiredHops, provenUnreachable: false, relaxations: [] });
        return fail("HOP_LIMIT", "连接到这一段后，路径总跳数超过设定上限；请提高上限或调整必经节点。",
          { index, from, to, stops: [...options.stops], reason: "hop-budget", maxHops: options.maxHops, requiredHops, provenUnreachable: false, searchExhausted: result.limited, relaxations: [] });
      }
    }
    result.paths = combined.map(annotate);
    result.outcome = "found";
    result.certainty = weakest(result.paths.map(path => path.certainty));
    result.completeness = { exhaustive: exhaustive && !result.limited, cap: options.limit, searchExhausted: result.limited, combinedCapped: capped,
      note: result.limited ? "已达到搜索预算：返回的方案不是全部，可能还有其他路径。"
        : exhaustive && !capped ? "在当前条件下已枚举完所有 loopless 方案。"
        : `最多返回 ${options.limit} 条方案：还可能存在其他路径，不能当作已穷尽。` };
    return result;
  }
  root.SkylensePaths = Object.freeze({ search, normalize, signature, limits, OUTCOMES });
})(typeof window !== "undefined" ? window : globalThis);
