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
    const children = (id) =>
      [...containers.values(), ...nodes.values()].filter(
        (n) => (n.parentId || (!containers.has(n.id) ? n.group : null)) === id,
      );
    const open = new Set(options.open || []),
      items = [],
      bounds = [],
      categoryBounds = [];
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
        const columns = Math.min(3, peers.length);
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
        containers.has(n.id) && (force || open.has(n.id)) ? children(n.id) : [];
      if (!kids.length) return leaf(n);
      const parts = groupParts(
        kids.map((c) => measure(c, force)),
        n.id,
        n.id,
      );
      const columns =
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
      const visible = options.focusNodes
        .map((id) => all.get(id))
        .filter(Boolean);
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
        const columns = Math.min(
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
      const parts = groupParts(
        roots.map((n) => measure(n, options.mode === "components")),
        options.scope || null,
        options.scope || "root",
      );
      const cols =
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
    const scene = {
      items,
      bounds,
      categoryBounds,
      relations: projection.relations,
      internal: projection.internal,
      hiddenEdgeIds: projection.hiddenEdgeIds,
      wires: [],
      hubs: [],
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
      const candidates = [];
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
      for (const x of xg)
        for (const y of yg) {
          if (x < w / 2 + 10 || y < 54) continue;
          const rect = { x: x - w / 2, y: y - h / 2, width: w, height: h };
          if (rectangles.some((r) => overlaps(rect, r, 24))) continue;
          const score =
            Math.abs(x - mid.x) +
            Math.abs(y - mid.y) +
            Math.abs(y - mid.y) * 0.15 +
            3 * Math.max(0, rect.x + rect.width - maxX) +
            3 * Math.max(0, rect.y + rect.height - maxY);
          candidates.push({ rect, score });
        }
      candidates.sort(
        (a, b) =>
          a.score - b.score || a.rect.y - b.rect.y || a.rect.x - b.rect.x,
      );
      let chosen = candidates[0]?.rect;
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
    for (const wire of incidences) {
      const a = wire.fromPort,
        b = wire.toPort,
        av = vector[wire.fromSide],
        bv = vector[wire.toSide];
      const start = { x: a.x + av.x * 10, y: a.y + av.y * 10 },
        end = { x: b.x + bv.x * 10, y: b.y + bv.y * 10 };
      const route = root.CodeLoomOrthogonal.route(start, end, rectangles, {
        padding: 8,
        bendPenalty: 30,
        startDirection: wire.fromSide,
        endDirection: reverse[wire.toSide],
        usedSegments,
      });
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
