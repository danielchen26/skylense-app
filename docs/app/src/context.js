/* Selection context derived only from canonical directed edges and hierarchy. */
(function (root) {
  "use strict";

  const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const sorted = (values) => [...new Set(values)].sort(compare);
  // Imported/analyzed models are immutable snapshots, matching levels/focus.
  // Reuse their ancestry instead of rebuilding it for every card on the canvas.
  const indexes = new WeakMap();

  function index(model) {
    if (indexes.has(model)) return indexes.get(model);
    const nodes = new Map((model.nodes || []).map((node) => [node.id, node]));
    const groups = new Set((model.groups || []).map((group) => group.id));
    const items = new Map([
      ...(model.groups || []).map((item) => [item.id, item]),
      ...(model.hierarchy || []).map((item) => [item.id, item]),
      ...nodes,
    ]);
    const paths = new Map(),
      roots = new Map();
    for (const node of nodes.values()) {
      const path = [],
        seen = new Set();
      let id = node.id;
      while (id && items.has(id)) {
        if (seen.has(id)) throw new Error("Hierarchy contains a cycle.");
        seen.add(id);
        path.push(id);
        const item = items.get(id);
        id = item.parentId || (item.group !== id ? item.group : null);
      }
      paths.set(node.id, path);
      roots.set(
        node.id,
        [...path].reverse().find((id) => groups.has(id)) ||
          (groups.has(node.group) ? node.group : null),
      );
    }
    const canonical = [...(model.edges || [])].sort((a, b) =>
      compare(a.id, b.id),
    );
    const members = new Map([...items.keys()].map((id) => [id, []]));
    for (const [id, path] of paths)
      for (const ancestor of path) members.get(ancestor).push(id);
    const result = { nodes, groups, items, roots, canonical, members };
    indexes.set(model, result);
    return result;
  }

  /**
   * Describe a leaf/container and/or selected canonical edges. Both supplied
   * selectors contribute to the selected union. A type filter limits analysis,
   * never the focused edge IDs or the selected endpoint identities.
   *
   * incoming/outgoing/internal contain original edge IDs. upstream/downstream
   * contain distinct reachable leaf IDs outside the selection. Per-root direct
   * counts attribute an incoming edge to its external source's group and an
   * outgoing edge to its external target's group. Internal selected edges never
   * inflate either count. Boundary projections preserve the actual endpoint IDs.
   */
  function describe(model, { nodeId, edgeIds = [], type = "all" } = {}) {
    const { nodes, groups, roots, canonical, members } = index(model);
    const requested = new Set(edgeIds),
      focused = canonical.filter((edge) => requested.has(edge.id));
    const selected = new Set(members.get(nodeId) || []);
    for (const edge of focused)
      for (const id of [edge.source, edge.target])
        if (nodes.has(id)) selected.add(id);

    const rows = new Map(
      sorted(groups).map((id) => [
        id,
        {
          id,
          selected: 0,
          incoming: 0,
          outgoing: 0,
          upstream: 0,
          downstream: 0,
        },
      ]),
    );
    const increment = (nodeId, field) => {
      const row = rows.get(roots.get(nodeId));
      if (row) row[field]++;
    };
    selected.forEach((id) => increment(id, "selected"));
    const incoming = [],
      outgoing = [],
      internal = [],
      boundaryCrossings = [];
    const forward = new Map(),
      backward = new Map();
    const append = (map, from, to) => {
      if (!map.has(from)) map.set(from, []);
      map.get(from).push(to);
    };
    for (const edge of canonical) {
      if (type !== "all" && edge.type !== type) continue;
      if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
      append(forward, edge.source, edge.target);
      append(backward, edge.target, edge.source);
      const from = selected.has(edge.source),
        to = selected.has(edge.target);
      let direction = null;
      if (from && to) {
        internal.push(edge.id);
        direction = "internal";
      } else if (to) {
        incoming.push(edge.id);
        increment(edge.source, "incoming");
        direction = "incoming";
      } else if (from) {
        outgoing.push(edge.id);
        increment(edge.target, "outgoing");
        direction = "outgoing";
      }
      const sourceGroup = roots.get(edge.source),
        targetGroup = roots.get(edge.target);
      if (
        direction &&
        sourceGroup &&
        targetGroup &&
        sourceGroup !== targetGroup
      )
        boundaryCrossings.push({
          edgeId: edge.id,
          source: edge.source,
          target: edge.target,
          sourceGroup,
          targetGroup,
          type: edge.type,
          direction,
        });
    }
    function reachable(adjacency, field) {
      const seen = new Set(selected),
        queue = [...selected];
      for (let head = 0; head < queue.length; head++)
        for (const id of adjacency.get(queue[head]) || [])
          if (!seen.has(id)) {
            seen.add(id);
            queue.push(id);
          }
      const result = sorted([...seen].filter((id) => !selected.has(id)));
      result.forEach((id) => increment(id, field));
      return result;
    }
    const upstream = reachable(backward, "upstream"),
      downstream = reachable(forward, "downstream");
    return {
      members: sorted(selected),
      focusedEdgeIds: focused.map((edge) => edge.id),
      counts: {
        selected: selected.size,
        incoming: incoming.length,
        outgoing: outgoing.length,
        internal: internal.length,
        upstream: upstream.length,
        downstream: downstream.length,
      },
      incoming,
      outgoing,
      internal,
      upstream,
      downstream,
      groups: [...rows.values()],
      boundaryCrossings,
    };
  }

  root.CodeLoomContext = { describe };
})(typeof window !== "undefined" ? window : globalThis);
