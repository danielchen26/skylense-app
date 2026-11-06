/* Skylense — local, dependency-free hierarchical graph workspace. */
(function startSkylense() {
  "use strict";
  /* A single-file bundle (`skylense bundle`) carries one gzip-compressed model that is decoded
     before the workspace starts; every other page has its model synchronously and starts at once. */
  if (window.SKYLENSE_BUNDLE && !window.ATLAS_DATA) {
    const app = document.getElementById("app");
    app?.replaceChildren(Object.assign(document.createElement("p"), { className: "bundle-loading", textContent: "正在打开这个文件内嵌的模型…" }));
    window.SKYLENSE_BUNDLE.pending.then(() => {
      // A decoded value that is not a model object would otherwise re-enter this wait for ever.
      if (!window.ATLAS_DATA || typeof window.ATLAS_DATA !== "object") throw new Error("内嵌的数据不是一个模型对象");
      startSkylense();
    }).catch(error => {
      const hint = typeof DecompressionStream === "undefined"
        ? "请用支持 DecompressionStream 的新版浏览器（Chrome / Edge 80+、Firefox 113+、Safari 16.4+）打开。"
        : "这个文件可能被修改或损坏；请重新运行 skylense bundle 生成。";
      const box = Object.assign(document.createElement("div"), { className: "bundle-error", textContent: `无法打开这个文件内嵌的模型：${String(error?.message || error).replace(/[。.]\s*$/, "")}。${hint}` });
      box.setAttribute("role", "alert");
      app?.replaceChildren(box);
    });
    return;
  }
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
  /**
   * `src/view-state.js` owns the one URL schema: normalisation, the three membership
   * encodings and the total length budget. If that module is not loaded the application must
   * still open a usable view instead of blanking, so this identity-only fallback keeps
   * navigation working with literal membership, no references and no budget guarantee.
   */
  function fallbackViewSchema() {
    const MODES = ["hierarchy", "components", "flow"];
    const MEMBER_ROLES = ["relation", "relationParent", "relationTrace", "contextOrigins", "open"];
    const split = (value) => String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
    const read = (source, role) => {
      const raw = source.get(role);
      return { ids: raw == null ? [] : split(raw), token: null, encoding: raw == null ? "empty" : "ids", stale: false };
    };
    const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
    return {
      MODES,
      MEMBER_ROLES,
      HASH_LIMIT: 2048,
      useFacts() {},
      exportBundle: (view) => ({ format: "skylense-view", v: 0, snapshotId: view.snapshotId || null, view }),
      read(value) {
        const p = new URLSearchParams(String(value || "").replace(/^#/, ""));
        return {
          empty: p.size === 0,
          snapshotId: p.get("snapshotId") || p.get("revision") || null,
          scope: p.get("scope") || null,
          focus: p.get("focus") || null,
          modeParam: pick(p.get("mode"), MODES, null),
          mode: pick(p.get("mode"), MODES, p.get("flow") ? "flow" : "hierarchy"),
          lens: pick(p.get("lens"), ["scope", "neighbors", "global"], "scope"),
          tab: p.get("tab") || "overview",
          type: p.get("type") || "all",
          flow: p.get("flow") || null,
          step: Math.max(0, Number(p.get("step")) || 0),
          present: p.get("present") === "1",
          level: p.get("level") || "auto",
          dimming: p.get("dim") !== "off",
          categories: p.get("categories") !== "off",
          bundle: p.get("bundle") !== "off",
          candidates: p.get("candidates") === "show" ? true : p.get("candidates") === "hide" ? false : null,
          edge: p.get("edge") || null,
          relationGroup: p.get("group") || null,
          relationView: p.get("relationView") || null,
          reach: pick(p.get("reach"), ["upstream", "downstream"], null),
          origin: p.get("origin") || null,
          contextReach: pick(p.get("contextReach"), ["upstream", "downstream"], null),
          from: p.get("from") || null,
          to: p.get("to") || null,
          route: p.get("route") === "1",
          via: split(p.get("via")),
          pathDir: p.get("pathDir") || "downstream",
          pathTypes: p.get("pathTypes") === "*" ? null : split(p.get("pathTypes")),
          pathHops: p.has("pathHops") ? Number(p.get("pathHops")) : 24,
          pathChoice: p.get("pathChoice") || null,
          relation: read(p, "relation"),
          relationParent: read(p, "relationParent"),
          relationTrace: read(p, "relationTrace"),
          contextOrigins: read(p, "contextOrigins"),
          open: read(p, "open"),
          issues: [],
        };
      },
      serialize(view) {
        const p = new URLSearchParams();
        p.set("scope", view.scope || "system");
        p.set("focus", view.focus || "");
        p.set("mode", pick(view.mode, MODES, "hierarchy"));
        if (view.snapshotId) p.set("snapshotId", view.snapshotId);
        if (view.lens && view.lens !== "scope") p.set("lens", view.lens);
        if (view.present) p.set("present", "1");
        if (view.level && view.level !== "auto") p.set("level", String(view.level));
        if (!view.dimming) p.set("dim", "off");
        if (!view.categories) p.set("categories", "off");
        if (view.flow) p.set("flow", view.flow);
        if (view.step) p.set("step", String(view.step));
        if (view.tab && view.tab !== "overview") p.set("tab", view.tab);
        if (view.relationGroup) p.set("group", view.relationGroup);
        if (view.trace?.origins) {
          p.set("contextReach", view.trace.direction);
          p.set("contextOrigins", view.trace.origins.join(","));
        }
        if (view.trace?.direction && !view.trace.origins && view.trace.kind !== "path") {
          p.set("reach", view.trace.direction);
          p.set("origin", view.trace.origin || view.focus || "");
        }
        if (view.trace?.kind === "relation") {
          p.set("relationView", "detail");
          p.set("relationTrace", view.trace.edges.join(","));
        }
        if (view.trace?.start) {
          p.set("from", view.trace.start);
          p.set("to", view.trace.end);
        }
        if (view.trace?.kind === "path" && view.trace.plan) {
          const route = view.trace.plan;
          p.set("route", "1");
          p.set("via", route.stops.slice(1, -1).join(","));
          p.set("pathDir", route.direction);
          p.set("pathTypes", route.types === null ? "*" : route.types.join(","));
          p.set("pathHops", String(route.maxHops));
          if (view.trace.choice) p.set("pathChoice", view.trace.choice);
        }
        p.set("type", view.type || "all");
        p.set("open", (view.open || []).join(","));
        if (!view.bundle) p.set("bundle", "off");
        if (view.candidates === true) p.set("candidates", "show");
        else if (view.candidates === false) p.set("candidates", "hide");
        if (view.relation) {
          p.set("relation", view.relation.edgeIds.join(","));
          if (view.relation.parentEdgeIds) p.set("relationParent", view.relation.parentEdgeIds.join(","));
        }
        return { hash: p.toString(), state: view, encodings: {}, reference: null, persisted: null, membership: null };
      },
    };
  }
  const ViewState = typeof SkylenseViewState !== "undefined" ? SkylenseViewState : fallbackViewSchema();
  const Hypergraph = typeof SkylenseHypergraph !== "undefined" ? SkylenseHypergraph : null;
  /* A bundled model is arbitrary analysed content, not a curated snapshot: it passes the same
     admission gate as a model imported in the browser, so readiness and trust are recomputed
     here rather than read from the file, and it is shown as the current analysis. */
  const bundled = Boolean(window.SKYLENSE_BUNDLE);
  let data = window.ATLAS_DATA;
  AtlasGraph.validate(data);
  if (bundled) window.SkylenseModelMigrations?.admitModel(data, { origin: "bundled-model" });
  let graphIndex, nodes,
    containers,
    all,
    groupMap,
    imported = bundled;
  const generated = () => Boolean(data.meta?.ingestion);
  let sourceJob = null, sourceSerial = 0, sourcePreview = null;
  let sourceTab = "files";
  let guideOrigin = null, guideBrowse = "context";
  const guideInfoCache = new Map();
  let guideTreeCounts = new Map();
  let groupIndex = null;
  /* Evidence is addressed by ID across claims, relations and groups. The UI must be able to
     resolve an ID to its real record — excerpt, span, source file — and say so plainly when it
     cannot; a bare opaque ID is an explicit D10 acceptance failure. */
  let evidenceIndex = null, sourceFileIndex = null, claimIndex = null;
  /** The reading position recorded when the evidence viewer was opened, for an exact return. */
  let evidenceOrigin = null;
  function index() {
    // An untrusted authored layer is shown through its derived-only view (see displayModel).
    data = displayModel(data);
    restoreStoredReviews();
    guideInfoCache.clear();
    graphIndex = AtlasGraph.index(data);
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
    groupIndex = null;
    evidenceIndex = null;
    sourceFileIndex = null;
    claimIndex = null;
    candidateIds = candidateRelations();
    // Recipes are recomputed against these canonical edges; the digest verifies the result.
    ViewState.useFacts(data);
  }
  /**
   * Unproven relations — resolution `candidate`: lexical, conditional, dispatch and call
   * candidates — are hidden from the map until the reader asks for them, and every view that
   * hides them says how many. The proof state is the Analysis IR relation that shares the edge
   * ID; an edge without one is classified by the same mapper the admission gate uses. Curated,
   * legacy, external and resolved relations are never candidates.
   */
  let candidateIds = new Set();
  function candidateRelations() {
    const proven = new Map((data.analysis?.relations || []).map((relation) => [relation.id, relation.resolution]));
    const mapResolution = window.SkylenseModelMigrations?.mapResolution;
    return new Set(
      data.edges
        .filter((edge) => (proven.get(edge.id) ?? mapResolution?.(edge).resolution) === "candidate")
        .map((edge) => edge.id),
    );
  }
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
  /* Human review of claims. Only a person, through the confirm dialog of the claims tab, records
     a disposition; it is kept in local storage per model and analysed source, and put back on
     every load only while the claim's text and cited evidence are unchanged. A check that no
     longer applies is recorded as 已失效 and the claim returns to proposed. */
  const Claims = () => window.SkylenseClaims || null;
  function reviewStorageKey() {
    return `reviews:${data.meta?.id || "import"}:${data.analysis?.snapshot?.origin?.label}`;
  }
  function storedReviews() {
    const stored = storage.get(reviewStorageKey(), {});
    return isRecord(stored) ? stored : {};
  }
  /** A bundled or frozen model is reviewed on a copy of its claim list, never in place. */
  function reviewableAnalysis() {
    const analysis = data.analysis;
    if (!isRecord(analysis)) return null;
    if (Object.isFrozen(analysis) || Object.isFrozen(analysis.claims || [])) {
      if (Object.isFrozen(data)) return null;
      data.analysis = { ...analysis, claims: [...listOf(analysis.claims)] };
    }
    return data.analysis;
  }
  function recomputeReadiness() {
    if (Claims() && isRecord(data.analysis)) data.analysis.readiness = Claims().readinessOf(factsModel(), data.analysis);
  }
  function restoreStoredReviews() {
    if (!Claims() || !isRecord(data.analysis)) return;
    const stored = storedReviews();
    const entries = Object.entries(stored).filter(([, entry]) => isRecord(entry) && isRecord(entry.reviewedBy));
    if (!entries.length || !reviewableAnalysis()) return;
    let invalidated = false;
    for (const [claimId, entry] of entries) {
      let result;
      try { result = Claims().restoreReview(data, entry.reviewedBy, claimId); } catch { continue; }
      if (result.restored) continue;
      entry.history = [...listOf(entry.history), { event: "invalidated", reasonCode: result.reasonCode, at: new Date().toISOString() }];
      delete entry.reviewedBy;
      invalidated = true;
    }
    if (invalidated) storage.set(reviewStorageKey(), stored);
    recomputeReadiness();
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
    /** Candidate relations are drawn only after an explicit reveal (or a view that selects them). */
    showCandidates: false,
    lens: "scope",
    present: false,
    levelFocus: "auto",
    focusDimming: true,
    categoryGroups: true,
    relationGroup: null,
    viewRecovery: null,
    unresolved: null,
  };
  let routeDraft = null, routeResult = null;
  const cameraCache = new Map();
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
  function descendants(id) { return graphIndex.getMembers(id).map(id => nodes.get(id)); }
  function members(id) { return graphIndex.getMembers(id); }
  function incident(id) { const result = graphIndex.boundary(id, "all"); return Object.fromEntries(Object.entries(result).map(([key, ids]) => [key, ids.map(id => graphIndex.edges.get(id))])); }
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
  const modelSnapshotId = () => data.analysis?.snapshotId || data.meta?.revision || null;
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
      /* The Explorer tree shape and the active search belong to the reading position, not to
         decoration: a return that rebuilds them from the drilled-down state is an
         approximation, and D06 requires the exact previous position back. */
      expanded: [...state.expanded],
      query: state.query,
      relation: state.relation,
      relationGroup: state.relationGroup,
      lastRelation: state.lastRelation,
      bundle: state.bundle,
      showCandidates: state.showCandidates,
      viewRecovery: state.viewRecovery,
      snapshotId: modelSnapshotId(),
    };
  }
  /** The whole reading position in the shared ViewState schema. One producer, one consumer. */
  function currentView() {
    return {
      snapshotId: modelSnapshotId(),
      scope: state.scope,
      focus: state.selected,
      mode: state.mode,
      lens: state.lens,
      tab: state.tab,
      type: state.type,
      flow: state.flow,
      step: state.step,
      open: state.openContainers,
      present: state.present,
      level: state.levelFocus,
      dimming: state.focusDimming,
      categories: state.categoryGroups,
      bundle: state.bundle,
      // Hidden is the default and writes nothing, unless this view would infer a reveal.
      candidates: state.showCandidates ? true : viewInfersReveal() ? false : null,
      relation: state.relation,
      relationGroup: state.relationGroup?.id || null,
      trace: state.trace,
      unresolved: state.unresolved,
      camera: state.camera,
    };
  }
  let persistWarned = null;
  /**
   * The only URL writer. Back/forward, guide exit, saving and refreshing all land here, so the
   * generated hash always respects the ViewState budget with complete, recoverable membership.
   */
  function hash() {
    let written;
    try {
      written = ViewState.serialize(currentView());
    } catch (error) {
      toast("无法生成可分享链接：" + error.message);
      return null;
    }
    // A registry reference that could not be persisted keeps working in memory; say so once
    // instead of silently promising a view that a reload cannot reopen.
    if (written.reference && written.persisted === false && persistWarned !== written.reference) {
      persistWarned = written.reference;
      state.viewRecovery = {
        reason: "not-persisted",
        stale: true,
        relationRef: written.reference,
        snapshotId: written.state.snapshotId,
        members: state.relation?.edgeIds.length || 0,
      };
      renderRecovery();
      toast("浏览器拒绝保存此视图；当前选择仍然有效，可导出可移植视图文件。");
    } else if (written.reference && written.persisted) persistWarned = null;
    try {
      history.replaceState(null, "", "#" + written.hash);
    } catch {}
    return written;
  }
  /**
   * The hash is untrusted input. ViewState normalises and validates it first; binding the
   * result to this model can never abort initialisation, so an unknown, partial or legacy
   * parameter combination degrades to a usable view plus an explicit recoverable state.
   * Returns true when the hash requested a view (applied, or reported as unrecoverable), so
   * the first-run landing never overrides a link the reader followed.
   */
  function readHash() {
    let view = null;
    try {
      view = ViewState.read(location.hash);
    } catch (error) {
      state.viewRecovery = { reason: "unreadable-view", stale: true, detail: String(error?.message || error) };
      return true;
    }
    try {
      return applyView(view);
    } catch (error) {
      // A usable view is always better than a blank application.
      state.trace = null;
      state.relation = null;
      state.relationGroup = null;
      state.viewRecovery = {
        reason: "unreadable-view",
        stale: true,
        snapshotId: view.snapshotId || null,
        detail: String(error?.message || error),
        issues: [{ role: "view", reason: "unreadable-view" }],
      };
    }
    return true;
  }
  function applyView(view) {
    if (view.empty) return false;
    // Old example links must not suppress the new model defaults.
    if (view.scope && view.scope !== "system" && !containers.has(view.scope)) return false;
    const currentSnapshot = modelSnapshotId();
    // A selection is bound to the facts it was made against; it is never reinterpreted silently.
    const snapshotMismatch = Boolean(view.snapshotId && currentSnapshot && view.snapshotId !== currentSnapshot);
    state.trace = null;
    state.lastRelation = null;
    state.relationGroup = null;
    state.viewRecovery = null;
    state.unresolved = null;
    state.levelFocus = validLevelFocus(view.level);
    state.focusDimming = view.dimming;
    state.categoryGroups = view.categories;
    state.lens = view.lens;
    state.present = view.present;
    state.tab = view.tab;
    if (view.open.encoding !== "empty")
      state.openContainers = view.open.ids.filter((id) => containers.has(id));
    state.bundle = view.bundle;
    const edgeIds = new Set(data.edges.map((e) => e.id));
    const known = (ids) => ids.filter((id) => edgeIds.has(id));
    const selectedEdges = known(view.relation.ids);
    const parentEdges = known(view.relationParent.ids);
    const droppedMembers =
      selectedEdges.length !== view.relation.ids.length ||
      parentEdges.length !== view.relationParent.ids.length;
    state.relation =
      !snapshotMismatch && selectedEdges.length
        ? { edgeIds: selectedEdges, parentEdgeIds: parentEdges.length ? parentEdges : null }
        : null;
    state.relationGroup =
      !snapshotMismatch && view.relationGroup ? groupById(view.relationGroup) || null : null;
    state.scope = containers.has(view.scope) ? view.scope : null;
    state.selected = all.has(view.focus) ? view.focus : null;
    state.mode = ViewState.MODES.includes(view.modeParam) ? view.modeParam : "hierarchy";
    state.flow = (data.flows || []).some((f) => f.id === view.flow) ? view.flow : null;
    if (state.mode === "flow" && !state.flow) state.mode = "hierarchy";
    state.type = ["all", ...new Set(data.edges.map((e) => e.type))].includes(view.type)
      ? view.type
      : "all";
    /* An explicit `candidates` parameter wins. A link written before the parameter existed
       keeps showing what it names: a selection, trace or type filter made of candidates
       reveals them, so no old link opens onto an empty selection. */
    const namesCandidates =
      [...view.relation.ids, ...view.relationTrace.ids].some((id) => candidateIds.has(id)) ||
      candidateOnlyType(state.type);
    state.showCandidates = typeof view.candidates === "boolean" ? view.candidates : namesCandidates;
    state.step = view.step;
    const restoredFlow = state.mode === "flow" ? currentFlow() : null;
    if (restoredFlow) {
      const selectedStep = restoredFlow.nodes.indexOf(state.selected);
      state.step = selectedStep >= 0 ? selectedStep : Math.max(0, Math.min(restoredFlow.nodes.length - 1, Number.isInteger(state.step) ? state.step : 0));
      if (!state.relation) state.selected = restoredFlow.nodes[state.step];
      if (isSourceGuide(restoredFlow) && !state.scope) state.scope = guideInfo(restoredFlow).containerId;
    }
    if (view.relationView === "detail" && !snapshotMismatch) {
      // Without a redundant trace parameter the detail view falls back to the decoded selection.
      const traceIds = known(
        view.relationTrace.encoding === "empty" ? state.relation?.edgeIds || [] : view.relationTrace.ids,
      );
      const edges = data.edges.filter((e) => traceIds.includes(e.id));
      if (edges.length)
        state.trace = {
          kind: "relation",
          edges: edges.map((e) => e.id),
          nodes: [...new Set(edges.flatMap((e) => [e.source, e.target]))],
        };
    }
    if (view.reach && nodes.has(state.selected))
      state.trace = {
        ...AtlasGraph.reachable(
          filteredEdges(),
          nodes.has(view.origin) ? view.origin : state.selected,
          view.reach,
        ),
        direction: view.reach,
        origin: nodes.has(view.origin) ? view.origin : state.selected,
      };
    if (view.contextReach) {
      const origins = view.contextOrigins.ids.filter((id) => nodes.has(id));
      if (origins.length) state.trace = makeContextTrace(origins, view.contextReach);
    }
    if (nodes.has(view.from) && nodes.has(view.to)) {
      const plan = {
        stops: [view.from, ...view.via, view.to],
        direction: view.pathDir,
        types: view.route ? view.pathTypes : state.type === "all" ? null : [state.type],
        maxHops: view.pathHops,
      };
      state.trace = pathTrace(plan, view.pathChoice);
      if (!state.relation && !all.has(state.selected)) state.selected = plan.stops[0];
      // A route can be inspected through the global/neighbor lenses and through
      // a selected relation. Restoring it must preserve that reading context.
      if (!view.route) {
        state.mode = "components"; state.scope = null; state.lens = "scope";
      } else if (!["hierarchy", "components"].includes(view.modeParam)) {
        state.mode = "components";
      }
      state.flow = null;
    }
    /* A restored path drawn through candidates, or a reach / context trace that candidates
       would extend, shows them unless the link said otherwise: such a link was written while
       every relation was drawn, and must not reopen narrower than it was. */
    if (typeof view.candidates !== "boolean" && traceCandidates(state.trace) > 0) {
      state.showCandidates = true;
      state.trace = refilteredReach(state.trace);
    }
    recordRecovery(view, { snapshotMismatch, droppedMembers });
    return true;
  }
  /** Keep unresolved references in the URL and say why the saved view could not be restored. */
  function recordRecovery(view, { snapshotMismatch, droppedMembers }) {
    const issues = view.issues.map((issue) => ({
      role: issue.role || null,
      reason: issue.reason,
      token: issue.token || null,
    }));
    if (snapshotMismatch)
      issues.unshift({ role: "snapshot", reason: "snapshotMismatch", token: view.snapshotId });
    if (droppedMembers) issues.push({ role: "relation", reason: "missing-members", token: null });
    const unresolved = {};
    for (const role of ViewState.MEMBER_ROLES) {
      const part = view[role];
      if (part?.stale && part.token) unresolved[role] = part.token;
    }
    state.unresolved = Object.keys(unresolved).length ? unresolved : null;
    state.viewRecovery = issues.length
      ? {
          reason: issues[0].reason,
          stale: true,
          snapshotId: view.snapshotId || null,
          currentSnapshotId: modelSnapshotId(),
          relationRef: unresolved.relation || null,
          issues,
        }
      : null;
  }
  /** The relation filter: the chosen type, minus unproven candidates unless they were revealed. */
  function edgeVisible(e) {
    return (state.type === "all" || e.type === state.type) && (state.showCandidates || !candidateIds.has(e.id));
  }
  /** The filter handed to the graph/context/focus modules: a type string, or the predicate. */
  function relationFilter() {
    return state.showCandidates || !candidateIds.size ? state.type : edgeVisible;
  }
  function filteredEdges() {
    return state.type === "all" && (state.showCandidates || !candidateIds.size)
      ? data.edges
      : data.edges.filter(edgeVisible);
  }
  /** Candidates the current relation filter keeps off the map, per relation type. */
  function hiddenCandidates() {
    const byType = {};
    let total = 0;
    if (!state.showCandidates)
      for (const e of data.edges)
        if (candidateIds.has(e.id) && (state.type === "all" || e.type === state.type)) {
          byType[e.type] = (byType[e.type] || 0) + 1;
          total++;
        }
    return { total, byType };
  }
  /** A relation type made only of candidates: filtering to it is asking to see them. */
  function candidateOnlyType(type) {
    return type !== "all" && candidateIds.size > 0 && data.edges.some((e) => e.type === type) &&
      data.edges.every((e) => e.type !== type || candidateIds.has(e.id));
  }
  const traceCandidateCounts = new WeakMap();
  /**
   * How many candidate relations a trace leaves out while candidates are hidden. A path or
   * relation trace names its edges, so it is the candidates among them; a reach or context
   * trace was computed without candidates, so it is the candidate edges the same reach takes
   * when they are included — what it would add, counted instead of silently missing.
   */
  function traceCandidates(trace) {
    if (!trace || state.showCandidates || !candidateIds.size) return 0;
    if (traceCandidateCounts.has(trace)) return traceCandidateCounts.get(trace);
    const typed = state.type === "all" ? data.edges : data.edges.filter((e) => e.type === state.type);
    let ids = trace.edges || [];
    if (trace.origins) {
      const found = new Set();
      for (const origin of trace.origins)
        AtlasGraph.reachable(typed, origin, trace.direction).edges.forEach((id) => found.add(id));
      ids = [...found];
    } else if (trace.direction && trace.kind !== "path" && trace.origin)
      ids = AtlasGraph.reachable(typed, trace.origin, trace.direction).edges;
    const isTyped = (id) => state.type === "all" || graphIndex.edges.get(id)?.type === state.type;
    const count = ids.filter((id) => candidateIds.has(id) && isTyped(id)).length;
    traceCandidateCounts.set(trace, count);
    return count;
  }
  /** The same reach / context trace, recomputed through the current relation filter. */
  function refilteredReach(trace) {
    if (trace?.origins) return makeContextTrace(trace.origins, trace.direction);
    if (trace?.direction && trace.kind !== "path" && trace.origin)
      return { ...AtlasGraph.reachable(filteredEdges(), trace.origin, trace.direction), direction: trace.direction, origin: trace.origin };
    return trace;
  }
  /**
   * Would a link to this view, read without a `candidates` parameter, reveal candidates by
   * inference (see applyView)? Then a hidden state has to be written explicitly, or the link
   * would not reopen what the reader saw.
   */
  function viewInfersReveal() {
    return (state.relation?.edgeIds || []).some((id) => candidateIds.has(id)) ||
      candidateOnlyType(state.type) || traceCandidates(state.trace) > 0;
  }
  const bootViewRequested = readHash();
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
      type: relationFilter(),
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
  /**
   * The only reader of a stored reading position. Every return path — inspector back, guide
   * exit, evidence return, saved view — lands here, so a restored position is the recorded one
   * and never a reconstruction from whatever the drilldown left behind.
   */
  function restoreReading(view) {
    if (!view) return;
    const restored = JSON.parse(JSON.stringify(view));
    Object.assign(state, restored, {
      expanded: new Set((restored.expanded || []).filter((id) => all.has(id))),
      query: typeof restored.query === "string" ? restored.query : "",
    });
    state.lastRelation = null;
    render();
    if (restored.camera) {
      state.camera = { ...restored.camera };
      applyCamera();
    }
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
    const c = $("#canvas");
    state.camera = readingCamera(p, c.clientWidth, c.clientHeight, state.camera.z);
    applyCamera();
  }
  /** The camera that centres the item being read, at no less than 85% zoom. */
  function readingCamera(p, viewWidth, viewHeight, zoom) {
    const z = Math.max(0.85, zoom);
    return {
      z,
      x: viewWidth / 2 - (p.x + p.w / 2) * z,
      y: viewHeight / 2 - (p.y + p.h / 2) * z,
    };
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
  /** Analysis evidence records by ID; built once per model, cleared by `index()`. */
  function evidenceRecord(id) {
    if (!evidenceIndex)
      evidenceIndex = new Map((data.analysis?.evidence || []).map((item) => [item.id, item]));
    return evidenceIndex.get(id) || null;
  }
  /** Snapshot file for an evidence `fileId`, which may be a stored file ID or its path. */
  function evidenceSourceFile(record) {
    if (!sourceFileIndex) {
      sourceFileIndex = new Map();
      for (const file of data.analysis?.snapshot?.files || []) {
        sourceFileIndex.set(file.id, file);
        sourceFileIndex.set(file.path, file);
      }
    }
    return (record?.fileId && sourceFileIndex.get(record.fileId)) || null;
  }
  function evidenceSourcePath(record) {
    return evidenceSourceFile(record)?.path || record?.fileId || null;
  }
  /** The real span, or null: a record without line numbers must not be shown as if it had one. */
  function evidenceSpanLabel(record) {
    const range = record?.range;
    if (!range || !Number.isInteger(range.startLine)) return null;
    const end = Number.isInteger(range.endLine) ? range.endLine : range.startLine;
    return range.startLine === end ? `第 ${range.startLine} 行` : `第 ${range.startLine}–${end} 行`;
  }
  function evidenceKindLabel(record) {
    return {
      "source-span": "源码区间 · 读取全文后定位",
      "legacy-excerpt": "旧模型摘录 · 位置为声明值，未核验",
      derived: "统计推导 · 不引用文件原文",
    }[record?.kind] || record?.kind || "未标注类型";
  }
  /** The node whose path matches this evidence, so the reader can enter the structure from it. */
  function evidenceSubject(record) {
    const path = evidenceSourcePath(record);
    if (!path) return null;
    return data.nodes.find((n) => n.path === path && n.sourceRole !== "symbol")
      || data.nodes.find((n) => n.path === path)
      || null;
  }
  /**
   * One clickable citation for an evidence ID. Resolvable or not, it opens the viewer: an
   * unresolvable ID must explain itself, and an ID rendered as plain text fails D10.
   */
  function evidenceChip(id) {
    const record = evidenceRecord(id);
    const path = evidenceSourcePath(record), span = evidenceSpanLabel(record);
    const detail = record
      ? [path, span].filter(Boolean).join(" · ") || evidenceKindLabel(record)
      : "当前快照找不到这条依据";
    return `<button class="evidence-chip${record ? "" : " unresolved"}" data-action="evidence" data-id="${escape(id)}" title="${escape(id)}">${icon(record ? "code" : "info")}<span>${escape(detail)}</span><small>${escape(id)}</small></button>`;
  }
  function evidenceChips(ids, empty) {
    return ids.length
      ? `<div class="evidence-citations">${ids.map(evidenceChip).join("")}</div>`
      : `<p class="micro">${escape(empty)}</p>`;
  }
  /* The authored layer (docs/AUTHORING.md §Projection, §meta.authoring). It is rendered from the
     projected fields and `meta.authoring` exactly as written: grades, citations and step
     resolutions are read, never recomputed here. Every authored sentence carries its grade and
     its cited spans, so agent interpretation is never mistaken for a parsed fact. */
  /* Declarations, not arrow constants: readHash() and index() consult these before this point
     executes. `meta.authoring` comes from a file. Its shape is checked once per model; a layer
     that fails the check (AUTHORING.md §Projection) is not trusted by any surface: index()
     swaps in a view where every projected field shows its stored derived value, authored
     regions and scenarios are marked as agent-made, and one line says why. */
  var authoringChecks, untrustedViews;
  function isRecord(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
  function listOf(value) { return Array.isArray(value) ? value : []; }
  function recordsOf(value) { return listOf(value).filter(isRecord); }
  function textOf(value) { return typeof value === "string" ? value : ""; }
  function authoringProblem(a, model) {
    if (!isRecord(a)) return "meta.authoring 不是对象";
    const optional = (value, test) => value === undefined || value === null || test(value);
    for (const key of ["brief", "coverage", "verdicts", "gradeVocabulary", "regionPlan", "scope", "host", "accepted"])
      if (!optional(a[key], isRecord)) return `meta.authoring.${key} 不是对象`;
    for (const key of ["regions", "startHere", "entrypoints", "rejected", "objects", "regionRelations", "scenarios"])
      if (!optional(a[key], Array.isArray)) return `meta.authoring.${key} 不是数组`;
    for (const key of ["capabilities", "inputs", "outputs", "boundary"])
      if (!optional(a.brief?.[key], Array.isArray)) return `meta.authoring.brief.${key} 不是数组`;
    if (!optional(a.brief?.purpose, isRecord)) return "meta.authoring.brief.purpose 不是对象";
    for (const key of ["claims", "obligations", "files", "keyObjects"])
      if (!optional(a.coverage?.[key], isRecord)) return `meta.authoring.coverage.${key} 不是对象`;
    if (!optional(a.coverage?.skipped, Array.isArray)) return "meta.authoring.coverage.skipped 不是数组";
    if (!optional(a.regionPlan?.dissolved, Array.isArray)) return "meta.authoring.regionPlan.dissolved 不是数组";
    if (!optional(a.scope?.coreFiles, Array.isArray)) return "meta.authoring.scope.coreFiles 不是数组";
    // Every projected `interpretation` names the claim behind each field; without `fields`
    // (e.g. a model projected before fields existed) no field can be graded.
    for (const item of [model?.meta, ...listOf(model?.hierarchy), ...listOf(model?.nodes), ...listOf(model?.edges), ...listOf(model?.flows)])
      if (isRecord(item) && Object.hasOwn(item, "interpretation") && !(isRecord(item.interpretation) && isRecord(item.interpretation.fields)))
        return `${item === model.meta ? "meta" : textOf(item.id) || "?"} 的 interpretation 缺少 fields`;
    return null;
  }
  /**
   * The model the workbench shows. A trusted layer written in Chinese is shown through a view
   * whose derived parser text is in Chinese (src/derived-text.js); the stored text stays in the
   * model and under each item's `derivedText`. An absent layer is shown as stored. An untrusted
   * one is shown through a copy holding only derived text: summary/description/evidenceNote
   * take their stored derived values, text that has none (region descriptions, interfaces,
   * scenario descriptions and step reasons, the reading guides) is removed, and every
   * `interpretation` is dropped. The stored model itself is kept for export.
   */
  var localizedViews;
  function displayModel(model) {
    untrustedViews ||= new WeakMap();
    localizedViews ||= new WeakMap();
    if (untrustedViews.has(model) || localizedViews.has(model) || model?.meta?.authoring === undefined || model.meta.authoring === null) return model;
    const problem = authoringProblem(model.meta.authoring, model);
    if (!problem) {
      const localize = window.SkylenseDerivedText?.localizeModel;
      const view = localize ? localize(model) : model;
      if (view === model) return model;
      if (Object.isFrozen(model)) Object.freeze(view);
      localizedViews.set(view, model);
      return view;
    }
    const view = structuredClone(model);
    const revert = (item, field, derived) => {
      if (!Object.hasOwn(item, derived)) return;
      if (typeof item[derived] === "string" && item[derived]) item[field] = item[derived];
      else delete item[field];
    };
    const regionIds = new Set();
    for (const item of [...recordsOf(view.hierarchy), ...recordsOf(view.nodes)]) {
      revert(item, "summary", "derivedSummary");
      revert(item, "description", "derivedDescription");
      if (Object.hasOwn(item, "interpretation")) { delete item.interface; delete item.authoredInputs; delete item.authoredOutputs; }
      if (item.sourceRole === "authored-region") { regionIds.add(item.id); delete item.description; delete item.evidence; }
      delete item.interpretation;
    }
    for (const group of recordsOf(view.groups)) if (regionIds.has(group.id)) delete group.description;
    for (const edge of recordsOf(view.edges)) { revert(edge, "description", "derivedDescription"); delete edge.interpretation; }
    for (const flow of recordsOf(view.flows)) {
      if (flow.kind !== "authored-scenario") continue;
      delete flow.description;
      delete flow.interpretation;
      if (Array.isArray(flow.steps)) flow.steps = flow.steps.map((step) => (isRecord(step) ? { ...step, reason: null, claimIds: [], evidenceIds: [] } : step));
    }
    if (isRecord(view.meta)) {
      revert(view.meta, "description", "derivedDescription");
      revert(view.meta, "evidenceNote", "derivedEvidenceNote");
      delete view.meta.interpretation;
    }
    view.documents = listOf(view.documents).filter((doc) => !isGuideId(doc?.id));
    untrustedViews.set(view, { problem, source: model });
    return view;
  }
  /** The model as stored (what export writes), for the model currently shown. A Chinese view
   *  shares the stored analysis; a review that had to copy a frozen claim list is carried over. */
  function storedModel() {
    const source = localizedViews?.get(data);
    if (source) return source.analysis === data.analysis ? source : { ...source, analysis: data.analysis };
    return untrustedViews?.get(data)?.source || data;
  }
  /** The model whose texts capability and review checks read: the shown model, except that a
   *  Chinese view of parser text is presentation only and never feeds a capability row. */
  function factsModel() {
    return localizedViews?.has(data) ? storedModel() : data;
  }
  /** Id of the agent reading guide of one scenario (docs/AUTHORING.md § Projection). */
  function isGuideId(id) {
    return typeof id === "string" && id.startsWith("auth_guide_");
  }
  /** Why this model's authored layer is not trusted, or null (no layer, or a well-formed one). */
  function authoringNotice() {
    const a = data.meta?.authoring;
    if (a === undefined || a === null) return null;
    if (untrustedViews?.has(data)) return untrustedViews.get(data).problem;
    authoringChecks ||= new WeakMap();
    if (!authoringChecks.has(data)) authoringChecks.set(data, authoringProblem(a, data));
    return authoringChecks.get(data);
  }
  function authoring() {
    return data.meta?.authoring && !authoringNotice() ? data.meta.authoring : null;
  }
  /** Whether the shown model carries an authored layer at all, trusted or not. */
  function hasAuthoringLayer() {
    return data.meta?.authoring !== undefined && data.meta?.authoring !== null;
  }
  /** Agent-made names are not claims and are never graded: a neutral chip marks them. In an
   *  untrusted layer the chip says what the agent made (a region split or a scenario). */
  function nameMarkText(item) {
    if (!hasAuthoringLayer()) return "";
    const region = item?.sourceRole === "authored-region", scenario = item?.kind === "authored-scenario";
    if (!region && !scenario) return "";
    return authoring() ? "代理命名" : region ? "代理划分" : "代理场景";
  }
  function nameChip(item) {
    const text = nameMarkText(item);
    if (!text) return "";
    const title = authoring() ? "名称由作者宿主拟定，不是解析得到的事实，也不经核验。" : "这部分由作者宿主划分或编排；它的解读层格式不正确，解读文字没有显示。";
    return `<span class="name-chip" title="${title}">${text}</span>`;
  }
  /** An authored short role label: an object's `roleLabel` or an edge's `authoredRelation.label`.
   *  Like region and scenario names it is chosen by the author host, not a claim, never graded,
   *  and shown only while the authored layer is trusted. */
  function authoredLabelOf(item) {
    if (!authoring()) return "";
    return textOf(isRecord(item?.authoredRelation) ? item.authoredRelation.label : item?.roleLabel).trim();
  }
  function roleChip(item) {
    const text = authoredLabelOf(item);
    if (!text) return "";
    const note = isRecord(item?.authoredRelation) ? textOf(item.authoredRelation.note).trim() : "";
    return `<i class="role-label" title="作用标签由作者宿主拟定，不是解析得到的事实，也不经核验。">代理命名 · ${escape(text)}${note ? `<small>${escape(note)}</small>` : ""}</i>`;
  }
  /** A declaration's own docstring, kept aside by the Chinese view of parser text: quoted source. */
  function sourceDocstringBlock(n) {
    return textOf(n?.sourceDocstring) ? `<p class="derived-line"><span>源码文档字符串（原文）</span>${escape(n.sourceDocstring)}</p>` : "";
  }
  function orientationLanding() { return Boolean(data.meta?.landing === "orientation" && authoring()); }
  // A malformed layer degrades fully: its scenarios are read as ordinary flows.
  function isAuthoredScenario(flow) { return flow?.kind === "authored-scenario" && Boolean(authoring()); }
  /** A node/edge/flow's projected `interpretation`, only while the authored layer is shown. */
  function interp(item) {
    const value = authoring() ? item?.interpretation : null;
    return isRecord(value) ? value : null;
  }
  const INTERPRETATION_GRADES = { verified: "已核验", "partly-verified": "部分核验", unverified: "未核验" };
  const GRADE_ORDER = ["unverified", "partly-verified", "verified"];
  /** Whether an independent verifier returned any verdict at all for this model. */
  function anyVerdict() {
    const verdicts = authoring()?.verdicts;
    return isRecord(verdicts) && Object.keys(verdicts).length > 0;
  }
  /** One claim's grade, read from its verifier verdict: no verdict is `unverified`. */
  function claimStatus(id) {
    const verdict = ownValue(authoring()?.verdicts, id);
    const value = isRecord(verdict) ? verdict.verdict : null;
    return value === "supported" ? "verified" : value === "partial" ? "partly-verified" : "unverified";
  }
  function weakestStatus(ids) {
    const statuses = listOf(ids).filter((id) => typeof id === "string").map(claimStatus);
    return statuses.length ? GRADE_ORDER.find((grade) => statuses.includes(grade)) : null;
  }
  /** The claim a projected field shows (`interpretation.fields`), or null: the field is derived. */
  function fieldClaim(item, field) {
    const id = ownValue(ownValue(interp(item), "fields"), field);
    return typeof id === "string" && id ? id : null;
  }
  /** A projected field's grade, from its own claim; null: the field shows derived text. */
  function fieldGrade(item, field) {
    const id = field ? fieldClaim(item, field) : null;
    return id && claimRecord(id) ? claimStatus(id) : null;
  }
  /** The field a card, preview or export shows as an object's one-line text. A container's
   *  `summary` is its group description, i.e. its own description field. */
  function shownTextField(n) {
    return containers.has(n.id) ? "description" : n.summary ? "summary" : n.description ? "description" : null;
  }
  /** The grade badge for the text a card or preview shows, or "" when that text is derived. */
  function shownTextBadge(n) {
    const status = fieldGrade(n, shownTextField(n));
    return status ? interpretationBadge(status) : "";
  }
  function claimEvidence(id) {
    return listOf(claimRecord(id)?.evidenceIds).filter((item) => typeof item === "string");
  }
  /** The Analysis IR relation behind an edge id: the one source of a step's proof state. */
  var relationChecks;
  function irRelation(id) {
    relationChecks ||= new WeakMap();
    if (!relationChecks.has(data)) relationChecks.set(data, new Map(recordsOf(data.analysis?.relations).map((relation) => [relation.id, relation])));
    return relationChecks.get(data).get(id) || null;
  }
  /** Own-property read: ids, claim ids, paths and statuses come from the model file, and names
   *  such as `constructor` or `__proto__` must never resolve to an Object.prototype member. */
  function ownValue(record, key) {
    return record && typeof record === "object" && typeof key === "string" && Object.hasOwn(record, key) ? record[key] : undefined;
  }
  /** A region colour is used inside a style attribute, so only a plain hex colour is accepted. */
  function safeColor(value, fallback) {
    return typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
  }
  /* Split files (AUTHORING.md §Regions): a file whose top-level declarations were assigned to
     different regions loses its container, and those declarations hang directly under their
     regions. Read from `regionPlan.dissolved`; one Map per model, keyed by file path. */
  const splitFileCache = new WeakMap();
  function splitFiles() {
    if (!splitFileCache.has(data)) {
      const dissolved = new Set((authoring()?.regionPlan?.dissolved || []).map((d) => d?.path).filter((path) => typeof path === "string" && path));
      const files = new Map();
      // Classes are hierarchy containers here, so units come from both nodes and containers;
      // a unit is any declaration whose parent is not itself part of the same file.
      if (dissolved.size)
        for (const n of [...(data.hierarchy || []), ...data.nodes]) {
          if (typeof n.path !== "string" || !dissolved.has(n.path)) continue;
          if (!files.has(n.path)) files.set(n.path, { path: n.path, units: [], regions: new Set() });
          const file = files.get(n.path);
          if (n.group) file.regions.add(n.group);
          if (n.sourceRole !== "file" && all.get(n.parentId)?.path !== n.path) file.units.push(n.id);
        }
      for (const [path, file] of files) if (file.regions.size < 2) files.delete(path);
      splitFileCache.set(data, files);
    }
    return splitFileCache.get(data);
  }
  function splitFileOf(n) {
    return authoring() && typeof n?.path === "string" ? splitFiles().get(n.path) || null : null;
  }
  function regionHoldsSplitFile(scopeId) {
    if (!authoring()) return false;
    for (const file of splitFiles().values()) if (file.regions.has(scopeId)) return true;
    return false;
  }
  /**
   * The real file of an object whose breadcrumb no longer passes through it (a declaration of a
   * split file, now directly under its region), and where the rest of that file went.
   */
  function realLocation(n) {
    if (!authoring() || typeof n.path !== "string" || !n.path) return "";
    const span = n.sourceSpan, file = splitFileOf(n);
    // Only declarations (and any member of a split file) lose their file from the breadcrumb.
    if (!file && n.sourceRole !== "symbol") return "";
    if (crumbIds(n.id).slice(0, -1).some((id) => all.get(id)?.path === n.path)) return "";
    const lines = Number.isInteger(span?.lineStart) ? `:L${span.lineStart}${Number.isInteger(span.lineEnd) && span.lineEnd !== span.lineStart ? `-L${span.lineEnd}` : ""}` : "";
    const regions = file ? [...file.regions].filter((id) => containers.has(id)) : [];
    return `<div class="real-location">${icon("document")}<span><small>所在文件</small><code>${escape(n.path + lines)}</code>${file ? `<small>这个文件被按职责拆分：${file.units.length} 个顶层声明分布在 ${regions.length} 个区域，文件本身不再作为边界出现。</small><span class="real-location-regions">${regions.map((id) => `<button data-action="scope" data-id="${escape(id)}" style="--tone:${groupColor(all.get(id))}"><i class="dot"></i>${escape(label(id))}</button>`).join("")}</span>` : ""}</span></div>`;
  }
  function claimRecord(id) {
    if (!claimIndex) claimIndex = new Map(recordsOf(data.analysis?.claims).map((claim) => [claim.id, claim]));
    return (typeof id === "string" && claimIndex.get(id)) || null;
  }
  /** The grade badge; `status` null means an authored item with no claim of its own (title, audience). */
  function interpretationBadge(status) {
    const vocabulary = authoring()?.gradeVocabulary;
    const graded = typeof status === "string" && Object.hasOwn(INTERPRETATION_GRADES, status);
    const title = [ownValue(vocabulary, "agent-interpretation"), graded ? ownValue(vocabulary, status) : ""].filter((text) => typeof text === "string" && text).join(" ");
    return `<span class="interpretation-badge" data-status="${graded ? status : "ungraded"}" title="${escape(title)}">${icon("eye")}代理解读${graded ? ` · ${INTERPRETATION_GRADES[status]}` : ""}</span>`;
  }
  /** Evidence cited by a set of claims. */
  function claimsEvidence(ids) {
    return [...new Set(listOf(ids).flatMap(claimEvidence))];
  }
  /** One citation as `path:Lstart-Lend`, opening the existing evidence viewer. */
  function citationChip(id) {
    const record = evidenceRecord(id), path = evidenceSourcePath(record), range = record?.range;
    const text = !record
      ? "当前快照找不到这条依据"
      : Number.isInteger(range?.startLine)
        ? `${path || id}:L${range.startLine}-L${Number.isInteger(range.endLine) ? range.endLine : range.startLine}`
        : path || id;
    return `<button class="citation-chip${record ? "" : " unresolved"}" data-action="evidence" data-id="${escape(id)}" title="${escape(id)}">${icon("code")}${escape(text)}</button>`;
  }
  function authoredMeta(status, evidenceIds = []) {
    return `<div class="authored-meta">${interpretationBadge(status)}${evidenceIds.map(citationChip).join("")}</div>`;
  }
  /** An authored sentence (with an optional authored headline), its grade, its citations and,
   *  when projection replaced one, the parsed text. */
  function authoredStatement(text, status, evidenceIds = [], derived = "", headline = "") {
    return `<div class="authored-statement">${headline ? `<p class="detail-text authored-summary">${escape(headline)}</p>` : ""}<p class="detail-text">${escape(text)}</p>${authoredMeta(status, evidenceIds)}${derived ? `<p class="derived-line"><span>解析得到</span>${escape(derived)}</p>` : ""}</div>`;
  }
  /** An agent-written reading guide (one per scenario). Curated demos also use the
   *  `authored-reading-guide` status for human guides, so the status alone never marks a
   *  document as agent output. */
  function isAgentGuide(doc) {
    return Boolean(authoring()) && isGuideId(doc?.id);
  }
  /** Documents in reading order: the agent reading guides first, the rest as stored. */
  function orderedDocuments(docs = data.documents || []) {
    return [...docs.filter(isAgentGuide), ...docs.filter((d) => !isAgentGuide(d))];
  }
  /** The reading guide of one authored scenario, or null. */
  function scenarioGuide(flow) {
    const id = textOf(flow?.guideId);
    return id && isGuideId(id) ? (data.documents || []).find((d) => d.id === id && isAgentGuide(d)) || null : null;
  }
  function guideButton(flow) {
    const guide = scenarioGuide(flow);
    return guide ? `<button class="btn guide-link" data-action="document" data-id="${escape(guide.id)}">${icon("document")}阅读导览</button>` : "";
  }
  const RESOLUTION_LABELS = {
    "resolved-static": "静态已证实", "source-declared": "源码声明", candidate: "候选 · 未证实",
    unresolved: "未解析", "external-unfetched": "外部 · 未取回", "legacy-unknown": "旧模型 · 未知",
  };
  const PROVEN_RESOLUTIONS = new Set(["resolved-static", "source-declared"]);
  /** A narrative step records a hand-over no code relation records; it never rests on an edge. */
  function scenarioStepNarrative(step) {
    return step?.direction === "narrative";
  }
  /** A step's proof state: the IR relation's resolution, whatever the projected step says. */
  function scenarioStepResolution(step) {
    if (scenarioStepNarrative(step) || typeof step?.edgeId !== "string" || !step.edgeId) return null;
    const recorded = irRelation(step.edgeId)?.resolution;
    return typeof recorded === "string" ? recorded : null;
  }
  /** A step that rests on an edge the IR does not record as a static proof. */
  function scenarioStepUnproven(step) {
    return !scenarioStepNarrative(step) && typeof step?.edgeId === "string" && Boolean(step.edgeId) && !PROVEN_RESOLUTIONS.has(scenarioStepResolution(step));
  }
  /** An authored claim backed by a fact relation the IR does not record as proven. */
  function claimUnproven(claim) {
    return listOf(claim?.factIds).some((id) => !PROVEN_RESOLUTIONS.has(irRelation(id)?.resolution));
  }
  /** A step's grade, from its own step claim. Null: the step keeps no authored text. */
  function scenarioStepStatus(step) {
    return weakestStatus(step?.claimIds);
  }
  /** The claim behind a scenario's description, by the exact id scheme. */
  function scenarioDescriptionClaim(flow) {
    return fieldClaim(flow, "description") || `cl_auth_scenario_${String(flow?.id || "").replace(/^scenario_/, "")}`;
  }
  /** A scenario's own grade: its description claim's verdict, or null when it has none. */
  function scenarioStatus(flow) {
    const id = scenarioDescriptionClaim(flow);
    return claimRecord(id) ? claimStatus(id) : null;
  }
  /** The story panel of an authored scenario: what the task is, then the step being read. */
  function scenarioStory(flow) {
    const descriptionClaim = scenarioDescriptionClaim(flow);
    const steps = recordsOf(flow.steps);
    const unproven = steps.filter(scenarioStepUnproven).length;
    const narrative = steps.filter(scenarioStepNarrative).length;
    const description = textOf(flow.description);
    return `<details class="scenario-brief"${state.step === 0 ? " open" : ""}><summary>${icon("info")}场景说明${unproven ? `<b class="unproven-badge">${unproven} 步未证实调用</b>` : ""}${narrative ? `<b class="narrative-badge">${narrative} 步叙述衔接</b>` : ""}</summary>${description && claimRecord(descriptionClaim) ? authoredStatement(description, claimStatus(descriptionClaim), claimEvidence(descriptionClaim)) : '<p class="micro">这个场景没有保留说明文字。</p>'}${guideButton(flow)}</details>${scenarioStepBlock(flow)}`;
  }
  /** The scenario step being read: its reason, direction and the edge's IR resolution. */
  function scenarioStepBlock(flow) {
    const index = state.step, raw = listOf(flow.steps)[index], step = isRecord(raw) ? raw : {}, nodeId = flow.nodes[index];
    const narrative = scenarioStepNarrative(step);
    // A narrative step is never shown as an edge, whatever else the record carries.
    const edge = !narrative && typeof step.edgeId === "string" && step.edgeId ? graphIndex.edges.get(step.edgeId) : null;
    const unproven = scenarioStepUnproven(step);
    const direction = narrative ? null : step.direction === "reverse" ? "反向" : step.direction === "forward" ? "正向" : null;
    const heading = index === 0 ? "起点" : `第 ${index + 1} 步${direction ? ` · ${direction}` : ""}`;
    const previous = index > 0 ? flow.nodes[index - 1] : null;
    const via = narrative
      ? `<p class="micro">从 ${escape(label(previous))} 到 ${escape(label(nodeId))} 的衔接只由引用的文字说明；代码里没有记录这两者之间的关系，图上也不画连接。</p>`
      : edge
        ? `<button class="scenario-edge${unproven ? " is-unproven" : ""}" data-action="raw-edge" data-id="${escape(edge.id)}" style="${typeStyle(edge.type)}">${typeBadge(edge.type)}<span>${escape(label(edge.source))} <span class="inline-arrow">→</span> ${escape(label(edge.target))}</span>${roleChip(edge)}${icon("chevron")}</button><p class="micro">${direction === "反向" ? `沿这条关系逆向走到 ${escape(label(nodeId))}：箭头仍指向模型记录的方向。` : `沿这条关系的方向走到 ${escape(label(nodeId))}。`}</p>`
        : index === 0 ? "" : '<p class="micro">这一步没有记录连接的关系。</p>';
    const status = scenarioStepStatus(step);
    const reason = textOf(step.reason) && status
      ? `<p>${escape(step.reason)}</p>${authoredMeta(status, claimsEvidence(step.claimIds))}`
      : `<p class="micro">这一步没有保留解读文字（未通过核验或未生成）${narrative ? "。" : "，只保留它所沿的关系。"}</p>`;
    const resolution = scenarioStepResolution(step);
    const resolutionText = ownValue(RESOLUTION_LABELS, resolution) || resolution || "分析记录中没有这条关系";
    const mismatch = resolution && typeof step.resolution === "string" && step.resolution !== resolution
      ? ` title="${escape(`场景记录写作 ${step.resolution}；这里按分析记录显示 ${resolution}。`)}"` : "";
    const badges = narrative
      ? '<b class="narrative-badge" title="代码里没有记录这一步的关系，衔接只由引用的文字说明。">叙述衔接 · 无代码关系</b>'
      : `${edge || step.edgeId ? `<b class="resolution-badge" data-proven="${!unproven}"${mismatch}>${escape(resolutionText)}</b>` : ""}${unproven ? '<b class="unproven-badge" title="这条关系没有静态证明，可能不会真的发生。">未证实调用</b>' : ""}`;
    return `<div class="scenario-step${unproven ? " is-unproven" : ""}${narrative ? " is-narrative" : ""}" data-step-index="${index}" data-step-kind="${narrative ? "narrative" : edge ? "edge" : "start"}" data-resolution="${escape(resolution || "")}"><span class="scenario-step-kind">${icon(narrative ? "document" : "flow")}${heading}${badges}</span>${via}${reason}</div>`;
  }
  /** Whether orientation produced anything: regions, or a claim-backed brief statement. */
  function orientationAuthored() {
    const a = authoring();
    if (!a) return false;
    const brief = isRecord(a.brief) ? a.brief : {};
    return recordsOf(a.regions).length > 0 || claimRecord(brief.purpose?.claimId) !== null
      || ["capabilities", "inputs", "outputs", "boundary"].some((key) => recordsOf(brief[key]).some((item) => claimRecord(item.claimId)));
  }
  /**
   * The authored work that was not projected. Only final rejections count (a `rejected` entry
   * with `final: false` was corrected by a later repair round and its item was projected); an
   * entry without the flag is counted as final. Corrected ones stay readable as history.
   */
  function coverageDetails(a) {
    const coverage = isRecord(a.coverage) ? a.coverage : {};
    const entries = recordsOf(a.rejected), skipped = recordsOf(coverage.skipped);
    const rejected = entries.filter((item) => item.final !== false), repaired = entries.filter((item) => item.final === false);
    const grouped = (items) => {
      const groups = new Map();
      for (const item of items) {
        const code = textOf(item.code) || "UNSPECIFIED";
        if (!groups.has(code)) groups.set(code, []);
        groups.get(code).push(item);
      }
      return [...groups].map(([code, list]) => `<li><b>${escape(code)}</b><span>${list.length}</span><ul>${list.map((item) => `<li><code>${escape([textOf(item.stage), textOf(item.path)].filter(Boolean).join(" · "))}</code>${textOf(item.detail) ? ` ${escape(item.detail)}` : ""}</li>`).join("")}</ul></li>`).join("");
    };
    const skippedList = skipped.map((item) => `<li><code>${escape(textOf(item.stage) || "?")}</code> ${escape(textOf(item.reason))}</li>`).join("");
    const history = repaired.length ? `<details class="coverage-history"><summary>已在修复轮更正 · ${repaired.length}</summary><ul class="rejection-groups">${grouped(repaired)}</ul></details>` : "";
    const body = rejected.length || skipped.length || repaired.length
      ? `<details class="coverage-details"><summary>${rejected.length} 项最终被拒绝${skipped.length ? ` · ${skipped.length} 项工作被跳过` : ""}${repaired.length ? ` · ${repaired.length} 项已更正` : ""}</summary>${rejected.length ? `<ul class="rejection-groups">${grouped(rejected)}</ul>` : ""}${skippedList ? `<div class="section-label">被跳过的工作</div><ul class="skipped-work">${skippedList}</ul>` : ""}${history}</details>`
      : "";
    return { rejected, skipped, repaired, body };
  }
  /** The coverage note, the open denominators and the final rejection/skip lists. `compact`
   *  renders it as one collapsible block for views other than the orientation panel. */
  function coverageSummary(a, compact = false) {
    const coverage = isRecord(a.coverage) ? a.coverage : {};
    const count = (record, key) => (Number.isFinite(ownValue(record, key)) ? ownValue(record, key) : 0);
    const claims = isRecord(coverage.claims) ? coverage.claims : {}, obligations = isRecord(coverage.obligations) ? coverage.obligations : {};
    const files = isRecord(coverage.files) ? coverage.files : {}, keyObjects = isRecord(coverage.keyObjects) ? coverage.keyObjects : {};
    const details = coverageDetails(a);
    const verified = anyVerdict()
      ? `其中 ${count(claims, "verified")} 条经独立核验${count(claims, "partlyVerified") ? `、${count(claims, "partlyVerified")} 条部分核验` : ""}`
      : "均未经独立核验（没有核验结论）";
    const note = `${count(claims, "projected")} 条代理解读，${verified}；${details.rejected.length} 项最终被拒绝${details.skipped.length ? `，${details.skipped.length} 项工作被跳过` : ""}`;
    const ledger = `义务 ${count(obligations, "closed")} / ${count(obligations, "total")} 已关闭（${count(obligations, "open")} 项仍开放）· 关键对象 ${count(keyObjects, "authored")} / ${count(keyObjects, "ranked")} 有解读 · 文件 ${count(files, "inRegions")} / ${count(files, "total")} 归入区域`;
    const inner = `<p class="coverage-note">${icon("info")}${escape(note)}</p><p class="coverage-ledger">${escape(ledger)}</p>${details.body}`;
    return compact ? `<details class="coverage-strip"><summary>${icon("info")}代理解读覆盖：${escape(note)}</summary>${inner}</details>` : inner;
  }
  /** What the core selection leaves out, counted by the builder (not authored, never graded). */
  function scopeNote(a) {
    const scope = isRecord(a.scope) ? a.scope : null;
    if (!scope || !Array.isArray(scope.coreFiles)) return "";
    const outside = Number.isInteger(scope.outsideFiles) ? scope.outsideFiles : 0;
    return `<p class="micro scope-note">核心选了 ${scope.coreFiles.length} 个文件${outside ? `；其余 ${outside} 个文件放在「核心之外」，仍计入覆盖，可展开查看` : ""}。这是代理的选择，并不完整。</p>`;
  }
  /** The inspector's empty state for an authored model: the reading entry to the whole map. */
  function orientationPanel() {
    const a = authoring(), brief = isRecord(a.brief) ? a.brief : {};
    // Brief items are `{ text, claimId, status, evidenceIds }`; each is graded by its own claim.
    const graded = (item) => isRecord(item) && textOf(item.text) && claimRecord(item.claimId)
      ? authoredStatement(item.text, claimStatus(item.claimId), claimEvidence(item.claimId)) : "";
    const statements = (items) => listOf(items).map(graded).join("");
    const section = (title, body, total) => body ? `<div class="section-label">${title}${total ? `<span>${total}</span>` : ""}</div>${body}` : "";
    const regionList = recordsOf(a.regions).filter((r) => typeof r.id === "string" && containers.has(r.id));
    const regionIds = new Set(regionList.map((r) => r.id));
    const regions = regionList.map((r) => {
      const key = textOf(r.key), description = `cl_auth_region_${key}`;
      return `<button class="region-button" data-action="scope" data-id="${escape(r.id)}" style="--tone:${safeColor(r.color, groupColor(all.get(r.id)))}"><span class="region-title"><i class="dot"></i><b>${escape(textOf(r.label) || label(r.id))}</b>${nameChip(all.get(r.id))}<small>${members(r.id).length} 个组件</small>${icon("arrow")}</span>${textOf(r.description) ? `<span class="region-description">${escape(r.description)}</span>` : ""}</button>${textOf(r.description) && claimRecord(description) ? authoredMeta(claimStatus(description), claimEvidence(description)) : ""}`;
    }).join("") + scopeNote(a);
    const others = data.groups.filter((g) => !regionIds.has(g.id)).map((g) => `<button class="connection" data-action="scope" data-id="${escape(g.id)}"><i class="dot" style="--tone:${safeColor(g.color, groupColor(g))}"></i><span>${escape(g.label)}<small>不属于任何区域 · ${members(g.id).length} 个组件</small></span>${icon("arrow")}</button>`).join("");
    const startList = recordsOf(a.startHere).filter((s) => typeof s.nodeId === "string" && all.has(s.nodeId));
    const starts = startList.map((s) => `<div class="start-item"><button class="connection" data-action="authored-focus" data-id="${escape(s.nodeId)}" data-peek="${escape(s.nodeId)}">${icon(kindIcon(nodes.get(s.nodeId)))}<span>${escape(label(s.nodeId))}<small>${escape(all.get(s.nodeId).path || "")}</small></span>${icon("arrow")}</button>${textOf(s.reason) && claimRecord(s.claimId) ? authoredStatement(s.reason, claimStatus(s.claimId), claimEvidence(s.claimId)) : ""}</div>`).join("");
    const authoredFlows = (data.flows || []).filter(isAuthoredScenario);
    const scenarios = authoredFlows.map((f) => `<button class="connection scenario-link" data-action="flow" data-id="${escape(f.id)}">${icon("flow")}<span>${escape(f.label || f.title || f.id)}${nameChip(f)}<small>${f.nodes.length} 步${textOf(f.description) ? ` · ${escape(f.description)}` : ""}</small></span>${scenarioStatus(f) ? interpretationBadge(scenarioStatus(f)) : ""}</button>${guideButton(f)}`).join("");
    const purpose = graded(brief.purpose);
    // The title is authored only when orientation wrote it; otherwise it is the folder name.
    const authoredTitle = textOf(a.accepted?.orientation?.brief?.title);
    const title = textOf(brief.title) || data.meta?.title || "";
    const host = isRecord(a.host) ? a.host : {};
    const footer = `解读由 ${escape(textOf(host.authorIdentity) || "作者宿主")} 撰写${anyVerdict() && textOf(host.verifierIdentity) ? `，由 ${escape(host.verifierIdentity)} 独立核验` : "，没有经过独立核验"}；没有经过人工审阅。解析得到的结构与关系不受解读影响。`;
    return `<div class="inspector-top"><div class="eyebrow">阅读导引 · 代理解读</div></div><div class="inspector-content orientation-panel"><h2 class="empty-title">${escape(title)}</h2>${authoredTitle && authoredTitle === title ? '<span class="name-chip" title="项目标题由作者宿主拟定，不是解析得到的事实，也不经核验。">代理命名</span>' : ""}${orientationAuthored() ? "" : '<p class="micro">这次没有产出区域或项目简介：下面只列出解析得到的结构。</p>'}${purpose}${coverageSummary(a)}${section("能做什么", statements(brief.capabilities), recordsOf(brief.capabilities).length)}${section("输入", statements(brief.inputs), recordsOf(brief.inputs).length)}${section("输出", statements(brief.outputs), recordsOf(brief.outputs).length)}${section("边界", statements(brief.boundary), recordsOf(brief.boundary).length)}${textOf(brief.audience) && authoredTitle ? section("适合谁读", `<div class="authored-statement"><p class="detail-text">${escape(brief.audience)}</p>${authoredMeta(null)}</div>`) : ""}${section("系统区域", regions + others, regionList.length)}${section("从这里开始", starts, startList.length)}${section("场景", scenarios, authoredFlows.length)}<div class="orientation-actions"><button class="btn" data-action="legend">${icon("info")}颜色与形状图例</button></div><p class="micro">${footer}</p></div>`;
  }
  /**
   * The evidence viewer: the real excerpt, its span and its source, plus a way into the
   * structure and an exact way back. Opening it never moves the reading position.
   */
  function showEvidence(id) {
    const record = evidenceRecord(id);
    if (!evidenceOrigin) evidenceOrigin = { model: data, view: snapshotState() };
    if (!record) {
      modal(
        "源码依据",
        `<div class="evidence-viewer"><p class="evidence-missing">依据标识 <code>${escape(id)}</code> 在当前快照 <code>${escape(modelSnapshotId() || "未标注")}</code> 的分析记录中不存在，因此无法显示原文。它没有被套用到别的记录上。</p><p class="micro">可能原因：模型是在另一个快照上生成的，或导入时丢弃了这条依据。完整依据集合可从 CLI/MCP 的 evidence 集合取回。</p></div>`,
      );
      return;
    }
    const path = evidenceSourcePath(record), span = evidenceSpanLabel(record);
    const file = evidenceSourceFile(record), subject = evidenceSubject(record);
    const excerpt = typeof record.excerpt === "string" && record.excerpt.length
      ? `<pre class="evidence-excerpt">${escape(record.excerpt)}</pre>`
      : `<p class="micro">${escape(record.summary || "这条依据没有保留原文片段。")}</p>`;
    modal(
      "源码依据",
      `<div class="evidence-viewer"><div class="evidence-viewer-top"><code>${escape(record.id)}</code><span class="badge">${escape(evidenceKindLabel(record))}</span><span class="badge">verification ${escape(record.verification || "未标注")}</span><span class="badge">decode ${escape(record.decodeStatus || "未标注")}</span></div><div class="evidence-viewer-source"><b>来源</b><span>${escape(path || "未记录文件")}${span ? ` · ${escape(span)}` : " · 未记录行号"}</span>${file?.language ? `<small>${escape(file.language)}</small>` : ""}${record.snapshotId ? `<small>snapshot ${escape(record.snapshotId)}</small>` : ""}</div>${excerpt}${evidenceLink(record)}<p class="micro">原文是源码事实，不是运行行为的证明。</p><div class="modal-actions">${subject ? `<button class="btn primary" data-action="evidence-locate" data-id="${escape(record.id)}">${icon("layers")}在结构中定位 ${escape(subject.label)}</button>` : ""}<button class="btn" data-action="evidence-return">${icon("back")}返回阅读位置</button></div></div>`,
    );
  }
  function evidenceBody(n) {
    const scopedDocuments = new Set([n, ...descendants(n.id)].flatMap(item => item.documentIds || []));
    const docs = orderedDocuments().filter(
      (d) => scopedDocuments.has(d.id),
    );
    return `<div class="detail-intro"><b>源码与阅读指南</b><p>${escape(data.meta?.evidenceNote || "依据由模型作者提供。")}</p></div>${docs.map((d) => `<button class="connection" data-action="document" data-id="${escape(d.id)}">${icon("document")}<span>${escape(d.title)}<small>${d.status === "proposal" ? "拟议方案" : escape(d.path)}</small></span>${icon("external")}</button>`).join("")}<button class="btn" data-action="all-docs">全部 ${data.documents?.length || 0} 份文档</button><div class="section-label" style="margin-top:22px">原文摘录<span>${n.evidence?.length || 0}</span></div>${(n.evidence || []).map((e) => `<details class="evidence-card"><summary>${escape(e.file)} · ${e.lineStart}–${e.lineEnd}</summary>${evidenceLink(e)}<pre>${escape(e.excerpt)}</pre></details>`).join("")}`;
  }
  function parameterStatus(contract) {
    if (!contract) return "旧模型未记录签名来源状态";
    const status = contract.parameters?.status, reason = contract.parameters?.reason ? ` · ${contract.parameters.reason}` : "";
    if (status === "complete" && !(contract.parameters.items || []).length) return "无声明参数";
    if (status === "complete") return "源码参数";
    if (status === "unsupported") return "当前签名形式尚未解析" + reason;
    if (status === "partial") return "部分提取" + reason;
    if (status === "not-applicable") return "不适用";
    return status || "";
  }
  function returnStatus(contract) {
    if (!contract) return "旧模型未记录签名来源状态";
    const status = contract.returns?.status, reason = contract.returns?.reason ? ` · ${contract.returns.reason}` : "";
    if (status === "explicit") return "声明的返回类型";
    if (status === "unannotated") return "源码未声明返回类型";
    if (status === "unsupported") return "当前签名形式尚未解析" + reason;
    if (status === "partial") return "部分提取" + reason;
    if (status === "not-applicable") return "不适用";
    return status || "";
  }
  function ioBlock(contract, inputs, outputs, curated) {
    if (curated) return `${inputs?.length || outputs?.length || true ? `<div class="io"><b>输入 INPUT</b><code>${escape(textIO(inputs))}</code></div><div class="io"><b>输出 OUTPUT</b><code>${escape(textIO(outputs))}</code></div>` : ""}`;
    const params = (contract?.parameters?.items || []).map(item => item.text);
    const returns = (contract?.returns?.items || []).map(item => item.text);
    return `${contract?.signature?.text ? `<details class="signature-source"><summary>源码声明</summary><pre>${escape(contract.signature.text)}</pre></details>` : ""}<div class="io"><b>参数</b><code>${escape(textIO(params.length ? params : inputs))}</code><small>${escape(parameterStatus(contract))}</small></div><div class="io"><b>返回声明</b><code>${escape(textIO(returns.length ? returns : outputs))}</code><small>${escape(returnStatus(contract))}</small></div>${contract?.documentation?.summary ? `<p class="micro">docstring · ${escape(contract.documentation.summary)}</p>` : ""}`;
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
    if (generated() && n.sourceRole === "symbol") {
      return `<div class="detail-intro"><b>源码签名契约</b><p>已支持的声明形式保留源码参数与显式返回类型；缺少注解、当前不支持和部分提取分别记录。签名描述不是业务职责或运行时契约证明。</p></div>${ioBlock(n.sourceContract, n.inputs, n.outputs, false)}${evidenceBody(n)}`;
    }
    const curated = !generated();
    return `<div class="detail-intro"><b>${n.functions?.length || 0} 个${generated() ? "符号 / 章节" : "函数 / 接口"}</b><p>${escape(data.meta?.functionNote || (generated() ? "自动分析对已支持的声明形式提取源码参数、显式返回类型及可识别的文档字符串。结果分别记录缺少注解、部分提取和不支持的情况。它们是源码签名事实，不等同于精选 Demo 中人工整理的职责、业务契约和端到端场景。" : "按职责、输入、输出阅读接口摘要。"))}</p></div>${(n.functions || []).map((f, i) => `<details class="function" ${i === 0 ? "open" : ""}><summary>${escape(f.qualifiedName || f.name)}</summary><div class="function-body">${escape(f.description || f.desc || "")}${f.nodeId && all.has(f.nodeId) ? `<button class="connection" data-action="select" data-id="${escape(f.nodeId)}">${icon("code")}<span>定位符号与关系</span>${icon("arrow")}</button>` : ""}${ioBlock(f.sourceContract || all.get(f.nodeId)?.sourceContract, f.inputs, f.outputs, curated)}${(f.evidence || []).map(e => `<details class="evidence-card" open><summary>${escape(e.file)} · ${e.lineStart}–${e.lineEnd}${e.excerptTruncated ? " · 摘录截断" : ""}</summary>${evidenceLink(e)}<pre>${escape(e.excerpt)}</pre></details>`).join("")}</div></details>`).join("") || '<p class="empty-hint">暂无函数契约。</p>'}`;
  }
  function renderLegend() {
    const counts = new Map();
    for (const e of data.edges) {
      const entry = counts.get(e.type) || { total: 0, candidates: 0 };
      entry.total++;
      if (candidateIds.has(e.id)) entry.candidates++;
      counts.set(e.type, entry);
    }
    const hiding = !state.showCandidates;
    /* Hidden candidates are counted, per type and in total, next to the one control that
       reveals them: nothing leaves the map silently. */
    const toggle = candidateIds.size
      ? `<button class="candidate-toggle ${hiding ? "" : "active"}" data-action="toggle-candidates" aria-pressed="${!hiding}" aria-label="${hiding ? `${candidateIds.size} 条未证实的候选关系已隐藏，点击显示` : `已显示 ${candidateIds.size} 条未证实的候选关系，点击隐藏`}" title="候选关系：目标只是一种可能，代码没有证明这个绑定（词法同名、条件或分派候选）。">${icon("eye")}${hiding ? `<span><b>${candidateIds.size}</b> 条候选已隐藏</span><span class="candidate-toggle-verb">显示</span>` : `<span>候选 <b>${candidateIds.size}</b> 条已显示</span><span class="candidate-toggle-verb">隐藏</span>`}</button>`
      : "";
    return `<div class="semantic-legend"><span class="legend-caption">关系类型</span>${[...counts]
      .map(([type, count]) => {
        const t = CodeLoomSemantics.relation(type);
        const hidden = hiding ? count.candidates : 0;
        return `<button data-action="filter-type" data-value="${escape(type)}" class="${state.type === type ? "active" : ""} ${hidden === count.total ? "all-hidden" : ""}" aria-pressed="${state.type === type}" style="${typeStyle(type)}" title="${escape(t.description)}${hidden ? `（${hidden} 条候选已隐藏）` : ""}"><svg viewBox="0 0 27 8"><path d="M1 4H24" stroke="currentColor" stroke-width="2" ${t.dash ? `stroke-dasharray="${t.dash}"` : ""}/></svg>${escape(t.shortLabel)}<b>${count.total - hidden}</b>${hidden ? `<small class="legend-hidden">${hidden} 隐藏</small>` : ""}</button>`;
      })
      .join(
        "",
      )}${toggle}<button class="legend-help" data-action="legend">${icon("info")}图例</button></div>`;
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
    modal("让代码地图进入你的工作流", `<p class="dialog-lead">从来源生成地图，再在浏览器、Agent 和终端中探索同一份模型。分析得到的地图保留完整交互工作台。</p><div class="connect-grid"><section class="connect-card"><span class="eyebrow">AGENT · MCP</span><h3>让 Agent 直接分析来源</h3><p>9 个工具覆盖来源分析、模型导出、搜索、对象详情、上下游、路径、流程和打开视图。适用于支持本地 stdio MCP 的客户端。</p>${command(configCommand, "复制带来源目录的 MCP 配置命令")}<small>把路径换成你允许 Agent 读取的目录。未设置 --root 时，MCP 只接受公开网址，不读取任意本地目录。</small><p class="micro">让 Agent 调用 skylense_analyze，再用 repo="analyzed" 查询。skylense_view 可为 analyzed / custom 模型启动完整的本地交互网页，并保留所选对象。</p><a href="docs/MCP.md" target="_blank" rel="noopener">接入与工具说明 ${icon("external")}</a></section><section class="connect-card"><span class="eyebrow">TERMINAL · CLI</span><h3>一个命令，打开自己的地图</h3><p>安装 CLI 后，open 接收文件夹、文件、模型 JSON 或公开网址。分析报告会说明实际读取范围。</p>${command(openCommand, "复制打开来源命令")}${command(analyzeCommand, "复制生成模型命令")}<small>使用 skylense tui custom --model model.json 在终端探索导出的模型。需要 Node.js 22+；不需要模型 API 密钥。</small><a href="docs/TERMINAL.md" target="_blank" rel="noopener">安装与终端指南 ${icon("external")}</a></section></div>${imported ? `<div class="connect-current-model"><h3>继续使用当前这张地图</h3><p>先导出 JSON，再用实际文件路径生成 Agent 配置：</p>${command(modelCommand, "复制当前模型配置命令")}<button class="btn" data-action="export-json">${icon("download")}导出当前模型 JSON</button></div>` : ""}<div class="connect-boundary">${icon("info")}页面选择的文件只在当前浏览器处理，不会自动同步给 Agent。你导出的 JSON 会包含源码摘录；本地 CLI 网页与 MCP 返回的视图均由会话内服务提供。</div>`);
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
      type: relationFilter(),
      trace: state.trace,
    });
  }
  /** The focus role of every drawn object for the current selection: what the canvas paints
   *  and what an exported frame draws. */
  function focusRoles() {
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
    const categoryRole = (b) => {
      const roles = b.ids.map(role);
      return roles.includes("selected")
        ? "selected"
        : roles.includes("related")
          ? "related"
          : enabled
            ? "muted"
            : "normal";
    };
    const edgeRole = (ids) =>
      !enabled
        ? "normal"
        : ids.some((id) => chosenEdges.has(id))
          ? "selected"
          : ids.some((id) => edgeIds.has(id))
            ? "related"
            : "muted";
    return { focus: ctx, role, categoryRole, edgeRole };
  }
  function applyVisualFocus() {
    if (!$("#world")) return;
    const { role, categoryRole, edgeRole } = focusRoles();
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
    for (const b of layout.categoryBounds || [])
      paint(
        $$("#world .category-frame").find(
          (el) => el.dataset.categoryId === b.id,
        ),
        categoryRole(b),
      );
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
      `<header class="app-header"><button class="icon-btn mobile-toggle" data-action="toggle-sidebar" aria-label="打开导航">${icon("menu")}</button><a class="brand" href="#" data-action="home" aria-label="Skylense 首页"><span class="brand-mark"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">  <rect width="64" height="64" rx="16" fill="var(--accent)"/>  <path d="M10 32C15 21 23 15 32 15C41 15 49 21 54 32C49 43 41 49 32 49C23 49 15 43 10 32Z" stroke="var(--accent-text, white)" stroke-width="3"/>  <circle cx="32" cy="32" r="11" stroke="var(--accent-text, white)" stroke-width="3"/>  <path d="M24 32H40M32 24V40" stroke="var(--accent-text, white)" stroke-width="2"/>  <circle cx="32" cy="32" r="4" fill="var(--accent-text, white)"/></svg></span>Skylense</a><span class="header-divider"></span><div class="project-name">${icon("box")}<b>${escape(data.meta?.title || "Imported model")}</b><span class="badge">${generated() ? "Source map" : imported ? "Local import" : "Public example"}</span></div><span class="spacer"></span><div class="header-actions"><button class="btn primary source-open" data-action="source-open" aria-label="打开来源">${icon("plus")}<span>打开来源</span></button><button class="btn theme-toggle" data-action="theme" aria-label="选择主题" title="选择主题 · T">${icon(state.dark ? "moon" : "sun")}<span>主题</span></button><button class="btn present-toggle" data-action="present">${icon(state.present ? "close" : "play")}${state.present ? "退出讲解" : "讲解"}</button><button class="btn hide-mobile" data-action="save">${icon("bookmark")}保存视图</button><button class="btn connect-toggle" data-action="connect">${icon("link")}连接</button><button class="btn export-toggle" data-action="export">${icon("download")}导出 / 导入</button></div></header><div class="workspace"><aside class="sidebar" id="sidebar" aria-label="代码库导航"></aside><main class="main"><div class="canvas-header" id="canvas-header"></div><div class="canvas-toolbar"><div class="segmented" role="group" aria-label="视图模式"><button data-action="mode" data-value="hierarchy" class="${state.mode === "hierarchy" ? "active" : ""}">${icon("layers")}层级</button><button data-action="mode" data-value="components" class="${state.mode === "components" ? "active" : ""}">${icon("grid")}组件</button><button data-action="mode" data-value="flow" class="${state.mode === "flow" ? "active" : ""}">${icon("flow")}${generated() ? "导览" : "流程"}</button></div><span class="spacer"></span><button class="btn motion-toggle" data-action="motion"></button><span class="toolbar-label">关系</span><select id="edge-filter" aria-label="关系类型" class="toolbar-select"><option value="all">全部关系</option>${[...new Set(data.edges.map((e) => e.type))].map((t) => `<option value="${escape(t)}" ${state.type === t ? "selected" : ""}>${escape(CodeLoomSemantics.relation(t).label)} · ${escape(t)}</option>`).join("")}</select><button class="btn" data-action="route">${icon("route")}路径</button><button class="icon-btn mobile-toggle" data-action="toggle-inspector" aria-label="打开详情">${icon("info")}</button></div><div class="structure-toolbar"><button class="structure-up" data-action="level-up" ${!state.scope ? "disabled" : ""}>${icon("back")}上一级</button><div class="lens-switch" role="group" aria-label="关系观察范围">${[
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
        )}</div><span class="spacer"></span><button class="structure-control" data-action="toggle-bundles" aria-pressed="${state.bundle}">${icon("flow")}${state.bundle ? "关系汇聚" : "按端点显示"}</button><button class="structure-control" data-action="collapse-canvas" ${state.lens !== "scope" ? "disabled" : ""}>收起内部</button></div><div id="level-rail"></div><div id="view-recovery"></div><div id="context-strip"></div><div id="story"></div><div class="canvas" id="canvas" role="region" aria-label="可交互架构画布"><div class="canvas-world" id="world"></div><div class="canvas-note" id="canvas-note"></div><div id="compare-float"></div><div class="canvas-controls"><button class="icon-btn" data-action="zoom-out" aria-label="缩小">${icon("minus")}</button><span id="zoom-label">100%</span><button class="icon-btn" data-action="zoom-in" aria-label="放大">${icon("plus")}</button><span style="width:1px;min-width:1px;height:17px;background:var(--line);margin:0 4px"></span><button class="icon-btn" data-action="fit" aria-label="适应画布" title="适应画布 · 0">${icon("fit")}</button></div><button class="minimap" id="minimap" aria-label="点击小地图移动视口"></button></div><div id="semantic-legend">${renderLegend()}</div></main><aside class="inspector" id="inspector" aria-label="对象详情"></aside></div><footer class="statusbar"><span><i class="live-dot"></i>${generated() ? "自动生成 · 静态分析" : imported ? "本地导入模型" : "公开源码快照"}</span><span id="counts">${data.nodes.length} 组件 · ${data.edges.length} 关系 · ${containers.size} 容器</span><span class="spacer"></span><span class="status-extra">${icon("eye")}${generated() ? "覆盖与限制见分析报告 · 非运行轨迹" : imported ? "依据由导入文件提供" : "固定 commit · 精选架构 · 非运行轨迹"}</span><button data-action="help">快捷键 <kbd>?</kbd></button></footer>`;
    renderSidebar();
    renderHeader();
    renderRecovery();
    renderInspector();
    renderStory();
    renderCanvas(true);
    renderCompare();
    bindCanvas();
    hash();
    updateMotion();
  }
  function isSourceGuide(flow) {
    return Boolean(flow && !isAuthoredScenario(flow) && (flow.kind === "dependency-neighborhood" || generated()));
  }
  function guideInfo(flow) {
    if (guideInfoCache.has(flow.id)) return guideInfoCache.get(flow.id);
    const anchor = nodes.get(flow.anchorId) || nodes.get(flow.nodes[0]);
    const counts = {};
    const ids = new Set(flow.nodes);
    const edges = flow.edgeIds ? flow.edgeIds.map(id => graphIndex.edges.get(id)).filter(Boolean) : data.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
    for (const edge of edges) counts[edge.type] = (counts[edge.type] || 0) + 1;
    const types = Object.keys(counts);
    const intent = flow.intent || (types.length && types.every(type => ["imports", "loads"].includes(type)) ? "imports" : types.some(type => ["calls", "constructs", "call-candidate"].includes(type)) ? "calls" : types.length && types.every(type => type === "links") ? "links" : "relationships");
    const containerId = containers.has(flow.containerId) ? flow.containerId : anchor?.parentId || null;
    const context = flow.contextPath || crumbIds(containerId).filter(id => containers.get(id)?.parentId).map(label).slice(-2).join(" / ") || "仓库根目录";
    const title = flow.title || anchor?.label || flow.label.split(/[\\/]/).at(-1).replace(/ · dependencies$/, "");
    const coverage = new Set(flow.nodes.flatMap(id => crumbIds(id)));
    const value = { anchorId: anchor?.id, containerId, title, context, coverage, sourcePath: flow.sourcePath || anchor?.path || "", intent, category: ["source", "examples", "tests", "docs", "tooling", "vendored"].includes(flow.category) ? flow.category : "other", nodeCount: flow.nodes.length, edgeCount: edges.length, counts };
    guideInfoCache.set(flow.id, value); return value;
  }
  function guideIntent(info) {
    return { imports: "模块依赖", calls: "调用关联", links: "文档引用", relationships: "关联概览" }[info.intent] || "关联概览";
  }
  function guideCategory(info) {
    return { source: "源码", examples: "示例", tests: "测试", docs: "文档", tooling: "工具与配置", vendored: "第三方代码", other: "其他入口" }[info.category] || "其他入口";
  }
  function guideNodeLabel(id, flow) {
    const n = nodes.get(id), title = n?.sourceRole === "file" ? n.path?.split("/").at(-1) || n.label : n?.qualifiedName || label(id);
    const duplicate = flow.nodes.some(other => other !== id && label(other) === label(id));
    const line = n?.sourceSpan?.lineStart;
    return `${title}${duplicate ? ` · ${(n?.path || id).split("/").slice(-2).join("/")}${line ? ":" + line : ""}` : ""}`;
  }
  /**
   * Why a guide step is read at this point, and what backs it.
   *
   * Explorer answers "where is the code"; a Guide answers "what to read first and why"
   * (plan §11.3). A step that only repeats a tree label turns Guides into a second path tree,
   * which D09 rejects. The reason is derived from the guide's own stored edges, so when no
   * stored relation connects this step to the part already read, that is what it says instead
   * of inventing a connection.
   */
  function guideStep(flow, index) {
    const step = Math.max(0, Math.min(flow.nodes.length - 1, Number.isInteger(index) ? index : 0));
    const id = flow.nodes[step], node = all.get(id);
    const scoped = flow.edgeIds
      ? flow.edgeIds.map((edgeId) => graphIndex.edges.get(edgeId)).filter(Boolean)
      : data.edges.filter((e) => flow.nodes.includes(e.source) && flow.nodes.includes(e.target));
    const earlier = new Set(flow.nodes.slice(0, step));
    const link =
      scoped.find((e) => e.target === id && earlier.has(e.source)) ||
      scoped.find((e) => e.source === id && earlier.has(e.target)) ||
      null;
    const relation = link ? CodeLoomSemantics.relation(link.type) : null;
    const named = link?.label ? `（${link.label}）` : "";
    const kind = step === 0 ? "entry" : link ? (link.target === id ? "downstream" : "upstream") : "neighborhood";
    const reason = {
      entry: () => `入口：${label(id)} 是这条导览的起点${node?.path ? `，位于 ${node.path}` : ""}。先读它，后面每一步的关联才有参照。`,
      downstream: () => `${label(link.source)} 通过「${relation.label}」${named}指向 ${label(id)}。接着读它，才能看到这条关联的另一端做了什么。`,
      upstream: () => `${label(id)} 通过「${relation.label}」${named}指向已经读过的 ${label(link.target)}。它是上游，读它才能解释上一步为什么被用到。`,
      neighborhood: () => `${label(id)} 与这条导览来自同一个入口邻域，但导览里没有保留它与已读部分的直接关系。这里不虚构连接。`,
    }[kind]();
    return {
      index: step, id, kind, reason,
      edgeId: link?.id || null,
      relationLabel: relation?.label || null,
      direction: link ? (link.target === id ? "incoming" : "outgoing") : null,
      evidenceIds: [...new Set([...(link?.evidenceIds || []), ...(node?.evidenceIds || [])])],
      sourceRefs: (link?.evidence?.length ? link.evidence : node?.evidence) || [],
    };
  }
  /** The step's evidence anchor. Absent evidence is stated, never replaced by a dead label. */
  function guideStepAnchor(step) {
    if (step.evidenceIds.length) return evidenceChips(step.evidenceIds.slice(0, 3), "");
    const ref = step.sourceRefs[0];
    if (!ref) return `<p class="micro">这一步没有保留可点的源码锚点：${step.edgeId ? `关系 ${escape(step.edgeId)} 未附带原文` : "对象本身未附带原文"}。</p>`;
    const span = Number.isInteger(ref.lineStart)
      ? ` · 第 ${ref.lineStart}–${Number.isInteger(ref.lineEnd) ? ref.lineEnd : ref.lineStart} 行`
      : "";
    return `<button class="evidence-chip" data-action="guide-anchor" data-id="${step.index}">${icon("code")}<span>${escape(ref.file || label(step.id))}${span}</span><small>${escape(step.edgeId || step.id)}</small></button>`;
  }
  function guideStepBlock(flow) {
    const step = guideStep(flow, state.step);
    const heading = {
      entry: "为什么先读这里",
      downstream: "为什么接着读这里",
      upstream: "为什么要回看上游",
      neighborhood: "它为什么出现在这条导览里",
    }[step.kind];
    return `<div class="guide-step-reason" data-step-kind="${step.kind}" data-step-index="${step.index}"><span class="guide-step-kind">${icon("info")}${heading}${step.relationLabel ? `<b>${escape(step.relationLabel)}</b>` : ""}</span><p>${escape(step.reason)}</p><div class="guide-step-anchor"><span class="guide-anchor-label">证据锚点</span>${guideStepAnchor(step)}</div></div>`;
  }
  function guideContext() {
    const id = state.mode === "flow" && guideOrigin?.model === data ? guideOrigin.view.scope : state.scope;
    return id && containers.get(id)?.parentId ? id : null;
  }
  function relatedGuides(scopeId) {
    return (data.flows || []).filter(flow => !isAuthoredScenario(flow) && (!scopeId || guideInfo(flow).coverage.has(scopeId)));
  }
  /** Sidebar order of guide categories; the first card shown is the top-ranked guide. */
  const GUIDE_CATEGORIES = ["source", "examples", "tests", "docs", "tooling", "vendored", "other"];
  /** The guide a generated model opens on: the first card of the sidebar's recommended list. */
  function landingGuide() {
    // An authored model opens on its orientation overview, never inside a guide.
    if (!generated() || orientationLanding()) return null;
    const flows = (data.flows || []).filter((f) => isSourceGuide(f) && f.kind !== "authored-scenario" && f.nodes?.some((id) => nodes.has(id)));
    for (const category of GUIDE_CATEGORIES) {
      const found = flows.find((f) => guideInfo(f).category === category);
      if (found) return found;
    }
    return null;
  }
  /**
   * First run of a generated model: thousands of components at a fit-everything zoom are
   * unreadable, while the top guide is a small, connected subgraph. Open it at reading zoom.
   * The overview it replaces is recorded as the guide's origin and as the back step, so
   * 「返回」 and back both reach the full map (re-fitted, not at a stale camera).
   */
  function landOnGuide() {
    const f = landingGuide();
    if (!f) return landOnCore();
    const origin = JSON.parse(JSON.stringify(snapshotState()));
    delete origin.camera;
    delete origin.lastRelation;
    guideOrigin = { model: data, view: origin };
    readingHistory.push(JSON.parse(JSON.stringify(origin)));
    Object.assign(state, {
      lens: "scope", flow: f.id, levelFocus: "auto", relation: null, relationGroup: null,
      mode: "flow", trace: null, step: 0, selected: f.nodes[0],
      scope: guideInfo(f).containerId, tab: "overview", query: "",
    });
    render();
    focusReadingNode();
    return true;
  }
  /**
   * An authored model opens inside its conceptual core: the region holding the focus the
   * builder recorded (meta.defaultScope / defaultFocus / defaultOpen, checked by
   * verify-authored-model), with that node selected and its containers open. A model whose
   * authored layer is not shown, or whose fields name nothing here, keeps the system view.
   */
  function landOnCore() {
    if (!orientationLanding()) return false;
    const scope = data.meta?.defaultScope, focus = data.meta?.defaultFocus;
    if (!containers.has(scope) || !all.has(focus)) return false;
    Object.assign(state, {
      scope, selected: focus, mode: "hierarchy", lens: "scope", flow: null, trace: null, step: 0,
      relation: null, relationGroup: null, tab: "overview",
      openContainers: listOf(data.meta.defaultOpen).filter((id) => containers.has(id)),
    });
    render();
    focusReadingNode();
    return true;
  }
  function renderGuideNavigation() {
    const scenarios = (data.flows || []).filter(isAuthoredScenario);
    if (!scenarios.length) return sourceGuideNavigation(data.flows || []);
    const automatic = data.flows.filter((f) => !isAuthoredScenario(f));
    if (!automatic.length) return scenarioNavigation(scenarios);
    // Automatic guides never sit next to authored scenarios as equals: folded, and titled as
    // parser output, unless the reader is inside one of them.
    const open = automatic.some((f) => f.id === state.flow && state.mode === "flow");
    return scenarioNavigation(scenarios) + `<details class="automatic-guides"${open ? " open" : ""}><summary>${icon("layers")}自动导览 · 解析生成，不是代理场景<span>${automatic.length}</span></summary>${sourceGuideNavigation(automatic)}</details>`;
  }
  /** Authored task scenarios, listed ahead of the generated source guides. */
  function scenarioNavigation(scenarios) {
    return `<section class="sidebar-section scenario-navigation" aria-label="代理解读场景"><div class="nav-heading"><span class="eyebrow">任务场景 · 代理解读</span><span>${scenarios.length}</span></div><p class="navigation-hint">按任务逐步阅读；每一步标明是经静态证明的关系、未证实的调用，还是叙述衔接。</p>${scenarios.map((f) => `<button class="flow-button scenario-button ${state.flow === f.id && state.mode === "flow" ? "active" : ""}" data-action="flow" data-id="${escape(f.id)}" aria-pressed="${state.flow === f.id && state.mode === "flow"}">${icon("flow")}<span>${escape(f.label || f.id)}<small>${f.nodes.length} 步</small></span>${nameChip(f)}</button>`).join("")}</section>`;
  }
  function sourceGuideNavigation(flows) {
    const automatic = generated() || flows.some(isSourceGuide);
    if (!automatic) return `<section class="sidebar-section" aria-label="场景导览"><div class="nav-heading"><span class="eyebrow">场景导览</span><span>${flows.length}</span></div><p class="navigation-hint">沿精选场景，串联上方结构中的组件。</p>${flows.map(f => `<button class="flow-button ${state.flow === f.id && state.mode === "flow" ? "active" : ""}" data-action="flow" data-id="${escape(f.id)}">${icon("flow")}<span>${escape(flowLabel(f))}</span></button>`).join("")}${flows.length ? "" : '<p class="source-empty-flows">当前模型没有预设场景，可用「路径」探索已有连接。</p>'}</section>`;
    const contextId = guideContext(), matching = relatedGuides(contextId), visible = guideBrowse === "all" ? flows : matching;
    const groups = GUIDE_CATEGORIES;
    return `<section class="sidebar-section guide-navigation" aria-label="源码导览"><div class="nav-heading"><span class="eyebrow">源码导览</span><span>${flows.length} 个入口</span></div><p class="navigation-hint">从上方目录中的入口出发，沿连接理解代码。</p><div class="guide-range" role="group" aria-label="导览范围"><button data-action="guide-range" data-value="context" aria-pressed="${guideBrowse === "context"}">${contextId ? "当前模块" : "推荐入口"}<small>${matching.length}</small></button><button data-action="guide-range" data-value="all" aria-pressed="${guideBrowse === "all"}">全部<small>${flows.length}</small></button></div>${contextId && guideBrowse === "context" ? `<div class="guide-scope-label" title="${escape(containers.get(contextId)?.path || label(contextId))}">${icon("layers")}与 ${escape(label(contextId))} 相关</div>` : ""}<div class="guide-card-list">${groups.map(category => {
      const items = visible.filter(f => guideInfo(f).category === category);
      if (!items.length) return "";
      return `<div class="guide-category-label">${escape(guideCategory({ category }))}<span>${items.length}</span></div>${items.map(f => {
        const info = guideInfo(f), active = state.flow === f.id && state.mode === "flow";
        return `<button class="guide-card ${active ? "active" : ""}" data-action="flow" data-id="${escape(f.id)}" aria-pressed="${active}" aria-label="打开源码导览：${escape(info.title)}，${escape(guideIntent(info))}" title="${escape(info.sourcePath)}"><span class="guide-card-purpose">${icon(info.intent === "links" ? "document" : info.intent === "calls" ? "code" : "flow")}${escape(guideIntent(info))}${active ? '<span class="guide-current">阅读中</span>' : ""}</span><strong>${escape(info.title).replaceAll("_", "_<wbr>")}</strong>${nameChip(f)}<span class="guide-card-context">${escape(info.context)}</span><span class="guide-card-counts">${info.nodeCount} 个对象<span>·</span>${info.edgeCount} 条关系${icon("arrow")}</span></button>`;
      }).join("")}`;
    }).join("")}</div>${visible.length ? '<p class="guide-footnote">这些是阅读入口；全部关系仍可在结构图和「路径」中探索。</p>' : `<div class="source-empty-flows">${flows.length ? "这个模块暂时没有推荐导览，仍可直接查看它的完整关系。" : "当前来源尚未解析出可用于导览的关系。"}${contextId ? '<button data-action="boundary-context">查看模块关系 →</button>' : '<button data-action="source-report">查看分析报告 →</button>'}${flows.length ? '<button data-action="guide-range" data-value="all">浏览全部导览 →</button>' : ""}</div>`}</section>`;
  }
  function tree(id, depth = 0) {
    const n = all.get(id);
    if (!n) return "";
    const isContainer = containers.has(id);
    const children = isContainer ? (graphIndex.children.get(id) || []) : [];
    // One fact for the caret, its label and the child rows: what 展开 has made visible.
    const expanded = isContainer && containerOpen(id);
    const guideCount = guideTreeCounts.get(id) || 0;
    return `<div class="tree-row ${state.selected === id || state.scope === id ? "active" : ""} ${isContainer ? "" : "tree-leaf"} ${guideCount ? "in-guide" : ""}"><button class="caret" data-action="expand" data-id="${id}" ${isContainer ? `aria-expanded="${expanded}" aria-label="${expanded ? "收起" : "展开"} ${escape(n.label)}" title="${expanded ? "收起：在画布与目录中合上" : "展开：在画布上显示子项"}"` : 'aria-hidden="true" tabindex="-1" style="visibility:hidden"'}>${icon(expanded ? "down" : "chevron")}</button><button class="tree-select" data-action="${isContainer ? "scope" : "select"}" data-id="${id}" ${state.selected === id ? 'aria-current="location"' : ""} title="${isContainer ? "进入 · " : ""}${escape(n.path || n.label)}"><i class="dot" style="--tone:${groupColor(n)}"></i><span class="name">${escape(n.label)}</span>${nameChip(n)}${guideCount ? `<span class="guide-tree-count" title="本导览包含 ${guideCount} 个对象" aria-label="导览包含 ${guideCount} 个对象">${guideCount}</span>` : `<span class="tree-level">L${CodeLoomLevels.depth(data, n.id)}</span>${isContainer ? `<small>${descendants(id).length}</small>` : ""}`}</button></div>${isContainer && expanded ? `<div class="tree-children">${children.map((c) => tree(c.id, depth + 1)).join("")}</div>` : ""}`;
  }
  function renderSidebar() {
    const guide = state.mode === "flow" && isSourceGuide(currentFlow()) ? currentFlow() : null;
    guideTreeCounts = new Map();
    if (guide) for (const id of guide.nodes) for (const ancestor of crumbIds(id)) guideTreeCounts.set(ancestor, (guideTreeCounts.get(ancestor) || 0) + 1);
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
      `<div class="sidebar-top"><label class="eyebrow" for="example-select">Explore a codebase</label><select id="example-select" class="example-select" aria-label="选择内置示例">${imported ? `<option value="imported" selected disabled>${generated() ? "当前分析结果" : "当前导入模型"}</option>` : ""}${Object.entries(window.SKYLENSE_MODELS || {}).map(([id, model]) => `<option value="${escape(id)}" ${!imported && id === data.meta?.id ? "selected" : ""}>${escape(model.meta.title)}</option>`).join("")}</select><div class="project-card"><strong>${escape(data.meta?.title || "Architecture")}</strong><p><span class="project-dot"></span>${data.groups.length} systems · ${count} components</p><small class="source-caption">${generated() ? "自动提取 · 可查看分析范围" : imported ? "本地导入" : `精选源码视图 · ${escape((data.meta.revision || "").slice(0, 8))}`}</small>${generated() ? `<button class="source-report-link" data-action="source-report">${icon("info")}分析报告${icon("arrow")}</button>` : ""}</div></div><div class="search-wrap">${icon("search")}<input id="search" aria-label="搜索组件、路径或函数" placeholder="搜索组件、函数…" value="${escape(state.query)}" autocomplete="off"><kbd>/</kbd></div><div id="tree-content"></div>${renderGuideNavigation()}<div class="sidebar-section" style="margin-top:18px"><div class="nav-heading"><span class="eyebrow">Saved views</span><span>${saved.length}</span></div><div id="saved-list">${saved.length ? saved.map((v, i) => `<div class="bookmark"><button class="saved-load" data-action="load-view" data-id="${i}">${escape(v.name)}</button><button class="icon-btn" data-action="delete-view" data-id="${i}" aria-label="删除视图 ${escape(v.name)}">${icon("close")}</button></div>`).join("") : '<p class="micro" style="padding:0 19px 15px">把有价值的阅读位置留在这里。</p>'}</div></div><div class="sidebar-bottom">See every layer. Follow every connection.<button class="sidebar-connect" data-action="connect">${icon("link")}连接 Agent 与终端</button></div>`;
    renderTree();
    applyLevelHighlights();
  }
  function flowLabel(f) {
    return isSourceGuide(f) ? `${guideInfo(f).title} · ${guideIntent(guideInfo(f))}` : f.label;
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
    host.innerHTML = `<div class="nav-heading"><span class="eyebrow">${generated() ? "代码结构" : "系统结构"}</span><button class="icon-btn" data-action="home" title="系统总览" aria-label="系统总览">${icon("layers")}</button></div><p class="navigation-hint">${guideTreeCounts.size ? "高亮目录与数字对应当前导览的对象。" : "按目录逐层定位；下方导览沿连接阅读。"}</p><div class="tree" tabindex="0" aria-label="代码结构目录"><div class="tree-row ${!state.scope ? "active" : ""}"><button class="tree-select" data-action="home" style="padding:8px">${icon("box")}<span class="name">系统总览</span><small>${data.groups.length}</small></button></div>${data.groups.map((g) => tree(g.id)).join("")}</div>`;
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
      `<nav class="breadcrumbs" aria-label="层级导航"><button data-action="home">${escape(data.meta?.title || "Codebase")}</button>${chain.map((id) => `${icon("chevron")}<button data-action="scope" data-id="${id}">${escape(label(id))}${nameChip(all.get(id))}</button>`).join("")}${flow ? `${icon("chevron")}<span>${isSourceGuide(flow) ? "源码导览" : nameChip(flow) ? `场景导览 · ${escape(flow.label || flow.title || flow.id)}${nameChip(flow)}` : "场景导览"}</span>` : ""}</nav><div class="page-title"><h1>${escape(title)}</h1><span class="badge">${state.lens === "global" ? "GLOBAL" : state.lens === "neighbors" ? "1 HOP" : flow ? isSourceGuide(flow) ? "GUIDE" : "FLOW" : state.scope ? `L${CodeLoomLevels.depth(data, state.scope)}` : "L0"}</span></div><p class="subtitle">${flow ? isSourceGuide(flow) ? "从目录中的入口出发，阅读同一张图里的关联对象；可随时定位或返回。" : isAuthoredScenario(flow) ? "代理解读的任务场景：逐步阅读，每步标明是经静态证明的关系、未证实的调用，还是无代码关系的叙述衔接；阅读顺序不代表执行顺序。" : "逐个阅读场景节点，查看文档描述的关联；阅读顺序不代表执行顺序。" : state.scope ? regionHoldsSplitFile(state.scope) ? "这个区域含有被按职责拆分的文件：其中的声明直接挂在区域下，没有文件边界；卡片与详情标注它们所在的真实文件。" : "展开模块边界，选择关系节点，沿层级和连接双向探索。" : recordsOf(authoring()?.regions).length ? "按代理解读划分的职责区域查看系统；区域划分是解读，文件与关系仍是解析得到的事实。" : "探索系统的组成、依赖与数据去向，从这里逐层深入。"}</p>`;
    // An untrusted authored layer: one persistent line says what is shown instead (displayModel).
    if (authoringNotice())
      $("#canvas-header").insertAdjacentHTML("beforeend", `<p class="authoring-notice">${icon("info")}代理解读层格式不正确，不予采信：${escape(authoringNotice())}。说明文字已换回解析得到的内容；代理划分的区域和代理场景另有标记。</p>`);
    // Agent-made names in the title carry their neutral chip.
    const named = flow || (state.scope ? all.get(state.scope) : null);
    if (state.lens === "scope" && nameChip(named)) $("#canvas-header .page-title h1")?.insertAdjacentHTML("afterend", nameChip(named));
    // Without an orientation landing the coverage of the authored layer still has to be visible.
    if (authoring() && !orientationLanding()) $("#canvas-header").insertAdjacentHTML("beforeend", coverageSummary(authoring(), true));
  }
  function renderStory() {
    const f =
      state.lens === "scope" && state.mode === "flow" ? currentFlow() : null;
    if (!f) {
      $("#story").innerHTML = "";
      return;
    }
    state.step = Math.min(Math.max(state.step, 0), f.nodes.length - 1);
    if (isSourceGuide(f)) {
      const info = guideInfo(f);
      $("#story").innerHTML = `<section class="guide-story" aria-label="当前源码导览"><div class="guide-story-context"><span>${icon("flow")}入口 <b>${escape(info.title)}</b><small>${escape(info.context)}</small></span><div class="guide-story-actions"><button class="btn" data-action="guide-locate">${icon("layers")}在目录中定位</button><button class="btn" data-action="guide-return">${icon("back")}${guideOrigin?.model === data ? "返回原位置" : "返回模块结构"}</button></div></div><div class="guide-reader"><label for="guide-node-select">关联对象 <span>${state.step + 1} / ${f.nodes.length}</span></label><button class="icon-btn" data-action="prev-step" aria-label="上一个关联对象" ${state.step === 0 ? "disabled" : ""}>${icon("back")}</button><select id="guide-node-select" aria-label="导览中的对象">${f.nodes.map((id, i) => `<option value="${i}" ${i === state.step ? "selected" : ""}>${escape(guideNodeLabel(id, f))}</option>`).join("")}</select><button class="icon-btn" data-action="next-step" aria-label="下一个关联对象" ${state.step === f.nodes.length - 1 ? "disabled" : ""}>${icon("arrow")}</button><span class="guide-reader-count">${info.edgeCount} 条关系</span></div>${guideStepBlock(f)}<p class="guide-reading-note">关联可有分支；这里的阅读顺序不代表执行顺序。</p></section>`;
      return;
    }
    $("#story").innerHTML =
      `<div class="story-strip"><button class="icon-btn" data-action="prev-step" aria-label="上一个场景节点" ${state.step === 0 ? "disabled" : ""}>${icon("back")}</button><div><strong>${String(state.step + 1).padStart(2, "0")} / ${f.nodes.length} · ${escape(label(f.nodes[state.step]))}</strong><p>${isAuthoredScenario(f) ? `${escape(f.label || f.title || f.id)} · 代理解读的任务场景 · ${listOf(f.steps).some(scenarioStepNarrative) ? "沿代码关系与叙述衔接阅读" : "沿已存在的关系阅读"}，非运行轨迹` : generated() ? "静态依赖阅读 · 非运行轨迹" : "文档场景 · 点击右箭头继续探索"}</p></div><span class="spacer"></span><div class="story-progress">${f.nodes.map((id, i) => `<button class="${i <= state.step ? "active" : ""}${isAuthoredScenario(f) && scenarioStepUnproven(listOf(f.steps)[i]) ? " unproven" : ""}${isAuthoredScenario(f) && scenarioStepNarrative(listOf(f.steps)[i]) ? " narrative" : ""}" data-action="step" data-id="${i}" title="${escape(label(id))}${isAuthoredScenario(f) && scenarioStepNarrative(listOf(f.steps)[i]) ? " · 叙述衔接 · 无代码关系" : ""}" aria-label="阅读 ${escape(label(id))}"></button>`).join("")}</div><button class="icon-btn" data-action="next-step" aria-label="下一个场景节点" ${state.step === f.nodes.length - 1 ? "disabled" : ""}>${icon("arrow")}</button></div>${isAuthoredScenario(f) ? scenarioStory(f) : guideStepBlock(f)}`;
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
  /* How many relation capsules one screen can carry legibly. D11 rejects thousands of nodes and
     labels on one screen; what is not drawn gets a count and a "view all" entry. */
  const RELATION_DRAW_BUDGET = 60;
  const sceneCache = new Map(), canvasPages = new Map();
  let layoutContextKey = "";
  function immediateChildren(id) { return graphIndex.children.get(id) || []; }
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
    /* How many candidates this view leaves out: the guide's own when reading one, otherwise
       every candidate the relation filter keeps off the model's map. */
    const typed = (id) => state.type === "all" || graphIndex.edges.get(id)?.type === state.type;
    const contextCandidates = state.showCandidates || state.lens !== "scope"
      ? null
      : state.trace
        ? traceCandidates(state.trace)
        : f
          ? (f.edgeIds || data.edges.filter((e) => f.nodes.includes(e.source) && f.nodes.includes(e.target)).map((e) => e.id))
              .filter((id) => candidateIds.has(id) && typed(id)).length
          : null;
    const progressive = generated() && data.nodes.length > 200 && mode === "components" && !focusNodes;
    if (progressive) { mode = "hierarchy"; open = []; if (!scope && data.groups.length === 1) scope = data.groups[0].id; }
    layoutContextKey = JSON.stringify([scope, mode, state.lens, state.type, state.showCandidates, focusNodes]);
    const page = canvasPages.get(layoutContextKey), pageSize = generated() && data.nodes.length > 200 ? focusNodes ? 24 : 12 : 120;
    const categoryGroups = state.categoryGroups && categoryGroupingAvailable();
    /* The selection is not in the key: it reaches the scene only as `revealIds`, and a scene
       built for one reveal says (sharesReveal) whether another would build it identically. So a
       selection that changes nothing laid out reuses the layout and its routing. */
    const key = JSON.stringify([
      page, pageSize,
      categoryGroups,
      scope,
      mode,
      open,
      state.bundle,
      RELATION_DRAW_BUDGET,
      edges.map((e) => e.id),
      focusNodes,
    ]);
    const revealIds = state.selected ? [state.selected] : [];
    if (!sceneCache.has(key)) {
      if (sceneCache.size > 20) sceneCache.clear();
      sceneCache.set(key, []);
    }
    const variants = sceneCache.get(key);
    let result = variants.find((scene) => scene.sharesReveal(revealIds));
    if (!result) {
      if (variants.length >= 8) variants.shift();
      result = CodeLoomScene.build(data, {
        categoryGroups,
        page, pageSize, maxVisible: generated() && data.nodes.length > 200 ? 24 : 120, revealIds,
        /* Relation capsules are read, not merely seen: a screenful holds a few dozen legibly.
           Beyond this budget the canvas reports the count and offers the full list instead of
           stacking labels (plan §11.3). The complete projection stays in the scene. */
        maxRelations: RELATION_DRAW_BUDGET,
        scope,
        mode,
        open,
        edges,
        focusNodes,
        bundle: state.bundle,
      });
      variants.push(result);
    }
    result.progressive = progressive;
    result.hiddenCandidates = contextCandidates === null
      ? { count: hiddenCandidates().total, within: "model" }
      : { count: contextCandidates, within: "view" };
    return result;
  }
  /** Human wording for every way a saved view can fail to come back. */
  function recoveryMessage(recovery) {
    const token = recovery.relationRef || recovery.issues?.find((issue) => issue.token)?.token || "";
    switch (recovery.reason) {
      case "snapshotMismatch":
        return `此链接绑定的快照 ${recovery.snapshotId} 与当前模型的快照 ${recovery.currentSnapshotId} 不同。相同的 ID 不会被直接套用到新的事实上。`;
      case "missing-reference":
        return `本地没有找到引用 ${token} 对应的成员清单。链接保留了这个引用，没有改写成别的选择。`;
      case "membership-changed":
        return `引用 ${token} 的成员摘要与当前快照重新计算的结果不一致，已停止恢复这次选择。`;
      case "missing-members":
        return "保存的选择中有成员在当前快照里不存在，不能把剩下的部分当作完整选择。";
      case "not-persisted":
        return `浏览器无法保存视图 ${token}；当前选择仍然有效，但刷新后无法从本地恢复。`;
      default:
        return "这个链接无法完整解析，已回到可用的视图。";
    }
  }
  /**
   * A saved view that cannot be restored is stated, never hidden: the reason, the snapshot or
   * reference it names, and the options to keep reading, relocate, export or open the original.
   */
  function renderRecovery() {
    const host = $("#view-recovery");
    if (!host) return;
    const recovery = state.viewRecovery;
    if (!recovery) {
      host.innerHTML = "";
      return;
    }
    host.innerHTML = `<div class="view-recovery" role="status"><div class="view-recovery-text"><b>${icon("info")}保存的视图未能完整恢复 · ${escape(recovery.reason)}</b><p>${escape(recoveryMessage(recovery))}</p><small>${escape(
      (recovery.issues || []).map((issue) => `${issue.role || "view"}:${issue.reason}${issue.token ? ` (${issue.token})` : ""}`).join(" · "),
    )}</small></div><div class="view-recovery-actions"><button class="btn" data-action="recovery-keep">继续按当前快照阅读</button><button class="btn" data-action="recovery-locate">重新定位选择</button><button class="btn" data-action="recovery-export">${icon("download")}导出可移植视图</button><button class="btn" data-action="import">${icon("plus")}打开原快照模型</button></div></div>`;
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
        type: relationFilter(),
      }),
      count = ctx.incoming.length + ctx.outgoing.length;
    host.innerHTML = count
      ? `<div class="outside-strip"><span>${icon("external")}范围外还有 <b>${count}</b> 条直接关系</span><span class="outside-counts">入向 ${ctx.incoming.length} · 出向 ${ctx.outgoing.length}</span><button data-action="boundary-context">查看模块上下游 ${icon("arrow")}</button></div>`
      : "";
  }
  /** Declared semantic groups of the current model, projected once per model revision. */
  function relationGroups() {
    if (!groupIndex) groupIndex = Hypergraph ? Hypergraph.projectGroups(data.analysis, []) : [];
    return groupIndex;
  }
  function groupById(id) {
    return relationGroups().find((group) => group.id === id) || null;
  }
  /** Groups that own at least one of these binary edges. */
  function groupsForEdges(edgeIds) {
    return Hypergraph ? Hypergraph.groupsForEdges(relationGroups(), edgeIds) : [];
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
          `<div class="group-boundary nested-boundary" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;--depth:${b.depth}"><button class="boundary-title" data-action="scope" data-id="${escape(b.id)}" aria-label="进入 ${escape(label(b.id))}" title="进入模块：以它为当前范围">${icon("layers")}${escape(label(b.id))}${icon("chevron")}</button><button class="boundary-collapse" data-action="canvas-collapse" data-id="${escape(b.id)}" aria-label="收起 ${escape(label(b.id))}" title="收起：在画布与目录中合上">${icon("minus")}</button></div>`,
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
        return `<button class="relation-hub shape-${shape.key} ${relationActive(r, focus) ? "active" : ""} ${chosen ? "selected" : ""}" style="left:${h.x}px;top:${h.y}px;width:${h.w}px;height:${h.h}px;${typeStyle(r.type)}" data-action="relation" data-id="${escape(r.id)}" data-relation-peek="${escape(r.id)}" aria-label="关系标注 ${escape(relationTitle(r))}，${escape(t.shortLabel)}，${shape.cardinality}，${r.edgeIds.length} 条边" title="${escape(shape.label)} · ${escape(t.label)} · ${escape(actionLabels(r.edges).join(" / "))}"><span class="hub-glyph">${icon(shape.icon)}</span><span class="hub-copy"><strong>${escape(relationTitle(r))}</strong>${(() => { const roles = [...new Set(r.edges.map(authoredLabelOf).filter(Boolean))]; return roles.length === 1 ? `<small class="hub-role" title="作用标签由作者宿主拟定，不是解析得到的事实，也不经核验。">代理命名 · ${escape(roles[0])}</small>` : ""; })()}</span>${r.edgeIds.length > 1 ? `<b class="member-count">${r.edgeIds.length}</b>` : ""}</button>`;
      })
      .join("");
    const nodeHTML = layout.items
      .map((p) => {
        const n = p.n,
          isContainer = containers.has(n.id),
          counts = graphIndex.boundary(n.id, relationFilter()),
          memberIds = members(n.id),
          selected = selectedIds.has(n.id),
          t = CodeLoomSemantics.node(n.kind);
        const internal = counts.internal.length,
          kids = isContainer ? immediateChildren(n.id) : [];
        // A container card shows only its name (never graded: a name is not a claim); an object
        // card shows its one-line text, graded by that field's own claim.
        const markStatus = isContainer ? null : fieldGrade(n, shownTextField(n));
        return `<div class="node-wrap kind-${t.key} ${isContainer ? "is-boundary" : ""}" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;--tone:${groupColor(n)};--ink:${semanticInk(t)}"><button class="graph-node ${selected ? "selected" : ""}" style="width:${p.w}px;height:${p.h}px" data-action="select" data-id="${escape(n.id)}" data-peek="${escape(n.id)}" aria-label="${escape(n.label)}${isContainer ? "，双击或按右方向键展开" : ""}"><span class="node-top"><span class="node-icon">${icon(t.icon)}</span><span><span class="node-label">${escape(n.label)}</span><span class="node-kind">${escape(t.label)} · L${CodeLoomLevels.depth(data, n.id)}${markStatus ? `<i class="interpretation-mark" data-status="${markStatus}" title="卡片上的说明文字是代理解读 · ${INTERPRETATION_GRADES[markStatus]}">代理解读</i>` : ""}${nameChip(n)}${roleChip(n)}${splitFileOf(n) ? `<i class="split-file-mark" title="${escape(`所在文件 ${n.path} 已按职责拆分到多个区域；这里没有文件边界`)}">${escape(n.path.split("/").at(-1))}</i>` : ""}</span></span></span><span class="node-description">${isContainer ? `${kids.length} 个直接子项 · ${memberIds.length} 个组件` : escape(n.summary || n.description || "")}</span>${
          isContainer
            ? `<span class="child-preview">${kids
                .slice(0, 2)
                .map(
                  (c) => `<span>${icon(kindIcon(c))}${escape(c.label)}</span>`,
                )
                .join("")}</span>`
            : ""
        }<span class="node-footer"><span>${isContainer ? internal + " 条内部关系" : n.sourceRole === "symbol" ? "源码声明" : (n.functions || []).length + (generated() ? " 个符号" : " 个函数")}</span><span>入 ${counts.incoming.length} · 出 ${counts.outgoing.length}</span></span></button>${isContainer ? `<button class="node-expand" data-action="canvas-expand" data-id="${escape(n.id)}" aria-label="展开 ${escape(n.label)}" title="展开：在画布上显示子项">${icon("plus")}</button>` : ""}</div>`;
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
            ? `关系详情 · ${state.trace.edges.length} 条原始边`
            : state.trace
              ? state.trace.kind === "path"
                ? state.trace.error ? `路径待调整 · ${escape(pathError(state.trace.error))}` : `关系路径 · ${state.trace.plan.stops.length - 2} 个必经点 · ${state.trace.steps.length} 跳 · ${state.trace.plan.direction === "both" ? "双向关联（箭头保留原方向）" : state.trace.plan.direction === "upstream" ? "逆向阅读（箭头保留原方向）" : "沿箭头阅读"}`
                : state.trace.direction
                ? `${state.trace.direction === "upstream" ? "上游" : "下游"}可达关系 · ${state.trace.nodes.length} 个组件`
                : `${escape(label(state.trace.start))} → ${escape(label(state.trace.end))}`
              : `${layout.items.length} 个可见节点 · ${layout.relations.length} 个关系节点${layout.progressive ? " · 按模块逐层阅读完整索引" : " · 点击关系查看成员与层级"}`;
    /* The per-endpoint / aggregated control lives in the structure bar, which is not rebuilt
       when only the canvas re-renders. Its `aria-pressed` and its label are the same fact as
       `state.bundle`, so they are written here: a toggle that keeps reporting the state it left
       behind lies to a screen reader and to the reader watching it. */
    const bundleControl = $('[data-action="toggle-bundles"]');
    if (bundleControl) {
      bundleControl.setAttribute("aria-pressed", String(state.bundle));
      bundleControl.innerHTML = icon("flow") + (state.bundle ? "关系汇聚" : "按端点显示");
    }
    $("#canvas-note").innerHTML =
      icon("flow") +
      `<span>${note}${layout.projection?.limited ? ` · 已按层级折叠 ${layout.projection.totalNodes} 个对象，展开模块继续阅读` : ""}${blocked ? ` · ${blocked} 条支线未能路由（可在关系详情查看）` : ""}${layout.hiddenCandidates?.count ? `<span class="hidden-candidates-note"> · ${layout.hiddenCandidates.within === "view" ? "本视图" : "图中"}隐藏 ${layout.hiddenCandidates.count} 条未证实的候选关系（图例中可显示）</span>` : ""}</span>`;
    const paging = layout.projection?.paging;
    if (paging?.totalPages > 1) $("#canvas-note").insertAdjacentHTML("beforeend", `<div class="canvas-paging"><button data-action="canvas-page" data-value="${paging.page - 1}" ${paging.page === 0 ? "disabled" : ""} aria-label="上一页对象">←</button><span>${paging.page + 1} / ${paging.totalPages} 页 · ${paging.totalItems} 个对象${paging.offPageEdgeCount ? ` · ${paging.offPageEdgeCount} 条跨页关系保留在完整索引` : ""}</span><button data-action="canvas-page" data-value="${paging.page + 1}" ${paging.page + 1 === paging.totalPages ? "disabled" : ""} aria-label="下一页对象">→</button></div>`);
    /* An expanded container whose children do not fit the reading budget is drawn closed; say
       so, with the distinct verb that does open it, instead of letting the expand look ignored. */
    const unfitIds = hierarchyCanvas()
      ? state.openContainers.filter((id) => id !== state.scope && containerOpen(id) && immediateChildren(id).length && layout.items.some((p) => p.n.id === id))
      : [];
    const unfit = unfitIds.includes(state.selected) ? state.selected : unfitIds[0];
    if (unfit)
      $("#canvas-note").insertAdjacentHTML(
        "beforeend",
        `<span class="expand-over-budget"> · 「${escape(label(unfit))}」的 ${immediateChildren(unfit).length} 个子项超出本屏阅读预算，未能就地展开</span><button data-action="scope" data-id="${escape(unfit)}" style="pointer-events:auto;color:var(--accent)">进入模块阅读</button>`,
      );
    /* What the canvas does not draw must be counted and reachable, never silently missing. */
    const relationView = layout.relationProjection;
    if (relationView?.limited)
      $("#canvas-note").insertAdjacentHTML(
        "beforeend",
        `<span> · 本屏绘制 ${relationView.drawn} / ${relationView.total} 个关系枢纽，另有 ${relationView.deferred} 个（${relationView.deferredEdgeCount} 条原始边）保留在完整索引</span><button data-action="all-relations" style="pointer-events:auto;color:var(--accent)">查看全部关系</button>`,
      );
    const foldedSelection = state.relation
      ? layout.internal
          .flatMap((entry) => entry.edgeIds)
          .filter((id) => state.relation.edgeIds.includes(id)).length
      : 0;
    if (foldedSelection) {
      $("#canvas-note").insertAdjacentHTML(
        "beforeend",
        `<span> · 所选 ${foldedSelection} 条边位于高亮模块内部</span><button data-action="relation-detail" style="pointer-events:auto;color:var(--accent)">查看关系详情</button>`,
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
    state.camera = fittedCamera(layout, canvas.clientWidth, canvas.clientHeight, 48, canvas.clientHeight < 460 ? 68 : 88);
    applyCamera();
  }
  /** The camera that fits a layout's visible geometry into a width × height viewport, leaving
   *  `top` and `bottom` for the controls drawn over it. */
  function fittedCamera(scene, viewWidth, viewHeight, top, bottom) {
    // Fit visible geometry, not the scene's routing/export margins. Reserving
    // those margins twice made text needlessly small in shorter windows.
    const rects = [
      ...scene.items,
      ...scene.bounds,
      ...(scene.categoryBounds || []),
      ...scene.hubs,
    ];
    const points = [
      ...rects.flatMap((r) => [
        { x: r.x, y: r.y },
        { x: r.x + r.w, y: r.y + r.h },
      ]),
      ...scene.wires.filter((w) => !w.blocked).flatMap((w) => w.points),
    ];
    const minX = points.length ? Math.min(...points.map((p) => p.x)) : 0;
    const minY = points.length ? Math.min(...points.map((p) => p.y)) : 0;
    const width = Math.max(
      1,
      points.length ? Math.max(...points.map((p) => p.x)) - minX : scene.width,
    );
    const height = Math.max(
      1,
      points.length
        ? Math.max(...points.map((p) => p.y)) - minY
        : scene.height,
    );
    const availableHeight = Math.max(1, viewHeight - top - bottom);
    const z = Math.min(
      1.16,
      Math.max(
        0.13,
        Math.min((viewWidth - 40) / width, availableHeight / height),
      ),
    );
    return {
      x: (viewWidth - width * z) / 2 - minX * z,
      y: top + (availableHeight - height * z) / 2 - minY * z,
      z,
    };
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
  /* Panels the reader scrolls independently of the canvas camera. A re-render replaces their
     innerHTML, which resets the offset, so appearance-only changes must carry it across. */
  const SCROLL_PANELS = ["#inspector .inspector-content", "#tree-content", "#sidebar", "#story", "#compare-strip"];
  /** Run a re-render without costing the reader their place in the scrolled panels. */
  function preserveScroll(run) {
    const offsets = [];
    for (const selector of SCROLL_PANELS) {
      const panel = $(selector);
      const top = panel?.scrollTop || 0, left = panel?.scrollLeft || 0;
      if (top || left) offsets.push({ selector, top, left });
    }
    run();
    for (const entry of offsets) {
      const panel = $(entry.selector);
      if (!panel) continue;
      panel.scrollTop = entry.top;
      panel.scrollLeft = entry.left;
    }
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
    /* Pointer events carry mouse, pen and touch alike, so one book-keeping map serves all
       three. Two live pointers mean a pinch: the camera scales by the ratio of the finger
       distance around the midpoint between them, which is the only way to zoom on a phone
       — there is no wheel, and `touch-action: none` (style.css) means the browser will not
       do it for us. Lifting back to one pointer resumes panning from where that finger
       currently is, so the canvas never jumps. */
    const pointers = new Map();
    let pinch = null;
    /* The two most recent pointers, so a third finger — or a stale entry a driver or a lost
       capture left behind — narrows the gesture instead of cancelling it. */
    const measurePinch = () => {
      const [a, b] = [...pointers.values()].slice(-2);
      return { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    const panFrom = (point) => { drag = { x: point.x, y: point.y, cx: state.camera.x, cy: state.camera.y }; };
    canvas.addEventListener("pointerdown", (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2) {
        /* A second finger is always a gesture, even when the first landed on a card:
           pinching belongs to the canvas, tapping belongs to the control. Gesture
           pointers are deliberately not captured, so the single-pointer tap that
           started on a card still reaches it. */
        drag = null;
        canvas.classList.remove("dragging");
        pinch = measurePinch();
        return;
      }
      if (e.target.closest("button,input,select,[data-action]")) return;
      canvas.setPointerCapture(e.pointerId);
      panFrom({ x: e.clientX, y: e.clientY });
      canvas.classList.add("dragging");
      hidePeek();
    });
    canvas.addEventListener("pointermove", (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2) {
        const next = measurePinch();
        if (pinch && pinch.distance > 0 && next.distance > 0) {
          const box = canvas.getBoundingClientRect();
          zoom(next.distance / pinch.distance, next.x - box.left, next.y - box.top);
        }
        pinch = next;
        return;
      }
      if (!drag) return;
      state.camera.x = drag.cx + e.clientX - drag.x;
      state.camera.y = drag.cy + e.clientY - drag.y;
      applyCamera();
    });
    const release = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 1) { panFrom([...pointers.values()][0]); canvas.classList.add("dragging"); return; }
      if (pointers.size === 0) { drag = null; canvas.classList.remove("dragging"); }
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("lostpointercapture", release);
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
    state.relationGroup = null;
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
    // Selecting a candidate relation is an explicit request to see it: reveal, and say so.
    if (!state.showCandidates && edgeIds.some((id) => candidateIds.has(id))) {
      state.showCandidates = true;
      layout = buildLayout();
      toast("所选关系包含未证实的候选关系，已显示候选关系；可在图例中再次隐藏。");
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
    // An authored reason replaces the description (its own claim, `fields.description`); the
    // parsed description stays as the secondary line. Without that claim the text is derived.
    const reasonClaim = fieldClaim(e, "description");
    const text = reasonClaim && claimRecord(reasonClaim) && textOf(e.description)
      ? authoredStatement(e.description, claimStatus(reasonClaim), claimEvidence(reasonClaim), textOf(e.derivedDescription))
      : e.description ? `<p>${escape(e.description)}</p>` : "";
    return `<div class="edge-evidence-note"><span class="badge">${escape(kinds[e.evidenceStatus] || e.evidenceStatus || "作者整理")}</span>${roleChip(e)}${text}</div>`;
  }
  function rawEdgeCard(e) {
    if (!e) return "";
    return `<button class="relation-member" data-action="raw-edge" data-id="${escape(e.id)}" style="${typeStyle(e.type)}"><small>${escape(e.id)} ${typeBadge(e.type)}</small><b>${escape(label(e.source))} <span class="inline-arrow">→</span> ${escape(label(e.target))}</b><span>${escape(e.label || e.type)}</span>${roleChip(e)}${icon("chevron")}</button>`;
  }
  const ROLE_LABELS = {
    input: "输入 / input", validator: "校验 / validator", artifact: "产物 / artifact",
    caller: "调用方 / caller", candidate: "候选 / candidate", source: "来源 / source", target: "目标 / target",
  };
  const roleLabel = (role) => ROLE_LABELS[role] || role;
  /** What a declared activation condition does and does not assert. */
  function activationNote(group) {
    /* An undeclared or unevaluable condition is unknown. It must not be dressed up as either
       all-of or any-of, and it is never reported as satisfied. */
    const label = group.activation === "all" ? "all-of" : group.activation === "any" ? "any-of" : "unspecified";
    const unknown = group.activationEvaluable === false
      ? ` · 该条件无法求值${group.activationUnknownReason ? `（${escape(group.activationUnknownReason)}）` : ""}，保持未知`
      : "";
    return `${label} · ${escape(group.activationNote)}${unknown}`;
  }
  /**
   * A semantic RelationGroup card. Collapsed it states totals and direction; expanded it names
   * every participant role. It never claims the members were executed together.
   */
  function relationGroupCard(group, { open = false, action = true } = {}) {
    const participants = group.participants.length
      ? group.participants
          .map(
            (item) =>
              `<li class="group-participant" data-role="${escape(item.role)}"><b>${escape(roleLabel(item.role))}</b><span>${escape(label(item.nodeId))}</span><small>${escape(item.direction)} · ${escape(item.id)}</small></li>`,
          )
          .join("")
      : `<li class="group-participant"><b>${escape("成员端点 / endpoints")}</b><span>${group.members.map((m) => escape(label(m.sourceId))).join(" · ")}</span></li>`;
    const required = group.requiredParticipantIds.length
      ? `<p class="micro">requiredParticipantIds: ${group.requiredParticipantIds.map(escape).join(", ")}</p>`
      : "";
    const completeness = group.candidateCompleteness
      ? `<p class="micro">候选完整性 candidateCompleteness: ${escape(group.candidateCompleteness)}</p>`
      : "";
    return `<details class="relation-group-card" data-group-id="${escape(group.id)}" ${open ? "open" : ""}><summary><span class="eyebrow">RelationGroup · ${escape(group.semantics)}</span><b>${escape(group.id)}</b><span class="group-totals">${group.totals.members} 条成员边 · ${group.totals.participants} 个参与者 · ${group.totals.evidence} 条依据 · 入 ${group.direction.input.length} / 出 ${group.direction.output.length}</span><span class="group-activation">activation ${activationNote(group)}</span></summary><ul class="group-roles">${participants}</ul>${required}${completeness}<div class="group-members">${group.memberEdgeIds.map((id) => rawEdgeCard(edgeById(id))).join("")}</div>${action ? `<button class="btn wide-btn" data-action="relation-group" data-id="${escape(group.id)}">${icon("flow")}查看这个语义关系组</button>` : ""}</details>`;
  }
  /** Inspector for a selected semantic group: identity, roles, activation, members, evidence. */
  function renderGroupInspector() {
    const group = state.relationGroup;
    const members = group.memberEdgeIds.map(edgeById).filter(Boolean);
    const body =
      state.tab === "members"
        ? `<div class="detail-intro"><b>${members.length} 条成员边</b><p>组只声明参与关系，成员的原始配对与方向保持不变。</p></div>${members.map(rawEdgeCard).join("")}`
        : state.tab === "evidence"
          ? `<div class="detail-intro"><b>组与成员的依据</b><p>${group.totals.evidence} 条依据标识；组本身不产生新的事实。每条标识可点开真实原文、区间与来源文件。</p></div>${evidenceChips([...group.evidenceIds], "没有附带依据标识。")}${members.map((e) => `<details class="evidence-card"><summary>${escape(e.id)} · ${escape(e.label || e.type)}</summary>${edgeEvidenceNote(e)}${(e.evidenceIds || []).length ? evidenceChips([...e.evidenceIds], "") : ""}</details>`).join("")}`
          : `${relationGroupCard(group, { open: true, action: false })}<div class="section-label">参与者角色</div><div class="participant-section">${group.nodeIds.map(relationEndpoint).join("")}</div><details class="semantic-note" open><summary>这个关系组表示什么？</summary><p>${group.activation === "all" ? "all-of 表示声明中的联合参与条件：这些参与者被一起声明，不代表运行时一起执行。" : group.activation === "any" ? "any-of 表示候选集合：其中任意一个可能是真实目标，不能画成全部被调用。" : "activation 未声明或无法求值：联合参与条件未知。它既不是 all-of，也不是候选集合，不能当作已满足。"}</p>${group.missingParticipantRefs?.length ? `<p class="micro">声明中引用了不存在的参与者：${group.missingParticipantRefs.map(escape).join("、")}。该组仍可查看，但这些引用未被采信。</p>` : ""}${group.rolesBasis === "member-endpoints" ? '<p class="micro">这里的角色由成员端点推导，不是声明中的角色。</p>' : ""}<p>成员边、角色与依据在折叠、展开、筛选和聚合中保持一致。</p></details>`;
    $("#inspector").innerHTML =
      `<div class="inspector-top"><div class="inspector-label"><span class="eyebrow">语义关系组 · RelationGroup</span><div class="inspector-tools"><button class="icon-btn" data-action="back-selection" aria-label="返回上一步" ${readingHistory.length ? "" : "disabled"}>${icon("back")}</button><button class="icon-btn mobile-toggle" data-action="close-inspector" aria-label="关闭详情">${icon("close")}</button></div></div><div class="inspector-title"><span class="node-icon relation-icon">${icon("flow")}</span><div><h2>${escape(group.id)}</h2><p>${escape(group.semantics)} · activation ${escape(group.activationLabel)} · ${group.totals.members} 条成员边 · ${group.totals.participants} 个参与者</p></div></div><div class="inspect-actions"><button class="btn" data-action="relation-group-members" data-id="${escape(group.id)}">${icon("flow")}选中全部成员边</button><button class="btn" data-action="clear-group">${icon("close")}退出关系组</button></div></div><div class="inspector-tabs">${[
        ["overview", "概览"],
        ["members", "成员 " + members.length],
        ["evidence", "依据"],
      ]
        .map(
          ([id, text]) =>
            `<button data-action="tab" data-value="${id}" class="${state.tab === id ? "active" : ""}">${text}</button>`,
        )
        .join("")}</div><div class="inspector-content">${body}</div><div class="inspector-footer">${icon("link")}声明的参与关系 · 不是运行轨迹</div>`;
    applyLevelHighlights();
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
    // A binary relation or visual bundle may be a member of declared semantic groups. Those
    // groups carry the roles and the activation condition the pair itself never states.
    const owningGroups = groupsForEdges(edges.map((e) => e.id));
    const groupSection = owningGroups.length
      ? `<div class="section-label">所属语义关系组 <span>${owningGroups.length} 组</span></div>${owningGroups.map((group) => relationGroupCard(group)).join("")}`
      : "";
    let body = "";
    if (state.tab === "context") body = contextBody();
    else if (state.tab === "evidence")
      body = `<div class="detail-intro"><b>关系的原始依据</b><p>每条边的 ID、配对、方向和原文分别保留。</p></div>${edges.map((e) => `<details class="evidence-card" ${edges.length === 1 ? "open" : ""}><summary>${escape(e.id)} · ${escape(e.label || e.type)}</summary>${edgeEvidenceNote(e)}${(e.evidence || []).map((ref) => `<small>${escape(ref.file)} · ${ref.lineStart}–${ref.lineEnd}</small>${evidenceLink(ref)}<pre>${escape(ref.excerpt)}</pre>`).join("") || '<p class="micro">没有附带原文摘录。</p>'}${(e.evidenceIds || []).length ? evidenceChips([...e.evidenceIds], "") : ""}</details>`).join("")}`;
    else if (state.tab === "members")
      body = `<div class="detail-intro"><b>${edges.length} 条原始成员边</b><p>按真实来源 → 目标查看配对。点击成员可继续定位两端与依据。</p></div>${edges.map(rawEdgeCard).join("")}`;
    else
      body = `${state.relation.parentEdgeIds ? `<button class="return-relation" data-action="relation-parent">${icon("back")}返回上一级关系束 · ${state.relation.parentEdgeIds.length} 条边</button>` : ""}<div data-section="type"><div class="relation-contract" style="${typeStyle(types[0])}"><div>${icon(shape.icon)}<b>${shape.label}</b><span>${shape.cardinality}</span></div><p>${labels.map((l) => `<span>${escape(l)}</span>`).join("")}</p>${types.map(typeBadge).join("")}</div></div><div data-section="participants"><div class="section-label">参与者 <span>${sources.length} 来源 · ${targets.length} 目标</span></div><div class="participant-section"><div class="participant-heading">${icon("back")}来源 / SOURCES</div>${sources.map(relationEndpoint).join("")}</div><div class="participant-section"><div class="participant-heading">${icon("arrow")}目标 / TARGETS</div>${targets.map(relationEndpoint).join("")}</div></div><div data-section="condition">${groupSection || '<p class="micro">这条关系没有声明参与条件或组语义；箭头只表示模型内关系的方向，不表示运行时行为。</p>'}</div><div data-section="aggregation"><button class="btn wide-btn" data-action="tab" data-value="members">逐条查看 ${edges.length} 条原始边 ${icon("arrow")}</button>${contextSummary()}<div class="section-label" style="margin-top:22px">所在层级</div><button class="relation-parent-scope" data-action="scope" data-id="${escape(common || "")}">${icon("layers")}${escape(common ? label(common) : "跨系统关系")}${icon("arrow")}</button><details class="semantic-note"><summary>这类关系束表示什么？</summary><p>关系束组织具有共同端点或语义的原始边。它保留每条配对，不单独证明多个参与者联合执行。</p></details></div><div data-section="evidence">${edges.length === 1 ? edgeEvidenceNote(edges[0]) : '<p class="micro">每条成员的依据与推导说明可在「依据」中查看。</p>'}${edges.slice(0, 3).map((e) => (e.evidence || []).map((ref) => `<small>${escape(ref.file)} · ${ref.lineStart}–${ref.lineEnd}</small><pre class="evidence-excerpt">${escape(ref.excerpt)}</pre>`).join("")).join("")}<button class="btn wide-btn" data-action="tab" data-value="evidence">全部依据 ${icon("arrow")}</button></div>`;
    $("#inspector").innerHTML =
      `<div class="inspector-top"><div class="inspector-label"><span class="eyebrow">${shape.label} · Relation</span><div class="inspector-tools"><button class="icon-btn" data-action="back-selection" aria-label="返回上一步" ${readingHistory.length ? "" : "disabled"}>${icon("back")}</button><button class="icon-btn mobile-toggle" data-action="close-inspector" aria-label="关闭详情">${icon("close")}</button></div></div><div class="inspector-title"><span class="node-icon relation-icon" style="${typeStyle(types[0])}">${icon(shape.icon)}</span><div><h2>${escape(title)}</h2><p>${edges.length} 条原始边 · ${shape.cardinality} · ${types.map((t) => CodeLoomSemantics.relation(t).shortLabel).join(" / ")}</p></div></div><div class="inspect-actions"><button class="btn" data-action="relation-up" ${!state.scope && !state.trace ? "disabled" : ""}>${icon("layers")}上层聚合</button><button class="btn" data-action="relation-detail">${icon("flow")}组件级关系</button></div></div><div class="inspector-tabs">${[
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
    if (state.relationGroup) {
      renderGroupInspector();
      return;
    }
    if (state.relation) {
      renderRelationInspector();
      return;
    }
    const n = all.get(state.selected),
      panel = $("#inspector");
    claimPageFor(n?.id ?? null);
    // Any trusted authored layer (with or without regions) shows its panel and coverage at home.
    if (!n && authoring()) {
      panel.innerHTML = orientationPanel();
      return;
    }
    if (!n) {
      panel.innerHTML = `<div class="inspector-top"><div class="eyebrow">Architecture context</div></div><div class="inspector-content"><h2 class="empty-title">从一个对象开始探索</h2><p class="detail-text">选择组件、模块边界或关系节点，查看它是什么、连接谁，以及在完整系统中的位置。</p><button class="btn" data-action="legend">${icon("info")}查看颜色与形状图例</button><div class="section-label" style="margin-top:24px">系统区域</div>${data.groups.map((g) => `<button class="connection" data-action="scope" data-id="${escape(g.id)}"><i class="dot" style="--tone:${g.color}"></i><span>${escape(g.label)}<small>${members(g.id).length} 个组件</small></span>${icon("arrow")}</button>`).join("")}</div>`;
      return;
    }
    const inc = incident(n.id),
      isContainer = containers.has(n.id),
      t = CodeLoomSemantics.node(n.kind);
    panel.innerHTML = `<div class="inspector-top"><div class="inspector-label"><span class="eyebrow">${isContainer ? "层级边界" : "组件"} · ${escape(t.label)}</span><div class="inspector-tools"><button class="icon-btn" data-action="back-selection" aria-label="返回上一步" ${readingHistory.length ? "" : "disabled"}>${icon("back")}</button><button class="icon-btn" data-action="compare" data-id="${escape(n.id)}" aria-label="加入节点对照">${icon("compare")}</button><button class="icon-btn mobile-toggle" data-action="close-inspector" aria-label="关闭详情">${icon("close")}</button></div></div><div class="inspector-title"><span class="node-icon" style="--tone:${semanticInk(t)}">${icon(t.icon)}</span><div><h2>${escape(n.label)}</h2><p>${escape(n.id)} · ${escape(groupMap.get(n.group)?.label || "System")}</p></div></div><div class="inspect-actions">${isContainer ? `<button class="btn" data-action="canvas-expand" data-id="${escape(n.id)}" title="展开：在画布上显示子项">${icon("plus")}展开</button><button class="btn" data-action="scope" data-id="${escape(n.id)}" title="进入模块：以它为当前范围">${icon("layers")}进入模块</button>` : `<button class="btn" data-action="context-reach" data-value="upstream">${icon("back")}上游</button><button class="btn" data-action="context-reach" data-value="downstream">下游${icon("arrow")}</button>`}<button class="btn" data-action="lens" data-value="global">${icon("grid")}全局</button></div></div><div class="inspector-tabs">${[
      ["overview", "概览"],
      ["connections", "连接"],
      ["contracts", isContainer ? "子项" : n.sourceRole === "symbol" ? "源码" : "接口"],
      ["context", "全局"],
      ["evidence", "依据"],
      ["claims", "解释"],
    ]
      .map(
        ([id, text]) =>
          `<button data-action="tab" data-value="${id}" class="${state.tab === id ? "active" : ""}">${text}</button>`,
      )
      .join(
        "",
      )}</div><div class="inspector-content">${nodeHierarchy(n)}${inspectorBody(n, inc, isContainer)}</div><div class="inspector-footer">${icon("document")}${generated() ? "自动提取 · 依据来自当前来源" : imported ? "导入模型 · 依据由文件提供" : "源码依据 · " + escape((data.meta.revision || "").slice(0, 8))}</div>`;
    if (nameChip(n)) panel.querySelector(".inspector-title h2")?.insertAdjacentHTML("afterend", nameChip(n));
    applyLevelHighlights();
  }
  function connection(e, incoming) {
    const id = incoming ? e.source : e.target;
    return `<div class="connection-row" style="${typeStyle(e.type)}"><button class="connection" data-action="select" data-id="${escape(id)}" data-peek="${escape(id)}">${icon(kindIcon(nodes.get(id)))}<span>${escape(label(id))}<small>${escape(e.label || e.type)}</small>${roleChip(e)}</span>${icon("arrow")}</button><button class="edge-detail-button" data-action="raw-edge" data-id="${escape(e.id)}" aria-label="查看边 ${escape(e.id)}">${typeBadge(e.type)}<span>${escape(e.id)} ${icon("chevron")}</span></button></div>`;
  }
  function nodeHierarchy(n) {
    return `${evidenceOrigin?.model === data ? `<button class="return-relation" data-action="evidence-return">${icon("back")}返回依据前的位置</button>` : ""}${state.lastRelation ? `<button class="return-relation" data-action="return-relation">${icon("back")}返回刚才的关系 (${state.lastRelation.edgeIds.length})</button>` : ""}<div class="inspector-breadcrumbs"><button data-action="home">System</button>${crumbIds(
      n.id,
    )
      .map(
        (id) =>
          `${icon("chevron")}<button data-action="${id === n.id ? "select" : "scope"}" data-id="${escape(id)}">${escape(label(id))}${nameChip(all.get(id))}</button>`,
      )
      .join("")}</div>${realLocation(n)}${levelPeers(n)}`;
  }
  /**
   * One evidence identifier, resolved. A record leads to its real excerpt, span and file and
   * can be opened; an identifier with no record is named as unresolved and never rendered as
   * if it were support.
   */
  function evidenceReference(id) {
    const record = evidenceRecord(id);
    if (!record)
      return `<div class="evidence-reference is-unresolved"><b>${escape(id)}</b><small>unresolved · 本快照没有这条依据记录，不能当作支持证据。</small></div>`;
    const span = record.range ? `${record.range.startLine}–${record.range.endLine}` : "";
    return `<div class="evidence-reference"><b>${escape(record.fileId || record.file || id)}${span ? ` · ${escape(span)}` : ""}</b><small>${escape(record.id)} · ${escape(record.verification || record.kind || "")}</small><pre>${escape(record.excerpt || "")}</pre><button class="btn" data-action="evidence-source" data-id="${escape(record.id)}">${icon("document")}查看来源并返回</button></div>`;
  }
  /* The claims tab lists claims a page at a time. The total is exact and every claim stays
     reachable through the cursor; the page size only limits what one screen shows. The cursor
     belongs to one model, one selected object and one scope, and starts over when any changes. */
  const CLAIM_PAGE_SIZE = 20;
  let claimPage = { model: null, subject: null, scope: "node", offset: 0 };
  function claimPageFor(subjectId) {
    if (claimPage.model !== data || claimPage.subject !== subjectId) claimPage = { model: data, subject: subjectId, scope: "node", offset: 0 };
    return claimPage;
  }
  const REVIEW_REASONS = {
    "text-changed": "解释文字已改变",
    "evidence-changed": "引用依据内容已改变",
    "claim-not-current": "解释不在当前快照中",
    "not-a-human-review": "记录不是人工核对",
  };
  /** What a person recorded about one claim: checked, rejected, invalidated or nothing yet. */
  function reviewStateOf(claim, entry) {
    if (Claims()?.isHumanChecked(claim)) return "checked";
    if (claim.review === "rejected" && claim.reviewedBy?.kind === "human") return "rejected";
    if (claim.review === "stale") return "stale";
    return listOf(entry?.history).at(-1)?.event === "invalidated" ? "invalidated" : "unreviewed";
  }
  const REVIEW_LABELS = { checked: "人工核对 · 已通过", rejected: "人工核对 · 已驳回", invalidated: "人工核对 · 已失效", stale: "人工核对 · 已过期", unreviewed: "人工核对 · 未核对" };
  /** The person's review, drawn as a square solid chip so it never reads like the agent's
   *  dashed interpretation grade next to it. */
  function reviewBadge(claim, entry) {
    const status = reviewStateOf(claim, entry);
    const who = (status === "checked" || status === "rejected") && textOf(claim.reviewedBy?.identity) ? ` · ${escape(claim.reviewedBy.identity)}` : "";
    return `<span class="review-badge" data-review="${status}" title="由一个人对照引用依据所作的核对；代理核验结论不算核对。">${icon(status === "checked" ? "check" : status === "rejected" ? "close" : "info")}${REVIEW_LABELS[status]}${who}</span>`;
  }
  function reviewRecord(claim, entry) {
    const by = claim.reviewedBy;
    const record = by?.kind === "human" && (claim.review === "checked" || claim.review === "rejected")
      ? `<p class="review-record">${claim.review === "checked" ? "核对通过" : "驳回"} · 核对人 <b>${escape(by.identity || "")}</b> · ${escape(by.at || "")} · 渠道 ${escape(by.channel || "")}${textOf(by.note) ? `<br><small>备注：${escape(by.note)}</small>` : ""}</p>`
      : '<p class="review-record">还没有人核对这条解释。</p>';
    const history = listOf(entry?.history);
    const rows = history.map((item) => item.event === "invalidated"
      ? `<li data-event="invalidated"><b>已失效</b> · ${escape(REVIEW_REASONS[item.reasonCode] || item.reasonCode || "")} · ${escape(item.at || "")}</li>`
      : `<li data-event="${escape(item.event)}">${item.event === "checked" ? "核对通过" : "驳回"} · ${escape(item.identity || "")} · ${escape(item.at || "")}</li>`).join("");
    const actions = Claims() ? `<div class="review-actions"><button class="btn" data-action="review-claim" data-value="checked" data-id="${escape(claim.id)}">${icon("check")}核对通过</button><button class="btn" data-action="review-claim" data-value="rejected" data-id="${escape(claim.id)}">${icon("close")}驳回</button></div>` : "";
    return `<div class="review-block">${record}${rows ? `<ul class="review-history">${rows}</ul>` : ""}${actions}</div>`;
  }
  /** Per-dimension review requirement from evaluateDepth: what a person still has to check. */
  function reviewStatus(model = factsModel()) {
    if (!Claims() || !isRecord(model?.analysis)) return null;
    try { return Claims().evaluateDepth(model); } catch { return null; }
  }
  function reviewStatusPanel(depth) {
    if (!depth) return "";
    const rows = depth.dimensions.filter((d) => d.review).map((d) => {
      const r = d.review;
      return `<li data-dimension="${escape(d.id)}" data-satisfied="${r.satisfied}"><b>${escape(d.id)}</b> ${escape(d.name)}<span>人工核对 ${r.humanChecked} / ${r.restsOn} · 待核对 ${r.unreviewed}${r.rejected ? ` · 驳回 ${r.rejected}` : ""}${r.restsOn ? "" : " · 没有可核对的解释"}</span></li>`;
    }).join("");
    const pending = depth.reviewPending.length ? `仍需人工核对：${depth.reviewPending.join("、")}` : "依赖解释的维度都已由人核对";
    return `<div class="review-status"><div class="section-label">人工核对状态</div><p class="micro">${escape(pending)}。只有一个人的核对能满足这些维度；代理核验结论不算。deepMapReady 还要求所有维度与任务完成。</p><ul>${rows}</ul></div>`;
  }
  function claimsBody(n) {
    const analysis = data.analysis || {};
    const page = claimPageFor(n.id);
    const own = (analysis.claims || []).filter((c) => (c.subjectIds || []).includes(n.id));
    const claims = page.scope === "all" ? listOf(analysis.claims) : own;
    const total = claims.length;
    if (page.offset >= total) page.offset = Math.max(0, Math.floor((total - 1) / CLAIM_PAGE_SIZE) * CLAIM_PAGE_SIZE);
    const shown = claims.slice(page.offset, page.offset + CLAIM_PAGE_SIZE);
    const reviews = storedReviews();
    const pending = (analysis.enrichmentTasks || []).filter((t) => !t.subjectId || t.subjectId === n.id);
    const depth = reviewStatus();
    const ready = depth?.readiness || analysis.readiness || {};
    const unknown = (data.meta?.ingestion?.unresolved || []).filter((item) => item.file === n.path).slice(0, 12);
    const scopes = `<div class="claims-scope" role="group" aria-label="解释范围"><button data-action="claims-scope" data-value="node" aria-pressed="${page.scope === "node"}">此对象<small>${own.length}</small></button><button data-action="claims-scope" data-value="all" aria-pressed="${page.scope === "all"}">全部解释<small>${listOf(analysis.claims).length}</small></button></div>`;
    const pager = total ? `<div class="claims-pager"><span class="claims-count">${page.offset + 1}–${page.offset + shown.length} / ${total}</span><button class="btn" data-action="claims-page" data-value="prev" ${page.offset > 0 ? "" : "disabled"}>上一页</button><button class="btn" data-action="claims-page" data-value="next" ${page.offset + CLAIM_PAGE_SIZE < total ? "" : "disabled"}>下一页</button></div>` : "";
    /* Two affordances, one set of ids: the chip row is the citation index a reader clicks
       (D10), and the reference below it quotes the stored excerpt with its file and span so
       the support can be read without leaving the inspector (P6-04-E1). An id with no record
       in this snapshot is named as unresolved in both and borrows no other record's text. */
    return `<div class="detail-intro"><b>解释 / CLAIMS</b><p>解释层与源码事实分开。没有宿主 Agent 时职责说明保持待处理；sourceMapReady 不是 deepMapReady，猜测不能标成 resolved-static。</p></div><p class="micro">sourceMapReady=${ready.sourceMapReady ? "yes" : "no"} · deepMapReady=${ready.deepMapReady ? "yes" : "no"} · pending=${pending.length}</p>${reviewStatusPanel(depth)}${scopes}${pager}${shown.map((c) => `<details class="evidence-card" data-claim-id="${escape(c.id || "")}"><summary>${escape(c.predicate)} · ${reviewBadge(c, ownValue(reviews, c.id))} · ${escape(c.support || "insufficient")}${authoredClaimTag(c)}</summary><p class="detail-text">${escape(c.text)}</p>${claimVerdict(c.id)}${reviewRecord(c, ownValue(reviews, c.id))}<div class="section-label">引用依据<span>${(c.evidenceIds || []).length}</span></div>${evidenceChips([...(c.evidenceIds || [])], "这条解释没有引用任何依据，因此不能算已核验。")}${(c.evidenceIds || []).map(evidenceReference).join("")}${(c.counterEvidenceIds || []).length ? `<div class="section-label">反证</div>${evidenceChips([...c.counterEvidenceIds], "")}${c.counterEvidenceIds.map(evidenceReference).join("")}` : ""}</details>`).join("") || `<p class="empty-hint">${page.scope === "all" ? "当前模型没有已提交的解释。" : "当前对象没有已提交的解释。"}</p>`}${total > CLAIM_PAGE_SIZE ? pager : ""}${pending.length ? `<div class="section-label">待处理任务<span>${pending.length}</span></div>${pending.map((t) => `<p class="empty-hint">${escape(t.kind || t.task || "enrich")} · ${escape(t.status || "pending")} · ${escape(t.subjectId || n.id)}</p>${(t.evidenceIds || []).length ? evidenceChips([...t.evidenceIds], "") : ""}`).join("")}` : ""}${unknown.length ? `<div class="section-label">未知 / 未解析<span>${unknown.length}</span></div>${unknown.map((item) => `<p class="empty-hint">${escape(item.specifier || item.reason || "unresolved")}</p>`).join("")}` : ""}`;
  }
  /** An authored claim (`cl_auth_*`): always graded (未核验 without a verdict), flagged when a
   *  fact it rests on is an unproven relation, and quoting the verifier's verdict when one exists. */
  function isAuthoredClaim(id) {
    return Boolean(authoring()) && typeof id === "string" && id.startsWith("cl_auth_");
  }
  function authoredClaimTag(claim) {
    // An untrusted layer's claims are still agent text: marked, never graded.
    if (!authoring() && hasAuthoringLayer() && typeof claim?.id === "string" && claim.id.startsWith("cl_auth_"))
      return '<span class="interpretation-badge" data-status="ungraded" title="解读层格式不正确，这条解读不被采信。">代理解读 · 未采信</span>';
    if (!isAuthoredClaim(claim?.id)) return "";
    return `${interpretationBadge(claimStatus(claim.id))}${claimUnproven(claim) ? '<b class="unproven-badge" title="这条解读所依据的关系没有静态证明。">未证实调用</b>' : ""}`;
  }
  function claimVerdict(id) {
    if (!isAuthoredClaim(id)) return "";
    const verdict = ownValue(authoring()?.verdicts, id);
    const quoted = isRecord(verdict) && textOf(verdict.verdict)
      ? ` 独立核验结论 <b>${escape(verdict.verdict)}</b>${textOf(verdict.reason) ? ` · ${escape(verdict.reason)}` : ""}${textOf(verdict.verifier) ? ` · ${escape(verdict.verifier)}` : ""}`
      : " 没有独立核验结论";
    return `<p class="micro claim-verdict">${icon("info")}${quoted}</p>`;
  }
  function inspectorBody(n, inc, isContainer) {
    if (state.tab === "context") return contextBody();
    if (state.tab === "contracts") return contractsBody(n);
    if (state.tab === "claims") return claimsBody(n);
    if (state.tab === "evidence" || state.tab === "docs")
      return evidenceBody(n);
    if (state.tab === "connections") {
      const ctx = selectionContext(),
        incoming = ctx.incoming.map(edgeById),
        outgoing = ctx.outgoing.map(edgeById),
        internal = ctx.internal.map(edgeById);
      return `<div class="detail-intro"><b>直接连接</b><p>入向：谁指向当前对象。出向：当前对象指向谁。筛选：${state.type === "all" ? "全部类型" : escape(CodeLoomSemantics.relation(state.type).label)}${!state.showCandidates && candidateIds.size ? "，未证实的候选关系已隐藏（图例中可显示）" : ""}。</p></div>${contextSummary(ctx)}${sourceDiagnostics(n)}<div class="section-label">${icon("back")}入向连接<span>${incoming.length}</span></div>${incoming.map((e) => connection(e, true)).join("") || '<p class="empty-hint">没有符合筛选的入向连接。</p>'}<div class="section-label" style="margin-top:23px">${icon("arrow")}出向连接<span>${outgoing.length}</span></div>${outgoing.map((e) => connection(e, false)).join("") || '<p class="empty-hint">没有符合筛选的出向连接。</p>'}${isContainer ? `<div class="section-label" style="margin-top:23px">内部关系<span>${internal.length}</span></div>${internal.map(rawEdgeCard).join("")}` : ""}`;
    }
    const edges = [...inc.incoming, ...inc.outgoing],
      ctx = selectionContext();
    return `<div data-section="identity"><div class="object-tags">${categoryBadge(n)}<span class="badge">${isContainer ? `${members(n.id).length} 个组件` : n.sourceRole === "symbol" ? "源码声明" : `${n.functions?.length || 0} 个${generated() ? "符号" : "函数"}`}</span></div></div><div data-section="responsibility"><div class="section-label">职责 / RESPONSIBILITY</div>${roleChip(n)}${interp(n) ? authoredResponsibility(n) : `<p class="detail-text">${escape(n.description || n.summary || "未提供职责说明。")}</p>`}${sourceDocstringBlock(n)}</div><div data-section="interface"><div class="section-label" style="margin-top:20px">${isContainer ? "结构入口" : "接口与位置"}</div><button class="connection" data-action="tab" data-value="contracts">${icon(isContainer ? "layers" : "code")}<span>${isContainer ? `查看 ${immediateChildren(n.id).length} 个直接子项` : n.sourceRole === "symbol" ? "查看声明与源码依据" : `查看 ${n.functions?.length || 0} 个${generated() ? "声明 / 章节" : "函数契约"}`}<small>${isContainer ? "继续逐层深入" : generated() ? "精确行号、源文件与静态关系" : "职责、输入、输出分别呈现"}</small></span>${icon("arrow")}</button></div><div data-section="relations"><div class="section-label">连接构成 <span>${edges.length} 条原始边 · 全类型</span></div>${typeBreakdown(edges)}</div><div data-section="position">${contextSummary(ctx)}${n.path ? `<details class="location-details"><summary>${icon("document")}源码位置</summary><code>${escape(n.path)}</code></details>` : ""}${n.parentId || n.group ? `<button class="btn parent-button" data-action="scope" data-id="${escape(n.parentId || n.group)}">${icon("layers")}进入父模块 ${escape(label(n.parentId || n.group))}</button>` : ""}</div><div data-section="evidence">${sourceDiagnostics(n)}</div>`;
  }
  /**
   * The projected role of an object or region, field by field. Each field shows its own claim's
   * grade and citations (`interpretation.fields`); a field without a claim is derived text and
   * is shown plainly, never under an agent-interpretation badge.
   */
  function authoredResponsibility(n) {
    const isContainer = containers.has(n.id);
    const field = (name) => {
      const id = fieldClaim(n, name);
      return id && claimRecord(id) ? { status: claimStatus(id), evidence: claimEvidence(id) } : null;
    };
    const summary = isContainer ? null : field("summary"), description = field("description"), iface = field("interface");
    const parts = [];
    if (summary && textOf(n.summary)) parts.push(authoredStatement(n.summary, summary.status, summary.evidence, textOf(n.derivedSummary)));
    if (description && textOf(n.description)) parts.push(authoredStatement(n.description, description.status, description.evidence, textOf(n.derivedDescription)));
    else {
      // The role was not projected: whatever the description says is what the parser derived.
      const derived = textOf(n.description) || (summary ? "" : textOf(n.summary));
      parts.push(`<p class="detail-text">${escape(derived || "未提供职责说明。")}</p>`);
    }
    if (iface && textOf(n.interface))
      parts.push(`<div class="section-label" style="margin-top:16px">接口含义 / INTERFACE</div>${authoredStatement(n.interface, iface.status, iface.evidence)}`);
    // Authored inputs/outputs: agent interpretation read from the interface claim, graded by
    // it; the parser's parameters and returns stay in the contracts tab (源码签名契约).
    const authoredIo = [["authoredInputs", "输入"], ["authoredOutputs", "输出"]]
      .map(([name, label]) => ({ label, grade: field(name), items: (Array.isArray(n[name]) ? n[name] : []).filter((item) => textOf(item)) }))
      .filter((entry) => entry.grade && entry.items.length);
    if (authoredIo.length)
      parts.push(`<div class="section-label" style="margin-top:16px">代理整理的输入输出 / AUTHORED IO</div>${authoredIo.map((entry) => authoredStatement(`${entry.label}：${entry.items.join("；")}`, entry.grade.status, entry.grade.evidence)).join("")}`);
    const region = recordsOf(authoring()?.regions).find((r) => r.id === n.id);
    const rationale = region && textOf(region.key) ? `cl_auth_region_${region.key}_members` : null;
    if (rationale && textOf(region.rationale) && claimRecord(rationale))
      parts.push(`<div class="section-label" style="margin-top:16px">划分依据</div>${authoredStatement(region.rationale, claimStatus(rationale), claimEvidence(rationale))}`);
    return parts.join("");
  }
  function select(id) {
    if (!all.has(id)) return;
    if (state.selected !== id || state.relation) rememberReading();
    const n = all.get(id);
    rememberRelation();
    state.levelFocus = "auto";
    state.relation = null;
    state.relationGroup = null;
    state.selected = id;
    const flow = state.mode === "flow" ? currentFlow() : null;
    if (flow?.nodes.includes(id)) state.step = flow.nodes.indexOf(id);
    canvasPages.clear();
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
      renderStory();
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
  /** The canvas is the module structure itself (not a guide, trace, lens or flat view). */
  function hierarchyCanvas() {
    return state.lens === "scope" && state.mode === "hierarchy" && !state.trace;
  }
  /**
   * Whether 展开 has made a container's children visible — the one fact behind the tree caret,
   * its label, the tree's child rows, 展开 and 收起. On the module canvas it is the reading
   * scope's own chain plus the containers opened inside it (`openContainers`), which is exactly
   * what the scene opens; elsewhere (a guide, a trace) the canvas shows no hierarchy and only
   * the tree's own shape applies.
   */
  function containerOpen(id) {
    if (!containers.has(id)) return false;
    if (!hierarchyCanvas()) return state.expanded.has(id);
    if (state.scope && crumbIds(state.scope).includes(id)) return true;
    const chain = crumbIds(id);
    const start = state.scope ? chain.indexOf(state.scope) : -1;
    if (state.scope && start < 0) return false;
    return chain.slice(start + 1).every((x) => state.openContainers.includes(x));
  }
  /** Re-render without costing the reader their place in the explorer list. */
  function keepNavigationScroll(run) {
    const sidebar = $("#sidebar"), list = $("#tree-content .tree");
    const top = sidebar?.scrollTop || 0, listTop = list?.scrollTop || 0;
    run();
    const nextSidebar = $("#sidebar"), nextList = $("#tree-content .tree");
    if (nextSidebar) nextSidebar.scrollTop = top;
    if (nextList) nextList.scrollTop = listTop;
  }
  /**
   * Keep the keyboard on the container after 展开 / 收起 re-render it. A canvas card becomes a
   * boundary when it opens, so focus moves to that boundary's 收起 control (and back to the card
   * when it closes); a tree control keeps its own control.
   */
  function focusContainerControl(id, holder) {
    const find = (selector) => $$(selector).find((el) => el.dataset.id === id);
    const canvas = ["graph-node", "node-expand", "boundary-collapse", "boundary-title"].includes(holder);
    const target = canvas
      ? find(".boundary-collapse") || find("#world .graph-node")
      : find(`#tree-content .${holder}`);
    if (!target) return;
    target.focus({ preventScroll: true });
    if (!canvas) target.scrollIntoView?.({ block: "nearest" });
  }
  /**
   * 展开 — the one expand verb. The tree caret, the canvas `+`, a double-click on a container
   * and → on a focused container all land here: the container's children become visible on the
   * canvas, in place inside the current reading scope, and the tree shows it open. Entering a
   * container (a scope change) is 进入, `scope()`, and is never called expanding.
   *
   * When the container is outside the current scope, the scope widens to its parent so it can
   * be opened in place; anything already open inside that parent stays open.
   */
  function expandContainer(id) {
    if (!containers.has(id)) return;
    const chain = crumbIds(id);
    /* Nothing to do only when the canvas really shows it open. A container listed open but
       drawn closed (off page, or over the reading budget) is opened again: it becomes the
       selection, so the canvas pages to it or the note says why it cannot draw it. */
    const drawnOpen = state.scope === id || layout.bounds.some((b) => b.id === id);
    if (hierarchyCanvas() && containerOpen(id) && drawnOpen) return;
    rememberReading();
    rememberRelation();
    let nextScope = state.scope;
    const open = new Set(state.openContainers);
    if (!(nextScope === null || nextScope === id || chain.includes(nextScope))) {
      // Outside the reading scope: widen to the parent, keeping what was open inside it.
      nextScope = containers.get(id).parentId || null;
      const within = (other) => nextScope === null || crumbIds(other).includes(nextScope);
      for (const other of [...open]) if (!within(other)) open.delete(other);
      if (state.scope && within(state.scope))
        crumbIds(state.scope).slice(nextScope ? crumbIds(state.scope).indexOf(nextScope) + 1 : 0).forEach((x) => open.add(x));
    }
    if (nextScope !== id)
      chain.slice(nextScope ? chain.indexOf(nextScope) + 1 : 0).forEach((x) => open.add(x));
    chain.forEach((x) => state.expanded.add(x));
    /* The expanded container becomes the selection, so a paged scope shows the page it is on.
       It stays open when the selection later moves (the scene opens every container in
       `openContainers`); what the budget cannot draw is reported in the canvas note. The
       relation it replaces stays reachable through 「返回刚才的关系」. */
    Object.assign(state, {
      scope: nextScope, openContainers: [...open], lens: "scope", mode: "hierarchy", flow: null,
      trace: null, levelFocus: "auto", selected: id, relation: null, relationGroup: null,
    });
    canvasPages.clear();
    keepNavigationScroll(render);
  }
  /**
   * 收起 — the inverse: the container's children leave the canvas and the tree closes it. A
   * container that is not open is left alone: nothing collapses, and the guide, trace or lens
   * being read is kept. A boundary the canvas draws open (every container in 组件 mode) is open:
   * its 收起 switches to the module canvas with that container closed, as it always did.
   * Otherwise, off the module canvas, only the tree's shape changes.
   */
  function collapseContainer(id) {
    if (!containers.has(id)) return;
    const drawnOpen = state.lens === "scope" && layout.bounds.some((b) => b.id === id);
    if (!containerOpen(id) && !drawnOpen) return;
    const inside = (other) => other !== id && crumbIds(other).includes(id);
    const closeTree = () => {
      state.expanded.delete(id);
      for (const other of [...state.expanded]) if (inside(other)) state.expanded.delete(other);
      state.openContainers = state.openContainers.filter((other) => other !== id && !inside(other));
    };
    if (!hierarchyCanvas() && !drawnOpen) {
      closeTree();
      keepNavigationScroll(renderTree);
      hash();
      return;
    }
    rememberReading();
    rememberRelation();
    closeTree();
    if (!hierarchyCanvas()) Object.assign(state, { lens: "scope", mode: "hierarchy", flow: null });
    // Collapsing the scope (or one of its ancestors) steps out so the container shows closed.
    if (state.scope && crumbIds(state.scope).includes(id)) state.scope = containers.get(id).parentId || null;
    if (state.selected && inside(state.selected)) state.selected = id;
    state.levelFocus = "auto";
    canvasPages.clear();
    keepNavigationScroll(render);
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
    exportJob?.controller.abort();
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
      peek.innerHTML = `<div class="eyebrow" style="margin-bottom:9px">Quick preview · L${CodeLoomLevels.depth(data, n.id)}</div><h3>${escape(n.label)}</h3><p>${escape(n.summary || n.description || `${descendants(n.id).length} internal components`)}</p>${shownTextBadge(n)}${n.path ? `<code>${escape(n.path)}</code>` : ""}<div class="peek-counts"><span>↳ ${inc.incoming.length} incoming</span><span>↗ ${inc.outgoing.length} outgoing</span><span>${(n.functions || []).length} functions</span></div>`;
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
          return `<section><h3>${escape(n.label)}</h3><p>${escape(n.summary || n.description || "Module boundary")}</p>${shownTextBadge(n)}<div class="file-path"><code>${escape(n.path || n.id)}</code></div><p>${inc.incoming.length} incoming · ${inc.outgoing.length} outgoing</p><div class="section-label">Inputs</div><p>${escape(textIO(n.inputs))}</p><div class="section-label">Outputs</div><p>${escape(textIO(n.outputs))}</p><div class="section-label">Source contract</div><p>${escape(n.sourceContract ? `${n.sourceContract.parameters?.status || "unknown"} / ${n.sourceContract.returns?.status || "unknown"}` : "legacy model has no sourceContract")}</p><div class="section-label">Claims</div><ul>${((data.analysis?.claims || []).filter((c) => (c.subjectIds || []).includes(id)).map((c) => `<li>${escape(c.predicate)} · ${escape(c.support || "insufficient")}: ${escape(c.text)}${authoredClaimTag(c)}</li>`) || []).join("") || "<li>none</li>"}</ul><div class="section-label">Unknown / unresolved</div><p>${escape(((data.meta?.ingestion?.unresolved || []).filter((item) => item.file === n.path).map((item) => item.specifier || item.reason).join(", ")) || "none recorded")}</p><div class="section-label">Functions</div><ul>${(n.functions || []).map((f) => `<li>${escape(f.name)}</li>`).join("")}</ul><button class="btn" data-action="compare-jump" data-id="${id}">定位节点${icon("arrow")}</button></section>`;
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
      edges: path ? [...new Set(path.edges)] : [], steps: path?.steps || [], segments: path?.segments || [],
      // The declared condition travels with the trace, so the canvas, the inspector and the
      // URL all read the same unmet obligations instead of re-deriving them.
      condition: path?.condition || null, outcome: result.outcome, continuation: result.continuation,
      error: result.error, limited: result.limited };
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
  /**
   * What a route's declared condition means for the reader. An unmet all-of obligation names
   * the participant that is missing; an any-of set names alternatives. Neither states a run.
   */
  function conditionCard(condition) {
    if (!condition || condition.mode === "none") return "";
    const missing = (condition.missing || [])
      .map(item => `<li><b>${escape(label(item.nodeId))}</b><small>${escape(item.role)} · ${escape(item.participantId)} · ${escape(item.groupId)}</small></li>`)
      .join("");
    const candidates = (condition.candidates || [])
      .map(id => `<span class="path-candidate-node">${escape(label(id))}</span>`)
      .join("");
    return `<div class="path-condition ${condition.satisfied ? "is-satisfied" : "is-conditional"}" data-condition="${escape(condition.mode)}"><b>${icon("info")}${condition.mode === "any" ? "any-of 候选条件" : "all-of 声明条件"} · ${condition.satisfied ? "已满足声明" : "条件未满足"}</b>${missing ? `<p>还缺少以下声明参与者，这不是一条无条件路径：</p><ul class="path-missing">${missing}</ul>` : ""}${candidates ? `<p>候选目标（其一，不是全部被调用）：${candidates}</p>` : ""}<small>${escape(condition.note)}</small></div>`;
  }
  function routeResults() {
    const host = $("#path-results");
    if (!host || !routeResult) return;
    if (routeResult.error) {
      const exhausted = routeResult.outcome === "exhausted";
      host.innerHTML = `<div class="path-error" role="alert" data-outcome="${escape(routeResult.outcome || "unreachable")}"><strong>${exhausted ? "搜索预算已用尽，尚未确认" : "已完整搜索，这一段确实不连通"}</strong><p>${escape(pathError(routeResult.error))}</p><small>${exhausted ? "这不是「不存在路径」的结论；可以继续用更大的预算搜索。" : "保留所有必经点；调整条件后重新探索。不会补出不存在的连接。"}</small>${exhausted && routeResult.continuation ? `<button class="btn primary" data-action="path-continue">${icon("route")}继续搜索（预算 ${routeResult.continuation.budget}）</button>` : ""}</div>`;
      return;
    }
    host.innerHTML = `<div class="path-result-heading" data-outcome="${escape(routeResult.outcome || "found")}"><strong>${routeResult.paths.length} 条可选路径</strong><span>按跳数排序 · 原始关系方向不变</span></div>${routeResult.limited ? '<p class="path-warning">达到搜索预算，仅显示已确认的路径；备选结果可能不完整。</p>' : ''}${routeResult.paths.map((path, index) => `<section class="path-candidate"><div class="path-candidate-top"><div><b>方案 ${index + 1}</b><span>${path.steps.length} 跳 · ${new Set(path.nodes).size} 个组件${path.steps.some(step => step.reverse) ? ` · ${path.steps.filter(step => step.reverse).length} 次逆向阅读` : ""}</span></div><button class="btn ${index === 0 ? "primary" : ""}" data-action="apply-path" data-id="${index}">应用到画布${icon("arrow")}</button></div>${conditionCard(path.condition)}${path.segments.map(segment => `<details class="path-segment" ${index === 0 ? "open" : ""}><summary><span class="path-number">${segment.index + 1}</span><span>${escape(label(segment.from))} → ${escape(label(segment.to))}</span><small>${segment.steps.length} 跳</small></summary>${segment.steps.length ? `<ol class="path-steps">${segment.steps.map(step => `<li><div class="path-step-label"><span class="path-type" style="${typeStyle(step.type)}">${escape(CodeLoomSemantics.relation(step.type).label)} · ${escape(step.type)}</span>${step.reverse ? '<span class="path-reverse">逆向阅读</span>' : ""}<code>${escape(step.edge)}</code></div><strong>${escape(step.label)}</strong><p>${escape(label(step.source))}<span aria-label="原始关系方向"> → </span>${escape(label(step.target))}</p>${step.reverse ? `<small>阅读顺序：${escape(label(step.from))} → ${escape(label(step.to))}（沿关系反向）</small>` : ""}</li>`).join("")}</ol>` : '<p class="path-zero">两个路标是同一组件，0 跳；无需添加自环。</p>'}</details>`).join("")}</section>`).join("")}`;
  }
  function renderRoute(focusId = null) {
    const choices = selected => data.nodes.map(n => `<option value="${escape(n.id)}" ${n.id === selected ? "selected" : ""}>${escape(n.qualifiedName || n.label)} · ${escape(n.path || n.id)}</option>`).join("");
    const types = [...new Set(data.edges.map(edge => edge.type))];
    modal("探索关系路径", `<div id="path-builder"><p class="path-intro">从两个组件开始，加入你想依次经过的节点。比较连接方式，查看每一步的原始关系与方向。</p><div class="path-stops">${routeDraft.stops.map((id, index) => `<div class="path-stop"><span class="path-stop-marker">${index === 0 ? "起" : index === routeDraft.stops.length - 1 ? "终" : index}</span><label for="${index === 0 ? "route-from" : index === routeDraft.stops.length - 1 ? "route-to" : `path-stop-${index}`}">${index === 0 ? "起点" : index === routeDraft.stops.length - 1 ? "终点" : `必经点 ${index}`}<select data-path-stop="${index}" id="${index === 0 ? "route-from" : index === routeDraft.stops.length - 1 ? "route-to" : `path-stop-${index}`}">${choices(id)}</select></label>${index > 0 && index < routeDraft.stops.length - 1 ? `<div class="path-stop-actions"><button class="icon-btn" data-action="path-move" data-id="${index}" data-value="-1" aria-label="上移必经点 ${index}" ${index === 1 ? "disabled" : ""}>↑</button><button class="icon-btn" data-action="path-move" data-id="${index}" data-value="1" aria-label="下移必经点 ${index}" ${index === routeDraft.stops.length - 2 ? "disabled" : ""}>↓</button><button class="icon-btn" data-action="path-remove" data-id="${index}" aria-label="删除必经点 ${index}">${icon("close")}</button></div>` : ""}</div>`).join("")}</div><div class="path-edit-actions"><button class="btn" data-action="path-add" ${routeDraft.stops.length >= 8 ? "disabled" : ""}>${icon("plus")}添加必经节点</button><button class="btn" data-action="path-reverse">反转整条路线</button><button class="btn" data-action="path-clear" ${routeDraft.stops.length <= 2 ? "disabled" : ""}>清空必经点</button></div><div class="path-options"><label for="path-direction">阅读方向<select id="path-direction">${[["downstream","沿箭头 · 下游"],["upstream","逆箭头 · 上游"],["both","双向 · 关联探索"]].map(([value,text]) => `<option value="${value}" ${routeDraft.direction === value ? "selected" : ""}>${text}</option>`).join("")}</select></label><label for="path-hops">整条路径最多跳数<input type="number" id="path-hops" value="${routeDraft.maxHops}" min="1" max="48" step="1"></label></div><fieldset class="path-types"><legend>可经过的关系类型</legend>${types.map(type => `<label><input type="checkbox" data-path-type value="${escape(type)}" ${routeDraft.types === null || routeDraft.types.includes(type) ? "checked" : ""}><span class="path-type-dot" style="${typeStyle(type)}"></span>${escape(CodeLoomSemantics.relation(type).label)}<small>${escape(type)}</small></label>`).join("")}</fieldset><div class="path-search-actions"><small>最多 3 个方案 · 按顺序经过路标 · 连接性不等于运行轨迹</small><button class="btn primary" data-action="find-route">${icon("route")}探索路径</button></div><div id="path-results" aria-live="polite"><p class="path-empty">添加必经点可回答「从这里出发，经过这些组件，如何到达目标」。</p></div></div>`);
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
    if (sourceJob) { sourceJob.controller.abort(); clearInterval(sourceJob.timer); }
    sourceJob = null;
    sourceSerial += 1;
  }
  /** `land`: open the model's top-ranked guide (first run); false when a link names a view. */
  function activateModel(parsed, { land = true } = {}) {
    AtlasGraph.validate(parsed);
    // Whether this model arrived from the analysis Worker, a local bridge or a
    // dropped file, it passes the same admission gate before it is displayed.
    window.SkylenseModelMigrations?.admitModel(parsed, { origin: "browser-import" });
    const previous = { data, imported, saved, state: { ...state, expanded: new Set(state.expanded) }, routeDraft, routeResult, guideOrigin, guideBrowse };
    try {
      guideOrigin = null; guideBrowse = "context";
      data = parsed;
      index();
      imported = true;
      saved = [];
      routeDraft = null; routeResult = null;
      Object.assign(state, {
        scope: parsed.groups.length === 1 ? parsed.groups[0].id : null, selected: null, trace: null, flow: null, step: 0,
        mode: "hierarchy", tab: "overview", query: "", compare: [], expanded: new Set(),
        lens: "scope", levelFocus: "auto", focusDimming: true, categoryGroups: true,
        present: false, openContainers: [], relation: null, lastRelation: null, type: "all", showCandidates: false,
      });
      sceneCache.clear(); canvasPages.clear();
      readingHistory.length = 0;
      cameraCache.clear();
      if (!(land && landOnGuide())) render();
    } catch (err) {
      data = previous.data; imported = previous.imported; saved = previous.saved;
      routeDraft = previous.routeDraft; routeResult = previous.routeResult;
      guideOrigin = previous.guideOrigin; guideBrowse = previous.guideBrowse;
      index(); Object.assign(state, previous.state); sceneCache.clear(); render();
      throw err;
    }
  }
  function reportText(value) {
    return typeof value === "string" ? value : value && typeof value === "object"
      ? [(value.path || value.file || value.name || "") + (value.line ? ":" + value.line : ""), value.specifier, value.reason || value.message || value.detail].filter(Boolean).join(" · ") || JSON.stringify(value)
      : String(value ?? "");
  }
  function languageCoverage(languages) {
    if (!Array.isArray(languages) || !languages.length) return "";
    return `<div class="source-language-table"><div class="section-label">语言覆盖 · 当前读取范围</div><table><thead><tr><th>语言</th><th>文件</th><th>解析</th><th>符号</th><th>有关联</th></tr></thead><tbody>${languages.map(row => `<tr><td>${escape(row.language)}</td><td>${row.files}</td><td>${row.parsedFiles}</td><td>${row.symbols}</td><td>${row.connectedFiles}</td></tr>`).join("")}</tbody></table><p>“解析”表示支持该语言的静态提取；不等于完整的运行时调用图。“有关联”按文件统计。</p></div>`;
  }
  function sourceDiagnostics(n) {
    if (!generated() || containers.has(n.id)) return "";
    const file = n.sourceRole === "file" ? n : data.nodes.find(item => item.sourceRole === "file" && item.path === n.path);
    if (!file) return "";
    const a = file.analysis || {}, unresolved = (data.meta.ingestion?.unresolved || []).filter(item => item.file === n.path);
    const rows = unresolved.slice(0, 4).map(item => `<li><code>${escape(item.specifier || "reference")}</code> · L${item.line || "?"}<small>${escape(item.reason || "未解析")}</small></li>`).join("");
    const note = a.status === "metadata-only" ? "当前对象仅保留文件信息，未分析文件内容。" : ["preview-only", "unsupported"].includes(a.status) ? "当前语言提供源码预览，尚未支持语义关系解析；零条边不代表没有依赖。" : !incident(n.id).incoming.length && !incident(n.id).outgoing.length ? "当前对象没有已解析的直接关系；文件级引用与声明级调用分别展示。" : "关系保留源文件行号。静态连接不表示已验证运行时行为。";
    return `<div class="source-node-status"><strong>${escape(a.language || file.language || "文件")} · ${a.parser?.engine === "tree-sitter" ? "语法树索引" : "分析范围"}</strong><p>${note}</p>${n.id !== file.id ? `<button class="btn" data-action="select" data-id="${escape(file.id)}">${icon("document")}查看所属文件的引用</button>` : ""}${unresolved.length ? `<details><summary>${unresolved.length} 项引用未解析</summary><ul>${rows}</ul></details>` : ""}${file.url ? `<a href="${escape(file.url)}" target="_blank" rel="noopener noreferrer">打开固定版本源文件 ↗</a>` : ""}<button class="source-report-link" data-action="source-report">查看完整分析报告 →</button></div>`;
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
      const fieldNames = { kind: "校验依据", enabled: "启用", hits: "校验后复用", misses: "未命中", invalid: "无效缓存", stored: "写入缓存", downloaded: "重新下载", errors: "缓存失败回退", unverified: "内容未通过校验", hierarchy: "层级", symbols: "符号", relationships: "关系", readingGuides: "静态导览", execution: "执行代码", aiInference: "AI 推断", unsupported: "当前限制", maxFiles: "文件上限", maxFileBytes: "单文件字节上限", maxTotalBytes: "总文本字节上限" };
      const items = Array.isArray(value) ? value : typeof value === "object" ? Object.entries(value).map(([key, item]) => `${fieldNames[key] || key}: ${typeof item === "boolean" ? item ? "是" : "否" : reportText(item)}`) : [value];
      if (!items.length) return "";
      return `<details class="source-report-details"><summary>${escape(title)} <small>${items.length}</small></summary><ul>${items.slice(0, 80).map(item => `<li>${escape(reportText(item))}</li>`).join("")}</ul>${items.length > 80 ? `<p>另有 ${items.length - 80} 项；完整记录保留在导出的 JSON 中。</p>` : ""}</details>`;
    };
    const source = model.meta?.source || report.source;
    const sourceNames = { "browser-files": "浏览器本地读取", "local-folder": "本地文件夹", "local-file": "本地文件" };
    const analysis = model.analysis || {};
    const depth = reviewStatus(model);
    const readiness = depth?.readiness || analysis.readiness || model.meta?.readiness || {};
    const coverage = analysis.coverage;
    const pending = analysis.enrichmentTasks?.length || 0;
    const readyNote = `<div class="source-model-metrics"><span>sourceMap ${readiness.sourceMapReady ? "ready" : "no"}</span><span>deepMap ${readiness.deepMapReady ? "ready" : "not ready"}</span><span>${(analysis.claims || []).length} claims</span><span>${pending} pending tasks</span></div>${readiness.deepMapReady ? "" : '<p class="source-private-note">sourceMapReady 只表示来源结构可读。未完成的模块职责、场景或证据任务会阻止 deepMapReady；unknown 不是完成。</p>'}${reviewStatusPanel(depth)}`;
    return `<div class="source-report-summary"><span class="source-eyebrow">STATIC SOURCE MAP</span><h3>${escape(model.meta?.title || "来源分析")}</h3><p>源码语法树与跨文件引用组成可追溯地图。完整索引与摘录预览分别统计；动态运行行为不会被当作已验证事实。</p>${source ? `<small>${escape(typeof source === "object" ? source.url || source.label || source.kind || "" : sourceNames[source] || source)}</small>` : ""}</div><div class="source-metrics">${[[number("scannedFiles", "scanned", "inputEntries"), "已扫描文件"], [number("acceptedFiles"), "已纳入文件"], [number("analyzedFiles", "analyzed", "textFiles"), "文本已分析"], [number("metadataOnlyFiles"), "仅文件信息"], [number("skippedFiles", "skipped", "excludedFiles"), "已记录跳过"], [number("truncatedFiles"), "文本预览截断"]].map(([value, name]) => `<div><b>${escape(value)}</b><span>${name}</span></div>`).join("")}</div>${(Array.isArray(report.truncated) ? report.truncated.length : report.truncated) ? '<p class="source-private-note">读取范围达到上限；这张地图只覆盖报告记录的部分内容。</p>' : ""}${readyNote}<div class="source-model-metrics"><span>${model.nodes.length} 个节点</span><span>${model.edges.length} 条关系</span><span>${(model.hierarchy || model.groups).length} 个层级容器</span></div>${details("索引完整性", report.indexCompleteness)}${details("覆盖账本", coverage)}${details("增量语法索引", report.syntax)}${details("已校验的 GitHub 文件复用", report.sourceCache)}${details("分析能力", report.capabilities)}${details("语言适配器", analysis.languageCapabilities)}${details("覆盖限制与提示", report.warnings || report.limitations)}${details("跳过项与原因", report.skipped)}${details("截断项", report.truncated)}${details("未解析的引用", report.unresolved)}${details("待解释任务", analysis.enrichmentTasks)}${details("资源上限", report.limits)}${languageCoverage(report.languages)}<p class="source-private-note">本次模型保留在当前页面会话。导出 JSON 可以继续在 CLI 或 Agent 中使用；导出文件会包含已分析的文本摘录。</p>`;
  }
  function openSource() {
    cancelSourceJob(); sourcePreview = null;
    sourceTab = "files";
    modal("打开一个来源", `<div class="source-intro"><span class="source-eyebrow">YOUR NEXT MAP</span><h3>从真实内容，走进结构。</h3><p>选择文件夹、文件或网址，让 Skylense 自动建立层级、静态关联和来源预览。</p></div><div class="source-tabs" role="tablist" aria-label="来源类型"><button role="tab" aria-selected="true" aria-controls="source-panel-files" id="source-tab-files" data-action="source-tab" data-value="files">${icon("layers")}文件与文件夹</button><button role="tab" aria-selected="false" aria-controls="source-panel-url" id="source-tab-url" data-action="source-tab" data-value="url" tabindex="-1">${icon("link")}GitHub / 网页</button><button role="tab" aria-selected="false" aria-controls="source-panel-text" id="source-tab-text" data-action="source-tab" data-value="text" tabindex="-1">${icon("document")}粘贴文本</button></div><div class="source-panel" id="source-panel-files" role="tabpanel" aria-labelledby="source-tab-files"><div class="source-file-grid"><button class="source-choice" data-action="source-folder">${icon("layers")}<b>打开文件夹</b><span>保留目录层级，自动提取支持语言的引用关系。</span><small>在此浏览器本地读取</small></button><button class="source-choice" data-action="source-files">${icon("document")}<b>选择文件</b><span>代码、文档、网页 HTML 或其他文件，可多选。</span><small>未知语言保留文本，二进制保留文件信息</small></button></div><input type="file" id="source-folder-input" webkitdirectory directory multiple hidden><input type="file" id="source-files-input" multiple hidden><p class="source-private-note">源码与文档按文本读取，不执行代码或网页脚本。通常排除依赖目录、版本记录与敏感配置；具体范围会在分析报告中列出。</p></div><div class="source-panel" id="source-panel-url" role="tabpanel" aria-labelledby="source-tab-url" hidden><label for="source-url">公开 GitHub 仓库或网页地址</label><div class="source-url-row"><input id="source-url" type="url" placeholder="https://github.com/owner/repository" autocomplete="off" spellcheck="false"><button class="btn primary" data-action="source-url">${icon("arrow")}分析网址</button></div><p class="source-private-note">${localBridge ? "由当前本地 CLI 服务获取内容。网页链接不等于背后的源码仓库；只分析实际可读取的内容。" : "公开仓库使用 GitHub 接口。网页能否直接读取取决于站点的跨域设置；受限时可用本地 CLI 打开，或上传保存的 HTML。"}</p></div><div class="source-panel" id="source-panel-text" role="tabpanel" aria-labelledby="source-tab-text" hidden><label for="source-text-name">文件名（扩展名用于选择分析方式）</label><input id="source-text-name" value="notes.md" maxlength="120" autocomplete="off"><label for="source-text">粘贴源码、文档或 HTML</label><textarea id="source-text" rows="7" spellcheck="false" placeholder="粘贴你希望探索的内容…"></textarea><div class="source-text-actions"><button class="btn primary" data-action="source-text">${icon("arrow")}分析文本</button></div></div><div class="source-limits"><label for="source-max-files">分析范围<select id="source-max-files"><option value="100">100 个文件 · 快速查看</option><option value="all" selected>完整索引 · 全部可读取源码</option><option value="300">300 个文件 · 快速预览</option><option value="1000">1,000 个文件 · 更广覆盖</option></select></label><span>完整索引保留所有可读取源码。可选快速预览；解析与源码预览分别报告。</span></div><details class="source-capabilities"><summary>这次会生成什么？</summary><p>所有可接收的文件都会按其支持程度处理：目录和源码声明层级、24 种语法解析器、项目内引用解析、JS / TS 编译器符号绑定、Julia 方法候选集，以及文档和网页内容。已有关系还会组成可逐步阅读的静态导览。动态计算的目标、运行时分派与未支持的语言会在报告中说明。无需模型 API 密钥。</p></details><div id="source-feedback" aria-live="polite"></div>`);
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
    const names = { repository: "读取仓库信息", revision: "固定源码版本", tree: "建立文件清单", github: "读取 GitHub 源文件", files: "读取源文件", fetch: "下载内容", syntax: "建立语法索引", semantic: "解析跨文件符号", build: "解析声明与关系", analyze: "解析声明与关系" };
    status.textContent = payload.message || [names[payload.phase] || "分析来源", payload.path].filter(Boolean).join(" · ");
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
    const job = { id: ++sourceSerial, controller: new AbortController(), started: performance.now() };
    sourceJob = job; sourceBusy(true);
    $("#source-feedback").innerHTML = `<div class="source-progress"><div>${icon("layers")}<strong>建立你的来源地图</strong><button class="btn" data-action="source-cancel">取消</button></div><progress id="source-progress-meter" aria-label="来源分析进度"></progress><p id="source-progress-text">正在准备读取…</p><small id="source-progress-time">0 秒 · 可随时取消</small></div>`;
    job.timer = setInterval(() => {
      const timer = $("#source-progress-time");
      if (sourceJob === job && timer) timer.textContent = `${Math.floor((performance.now() - job.started) / 1000)} 秒 · 可随时取消`;
    }, 1000);
    const selectedLimit = $("#source-max-files")?.value;
    const maxFiles = selectedLimit && selectedLimit !== "all" ? Number(selectedLimit) : undefined;
    const options = { maxFiles, signal: job.controller.signal, onProgress: progress => sourceProgress(job, progress) };
    try {
      let parsed;
      if (kind === "initial") parsed = await bridgeRequest("/api/model", { signal: options.signal });
      else if (kind === "url" && localBridge) parsed = await bridgeRequest("/api/analyze", { method: "POST", signal: options.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: input, maxFiles }) });
      else {
        if (window.SKYLENSE_BUNDLE?.viewerOnly) throw Object.assign(new Error("这个单文件只包含查看器和它携带的模型，不含源码解析器。要分析新的来源，请使用 standalone.html 或在终端运行 skylense open；已有的模型 JSON 可以从「导出 → 导入架构 JSON」打开。"), { code: "VIEWER_ONLY" });
        if (!window.SkylenseSources) throw new Error("来源分析模块未载入，请刷新页面或重新下载最新版。");
        parsed = await SkylenseAnalysisWorker.analyze(kind, input, options);
      }
      if (sourceJob !== job || job.controller.signal.aborted || !$("#modal").open) return;
      AtlasGraph.validate(parsed);
      if (kind === "initial") {
        activateModel(parsed, { land: !initialHash.size });
        if (initialHash.size) {
          history.replaceState(null, "", "#" + initialHash);
          if (readHash()) render();
          else if (!landOnGuide()) render();
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
      const canRetryURL = kind === "url" && !localBridge && !["PRIVATE_URL", "INVALID_URL", "VIEWER_ONLY"].includes(err.code);
      const command = kind === "url" ? "skylense open '" + String(input).replace(/'/g, "'\\''") + "'" : "skylense open /absolute/path/to/folder";
      // The failure code travels into the DOM: a reader sees the reason, and an acceptance run
      // can tell a killed analysis thread (WORKER_DEATH) from a source that could not be read.
      $("#source-feedback").innerHTML = `<div class="source-error" role="alert" data-code="${escape(err.code || "SOURCE_FAILED")}"><strong>还未完成这次分析</strong><p>${escape(err.message || "来源读取失败")}</p>${kind === "initial" ? "<p>本地连接失效时，请重新使用终端或 Agent 刚返回的完整链接打开，并保持对应服务运行。</p>" : ""}${canRetryURL ? `<p>浏览器可能无法跨域读取此站点，也可能遇到 GitHub 速率限制。可在终端运行下面的命令，或改为上传保存的 HTML / 粘贴文本。</p><code>${escape(command)}</code><button class="btn" data-action="copy-command" data-value="${escape(command)}">复制 CLI 命令</button>` : ""}<small>当前画布和已有模型未改变。</small></div>`;
    } finally { clearInterval(job.timer); }
  }
  async function initializeLocalSource() {
    if (!localBridge) {
      if (initialURL.searchParams.get("open") === "source") {
        openSource();
        const source = initialURL.searchParams.get("source");
        if (source) { selectSourceTab("url"); $("#source-url").value = source.slice(0, 4096); $("#source-url").focus(); }
      }
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
      `<p>导出的 JSON 保留全部层级、关系与依据。也可以导入另一个同结构模型，继续使用这个交互工作台。</p><button class="export-option" data-action="export-json">${icon("code")}<span><b>完整架构 JSON</b><small>${data.nodes.length} 组件 · ${data.edges.length} 关系 · 含函数、文档与依据</small></span></button><button class="export-option" data-action="export-svg">${icon("download")}<span><b>当前画布 SVG</b><small>静态矢量快照 · 保留当前布局与关系样式</small></span></button>${walkthroughOptions()}<button class="export-option" data-action="import">${icon("upload")}<span><b>导入架构 JSON</b><small>本地校验结构、端点与层级，不上传数据</small></span></button><button class="export-option" data-action="presentation"><span>${icon("play")}</span><span><b>Skylense 讲解模式</b><small>用当前地图讲解层级、流程和上下游关系</small></span></button><p class="micro">离线单文件版位于 standalone.html。连接 MCP 与终端后，可在更多工作流中查询同一份模型。</p>`,
    );
  }
  /* Animated walkthrough export (src/walkthrough-export.js): the flow or scenario being read,
     step by step, with each step's camera, focus and caption as the reader sees them. */
  let exportJob = null, lastExport = null;
  function walkthroughFlow() {
    return state.lens === "scope" && state.mode === "flow" ? currentFlow() || null : null;
  }
  function walkthroughOptions() {
    const f = walkthroughFlow(), W = SkylenseWalkthrough;
    const detail = f
      ? `${escape(flowLabel(f))} · ${f.nodes.length} 步 · 每步 ${W.STEP_SECONDS} 秒 · ${W.WIDTH}×${W.HEIGHT}`
      : "先打开一个场景或源码导览，再导出它的逐步动画";
    const disabled = f ? "" : " disabled";
    const webm = W.videoType("webm"), mp4 = W.videoType("mp4");
    // A disabled entry says only why it is disabled; timing belongs to an open walkthrough.
    const gifNote = f ? `${detail} · ${W.GIF_FPS} fps · 循环播放` : detail;
    const videoNote = f ? `${detail} · ${W.VIDEO_FPS} fps · 实时录制约 ${Math.round(f.nodes.length * W.STEP_SECONDS)} 秒，录制时请让此页保持在前台` : detail;
    return `<button class="export-option" data-action="export-gif"${disabled}>${icon("play")}<span><b>动画 GIF</b><small>${gifNote}</small></span></button><button class="export-option" data-action="export-video" data-value="webm"${disabled || (webm ? "" : " disabled")}>${icon("play")}<span><b>动画视频 WebM</b><small>${webm ? videoNote : "此浏览器不能录制 WebM"}</small></span></button>${mp4 ? `<button class="export-option" data-action="export-video" data-value="mp4"${disabled}>${icon("play")}<span><b>动画视频 MP4</b><small>${videoNote}</small></span></button>` : ""}`;
  }
  /** The walkthrough as plain data: scene geometry, and per step camera, focus and caption. */
  function walkthroughBoard(f) {
    const W = SkylenseWalkthrough, theme = SkylenseThemes.resolve(themeId);
    const view = { width: W.WIDTH, height: W.HEIGHT - W.HEADER_HEIGHT - W.CAPTION_HEIGHT };
    const authored = isAuthoredScenario(f), guide = isSourceGuide(f), steps = listOf(f.steps);
    const kept = { step: state.step, selected: state.selected, relation: state.relation, levelFocus: state.levelFocus }, shown = layout;
    const scenes = [], sceneIndex = new Map(), boardSteps = [];
    /* Unproven candidate relations keep their own look in the frames, and the frames say how
       many they show or how many this view leaves out, as the live legend and note do. */
    const drawnCandidates = new Set();
    let hiddenCandidateNote = null;
    const candidateMembers = (ids) => {
      const found = ids.filter((id) => candidateIds.has(id));
      for (const id of found) drawnCandidates.add(id);
      return found.length > 0;
    };
    const describe = (scene) => ({
      items: scene.items.map((p) => {
        const n = p.n, t = CodeLoomSemantics.node(n.kind), container = containers.has(n.id);
        const grade = container ? null : fieldGrade(n, shownTextField(n)), name = nameMarkText(n);
        return {
          x: p.x, y: p.y, w: p.w, h: p.h, label: n.label, container,
          kind: `${t.label} · L${CodeLoomLevels.depth(data, n.id)}`, ink: semanticInk(t), tone: groupColor(n),
          text: container ? `${immediateChildren(n.id).length} 个直接子项 · ${members(n.id).length} 个组件` : n.summary || n.description || "",
          marks: [...(grade ? [{ text: "代理解读", tone: grade }] : []), ...(name ? [{ text: name }] : [])],
        };
      }),
      bounds: scene.bounds.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, label: label(b.id), mark: nameMarkText(all.get(b.id)) ? { text: nameMarkText(all.get(b.id)) } : null })),
      categories: (scene.categoryBounds || []).map((b) => {
        const t = CodeLoomSemantics.node(b.kind);
        return { x: b.x, y: b.y, w: b.w, h: b.h, ink: semanticInk(t), label: `${t.label} · 类别分区 · ${b.ids.length}` };
      }),
      wires: scene.wires.filter((w) => !w.blocked && w.points.length > 1).map((w) => {
        const t = CodeLoomSemantics.relation(w.relation.type);
        return { path: w.path, points: w.points, dash: t.dash || "", arrow: w.role === "target", ink: semanticInk(t), candidate: candidateMembers(wireMembers(w)), key: JSON.stringify([w.relation.id, w.role, w.from, w.to]) };
      }),
      hubs: scene.hubs.map((h) => ({ x: h.x, y: h.y, w: h.w, h: h.h, ink: semanticInk(CodeLoomSemantics.relation(h.relation.type)), candidate: candidateMembers(h.relation.edgeIds), label: `↗ ${relationTitle(h.relation)}${h.relation.edgeIds.length > 1 ? ` · ${h.relation.edgeIds.length}` : ""}` })),
    });
    try {
      for (let index = 0; index < f.nodes.length; index++) {
        state.step = index; state.selected = f.nodes[index]; state.relation = null; state.levelFocus = "auto";
        const scene = (layout = buildLayout());
        if (!sceneIndex.has(scene)) { sceneIndex.set(scene, scenes.length); scenes.push(describe(scene)); }
        if (scene.hiddenCandidates?.count > (hiddenCandidateNote?.count || 0)) hiddenCandidateNote = { ...scene.hiddenCandidates };
        const { focus, role, categoryRole, edgeRole } = focusRoles(), selectedIds = new Set(focus.selectedIds);
        const wires = scene.wires.filter((w) => !w.blocked && w.points.length > 1);
        const fit = fittedCamera(scene, view.width, view.height, 14, 14);
        const p = scene.items.find((item) => item.n.id === state.selected);
        const camera = p && (state.present || guide || authored) ? readingCamera(p, view.width, view.height, fit.z) : fit;
        boardSteps.push({
          scene: sceneIndex.get(scene), camera,
          itemRoles: scene.items.map((item) => role(item.n.id)),
          itemSelected: scene.items.map((item) => selectedIds.has(item.n.id)),
          boundRoles: scene.bounds.map((b) => role(b.id)),
          categoryRoles: (scene.categoryBounds || []).map(categoryRole),
          wireRoles: wires.map((w) => edgeRole(wireMembers(w))),
          wireActive: wires.map((w) => wireMembers(w).some((id) => focus.relatedEdgeIds.includes(id))),
          hubRoles: scene.hubs.map((h) => edgeRole(h.relation.edgeIds)),
          caption: walkthroughCaption(f, index),
        });
      }
    } finally {
      Object.assign(state, kept);
      layout = shown;
    }
    const vocabulary = authoring()?.gradeVocabulary;
    const candidateNote = [
      drawnCandidates.size ? `含 ${drawnCandidates.size} 条未证实的候选关系（琥珀色虚线）：目标只是一种可能，代码没有证明这个绑定。` : "",
      hiddenCandidateNote ? `${hiddenCandidateNote.within === "view" ? "本视图" : "图中"}隐藏 ${hiddenCandidateNote.count} 条未证实的候选关系，画面中没有画出。` : "",
    ].filter(Boolean).join(" ");
    return {
      width: W.WIDTH, height: W.HEIGHT, title: flowLabel(f), nameMark: nameMarkText(f),
      colors: { ...theme.colors }, dark: theme.dark, font: theme.metrics.font, radius: parseFloat(theme.metrics.radiusCard) || 12,
      particles: !reducedMotion.matches, scenes, steps: boardSteps,
      progress: boardSteps.map((step) => (step.caption.kind === "narrative" ? "narrative" : step.caption.unproven ? "unproven" : "")),
      candidates: { drawn: drawnCandidates.size, hidden: hiddenCandidateNote?.count || 0 },
      footnotes: [
        candidateNote,
        authoring()
          ? `代理解读：${textOf(ownValue(vocabulary, "agent-interpretation")) || "由作者宿主依据引用的源码行撰写，是解读，不是解析得到的事实。"} 区域与场景名称标「代理命名」，不经核验。`
          : hasAuthoringLayer() ? "代理解读层格式不正确，不予采信：解读文字没有导出；代理划分的区域和代理场景另有标记。" : "",
      ].filter(Boolean),
    };
  }
  /** What the story strip and step block say at step `index`, as plain caption fields. */
  function walkthroughCaption(f, index) {
    const id = f.nodes[index], counter = `${String(index + 1).padStart(2, "0")} / ${f.nodes.length} · ${label(id)}`;
    if (isAuthoredScenario(f)) {
      const raw = listOf(f.steps)[index], step = isRecord(raw) ? raw : {}, narrative = scenarioStepNarrative(step);
      const edge = !narrative && typeof step.edgeId === "string" && step.edgeId ? graphIndex.edges.get(step.edgeId) : null;
      const unproven = scenarioStepUnproven(step), resolution = scenarioStepResolution(step);
      const direction = narrative ? null : step.direction === "reverse" ? "反向" : step.direction === "forward" ? "正向" : null;
      const status = scenarioStepStatus(step), previous = index > 0 ? f.nodes[index - 1] : null;
      const badges = narrative
        ? [{ text: "叙述衔接 · 无代码关系", tone: "narrative" }]
        : [
            ...(edge || step.edgeId ? [{ text: ownValue(RESOLUTION_LABELS, resolution) || resolution || "分析记录中没有这条关系", tone: unproven ? "candidate" : "proven" }] : []),
            ...(unproven ? [{ text: "未证实调用", tone: "unproven" }] : []),
          ];
      // Agent-named role labels of the step's object and relation; names, never graded.
      for (const item of [all.get(id), edge]) if (authoredLabelOf(item)) badges.push({ text: `代理命名 · ${authoredLabelOf(item)}`, tone: "name" });
      const reasonText = textOf(step.reason) && status ? step.reason : "";
      return {
        counter,
        subtitle: `${f.label || f.title || f.id} · 代理解读的任务场景 · ${listOf(f.steps).some(scenarioStepNarrative) ? "沿代码关系与叙述衔接阅读" : "沿已存在的关系阅读"}，非运行轨迹`,
        kind: narrative ? "narrative" : edge ? "edge" : "start", unproven,
        heading: index === 0 ? "起点" : `第 ${index + 1} 步${direction ? ` · ${direction}` : ""}`,
        badges,
        via: narrative
          ? `从 ${label(previous)} 到 ${label(id)} 的衔接只由引用的文字说明；代码里没有记录这两者之间的关系。`
          : edge ? `${CodeLoomSemantics.relation(edge.type).shortLabel} · ${label(edge.source)} → ${label(edge.target)}${direction === "反向" ? " · 逆向走到此处，箭头仍指向记录的方向" : ""}` : index === 0 ? "" : "这一步没有记录连接的关系。",
        reason: reasonText || `这一步没有保留解读文字（未通过核验或未生成）${narrative ? "。" : "，只保留它所沿的关系。"}`,
        reasonMuted: !reasonText,
        reasonMark: reasonText ? { text: `代理解读 · ${INTERPRETATION_GRADES[status]}`, tone: status } : null,
      };
    }
    /* A guide or curated flow step: the same heading, relation and reason as the live step panel
       (guideStepBlock). The relation's proof state comes from the Analysis IR: a candidate edge
       is never drawn as a proven one. */
    const step = guideStep(f, index), info = isSourceGuide(f) ? guideInfo(f) : null;
    const unproven = Boolean(step.edgeId && candidateIds.has(step.edgeId));
    return {
      counter: info ? `关联对象 ${index + 1} / ${f.nodes.length} · ${guideNodeLabel(id, f)}` : counter,
      subtitle: info
        ? `入口 ${info.title} · ${info.context} · 关联可有分支；阅读顺序不代表执行顺序`
        : `${f.label || f.id} · ${generated() ? "静态依赖阅读 · 非运行轨迹" : "文档场景"} · 阅读顺序不代表执行顺序`,
      kind: step.kind, unproven,
      heading: { entry: "为什么先读这里", downstream: "为什么接着读这里", upstream: "为什么要回看上游", neighborhood: "它为什么出现在这条导览里" }[step.kind],
      badges: [
        ...(step.relationLabel ? [{ text: step.relationLabel, tone: unproven ? "candidate" : "proven" }] : []),
        ...(unproven ? [{ text: "未证实调用", tone: "unproven" }] : []),
      ],
      via: guideAnchorText(step),
      reason: step.reason, reasonMuted: false, reasonMark: null,
    };
  }
  /** The step's evidence anchor as the live panel names it (guideStepAnchor), as plain text. */
  function guideAnchorText(step) {
    const record = step.evidenceIds.length ? evidenceRecord(step.evidenceIds[0]) : null;
    if (record) return `证据锚点 · ${[evidenceSourcePath(record), evidenceSpanLabel(record)].filter(Boolean).join(" · ") || evidenceKindLabel(record)}`;
    const ref = step.sourceRefs[0];
    if (!ref) return `证据锚点 · 这一步没有保留可点的源码锚点：${step.edgeId ? `关系 ${step.edgeId} 未附带原文` : "对象本身未附带原文"}`;
    return `证据锚点 · ${ref.file || label(step.id)}${Number.isInteger(ref.lineStart) ? ` · 第 ${ref.lineStart}–${Number.isInteger(ref.lineEnd) ? ref.lineEnd : ref.lineStart} 行` : ""}`;
  }
  const formatBytes = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(2)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
  async function exportWalkthrough(format) {
    const f = walkthroughFlow();
    if (!f || exportJob) return;
    const W = SkylenseWalkthrough, controller = new AbortController(), job = { controller, format };
    const name = `skylense-${String(f.id).replace(/[^a-z0-9_-]+/gi, "-").slice(0, 60) || "walkthrough"}.${format}`;
    const kind = format === "gif" ? "GIF" : format.toUpperCase();
    exportJob = job;
    modal("导出动画", `<div class="export-progress" role="status" aria-live="polite" data-format="${format}"><p><b>${escape(flowLabel(f))}</b> · ${f.nodes.length} 步 · ${kind}</p><progress id="export-progress" max="1" value="0"></progress><p class="micro" id="export-progress-text">正在准备画面…</p><button class="btn" data-action="export-cancel">${icon("close")}取消</button></div>`);
    const progress = ({ phase, done, total }) => {
      if (exportJob !== job) return;
      $("#export-progress")?.setAttribute("value", String(done / total));
      const text = $("#export-progress-text");
      if (text) text.textContent = phase === "palette" ? `正在取色 ${done} / ${total}` : format === "gif" ? `正在编码第 ${done} / ${total} 帧` : `正在录制第 ${done} / ${total} 帧`;
    };
    try {
      const board = walkthroughBoard(f);
      const result = format === "gif"
        ? await W.exportGIF(board, { onProgress: progress, signal: controller.signal })
        : await W.exportVideo(board, { kind: format, onProgress: progress, signal: controller.signal });
      if (controller.signal.aborted) throw Object.assign(new Error("已取消导出。"), { name: "AbortError" });
      lastExport = { format, name, flow: f.id, steps: f.nodes.length, bytes: result.blob.size, type: result.blob.type, frames: result.frames, fps: result.fps, durationSeconds: result.durationSeconds, ...(result.recordedSeconds === undefined ? {} : { recordedSeconds: result.recordedSeconds }), candidates: board.candidates, unprovenSteps: board.progress.flatMap((kind, i) => (kind === "unproven" ? [i] : [])), footnotes: board.footnotes, width: result.width, height: result.height };
      download(name, result.blob, result.blob.type);
      if ($("#modal").open)
        modal("导出动画", `<div class="export-progress is-done" role="status" data-format="${format}" data-bytes="${result.blob.size}"><p>${icon("check")}<b>${escape(name)}</b> 已下载</p><p class="micro">${f.nodes.length} 步 · ${result.frames} 帧 · ${result.recordedSeconds ?? result.durationSeconds} 秒 · ${result.width}×${result.height} · ${formatBytes(result.blob.size)}</p>${board.footnotes.length ? `<p class="micro">${board.footnotes.map(escape).join("<br>")}</p>` : ""}</div>`);
      toast(`动画 ${kind} 已导出：${formatBytes(result.blob.size)}。`);
    } catch (error) {
      const recorded = error?.recorded, cancelled = error?.name === "AbortError";
      // A failed recording says what it really recorded; nothing is downloaded.
      const message = `${error?.message || String(error)}${recorded ? ` 已录制 ${recorded.frames} / ${recorded.planned} 帧（${recorded.seconds} 秒），没有下载文件。` : ""}`;
      lastExport = { format, flow: f.id, error: cancelled ? "cancelled" : message, ...(recorded ? { recorded } : {}) };
      if (cancelled) toast("已取消导出动画。");
      else {
        if ($("#modal").open) modal("导出动画", `<div class="source-error" role="alert" data-format="${format}"><strong>动画没有导出</strong><p>${escape(message)}</p></div>`);
        toast("动画导出失败：" + message);
      }
    } finally {
      if (exportJob === job) exportJob = null;
    }
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
    /* Authored text keeps its label in the export: every exported line that shows agent text is
       marked with its own grade, agent-made names with a neutral mark (names are not claims),
       and a footnote states what the marks mean. */
    const exportGrade = (n, textShown) => !authoring() || !n || !textShown ? null
      : fieldGrade(n, containers.has(n.id) ? "description" : "summary");
    const nameMark = (n) => [nameChip(n) ? (authoring() ? "代理命名" : n.sourceRole === "authored-region" ? "代理划分" : "代理场景") : "", authoredLabelOf(n) ? `代理命名 · ${authoredLabelOf(n)}` : ""].filter(Boolean).join(" · ");
    const hubRole = (relation) => { const roles = [...new Set(relation.edges.map(authoredLabelOf).filter(Boolean))]; return roles.length === 1 ? roles[0] : ""; };
    const itemGrades = new Map(layout.items.map((p) => [p.n.id, exportGrade(p.n, Boolean(p.n.summary))]));
    const named = [...layout.items.map((p) => p.n), ...layout.bounds.map((b) => all.get(b.id))].some((n) => nameMark(n)) || layout.hubs.some((h) => hubRole(h.relation));
    const vocabulary = authoring()?.gradeVocabulary;
    const footnoteLines = [
      ...([...itemGrades.values()].some(Boolean)
        ? [`代理解读：${textOf(ownValue(vocabulary, "agent-interpretation")) || "由作者宿主依据引用的源码行撰写，是解读，不是解析得到的事实。"}`,
           ...["verified", "partly-verified", "unverified"].map((grade) => `代理解读 · ${INTERPRETATION_GRADES[grade]}：${textOf(ownValue(vocabulary, grade))}`)]
        : []),
      ...(named ? [authoring() ? "代理命名：区域与场景的名称、对象与关系的作用标签由作者宿主拟定，不是解析得到的事实，也不经核验。" : "代理划分 / 代理场景：由作者宿主划分或编排；其解读层格式不正确，未被采信，解读文字没有导出。"] : []),
    ];
    const footnoteHeight = footnoteLines.length ? 20 + footnoteLines.length * 15 : 0;
    const footnote = footnoteLines.map((line, index) => `<text x="30" y="${layout.height + 118 + index * 15}" font-size="10" fill="${muted}">${escape(line)}</text>`).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height + 115 + footnoteHeight}" viewBox="0 0 ${layout.width} ${layout.height + 115 + footnoteHeight}" font-family="sans-serif"><rect width="100%" height="100%" fill="${bg}"/><text x="30" y="28" font-size="17" fill="${text}">Skylense · ${escape(data.meta?.title || "Architecture")}</text><text x="30" y="48" font-size="10" fill="${muted}">${generated() ? "Automatically generated static source map" : imported ? "Imported architecture model" : "Pinned public-source snapshot"} · Original relationship identities preserved</text>${legend}<g transform="translate(0 100)"><defs>${markers}</defs>${layout.bounds.map((b) => `<g><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="8" fill="none" stroke="${muted}" stroke-dasharray="4 4"/><text x="${b.x + 16}" y="${b.y + 23}" font-size="11" fill="${muted}">${escape(label(b.id))}${nameMark(all.get(b.id)) ? ` · ${nameMark(all.get(b.id))}` : ""}</text></g>`).join("")}${(
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
        return `<g><title>${escape(t.label)} · ${shape.cardinality} · ${h.relation.edgeIds.length} 条</title><rect x="${h.x}" y="${h.y}" width="${h.w}" height="${h.h}" rx="17" fill="${panel}" stroke="${semanticInk(t)}"/><text x="${h.x + 9}" y="${h.y + h.h / 2 + 3}" font-size="10" fill="${semanticInk(t)}">↗ ${escape(relationTitle(h.relation).slice(0, 12))}${h.relation.edgeIds.length > 1 ? ` · ${h.relation.edgeIds.length}` : ""}</text>${hubRole(h.relation) ? `<text data-interpretation="name" x="${h.x + 9}" y="${h.y + h.h + 11}" font-size="9" fill="#7a5bc4">代理命名 · ${escape(hubRole(h.relation))}</text>` : ""}</g>`;
      })
      .join("")}${layout.items
      .map((p) => {
        const t = CodeLoomSemantics.node(p.n.kind);
        const grade = itemGrades.get(p.n.id), name = nameMark(p.n);
        const marks = [grade ? `代理解读 · ${INTERPRETATION_GRADES[grade]}` : "", name].filter(Boolean).join(" · ");
        return `<g><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="9" fill="${panel}" stroke="${semanticInk(t)}" ${containers.has(p.n.id) ? 'stroke-dasharray="4 3"' : ""}/><text x="${p.x + 15}" y="${p.y + 26}" font-size="13" fill="${text}">${escape(p.n.label.length > 27 ? p.n.label.slice(0, 26) + "…" : p.n.label)}</text><text x="${p.x + 15}" y="${p.y + 46}" font-size="10" fill="${semanticInk(t)}">${escape(t.label)} · ${escape(p.n.id)}</text><text x="${p.x + 15}" y="${p.y + 70}" font-size="10" fill="${muted}">${escape((p.n.summary || "Module boundary").slice(0, 34))}</text>${marks ? `<text data-interpretation="${grade || "name"}" x="${p.x + 15}" y="${p.y + Math.min(p.h - 8, 88)}" font-size="9" fill="#7a5bc4">${marks}</text>` : ""}</g>`;
      })
      .join("")}</g>${footnote}</svg>`;
    download("skylense-view.svg", svg, "image/svg+xml");
    toast("当前画布与语义样式已导出为 SVG。");
  }
  function documentModal(id) {
    const doc = (data.documents || []).find((d) => d.id === id);
    if (!doc) return;
    modal(
      doc.title,
      `<p>${isAgentGuide(doc) && !doc.path ? "" : `<code>${escape(doc.path)}</code> · `}${isAgentGuide(doc) ? `${interpretationBadge(null)} 代理撰写的阅读导览：由这个场景已保留的解读按固定模板编排，未经人工审阅；每条解读的核验分级与引用在场景步骤和证据面板里` : doc.status === "proposal" ? "拟议方案，未核验实施" : generated() ? "自动提取的来源文本" : "示例阅读指南"}</p><pre>${escape(doc.content)}</pre>${isAgentGuide(doc) && listOf(doc.evidenceIds).length ? `<div class="section-label">源码</div><div class="authored-meta">${listOf(doc.evidenceIds).filter((id) => typeof id === "string").map(citationChip).join("")}</div>` : ""}`,
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
      // The legend drives the toolbar filter, so both controls take the same path below.
      const select = $("#edge-filter");
      select.value = state.type === value ? "all" : value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    },
    /** The one control that shows or hides unproven candidate relations. */
    "toggle-candidates": () => {
      state.showCandidates = !state.showCandidates;
      refilterRelations("当前关系是未证实的候选关系，已随候选关系一起隐藏，已退出关系详情。");
      $('[data-action="toggle-candidates"]')?.focus();
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
      evidenceOrigin = null;
      restoreReading(old);
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
    "canvas-expand": (_, id) => { expandContainer(id); focusContainerControl(id, "node-expand"); },
    "canvas-collapse": (_, id) => { collapseContainer(id); focusContainerControl(id, "boundary-collapse"); },
    "collapse-canvas": () => {
      state.lens = "scope";
      state.openContainers = [];
      // The tree closes what the canvas closed: everything below the reading scope.
      for (const id of [...state.expanded])
        if (id !== state.scope && (state.scope === null || crumbIds(id).includes(state.scope))) state.expanded.delete(id);
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
    /**
     * Every relation the current projection holds, drawn or deferred, in one enumerable list.
     * The drawing budget bounds what the canvas paints; it never bounds what is reachable.
     */
    "all-relations": (page) => {
      const view = layout.relationProjection;
      const drawn = new Set(view?.drawnRelationIds || layout.relations.map((r) => r.id));
      const size = 40, total = layout.relations.length;
      const pages = Math.max(1, Math.ceil(total / size));
      const current = Math.max(0, Math.min(pages - 1, Number(page) || 0));
      const slice = layout.relations.slice(current * size, (current + 1) * size);
      modal(
        "当前投影中的全部关系",
        `<p class="dialog-lead">完整投影共 ${total} 个关系枢纽，画布本屏绘制 ${view?.drawn ?? total} 个。未绘制的关系仍保留原始成员边与方向，可从这里直接选中。</p><div class="relation-index">${slice.map((rel) => `<button class="connection" data-action="relation" data-id="${escape(rel.id)}">${typeBadge(rel.type)}<span>${escape(relationTitle(rel))}<small>${rel.edgeIds.length} 条原始边 · ${drawn.has(rel.id) ? "本屏已绘制" : "未绘制 · 保留在完整索引"}</small></span>${icon("arrow")}</button>`).join("")}</div>${pages > 1 ? `<div class="canvas-paging"><button data-action="all-relations" data-value="${current - 1}" ${current === 0 ? "disabled" : ""} aria-label="上一页关系">←</button><span>${current + 1} / ${pages} 页 · ${total} 个关系</span><button data-action="all-relations" data-value="${current + 1}" ${current + 1 === pages ? "disabled" : ""} aria-label="下一页关系">→</button></div>` : ""}`,
      );
    },
    /** Select a declared semantic group by its real ID, from the canvas or the inspector. */
    "relation-group": (_, id) => {
      const group = groupById(id);
      if (!group) return;
      rememberReading();
      rememberRelation();
      state.relationGroup = group;
      state.relation = null;
      state.selected = null;
      state.levelFocus = "auto";
      state.tab = "overview";
      renderInspector();
      renderCanvas(false);
      renderSidebar();
      hash();
    },
    /** Drop to the group's binary members without losing the group reading position. */
    "relation-group-members": (_, id) => {
      const group = groupById(id) || state.relationGroup;
      if (!group) return;
      state.relationGroup = null;
      selectRelation(group.memberEdgeIds);
    },
    "clear-group": () => {
      if (!state.relationGroup) return;
      state.relationGroup = null;
      render();
    },
    /** Accept the current snapshot and stop warning; the selection is not reinterpreted. */
    "recovery-keep": () => {
      state.viewRecovery = null;
      state.unresolved = null;
      renderRecovery();
      hash();
    },
    /** Drop the unrestorable selection and keep the rest of the reading position. */
    "recovery-locate": () => {
      state.viewRecovery = null;
      state.unresolved = null;
      state.relation = null;
      state.relationGroup = null;
      state.trace = null;
      render();
    },
    /** A portable view file carries complete membership, so it reopens without local storage. */
    "recovery-export": () => {
      download("skylense-view.json", JSON.stringify(ViewState.exportBundle(currentView()), null, 2));
      toast("已导出可移植视图；它包含完整成员列表，不依赖本地存储。");
    },
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
    /**
     * Open the source span a claim rests on. The reading position is recorded first, so the
     * back control returns to the tab and component the reader came from.
     */
    "evidence-source": (_, id) => {
      const record = evidenceRecord(id);
      if (!record) { toast("这条依据在当前快照中没有记录。"); return; }
      rememberReading();
      state.tab = "evidence";
      renderInspector();
      hash();
      const span = record.range ? `${record.range.startLine}–${record.range.endLine}` : "";
      modal("源码依据 · " + (record.fileId || id),
        `<div class="evidence-source"><p class="micro">${escape(record.id)} · ${escape(record.verification || record.kind || "")}${span ? ` · 行 ${escape(span)}` : ""}</p><pre>${escape(record.excerpt || "")}</pre><p class="micro">摘录来自存储的来源片段，未被改写。</p><div class="modal-actions"><button class="btn primary" data-action="back-selection">${icon("back")}返回刚才的位置</button></div></div>`);
    },
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
    "canvas-page": value => { canvasPages.set(layoutContextKey, Number(value)); renderCanvas(true); hash(); },
    home: () => scope(null),
    scope: (_, id) => scope(id),
    select: (_, id) => select(id),
    /* A start-here entry: select the object in its own module and bring it into view. */
    "authored-focus": (_, id) => {
      select(id);
      focusReadingNode();
    },
    /** The tree caret: 展开 / 收起, the same behaviour as the canvas `+` / `−`, read from the
     *  same open state the caret displays. */
    expand: (_, id) => {
      if (containerOpen(id)) collapseContainer(id);
      else expandContainer(id);
      focusContainerControl(id, "caret");
    },
    tab: (value) => {
      state.tab = value;
      renderInspector();
      applyLevelHighlights();
      hash();
    },
    mode: (value) => {
      if (value === "flow" && (data.flows || []).length) {
        const next = currentFlow() || relatedGuides(state.scope)[0] || data.flows[0];
        actions.flow(null, next.id);
        return;
      }
      rememberRelation();
      state.lens = "scope";
      state.mode = value;
      state.levelFocus = "auto";
      state.relation = null;
      state.trace = null;
      if (value === "flow") {
        if (!(data.flows || []).length) {
          state.mode = "components";
          toast(generated() ? "当前范围尚无可用于导览的已解析关系，请查看分析报告。" : "此模型没有预设流程，可用「路径」探索已有连接。");
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
      if (isSourceGuide(f) && !(state.mode === "flow" && guideOrigin?.model === data)) {
        guideOrigin = { model: data, view: snapshotState() };
      }
      rememberReading();
      rememberRelation();
      state.lens = "scope";
      state.flow = id;
      state.levelFocus = "auto";
      state.relation = null;
      state.mode = "flow";
      state.trace = null;
      state.step = 0;
      state.selected = f.nodes[0];
      state.scope = isSourceGuide(f) ? guideInfo(f).containerId : null;
      state.type = "all";
      state.tab = "overview";
      state.query = "";
      render();
      if (isSourceGuide(f) || isAuthoredScenario(f)) focusReadingNode();
      if (window.innerWidth <= 950) $("#sidebar").classList.remove("open");
    },
    "guide-range": value => {
      guideBrowse = value === "all" ? "all" : "context";
      renderSidebar();
      $(`.guide-range [data-value="${guideBrowse}"]`)?.focus();
    },
    /* A guide step's evidence anchor: the cited record when the model has one, otherwise the
       connecting relation's own source excerpt, otherwise the object's. Never a dead label. */
    "guide-anchor": (_, index) => {
      const f = currentFlow();
      if (!f) return;
      const step = guideStep(f, Number(index));
      if (step.evidenceIds.length) { showEvidence(step.evidenceIds[0]); return; }
      if (step.edgeId) { actions["raw-edge"](null, step.edgeId); return; }
      select(step.id);
      state.tab = "evidence";
      renderInspector();
    },
    "guide-return": () => {
      const origin = guideOrigin, f = currentFlow();
      guideOrigin = null;
      if (origin?.model !== data) { scope(f ? guideInfo(f).containerId : state.scope); return; }
      rememberReading();
      restoreReading(origin.view);
    },
    "guide-locate": () => {
      const f = currentFlow();
      if (!f) return;
      const id = f.nodes.includes(state.selected) ? state.selected : guideInfo(f).anchorId;
      const n = nodes.get(id);
      if (!n) return;
      scope(n.parentId || n.group);
      select(id);
      focusReadingNode();
      $("#sidebar").classList.add("open");
      $('#tree-content [aria-current="location"]')?.scrollIntoView({ block: "nearest" });
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
      renderSidebar();
      renderStory();
      renderInspector();
      renderCanvas(false);
      if (state.present || isSourceGuide(f) || isAuthoredScenario(f)) focusReadingNode();
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
    // Reversing a route reverses every waypoint, not only the endpoints: the reading order of
    // the whole ordered list is what a reader means by "the other way round".
    "path-reverse": () => { captureRoute(); routeDraft.stops.reverse(); routeResult = null; renderRoute("route-from"); },
    /** An exhausted search is an open question: resume it with the larger budget it asked for. */
    "path-continue": () => {
      const continuation = routeResult?.continuation;
      if (!continuation) return;
      routeDraft = { ...routeDraft, budget: continuation.budget };
      routeResult = SkylensePaths.search(data, continuation);
      routeResults();
    },
    "path-clear": () => { captureRoute(); routeDraft.stops = [routeDraft.stops[0], routeDraft.stops.at(-1)]; routeResult = null; renderRoute("route-from"); },
    "find-route": () => { captureRoute(); routeResult = SkylensePaths.search(data, routeDraft); routeResults(); },
    "apply-path": (_, id) => {
      const path = routeResult?.paths[Number(id)];
      if (!path) return;
      rememberRelation();
      state.trace = pathTrace(routeResult.options, path.key);
      state.type = "all"; state.lens = "scope"; state.selected = state.trace.start;
      state.relation = null; state.scope = null; state.mode = "components"; state.flow = null;
      // The chosen path is drawn whole: candidate steps on it are revealed and named.
      const viaCandidates = !state.showCandidates && (state.trace.edges || []).some((edgeId) => candidateIds.has(edgeId));
      if (viaCandidates) state.showCandidates = true;
      $("#modal").close(); render();
      toast(`已显示 ${path.steps.length} 跳的关系路径；原始箭头方向保持不变。${viaCandidates ? "路径经过未证实的候选关系，已显示候选关系。" : ""}`);
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
      /* A theme only changes appearance, so it must not cost the reader their place: the
         re-render rebuilds every panel, which resets scroll containers unless they are carried
         across it alongside the camera. */
      preserveScroll(() => {
        render();
        state.camera = camera;
        applyCamera();
      });
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
      download("skylense-model.json", JSON.stringify(storedModel(), null, 2));
      toast("完整模型已导出。");
    },
    "export-svg": exportSVG,
    "export-gif": () => exportWalkthrough("gif"),
    "export-video": (value) => exportWalkthrough(value === "mp4" ? "mp4" : "webm"),
    "export-cancel": () => {
      exportJob?.controller.abort();
      $("#modal").close();
    },
    import: () => $("#import-file").click(),
    document: (_, id) => documentModal(id),
    evidence: (_, id) => showEvidence(id),
    /* Entering the structure from a citation is a drilldown: record the position first so the
       reader can come back to the exact place the citation was opened from. */
    "evidence-locate": (_, id) => {
      const subject = evidenceSubject(evidenceRecord(id));
      if (!subject) return;
      $("#modal").close();
      rememberReading();
      select(subject.id);
      state.tab = "evidence";
      renderInspector();
      focusReadingNode();
      toast(`已定位 ${label(subject.id)}；可用「返回依据前的位置」回到刚才的阅读位置。`);
    },
    "evidence-return": () => {
      const origin = evidenceOrigin;
      evidenceOrigin = null;
      $("#modal").close();
      if (origin?.model !== data) return;
      restoreReading(origin.view);
    },
    "all-docs": () =>
      modal(
        "项目文档",
        `${orderedDocuments().map((d) => `<button class="connection" data-action="document" data-id="${escape(d.id)}">${icon("document")}<span>${escape(d.title)}<small>${isAgentGuide(d) ? "代理撰写的阅读指南 · 代理解读" : escape(d.path)}</small></span>${icon("arrow")}</button>`).join("")}`,
      ),
    save: () =>
      modal(
        "保存当前阅读位置",
        `<p>保留当前模块、选择、关系筛选、路径与视口。${imported ? "导入模型的书签仅保留在当前会话。" : "视图保存在此浏览器本地。"}</p><label>视图名称<input id="view-name" maxlength="80" value="${escape((state.selected ? label(state.selected) : "系统总览") + " · " + (state.trace ? "路径" : "探索"))}"></label><div class="modal-actions"><button class="btn primary" data-action="confirm-save">保存视图</button></div>`,
      ),
    "claims-page": (value) => {
      const step = value === "prev" ? -CLAIM_PAGE_SIZE : CLAIM_PAGE_SIZE;
      claimPage.offset = Math.max(0, claimPage.offset + step);
      renderInspector();
    },
    "claims-scope": (value) => {
      claimPage.scope = value === "all" ? "all" : "node";
      claimPage.offset = 0;
      renderInspector();
    },
    /* Step one of a review: a dialog that names the claim and the disposition, and asks the
       person for their identity. Nothing is recorded until they confirm. */
    "review-claim": (disposition, id) => {
      const claim = claimRecord(id);
      if (!claim || !Claims() || !["checked", "rejected"].includes(disposition)) return;
      const verb = disposition === "checked" ? "核对通过" : "驳回";
      modal(`${verb}这条解释`, `<p>你在记录一个人的核对：已经对照引用依据读过这条解释，并判断它${disposition === "checked" ? "成立" : "不成立"}。代理核验结论不能代替这一步。</p><blockquote class="review-quote">${escape(claim.text)}</blockquote><p class="micro">${escape(claim.id)} · ${escape(claim.predicate)} · 引用依据 ${listOf(claim.evidenceIds).length} 条</p><label>核对人（必填，请输入你的名字或账号）<input id="review-identity" maxlength="160" autocomplete="off" value=""></label><label>备注（可选）<textarea id="review-note" maxlength="2000" rows="3"></textarea></label><p id="review-error" class="review-error" role="alert"></p><div class="modal-actions"><button class="btn" data-action="close-modal">取消</button><button class="btn primary" data-action="confirm-review" data-value="${disposition}" data-id="${escape(claim.id)}">确认${verb}</button></div>`);
      $("#review-identity")?.focus();
    },
    "confirm-review": (disposition, id) => {
      const identity = ($("#review-identity")?.value || "").trim();
      const refuse = (message) => {
        const error = $("#review-error");
        if (error) error.textContent = message;
        toast(message);
      };
      if (!identity) { refuse("没有记录：请填写核对人。核对必须由一个具名的人确认。"); return; }
      const note = ($("#review-note")?.value || "").trim() || null;
      if (!reviewableAnalysis()) { refuse("没有记录：当前模型不可修改。"); return; }
      const at = new Date().toISOString();
      let result;
      try {
        result = Claims().reviewClaim(data, id, { disposition, reviewer: { identity, channel: "ui" }, note, now: at });
      } catch (err) {
        refuse(`没有记录：${err.message}`);
        return;
      }
      const stored = storedReviews();
      const entry = isRecord(ownValue(stored, id)) ? stored[id] : {};
      stored[id] = { reviewedBy: result.reviewedBy, history: [...listOf(entry.history), { event: disposition, at, identity }] };
      const persisted = storage.set(reviewStorageKey(), stored);
      claimIndex = null;
      $("#modal").close();
      const content = $("#inspector .inspector-content"), top = content?.scrollTop || 0;
      renderInspector();
      const next = $("#inspector .inspector-content");
      if (next) next.scrollTop = top;
      toast(`${disposition === "checked" ? "已核对通过" : "已驳回"}，核对人 ${identity}。${persisted ? "" : "浏览器无法持久保存；核对只在此会话有效。"}`);
    },
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
      // A saved view is untrusted input too: a stored snapshot ID that no longer matches is
      // named instead of being reinterpreted against the current facts.
      const savedSnapshot = s.snapshotId || null;
      const mismatch = Boolean(savedSnapshot && modelSnapshotId() && savedSnapshot !== modelSnapshotId());
      Object.assign(state, s, {
        // A stored position serialises `expanded` as an array; the live state keeps a Set.
        expanded: new Set((Array.isArray(s.expanded) ? s.expanded : []).filter((id) => all.has(id))),
        query: typeof s.query === "string" ? s.query : "",
      });
      state.viewRecovery = mismatch
        ? {
            reason: "snapshotMismatch",
            stale: true,
            snapshotId: savedSnapshot,
            currentSnapshotId: modelSnapshotId(),
            issues: [{ role: "snapshot", reason: "snapshotMismatch", token: savedSnapshot }],
          }
        : null;
      state.unresolved = null;
      state.relationGroup = !mismatch && s.relationGroup?.id ? groupById(s.relationGroup.id) : null;
      if (s.trace?.kind === "path") state.trace = pathTrace(s.trace.plan, s.trace.choice);
      state.lens = ["scope", "neighbors", "global"].includes(s.lens)
        ? s.lens
        : "scope";
      state.present = s.present === true;
      state.openContainers = Array.isArray(s.openContainers)
        ? s.openContainers.filter((id) => containers.has(id))
        : [];
      state.bundle = s.bundle !== false;
      // Saved before the candidate control existed: show candidates only if the view selects one.
      state.showCandidates = typeof s.showCandidates === "boolean"
        ? s.showCandidates
        : [...(s.relation?.edgeIds || []), ...(s.trace?.edges || [])].some((edgeId) => candidateIds.has(edgeId));
      state.levelFocus = validLevelFocus(s.levelFocus);
      state.focusDimming = s.focusDimming !== false;
      state.categoryGroups = s.categoryGroups !== false;
      state.relation =
        !mismatch &&
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
        `<p><kbd>/</kbd> 搜索组件与函数<br><kbd>0</kbd> 适应画布<br><kbd>+</kbd> / <kbd>−</kbd> 缩放<br><kbd>→</kbd> / <kbd>←</kbd> 展开 / 收起聚焦的模块<br><kbd>R</kbd> 探索带必经点的关系路径<br><kbd>M</kbd> 暂停 / 开启连线流动<br><kbd>T</kbd> 选择工作空间主题<br><kbd>Esc</kbd> 关闭弹窗、预览或追踪<br><kbd>?</kbd> 打开帮助</p><p>单击节点固定详情。<b>展开</b>（目录箭头、画布 <kbd>+</kbd>、双击容器）在画布上显示模块的子项，目录同步打开；<b>进入</b>（模块标题、「进入模块」）以该模块为当前范围。悬停节点或连接可快速预览；「对照」将两个节点并排展示。</p><p>未证实的候选关系（词法同名、条件或分派候选）默认隐藏，图例中显示隐藏数量，可随时显示。</p><p>内置示例根据固定 commit 的公开源码整理，覆盖精选核心组件。关系、输入输出和章节是阅读视图；动态流动表示箭头方向，不是实际运行轨迹。</p>`,
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
      /* Two clicks on a container: 展开, the same verb as the `+` button and the tree caret.
         The first click re-renders the canvas, so the browser's own `dblclick` can land on a
         detached node; the click count (`detail`) and the pair below are what reliably arrive. */
      if (e.detail >= 2 || (lastNodeClick.id === id && e.timeStamp - lastNodeClick.time < 500)) {
        lastNodeClick = { id: null, time: 0 };
        e.preventDefault();
        expandContainer(id);
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
    if (n && containers.has(n.dataset.id)) expandContainer(n.dataset.id);
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
    if (e.target.id === "guide-node-select") { actions.step(null, e.target.value); return; }
    if (e.target.id === "edge-filter") {
      state.type = e.target.value;
      // Filtering to a type made only of candidates asks to see them; an empty map would not.
      if (!state.showCandidates && candidateOnlyType(state.type)) {
        state.showCandidates = true;
        toast("这一类型只有未证实的候选关系，已显示候选关系。");
      }
      refilterRelations("当前关系已被类型筛选隐藏，已退出关系详情。");
    }
  });
  /**
   * The relation filter (type and candidate visibility) changed: re-derive everything that was
   * computed through it, so no selection or trace keeps showing what the filter now hides.
   */
  function refilterRelations(hiddenMessage) {
    if (state.relation && selectedRelationEdges().some((edge) => !edgeVisible(edge))) {
      state.relation = null;
      toast(hiddenMessage);
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
  $("#import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    cancelSourceJob();
    const serial = sourceSerial;
    try {
      if (file.size > 128 * 1024 * 1024) throw new Error("JSON 文件超过当前 128 MB 资源上限。");
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
    /* Escape has to hand the keyboard back. Every shortcut below is skipped while a
       form field has focus, so without this a user who pressed "/" to search could
       only reach the canvas again with the mouse. One Escape leaves the field; a
       second one then reaches the panel/dialog rules further down. */
    if (e.key === "Escape" && e.target.matches("input,textarea,select")) { e.target.blur(); return; }
    if (
      e.target.matches("input,textarea,select") ||
      e.metaKey ||
      e.ctrlKey ||
      e.altKey
    )
      return;
    if ($("#modal").open && e.key !== "Escape") return;
    /* → / ← on a focused container (tree row, caret, canvas card, its `+`, or an open
       boundary's title / 收起) is 展开 / 收起, exactly what the caret, the `+` and a double-click
       do. ← on a container that is not open does nothing. Focus stays on the container: on the
       canvas it moves between the card and the open boundary's 收起 control. */
    const holder = (e.key === "ArrowRight" || e.key === "ArrowLeft") && e.target.dataset?.id && containers.has(e.target.dataset.id) &&
      ["caret", "tree-select", "graph-node", "node-expand", "boundary-collapse", "boundary-title"].find((name) => e.target.classList.contains(name));
    if (holder) {
      e.preventDefault();
      const id = e.target.dataset.id;
      if (e.key === "ArrowRight") expandContainer(id);
      else collapseContainer(id);
      focusContainerControl(id, holder);
      return;
    }
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
  // A generated model opened without a link starts on its top-ranked guide, an authored one
  // inside its core; curated demos and explicit links keep their own landing.
  if (bootViewRequested || !landOnGuide()) render();
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
    getExport: () => (lastExport ? { ...lastExport, running: Boolean(exportJob) } : { running: Boolean(exportJob) }),
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
          // "edge" is one binary relation, "bundle" is a visual aggregation of several of
          // them, and relationGroups below are declared semantic groups. Three distinct kinds.
          relations: layout.relations.map((r) => ({
            id: r.id,
            kind: r.kind,
            edgeIds: r.edgeIds,
            sources: r.sources,
            targets: r.targets,
            type: r.type,
            label: r.label,
            groupIds: r.groupIds || [],
          })),
          relationGroups: layout.relationGroups || [],
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
