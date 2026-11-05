/* Lossless view projections of directed pair relationships. No topology is added. */
(function (root) {
  "use strict";

  const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const sorted = (values) => [...new Set(values)].sort(compare);

  function hierarchy(model) {
    const items = new Map();
    for (const item of [
      ...(model.groups || []),
      ...(model.hierarchy || []),
      ...(model.nodes || []),
    ])
      items.set(item.id, item);
    const paths = new Map();
    function path(id) {
      if (paths.has(id)) return paths.get(id);
      if (!items.has(id)) return [];
      const reverse = [],
        seen = new Set();
      let cursor = id;
      while (cursor && items.has(cursor)) {
        if (seen.has(cursor)) throw new Error("Hierarchy contains a cycle.");
        seen.add(cursor);
        reverse.push(cursor);
        const item = items.get(cursor);
        cursor = item.parentId || (item.group !== cursor ? item.group : null);
      }
      const result = reverse.reverse();
      paths.set(id, result);
      return result;
    }
    return { path };
  }

  /** Ancestors in root-first order, excluding the item itself. Unknown => []. */
  function ancestors(model, id) {
    return hierarchy(model).path(id).slice(0, -1);
  }

  /** Deepest common ancestor, including a supplied item itself; null across roots. */
  function commonAncestor(model, ids) {
    const tree = hierarchy(model),
      paths = [...ids].map((id) => tree.path(id));
    if (!paths.length || paths.some((path) => !path.length)) return null;
    let common = null;
    for (let i = 0; i < paths[0].length; i++) {
      const id = paths[0][i];
      if (!paths.every((path) => path[i] === id)) break;
      common = id;
    }
    return common;
  }

  // Length prefixes make the encoding injective even when IDs contain ':' or '.'.
  // A membership change intentionally changes the encoding; input ordering does not.
  function membershipBody(edgeIds) {
    return edgeIds.map((id) => `${id.length}:${id}`).join("");
  }

  /** 128-bit FNV-1a lanes. Used when the SHA-256 helper is not loaded; never a body length. */
  function fingerprint(body) {
    const ir = root.SkylenseAnalysisIR;
    if (ir && typeof ir.sha256Text === "function") return ir.sha256Text(body).slice(0, 16);
    const lanes = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
    for (let i = 0; i < body.length; i++) {
      const code = body.charCodeAt(i);
      for (let lane = 0; lane < lanes.length; lane++)
        lanes[lane] = Math.imul((lanes[lane] ^ (code + lane * 131 + (i % 7))) >>> 0, 16777619) >>> 0;
    }
    return lanes.map((value) => (value >>> 0).toString(16).padStart(8, "0")).slice(0, 2).join("");
  }

  /**
   * Bounded projection identity: a DOM dataset never carries a member list. The immutable
   * membership stays on the relation (and in the ViewState registry once it is serialised).
   * Collisions are verified against the actual membership, not assumed away.
   */
  function relationId(body, identities) {
    const base = "R" + fingerprint(body);
    if (!identities) return base;
    for (let attempt = 0; ; attempt++) {
      const candidate = attempt ? `${base}~${attempt}` : base;
      const taken = identities.get(candidate);
      if (taken === undefined) {
        identities.set(candidate, body);
        return candidate;
      }
      if (taken === body) return candidate;
    }
  }

  function makeRelation(pairs, identities, keys) {
    const edges = pairs
      .flatMap((pair) => pair.edges)
      .sort((a, b) => compare(a.id, b.id));
    const edgeIds = edges.map((edge) => edge.id);
    const labels = sorted(edges.map((edge) => edge.label || ""));
    const type = pairs[0].type;
    const body = membershipBody(edgeIds);
    const relation = {
      id: relationId(body, identities),
      edgeIds,
      sources: sorted(pairs.map((pair) => pair.source)),
      targets: sorted(pairs.map((pair) => pair.target)),
      type,
      // A shared original label names the aggregate; disagreeing members fall back to the type,
      // so no single member's wording is promoted to speak for the others.
      label: labels.length === 1 && labels[0] ? labels[0] : type,
      // "edge" is one directed source->target pair; "bundle" is a star across several pairs.
      // Neither name answers "how many stored binary relations is this?" — `edgeIds`/`edges` do,
      // and every consumer reads those. Neither is a semantic relation group: see
      // src/hypergraph.js, where declared participants, roles and activation live.
      kind: pairs.length > 1 ? "bundle" : "edge",
      edges,
    };
    if (keys) keys.set(relation, body);
    return relation;
  }

  /** Closest visible ancestor of an item (itself included), or null; memoised per projection. */
  function representatives(model, visibleIds) {
    const visible = new Set(
      visibleIds || (model.nodes || []).map((node) => node.id),
    );
    const tree = hierarchy(model),
      found = new Map();
    return (id) => {
      if (!found.has(id)) {
        const path = tree.path(id);
        found.set(
          id,
          [...path].reverse().find((ancestor) => visible.has(ancestor)) || null,
        );
      }
      return found.get(id);
    };
  }

  function checkedEdges(edges, visit) {
    const seenEdges = new Set();
    for (const edge of edges || []) {
      if (typeof edge.id !== "string" || seenEdges.has(edge.id))
        throw new Error("Relationship IDs must be unique strings.");
      seenEdges.add(edge.id);
      visit(edge);
    }
  }

  /**
   * Map endpoints to their closest visible ancestor. Every supplied canonical
   * edge appears once: in a relation, inside a visible node, or in hiddenEdgeIds.
   *
   * Stars share one target or one source (same type and original label, at least
   * 2 projected pairs). These are visual
   * bundles of independent directed pairs, not AND gates, coexecution claims,
   * or inferred many-to-many hyperedges. Target stars take precedence.
   *
   * bundle:false keeps parallel-pair aggregation but disables multi-pair stars.
   */
  function project(
    model,
    { visibleIds, edges = model.edges, bundle = true } = {},
  ) {
    const representative = representatives(model, visibleIds);
    const pairsByKey = new Map(),
      internalByNode = new Map(),
      hiddenEdgeIds = [];
    checkedEdges(edges, (edge) => {
      const source = representative(edge.source),
        target = representative(edge.target);
      if (!source || !target) {
        hiddenEdgeIds.push(edge.id);
        return;
      }
      if (source === target) {
        if (!internalByNode.has(source)) internalByNode.set(source, []);
        internalByNode.get(source).push(edge.id);
        return;
      }
      const key = JSON.stringify([source, target, edge.type]);
      if (!pairsByKey.has(key))
        pairsByKey.set(key, { source, target, type: edge.type, edges: [] });
      pairsByKey.get(key).edges.push(edge);
    });
    const pairs = [...pairsByKey.values()];
    const consumed = new Set(),
      relations = [],
      // Short DOM keys are unique per projection; membership stays out of the identifier.
      identities = new Map(),
      // Ordering stays keyed on the injective membership encoding, not on the short key.
      orderKeys = new Map();
    function bundleStars(keyFor, threshold) {
      const stars = new Map();
      for (const pair of pairs) {
        if (consumed.has(pair)) continue;
        const key = keyFor(pair);
        if (key === null) continue;
        if (!stars.has(key)) stars.set(key, []);
        stars.get(key).push(pair);
      }
      for (const key of [...stars.keys()].sort(compare)) {
        const star = stars.get(key);
        if (star.length < threshold) continue;
        star.forEach((pair) => consumed.add(pair));
        relations.push(makeRelation(star, identities, orderKeys));
      }
    }
    if (bundle) {
      const starKey = (pair, direction) => {
        const labels = sorted(pair.edges.map((edge) => edge.label || ""));
        // Differently labeled parallel edges stay together as a pair, and do
        // not acquire an invented shared label to qualify for a star.
        return labels.length === 1
          ? JSON.stringify([pair[direction], pair.type, labels[0]])
          : null;
      };
      bundleStars((pair) => starKey(pair, "target"), 2);
      bundleStars((pair) => starKey(pair, "source"), 2);
    }
    for (const pair of pairs)
      if (!consumed.has(pair)) relations.push(makeRelation([pair], identities, orderKeys));
    return {
      relations: relations.sort((a, b) => compare(orderKeys.get(a), orderKeys.get(b))),
      internal: [...internalByNode.entries()]
        .sort(([a], [b]) => compare(a, b))
        .map(([nodeId, ids]) => ({ nodeId, edgeIds: sorted(ids) })),
      hiddenEdgeIds: sorted(hiddenEdgeIds),
    };
  }

  /** Exactly project(model, options).hiddenEdgeIds, without building the relations. */
  function hiddenEdgeIds(model, { visibleIds, edges = model.edges } = {}) {
    const representative = representatives(model, visibleIds),
      hidden = [];
    checkedEdges(edges, (edge) => {
      const source = representative(edge.source),
        target = representative(edge.target);
      if (!source || !target) hidden.push(edge.id);
    });
    return sorted(hidden);
  }

  root.CodeLoomRelations = { project, hiddenEdgeIds, ancestors, commonAncestor };
})(typeof window !== "undefined" ? window : globalThis);
