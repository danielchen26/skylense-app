/* Skylense — local, dependency-free hierarchical graph workspace. */
(() => {
  "use strict";
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const escape = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const paths = {
    pause: '<path d="M8 4v16M16 4v16"/>',
    fanout:
      '<path d="M3 12h7M10 5v14M10 5h10M10 12h10M10 19h10m-3-3 3 3-3 3m0-13 3 3-3 3m0-13 3 3-3 3"/>',
    fanin: '<path d="M3 5h7M3 12h7M3 19h7M10 5v14M10 12h11m-4-4 4 4-4 4"/>',
    layers:
      '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
    box: '<path d="m12 3 9 5v9l-9 5-9-5V8l9-5Z"/><path d="m3 8 9 5 9-5M12 13v9M7 5l10 5"/>',
    arrow: '<path d="M4 12h16m-5-5 5 5-5 5"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    down: '<path d="m5 9 7 7 7-7"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
    flow: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M6 9v9h9M15 6h6m-3-3 3 3-3 3"/>',
    route:
      '<circle cx="5" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M7 5h9a4 4 0 0 1 0 8H8a3 3 0 0 0 0 6h9"/>',
    external: '<path d="M14 3h7v7m0-7L10 14M10 3H4v17h17v-6"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 17v4h16v-4"/>',
    plus: '<path d="M5 12h14M12 5v14"/>',
    minus: '<path d="M5 12h14"/>',
    fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    back: '<path d="m10 5-7 7 7 7M3 12h18"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
    moon: '<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>',
    code: '<path d="m8 5-6 7 6 7m8-14 6 7-6 7M14 3l-4 18"/>',
    database:
      '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
    bookmark: '<path d="M6 3h12v18l-6-4-6 4V3Z"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    compare:
      '<rect x="2" y="4" width="8" height="16" rx="1"/><rect x="14" y="4" width="8" height="16" rx="1"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>',
    document: '<path d="M14 2H5v20h14V7l-5-5ZM14 2v6h5M8 12h8M8 16h8"/>',
    menu: '<path d="M3 5h18M3 12h18M3 19h18"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
    play: '<path d="m7 3 14 9-14 9V3Z"/>',
    link: '<path d="m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l4-4m12 0 2-2a4 4 0 0 1 6 6l-4 4" transform="translate(1 0) scale(.9)"/>',
  };
  const icon = (name) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.box}</svg>`;
  // The CLI credential is scoped to this random loopback origin and tab session.
  // It is scrubbed from the URL and is never stored with model content or exports.
  const initialURL = new URL(location.href);
  const initialHash = new URLSearchParams(initialURL.hash.slice(1));
  const bridgeSessionKey = "skylense:local-bridge-token";
  const bridgeRequested = initialURL.searchParams.get("bridge") === "local" &&
    initialURL.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(initialURL.hostname);
  let initialBridgeToken = initialHash.get("bridgeToken");
  if (bridgeRequested && !initialBridgeToken) {
    try { initialBridgeToken = sessionStorage.getItem(bridgeSessionKey); } catch {}
  }
  const localBridge = bridgeRequested && /^[A-Za-z0-9_-]{24,256}$/.test(initialBridgeToken || "")
    ? { origin: initialURL.origin, token: initialBridgeToken } : null;
  if (localBridge) {
    try { sessionStorage.setItem(bridgeSessionKey, localBridge.token); } catch {}
  }
  if (initialHash.has("bridgeToken")) {
    initialHash.delete("bridgeToken");
    initialURL.hash = initialHash.toString();
    history.replaceState(null, "", initialURL);
  }
  let data = window.ATLAS_DATA;
  AtlasGraph.validate(data);
  let nodes,
    containers,
    all,
    groupMap,
    imported = false;
  const generated = () => Boolean(data.meta?.ingestion);
  let sourceJob = null, sourceSerial = 0, sourcePreview = null;
  let sourceTab = "files";
  function index() {
    nodes = new Map(data.nodes.map((n) => [n.id, n]));
    groupMap = new Map(data.groups.map((n) => [n.id, n]));
    containers = new Map(
      (data.hierarchy || data.groups).map((n) => [
        n.id,
        {
          ...n,
          kind: "container",
          label: groupMap.get(n.id)?.label || n.label,
          summary: groupMap.get(n.id)?.description || n.summary || "",
          group: n.group || n.id,
        },
      ]),
    );
    all = new Map([...containers, ...nodes]);
  }
  index();
  const state = {
    scope: null,
    selected: null,
    mode: "hierarchy",
    tab: "overview",
    type: "all",
    query: "",
    expanded: new Set(),
    trace: null,
    flow: null,
    step: 0,
    compare: [],
    camera: { x: 30, y: 40, z: 1 },
    dark: false,
    openContainers: [],
    relation: null,
    lastRelation: null,
    bundle: true,
    lens: "scope",
    present: false,
    levelFocus: "auto",
    focusDimming: true,
    categoryGroups: true,
  };
  let routeDraft = null, routeResult = null;
  const cameraCache = new Map();
  const storage = {
    get(key, fallback) {
      try {
        return JSON.parse(localStorage.getItem("atlas:" + key)) ?? fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem("atlas:" + key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
  };
  let themeId = SkylenseThemes.resolve(storage.get("theme", storage.get("dark", false) ? "midnight" : "porcelain")).id;
  state.dark = SkylenseThemes.apply(themeId).dark;
  let motionWanted = storage.get("motion", true) !== false;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const motion = CodeLoomMotion.createController();
  document.addEventListener("visibilitychange", updateMotion);
  reducedMotion.addEventListener("change", updateMotion);
  window.addEventListener("pagehide", () => motion.setEnabled(false));
  window.addEventListener("pageshow", updateMotion);
  const viewStorageKey = "views:" + (data.meta?.id || "import") + ":" + (data.meta?.revision || "local");
  let saved = storage.get(viewStorageKey, []);
  if (!Array.isArray(saved)) saved = [];
  const groupColor = (n) => groupMap.get(n.group || n.id)?.color || "#689c80";
  const kindIcon = (n) => CodeLoomSemantics.node(n?.kind).icon;
  const readingHistory = [];
  function descendants(id) {
    return data.nodes.filter((n) => {
      let p = n.parentId || n.group;
      const visited = new Set();
      while (p && !visited.has(p)) {
        if (p === id) return true;
        visited.add(p);
        p = containers.get(p)?.parentId;
      }
      return false;
    });
  }
  function members(id) {
    return nodes.has(id) ? [id] : descendants(id).map((n) => n.id);
  }
  function incident(id) {
    const ids = new Set(members(id));
    return {
      incoming: data.edges.filter(
        (e) => ids.has(e.target) && !ids.has(e.source),
      ),
      outgoing: data.edges.filter(
        (e) => ids.has(e.source) && !ids.has(e.target),
      ),
      internal: data.edges.filter(
        (e) => ids.has(e.source) && ids.has(e.target),
      ),
    };
  }
  function label(id) {
    return all.get(id)?.label || id;
  }
  function crumbIds(id) {
    const chain = [];
    const seen = new Set();
    let cursor = id;
    while (cursor && all.has(cursor) && !seen.has(cursor)) {
      seen.add(cursor);
      chain.unshift(cursor);
      cursor = all.get(cursor).parentId;
    }
    return chain;
  }
  function textIO(value) {
    return Array.isArray(value)
      ? value
          .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
          .join(" · ")
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value || "—");
  }
  function toast(message) {
    $("#toast").textContent = message;
    $("#toast").classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => $("#toast").classList.remove("show"), 3500);
  }
  function snapshotState() {
    return {
      lens: state.lens,
      levelFocus: state.levelFocus,
      focusDimming: state.focusDimming,
      categoryGroups: state.categoryGroups,
      present: state.present,
      scope: state.scope,
      selected: state.selected,
      mode: state.mode,
      flow: state.flow,
      step: state.step,
      type: state.type,
      tab: state.tab,
      trace: state.trace,
      camera: { ...state.camera },
      openContainers: [...state.openContainers],
      relation: state.relation,
      lastRelation: state.lastRelation,
      bundle: state.bundle,
    };
  }
  function hash() {
    const p = new URLSearchParams();
    p.set("scope", state.scope || "system");
    p.set("focus", state.selected || "");
    p.set("mode", state.mode);
    if (state.lens !== "scope") p.set("lens", state.lens);
    if (state.present) p.set("present", "1");
    if (state.levelFocus !== "auto") p.set("level", state.levelFocus);
    if (!state.focusDimming) p.set("dim", "off");
    if (!state.categoryGroups) p.set("categories", "off");
    if (state.flow) p.set("flow", state.flow);
    if (state.step) p.set("step", state.step);
    if (state.tab !== "overview") p.set("tab", state.tab);
    if (state.trace?.origins) {
      p.set("contextReach", state.trace.direction);
      p.set("contextOrigins", state.trace.origins.join(","));
    }
    if (state.trace?.direction && !state.trace.origins && state.trace.kind !== "path") {
      p.set("reach", state.trace.direction);
      p.set("origin", state.trace.origin || state.selected);
    }
    if (state.trace?.kind === "relation") {
      p.set("relationView", "detail");
      p.set("relationTrace", state.trace.edges.join(","));
    }
    if (state.trace?.start) {
      p.set("from", state.trace.start);
      p.set("to", state.trace.end);
    }
    if (state.trace?.kind === "path") {
      const plan = state.trace.plan;
      p.set("route", "1");
      p.set("via", plan.stops.slice(1, -1).join(","));
      p.set("pathDir", plan.direction);
      p.set("pathTypes", plan.types === null ? "*" : plan.types.join(","));
      p.set("pathHops", plan.maxHops);
      if (state.trace.choice) p.set("pathChoice", state.trace.choice);
    }
    p.set("type", state.type);
    p.set("open", state.openContainers.join(","));
    if (!state.bundle) p.set("bundle", "off");
    if (state.relation) {
      p.set("relation", state.relation.edgeIds.join(","));
      if (state.relation.parentEdgeIds)
        p.set("relationParent", state.relation.parentEdgeIds.join(","));
    }
    try {
      history.replaceState(null, "", "#" + p);
    } catch {}
  }
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    if (!p.size) return;
    // Old example links must not suppress the new model defaults.
    if (p.get("scope") && p.get("scope") !== "system" && !containers.has(p.get("scope"))) return;
    state.trace = null;
    state.lastRelation = null;
    state.levelFocus = validLevelFocus(p.get("level"));
    state.focusDimming = p.get("dim") !== "off";
    state.categoryGroups = p.get("categories") !== "off";
    state.lens = ["scope", "neighbors", "global"].includes(p.get("lens"))
      ? p.get("lens")
      : "scope";
    state.present = p.get("present") === "1";
    state.tab = [
      "overview",
      "connections",
      "contracts",
      "context",
      "evidence",
      "members",
      "docs",
    ].includes(p.get("tab"))
      ? p.get("tab")
      : "overview";
    if (p.has("open"))
      state.openContainers = p
        .get("open")
        .split(",")
        .filter((id) => containers.has(id));
    state.bundle = p.get("bundle") !== "off";
    const edgeIds = new Set(data.edges.map((e) => e.id));
    const relationIds = (p.get("relation") || "")
      .split(",")
      .filter((id) => edgeIds.has(id));
    const parentIds = (p.get("relationParent") || "")
      .split(",")
      .filter((id) => edgeIds.has(id));
    state.relation = relationIds.length
      ? {
          edgeIds: relationIds,
          parentEdgeIds: parentIds.length ? parentIds : null,
        }
      : null;
    state.scope = containers.has(p.get("scope")) ? p.get("scope") : null;
    state.selected = all.has(p.get("focus")) ? p.get("focus") : null;
    state.mode = ["hierarchy", "components", "flow"].includes(p.get("mode"))
      ? p.get("mode")
      : "hierarchy";
    state.flow = (data.flows || []).some((f) => f.id === p.get("flow"))
      ? p.get("flow")
      : null;
    if (state.mode === "flow" && !state.flow) state.mode = "hierarchy";
    state.type = ["all", ...new Set(data.edges.map((e) => e.type))].includes(
      p.get("type"),
    )
      ? p.get("type")
      : "all";
    state.step = Number(p.get("step")) || 0;
    if (p.get("relationView") === "detail") {
      const traceIds = (
        p.has("relationTrace") ? p.get("relationTrace").split(",") : relationIds
      ).filter((id) => edgeIds.has(id));
      const edges = data.edges.filter((e) => traceIds.includes(e.id));
      if (edges.length)
        state.trace = {
          kind: "relation",
          edges: edges.map((e) => e.id),
          nodes: [...new Set(edges.flatMap((e) => [e.source, e.target]))],
        };
    }
    if (
      p.get("reach") &&
      nodes.has(state.selected) &&
      ["upstream", "downstream"].includes(p.get("reach"))
    )
      state.trace = {
        ...AtlasGraph.reachable(
          filteredEdges(),
          nodes.has(p.get("origin")) ? p.get("origin") : state.selected,
          p.get("reach"),
        ),
        direction: p.get("reach"),
        origin: nodes.has(p.get("origin")) ? p.get("origin") : state.selected,
      };
    if (["upstream", "downstream"].includes(p.get("contextReach"))) {
      const origins = (p.get("contextOrigins") || "")
        .split(",")
        .filter((id) => nodes.has(id));
      if (origins.length)
        state.trace = makeContextTrace(origins, p.get("contextReach"));
    }
    if (nodes.has(p.get("from")) && nodes.has(p.get("to"))) {
      const plan = {
        stops: [p.get("from"), ...(p.get("via") || "").split(",").filter(Boolean), p.get("to")],
        direction: p.get("pathDir") || "downstream",
        types: p.get("route") === "1" ? (p.get("pathTypes") === "*" ? null : (p.get("pathTypes") || "").split(",").filter(Boolean)) : state.type === "all" ? null : [state.type],
        maxHops: p.has("pathHops") ? Number(p.get("pathHops")) : 24,
      };
      state.trace = pathTrace(plan, p.get("pathChoice"));
      if (!state.relation && !all.has(state.selected)) state.selected = plan.stops[0];
      // A route can be inspected through the global/neighbor lenses and through
      // a selected relation. Restoring it must preserve that reading context.
      if (p.get("route") !== "1") {
        state.mode = "components"; state.scope = null; state.lens = "scope";
      } else if (!["hierarchy", "components"].includes(p.get("mode"))) {
        state.mode = "components";
      }
      state.flow = null;
    }
  }
  function filteredEdges() {
    return state.type === "all"
      ? data.edges
      : data.edges.filter((e) => e.type === state.type);
  }
  readHash();
  document.body.classList.toggle("dark", state.dark);
  function normalizeSelection() {
    if (state.mode !== "hierarchy" || state.trace || !nodes.has(state.selected))
      return;
    const n = nodes.get(state.selected),
      chain = crumbIds(n.id);
    if (state.scope && !chain.includes(state.scope))
      state.scope = n.parentId || n.group;
    const start = state.scope ? chain.indexOf(state.scope) + 1 : 0;
    state.openContainers = [
      ...new Set([...state.openContainers, ...chain.slice(start, -1)]),
    ];
  }
  const edgeById = (id) => data.edges.find((e) => e.id === id);
  const semanticInk = (entry) => (state.dark ? entry.darkColor : entry.color);
  const typeStyle = (type) =>
    `--ink:${semanticInk(CodeLoomSemantics.relation(type))}`;
  const typeBadge = (type) => {
    const t = CodeLoomSemantics.relation(type);
    return `<span class="type-badge" style="${typeStyle(type)}">${icon(t.icon)}${escape(t.shortLabel)}<small>${escape(type)}</small></span>`;
  };
  const categoryBadge = (n) => {
    const t = CodeLoomSemantics.node(n.kind);
    return `<span class="category-badge" style="--ink:${semanticInk(t)}">${icon(t.icon)}${escape(t.label)}</span>`;
  };
  function selectionContext() {
    return CodeLoomContext.describe(data, {
      nodeId: state.relation ? undefined : state.selected || state.scope,
      edgeIds: state.relation?.edgeIds || [],
      type: state.type,
    });
  }
  function relationTopology(edges) {
    const sources = [...new Set(edges.map((e) => e.source))],
      targets = [...new Set(edges.map((e) => e.target))];
    const key =
      edges.length === 1
        ? "single"
        : sources.length === 1 && targets.length > 1
          ? "fanout"
          : targets.length === 1 && sources.length > 1
            ? "fanin"
            : "parallel";
    return {
      key,
      icon: {
        single: "arrow",
        fanout: "fanout",
        fanin: "fanin",
        parallel: "layers",
      }[key],
      label: {
        single: "单条关系",
        fanout: "扇出关系束",
        fanin: "扇入关系束",
        parallel: "聚合关系束",
      }[key],
      cardinality: `${sources.length} → ${targets.length}`,
    };
  }
  function actionLabels(edges) {
    return [...new Set(edges.map((e) => e.label || e.type))];
  }
  function rememberReading() {
    const current = snapshotState();
    delete current.lastRelation;
    const last = readingHistory[readingHistory.length - 1];
    if (
      !last ||
      JSON.stringify({ ...last, camera: undefined }) !==
        JSON.stringify({ ...current, camera: undefined })
    )
      readingHistory.push(JSON.parse(JSON.stringify(current)));
    if (readingHistory.length > 30) readingHistory.shift();
  }
  function makeContextTrace(origins, direction) {
    const found = new Set(origins),
      edgeIds = new Set();
    for (const origin of origins) {
      const result = AtlasGraph.reachable(filteredEdges(), origin, direction);
      result.nodes.forEach((id) => found.add(id));
      result.edges.forEach((id) => edgeIds.add(id));
    }
    return {
      kind: "context",
      direction,
      origins: [...origins],
      nodes: [...found],
      edges: [...edgeIds],
    };
  }
  function focusReadingNode() {
    const p = layout.items.find((p) => p.n.id === state.selected);
    if (!p) return;
    const c = $("#canvas"),
      z = Math.max(0.85, state.camera.z);
    state.camera = {
      z,
      x: c.clientWidth / 2 - (p.x + p.w / 2) * z,
      y: c.clientHeight / 2 - (p.y + p.h / 2) * z,
    };
    applyCamera();
  }
  function contextSummary(ctx = selectionContext()) {
    return `<div class="relationship-summary"><button data-action="context-reach" data-value="upstream"><b>${ctx.counts.upstream}</b><span>上游可达</span></button><button data-action="lens" data-value="neighbors"><b>${ctx.counts.incoming} 入 · ${ctx.counts.outgoing} 出</b><span>直接入向 / 出向</span></button><button data-action="context-reach" data-value="downstream"><b>${ctx.counts.downstream}</b><span>下游可达</span></button></div><div class="context-actions"><button class="btn" data-action="lens" data-value="neighbors">${icon("link")}直接关联图</button><button class="btn" data-action="lens" data-value="global">${icon("grid")}全局定位</button></div>`;
  }
  function contextBody() {
    const ctx = selectionContext();
    return `<div class="detail-intro"><b>在完整代码库中的位置</b><p>保留当前选择，按模块查看直接连接与可达范围。所有数量遵循当前关系筛选。</p></div>${contextSummary(ctx)}<div class="section-label">系统区域<span>${data.groups.length}</span></div><div class="global-grid">${ctx.groups.map((g) => `<button class="global-cell ${g.selected ? "current" : ""}" data-action="scope" data-id="${escape(g.id)}" style="--tone:${groupColor(all.get(g.id))}"><span><i class="dot"></i>${escape(label(g.id))}</span><strong>${g.selected ? `当前 ${g.selected} 组件` : g.upstream || g.downstream ? `上游 ${g.upstream} · 下游 ${g.downstream}` : "无当前可达关系"}</strong><small>直接入向 ${g.incoming} · 出向 ${g.outgoing}</small></button>`).join("")}</div><div class="section-label" style="margin-top:22px">跨系统的直接连接<span>${ctx.boundaryCrossings.length}</span></div>${ctx.boundaryCrossings.length ? ctx.boundaryCrossings.map((c) => rawEdgeCard(edgeById(c.edgeId))).join("") : '<p class="empty-hint">当前选择没有跨顶层区域的直接连接。</p>'}<p class="micro">上游与下游沿原图箭头遍历，不等同于运行时调用。read 的箭头仍指向被读取的存储。</p>`;
  }
  function typeBreakdown(edges) {
    const types = [...new Set(edges.map((e) => e.type))];
    return `<div class="type-breakdown">${types.map((type) => `<button data-action="filter-type" data-value="${escape(type)}" style="${typeStyle(type)}">${typeBadge(type)}<b>${edges.filter((e) => e.type === type).length}</b></button>`).join("")}</div>`;
  }
  function evidenceLink(e) {
    // Source text is never executable. Only explicit safe web links are opened.
    const url = typeof e.url === "string" && /^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/[a-f0-9]{40}\//.test(e.url) ? e.url : null;
    if (url) return `<a class="source-link" href="${escape(url)}" target="_blank" rel="noopener noreferrer">查看固定版本源码 ↗</a>`;
    if (generated() && typeof e.url === "string") {
      try {
        const parsed = new URL(e.url);
        if (["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password)
          return `<a class="source-link" href="${escape(parsed.href)}" target="_blank" rel="noopener noreferrer">打开来源页面 ↗</a>`;
      } catch {}
    }
    return "";
  }
  function evidenceBody(n) {
    const scopedDocuments = new Set([n, ...descendants(n.id)].flatMap(item => item.documentIds || []));
    const docs = (data.documents || []).filter(
      (d) => scopedDocuments.has(d.id),
    );
    return `<div class="detail-intro"><b>源码与阅读指南</b><p>${escape(data.meta?.evidenceNote || "依据由模型作者提供。")}</p></div>${docs.map((d) => `<button class="connection" data-action="document" data-id="${escape(d.id)}">${icon("document")}<span>${escape(d.title)}<small>${d.status === "proposal" ? "拟议方案" : escape(d.path)}</small></span>${icon("external")}</button>`).join("")}<button class="btn" data-action="all-docs">全部 ${data.documents?.length || 0} 份文档</button><div class="section-label" style="margin-top:22px">原文摘录<span>${n.evidence?.length || 0}</span></div>${(n.evidence || []).map((e) => `<details class="evidence-card"><summary>${escape(e.file)} · ${e.lineStart}–${e.lineEnd}</summary>${evidenceLink(e)}<pre>${escape(e.excerpt)}</pre></details>`).join("")}`;
  }
  function contractsBody(n) {
    if (containers.has(n.id))
      return `<div class="detail-intro"><b>直接子项</b><p>保留真实父子层级；选择子项可继续查看内部接口和关系。</p></div>${immediateChildren(
        n.id,
      )
        .map(
          (c) =>
            `<button class="connection" data-action="select" data-id="${escape(c.id)}" data-peek="${escape(c.id)}">${icon(kindIcon(c))}<span>${escape(c.label)}<small>${escape(CodeLoomSemantics.node(c.kind).label)}</small></span>${icon("arrow")}</button>`,
        )
        .join("")}`;
    if (generated() && n.sourceRole === "symbol") return evidenceBody(n);
    return `<div class="detail-intro"><b>${n.functions?.length || 0} 个${generated() ? "符号 / 章节" : "函数 / 接口"}</b><p>${escape(data.meta?.functionNote || (generated() ? "查看声明、源码行号和可追踪的符号；未推断输入输出契约。" : "按职责、输入、输出阅读接口摘要。"))}</p></div>${(n.functions || []).map((f, i) => `<details class="function" ${i === 0 ? "open" : ""}><summary>${escape(f.qualifiedName || f.name)}</summary><div class="function-body">${escape(f.description || f.desc || "")}${f.nodeId && all.has(f.nodeId) ? `<button class="connection" data-action="select" data-id="${escape(f.nodeId)}">${icon("code")}<span>定位符号与关系</span>${icon("arrow")}</button>` : ""}${!generated() || f.inputs?.length ? `<div class="io"><b>输入 INPUT</b><code>${escape(textIO(f.inputs))}</code></div>` : ""}${!generated() || f.outputs?.length ? `<div class="io"><b>输出 OUTPUT</b><code>${escape(textIO(f.outputs))}</code></div>` : ""}${(f.evidence || []).map(e => `<details class="evidence-card" open><summary>${escape(e.file)} · ${e.lineStart}–${e.lineEnd}${e.excerptTruncated ? " · 摘录截断" : ""}</summary>${evidenceLink(e)}<pre>${escape(e.excerpt)}</pre></details>`).join("")}</div></details>`).join("") || '<p class="empty-hint">暂无函数契约。</p>'}`;
  }
  function renderLegend() {
    const present = [...new Set(data.edges.map((e) => e.type))];
    return `<div class="semantic-legend"><span class="legend-caption">关系类型</span>${present
      .map((type) => {
        const t = CodeLoomSemantics.relation(type);
        return `<button data-action="filter-type" data-value="${escape(type)}" class="${state.type === type ? "active" : ""}" aria-pressed="${state.type === type}" style="${typeStyle(type)}" title="${escape(t.description)}"><svg viewBox="0 0 27 8"><path d="M1 4H24" stroke="currentColor" stroke-width="2" ${t.dash ? `stroke-dasharray="${t.dash}"` : ""}/></svg>${escape(t.shortLabel)}<b>${data.edges.filter((e) => e.type === type).length}</b></button>`;
      })
      .join(
        "",
      )}<button class="legend-help" data-action="legend">${icon("info")}图例</button></div>`;
  }
  function showThemes() {
    modal("选择你的工作空间", `<p class="dialog-lead">六种主题，同一张清晰的代码地图。关系颜色和线型保留各自含义。</p><div class="theme-gallery">${SkylenseThemes.catalog.map(t => `<button class="theme-card ${t.id === themeId ? "selected" : ""}" data-action="choose-theme" data-id="${t.id}" aria-pressed="${t.id === themeId}" aria-label="使用 ${escape(t.label)} 主题"><span class="theme-preview" style="--sample-bg:${t.colors.bg};--sample-panel:${t.colors.panel};--sample-line:${t.colors.line};--sample-accent:${t.colors.accent}"><i class="sample-sidebar"></i><svg viewBox="0 0 190 86" aria-hidden="true"><path d="M44 24H93V62H145M93 24H145" fill="none" stroke="${t.colors.accent}" stroke-width="2"/><rect x="16" y="12" width="42" height="25" rx="5" fill="${t.colors.panel}" stroke="${t.colors.line}"/><rect x="134" y="12" width="42" height="25" rx="5" fill="${t.colors.panel}" stroke="${t.colors.line}"/><rect x="134" y="50" width="42" height="25" rx="5" fill="${t.colors.panel}" stroke="${t.colors.line}"/><circle cx="93" cy="24" r="4" fill="${t.colors.accent}"/></svg></span><span class="theme-card-title"><b>${escape(t.label)}</b><span>${t.id === themeId ? icon("check") : t.dark ? icon("moon") : icon("sun")}</span></span><small>${escape(t.description)}</small></button>`).join("")}</div><p class="micro">偏好保存在当前浏览器。主题切换会保留选择、阅读位置和缩放。</p>`);
  }
  function showConnect() {
    const configCommand = 'skylense config --root "/absolute/path/to/project"';
    const openCommand = 'skylense open "/absolute/path/to/project"';
    const analyzeCommand = 'skylense analyze "/absolute/path/to/project" --output model.json';
    const modelCommand = 'skylense config --model "/absolute/path/model.json"';
    const command = (value, title) => `<div class="connect-code"><code>${escape(value)}</code><button class="icon-btn" data-action="copy-command" data-value="${escape(value)}" aria-label="${escape(title)}">${icon("compare")}</button></div>`;
    modal("让代码地图进入你的工作流", `<p class="dialog-lead">从来源生成地图，再在浏览器、Agent 和终端中探索同一份模型。分析得到的地图保留完整交互工作台。</p><div class="connect-grid"><section class="connect-card"><span class="eyebrow">AGENT · MCP</span><h3>让 Agent 直接分析来源</h3><p>8 个工具覆盖来源分析、模型导出、搜索、对象详情、上下游、流程和打开视图。适用于支持本地 stdio MCP 的客户端。</p>${command(configCommand, "复制带来源目录的 MCP 配置命令")}<small>把路径换成你允许 Agent 读取的目录。未设置 --root 时，MCP 只接受公开网址，不读取任意本地目录。</small><p class="micro">让 Agent 调用 skylense_analyze，再用 repo="analyzed" 查询。skylense_view 可为 analyzed / custom 模型启动完整的本地交互网页，并保留所选对象。</p><a href="docs/MCP.md" target="_blank" rel="noopener">接入与工具说明 ${icon("external")}</a></section><section class="connect-card"><span class="eyebrow">TERMINAL · CLI</span><h3>一个命令，打开自己的地图</h3><p>安装 CLI 后，open 接收文件夹、文件、模型 JSON 或公开网址。分析报告会说明实际读取范围。</p>${command(openCommand, "复制打开来源命令")}${command(analyzeCommand, "复制生成模型命令")}<small>使用 skylense tui custom --model model.json 在终端探索导出的模型。需要 Node.js 22+；不需要模型 API 密钥。</small><a href="docs/TERMINAL.md" target="_blank" rel="noopener">安装与终端指南 ${icon("external")}</a></section></div>${imported ? `<div class="connect-current-model"><h3>继续使用当前这张地图</h3><p>先导出 JSON，再用实际文件路径生成 Agent 配置：</p>${command(modelCommand, "复制当前模型配置命令")}<button class="btn" data-action="export-json">${icon("download")}导出当前模型 JSON</button></div>` : ""}<div class="connect-boundary">${icon("info")}页面选择的文件只在当前浏览器处理，不会自动同步给 Agent。你导出的 JSON 会包含源码摘录；本地 CLI 网页与 MCP 返回的视图均由会话内服务提供。</div>`);
  }
  function showLegend() {
    modal(
      "读懂这张图",
      `<div class="legend-intro">形状区分对象，颜色与线型区分关系；选择只加强轮廓，保留原来的语义颜色。</div><div class="section-label">节点类别</div><div class="legend-categories">${[
        ...new Set(["container", ...data.nodes.map((n) => n.kind)]),
      ]
        .map((kind) => {
          const s = CodeLoomSemantics.node(kind);
          return `<div style="--ink:${semanticInk(s)}">${icon(s.icon)}<span><b>${escape(s.label)}</b><small>${escape(s.description)}</small></span></div>`;
        })
        .join("")}</div><div class="section-label">关系类型</div>${[
        ...new Set(data.edges.map((e) => e.type)),
      ]
        .map((type) => {
          const t = CodeLoomSemantics.relation(type);
          return `<div class="legend-relation">${typeBadge(type)}<p>${escape(t.description)}</p></div>`;
        })
        .join(
          "",
        )}<div class="section-label">关系结构</div><div class="legend-categories">${[
        {
          key: "single",
          label: "单边",
          text: "一条原始有向关系",
          icon: "arrow",
        },
        {
          key: "fanout",
          label: "扇出",
          text: "一个来源，多个目标",
          icon: "fanout",
        },
        {
          key: "fanin",
          label: "扇入",
          text: "多个来源，一个目标",
          icon: "fanin",
        },
        {
          key: "parallel",
          label: "聚合",
          text: "同类多条原始边，逐条保留配对",
          icon: "layers",
        },
      ]
        .map(
          (t) =>
            `<div>${icon(t.icon)}<span><b>${t.label}</b><small>${t.text}</small></span></div>`,
        )
        .join(
          "",
        )}</div><p class="micro">关系束采用多方关系的交互表达；共同参与不自动表示联合执行。完整原始配对保留在成员页。</p>`,
    );
  }

  function levelSelection() {
    const selectedIds = state.relation
      ? [
          ...new Set(
            selectedRelationEdges().flatMap((e) => [e.source, e.target]),
          ),
        ]
      : state.selected
        ? [state.selected]
        : [];
    const ctx = CodeLoomLevels.context(data, {
      selectedIds,
      visibleIds: [
        ...layout.items.map((p) => p.n.id),
        ...layout.bounds.map((b) => b.id),
      ],
      scopeId: state.scope,
    });
    // An entered scope is represented by its children, not by a duplicate card.
    if (
      !ctx.effectiveLevels.length &&
      state.selected === state.scope &&
      containers.has(state.scope)
    ) {
      const frontier = CodeLoomLevels.context(data, {
        visibleIds: layout.items.map((p) => p.n.id),
        scopeId: state.scope,
      });
      return {
        ...ctx,
        effectiveIds: frontier.effectiveIds,
        effectiveLevels: frontier.effectiveLevels,
        visiblePeers: frontier.visiblePeers,
        projectionKind: "scope-children",
      };
    }
    return ctx;
  }
  function highlightedLevels(ctx = levelSelection()) {
    return state.levelFocus === "off"
      ? []
      : state.levelFocus === "auto"
        ? ctx.effectiveLevels
        : [Number(state.levelFocus)];
  }
  function levelText(levels) {
    return levels.map((level) => `L${level}`).join(" / ");
  }
  function validLevelFocus(value) {
    return value === "off" || value === "auto"
      ? value
      : /^[1-9]\d{0,3}$/.test(String(value)) &&
          CodeLoomLevels.idsAtLevel(data, Number(value)).length
        ? String(value)
        : "auto";
  }
  function focusContext() {
    return CodeLoomFocus.describe(data, {
      selectedId: state.selected,
      relationEdgeIds: state.relation?.edgeIds || [],
      visibleIds: [
        ...layout.items.map((p) => p.n.id),
        ...layout.bounds.map((b) => b.id),
      ],
      lens: state.lens,
      type: state.type,
      trace: state.trace,
    });
  }
  function applyVisualFocus() {
    if (!$("#world")) return;
    const ctx = focusContext(),
      primary = new Set(ctx.selectedIds),
      related = new Set(ctx.relatedIds),
      edgeIds = new Set(ctx.relatedEdgeIds),
      chosenEdges = new Set(ctx.selectedEdgeIds),
      enabled = state.focusDimming && ctx.active;
    const role = (id) =>
      !enabled
        ? "normal"
        : primary.has(id)
          ? "selected"
          : related.has(id)
            ? "related"
            : "muted";
    const paint = (el, value) => {
      if (!el) return;
      el.dataset.focusRole = value;
      el.classList.toggle("focus-muted", value === "muted");
      el.classList.toggle("focus-related", value === "related");
      el.classList.toggle("focus-selected", value === "selected");
    };
    for (const el of $$("#world .graph-node"))
      paint(el.closest(".node-wrap"), role(el.dataset.id));
    for (const el of $$("#world .boundary-title"))
      paint(el.closest(".group-boundary"), role(el.dataset.id));
    for (const el of $$("#sidebar .tree-select"))
      paint(el, role(el.dataset.id));
    for (const b of layout.categoryBounds || []) {
      const roles = b.ids.map(role);
      paint(
        $$("#world .category-frame").find(
          (el) => el.dataset.categoryId === b.id,
        ),
        roles.includes("selected")
          ? "selected"
          : roles.includes("related")
            ? "related"
            : enabled
              ? "muted"
              : "normal",
      );
    }
    const edgeRole = (ids) =>
      !enabled
        ? "normal"
        : ids.some((id) => chosenEdges.has(id))
          ? "selected"
          : ids.some((id) => edgeIds.has(id))
            ? "related"
            : "muted";
    const roles = new Map(
      layout.relations.map((r) => [r.id, edgeRole(r.edgeIds)]),
    );
    for (const el of $$("#world .relation-hub"))
      paint(el, roles.get(el.dataset.id));
    const wires = layout.wires.filter((w) => !w.blocked && w.points.length > 1);
    for (const el of $$("#world [data-relation-wire]"))
      paint(el, edgeRole(wireMembers(wires[Number(el.dataset.wireIndex)])));
  }
  function categoryGroupingAvailable() {
    return state.lens !== "scope" || (state.mode !== "flow" && !state.trace);
  }
  function applyLevelHighlights() {
    if (!$("#world")) return;
    for (const button of $$('[data-action="back-selection"]'))
      button.disabled = !readingHistory.length;
    const ctx = levelSelection(),
      levels = highlightedLevels(ctx),
      active = new Set(levels);
    for (const el of $$("[data-id]")) {
      const depth = CodeLoomLevels.depth(data, el.dataset.id);
      if (!depth) continue;
      el.dataset.level = depth;
      el.classList.toggle("level-peer", active.has(depth));
      el.classList.toggle(
        "level-outside",
        active.size > 0 && !active.has(depth),
      );
      const boundary =
        el.classList.contains("boundary-title") &&
        el.closest(".group-boundary");
      if (boundary)
        boundary.classList.toggle("level-peer-boundary", active.has(depth));
    }
    applyVisualFocus();
    const host = $("#level-rail");
    if (!host) return;
    const visibleIds = [
      ...new Set([
        ...layout.items.map((p) => p.n.id),
        ...layout.bounds.map((b) => b.id),
      ]),
    ];
    const available = [
      ...new Set(visibleIds.map((id) => CodeLoomLevels.depth(data, id))),
    ].sort((a, b) => a - b);
    const projected = ctx.sourceLevels.join() !== ctx.effectiveLevels.join();
    const selectedLabel = state.selected
      ? label(state.selected)
      : state.relation
        ? "关系参与者"
        : "当前视图";
    const visibleCount = visibleIds.filter((id) =>
      active.has(CodeLoomLevels.depth(data, id)),
    ).length;
    host.innerHTML = `<div class="level-rail"><span class="level-caption">${icon("layers")}层级聚焦</span><div class="level-options" role="group" aria-label="层级聚焦"><button data-action="level-focus" data-value="auto" aria-pressed="${state.levelFocus === "auto"}">跟随选择</button>${available.map((level) => `<button data-action="level-focus" data-value="${level}" class="${active.has(level) ? "at-level" : ""}" aria-pressed="${state.levelFocus === String(level)}" title="强调当前画布上所有 L${level} 对象">L${level}<small>${visibleIds.filter((id) => CodeLoomLevels.depth(data, id) === level).length}</small></button>`).join("")}<button data-action="level-focus" data-value="off" aria-pressed="${state.levelFocus === "off"}">全部</button></div><span class="level-summary" title="${escape(selectedLabel)}${projected ? ` · 原对象 ${levelText(ctx.sourceLevels)}，投影至 ${levelText(ctx.effectiveLevels)}` : ""}">${levels.length ? `强调 ${levelText(levels)} · ${visibleCount} 个同层对象` : "显示全部层级"}${projected ? `<small>对象 ${levelText(ctx.sourceLevels)} → 视图 ${levelText(ctx.effectiveLevels)}</small>` : ""}</span><div class="display-options"><button data-action="toggle-dimming" aria-pressed="${state.focusDimming}" title="保留当前对象及直接关系，弱化无关模块；同层标记仍保留">${icon("sun")}<span>弱化无关</span></button><button data-action="toggle-categories" aria-pressed="${state.categoryGroups && categoryGroupingAvailable()}" ${categoryGroupingAvailable() ? "" : "disabled"} title="${categoryGroupingAvailable() ? "同类别放入浅色分区，保留真实父子归属" : "流程与路径保留原阅读顺序"}">${icon("grid")}<span>类别分区</span></button></div></div>`;
  }
  function levelPeers(n) {
    const depth = CodeLoomLevels.depth(data, n.id),
      ids = CodeLoomLevels.idsAtLevel(data, depth);
    return `<details class="level-peers"><summary><span class="current-level-label">L${depth} · 当前对象层级</span><span>同层 ${ids.length} 项 ${icon("chevron")}</span></summary><p>同层表示层级深度相同；父模块和对象类别可能不同。</p><div class="level-peer-list">${ids.map((id) => `<button data-action="select" data-id="${escape(id)}" class="${id === n.id ? "current" : ""}">${icon(kindIcon(all.get(id)))}<span>${escape(label(id))}<small>${escape(label(CodeLoomLevels.parent(data, id) || "System"))}</small></span>${id === n.id ? "<b>当前</b>" : ""}</button>`).join("")}</div></details>`;
  }
  function updateMotion() {
    const enabled = motionWanted && !reducedMotion.matches && !document.hidden;
    motion.setEnabled(enabled);
    document.body.classList.toggle("flow-moving", enabled);
    document.body.classList.toggle("flow-reduced", reducedMotion.matches);
    for (const button of $$('[data-action="motion"]')) {
      button.setAttribute("aria-pressed", String(motionWanted));
      button.disabled = reducedMotion.matches;
      button.setAttribute(
        "aria-label",
        reducedMotion.matches
          ? "系统减少动态已开启"
          : motionWanted
            ? "暂停连线流动"
            : "开启连线流动",
      );
      button.title = reducedMotion.matches
        ? "系统已启用减少动态，保留静态方向箭头"
        : "沿箭头展示关系方向；不代表实时流量 · M";
      button.innerHTML = `${icon(reducedMotion.matches || !motionWanted ? "play" : "pause")}<span>${reducedMotion.matches ? "静态" : motionWanted ? "流动中" : "已暂停"}</span>`;
    }
  }

  function render() {
    SkylenseThemes.apply(themeId);
    normalizeSelection();
    document.body.classList.toggle("presenting", state.present);
    hidePeek();
    $("#app").innerHTML =
      `<header class="app-header"><button class="icon-btn mobile-toggle" data-action="toggle-sidebar" aria-label="打开导航">${icon("menu")}</button><a class="brand" href="#" data-action="home" aria-label="Skylense 首页"><span class="brand-mark"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">  <rect width="64" height="64" rx="16" fill="var(--accent)"/>  <path d="M10 32C15 21 23 15 32 15C41 15 49 21 54 32C49 43 41 49 32 49C23 49 15 43 10 32Z" stroke="var(--accent-text, white)" stroke-width="3"/>  <circle cx="32" cy="32" r="11" stroke="var(--accent-text, white)" stroke-width="3"/>  <path d="M24 32H40M32 24V40" stroke="var(--accent-text, white)" stroke-width="2"/>  <circle cx="32" cy="32" r="4" fill="var(--accent-text, white)"/></svg></span>Skylense</a><span class="header-divider"></span><div class="project-name">${icon("box")}<b>${escape(data.meta?.title || "Imported model")}</b><span class="badge">${generated() ? "Source map" : imported ? "Local import" : "Public example"}</span></div><span class="spacer"></span><div class="header-actions"><button class="btn primary source-open" data-action="source-open" aria-label="打开来源">${icon("plus")}<span>打开来源</span></button><button class="btn theme-toggle" data-action="theme" aria-label="选择主题" title="选择主题 · T">${icon(state.dark ? "moon" : "sun")}<span>主题</span></button><button class="btn present-toggle" data-action="present">${icon(state.present ? "close" : "play")}${state.present ? "退出讲解" : "讲解"}</button><button class="btn hide-mobile" data-action="save">${icon("bookmark")}保存视图</button><button class="btn connect-toggle" data-action="connect">${icon("link")}连接</button><button class="btn export-toggle" data-action="export">${icon("download")}导出 / 导入</button></div></header><div class="workspace"><aside class="sidebar" id="sidebar" aria-label="代码库导航"></aside><main class="main"><div class="canvas-header" id="canvas-header"></div><div class="canvas-toolbar"><div class="segmented" role="group" aria-label="视图模式"><button data-action="mode" data-value="hierarchy" class="${state.mode === "hierarchy" ? "active" : ""}">${icon("layers")}层级</button><button data-action="mode" data-value="components" class="${state.mode === "components" ? "active" : ""}">${icon("grid")}组件</button><button data-action="mode" data-value="flow" class="${state.mode === "flow" ? "active" : ""}">${icon("flow")}流程</button></div><span class="spacer"></span><button class="btn motion-toggle" data-action="motion"></button><span class="toolbar-label">关系</span><select id="edge-filter" aria-label="关系类型" class="toolbar-select"><option value="all">全部关系</option>${[...new Set(data.edges.map((e) => e.type))].map((t) => `<option value="${escape(t)}" ${state.type === t ? "selected" : ""}>${escape(CodeLoomSemantics.relation(t).label)} · ${escape(t)}</option>`).join("")}</select><button class="btn" data-action="route">${icon("route")}路径</button><button class="icon-btn mobile-toggle" data-action="toggle-inspector" aria-label="打开详情">${icon("info")}</button></div><div class="structure-toolbar"><button class="structure-up" data-action="level-up" ${!state.scope ? "disabled" : ""}>${icon("back")}上一级</button><div class="lens-switch" role="group" aria-label="关系观察范围">${[
        ["scope", "当前范围"],
        ["neighbors", "直接关联"],
        ["global", "全局定位"],
      ]
        .map(
          ([value, text]) =>
            `<button data-action="lens" data-value="${value}" class="${state.lens === value ? "active" : ""}" ${value === "neighbors" && !state.selected && !state.relation ? "disabled" : ""}>${text}</button>`,
        )
        .join(
          "",
        )}</div><span class="spacer"></span><button class="structure-control" data-action="toggle-bundles" aria-pressed="${state.bundle}">${icon("flow")}${state.bundle ? "关系汇聚" : "按端点显示"}</button><button class="structure-control" data-action="collapse-canvas" ${state.lens !== "scope" ? "disabled" : ""}>收起内部</button></div><div id="level-rail"></div><div id="context-strip"></div><div id="story"></div><div class="canvas" id="canvas" role="region" aria-label="可交互架构画布"><div class="canvas-world" id="world"></div><div class="canvas-note" id="canvas-note"></div><div id="compare-float"></div><div class="canvas-controls"><button class="icon-btn" data-action="zoom-out" aria-label="缩小">${icon("minus")}</button><span id="zoom-label">100%</span><button class="icon-btn" data-action="zoom-in" aria-label="放大">${icon("plus")}</button><span style="width:1px;min-width:1px;height:17px;background:var(--line);margin:0 4px"></span><button class="icon-btn" data-action="fit" aria-label="适应画布" title="适应画布 · 0">${icon("fit")}</button></div><button class="minimap" id="minimap" aria-label="点击小地图移动视口"></button></div><div id="semantic-legend">${renderLegend()}</div></main><aside class="inspector" id="inspector" aria-label="对象详情"></aside></div><footer class="statusbar"><span><i class="live-dot"></i>${generated() ? "自动生成 · 静态分析" : imported ? "本地导入模型" : "公开源码快照"}</span><span id="counts">${data.nodes.length} 组件 · ${data.edges.length} 关系 · ${containers.size} 容器</span><span class="spacer"></span><span class="status-extra">${icon("eye")}${generated() ? "覆盖与限制见分析报告 · 非运行轨迹" : imported ? "依据由导入文件提供" : "固定 commit · 精选架构 · 非运行轨迹"}</span><button data-action="help">快捷键 <kbd>?</kbd></button></footer>`;
    renderSidebar();
    renderHeader();
    renderInspector();
    renderStory();
    renderCanvas(true);
    renderCompare();
    bindCanvas();
    hash();
    updateMotion();
  }
  function tree(id, depth = 0) {
    const n = all.get(id);
    if (!n) return "";
    const isContainer = containers.has(id);
    const children = isContainer
      ? [...containers.values(), ...data.nodes].filter(
          (c) =>
            (c.parentId || (!containers.has(c.id) ? c.group : null)) === id,
        )
      : [];
    const expanded = state.expanded.has(id);
    return `<div class="tree-row ${state.selected === id || state.scope === id ? "active" : ""} ${isContainer ? "" : "tree-leaf"}"><button class="caret" data-action="expand" data-id="${id}" aria-label="${expanded ? "折叠" : "展开"} ${escape(n.label)}" ${!isContainer ? 'style="visibility:hidden"' : ""}>${icon(expanded ? "down" : "chevron")}</button><button class="tree-select" data-action="${isContainer ? "scope" : "select"}" data-id="${id}"><i class="dot" style="--tone:${groupColor(n)}"></i><span class="name">${escape(n.label)}</span><span class="tree-level">L${CodeLoomLevels.depth(data, n.id)}</span>${isContainer ? `<small>${descendants(id).length}</small>` : ""}</button></div>${isContainer && expanded ? `<div class="tree-children">${children.map((c) => tree(c.id, depth + 1)).join("")}</div>` : ""}`;
  }
  function renderSidebar() {
    const focusedIds = state.relation
      ? selectedRelationEdges().flatMap((e) => [e.source, e.target])
      : state.selected
        ? [state.selected]
        : [];
    for (const id of new Set(focusedIds))
      for (const ancestor of CodeLoomLevels.ancestors(data, id))
        state.expanded.add(ancestor);
    const count = data.nodes.length;
    $("#sidebar").innerHTML =
      `<div class="sidebar-top"><label class="eyebrow" for="example-select">Explore a codebase</label><select id="example-select" class="example-select" aria-label="选择内置示例">${imported ? `<option value="imported" selected disabled>${generated() ? "当前分析结果" : "当前导入模型"}</option>` : ""}${Object.entries(window.SKYLENSE_MODELS || {}).map(([id, model]) => `<option value="${escape(id)}" ${!imported && id === data.meta?.id ? "selected" : ""}>${escape(model.meta.title)}</option>`).join("")}</select><div class="project-card"><strong>${escape(data.meta?.title || "Architecture")}</strong><p><span class="project-dot"></span>${data.groups.length} systems · ${count} components</p><small class="source-caption">${generated() ? "自动提取 · 可查看分析范围" : imported ? "本地导入" : `精选源码视图 · ${escape((data.meta.revision || "").slice(0, 8))}`}</small>${generated() ? `<button class="source-report-link" data-action="source-report">${icon("info")}分析报告${icon("arrow")}</button>` : ""}</div></div><div class="search-wrap">${icon("search")}<input id="search" aria-label="搜索组件、路径或函数" placeholder="搜索组件、函数…" value="${escape(state.query)}" autocomplete="off"><kbd>/</kbd></div><div id="tree-content"></div><div class="sidebar-section"><div class="nav-heading"><span class="eyebrow">Guided flows</span><span>${(data.flows || []).length}</span></div>${(data.flows || []).map((f) => `<button class="flow-button ${state.flow === f.id && state.mode === "flow" ? "active" : ""}" data-action="flow" data-id="${escape(f.id)}">${icon("flow")}<span>${escape(flowLabel(f))}</span></button>`).join("")}${!(data.flows || []).length ? `<div class="source-empty-flows">${generated() ? "静态分析未生成运行流程。可用路径探索查看已解析的引用连接。" : "当前模型没有预设流程。"}<button data-action="route">探索节点间的关系 →</button></div>` : ""}</div><div class="sidebar-section" style="margin-top:18px"><div class="nav-heading"><span class="eyebrow">Saved views</span><span>${saved.length}</span></div><div id="saved-list">${saved.length ? saved.map((v, i) => `<div class="bookmark"><button class="saved-load" data-action="load-view" data-id="${i}">${escape(v.name)}</button><button class="icon-btn" data-action="delete-view" data-id="${i}" aria-label="删除视图 ${escape(v.name)}">${icon("close")}</button></div>`).join("") : '<p class="micro" style="padding:0 19px 15px">把有价值的阅读位置留在这里。</p>'}</div></div><div class="sidebar-bottom">See every layer. Follow every connection.<button class="sidebar-connect" data-action="connect">${icon("link")}连接 Agent 与终端</button></div>`;
    renderTree();
    applyLevelHighlights();
  }
  function flowLabel(f) {
    return f.label;
  }
  function renderTree() {
    const host = $("#tree-content");
    if (state.query) {
      const q = state.query.toLowerCase();
      const found = data.nodes.filter((n) =>
        [n.label, n.path, n.summary, ...(n.functions || []).map((f) => f.name)]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
      host.innerHTML = `<div class="nav-heading"><span class="eyebrow">Search results</span><span>${found.length}</span></div><div class="search-results">${found.map((n) => `<button class="result" data-action="select" data-id="${n.id}" data-peek="${n.id}">${escape(n.qualifiedName || n.label)}<small>${escape(n.path)}</small></button>`).join("") || '<p class="empty-state">没有匹配的组件。试试 train、graph、cache 或函数名。</p>'}</div>`;
      applyLevelHighlights();
      return;
    }
    host.innerHTML = `<div class="nav-heading"><span class="eyebrow">Explorer</span><button class="icon-btn" data-action="home" title="系统总览" aria-label="系统总览">${icon("layers")}</button></div><div class="tree"><div class="tree-row ${!state.scope ? "active" : ""}"><button class="tree-select" data-action="home" style="padding:8px">${icon("box")}<span class="name">系统总览</span><small>${data.groups.length}</small></button></div>${data.groups.map((g) => tree(g.id)).join("")}</div>`;
    applyLevelHighlights();
  }
  function currentFlow() {
    return (data.flows || []).find((f) => f.id === state.flow);
  }
  function renderHeader() {
    const chain = state.scope ? crumbIds(state.scope) : [];
    const flow = state.mode === "flow" ? currentFlow() : null;
    const title =
      state.lens === "global"
        ? "全局关系地图"
        : state.lens === "neighbors"
          ? "直接关联地图"
          : flow
            ? flowLabel(flow)
            : state.scope
              ? label(state.scope)
              : "System architecture";
    $("#canvas-header").innerHTML =
      `<nav class="breadcrumbs" aria-label="层级导航"><button data-action="home">${escape(data.meta?.title || "Codebase")}</button>${chain.map((id) => `${icon("chevron")}<button data-action="scope" data-id="${id}">${escape(label(id))}</button>`).join("")}${flow ? `${icon("chevron")}<span>Guided flow</span>` : ""}</nav><div class="page-title"><h1>${escape(title)}</h1><span class="badge">${state.lens === "global" ? "GLOBAL" : state.lens === "neighbors" ? "1 HOP" : flow ? "FLOW" : state.scope ? `L${CodeLoomLevels.depth(data, state.scope)}` : "L0"}</span></div><p class="subtitle">${flow ? generated() ? "逐个阅读自动整理的依赖节点；静态关联与阅读顺序不代表运行顺序。" : "逐个阅读场景节点，查看文档描述的关联；阅读顺序不代表执行顺序。" : state.scope ? "展开模块边界，选择关系节点，沿层级和连接双向探索。" : "探索系统的组成、依赖与数据去向，从这里逐层深入。"}</p>`;
  }
  function renderStory() {
    const f =
      state.lens === "scope" && state.mode === "flow" ? currentFlow() : null;
    if (!f) {
      $("#story").innerHTML = "";
      return;
    }
    state.step = Math.min(Math.max(state.step, 0), f.nodes.length - 1);
    $("#story").innerHTML =
      `<div class="story-strip"><button class="icon-btn" data-action="prev-step" aria-label="上一个场景节点" ${state.step === 0 ? "disabled" : ""}>${icon("back")}</button><div><strong>${String(state.step + 1).padStart(2, "0")} / ${f.nodes.length} · ${escape(label(f.nodes[state.step]))}</strong><p>${generated() ? "静态依赖阅读 · 非运行轨迹" : "文档场景 · 点击右箭头继续探索"}</p></div><span class="spacer"></span><div class="story-progress">${f.nodes.map((id, i) => `<button class="${i <= state.step ? "active" : ""}" data-action="step" data-id="${i}" title="${escape(label(id))}" aria-label="阅读 ${escape(label(id))}"></button>`).join("")}</div><button class="icon-btn" data-action="next-step" aria-label="下一个场景节点" ${state.step === f.nodes.length - 1 ? "disabled" : ""}>${icon("arrow")}</button></div>`;
  }
  let layout = {
    items: [],
    relations: [],
    wires: [],
    hubs: [],
    width: 1000,
    height: 600,
    bounds: [],
    internal: [],
  };
  const sceneCache = new Map();
  function immediateChildren(id) {
    return [...containers.values(), ...data.nodes].filter(
      (n) => (n.parentId || (!containers.has(n.id) ? n.group : null)) === id,
    );
  }
  function buildLayout() {
    const f = state.mode === "flow" ? currentFlow() : null;
    let edges = filteredEdges(),
      focusNodes = null,
      scope = state.scope,
      mode = state.mode,
      open = state.openContainers;
    if (state.lens === "global") {
      scope = null;
      mode = "hierarchy";
      open = [];
    } else if (state.lens === "neighbors") {
      const ctx = selectionContext(),
        ids = new Set([...ctx.incoming, ...ctx.outgoing, ...ctx.internal]);
      edges = edges.filter((e) => ids.has(e.id));
      const selectedSet = new Set(ctx.members);
      const representative = (id) =>
        CodeLoomRelations.ancestors(data, id).find(
          (a) => !members(a).some((member) => selectedSet.has(member)),
        ) || id;
      const focused =
        state.selected && containers.has(state.selected) && !state.relation
          ? [state.selected]
          : ctx.members;
      focusNodes = [
        ...new Set([
          ...ctx.incoming.map((id) => representative(edgeById(id).source)),
          ...focused,
          ...ctx.outgoing.map((id) => representative(edgeById(id).target)),
        ]),
      ];
    } else if (state.trace) {
      edges = edges.filter((e) => state.trace.edges.includes(e.id));
      focusNodes = state.trace.nodes;
    } else if (f) {
      edges = edges.filter((e) =>
        f.edgeIds
          ? f.edgeIds.includes(e.id)
          : f.nodes.includes(e.source) && f.nodes.includes(e.target),
      );
      focusNodes = f.nodes;
    }
    const categoryGroups = state.categoryGroups && categoryGroupingAvailable();
    const key = JSON.stringify([
      categoryGroups,
      scope,
      mode,
      open,
      state.bundle,
      edges.map((e) => e.id),
      focusNodes,
    ]);
    if (!sceneCache.has(key)) {
      if (sceneCache.size > 20) sceneCache.clear();
      sceneCache.set(
        key,
        CodeLoomScene.build(data, {
          categoryGroups,
          scope,
          mode,
          open,
          edges,
          focusNodes,
          bundle: state.bundle,
        }),
      );
    }
    return sceneCache.get(key);
  }
  function renderContextStrip() {
    const host = $("#context-strip");
    if (!host) return;
    if (
      state.lens !== "scope" ||
      !state.scope ||
      state.trace ||
      state.mode === "flow"
    ) {
      host.innerHTML = "";
      return;
    }
    const ctx = CodeLoomContext.describe(data, {
        nodeId: state.scope,
        type: state.type,
      }),
      count = ctx.incoming.length + ctx.outgoing.length;
    host.innerHTML = count
      ? `<div class="outside-strip"><span>${icon("external")}范围外还有 <b>${count}</b> 条直接关系</span><span class="outside-counts">入向 ${ctx.incoming.length} · 出向 ${ctx.outgoing.length}</span><button data-action="boundary-context">查看模块上下游 ${icon("arrow")}</button></div>`
      : "";
  }
  function selectedRelationEdges() {
    return data.edges.filter((e) => state.relation?.edgeIds.includes(e.id));
  }
  function relationTitle(rel) {
    const types = {
      flow: "流程",
      data: "数据",
      read: "读取",
      write: "写入",
      depends: "依赖",
    };
    const labels = {
      executes: "策略分发",
      "returns scores": "评分汇入",
      "routes to": "分派",
      "returns result": "结果返回",
      "submits request": "提交请求",
      "loads weights": "加载权重",
    };
    return (
      (rel.edges && actionLabels(rel.edges).length > 1
        ? `${types[rel.type] || rel.type} · ${actionLabels(rel.edges).length}动作`
        : null) ||
      labels[rel.label] ||
      (rel.label === rel.type ? types[rel.type] : rel.label) ||
      types[rel.type] ||
      rel.type ||
      "关系"
    );
  }
  function wireMembers(wire) {
    const endpoint = new Set(
      members(wire.role === "source" ? wire.from : wire.to),
    );
    return wire.relation.edges
      .filter((e) => endpoint.has(wire.role === "source" ? e.source : e.target))
      .map((e) => e.id);
  }
  function relationActive(rel, context = focusContext()) {
    const ids = new Set(context.relatedEdgeIds);
    return rel.edgeIds.some((id) => ids.has(id));
  }
  function renderCanvas(fit = false) {
    layout = buildLayout();
    const focus = focusContext(),
      selectedIds = new Set(focus.selectedIds);
    $("#world").style.width = layout.width + "px";
    $("#world").style.height = layout.height + "px";
    const boundaryHTML = layout.bounds
      .map(
        (b) =>
          `<div class="group-boundary nested-boundary" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;--depth:${b.depth}"><button class="boundary-title" data-action="scope" data-id="${escape(b.id)}">${icon("layers")}${escape(label(b.id))}${icon("chevron")}</button><button class="boundary-collapse" data-action="canvas-collapse" data-id="${escape(b.id)}" aria-label="收起 ${escape(label(b.id))}">${icon("minus")}</button></div>`,
      )
      .join("");
    const categoryHTML = (layout.categoryBounds || [])
      .map((b) => {
        const t = CodeLoomSemantics.node(b.kind);
        return `<div class="category-frame" data-category-id="${escape(b.id)}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;--category-ink:${semanticInk(t)}" role="group" aria-label="${escape(t.label)}类别，${b.ids.length}个对象"><div class="category-heading">${icon(t.icon)}<strong>${escape(t.label)}</strong><span>类别分区</span><b>${b.ids.length}</b></div></div>`;
      })
      .join("");
    const motionWires = layout.wires.filter(
      (w) => !w.blocked && w.points.length > 1,
    );
    const wireHTML = motionWires
      .map((w, wireIndex) => {
        const active = wireMembers(w).some((id) =>
            focus.relatedEdgeIds.includes(id),
          ),
          t = CodeLoomSemantics.relation(w.relation.type);
        return `<g class="relation-wire ${active ? "active" : ""}" style="${typeStyle(w.relation.type)}" data-relation-wire="${escape(w.relation.id)}" data-wire-index="${wireIndex}" data-wire-from="${escape(w.from)}" data-wire-to="${escape(w.to)}"><path d="${w.path}" class="wire-halo"/><path d="${w.path}" class="edge ${active ? "emphasis" : ""}" ${t.dash ? `stroke-dasharray="${t.dash}"` : ""} ${w.role === "target" ? `marker-end="url(#arrow-${t.key})"` : ""}/><g class="flow-particle" data-motion-index="${wireIndex}" aria-hidden="true" pointer-events="none"><circle class="particle-aura" r="6"/><circle class="particle-trail" cx="-5" r="2"/><circle class="particle-trail" cx="-9" r="1.2"/><circle class="particle-core" r="3.1"/><circle class="particle-glint" r="1"/></g><path d="${w.path}" class="edge-hit" tabindex="0" role="button" data-action="relation" data-id="${escape(w.relation.id)}" data-relation-peek="${escape(w.relation.id)}" aria-label="查看${escape(t.label)} ${escape(relationTitle(w.relation))}，${w.relation.edgeIds.length} 条原始边"><title>${escape(w.relation.edges.map((e) => `${e.id}: ${label(e.source)} → ${label(e.target)} · ${e.label}`).join("\n"))}</title></path></g>`;
      })
      .join("");
    const hubHTML = layout.hubs
      .map((h) => {
        const r = h.relation,
          t = CodeLoomSemantics.relation(r.type),
          shape = relationTopology(r.edges),
          chosen =
            state.relation &&
            r.edgeIds.some((id) => state.relation.edgeIds.includes(id));
        return `<button class="relation-hub shape-${shape.key} ${relationActive(r, focus) ? "active" : ""} ${chosen ? "selected" : ""}" style="left:${h.x}px;top:${h.y}px;width:${h.w}px;height:${h.h}px;${typeStyle(r.type)}" data-action="relation" data-id="${escape(r.id)}" data-relation-peek="${escape(r.id)}" aria-label="关系标注 ${escape(relationTitle(r))}，${escape(t.shortLabel)}，${shape.cardinality}，${r.edgeIds.length} 条边" title="${escape(shape.label)} · ${escape(t.label)} · ${escape(actionLabels(r.edges).join(" / "))}"><span class="hub-glyph">${icon(shape.icon)}</span><span class="hub-copy"><strong>${escape(relationTitle(r))}</strong></span>${r.edgeIds.length > 1 ? `<b class="member-count">${r.edgeIds.length}</b>` : ""}</button>`;
      })
      .join("");
    const nodeHTML = layout.items
      .map((p) => {
        const n = p.n,
          isContainer = containers.has(n.id),
          counts = CodeLoomContext.describe(data, {
            nodeId: n.id,
            type: state.type,
          }),
          memberIds = members(n.id),
          selected = selectedIds.has(n.id),
          t = CodeLoomSemantics.node(n.kind);
        const internal = counts.internal.length,
          kids = isContainer ? immediateChildren(n.id) : [];
        return `<div class="node-wrap kind-${t.key} ${isContainer ? "is-boundary" : ""}" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;--tone:${groupColor(n)};--ink:${semanticInk(t)}"><button class="graph-node ${selected ? "selected" : ""}" style="width:${p.w}px;height:${p.h}px" data-action="select" data-id="${escape(n.id)}" data-peek="${escape(n.id)}" aria-label="${escape(n.label)}${isContainer ? "，双击展开" : ""}"><span class="node-top"><span class="node-icon">${icon(t.icon)}</span><span><span class="node-label">${escape(n.label)}</span><span class="node-kind">${escape(t.label)} · L${CodeLoomLevels.depth(data, n.id)}</span></span></span><span class="node-description">${isContainer ? `${kids.length} 个直接子项 · ${memberIds.length} 个组件` : escape(n.summary || n.description || "")}</span>${
          isContainer
            ? `<span class="child-preview">${kids
                .slice(0, 2)
                .map(
                  (c) => `<span>${icon(kindIcon(c))}${escape(c.label)}</span>`,
                )
                .join("")}</span>`
            : ""
        }<span class="node-footer"><span>${isContainer ? internal + " 条内部关系" : n.sourceRole === "symbol" ? "源码声明" : (n.functions || []).length + (generated() ? " 个符号" : " 个函数")}</span><span>入 ${counts.incoming.length} · 出 ${counts.outgoing.length}</span></span></button>${isContainer ? `<button class="node-expand" data-action="canvas-expand" data-id="${escape(n.id)}" aria-label="就地展开 ${escape(n.label)}" title="就地展开模块">${icon("plus")}</button>` : ""}</div>`;
      })
      .join("");
    const markers = [...new Set(data.edges.map((e) => e.type))]
      .map((type) => {
        const t = CodeLoomSemantics.relation(type);
        return `<marker id="arrow-${t.key}" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7" fill="${semanticInk(t)}"/></marker>`;
      })
      .join("");
    $("#world").innerHTML =
      boundaryHTML +
      categoryHTML +
      `<svg class="edges" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}"><defs>${markers}</defs>${wireHTML}</svg>` +
      nodeHTML +
      hubHTML;
    motion.bind(
      $$("#world .flow-particle").map((el) => {
        const wire = motionWires[Number(el.dataset.motionIndex)];
        return {
          key: JSON.stringify([
            wire.relation.id,
            wire.role,
            wire.from,
            wire.to,
          ]),
          points: wire.points,
          element: el,
        };
      }),
    );
    updateMotion();
    applyLevelHighlights();
    renderContextStrip();
    if ($("#semantic-legend")) $("#semantic-legend").innerHTML = renderLegend();
    const blocked = layout.wires.filter((w) => w.blocked).length;
    const note =
      state.lens === "neighbors"
        ? `直接关联 · 外部端点按模块折叠 · ${layout.items.length} 个可见对象`
        : state.lens === "global"
          ? `全局 ${data.groups.length} 个区域 · 高亮与当前选择相关的连接`
          : state.trace?.kind === "relation"
            ? `关系展开 · ${state.trace.edges.length} 条原始边`
            : state.trace
              ? state.trace.kind === "path"
                ? state.trace.error ? `路径待调整 · ${escape(pathError(state.trace.error))}` : `关系路径 · ${state.trace.plan.stops.length - 2} 个必经点 · ${state.trace.steps.length} 跳 · ${state.trace.plan.direction === "both" ? "双向关联（箭头保留原方向）" : state.trace.plan.direction === "upstream" ? "逆向阅读（箭头保留原方向）" : "沿箭头阅读"}`
                : state.trace.direction
                ? `${state.trace.direction === "upstream" ? "上游" : "下游"}可达关系 · ${state.trace.nodes.length} 个组件`
                : `${escape(label(state.trace.start))} → ${escape(label(state.trace.end))}`
              : `${layout.items.length} 个可见节点 · ${layout.relations.length} 个关系节点 · 点击关系查看成员与层级`;
    $("#canvas-note").innerHTML =
      icon("flow") +
      `<span>${note}${blocked ? ` · ${blocked} 条支线未能路由（可在关系详情查看）` : ""}</span>`;
    const foldedSelection = state.relation
      ? layout.internal
          .flatMap((entry) => entry.edgeIds)
          .filter((id) => state.relation.edgeIds.includes(id)).length
      : 0;
    if (foldedSelection) {
      $("#canvas-note").insertAdjacentHTML(
        "beforeend",
        `<span> · 所选 ${foldedSelection} 条边位于高亮模块内部</span><button data-action="relation-detail" style="pointer-events:auto;color:var(--accent)">展开关系</button>`,
      );
    }
    if (state.trace?.kind === "path")
      $("#canvas-note").insertAdjacentHTML("beforeend", '<button data-action="route" style="pointer-events:auto;color:var(--accent)">编辑路径</button>');
    if (state.trace)
      $("#canvas-note").insertAdjacentHTML(
        "beforeend",
        '<button data-action="clear-trace" style="pointer-events:auto;color:var(--accent)">清除 ×</button>',
      );
    if (fit) fitCanvas();
    else applyCamera();
    renderMinimap();
  }
  function fitCanvas() {
    const canvas = $("#canvas");
    if (!canvas) return;
    // Fit visible geometry, not the scene's routing/export margins. Reserving
    // those margins twice made text needlessly small in shorter windows.
    const rects = [
      ...layout.items,
      ...layout.bounds,
      ...(layout.categoryBounds || []),
      ...layout.hubs,
    ];
    const points = [
      ...rects.flatMap((r) => [
        { x: r.x, y: r.y },
        { x: r.x + r.w, y: r.y + r.h },
      ]),
      ...layout.wires.filter((w) => !w.blocked).flatMap((w) => w.points),
    ];
    const minX = points.length ? Math.min(...points.map((p) => p.x)) : 0;
    const minY = points.length ? Math.min(...points.map((p) => p.y)) : 0;
    const width = Math.max(
      1,
      points.length ? Math.max(...points.map((p) => p.x)) - minX : layout.width,
    );
    const height = Math.max(
      1,
      points.length
        ? Math.max(...points.map((p) => p.y)) - minY
        : layout.height,
    );
    const top = 48,
      bottom = canvas.clientHeight < 460 ? 68 : 88;
    const availableHeight = Math.max(1, canvas.clientHeight - top - bottom);
    const z = Math.min(
      1.16,
      Math.max(
        0.13,
        Math.min((canvas.clientWidth - 40) / width, availableHeight / height),
      ),
    );
    state.camera = {
      x: (canvas.clientWidth - width * z) / 2 - minX * z,
      y: top + (availableHeight - height * z) / 2 - minY * z,
      z,
    };
    applyCamera();
  }
  function applyCamera() {
    const c = state.camera;
    $("#world").style.transform = `translate(${c.x}px,${c.y}px) scale(${c.z})`;
    $("#zoom-label").textContent = Math.round(c.z * 100) + "%";
    renderMinimap();
    const canvas = $("#canvas");
    if (canvas)
      motion.setViewport({
        ...c,
        width: canvas.clientWidth,
        height: canvas.clientHeight,
      });
  }
  function zoom(factor, x, y) {
    const canvas = $("#canvas");
    x = x ?? canvas.clientWidth / 2;
    y = y ?? canvas.clientHeight / 2;
    const c = state.camera,
      z = Math.min(2.2, Math.max(0.12, c.z * factor));
    c.x = x - ((x - c.x) * z) / c.z;
    c.y = y - ((y - c.y) * z) / c.z;
    c.z = z;
    applyCamera();
  }
  function renderMinimap() {
    const host = $("#minimap");
    if (!host) return;
    const c = state.camera,
      can = $("#canvas");
    host.innerHTML = `<svg viewBox="0 0 ${layout.width} ${layout.height}" preserveAspectRatio="xMidYMid meet">${layout.items.map((p) => `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="10" fill="${groupColor(p.n)}" opacity="${p.n.id === state.selected ? 1 : 0.35}"/>`).join("")}<rect x="${-c.x / c.z}" y="${-c.y / c.z}" width="${can.clientWidth / c.z}" height="${can.clientHeight / c.z}" rx="5" fill="none" stroke="var(--accent)" stroke-width="6"/></svg>`;
  }
  function bindCanvas() {
    const canvas = $("#canvas");
    let drag = null;
    canvas.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button,input,select,[data-action]")) return;
      drag = {
        x: e.clientX,
        y: e.clientY,
        cx: state.camera.x,
        cy: state.camera.y,
      };
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add("dragging");
      hidePeek();
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drag) return;
      state.camera.x = drag.cx + e.clientX - drag.x;
      state.camera.y = drag.cy + e.clientY - drag.y;
      applyCamera();
    });
    const stop = () => {
      drag = null;
      canvas.classList.remove("dragging");
    };
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    canvas.addEventListener(
      "wheel",
      (e) => {
        if (e.target.closest(".minimap")) return;
        e.preventDefault();
        const b = canvas.getBoundingClientRect();
        zoom(
          Math.exp(-e.deltaY * 0.0015),
          e.clientX - b.left,
          e.clientY - b.top,
        );
      },
      { passive: false },
    );
    $("#minimap").addEventListener("click", (e) => {
      const b = $("#minimap svg").getBoundingClientRect(),
        scale = Math.min(b.width / layout.width, b.height / layout.height),
        ox = (b.width - layout.width * scale) / 2,
        oy = (b.height - layout.height * scale) / 2;
      const x = (e.clientX - b.left - ox) / scale,
        y = (e.clientY - b.top - oy) / scale;
      state.camera.x = canvas.clientWidth / 2 - x * state.camera.z;
      state.camera.y = canvas.clientHeight / 2 - y * state.camera.z;
      applyCamera();
    });
  }
  function rememberRelation() {
    if (!state.relation) return;
    state.lastRelation = JSON.parse(
      JSON.stringify({
        ...state.relation,
        view: {
          lens: state.lens,
          levelFocus: state.levelFocus,
          focusDimming: state.focusDimming,
          categoryGroups: state.categoryGroups,
          present: state.present,
          scope: state.scope,
          mode: state.mode,
          flow: state.flow,
          step: state.step,
          trace: state.trace,
          openContainers: state.openContainers,
          type: state.type,
          bundle: state.bundle,
          camera: state.camera,
        },
      }),
    );
  }
  function selectRelation(ids, member = false, explicitParent = null) {
    const known = new Set(data.edges.map((e) => e.id));
    const edgeIds = [...new Set(ids)].filter((id) => known.has(id));
    if (!edgeIds.length) return;
    rememberReading();
    state.levelFocus = "auto";
    const parentEdgeIds =
      explicitParent ||
      (member && state.relation
        ? state.relation.edgeIds.length > 1
          ? state.relation.edgeIds
          : state.relation.parentEdgeIds
        : null);
    state.relation = {
      edgeIds,
      parentEdgeIds: parentEdgeIds?.length ? parentEdgeIds : null,
    };
    state.selected = null;
    state.tab = "overview";
    if (
      state.type !== "all" &&
      selectedRelationEdges().some((edge) => edge.type !== state.type)
    ) {
      state.type = "all";
      layout = buildLayout();
      $("#edge-filter").value = "all";
    }
    const hidden = edgeIds.some(
      (id) =>
        layout.hiddenEdgeIds?.includes(id) ||
        (state.trace && !state.trace.edges.includes(id)),
    );
    if (hidden) {
      state.lens = "scope";
      const edges = selectedRelationEdges();
      state.trace = {
        kind: "relation",
        edges: edgeIds,
        nodes: [...new Set(edges.flatMap((e) => [e.source, e.target]))],
      };
      state.scope = CodeLoomRelations.commonAncestor(data, state.trace.nodes);
      state.mode = "components";
      state.flow = null;
      render();
    } else {
      renderInspector();
      renderCanvas(false);
      renderSidebar();
      hash();
    }
    rememberRelation();
    if (innerWidth <= 950 || state.present) {
      $("#sidebar").classList.remove("open");
      $("#inspector").classList.add("open");
    }
  }
  function relationEndpoint(id) {
    const n = nodes.get(id);
    return `<div class="endpoint-card"><button class="connection" data-action="relation-endpoint" data-id="${escape(id)}" data-peek="${escape(id)}">${icon(kindIcon(n))}<span>${escape(n.label)}<small>${escape(CodeLoomSemantics.node(n.kind).label)} · L${CodeLoomLevels.depth(data, id)} · ${n.functions?.length || 0} 个函数</small></span>${icon("arrow")}</button><div class="endpoint-ancestors">${CodeLoomRelations.ancestors(
      data,
      id,
    )
      .map(
        (a) =>
          `<button data-action="scope" data-id="${escape(a)}">${escape(label(a))}</button>`,
      )
      .join("<span>›</span>")}</div></div>`;
  }
  function edgeEvidenceNote(e) {
    const kinds = { 'lexical-candidate': '静态引用候选', 'metadata-only': '仅文件信息', 'static-import': '静态导入', 'lexical-import': '词法导入', 'heuristic': '静态启发式', 'document-link': '文档链接', 'curated-inference': '架构推导', 'repository-source': '源码依据', 'source-verified': '静态源码', 'documented-protocol': '文档协议', 'source-sequence': '源码顺序' };
    return `<div class="edge-evidence-note"><span class="badge">${escape(kinds[e.evidenceStatus] || e.evidenceStatus || "作者整理")}</span>${e.description ? `<p>${escape(e.description)}</p>` : ""}</div>`;
  }
  function rawEdgeCard(e) {
    if (!e) return "";
    return `<button class="relation-member" data-action="raw-edge" data-id="${escape(e.id)}" style="${typeStyle(e.type)}"><small>${escape(e.id)} ${typeBadge(e.type)}</small><b>${escape(label(e.source))} <span class="inline-arrow">→</span> ${escape(label(e.target))}</b><span>${escape(e.label || e.type)}</span>${icon("chevron")}</button>`;
  }
  function renderRelationInspector() {
    const edges = selectedRelationEdges();
    if (!edges.length) {
      state.relation = null;
      renderInspector();
      return;
    }
    const sources = [...new Set(edges.map((e) => e.source))],
      targets = [...new Set(edges.map((e) => e.target))],
      types = [...new Set(edges.map((e) => e.type))],
      shape = relationTopology(edges),
      labels = actionLabels(edges),
      title = relationTitle({
        label: labels.length === 1 ? labels[0] : types[0],
        type: types[0],
        edges,
      }),
      common = CodeLoomRelations.commonAncestor(data, [...sources, ...targets]);
    let body = "";
    if (state.tab === "context") body = contextBody();
    else if (state.tab === "evidence")
      body = `<div class="detail-intro"><b>关系的原始依据</b><p>每条边的 ID、配对、方向和原文分别保留。</p></div>${edges.map((e) => `<details class="evidence-card" ${edges.length === 1 ? "open" : ""}><summary>${escape(e.id)} · ${escape(e.label || e.type)}</summary>${edgeEvidenceNote(e)}${(e.evidence || []).map((ref) => `<small>${escape(ref.file)} · ${ref.lineStart}–${ref.lineEnd}</small>${evidenceLink(ref)}<pre>${escape(ref.excerpt)}</pre>`).join("") || '<p class="micro">没有附带原文摘录。</p>'}</details>`).join("")}`;
    else if (state.tab === "members")
      body = `<div class="detail-intro"><b>${edges.length} 条原始成员边</b><p>按真实来源 → 目标查看配对。点击成员可继续定位两端与依据。</p></div>${edges.map(rawEdgeCard).join("")}`;
    else
      body = `${state.relation.parentEdgeIds ? `<button class="return-relation" data-action="relation-parent">${icon("back")}返回上一级关系束 · ${state.relation.parentEdgeIds.length} 条边</button>` : ""}<div class="relation-contract" style="${typeStyle(types[0])}"><div>${icon(shape.icon)}<b>${shape.label}</b><span>${shape.cardinality}</span></div><p>${labels.map((l) => `<span>${escape(l)}</span>`).join("")}</p>${types.map(typeBadge).join("")}</div>${edges.length === 1 ? edgeEvidenceNote(edges[0]) : '<p class="micro">每条成员的依据与推导说明可在「依据」中查看。</p>'}${contextSummary()}<div class="section-label">参与者 <span>${sources.length} 来源 · ${targets.length} 目标</span></div><div class="participant-section"><div class="participant-heading">${icon("back")}来源 / SOURCES</div>${sources.map(relationEndpoint).join("")}</div><div class="participant-section"><div class="participant-heading">${icon("arrow")}目标 / TARGETS</div>${targets.map(relationEndpoint).join("")}</div><button class="btn wide-btn" data-action="tab" data-value="members">逐条查看 ${edges.length} 条原始边 ${icon("arrow")}</button><div class="section-label" style="margin-top:22px">所在层级</div><button class="relation-parent-scope" data-action="scope" data-id="${escape(common || "")}">${icon("layers")}${escape(common ? label(common) : "跨系统关系")}${icon("arrow")}</button><details class="semantic-note"><summary>这类关系束表示什么？</summary><p>关系束组织具有共同端点或语义的原始边。它保留每条配对，不单独证明多个参与者联合执行。</p></details>`;
    $("#inspector").innerHTML =
      `<div class="inspector-top"><div class="inspector-label"><span class="eyebrow">${shape.label} · Relation</span><div class="inspector-tools"><button class="icon-btn" data-action="back-selection" aria-label="返回上一步" ${readingHistory.length ? "" : "disabled"}>${icon("back")}</button><button class="icon-btn mobile-toggle" data-action="close-inspector" aria-label="关闭详情">${icon("close")}</button></div></div><div class="inspector-title"><span class="node-icon relation-icon" style="${typeStyle(types[0])}">${icon(shape.icon)}</span><div><h2>${escape(title)}</h2><p>${edges.length} 条原始边 · ${shape.cardinality} · ${types.map((t) => CodeLoomSemantics.relation(t).shortLabel).join(" / ")}</p></div></div><div class="inspect-actions"><button class="btn" data-action="relation-up" ${!state.scope && !state.trace ? "disabled" : ""}>${icon("layers")}上层聚合</button><button class="btn" data-action="relation-detail">${icon("flow")}展开到组件</button></div></div><div class="inspector-tabs">${[
        ["overview", "概览"],
        ["members", "成员 " + edges.length],
        ["context", "全局"],
        ["evidence", "依据"],
      ]
        .map(
          ([id, text]) =>
            `<button data-action="tab" data-value="${id}" class="${state.tab === id ? "active" : ""}">${text}</button>`,
        )
        .join(
          "",
        )}</div><div class="inspector-content">${body}</div><div class="inspector-footer">${icon("link")}原始配对保留 · 箭头表示模型关系方向</div>`;
    applyLevelHighlights();
  }
  document.addEventListener("pointerover", (e) => {
    const el = e.target.closest("[data-relation-peek]");
    if (!el || e.pointerType === "touch" || el.contains(e.relatedTarget))
      return;
    hidePeek();
    hidePeek.timer = setTimeout(() => {
      if (!el.isConnected) return;
      const r = layout.relations.find((r) => r.id === el.dataset.relationPeek);
      if (!r) return;
      const box = el.getBoundingClientRect(),
        peek = $("#peek");
      peek.innerHTML = `<div class="eyebrow" style="margin-bottom:8px">Relation preview</div><h3>${escape(relationTitle(r))}</h3><p>${r.sources.map(label).map(escape).join(" / ")} → ${r.targets.map(label).map(escape).join(" / ")}</p><div class="peek-counts"><span>${r.edgeIds.length} 条原始边</span><span>${escape(r.type)}</span><span>点击展开成员</span></div>`;
      peek.hidden = false;
      peek.style.left =
        Math.max(10, Math.min(box.right + 10, innerWidth - 295)) + "px";
      peek.style.top =
        Math.max(10, Math.min(box.top, innerHeight - peek.offsetHeight - 12)) +
        "px";
    }, 250);
  });
  document.addEventListener("pointerout", (e) => {
    const el = e.target.closest("[data-relation-peek]");
    if (el && !el.contains(e.relatedTarget)) hidePeek();
  });

  function renderInspector() {
    if (state.relation) {
      renderRelationInspector();
      return;
    }
    const n = all.get(state.selected),
      panel = $("#inspector");
    if (!n) {
      panel.innerHTML = `<div class="inspector-top"><div class="eyebrow">Architecture context</div></div><div class="inspector-content"><h2 class="empty-title">从一个对象开始探索</h2><p class="detail-text">选择组件、模块边界或关系节点，查看它是什么、连接谁，以及在完整系统中的位置。</p><button class="btn" data-action="legend">${icon("info")}查看颜色与形状图例</button><div class="section-label" style="margin-top:24px">系统区域</div>${data.groups.map((g) => `<button class="connection" data-action="scope" data-id="${escape(g.id)}"><i class="dot" style="--tone:${g.color}"></i><span>${escape(g.label)}<small>${members(g.id).length} 个组件</small></span>${icon("arrow")}</button>`).join("")}</div>`;
      return;
    }
    const inc = incident(n.id),
      isContainer = containers.has(n.id),
      t = CodeLoomSemantics.node(n.kind);
    panel.innerHTML = `<div class="inspector-top"><div class="inspector-label"><span class="eyebrow">${isContainer ? "层级边界" : "组件"} · ${escape(t.label)}</span><div class="inspector-tools"><button class="icon-btn" data-action="back-selection" aria-label="返回上一步" ${readingHistory.length ? "" : "disabled"}>${icon("back")}</button><button class="icon-btn" data-action="compare" data-id="${escape(n.id)}" aria-label="加入节点对照">${icon("compare")}</button><button class="icon-btn mobile-toggle" data-action="close-inspector" aria-label="关闭详情">${icon("close")}</button></div></div><div class="inspector-title"><span class="node-icon" style="--tone:${semanticInk(t)}">${icon(t.icon)}</span><div><h2>${escape(n.label)}</h2><p>${escape(n.id)} · ${escape(groupMap.get(n.group)?.label || "System")}</p></div></div><div class="inspect-actions">${isContainer ? `<button class="btn" data-action="scope" data-id="${escape(n.id)}">${icon("layers")}展开模块</button>` : `<button class="btn" data-action="context-reach" data-value="upstream">${icon("back")}上游</button><button class="btn" data-action="context-reach" data-value="downstream">下游${icon("arrow")}</button>`}<button class="btn" data-action="lens" data-value="global">${icon("grid")}全局</button></div></div><div class="inspector-tabs">${[
      ["overview", "概览"],
      ["connections", "连接"],
      ["contracts", isContainer ? "子项" : n.sourceRole === "symbol" ? "源码" : "接口"],
      ["context", "全局"],
      ["evidence", "依据"],
    ]
      .map(
        ([id, text]) =>
          `<button data-action="tab" data-value="${id}" class="${state.tab === id ? "active" : ""}">${text}</button>`,
      )
      .join(
        "",
      )}</div><div class="inspector-content">${nodeHierarchy(n)}${inspectorBody(n, inc, isContainer)}</div><div class="inspector-footer">${icon("document")}${generated() ? "自动提取 · 依据来自当前来源" : imported ? "导入模型 · 依据由文件提供" : "源码依据 · " + escape((data.meta.revision || "").slice(0, 8))}</div>`;
    applyLevelHighlights();
  }
  function connection(e, incoming) {
    const id = incoming ? e.source : e.target;
    return `<div class="connection-row" style="${typeStyle(e.type)}"><button class="connection" data-action="select" data-id="${escape(id)}" data-peek="${escape(id)}">${icon(kindIcon(nodes.get(id)))}<span>${escape(label(id))}<small>${escape(e.label || e.type)}</small></span>${icon("arrow")}</button><button class="edge-detail-button" data-action="raw-edge" data-id="${escape(e.id)}" aria-label="查看边 ${escape(e.id)}">${typeBadge(e.type)}<span>${escape(e.id)} ${icon("chevron")}</span></button></div>`;
  }
  function nodeHierarchy(n) {
    return `${state.lastRelation ? `<button class="return-relation" data-action="return-relation">${icon("back")}返回刚才的关系 (${state.lastRelation.edgeIds.length})</button>` : ""}<div class="inspector-breadcrumbs"><button data-action="home">System</button>${crumbIds(
      n.id,
    )
      .map(
        (id) =>
          `${icon("chevron")}<button data-action="${id === n.id ? "select" : "scope"}" data-id="${escape(id)}">${escape(label(id))}</button>`,
      )
      .join("")}</div>${levelPeers(n)}`;
  }
  function inspectorBody(n, inc, isContainer) {
    if (state.tab === "context") return contextBody();
    if (state.tab === "contracts") return contractsBody(n);
    if (state.tab === "evidence" || state.tab === "docs")
      return evidenceBody(n);
    if (state.tab === "connections") {
      const ctx = selectionContext(),
        incoming = ctx.incoming.map(edgeById),
        outgoing = ctx.outgoing.map(edgeById),
        internal = ctx.internal.map(edgeById);
      return `<div class="detail-intro"><b>直接连接</b><p>入向：谁指向当前对象。出向：当前对象指向谁。筛选：${state.type === "all" ? "全部类型" : escape(CodeLoomSemantics.relation(state.type).label)}。</p></div>${contextSummary(ctx)}<div class="section-label">${icon("back")}入向连接<span>${incoming.length}</span></div>${incoming.map((e) => connection(e, true)).join("") || '<p class="empty-hint">没有符合筛选的入向连接。</p>'}<div class="section-label" style="margin-top:23px">${icon("arrow")}出向连接<span>${outgoing.length}</span></div>${outgoing.map((e) => connection(e, false)).join("") || '<p class="empty-hint">没有符合筛选的出向连接。</p>'}${isContainer ? `<div class="section-label" style="margin-top:23px">内部关系<span>${internal.length}</span></div>${internal.map(rawEdgeCard).join("")}` : ""}`;
    }
    const edges = [...inc.incoming, ...inc.outgoing],
      ctx = selectionContext();
    return `<div class="object-tags">${categoryBadge(n)}<span class="badge">${isContainer ? `${members(n.id).length} 个组件` : n.sourceRole === "symbol" ? "源码声明" : `${n.functions?.length || 0} 个${generated() ? "符号" : "函数"}`}</span></div><div class="section-label">职责 / RESPONSIBILITY</div><p class="detail-text">${escape(n.description || n.summary || "未提供职责说明。")}</p>${contextSummary(ctx)}<div class="section-label">连接构成 <span>${edges.length} 条原始边 · 全类型</span></div>${typeBreakdown(edges)}<div class="section-label" style="margin-top:20px">${isContainer ? "结构入口" : "接口与位置"}</div><button class="connection" data-action="tab" data-value="contracts">${icon(isContainer ? "layers" : "code")}<span>${isContainer ? `查看 ${immediateChildren(n.id).length} 个直接子项` : n.sourceRole === "symbol" ? "查看声明与源码依据" : `查看 ${n.functions?.length || 0} 个${generated() ? "声明 / 章节" : "函数契约"}`}<small>${isContainer ? "继续逐层深入" : generated() ? "精确行号、源文件与静态关系" : "职责、输入、输出分别呈现"}</small></span>${icon("arrow")}</button>${n.path ? `<details class="location-details"><summary>${icon("document")}源码位置</summary><code>${escape(n.path)}</code></details>` : ""}${n.parentId || n.group ? `<button class="btn parent-button" data-action="scope" data-id="${escape(n.parentId || n.group)}">${icon("layers")}进入父模块 ${escape(label(n.parentId || n.group))}</button>` : ""}`;
  }
  function select(id) {
    if (!all.has(id)) return;
    if (state.selected !== id || state.relation) rememberReading();
    const n = all.get(id);
    rememberRelation();
    state.levelFocus = "auto";
    state.relation = null;
    state.selected = id;
    state.tab = "overview";
    state.query = "";
    if (state.lens !== "scope") {
      render();
    } else if (!layout.items.some((p) => p.n.id === id)) {
      const chain = crumbIds(id);
      if (state.scope && chain.includes(state.scope)) {
        const parents = chain.slice(chain.indexOf(state.scope) + 1, -1);
        state.openContainers = [
          ...new Set([...state.openContainers, ...parents]),
        ];
      } else state.scope = n.parentId || (nodes.has(id) ? n.group : null);
      state.mode = "hierarchy";
      state.flow = null;
      state.trace = null;
      state.expanded.add(n.group);
      crumbIds(n.parentId).forEach((p) => state.expanded.add(p));
      render();
    } else {
      renderInspector();
      renderSidebar();
      renderCanvas(false);
      hash();
    }
    if (innerWidth <= 950 || state.present) {
      $("#sidebar").classList.remove("open");
      $("#inspector").classList.add("open");
    }
  }
  function scope(id) {
    rememberReading();
    rememberRelation();
    state.levelFocus = "auto";
    state.lens = "scope";
    if (id && !containers.has(id)) return;
    id = id || null;
    cameraCache.set(state.scope || "system", { ...state.camera });
    state.scope = id;
    state.mode = "hierarchy";
    state.flow = null;
    state.trace = null;
    state.selected = id;
    state.relation = null;
    state.query = "";
    state.expanded.add(id);
    crumbIds(id).forEach((p) => state.expanded.add(p));
    render();
    if (cameraCache.has(id || "system")) {
      state.camera = cameraCache.get(id || "system");
      applyCamera();
    }
  }
  let modalOpener = null;
  function modal(title, body) {
    hidePeek();
    const d = $("#modal");
    if (!d.open) {
      const element = document.activeElement;
      modalOpener = { element, action: element?.dataset.action, id: element?.dataset.id, value: element?.dataset.value };
    }
    d.classList.toggle("path-dialog", title === "探索关系路径");
    d.classList.toggle("source-dialog", ["打开一个来源", "分析范围与依据"].includes(title));
    d.innerHTML = `<div class="modal-header"><h2 id="modal-title">${escape(title)}</h2><button class="icon-btn" data-action="close-modal" aria-label="关闭对话框">${icon("close")}</button></div><div class="modal-content">${body}</div>`;
    if (!d.open) d.showModal();
    applyLevelHighlights();
  }
  $("#modal").addEventListener("close", () => {
    if ($("#modal").open) return;
    cancelSourceJob();
    sourcePreview = null;
    if ($("#modal").open || !modalOpener) return;
    const { element, action, id, value } = modalOpener;
    modalOpener = null;
    const selector = action ? `[data-action="${CSS.escape(action)}"]${id ? `[data-id="${CSS.escape(id)}"]` : ""}${value ? `[data-value="${CSS.escape(value)}"]` : ""}` : null;
    const target = element?.isConnected ? element : selector ? $(selector) : null;
    target?.focus({ preventScroll: true });
  });
  function hidePeek() {
    clearTimeout(hidePeek.timer);
    $("#peek").hidden = true;
  }
  document.addEventListener("pointerover", (e) => {
    const target = e.target.closest("[data-peek]");
    if (
      !target ||
      e.pointerType === "touch" ||
      (e.relatedTarget && target.contains(e.relatedTarget))
    )
      return;
    clearTimeout(hidePeek.timer);
    hidePeek.timer = setTimeout(() => {
      if (!target.isConnected) return;
      const n = all.get(target.dataset.peek);
      if (!n) return;
      const inc = incident(n.id);
      const peek = $("#peek");
      peek.innerHTML = `<div class="eyebrow" style="margin-bottom:9px">Quick preview · L${CodeLoomLevels.depth(data, n.id)}</div><h3>${escape(n.label)}</h3><p>${escape(n.summary || n.description || `${descendants(n.id).length} internal components`)}</p>${n.path ? `<code>${escape(n.path)}</code>` : ""}<div class="peek-counts"><span>↳ ${inc.incoming.length} incoming</span><span>↗ ${inc.outgoing.length} outgoing</span><span>${(n.functions || []).length} functions</span></div>`;
      const r = target.getBoundingClientRect();
      peek.hidden = false;
      peek.style.left =
        Math.max(10, Math.min(r.right + 12, innerWidth - 295)) + "px";
      peek.style.top =
        Math.max(10, Math.min(r.top, innerHeight - peek.offsetHeight - 12)) +
        "px";
    }, 350);
  });
  document.addEventListener("pointerout", (e) => {
    const target = e.target.closest("[data-peek]");
    if (target && !target.contains(e.relatedTarget)) hidePeek();
  });
  function renderCompare() {
    const host = $("#compare-float");
    if (!host) return;
    host.innerHTML = state.compare.length
      ? `<div class="compare-float"><p>${icon("compare")}已固定：${state.compare.map(label).map(escape).join(" / ")}</p><button data-action="show-compare">${state.compare.length === 2 ? "打开对照" : "选择另一个节点后点击「对照」"}</button><button data-action="clear-compare">清除</button></div>`
      : "";
  }
  function compare(id) {
    if (!state.compare.includes(id)) state.compare.push(id);
    if (state.compare.length > 2) state.compare.shift();
    renderCompare();
    if (state.compare.length === 2) showCompare();
    else toast(`已固定 ${label(id)}，再选择一个节点进行对照。`);
  }
  function showCompare() {
    if (state.compare.length < 2) {
      toast("先为两个节点点击「对照」。");
      return;
    }
    modal(
      "节点对照",
      `<p>并排查看职责、接口与连接，原来的阅读位置保持不变。</p><div class="compare-grid">${state.compare
        .map((id) => {
          const n = all.get(id),
            inc = incident(id);
          return `<section><h3>${escape(n.label)}</h3><p>${escape(n.summary || n.description || "Module boundary")}</p><div class="file-path"><code>${escape(n.path || n.id)}</code></div><p>${inc.incoming.length} incoming · ${inc.outgoing.length} outgoing</p><div class="section-label">Inputs</div><p>${escape(textIO(n.inputs))}</p><div class="section-label">Outputs</div><p>${escape(textIO(n.outputs))}</p><div class="section-label">Functions</div><ul>${(n.functions || []).map((f) => `<li>${escape(f.name)}</li>`).join("")}</ul><button class="btn" data-action="compare-jump" data-id="${id}">定位节点${icon("arrow")}</button></section>`;
        })
        .join("")}</div>`,
    );
  }
  function pathError(error) {
    if (!error) return "";
    return `${Number.isInteger(error.index) ? `第 ${error.index + 1} 段 · ${label(error.from)} → ${label(error.to)}：` : ""}${error.message}`;
  }
  function pathTrace(plan, choice = null) {
    const result = SkylensePaths.search(data, plan);
    const path = result.paths.find(item => item.key === choice) || result.paths[0];
    const options = result.options || plan;
    return { kind: "path", start: options.stops[0], end: options.stops.at(-1), plan: options,
      choice: path?.key || null, nodes: path ? [...new Set(path.nodes)] : [...new Set(options.stops)].filter(id => nodes.has(id)),
      edges: path ? [...new Set(path.edges)] : [], steps: path?.steps || [], segments: path?.segments || [], error: result.error, limited: result.limited };
  }
  function captureRoute() {
    if (!$("#path-builder")) return;
    routeDraft = { stops: $$("[data-path-stop]").map(el => el.value), direction: $("#path-direction").value,
      types: $$("[data-path-type]:checked").map(el => el.value), maxHops: Number($("#path-hops").value), limit: 3 };
    const everyType = [...new Set(data.edges.map(edge => edge.type))];
    if (routeDraft.types.length === everyType.length) routeDraft.types = null;
  }
  function invalidateRoute() {
    routeResult = null;
    const host = $("#path-results");
    if (host) host.innerHTML = '<p class="path-empty">条件已更新。点击「探索路径」计算结果。</p>';
  }
  function routeResults() {
    const host = $("#path-results");
    if (!host || !routeResult) return;
    if (routeResult.error) {
      host.innerHTML = `<div class="path-error" role="alert"><strong>这条路径尚未连通</strong><p>${escape(pathError(routeResult.error))}</p><small>保留所有必经点；调整条件后重新探索。不会补出不存在的连接。</small></div>`;
      return;
    }
    host.innerHTML = `<div class="path-result-heading"><strong>${routeResult.paths.length} 条可选路径</strong><span>按跳数排序 · 原始关系方向不变</span></div>${routeResult.limited ? '<p class="path-warning">达到搜索预算，仅显示已确认的路径；备选结果可能不完整。</p>' : ''}${routeResult.paths.map((path, index) => `<section class="path-candidate"><div class="path-candidate-top"><div><b>方案 ${index + 1}</b><span>${path.steps.length} 跳 · ${new Set(path.nodes).size} 个组件${path.steps.some(step => step.reverse) ? ` · ${path.steps.filter(step => step.reverse).length} 次逆向阅读` : ""}</span></div><button class="btn ${index === 0 ? "primary" : ""}" data-action="apply-path" data-id="${index}">应用到画布${icon("arrow")}</button></div>${path.segments.map(segment => `<details class="path-segment" ${index === 0 ? "open" : ""}><summary><span class="path-number">${segment.index + 1}</span><span>${escape(label(segment.from))} → ${escape(label(segment.to))}</span><small>${segment.steps.length} 跳</small></summary>${segment.steps.length ? `<ol class="path-steps">${segment.steps.map(step => `<li><div class="path-step-label"><span class="path-type" style="${typeStyle(step.type)}">${escape(CodeLoomSemantics.relation(step.type).label)} · ${escape(step.type)}</span>${step.reverse ? '<span class="path-reverse">逆向阅读</span>' : ""}<code>${escape(step.edge)}</code></div><strong>${escape(step.label)}</strong><p>${escape(label(step.source))}<span aria-label="原始关系方向"> → </span>${escape(label(step.target))}</p>${step.reverse ? `<small>阅读顺序：${escape(label(step.from))} → ${escape(label(step.to))}（沿关系反向）</small>` : ""}</li>`).join("")}</ol>` : '<p class="path-zero">两个路标是同一组件，0 跳；无需添加自环。</p>'}</details>`).join("")}</section>`).join("")}`;
  }
  function renderRoute(focusId = null) {
    const choices = selected => data.nodes.map(n => `<option value="${escape(n.id)}" ${n.id === selected ? "selected" : ""}>${escape(n.qualifiedName || n.label)} · ${escape(n.path || n.id)}</option>`).join("");
    const types = [...new Set(data.edges.map(edge => edge.type))];
    modal("探索关系路径", `<div id="path-builder"><p class="path-intro">从两个组件开始，加入你想依次经过的节点。比较连接方式，查看每一步的原始关系与方向。</p><div class="path-stops">${routeDraft.stops.map((id, index) => `<div class="path-stop"><span class="path-stop-marker">${index === 0 ? "起" : index === routeDraft.stops.length - 1 ? "终" : index}</span><label for="${index === 0 ? "route-from" : index === routeDraft.stops.length - 1 ? "route-to" : `path-stop-${index}`}">${index === 0 ? "起点" : index === routeDraft.stops.length - 1 ? "终点" : `必经点 ${index}`}<select data-path-stop="${index}" id="${index === 0 ? "route-from" : index === routeDraft.stops.length - 1 ? "route-to" : `path-stop-${index}`}">${choices(id)}</select></label>${index > 0 && index < routeDraft.stops.length - 1 ? `<div class="path-stop-actions"><button class="icon-btn" data-action="path-move" data-id="${index}" data-value="-1" aria-label="上移必经点 ${index}" ${index === 1 ? "disabled" : ""}>↑</button><button class="icon-btn" data-action="path-move" data-id="${index}" data-value="1" aria-label="下移必经点 ${index}" ${index === routeDraft.stops.length - 2 ? "disabled" : ""}>↓</button><button class="icon-btn" data-action="path-remove" data-id="${index}" aria-label="删除必经点 ${index}">${icon("close")}</button></div>` : ""}</div>`).join("")}</div><div class="path-edit-actions"><button class="btn" data-action="path-add" ${routeDraft.stops.length >= 8 ? "disabled" : ""}>${icon("plus")}添加必经节点</button><button class="btn" data-action="path-swap">交换起终点</button><button class="btn" data-action="path-clear" ${routeDraft.stops.length <= 2 ? "disabled" : ""}>清空必经点</button></div><div class="path-options"><label for="path-direction">阅读方向<select id="path-direction">${[["downstream","沿箭头 · 下游"],["upstream","逆箭头 · 上游"],["both","双向 · 关联探索"]].map(([value,text]) => `<option value="${value}" ${routeDraft.direction === value ? "selected" : ""}>${text}</option>`).join("")}</select></label><label for="path-hops">整条路径最多跳数<input type="number" id="path-hops" value="${routeDraft.maxHops}" min="1" max="48" step="1"></label></div><fieldset class="path-types"><legend>可经过的关系类型</legend>${types.map(type => `<label><input type="checkbox" data-path-type value="${escape(type)}" ${routeDraft.types === null || routeDraft.types.includes(type) ? "checked" : ""}><span class="path-type-dot" style="${typeStyle(type)}"></span>${escape(CodeLoomSemantics.relation(type).label)}<small>${escape(type)}</small></label>`).join("")}</fieldset><div class="path-search-actions"><small>最多 3 个方案 · 按顺序经过路标 · 连接性不等于运行轨迹</small><button class="btn primary" data-action="find-route">${icon("route")}探索路径</button></div><div id="path-results" aria-live="polite"><p class="path-empty">添加必经点可回答「从这里出发，经过这些组件，如何到达目标」。</p></div></div>`);
    if (routeResult) routeResults();
    if (focusId) document.getElementById(focusId)?.focus();
  }
  function openRoute() {
    if (!data.nodes.length) { toast("当前模型没有可用于路径探索的节点。"); return; }
    if (state.trace?.kind === "path") routeDraft = structuredClone(state.trace.plan);
    if (!routeDraft || routeDraft.stops.some(id => !nodes.has(id))) routeDraft = { stops: [nodes.has(state.selected) ? state.selected : data.nodes[0].id, data.nodes.at(-1).id], direction: "downstream", types: state.type === "all" ? null : [state.type], maxHops: 24, limit: 3 };
    routeResult = state.trace?.kind === "path" ? SkylensePaths.search(data, routeDraft) : null;
    renderRoute();
  }

  function cancelSourceJob() {
    if (sourceJob) sourceJob.controller.abort();
    sourceJob = null;
    sourceSerial += 1;
  }
  function activateModel(parsed) {
    AtlasGraph.validate(parsed);
    const previous = { data, imported, saved, state: { ...state, expanded: new Set(state.expanded) }, routeDraft, routeResult };
    try {
      data = parsed;
      index();
      imported = true;
      saved = [];
      routeDraft = null; routeResult = null;
      Object.assign(state, {
        scope: null, selected: null, trace: null, flow: null, step: 0,
        mode: "hierarchy", tab: "overview", query: "", compare: [], expanded: new Set(),
        lens: "scope", levelFocus: "auto", focusDimming: true, categoryGroups: true,
        present: false, openContainers: [], relation: null, lastRelation: null, type: "all",
      });
      sceneCache.clear();
      render();
      readingHistory.length = 0;
      cameraCache.clear();
    } catch (err) {
      data = previous.data; imported = previous.imported; saved = previous.saved;
      routeDraft = previous.routeDraft; routeResult = previous.routeResult;
      index(); Object.assign(state, previous.state); sceneCache.clear(); render();
      throw err;
    }
  }
  function reportText(value) {
    return typeof value === "string" ? value : value && typeof value === "object"
      ? [(value.path || value.file || value.name || "") + (value.line ? ":" + value.line : ""), value.specifier, value.reason || value.message || value.detail].filter(Boolean).join(" · ") || JSON.stringify(value)
      : String(value ?? "");
  }
  function sourceReport(model) {
    const report = model.meta?.ingestion || {}, counts = report.counts || report;
    const number = (...keys) => {
      for (const key of keys) {
        const value = counts[key] ?? report[key];
        if (Array.isArray(value)) return value.length;
        if (typeof value === "number" && Number.isFinite(value)) return value;
      }
      return "—";
    };
    const details = (title, value) => {
      if (value === undefined || value === null || value === false) return "";
      const fieldNames = { hierarchy: "层级", symbols: "符号", relationships: "关系", execution: "执行代码", aiInference: "AI 推断", unsupported: "当前限制", maxFiles: "文件上限", maxFileBytes: "单文件字节上限", maxTotalBytes: "总文本字节上限" };
      const items = Array.isArray(value) ? value : typeof value === "object" ? Object.entries(value).map(([key, item]) => `${fieldNames[key] || key}: ${typeof item === "boolean" ? item ? "是" : "否" : reportText(item)}`) : [value];
      if (!items.length) return "";
      return `<details class="source-report-details"><summary>${escape(title)} <small>${items.length}</small></summary><ul>${items.slice(0, 80).map(item => `<li>${escape(reportText(item))}</li>`).join("")}</ul>${items.length > 80 ? `<p>另有 ${items.length - 80} 项；完整记录保留在导出的 JSON 中。</p>` : ""}</details>`;
    };
    const source = model.meta?.source || report.source;
    const sourceNames = { "browser-files": "浏览器本地读取", "local-folder": "本地文件夹", "local-file": "本地文件" };
    return `<div class="source-report-summary"><span class="source-eyebrow">STATIC SOURCE MAP</span><h3>${escape(model.meta?.title || "来源分析")}</h3><p>文件层级与静态引用组成可追溯地图。未推断运行顺序，也不表示完整的运行时调用图。</p>${source ? `<small>${escape(typeof source === "object" ? source.url || source.label || source.kind || "" : sourceNames[source] || source)}</small>` : ""}</div><div class="source-metrics">${[[number("scannedFiles", "scanned", "inputEntries"), "已扫描文件"], [number("acceptedFiles"), "已纳入文件"], [number("analyzedFiles", "analyzed", "textFiles"), "文本已分析"], [number("metadataOnlyFiles"), "仅文件信息"], [number("skippedFiles", "skipped", "excludedFiles"), "已记录跳过"], [number("truncatedFiles"), "文本预览截断"]].map(([value, name]) => `<div><b>${escape(value)}</b><span>${name}</span></div>`).join("")}</div>${report.truncated ? '<p class="source-private-note">读取范围达到上限；这张地图仅覆盖报告记录的部分内容。</p>' : ""}<div class="source-model-metrics"><span>${model.nodes.length} 个节点</span><span>${model.edges.length} 条关系</span><span>${(model.hierarchy || model.groups).length} 个层级容器</span></div>${details("分析能力", report.capabilities)}${details("覆盖限制与提示", report.warnings || report.limitations)}${details("跳过项与原因", report.skipped)}${details("截断项", report.truncated)}${details("未解析的引用", report.unresolved)}${details("读取预算", report.limits)}${details("解析器与语言", report.languages || report.parsers)}<p class="source-private-note">本次模型保留在当前页面会话。导出 JSON 可以继续在 CLI 或 Agent 中使用；导出文件会包含已分析的文本摘录。</p>`;
  }
  function openSource() {
    cancelSourceJob(); sourcePreview = null;
    sourceTab = "files";
    modal("打开一个来源", `<div class="source-intro"><span class="source-eyebrow">YOUR NEXT MAP</span><h3>从真实内容，走进结构。</h3><p>选择文件夹、文件或网址，让 Skylense 自动建立层级、静态关联和来源预览。</p></div><div class="source-tabs" role="tablist" aria-label="来源类型"><button role="tab" aria-selected="true" aria-controls="source-panel-files" id="source-tab-files" data-action="source-tab" data-value="files">${icon("layers")}文件与文件夹</button><button role="tab" aria-selected="false" aria-controls="source-panel-url" id="source-tab-url" data-action="source-tab" data-value="url" tabindex="-1">${icon("link")}GitHub / 网页</button><button role="tab" aria-selected="false" aria-controls="source-panel-text" id="source-tab-text" data-action="source-tab" data-value="text" tabindex="-1">${icon("document")}粘贴文本</button></div><div class="source-panel" id="source-panel-files" role="tabpanel" aria-labelledby="source-tab-files"><div class="source-file-grid"><button class="source-choice" data-action="source-folder">${icon("layers")}<b>打开文件夹</b><span>保留目录层级，自动提取支持语言的引用关系。</span><small>在此浏览器本地读取</small></button><button class="source-choice" data-action="source-files">${icon("document")}<b>选择文件</b><span>代码、文档、网页 HTML 或其他文件，可多选。</span><small>未知语言保留文本，二进制保留文件信息</small></button></div><input type="file" id="source-folder-input" webkitdirectory directory multiple hidden><input type="file" id="source-files-input" multiple hidden><p class="source-private-note">源码与文档按文本读取，不执行代码或网页脚本。通常排除依赖目录、版本记录与敏感配置；具体范围会在分析报告中列出。</p></div><div class="source-panel" id="source-panel-url" role="tabpanel" aria-labelledby="source-tab-url" hidden><label for="source-url">公开 GitHub 仓库或网页地址</label><div class="source-url-row"><input id="source-url" type="url" placeholder="https://github.com/owner/repository" autocomplete="off" spellcheck="false"><button class="btn primary" data-action="source-url">${icon("arrow")}分析网址</button></div><p class="source-private-note">${localBridge ? "由当前本地 CLI 服务获取内容。网页链接不等于背后的源码仓库；只分析实际可读取的内容。" : "公开仓库使用 GitHub 接口。网页能否直接读取取决于站点的跨域设置；受限时可用本地 CLI 打开，或上传保存的 HTML。"}</p></div><div class="source-panel" id="source-panel-text" role="tabpanel" aria-labelledby="source-tab-text" hidden><label for="source-text-name">文件名（扩展名用于选择分析方式）</label><input id="source-text-name" value="notes.md" maxlength="120" autocomplete="off"><label for="source-text">粘贴源码、文档或 HTML</label><textarea id="source-text" rows="7" spellcheck="false" placeholder="粘贴你希望探索的内容…"></textarea><div class="source-text-actions"><button class="btn primary" data-action="source-text">${icon("arrow")}分析文本</button></div></div><div class="source-limits"><label for="source-max-files">文件预算<select id="source-max-files"><option value="100">100 个文件 · 快速查看</option><option value="300" selected>300 个文件 · 标准</option><option value="1000">1,000 个文件 · 更广覆盖</option></select></label><span>超过预算会明确报告，结果可能只覆盖部分内容。</span></div><details class="source-capabilities"><summary>这次会生成什么？</summary><p>所有可接收的文件都会按其支持程度处理：目录和文件层级、JS / TS / Python 的静态引用、文档与网页内容，以及其他类型的文件信息。未解析的语言、动态导入、运行时行为与受限内容会在报告中说明。无需模型 API 密钥。</p></details><div id="source-feedback" aria-live="polite"></div>`);
  }
  function selectSourceTab(tab) {
    if (!["files", "url", "text"].includes(tab) || sourceJob) return;
    sourceTab = tab;
    for (const name of ["files", "url", "text"]) {
      const selected = name === tab;
      $("#source-tab-" + name)?.setAttribute("aria-selected", String(selected));
      $("#source-tab-" + name)?.setAttribute("tabindex", selected ? "0" : "-1");
      const panel = $("#source-panel-" + name); if (panel) panel.hidden = !selected;
    }
  }
  function sourceBusy(busy) {
    const dialog = $("#modal");
    dialog.classList.toggle("source-busy", busy);
    for (const input of $$(".source-tabs button, .source-panel button, .source-panel input, .source-panel textarea, #source-max-files", dialog)) input.disabled = busy;
  }
  function sourceProgress(job, progress) {
    if (sourceJob !== job || !$("#source-feedback")) return;
    const status = $("#source-progress-text");
    if (!status) return;
    const payload = typeof progress === "string" ? { message: progress } : progress || {};
    status.textContent = payload.message || payload.path || payload.phase || "正在分析可读取的内容…";
    const meter = $("#source-progress-meter");
    const done = payload.completed ?? payload.current ?? payload.loaded, total = payload.total;
    if (Number.isFinite(done) && Number.isFinite(total) && total > 0) { meter.max = total; meter.value = Math.min(done, total); }
    else meter.removeAttribute("value");
  }
  async function bridgeRequest(path, options = {}) {
    if (!localBridge) throw new Error("当前页面没有连接本地 CLI 服务。");
    const response = await fetch(new URL(path, localBridge.origin), { ...options, credentials: "omit", cache: "no-store", headers: { ...(options.headers || {}), Authorization: "Bearer " + localBridge.token } });
    if (!response.ok) {
      if (response.status === 401) { try { sessionStorage.removeItem(bridgeSessionKey); } catch {} }
      let detail = "";
      try { const body = await response.json(); detail = body.error?.message || body.error || body.message || ""; } catch {}
      const error = new Error(typeof detail === "string" && detail ? detail : `本地服务返回 HTTP ${response.status}`); error.status = response.status; throw error;
    }
    return response.json();
  }
  async function runSource(kind, input) {
    if (!$("#source-feedback")) openSource();
    cancelSourceJob(); sourcePreview = null;
    const job = { id: ++sourceSerial, controller: new AbortController() };
    sourceJob = job; sourceBusy(true);
    $("#source-feedback").innerHTML = `<div class="source-progress"><div>${icon("layers")}<strong>建立你的来源地图</strong><button class="btn" data-action="source-cancel">取消</button></div><progress id="source-progress-meter" aria-label="来源分析进度"></progress><p id="source-progress-text">正在准备读取…</p></div>`;
    const maxFiles = Number($("#source-max-files")?.value || 300);
    const options = { maxFiles, signal: job.controller.signal, onProgress: progress => sourceProgress(job, progress) };
    try {
      let parsed;
      if (kind === "initial") parsed = await bridgeRequest("/api/model", { signal: options.signal });
      else if (kind === "url" && localBridge) parsed = await bridgeRequest("/api/analyze", { method: "POST", signal: options.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: input, maxFiles }) });
      else {
        if (!window.SkylenseSources) throw new Error("来源分析模块未载入，请刷新页面或重新下载最新版。");
        parsed = kind === "url" ? await SkylenseSources.analyzeURL(input, options) : await SkylenseSources.analyzeFiles(input, options);
      }
      if (sourceJob !== job || job.controller.signal.aborted || !$("#modal").open) return;
      AtlasGraph.validate(parsed);
      if (kind === "initial") {
        activateModel(parsed);
        if (initialHash.size) {
          history.replaceState(null, "", "#" + initialHash);
          readHash(); render();
        }
        sourceJob = null;
        $("#modal").close();
        toast(`已从本地服务打开 ${data.nodes.length} 个节点；分析范围可在侧栏查看。`);
        return;
      }
      sourcePreview = parsed;
      sourceJob = null; sourceBusy(false);
      $("#source-feedback").innerHTML = `<div class="source-ready"><div class="source-ready-heading">${icon("check")}分析完成，请查看覆盖范围</div>${sourceReport(parsed)}<div class="source-ready-actions"><button class="btn" data-action="source-download">${icon("download")}下载 JSON</button><button class="btn primary" data-action="source-apply">进入这张地图${icon("arrow")}</button></div></div>`;
      $("#source-feedback").scrollIntoView({ block: "nearest", behavior: "instant" });
      $("[data-action=source-apply]")?.focus({ preventScroll: true });
    } catch (err) {
      if (sourceJob !== job || job.controller.signal.aborted) return;
      sourceJob = null; sourceBusy(false);
      if (kind === "initial" && err.status === 404) {
        $("#source-feedback").innerHTML = '<p class="source-private-note">本地服务已连接。选择文件夹、文件或网址开始分析。</p>';
        return;
      }
      const canRetryURL = kind === "url" && !localBridge && !["PRIVATE_URL", "INVALID_URL"].includes(err.code);
      const command = kind === "url" ? "skylense open '" + String(input).replace(/'/g, "'\\''") + "'" : "skylense open /absolute/path/to/folder";
      $("#source-feedback").innerHTML = `<div class="source-error" role="alert"><strong>还未完成这次分析</strong><p>${escape(err.message || "来源读取失败")}</p>${kind === "initial" ? "<p>本地连接失效时，请重新使用终端或 Agent 刚返回的完整链接打开，并保持对应服务运行。</p>" : ""}${canRetryURL ? `<p>浏览器可能无法跨域读取此站点，也可能遇到 GitHub 速率限制。可在终端运行下面的命令，或改为上传保存的 HTML / 粘贴文本。</p><code>${escape(command)}</code><button class="btn" data-action="copy-command" data-value="${escape(command)}">复制 CLI 命令</button>` : ""}<small>当前画布和已有模型未改变。</small></div>`;
    }
  }
  async function initializeLocalSource() {
    if (!localBridge) {
      if (initialURL.searchParams.get("open") === "source") openSource();
      return;
    }
    openSource();
    await runSource("initial");
  }

  function download(name, content, type = "application/json") {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportMenu() {
    modal(
      "把这份架构带走",
      `<p>导出的 JSON 保留全部层级、关系与依据。也可以导入另一个同结构模型，继续使用这个交互工作台。</p><button class="export-option" data-action="export-json">${icon("code")}<span><b>完整架构 JSON</b><small>${data.nodes.length} 组件 · ${data.edges.length} 关系 · 含函数、文档与依据</small></span></button><button class="export-option" data-action="export-svg">${icon("download")}<span><b>当前画布 SVG</b><small>静态矢量快照 · 保留当前布局与关系样式</small></span></button><button class="export-option" data-action="import">${icon("upload")}<span><b>导入架构 JSON</b><small>本地校验结构、端点与层级，不上传数据</small></span></button><button class="export-option" data-action="presentation"><span>${icon("play")}</span><span><b>Skylense 讲解模式</b><small>用当前地图讲解层级、流程和上下游关系</small></span></button><p class="micro">离线单文件版位于 standalone.html。连接 MCP 与终端后，可在更多工作流中查询同一份模型。</p>`,
    );
  }
  function exportSVG() {
    const theme = SkylenseThemes.resolve(themeId).colors;
    const bg = theme.bg, panel = theme.panel, text = theme.text, muted = theme.muted;
    const types = [...new Set(data.edges.map((e) => e.type))];
    const markers = types
      .map((type) => {
        const t = CodeLoomSemantics.relation(type);
        return `<marker id="a-${t.key}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8" fill="${semanticInk(t)}"/></marker>`;
      })
      .join("");
    const legend = types
      .map((type, i) => {
        const t = CodeLoomSemantics.relation(type);
        return `<g transform="translate(${30 + i * 115} 72)"><path d="M0 0H28" stroke="${semanticInk(t)}" stroke-width="2" ${t.dash ? `stroke-dasharray="${t.dash}"` : ""}/><text x="34" y="4" fill="${semanticInk(t)}" font-size="11">${escape(t.label)}</text></g>`;
      })
      .join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height + 115}" viewBox="0 0 ${layout.width} ${layout.height + 115}" font-family="sans-serif"><rect width="100%" height="100%" fill="${bg}"/><text x="30" y="28" font-size="17" fill="${text}">Skylense · ${escape(data.meta?.title || "Architecture")}</text><text x="30" y="48" font-size="10" fill="${muted}">${generated() ? "Automatically generated static source map" : imported ? "Imported architecture model" : "Pinned public-source snapshot"} · Original relationship identities preserved</text>${legend}<g transform="translate(0 100)"><defs>${markers}</defs>${layout.bounds.map((b) => `<g><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="8" fill="none" stroke="${muted}" stroke-dasharray="4 4"/><text x="${b.x + 16}" y="${b.y + 23}" font-size="11" fill="${muted}">${escape(label(b.id))}</text></g>`).join("")}${(
      layout.categoryBounds || []
    )
      .map((b) => {
        const t = CodeLoomSemantics.node(b.kind);
        return `<g data-category="${escape(b.kind)}"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="14" fill="${semanticInk(t)}" fill-opacity=".035" stroke="${semanticInk(t)}" stroke-opacity=".3"/><text x="${b.x + 14}" y="${b.y + 25}" font-size="11" fill="${semanticInk(t)}">${escape(t.label)} · 类别分区 · ${b.ids.length}</text></g>`;
      })
      .join("")}${layout.wires
      .filter((w) => !w.blocked)
      .map((w) => {
        const t = CodeLoomSemantics.relation(w.relation.type);
        return `<path data-relation-id="${escape(w.relation.id)}" d="${w.path}" fill="none" stroke="${semanticInk(t)}" stroke-width="1.8" ${t.dash ? `stroke-dasharray="${t.dash}"` : ""} ${w.role === "target" ? `marker-end="url(#a-${t.key})"` : ""}/>`;
      })
      .join("")}${layout.hubs
      .map((h) => {
        const t = CodeLoomSemantics.relation(h.relation.type),
          shape = relationTopology(h.relation.edges);
        return `<g><title>${escape(t.label)} · ${shape.cardinality} · ${h.relation.edgeIds.length} 条</title><rect x="${h.x}" y="${h.y}" width="${h.w}" height="${h.h}" rx="17" fill="${panel}" stroke="${semanticInk(t)}"/><text x="${h.x + 9}" y="${h.y + h.h / 2 + 3}" font-size="10" fill="${semanticInk(t)}">↗ ${escape(relationTitle(h.relation).slice(0, 12))}${h.relation.edgeIds.length > 1 ? ` · ${h.relation.edgeIds.length}` : ""}</text></g>`;
      })
      .join("")}${layout.items
      .map((p) => {
        const t = CodeLoomSemantics.node(p.n.kind);
        return `<g><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="9" fill="${panel}" stroke="${semanticInk(t)}" ${containers.has(p.n.id) ? 'stroke-dasharray="4 3"' : ""}/><text x="${p.x + 15}" y="${p.y + 26}" font-size="13" fill="${text}">${escape(p.n.label.length > 27 ? p.n.label.slice(0, 26) + "…" : p.n.label)}</text><text x="${p.x + 15}" y="${p.y + 46}" font-size="10" fill="${semanticInk(t)}">${escape(t.label)} · ${escape(p.n.id)}</text><text x="${p.x + 15}" y="${p.y + 70}" font-size="10" fill="${muted}">${escape((p.n.summary || "Module boundary").slice(0, 34))}</text></g>`;
      })
      .join("")}</g></svg>`;
    download("skylense-view.svg", svg, "image/svg+xml");
    toast("当前画布与语义样式已导出为 SVG。");
  }
  function documentModal(id) {
    const doc = (data.documents || []).find((d) => d.id === id);
    if (!doc) return;
    modal(
      doc.title,
      `<p><code>${escape(doc.path)}</code> · ${doc.status === "proposal" ? "拟议方案，未核验实施" : generated() ? "自动提取的来源文本" : "示例阅读指南"}</p><pre>${escape(doc.content)}</pre>`,
    );
  }
  const actions = {
    "source-open": openSource,
    "source-tab": selectSourceTab,
    "source-folder": () => $("#source-folder-input")?.click(),
    "source-files": () => $("#source-files-input")?.click(),
    "source-url": () => {
      const input = $("#source-url"), value = input.value.trim();
      try {
        const parsed = new URL(value);
        if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
      } catch { input.setCustomValidity("请输入不含登录凭据的完整 http(s) 地址。"); input.reportValidity(); input.setCustomValidity(""); return; }
      runSource("url", value);
    },
    "source-text": () => {
      const content = $("#source-text").value;
      if (!content.trim()) { $("#source-text").focus(); toast("先粘贴需要分析的内容。"); return; }
      const name = $("#source-text-name").value.trim().replace(/[\\/]/g, "_") || "notes.md";
      runSource("files", [new File([content], name, { type: "text/plain" })]);
    },
    "source-cancel": () => {
      cancelSourceJob(); sourcePreview = null; sourceBusy(false);
      if ($("#source-feedback")) $("#source-feedback").innerHTML = '<p class="source-cancelled" role="status">已取消。当前画布和已有模型未改变。</p>';
    },
    "source-apply": () => {
      if (!sourcePreview) return;
      try { activateModel(sourcePreview); $("#modal").close(); toast(`已打开 ${data.nodes.length} 个节点。分析范围可在侧栏「分析报告」查看。`); }
      catch (err) { toast("无法打开生成结果：" + err.message); }
    },
    "source-download": () => { if (sourcePreview) download("skylense-model.json", JSON.stringify(sourcePreview, null, 2)); },
    "source-report": () => modal("分析范围与依据", sourceReport(data)),
    "toggle-dimming": () => {
      rememberReading();
      state.focusDimming = !state.focusDimming;
      applyLevelHighlights();
      hash();
    },
    "toggle-categories": () => {
      if (!categoryGroupingAvailable()) return;
      rememberReading();
      state.categoryGroups = !state.categoryGroups;
      render();
    },
    motion: () => {
      if (reducedMotion.matches) return;
      motionWanted = !motionWanted;
      storage.set("motion", motionWanted);
      updateMotion();
    },
    "level-focus": (value) => {
      rememberReading();
      state.levelFocus = validLevelFocus(value);
      applyLevelHighlights();
      hash();
    },
    legend: showLegend,
    "filter-type": (value) => {
      const select = $("#edge-filter");
      select.value = state.type === value ? "all" : value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    },
    lens: (value) => {
      if (!["scope", "neighbors", "global"].includes(value)) return;
      rememberReading();
      state.lens = value;
      state.levelFocus = "auto";
      if (value === "global") state.tab = "context";
      render();
    },
    "boundary-context": () => {
      if (!state.scope) return;
      rememberReading();
      rememberRelation();
      state.selected = state.scope;
      state.relation = null;
      state.trace = null;
      state.flow = null;
      state.lens = "neighbors";
      state.tab = "connections";
      render();
    },
    "context-reach": (direction) => {
      const ctx = selectionContext();
      if (!ctx.members.length) return;
      rememberReading();
      state.trace = makeContextTrace(ctx.members, direction);
      state.lens = "scope";
      state.flow = null;
      state.mode = "components";
      render();
    },
    "back-selection": () => {
      const old = readingHistory.pop();
      if (!old) return;
      Object.assign(state, old);
      state.lastRelation = null;
      render();
      if (old.camera) {
        state.camera = { ...old.camera };
        applyCamera();
      }
    },
    present: () => {
      state.present = !state.present;
      render();
    },

    "level-up": () =>
      scope(state.scope ? containers.get(state.scope)?.parentId || null : null),
    "toggle-bundles": () => {
      state.bundle = !state.bundle;
      renderCanvas(true);
      hash();
    },
    "canvas-expand": (_, id) => {
      if (state.lens !== "scope") {
        scope(id);
        return;
      }
      if (!containers.has(id)) return;
      state.openContainers = [...new Set([...state.openContainers, id])];
      state.mode = "hierarchy";
      render();
    },
    "canvas-collapse": (_, id) => {
      state.lens = "scope";
      state.openContainers = state.openContainers.filter((x) => x !== id);
      if (state.selected && crumbIds(state.selected).includes(id))
        state.selected = id;
      state.mode = "hierarchy";
      render();
    },
    "collapse-canvas": () => {
      state.lens = "scope";
      state.openContainers = [];
      state.selected = state.scope;
      state.mode = "hierarchy";
      state.trace = null;
      state.flow = null;
      render();
    },
    relation: (_, id) => {
      const r = layout.relations.find((r) => r.id === id);
      if (r) selectRelation(r.edgeIds);
    },
    "raw-edge": (_, id) => selectRelation([id], true),
    "relation-parent": () => {
      if (state.relation?.parentEdgeIds)
        selectRelation(state.relation.parentEdgeIds);
    },
    "relation-up": () => {
      state.lens = "scope";
      state.scope = state.scope
        ? containers.get(state.scope)?.parentId || null
        : null;
      state.mode = "hierarchy";
      state.trace = null;
      state.flow = null;
      state.openContainers = [];
      render();
    },
    "relation-detail": () => {
      state.lens = "scope";
      const edges = selectedRelationEdges();
      if (!edges.length) return;
      state.trace = {
        kind: "relation",
        edges: edges.map((e) => e.id),
        nodes: [...new Set(edges.flatMap((e) => [e.source, e.target]))],
      };
      state.mode = "components";
      state.flow = null;
      state.scope = CodeLoomRelations.commonAncestor(data, state.trace.nodes);
      render();
    },
    "relation-endpoint": (_, id) => select(id),
    "return-relation": () => {
      const previous = state.lastRelation;
      if (!previous) return;
      if (previous.view) {
        Object.assign(state, JSON.parse(JSON.stringify(previous.view)));
        state.relation = {
          edgeIds: [...previous.edgeIds],
          parentEdgeIds: previous.parentEdgeIds
            ? [...previous.parentEdgeIds]
            : null,
        };
        state.selected = null;
        state.tab = "overview";
        render();
        if (previous.view.camera) {
          state.camera = { ...previous.view.camera };
          applyCamera();
        }
        rememberRelation();
      } else selectRelation(previous.edgeIds, false, previous.parentEdgeIds);
    },
    home: () => scope(null),
    scope: (_, id) => scope(id),
    select: (_, id) => select(id),
    expand: (_, id) => {
      state.expanded.has(id)
        ? state.expanded.delete(id)
        : state.expanded.add(id);
      renderTree();
    },
    tab: (value) => {
      state.tab = value;
      renderInspector();
      applyLevelHighlights();
      hash();
    },
    mode: (value) => {
      rememberRelation();
      state.lens = "scope";
      state.mode = value;
      state.levelFocus = "auto";
      state.relation = null;
      state.trace = null;
      if (value === "flow") {
        if (!(data.flows || []).length) {
          state.mode = "components";
          toast(generated() ? "静态分析不生成运行流程；可用「路径」探索真实引用关系。" : "此模型没有预设流程，可用「路径」探索已有连接。");
        } else {
          state.flow = state.flow || data.flows[0].id;
          state.selected = currentFlow().nodes[0];
          state.step = 0;
        }
      } else state.flow = null;
      render();
    },
    flow: (_, id) => {
      const f = (data.flows || []).find((f) => f.id === id);
      if (!f) return;
      rememberRelation();
      state.lens = "scope";
      state.flow = id;
      state.levelFocus = "auto";
      state.relation = null;
      state.mode = "flow";
      state.trace = null;
      state.step = 0;
      state.selected = f.nodes[0];
      state.scope = null;
      render();
    },
    step: (_, i) => {
      const f = currentFlow();
      if (!f) return;
      rememberRelation();
      state.step = Math.max(0, Math.min(f.nodes.length - 1, Number(i)));
      state.lens = "scope";
      state.selected = f.nodes[state.step];
      state.levelFocus = "auto";
      state.relation = null;
      renderStory();
      renderInspector();
      renderCanvas(false);
      if (state.present) focusReadingNode();
      hash();
    },
    "next-step": () => actions.step(null, state.step + 1),
    "prev-step": () => actions.step(null, state.step - 1),
    reach: (value) => {
      if (!nodes.has(state.selected)) return;
      state.trace = {
        ...AtlasGraph.reachable(filteredEdges(), state.selected, value),
        direction: value,
        origin: state.selected,
      };
      state.scope = null;
      state.flow = null;
      state.mode = "components";
      render();
    },
    "clear-trace": () => {
      state.trace = null;
      state.scope = all.get(state.selected)?.group || state.scope || null;
      render();
    },
    route: openRoute,
    "path-add": () => { captureRoute(); if (routeDraft.stops.length >= 8) return; routeDraft.stops.splice(-1, 0, data.nodes.find(node => !routeDraft.stops.includes(node.id))?.id || routeDraft.stops[0]); routeResult = null; renderRoute(`path-stop-${routeDraft.stops.length - 2}`); },
    "path-remove": (_, id) => { captureRoute(); const index = Number(id); if (index > 0 && index < routeDraft.stops.length - 1) routeDraft.stops.splice(index, 1); routeResult = null; renderRoute("route-from"); },
    "path-move": (value, id) => { captureRoute(); const index = Number(id), next = index + Number(value); if (index > 0 && next > 0 && next < routeDraft.stops.length - 1) [routeDraft.stops[index], routeDraft.stops[next]] = [routeDraft.stops[next], routeDraft.stops[index]]; routeResult = null; renderRoute(`path-stop-${next}`); },
    "path-swap": () => { captureRoute(); [routeDraft.stops[0], routeDraft.stops[routeDraft.stops.length - 1]] = [routeDraft.stops.at(-1), routeDraft.stops[0]]; routeResult = null; renderRoute("route-from"); },
    "path-clear": () => { captureRoute(); routeDraft.stops = [routeDraft.stops[0], routeDraft.stops.at(-1)]; routeResult = null; renderRoute("route-from"); },
    "find-route": () => { captureRoute(); routeResult = SkylensePaths.search(data, routeDraft); routeResults(); },
    "apply-path": (_, id) => {
      const path = routeResult?.paths[Number(id)];
      if (!path) return;
      rememberRelation();
      state.trace = pathTrace(routeResult.options, path.key);
      state.type = "all"; state.lens = "scope"; state.selected = state.trace.start;
      state.relation = null; state.scope = null; state.mode = "components"; state.flow = null;
      $("#modal").close(); render();
      toast(`已显示 ${path.steps.length} 跳的关系路径；原始箭头方向保持不变。`);
    },
    "zoom-in": () => zoom(1.2),
    "zoom-out": () => zoom(1 / 1.2),
    fit: fitCanvas,
    theme: showThemes,
    "choose-theme": (_, id) => {
      const camera = { ...state.camera };
      themeId = SkylenseThemes.resolve(id).id;
      state.dark = SkylenseThemes.apply(themeId).dark;
      storage.set("theme", themeId);
      storage.set("dark", state.dark);
      render(); state.camera = camera; applyCamera();
      showThemes();
      $(`[data-action="choose-theme"][data-id="${themeId}"]`)?.focus();
    },
    connect: showConnect,
    "copy-command": async (value) => {
      try { await navigator.clipboard.writeText(value); toast("命令已复制。"); }
      catch { toast("浏览器未开放剪贴板，请选中命令复制。"); }
    },
    presentation: () => { $("#modal").close(); if (!state.present) actions.present(); },
    compare: (_, id) => compare(id),
    "show-compare": showCompare,
    "clear-compare": () => {
      state.compare = [];
      renderCompare();
    },
    "compare-jump": (_, id) => {
      $("#modal").close();
      select(id);
    },
    "toggle-sidebar": () => $("#sidebar").classList.toggle("open"),
    "toggle-inspector": () => $("#inspector").classList.toggle("open"),
    "close-inspector": () => $("#inspector").classList.remove("open"),
    "close-modal": () => $("#modal").close(),
    export: exportMenu,
    "export-json": () => {
      download("skylense-model.json", JSON.stringify(data, null, 2));
      toast("完整模型已导出。");
    },
    "export-svg": exportSVG,
    import: () => $("#import-file").click(),
    document: (_, id) => documentModal(id),
    "all-docs": () =>
      modal(
        "项目文档",
        `${(data.documents || []).map((d) => `<button class="connection" data-action="document" data-id="${escape(d.id)}">${icon("document")}<span>${escape(d.title)}<small>${escape(d.path)}</small></span>${icon("arrow")}</button>`).join("")}`,
      ),
    save: () =>
      modal(
        "保存当前阅读位置",
        `<p>保留当前模块、选择、关系筛选、路径与视口。${imported ? "导入模型的书签仅保留在当前会话。" : "视图保存在此浏览器本地。"}</p><label>视图名称<input id="view-name" maxlength="80" value="${escape((state.selected ? label(state.selected) : "系统总览") + " · " + (state.trace ? "路径" : "探索"))}"></label><div class="modal-actions"><button class="btn primary" data-action="confirm-save">保存视图</button></div>`,
      ),
    "confirm-save": () => {
      const name = $("#view-name").value.trim();
      if (!name) {
        toast("请填写视图名称。");
        return;
      }
      saved.push({ name, state: snapshotState() });
      if (!imported && !storage.set(viewStorageKey, saved))
        toast("浏览器无法持久保存；此会话仍可使用。");
      else toast(imported ? "视图已保存在当前会话。" : "视图已保存在本地。");
      $("#modal").close();
      renderSidebar();
    },
    "load-view": (_, id) => {
      const s = saved[Number(id)]?.state;
      if (!s) return;
      if (
        (s.selected && !all.has(s.selected)) ||
        (s.scope && !containers.has(s.scope))
      ) {
        toast("此视图属于另一个模型。");
        return;
      }
      Object.assign(state, s);
      if (s.trace?.kind === "path") state.trace = pathTrace(s.trace.plan, s.trace.choice);
      state.lens = ["scope", "neighbors", "global"].includes(s.lens)
        ? s.lens
        : "scope";
      state.present = s.present === true;
      state.openContainers = Array.isArray(s.openContainers)
        ? s.openContainers.filter((id) => containers.has(id))
        : [];
      state.bundle = s.bundle !== false;
      state.levelFocus = validLevelFocus(s.levelFocus);
      state.focusDimming = s.focusDimming !== false;
      state.categoryGroups = s.categoryGroups !== false;
      state.relation =
        s.relation &&
        s.relation.edgeIds?.every((id) => data.edges.some((e) => e.id === id))
          ? s.relation
          : null;
      state.lastRelation =
        s.lastRelation &&
        Array.isArray(s.lastRelation.edgeIds) &&
        s.lastRelation.edgeIds.every((id) =>
          data.edges.some((e) => e.id === id),
        )
          ? s.lastRelation
          : null;
      render();
      if (s.camera) {
        state.camera = { ...s.camera };
        applyCamera();
      }
    },
    "delete-view": (_, id) => {
      saved.splice(Number(id), 1);
      if (!imported) storage.set(viewStorageKey, saved);
      renderSidebar();
    },
    help: () =>
      modal(
        "探索快捷键",
        `<p><kbd>/</kbd> 搜索组件与函数<br><kbd>0</kbd> 适应画布<br><kbd>+</kbd> / <kbd>−</kbd> 缩放<br><kbd>R</kbd> 探索带必经点的关系路径<br><kbd>M</kbd> 暂停 / 开启连线流动<br><kbd>T</kbd> 选择工作空间主题<br><kbd>Esc</kbd> 关闭弹窗、预览或追踪<br><kbd>?</kbd> 打开帮助</p><p>单击节点固定详情；双击容器展开层级。悬停节点或连接可快速预览；「对照」将两个节点并排展示。</p><p>内置示例根据固定 commit 的公开源码整理，覆盖精选核心组件。关系、输入输出和章节是阅读视图；动态流动表示箭头方向，不是实际运行轨迹。</p>`,
      ),
  };
  let lastNodeClick = { id: null, time: 0 };
  document.addEventListener("click", (e) => {
    const button = e.target.closest("[data-action]");
    if (!button) return;
    if (
      button.classList.contains("graph-node") &&
      containers.has(button.dataset.id)
    ) {
      const id = button.dataset.id;
      if (lastNodeClick.id === id && e.timeStamp - lastNodeClick.time < 500) {
        lastNodeClick = { id: null, time: 0 };
        e.preventDefault();
        scope(id);
        return;
      }
      lastNodeClick = { id, time: e.timeStamp };
    }
    const action = actions[button.dataset.action];
    if (action) {
      e.preventDefault();
      action(button.dataset.value, button.dataset.id);
    }
  });
  document.addEventListener("dblclick", (e) => {
    const n = e.target.closest(".graph-node");
    if (n && containers.has(n.dataset.id)) scope(n.dataset.id);
  });
  document.addEventListener("input", (e) => {
    if (e.target.id === "search") {
      state.query = e.target.value;
      renderTree();
    }
  });
  document.addEventListener("change", (e) => {
    if (["source-folder-input", "source-files-input"].includes(e.target.id)) {
      const files = [...e.target.files];
      if (files.length) runSource("files", files);
      e.target.value = "";
      return;
    }
    if (e.target.closest("#path-builder")) { captureRoute(); invalidateRoute(); return; }
    if (e.target.id === "example-select") {
      const id = e.target.value;
      if (!Object.hasOwn(window.SKYLENSE_MODELS || {}, id)) return;
      const url = new URL(location.href);
      url.search = new URLSearchParams({ example: id }).toString();
      url.hash = "";
      location.assign(url.href);
      return;
    }
    if (e.target.id === "edge-filter") {
      state.type = e.target.value;
      if (
        state.relation &&
        selectedRelationEdges().some(
          (edge) => state.type !== "all" && edge.type !== state.type,
        )
      ) {
        state.relation = null;
        toast("当前关系已被类型筛选隐藏，已退出关系详情。");
        renderInspector();
      }
      if (state.trace?.kind === "relation") {
        const edges = filteredEdges().filter((edge) =>
          state.trace.edges.includes(edge.id),
        );
        state.trace = edges.length
          ? {
              kind: "relation",
              edges: edges.map((edge) => edge.id),
              nodes: [
                ...new Set(edges.flatMap((edge) => [edge.source, edge.target])),
              ],
            }
          : null;
      }
      if (state.trace?.kind === "path") {
        // The main filter narrows the route's own types without losing its stops.
        const plan = { ...state.trace.plan, types: state.type === "all" ? null : [state.type] };
        state.trace = pathTrace(plan, state.trace.choice);
        routeDraft = structuredClone(plan);
        if (state.trace.error) toast(pathError(state.trace.error));
      } else if (state.trace?.origins)
        state.trace = makeContextTrace(
          state.trace.origins,
          state.trace.direction,
        );
      else if (state.trace?.direction)
        state.trace = {
          ...AtlasGraph.reachable(
            filteredEdges(),
            state.trace.origin || state.selected,
            state.trace.direction,
          ),
          direction: state.trace.direction,
          origin: state.trace.origin || state.selected,
        };
      else if (state.trace?.start) {
        const { start, end } = state.trace;
        const route = AtlasGraph.shortestPath(filteredEdges(), start, end);
        state.trace = route ? { ...route, start, end } : null;
        if (!route) toast("当前关系类型没有这条路径，已退出追踪。");
      }
      renderCanvas(true);
      renderInspector();
      hash();
    }
  });
  $("#import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    cancelSourceJob();
    const serial = sourceSerial;
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error("JSON 文件超过 15 MB。");
      const parsed = JSON.parse(await file.text());
      if (serial !== sourceSerial) return;
      activateModel(parsed);
      $("#modal").close();
      toast(`已载入 ${data.nodes.length} 个组件，数据仅保留于当前浏览器会话。`);
    } catch (err) { toast("导入失败：" + err.message); }
    finally { e.target.value = ""; }
  });
  document.addEventListener("keydown", (e) => {
    if (e.target.closest(".source-tabs") && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const tabs = ["files", "url", "text"], current = tabs.indexOf(sourceTab);
      const next = e.key === "Home" ? 0 : e.key === "End" ? 2 : (current + (e.key === "ArrowRight" ? 1 : 2)) % 3;
      selectSourceTab(tabs[next]); $("#source-tab-" + tabs[next])?.focus(); return;
    }
    if (e.target.id === "source-url" && e.key === "Enter") { e.preventDefault(); actions["source-url"](); return; }
    if (
      e.target.matches("input,textarea,select") ||
      e.metaKey ||
      e.ctrlKey ||
      e.altKey
    )
      return;
    if ($("#modal").open && e.key !== "Escape") return;
    if ((e.key === "Enter" || e.key === " ") && e.target.matches(".edge-hit")) {
      e.preventDefault();
      actions.relation(null, e.target.dataset.id);
      return;
    }
    const key = e.key.toLowerCase();
    if (
      state.present &&
      state.mode === "flow" &&
      ["arrowright", "arrowleft"].includes(key)
    ) {
      e.preventDefault();
      actions[key === "arrowright" ? "next-step" : "prev-step"]();
    } else if (key === "/") {
      e.preventDefault();
      $("#sidebar").classList.add("open");
      $("#search").focus();
    } else if (key === "0") {
      fitCanvas();
    } else if (key === "+" || key === "=") {
      zoom(1.2);
    } else if (key === "-") {
      zoom(1 / 1.2);
    } else if (key === "r") {
      openRoute();
    } else if (key === "m") {
      actions.motion();
    } else if (key === "t") {
      actions.theme();
    } else if (key === "?") {
      actions.help();
    } else if (key === "escape") {
      hidePeek();
      if ($("#modal").open) $("#modal").close();
      else if (state.present) actions.present();
      else if (state.trace) actions["clear-trace"]();
      else {
        $("#inspector").classList.remove("open");
        $("#sidebar").classList.remove("open");
      }
    }
  });
  window.addEventListener("hashchange", () => {
    state.trace = null;
    readHash();
    render();
  });
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fitCanvas, 120);
  });
  render();
  queueMicrotask(initializeLocalSource);
  // Read-only inspection API used by local validation, without exposing mutable UI state.
  window.Atlas = Object.freeze({
    getState: () => JSON.parse(JSON.stringify(snapshotState())),
    getTheme: () => themeId,
    getIngestion: () => data.meta?.ingestion ? JSON.parse(JSON.stringify(data.meta.ingestion)) : null,
    getMotion: () => ({
      wanted: motionWanted,
      reduced: reducedMotion.matches,
      hidden: document.hidden,
      ...motion.stats(),
    }),
    getFocus: () => focusContext(),
    getLevels: () => ({
      ...levelSelection(),
      highlighted: highlightedLevels(),
    }),
    getCounts: () => ({
      nodes: data.nodes.length,
      edges: data.edges.length,
      containers: containers.size,
      functions: data.nodes.reduce((s, n) => s + (n.functions || []).length, 0),
    }),
    getVisible: () => layout.items.map((p) => p.n.id),
    getScene: () =>
      JSON.parse(
        JSON.stringify({
          items: layout.items.map((p) => ({
            id: p.n.id,
            x: p.x,
            y: p.y,
            w: p.w,
            h: p.h,
          })),
          bounds: layout.bounds,
          categoryBounds: layout.categoryBounds || [],
          relations: layout.relations.map((r) => ({
            id: r.id,
            edgeIds: r.edgeIds,
            sources: r.sources,
            targets: r.targets,
            type: r.type,
            label: r.label,
          })),
          wires: layout.wires.map((w) => ({
            relation: w.relation.id,
            from: w.from,
            to: w.to,
            edgeIds: wireMembers(w),
            points: w.points,
            blocked: w.blocked,
          })),
          hubs: layout.hubs.map((h) => ({
            id: h.id,
            x: h.x,
            y: h.y,
            w: h.w,
            h: h.h,
          })),
        }),
      ),
  });
})();
