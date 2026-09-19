/* Canonical selection relevance, independent of level highlighting and layout. */
(function (root) {
  "use strict";
  const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const sorted = (values) => [...new Set(values)].sort(compare);
  const indexes = new WeakMap();

  function index(model) {
    if (indexes.has(model)) return indexes.get(model);
    const nodes = new Map((model.nodes || []).map((node) => [node.id, node]));
    const all = new Map([
      ...(model.groups || []).map((item) => [item.id, item]),
      ...(model.hierarchy || []).map((item) => [item.id, item]),
      ...nodes,
    ]);
    const ancestors = new Map(),
      pending = new Set();
    function path(id) {
      if (ancestors.has(id)) return ancestors.get(id);
      if (pending.has(id))
        throw new Error(`Hierarchy contains a parent cycle at "${id}".`);
      pending.add(id);
      const item = all.get(id);
      const parentId = item.parentId || (nodes.has(id) ? item.group : null);
      if (parentId && !all.has(parentId))
        throw new Error(`Unknown hierarchy parent "${parentId}".`);
      const result = parentId ? [...path(parentId), parentId] : [];
      ancestors.set(id, result);
      pending.delete(id);
      return result;
    }
    for (const id of all.keys()) path(id);
    const members = new Map([...all.keys()].map((id) => [id, []]));
    for (const id of nodes.keys())
      for (const ancestor of [...ancestors.get(id), id])
        members.get(ancestor).push(id);
    const edges = [...(model.edges || [])]
      .filter((edge) => nodes.has(edge.source) && nodes.has(edge.target))
      .sort((a, b) => compare(a.id, b.id));
    const result = { nodes, all, ancestors, members, edges };
    indexes.set(model, result);
    return result;
  }

  /**
   * describe(model,{selectedId,relationEdgeIds=[],visibleIds?,lens='scope',
   * type='all',trace?}) returns sorted serializable ID sets. Selected relation
   * members win over selectedId. Edge relevance always uses original IDs and
   * endpoints; relation focus adds one-hop context only in the global lens.
   * Trace adds exactly its filtered `edges` plus explicit `nodes`, never every
   * edge among those nodes. Type filters edge activity, not anchor identity.
   *
   * selectedIds are exact visible anchors or closest visible ancestors; anchors
   * without a visible representative remain exact for non-canvas UI. relatedIds
   * includes selected identities and every containing ancestor. Classify with
   * selected first, then related, then unrelated only when active=true.
   */
  function describe(
    model,
    {
      selectedId,
      relationEdgeIds = [],
      visibleIds,
      lens = "scope",
      type = "all",
      trace = null,
    } = {},
  ) {
    const data = index(model),
      requested = new Set(relationEdgeIds);
    const focused = data.edges.filter((edge) => requested.has(edge.id));
    const relationSelection = focused.length > 0;
    const anchorIds = relationSelection
      ? sorted(focused.flatMap((edge) => [edge.source, edge.target]))
      : data.all.has(selectedId)
        ? [selectedId]
        : [];
    const selectedLeaves = new Set(
      anchorIds.flatMap((id) => data.members.get(id)),
    );
    const filtered = data.edges.filter(
      (edge) => type === "all" || edge.type === type,
    );
    const selectedEdgeIds = filtered
      .filter((edge) => relationSelection && requested.has(edge.id))
      .map((edge) => edge.id);
    const relatedEdges = new Set(selectedEdgeIds);
    if (anchorIds.length && (!relationSelection || lens === "global"))
      for (const edge of filtered)
        if (selectedLeaves.has(edge.source) || selectedLeaves.has(edge.target))
          relatedEdges.add(edge.id);
    const traceEdges = new Set(trace?.edges || []);
    for (const edge of filtered)
      if (traceEdges.has(edge.id)) relatedEdges.add(edge.id);
    const relatedLeaves = new Set(selectedLeaves);
    for (const id of trace?.nodes || [])
      for (const leaf of data.members.get(id) || []) relatedLeaves.add(leaf);
    for (const edge of filtered)
      if (relatedEdges.has(edge.id)) {
        relatedLeaves.add(edge.source);
        relatedLeaves.add(edge.target);
      }

    const visible =
      visibleIds === undefined || visibleIds === null
        ? null
        : new Set(visibleIds);
    const selectedIds = sorted(
      anchorIds.map((id) =>
        visible
          ? [id, ...[...data.ancestors.get(id)].reverse()].find((candidate) =>
              visible.has(candidate),
            ) || id
          : id,
      ),
    );
    const related = new Set();
    for (const id of [...relatedLeaves, ...anchorIds, ...selectedIds])
      for (const ancestor of [...data.ancestors.get(id), id])
        related.add(ancestor);
    return {
      active:
        anchorIds.length > 0 || relatedLeaves.size > 0 || relatedEdges.size > 0,
      anchorIds,
      selectedIds,
      relatedIds: sorted(related),
      selectedEdgeIds,
      relatedEdgeIds: sorted(relatedEdges),
      relatedLeafIds: sorted(relatedLeaves),
    };
  }

  root.CodeLoomFocus = { describe };
})(typeof window !== "undefined" ? window : globalThis);
