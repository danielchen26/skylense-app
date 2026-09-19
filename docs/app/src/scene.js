/* Hierarchical frontier and deterministic, obstacle-aware relation geometry. */
(function (root) {
  "use strict";
  function build(model, options = {}) {
    const groups = new Map(model.groups.map((g) => [g.id, g]));
    const containers = new Map(
      (model.hierarchy || model.groups).map((n) => [
        n.id,
        {
          ...n,
          kind: "container",
          group: n.group || n.id,
          label: groups.get(n.id)?.label || n.label,
          summary: groups.get(n.id)?.description || n.summary || "",
        },
      ]),
    );
    const nodes = new Map(model.nodes.map((n) => [n.id, n])),
      all = new Map([...containers, ...nodes]);
    const childrenByParent = new Map();
    for (const n of all.values()) {
      const parent = n.parentId || (!containers.has(n.id) ? n.group : null);
      if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
      childrenByParent.get(parent).push(n);
    }
    const children = (id) => childrenByParent.get(id) || [];
    const open = new Set(options.open || []),
      items = [],
      bounds = [],
      categoryBounds = [];
    const pageSize = Number.isFinite(options.pageSize)
      ? Math.min(120, Math.max(1, Math.floor(options.pageSize))) : 120;
    let boundedOpen = null, frontierProjection = null, unpagedIds = null;
    function paginate(values, reason) {
      if (values.length <= pageSize) return values;
      unpagedIds = values.map(n => n.id);
      const totalPages = Math.ceil(values.length / pageSize);
      let page = Number.isFinite(options.page) ? Math.floor(options.page) : 0;
      if (!Number.isFinite(options.page)) {
        const positions = new Map(unpagedIds.map((id, i) => [id, i]));
        for (const revealId of options.revealIds || []) {
          let id = revealId;
          while (id && all.has(id) && !positions.has(id)) {
            const n = all.get(id);
            id = n.parentId || (!containers.has(id) ? n.group : null);
          }
          if (positions.has(id)) { page = Math.floor(positions.get(id) / pageSize); break; }
        }
      }
      page = Math.max(0, Math.min(totalPages - 1, page));
      const displayed = values.slice(page * pageSize, (page + 1) * pageSize);
      frontierProjection = {
        ...frontierProjection,
        limited: true, maxVisible: pageSize, requestedVisible: values.length,
        totalNodes: model.nodes.length, visibleNodes: displayed.length,
        collapsed: frontierProjection?.collapsed || [], reason,
        paging: { page, totalPages, totalItems: values.length,
          displayedIds: displayed.map(n => n.id), offPageEdgeCount: 0 },
        offPageEdgeIds: [],
      };
      return displayed;
    }
    function boundFrontier(roots) {
      const maxVisible = Number.isFinite(options.maxVisible)
        ? Math.min(pageSize, Math.max(1, Math.floor(options.maxVisible))) : pageSize;
      const expands = (n) => containers.has(n.id) &&
        (options.mode === "components" || open.has(n.id)) && children(n.id).length > 0;
      const count = (n) => expands(n)
        ? children(n.id).reduce((sum, child) => sum + count(child), 0) : 1;
      const requestedVisible = roots.reduce((sum, n) => sum + count(n), 0);
      if (requestedVisible <= maxVisible) return;
      // Expand a real hierarchy frontier within the reading budget. Folded
      // descendants keep their actual ancestor, so relationship projection
      // preserves canonical edges rather than slicing nodes out of the graph.
      const frontier = new Map(roots.map((n) => [n.id, n]));
      const priority = new Set();
      for (const revealId of options.revealIds || []) {
        let id = revealId;
        while (id && all.has(id) && !priority.has(id)) {
          priority.add(id);
          const n = all.get(id);
          id = n.parentId || (!containers.has(id) ? n.group : null);
        }
      }
      boundedOpen = new Set();
      // If this scope itself exceeds the budget, none of its real siblings can
      // be folded further. Page the scope before measuring or drawing cards.
      const queue = frontier.size > maxVisible ? [] : [...roots];
      while (queue.length) {
        queue.sort((a, b) => Number(priority.has(b.id)) - Number(priority.has(a.id)));
        const n = queue.shift();
        if (!expands(n)) continue;
        const kids = children(n.id);
        if (frontier.size + kids.length - 1 > maxVisible) continue;
        boundedOpen.add(n.id);
        frontier.delete(n.id);
        for (const child of kids) { frontier.set(child.id, child); queue.push(child); }
      }
      frontierProjection = {
        limited: true, maxVisible, requestedVisible,
        totalNodes: model.nodes.length, visibleNodes: frontier.size,
        collapsed: [...frontier.values()].filter(expands).map((n) => n.id),
        reason: "hierarchy-frontier",
        // These siblings require explicit view pages, never model truncation.
        unfoldable: frontier.size > maxVisible,
      };
    }
    const W = 220,
      H = 132,
      CH = 166,
      GAP = 100;
    const leaf = (n) => ({
      n,
      w: containers.has(n.id) ? 260 : W,
      h: containers.has(n.id) ? CH : H,
      kids: [],
    });
    function groupParts(parts, parentId, context) {
      if (!options.categoryGroups) return parts;
      const byKind = new Map();
      for (const part of parts) {
        if (
          part.kids.length ||
          (!parentId && context !== "focus" && containers.has(part.n.id))
        )
          continue;
        const kind = part.n.kind || "unknown";
        if (!byKind.has(kind)) byKind.set(kind, []);
        byKind.get(kind).push(part);
      }
      const emitted = new Set(),
        grouped = [];
      for (const part of parts) {
        const kind = part.n.kind || "unknown",
          peers = byKind.get(kind);
        if (part.kids.length || !peers || peers.length < 2) {
          grouped.push(part);
          continue;
        }
        if (emitted.has(kind)) continue;
        emitted.add(kind);
        const columns = peers.length > 6 ? Math.ceil(Math.sqrt(peers.length)) : Math.min(3, peers.length);
        const colWidths = Array.from({ length: columns }, (_, col) =>
          Math.max(
            ...peers.filter((_, i) => i % columns === col).map((p) => p.w),
          ),
        );
        const rowHeights = Array.from(
          { length: Math.ceil(peers.length / columns) },
          (_, row) =>
            Math.max(
              ...peers
                .slice(row * columns, (row + 1) * columns)
                .map((p) => p.h),
            ),
        );
        const id = `category:${context}:${kind}`;
        grouped.push({
          n: { id, kind: "category" },
          category: { id, kind, ids: peers.map((p) => p.n.id), parentId },
          kids: peers,
          columns,
          colWidths,
          rowHeights,
          pad: 20,
          top: 60,
          colGap: 160,
          rowGap: 88,
          w: colWidths.reduce((a, b) => a + b, 0) + (columns - 1) * 160 + 40,
          h:
            rowHeights.reduce((a, b) => a + b, 0) +
            (rowHeights.length - 1) * 88 +
            84,
        });
      }
      return grouped;
    }
    function measure(n, force = false) {
      const kids =
        containers.has(n.id) && (boundedOpen ? boundedOpen.has(n.id) : force || open.has(n.id))
          ? children(n.id) : [];
      if (!kids.length) return leaf(n);
      const parts = groupParts(
        kids.map((c) => measure(c, force)),
        n.id,
        n.id,
      );
      const columns = parts.length > 6 ? Math.ceil(Math.sqrt(parts.length)) :
        parts.length === 3 && parts.every((p) => !containers.has(p.n.id))
          ? 3
          : parts.length > 1 && parts.every((p) => containers.has(p.n.id))
            ? 2
            : 1;
      const colWidths = Array.from({ length: columns }, (_, col) =>
        Math.max(
          ...parts.filter((_, i) => i % columns === col).map((p) => p.w),
        ),
      );
      const rowHeights = Array.from(
        { length: Math.ceil(parts.length / columns) },
        (_, row) =>
          Math.max(
            ...parts.slice(row * columns, (row + 1) * columns).map((p) => p.h),
          ),
      );
      return {
        n,
        kids: parts,
        columns,
        colWidths,
        rowHeights,
        w: colWidths.reduce((a, b) => a + b, 0) + (columns - 1) * 200 + 48,
        h:
          rowHeights.reduce((a, b) => a + b, 0) +
          (rowHeights.length - 1) * GAP +
          74,
      };
    }
    function place(block, x, y, depth = 0) {
      if (!block.kids.length) {
        items.push({ n: block.n, x, y, w: block.w, h: block.h });
        return;
      }
      if (block.category)
        categoryBounds.push({
          ...block.category,
          x,
          y,
          w: block.w,
          h: block.h,
          header: { x: x + 16, y: y + 12, w: block.w - 32, h: 24 },
        });
      else bounds.push({ id: block.n.id, x, y, w: block.w, h: block.h, depth });
      const pad = block.pad ?? 24,
        top = block.top ?? 48;
      const colGap = block.colGap ?? 200,
        rowGap = block.rowGap ?? GAP;
      for (let i = 0; i < block.kids.length; i++) {
        const col = i % block.columns,
          row = Math.floor(i / block.columns),
          p = block.kids[i];
        const bx =
          x +
          pad +
          block.colWidths.slice(0, col).reduce((a, b) => a + b, 0) +
          col * colGap +
          (block.colWidths[col] - p.w) / 2;
        const by =
          y +
          top +
          block.rowHeights.slice(0, row).reduce((a, b) => a + b, 0) +
          row * rowGap +
          (block.rowHeights[row] - p.h) / 2;
        place(p, bx, by, depth + (block.category ? 0 : 1));
      }
    }
    let edgeList = options.edges || model.edges;
    if (options.focusNodes) {
      const visible = paginate([...new Set(options.focusNodes)]
        .map((id) => all.get(id))
        .filter(Boolean), "paged-focus");
      if (options.categoryGroups) {
        const parts = groupParts(visible.map(leaf), null, "focus");
        const rowWidth = Math.max(1100, ...parts.map((part) => part.w));
        let x = 48,
          y = 80,
          rowHeight = 0;
        for (const part of parts) {
          if (x > 48 && x + part.w > 48 + rowWidth) {
            x = 48;
            y += rowHeight + 48;
            rowHeight = 0;
          }
          place(part, x, y);
          x += part.w + 140;
          rowHeight = Math.max(rowHeight, part.h);
        }
      } else {
        // Context can mix components with collapsed ancestors. Keep canonical
        // endpoints intact until project() resolves their visible ancestors.
        // A folded reading grid keeps long scenarios from collapsing into a tiny column.
        // Direction remains encoded exclusively by arrowheads and original edges.
        const columns = visible.length > 24 ? Math.ceil(Math.sqrt(visible.length)) : Math.min(
          4,
          Math.max(2, Math.ceil(Math.sqrt(visible.length * 1.5))),
        );
        const cellW = Math.max(
          W,
          ...visible.map((n) => (containers.has(n.id) ? 260 : W)),
        );
        const cellH = Math.max(
          H,
          ...visible.map((n) => (containers.has(n.id) ? CH : H)),
        );
        for (let i = 0; i < visible.length; i++) {
          const row = Math.floor(i / columns),
            position = i % columns;
          const col = row % 2 ? columns - 1 - position : position;
          items.push({
            n: visible[i],
            x: 48 + col * (cellW + 200),
            y: 80 + row * (cellH + 140),
            w: containers.has(visible[i].id) ? 260 : W,
            h: containers.has(visible[i].id) ? CH : H,
          });
        }
      }
    } else {
      let roots = options.scope
        ? children(options.scope)
        : model.groups.map((g) => containers.get(g.id));
      boundFrontier(roots);
      roots = paginate(roots, "paged-scope");
      const parts = groupParts(
        roots.map((n) => measure(n, options.mode === "components")),
        options.scope || null,
        options.scope || "root",
      );
      const cols = parts.length > 6 ? Math.ceil(Math.sqrt(parts.length)) :
        options.scope && parts.some((p) => p.kids.length)
          ? 1
          : Math.min(options.scope ? 2 : 3, parts.length) || 1;
      const colW = Array.from({ length: cols }, (_, c) =>
        Math.max(0, ...parts.filter((_, i) => i % cols === c).map((p) => p.w)),
      );
      const rowH = Array.from(
        { length: Math.ceil(parts.length / cols) },
        (_, r) =>
          Math.max(...parts.slice(r * cols, (r + 1) * cols).map((p) => p.h)),
      );
      parts.forEach((p, i) => {
        const col = i % cols,
          row = Math.floor(i / cols);
        place(
          p,
          48 +
            colW.slice(0, col).reduce((a, b) => a + b, 0) +
            col * 210 +
            (colW[col] - p.w) / 2,
          80 +
            rowH.slice(0, row).reduce((a, b) => a + b, 0) +
            row * 100 +
            (rowH[row] - p.h) / 2,
        );
      });
    }
    const projection = root.CodeLoomRelations.project(model, {
      visibleIds: items.map((p) => p.n.id),
      edges: edgeList,
      bundle: options.bundle !== false,
    });
    if (unpagedIds) {
      const complete = root.CodeLoomRelations.project(model, {
        visibleIds: unpagedIds, edges: edgeList, bundle: false,
      });
      const outsideScope = new Set(complete.hiddenEdgeIds);
      frontierProjection.offPageEdgeIds = projection.hiddenEdgeIds.filter(id => !outsideScope.has(id));
      frontierProjection.paging.offPageEdgeCount = frontierProjection.offPageEdgeIds.length;
    }
    const scene = {
      items,
      bounds,
      categoryBounds,
      relations: projection.relations,
      internal: projection.internal,
      hiddenEdgeIds: projection.hiddenEdgeIds,
      wires: [],
      hubs: [],
      projection: frontierProjection,
    };
    const lookup = new Map(items.map((p) => [p.n.id, p]));
    const rectangles = items.map((p) => ({
      x: p.x,
      y: p.y,
      width: p.w,
      height: p.h,
    }));
    // Category backgrounds are decorative; only their title bands are solid
    // routing obstacles, keeping wires and relation labels off the titles.
    rectangles.push(
      ...categoryBounds.map(({ header }) => ({
        x: header.x,
        y: header.y,
        width: header.w,
        height: header.h,
      })),
    );
    const center = (p) => ({ x: p.x + p.w / 2, y: p.y + p.h / 2 });
    const overlaps = (a, b, pad = 0) =>
      a.x + a.width > b.x - pad &&
      a.x < b.x + b.width + pad &&
      a.y + a.height > b.y - pad &&
      a.y < b.y + b.height + pad;
    const maxX = Math.max(
      320,
      ...items.map((p) => p.x + p.w),
      ...bounds.map((b) => b.x + b.w),
      ...categoryBounds.map((b) => b.x + b.w),
    );
    const maxY = Math.max(
      250,
      ...items.map((p) => p.y + p.h),
      ...bounds.map((b) => b.y + b.h),
      ...categoryBounds.map((b) => b.y + b.h),
    );
    for (const rel of projection.relations) {
      const ends = [...new Set([...rel.sources, ...rel.targets])]
        .map((id) => lookup.get(id))
        .filter(Boolean);
      const centers = ends.map(center),
        xs = centers.map((c) => c.x),
        ys = centers.map((c) => c.y);
      const mid = {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
      };
      const w = rel.edgeIds.length > 1 ? 132 : 112,
        h = 34;
      // Prefer reserved horizontal/vertical gutters, then closest free space.
      const xg = [
        ...new Set([
          mid.x,
          ...items.flatMap((p) => [p.x - w / 2 - 28, p.x + p.w + w / 2 + 28]),
          ...scene.hubs.flatMap((p) => [
            p.x - w / 2 - 28,
            p.x + p.w + w / 2 + 28,
          ]),
          maxX + w / 2 + 28,
        ]),
      ];
      const yg = [
        ...new Set([
          mid.y,
          ...items.flatMap((p) => [p.y - h / 2 - 28, p.y + p.h + h / 2 + 28]),
          ...scene.hubs.flatMap((p) => [
            p.y - h / 2 - 28,
            p.y + p.h + h / 2 + 28,
          ]),
          maxY + h / 2 + 28,
        ]),
      ];
      // Sample free slots down each vertical gutter so later hubs can use its
      // remaining space instead of creating a column outside the overview.
      for (let y = 54; y <= maxY - h / 2; y += h + 28) yg.push(y);
      // The old exhaustive Cartesian scan tested every gutter pair against
      // every obstacle, even after finding a better nearby slot. Its score is
      // separable by axis: ordered axis costs give an exact lower bound, so we
      // can stop each row and the entire search without changing placement.
      const xSlots = xg.filter((x) => x >= w / 2 + 10).map((x) => ({
        value: x,
        cost: Math.abs(x - mid.x) + 3 * Math.max(0, x + w / 2 - maxX),
      })).sort((a, b) => a.cost - b.cost || a.value - b.value);
      const ySlots = [...new Set(yg)].filter((y) => y >= 54).map((y) => ({
        value: y,
        cost: Math.abs(y - mid.y) + Math.abs(y - mid.y) * 0.15 +
          3 * Math.max(0, y + h / 2 - maxY),
      })).sort((a, b) => a.cost - b.cost || a.value - b.value);
      let chosen, bestScore = Infinity;
      for (const x of xSlots) {
        if (x.cost + (ySlots[0]?.cost ?? Infinity) > bestScore) break;
        for (const y of ySlots) {
          const score = x.cost + y.cost;
          if (score > bestScore) break;
          const rect = { x: x.value - w / 2, y: y.value - h / 2, width: w, height: h };
          if (rectangles.some((r) => overlaps(rect, r, 24))) continue;
          if (score < bestScore || !chosen || rect.y < chosen.y ||
              (rect.y === chosen.y && rect.x < chosen.x)) {
            chosen = rect;
            bestScore = score;
          }
          break;
        }
      }
      if (!chosen) {
        // If all local slots are occupied, add compact columns with the same
        // height as the diagram. A bounded scan replaces vertical overflow.
        const rows = Math.max(1, Math.floor((maxY - 80) / (h + 28)));
        for (let slot = 0; slot <= rectangles.length * 4; slot++) {
          const rect = {
            x: maxX + 28 + Math.floor(slot / rows) * (w + 28),
            y: 80 + (slot % rows) * (h + 28),
            width: w,
            height: h,
          };
          if (!rectangles.some((r) => overlaps(rect, r, 24))) {
            chosen = rect;
            break;
          }
        }
        // An exterior column always provides a final finite candidate.
        if (!chosen)
          chosen = {
            x: Math.max(maxX, ...rectangles.map((r) => r.x + r.width)) + 28,
            y: 80,
            width: w,
            height: h,
          };
      }
      const hub = {
        ...chosen,
        w: chosen.width,
        h: chosen.height,
        relation: rel,
        n: { id: rel.id },
        id: rel.id,
      };
      scene.hubs.push(hub);
      rectangles.push(chosen);
      lookup.set(rel.id, hub);
    }
    const incidences = [];
    for (const hub of scene.hubs) {
      const r = hub.relation;
      for (const id of r.sources)
        incidences.push({ relation: r, from: id, to: hub.id, role: "source" });
      for (const id of r.targets)
        incidences.push({ relation: r, from: hub.id, to: id, role: "target" });
    }
    const ports = new Map();
    const side = (a, b) => {
      const ac = center(a),
        bc = center(b),
        dx = bc.x - ac.x,
        dy = bc.y - ac.y;
      return Math.abs(dx) / (a.w || 1) > Math.abs(dy) / (a.h || 1)
        ? dx >= 0
          ? "right"
          : "left"
        : dy >= 0
          ? "down"
          : "up";
    };
    for (const wire of incidences) {
      const a = lookup.get(wire.from),
        b = lookup.get(wire.to);
      wire.fromSide = side(a, b);
      wire.toSide = side(b, a);
      for (const [id, key] of [
        [wire.from, "from"],
        [wire.to, "to"],
      ]) {
        const k = id + "|" + wire[key + "Side"];
        if (!ports.has(k)) ports.set(k, []);
        ports.get(k).push({ wire, key });
      }
    }
    for (const [key, values] of ports) {
      const [id, s] = key.split("|"),
        p = lookup.get(id);
      values.sort((a, b) => {
        const aa = center(
            lookup.get(a.key === "from" ? a.wire.to : a.wire.from),
          ),
          bb = center(lookup.get(b.key === "from" ? b.wire.to : b.wire.from));
        return (
          (s === "left" || s === "right" ? aa.y - bb.y : aa.x - bb.x) ||
          a.wire.relation.id.localeCompare(b.wire.relation.id)
        );
      });
      values.forEach(({ wire, key }, i) => {
        const fraction = (i + 1) / (values.length + 1);
        wire[key + "Port"] =
          s === "right"
            ? { x: p.x + p.w, y: p.y + p.h * fraction }
            : s === "left"
              ? { x: p.x, y: p.y + p.h * fraction }
              : s === "up"
                ? { x: p.x + p.w * fraction, y: p.y }
                : { x: p.x + p.w * fraction, y: p.y + p.h };
      });
    }
    const vector = {
        left: { x: -1, y: 0 },
        right: { x: 1, y: 0 },
        up: { x: 0, y: -1 },
        down: { x: 0, y: 1 },
      },
      reverse = { left: "right", right: "left", up: "down", down: "up" };
    const usedSegments = [];
    scene.routing = { laneFallbackCount: 0, expandedBudgetCount: 0 };
    for (const wire of incidences) {
      const a = wire.fromPort,
        b = wire.toPort,
        av = vector[wire.fromSide],
        bv = vector[wire.toSide];
      const start = { x: a.x + av.x * 10, y: a.y + av.y * 10 },
        end = { x: b.x + bv.x * 10, y: b.y + bv.y * 10 };
      const routeOptions = {
        padding: 8,
        bendPenalty: 30,
        startDirection: wire.fromSide,
        endDirection: reverse[wire.toSide],
        usedSegments,
      };
      // Dense occupied-lane coordinates, not card count alone, inflate the
      // visibility grid. Use the router's safe lane-separation relaxation
      // earlier in large views. Every card and port constraint stays intact.
      const dense = rectangles.length > 64;
      let route = root.CodeLoomOrthogonal.route(start, end, rectangles, {
        ...routeOptions, ...(dense ? { maxGridPoints: 30000 } : {}),
      });
      if (route.blocked && dense) {
        route = root.CodeLoomOrthogonal.route(start, end, rectangles, routeOptions);
        scene.routing.expandedBudgetCount++;
      }
      if (route.laneFallback) scene.routing.laneFallbackCount++;
      if (route.blocked) {
        scene.wires.push({ ...wire, points: [], path: "", blocked: true });
        continue;
      }
      const points = [a, ...route.points, b];
      for (let i = 1; i < points.length; i++)
        usedSegments.push({ a: points[i - 1], b: points[i] });
      scene.wires.push({
        ...wire,
        points,
        path: root.CodeLoomOrthogonal.pathFromPoints(points),
        blocked: false,
      });
    }
    scene.width =
      Math.max(
        maxX,
        ...scene.hubs.map((h) => h.x + h.w),
        ...scene.wires.flatMap((w) => w.points.map((p) => p.x)),
      ) + 60;
    scene.height =
      Math.max(
        maxY,
        ...scene.hubs.map((h) => h.y + h.h),
        ...scene.wires.flatMap((w) => w.points.map((p) => p.y)),
      ) + 60;
    return scene;
  }
  root.CodeLoomScene = { build };
})(typeof window !== "undefined" ? window : globalThis);
