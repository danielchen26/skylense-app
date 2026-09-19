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
  // A membership change intentionally changes the ID; input ordering does not.
  function relationId(edgeIds) {
    return `R:${edgeIds.map((id) => `${id.length}:${id}`).join("")}`;
  }

  function makeRelation(pairs) {
    const edges = pairs
      .flatMap((pair) => pair.edges)
      .sort((a, b) => compare(a.id, b.id));
    const edgeIds = edges.map((edge) => edge.id);
    const labels = sorted(edges.map((edge) => edge.label || ""));
    const type = pairs[0].type;
    return {
      id: relationId(edgeIds),
      edgeIds,
      sources: sorted(pairs.map((pair) => pair.source)),
      targets: sorted(pairs.map((pair) => pair.target)),
      type,
      label: labels.length === 1 && labels[0] ? labels[0] : type,
      kind: pairs.length > 1 ? "bundle" : "edge",
      edges,
    };
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
    const visible = new Set(
      visibleIds || (model.nodes || []).map((node) => node.id),
    );
    const tree = hierarchy(model),
      representatives = new Map();
    const pairsByKey = new Map(),
      internalByNode = new Map(),
      hiddenEdgeIds = [];
    const seenEdges = new Set();
    function representative(id) {
      if (!representatives.has(id)) {
        const path = tree.path(id);
        representatives.set(
          id,
          [...path].reverse().find((ancestor) => visible.has(ancestor)) || null,
        );
      }
      return representatives.get(id);
    }
    for (const edge of edges || []) {
      if (typeof edge.id !== "string" || seenEdges.has(edge.id))
        throw new Error("Relationship IDs must be unique strings.");
      seenEdges.add(edge.id);
      const source = representative(edge.source),
        target = representative(edge.target);
      if (!source || !target) {
        hiddenEdgeIds.push(edge.id);
        continue;
      }
      if (source === target) {
        if (!internalByNode.has(source)) internalByNode.set(source, []);
        internalByNode.get(source).push(edge.id);
        continue;
      }
      const key = JSON.stringify([source, target, edge.type]);
      if (!pairsByKey.has(key))
        pairsByKey.set(key, { source, target, type: edge.type, edges: [] });
      pairsByKey.get(key).edges.push(edge);
    }
    const pairs = [...pairsByKey.values()];
    const consumed = new Set(),
      relations = [];
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
        relations.push(makeRelation(star));
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
      if (!consumed.has(pair)) relations.push(makeRelation([pair]));
    return {
      relations: relations.sort((a, b) => compare(a.id, b.id)),
      internal: [...internalByNode.entries()]
        .sort(([a], [b]) => compare(a, b))
        .map(([nodeId, ids]) => ({ nodeId, edgeIds: sorted(ids) })),
      hiddenEdgeIds: sorted(hiddenEdgeIds),
    };
  }

  root.CodeLoomRelations = { project, ancestors, commonAncestor };
})(typeof window !== "undefined" ? window : globalThis);
