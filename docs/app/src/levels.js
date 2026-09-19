/* Real hierarchy depth and selection/frontier projection, without graph mutation. */
(function (root) {
  "use strict";

  const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const sorted = (values) => [...new Set(values)].sort(compare);
  const levels = (values) => [...new Set(values)].sort((a, b) => a - b);
  // Models are immutable snapshots; importing a replacement supplies a new object.
  const trees = new WeakMap();

  function tree(model) {
    if (trees.has(model)) return trees.get(model);
    const nodes = new Set((model.nodes || []).map((node) => node.id));
    const items = new Map([
      ...(model.groups || []).map((item) => [item.id, item]),
      ...(model.hierarchy || []).map((item) => [item.id, item]),
      ...(model.nodes || []).map((item) => [item.id, item]),
    ]);
    const parents = new Map(),
      depths = new Map(),
      paths = new Map();
    for (const [id, item] of items) {
      const parentId =
        item.parentId || (nodes.has(id) ? item.group : null) || null;
      if (parentId && !items.has(parentId))
        throw new Error(
          `Hierarchy parent "${parentId}" for "${id}" does not exist.`,
        );
      parents.set(id, parentId);
    }
    const pending = new Set();
    function visit(id) {
      if (depths.has(id)) return;
      if (pending.has(id))
        throw new Error(`Hierarchy contains a parent cycle at "${id}".`);
      pending.add(id);
      const parentId = parents.get(id);
      if (parentId) visit(parentId);
      depths.set(id, parentId ? depths.get(parentId) + 1 : 1);
      paths.set(id, parentId ? [...paths.get(parentId), parentId] : []);
      pending.delete(id);
    }
    for (const id of items.keys()) visit(id);
    const ids = sorted(items.keys());
    const index = { ids, items, parents, depths, paths };
    trees.set(model, index);
    return index;
  }

  /** Root containers are L1. Stored `level` metadata is intentionally ignored. */
  function depth(model, id) {
    return tree(model).depths.get(id) ?? null;
  }
  function parent(model, id) {
    return tree(model).parents.get(id) ?? null;
  }
  /** Root-first ancestor IDs, excluding the queried item itself. */
  function ancestors(model, id) {
    return [...(tree(model).paths.get(id) || [])];
  }
  /** Same-parent IDs excluding the queried item; roots are siblings of roots. */
  function siblings(model, id) {
    const view = tree(model);
    if (!view.items.has(id)) return [];
    return view.ids.filter(
      (other) =>
        other !== id && view.parents.get(other) === view.parents.get(id),
    );
  }
  function idsAtLevel(model, level) {
    const view = tree(model);
    return view.ids.filter((id) => view.depths.get(id) === level);
  }

  /**
   * context(model,{selectedIds=[],visibleIds?,scopeId=null}) distinguishes real
   * selected depths from the closest visible-ancestor depths. IDs/levels are
   * deduplicated and sorted; projections retain each original selected ID.
   * Without a selection, use the supplied visible frontier, otherwise immediate
   * scope children (or roots). Peers include selected IDs and mean equal depth,
   * not equal parent; visiblePeers is restricted to visibleIds when supplied.
   */
  function context(
    model,
    { selectedIds = [], visibleIds, scopeId = null } = {},
  ) {
    const view = tree(model),
      requested = [...selectedIds];
    const hasVisibility = visibleIds !== undefined && visibleIds !== null;
    const visible = hasVisibility
      ? new Set([...visibleIds].filter((id) => view.items.has(id)))
      : null;
    const basis = requested.length ? "selection" : "frontier";
    const sourceIds =
      basis === "selection"
        ? sorted(requested.filter((id) => view.items.has(id)))
        : visible
          ? sorted(visible)
          : view.ids.filter((id) => view.parents.get(id) === scopeId);
    const projections = sourceIds.map((sourceId) => {
      const effectiveId = visible
        ? [sourceId, ...[...view.paths.get(sourceId)].reverse()].find((id) =>
            visible.has(id),
          ) || null
        : sourceId;
      return {
        sourceId,
        sourceLevel: view.depths.get(sourceId),
        effectiveId,
        effectiveLevel: effectiveId ? view.depths.get(effectiveId) : null,
      };
    });
    const sourceLevels = levels(projections.map((entry) => entry.sourceLevel));
    const effectiveIds = sorted(
      projections.map((entry) => entry.effectiveId).filter(Boolean),
    );
    const effectiveLevels = levels(
      effectiveIds.map((id) => view.depths.get(id)),
    );
    return {
      basis,
      sourceIds,
      sourceLevels,
      effectiveIds,
      effectiveLevels,
      projections,
      unmappedIds: projections
        .filter((entry) => entry.effectiveId === null)
        .map((entry) => entry.sourceId),
      sourcePeers: view.ids.filter((id) =>
        sourceLevels.includes(view.depths.get(id)),
      ),
      visiblePeers: view.ids.filter(
        (id) =>
          (!visible || visible.has(id)) &&
          effectiveLevels.includes(view.depths.get(id)),
      ),
    };
  }

  root.CodeLoomLevels = {
    depth,
    parent,
    ancestors,
    siblings,
    idsAtLevel,
    context,
  };
})(typeof window !== "undefined" ? window : globalThis);
