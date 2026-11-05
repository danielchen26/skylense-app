/*
 * ViewState v3 — one schema for the whole reading position.
 *
 * Every field a reader can change (snapshot, scope, focus, mode, lens, filter, selection,
 * relation group, parent context, trace, waypoints, guide step, tab, expanded items and camera)
 * is normalised here, and every producer/consumer of a URL goes through `serialize` / `read`.
 * Views never mutate facts: a URL carries identity and membership, never a graph.
 *
 * Membership uses exactly three encodings, in this order:
 *   ids     — a short, stable list written literally into the URL.
 *   recipe  — a recomputable selector over the current snapshot plus the COMPLETE member
 *             digest; the recomputed set is verified against that digest after restore.
 *   ref     — a registry/bundle reference for arbitrarily large state. A reference binds the
 *             full immutable context (snapshot + selection + parent + trace + open), so two
 *             views that share children but differ in parent context get different references
 *             and can never overwrite each other. Stored records are verified by digest on
 *             read-back, never by body length.
 */
(function (root) {
  "use strict";

  const MODES = Object.freeze(["hierarchy", "components", "flow"]);
  const TABS = Object.freeze(["overview", "connections", "contracts", "context", "evidence", "members", "docs", "claims"]);
  const LENSES = Object.freeze(["scope", "neighbors", "global"]);
  const REACHES = Object.freeze(["upstream", "downstream"]);
  const DIRECTIONS = Object.freeze(["upstream", "downstream", "both"]);
  /** Above this member count a literal list stops being a readable URL. */
  const RELATION_THRESHOLD = 8;
  /** Longest literal member list, in characters: eight hash-shaped IDs already overflow. */
  const INLINE_LIMIT = 240;
  /** Total generated-URL budget, including trace, parent, open and source parameters. */
  const HASH_LIMIT = 2048;
  const VERSION = 3;
  const KEY_PREFIX = "skylense:view:";
  /** URL role -> field of a stored view record. */
  const MEMBER_FIELDS = Object.freeze({
    relation: "edgeIds",
    relationParent: "parentEdgeIds",
    relationTrace: "traceEdgeIds",
    open: "open",
    contextOrigins: "contextOrigins",
  });
  const MEMBER_ROLES = Object.freeze(Object.keys(MEMBER_FIELDS));

  const registry = new Map();
  /** Canonical facts used to recompute recipes. Registered by the app once per model. */
  let facts = { snapshotId: null, edges: [], byId: new Map() };
  /** Membership digests are expensive on 10,000 members; a selection array is immutable. */
  const digestCache = new WeakMap();

  /* ------------------------------------------------------------------ digests */

  /** Four FNV-1a lanes. Only used where SHA-256 is unavailable; never a body length. */
  function fallbackDigest(text) {
    const lanes = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      for (let lane = 0; lane < lanes.length; lane++) {
        lanes[lane] = Math.imul((lanes[lane] ^ (code + lane * 131 + i % 7)) >>> 0, 16777619) >>> 0;
      }
    }
    return lanes.map(value => (value >>> 0).toString(16).padStart(8, "0")).join("");
  }

  function hashText(value) {
    const ir = root.SkylenseAnalysisIR;
    const text = value == null ? "" : String(value);
    return ir && typeof ir.sha256Text === "function" ? ir.sha256Text(text) : fallbackDigest(text);
  }

  /** Order-independent membership digest; identical sets always agree. */
  function digest(ids) {
    return hashText(JSON.stringify([...(ids || [])].slice().sort())).slice(0, 16);
  }

  function memberDigest(ids) {
    if (!Array.isArray(ids)) return digest(ids);
    const cached = digestCache.get(ids);
    if (cached) return cached;
    const value = digest(ids);
    digestCache.set(ids, value);
    return value;
  }

  /* ------------------------------------------------------------------ helpers */

  /**
   * Canonical string list. An already canonical array is returned unchanged so that the
   * membership digest of a 10,000 member selection is computed once, not on every render.
   */
  function list(value) {
    if (Array.isArray(value)) {
      const seen = new Set();
      let canonical = true;
      for (const item of value) {
        if (typeof item !== "string" || !item || seen.has(item)) { canonical = false; break; }
        seen.add(item);
      }
      return canonical ? value : [...new Set(value.map(item => (item == null ? "" : String(item))).filter(Boolean))];
    }
    if (typeof value === "string") return [...new Set(value.split(",").map(item => item.trim()).filter(Boolean))];
    return [];
  }
  const oneOf = (value, allowed, fallback = null) => (allowed.includes(value) ? value : fallback);
  const text = value => (value == null || value === "" ? null : String(value));
  const count = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback);

  function storage() {
    try {
      if (typeof localStorage !== "undefined" && localStorage) return localStorage;
    } catch {}
    return null;
  }

  /* ------------------------------------------------------- registry references */

  /** The immutable context a reference must bind before it may name a stored view. */
  function contextBody(record) {
    return JSON.stringify([
      "view", VERSION,
      record.snapshotId || null,
      record.edgeIds || [],
      record.parentEdgeIds || [],
      record.traceEdgeIds || [],
      record.open || [],
      record.contextOrigins || [],
    ]);
  }

  const contextRef = record => "r" + hashText(contextBody(record)).slice(0, 16);

  /**
   * Store one view context. The returned reference is derived from the full context, so a
   * competing view with the same children under a different parent gets a different key and
   * cannot overwrite this record.
   */
  function registerContext(context = {}) {
    const record = {
      v: VERSION,
      kind: "view",
      snapshotId: context.snapshotId || null,
      edgeIds: [...(context.edgeIds || [])],
      parentEdgeIds: [...(context.parentEdgeIds || [])],
      traceEdgeIds: [...(context.traceEdgeIds || [])],
      open: [...(context.open || [])],
      contextOrigins: [...(context.contextOrigins || [])],
    };
    record.membership = digest(record.edgeIds);
    const ref = contextRef(record);
    record.ref = ref;
    registry.set(ref, record);
    const store = storage();
    let persisted = false;
    if (store) {
      try {
        store.setItem(KEY_PREFIX + ref, JSON.stringify(record));
        persisted = true;
      } catch {}
    }
    return { ref, persisted, record };
  }

  /** Store a complete view when even the compact parameters cannot fit the budget. */
  function registerBundle(view) {
    const body = JSON.stringify(view);
    const ref = "b" + hashText(body).slice(0, 16);
    const record = { v: VERSION, kind: "bundle", ref, body, bodyDigest: hashText(body).slice(0, 16) };
    registry.set(ref, record);
    const store = storage();
    let persisted = false;
    if (store) {
      try {
        store.setItem(KEY_PREFIX + ref, JSON.stringify(record));
        persisted = true;
      } catch {}
    }
    return { ref, persisted, record };
  }

  function readRecord(ref) {
    if (registry.has(ref)) return registry.get(ref);
    const store = storage();
    if (!store) return null;
    let raw = null;
    try {
      raw = store.getItem(KEY_PREFIX + ref);
    } catch {
      return null;
    }
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /** Read a stored context back and verify it by digest. A record that does not re-derive
   *  its own reference is corrupt or foreign and is never adopted. */
  function resolveContext(ref) {
    if (typeof ref !== "string" || ref[0] !== "r") return null;
    const record = readRecord(ref);
    if (!record || typeof record !== "object" || !Array.isArray(record.edgeIds)) return null;
    if (contextRef(record) !== ref) return null;
    if (record.membership && digest(record.edgeIds) !== record.membership) return null;
    registry.set(ref, record);
    return record;
  }

  function resolveBundle(ref) {
    if (typeof ref !== "string" || ref[0] !== "b") return null;
    const record = readRecord(ref);
    if (!record || typeof record !== "object" || typeof record.body !== "string") return null;
    if (hashText(record.body).slice(0, 16) !== record.bodyDigest) return null;
    if ("b" + record.bodyDigest !== ref) return null;
    registry.set(ref, record);
    try {
      return JSON.parse(record.body);
    } catch {
      return null;
    }
  }

  /* ------------------------------------------------------------------ recipes */

  /** Register the canonical edge facts a recipe is recomputed against. */
  function useFacts(model) {
    const edges = Array.isArray(model?.edges) ? model.edges : [];
    facts = {
      snapshotId: model?.analysis?.snapshotId || model?.meta?.revision || null,
      edges,
      byId: new Map(edges.map(edge => [edge.id, edge])),
    };
  }

  const part = value => {
    const body = value == null ? "" : String(value);
    // `.` is not percent-encoded by form URL encoding, so a token stays literal in the hash.
    return `${body.length}.${body}`;
  };

  /** `q1` + length-prefixed selector + complete member digest. Injective, URL safe. */
  function encodeRecipe(recipe, membership) {
    return `q1${part(recipe.source)}${part(recipe.target)}${part(recipe.type)}${part(membership)}`;
  }

  function decodeRecipe(token) {
    if (typeof token !== "string" || !token.startsWith("q1")) return null;
    const fields = [];
    let cursor = 2;
    while (cursor < token.length && fields.length < 4) {
      const mark = token.indexOf(".", cursor);
      if (mark < 0) return null;
      const size = Number(token.slice(cursor, mark));
      if (!Number.isInteger(size) || size < 0) return null;
      fields.push(token.slice(mark + 1, mark + 1 + size));
      cursor = mark + 1 + size;
    }
    if (fields.length !== 4 || cursor !== token.length) return null;
    return { source: fields[0], target: fields[1], type: fields[2], membership: fields[3] };
  }

  /** Every canonical edge of one (source, target, type), in model order. */
  function recipeMembers(recipe) {
    const ids = [];
    for (const edge of facts.edges)
      if (edge.source === recipe.source && edge.target === recipe.target && edge.type === recipe.type)
        ids.push(edge.id);
    return ids;
  }

  /** A recipe is offered only when recomputation reproduces the selection exactly. */
  function recipeFor(ids) {
    if (!Array.isArray(ids) || ids.length < 2 || !facts.edges.length) return null;
    const first = facts.byId.get(ids[0]);
    if (!first) return null;
    const recipe = { source: first.source, target: first.target, type: first.type };
    const members = recipeMembers(recipe);
    if (members.length !== ids.length) return null;
    for (let i = 0; i < ids.length; i++) if (members[i] !== ids[i]) return null;
    return recipe;
  }

  /* ------------------------------------------------------------ view normalise */

  /** A trace is one of: relation detail, reachability, context reach, endpoints, or a path. */
  function normalizeTrace(trace) {
    if (!trace || typeof trace !== "object") return null;
    const edges = list(trace.edges);
    const nodes = list(trace.nodes);
    const normalized = {
      kind: text(trace.kind),
      edges,
      nodes,
      direction: oneOf(trace.direction, DIRECTIONS),
      origin: text(trace.origin),
      origins: trace.origins ? list(trace.origins) : null,
      start: text(trace.start),
      end: text(trace.end),
      choice: text(trace.choice),
      plan: null,
    };
    if (trace.plan && typeof trace.plan === "object") {
      normalized.plan = {
        stops: list(trace.plan.stops),
        direction: oneOf(trace.plan.direction, DIRECTIONS, "downstream"),
        types: trace.plan.types === null || trace.plan.types === undefined ? null : list(trace.plan.types),
        maxHops: count(trace.plan.maxHops, 24),
      };
    }
    if (trace.steps) normalized.steps = trace.steps;
    if (trace.error) normalized.error = trace.error;
    return normalized;
  }

  function normalizeRelation(relation) {
    if (!relation || typeof relation !== "object") return null;
    const edgeIds = list(relation.edgeIds);
    if (!edgeIds.length) return null;
    const parentEdgeIds = list(relation.parentEdgeIds);
    return { edgeIds, parentEdgeIds: parentEdgeIds.length ? parentEdgeIds : null };
  }

  /** Tokens whose membership could not be restored; kept so a reload can still explain them. */
  function normalizeUnresolved(input) {
    if (!input || typeof input !== "object") return null;
    const kept = {};
    for (const role of MEMBER_ROLES) if (typeof input[role] === "string" && input[role]) kept[role] = input[role];
    return Object.keys(kept).length ? kept : null;
  }

  /** The single schema. Every producer builds this shape; every consumer reads it. */
  function normalizeView(input = {}) {
    const camera = input.camera && typeof input.camera === "object"
      ? { x: Number(input.camera.x) || 0, y: Number(input.camera.y) || 0, z: Number(input.camera.z) || 1 }
      : null;
    return {
      v: VERSION,
      snapshotId: text(input.snapshotId),
      scope: text(input.scope),
      focus: text(input.focus ?? input.selected),
      mode: oneOf(input.mode, MODES, input.flow ? "flow" : "hierarchy"),
      lens: oneOf(input.lens, LENSES, "scope"),
      tab: oneOf(input.tab, TABS, "overview"),
      type: text(input.type) || "all",
      flow: text(input.flow),
      step: Math.max(0, count(input.step, 0)),
      open: list(input.open ?? input.openContainers),
      present: input.present === true,
      level: input.level ?? input.levelFocus ?? "auto",
      dimming: input.dimming ?? input.focusDimming !== false,
      categories: input.categories ?? input.categoryGroups !== false,
      bundle: input.bundle !== false,
      // Unproven candidate relations are hidden unless a view says to show them. `null` means
      // the view did not say (every link written before this field existed).
      candidates: typeof input.candidates === "boolean" ? input.candidates : null,
      edge: text(input.edge),
      relation: normalizeRelation(input.relation),
      relationGroup: text(input.relationGroup),
      trace: normalizeTrace(input.trace),
      // References that could not be resolved stay in the URL instead of being erased.
      unresolved: normalizeUnresolved(input.unresolved),
      camera,
    };
  }

  /* ---------------------------------------------------------------- serialize */

  /**
   * Turn a view into a hash that always respects `HASH_LIMIT`.
   * `overflow: "reference"` escalates membership into the registry and never truncates.
   * `overflow: "throw"` rejects a caller that tried to put a graph into a link.
   */
  function serialize(view, options = {}) {
    const state = normalizeView(view);
    const useRecipes = options.recipes !== false;
    const overflow = options.overflow === "throw" ? "throw" : "reference";
    const context = {
      snapshotId: state.snapshotId,
      edgeIds: state.relation?.edgeIds || [],
      parentEdgeIds: state.relation?.parentEdgeIds || [],
      traceEdgeIds: state.trace?.kind === "relation" ? state.trace.edges : [],
      open: state.open,
      contextOrigins: state.trace?.origins || [],
    };
    let reference = null;
    const encodings = {};
    const referenceFor = () => {
      if (!reference) reference = registerContext(context);
      return reference.ref;
    };

    function plan(ids) {
      const members = list(ids);
      if (!members.length) return null;
      const inline = members.join(",");
      const membership = memberDigest(Array.isArray(ids) ? ids : members);
      const recipe = useRecipes ? recipeFor(members) : null;
      return {
        members,
        inline,
        membership,
        short: members.length <= RELATION_THRESHOLD && inline.length <= INLINE_LIMIT,
        recipeToken: recipe ? encodeRecipe(recipe, membership) : null,
      };
    }

    /** `compact` forces every list inline so an over-long link is rejected, not hidden. */
    function emit(params, role, entry, forceInline) {
      if (!entry) {
        // No membership, but the URL named a reference we could not resolve: keep it visible.
        const kept = state.unresolved?.[role];
        if (kept) {
          params.set(role + "Ref", kept);
          encodings[role] = "unresolved";
        }
        return;
      }
      if (entry.short || forceInline) {
        params.set(role, entry.inline);
        encodings[role] = "ids";
        return;
      }
      if (entry.recipeToken) {
        params.set(role + "Ref", entry.recipeToken);
        encodings[role] = "recipe";
        return;
      }
      params.set(role + "Ref", referenceFor());
      encodings[role] = "ref";
    }

    const relationPlan = plan(state.relation?.edgeIds);
    const parentPlan = plan(state.relation?.parentEdgeIds);
    const tracePlan = state.trace?.kind === "relation" ? plan(state.trace.edges) : null;
    const originsPlan = state.trace?.origins ? plan(state.trace.origins) : null;
    const openPlan = plan(state.open);

    function build(compactLists) {
      const params = new URLSearchParams();
      params.set("v", String(VERSION));
      params.set("scope", state.scope || "system");
      params.set("focus", state.focus || "");
      params.set("mode", state.mode);
      if (state.snapshotId) params.set("snapshotId", state.snapshotId);
      if (state.lens !== "scope") params.set("lens", state.lens);
      if (state.present) params.set("present", "1");
      if (state.level !== "auto") params.set("level", String(state.level));
      if (!state.dimming) params.set("dim", "off");
      if (!state.categories) params.set("categories", "off");
      if (state.flow) params.set("flow", state.flow);
      if (state.step) params.set("step", String(state.step));
      if (state.tab !== "overview") params.set("tab", state.tab);
      if (state.relationGroup) params.set("group", state.relationGroup);
      if (state.trace?.origins) {
        params.set("contextReach", state.trace.direction || "downstream");
        emit(params, "contextOrigins", originsPlan, !compactLists);
      }
      if (state.trace?.direction && !state.trace.origins && state.trace.kind !== "path") {
        params.set("reach", state.trace.direction);
        params.set("origin", state.trace.origin || state.focus || "");
      }
      if (state.trace?.kind === "relation" || state.unresolved?.relationTrace) {
        params.set("relationView", "detail");
        emit(params, "relationTrace", tracePlan, false);
      }
      if (state.trace?.start) {
        params.set("from", state.trace.start);
        params.set("to", state.trace.end || "");
      }
      if (state.trace?.kind === "path" && state.trace.plan) {
        const route = state.trace.plan;
        params.set("route", "1");
        params.set("via", route.stops.slice(1, -1).join(","));
        params.set("pathDir", route.direction);
        params.set("pathTypes", route.types === null ? "*" : route.types.join(","));
        params.set("pathHops", String(route.maxHops));
        if (state.trace.choice) params.set("pathChoice", state.trace.choice);
      }
      params.set("type", state.type);
      emit(params, "open", openPlan, !compactLists);
      if (!state.bundle) params.set("bundle", "off");
      // `null` (the default, hidden) writes nothing; an explicit choice is written either way,
      // so a view whose contents would otherwise infer a reveal can say it was hidden.
      if (state.candidates === true) params.set("candidates", "show");
      else if (state.candidates === false) params.set("candidates", "hide");
      if (state.edge && !relationPlan) params.set("edge", state.edge);
      emit(params, "relation", relationPlan, false);
      emit(params, "relationParent", parentPlan, false);
      if (relationPlan) params.set("relDigest", relationPlan.membership);
      return params;
    }

    let params = build(overflow === "reference");
    let hash = params.toString();
    if (hash.length + 1 > HASH_LIMIT && overflow === "reference") {
      // Nothing is dropped: the whole view moves into the registry behind one short reference.
      const stored = registerBundle(state);
      params = new URLSearchParams();
      params.set("v", String(VERSION));
      if (state.snapshotId) params.set("snapshotId", state.snapshotId);
      params.set("viewRef", stored.ref);
      hash = params.toString();
      encodings.view = "bundle";
    }
    if (hash.length + 1 > HASH_LIMIT)
      throw new Error("ViewState exceeds " + HASH_LIMIT + " characters; store the snapshot locally and keep the URL as a selection.");
    return {
      hash,
      state,
      encodings,
      reference: reference ? reference.ref : null,
      persisted: reference ? reference.persisted : null,
      membership: relationPlan ? relationPlan.membership : null,
    };
  }

  /* --------------------------------------------------------------------- read */

  /**
   * Normalise and validate a hash before any of it reaches application state. Unknown,
   * partial or legacy parameter combinations degrade to a usable view plus explicit issues;
   * this function never throws.
   */
  function read(hash) {
    const issues = [];
    let params;
    try {
      params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
    } catch {
      params = new URLSearchParams();
      issues.push({ reason: "unreadable-hash", stale: true });
    }
    const bundleRef = params.get("viewRef");
    if (bundleRef) {
      const restored = resolveBundle(bundleRef);
      if (restored) return decorate(fromBundle(restored), params, issues, { token: null });
      issues.push({ role: "view", reason: "missing-reference", token: bundleRef, stale: true });
    }

    function members(role) {
      const token = params.get(role + "Ref");
      if (token) {
        if (token.startsWith("q1")) {
          const recipe = decodeRecipe(token);
          if (!recipe) {
            issues.push({ role, reason: "unreadable-reference", token, stale: true });
            return { ids: [], token, encoding: "recipe", stale: true };
          }
          const ids = recipeMembers(recipe);
          if (!ids.length || digest(ids) !== recipe.membership) {
            issues.push({
              role,
              reason: ids.length ? "membership-changed" : "missing-members",
              token,
              stale: true,
            });
            return { ids: [], token, encoding: "recipe", stale: true };
          }
          return { ids, token, encoding: "recipe", stale: false };
        }
        const record = resolveContext(token);
        if (!record) {
          issues.push({ role, reason: "missing-reference", token, stale: true });
          return { ids: [], token, encoding: "ref", stale: true };
        }
        return {
          ids: [...(record[MEMBER_FIELDS[role]] || [])],
          token,
          encoding: "ref",
          stale: false,
          snapshotId: record.snapshotId || null,
        };
      }
      const raw = params.get(role);
      if (raw == null) return { ids: [], token: null, encoding: "empty", stale: false };
      // Legacy over-long lists are read in full and migrated on the next write, never truncated.
      return { ids: list(raw), token: null, encoding: "ids", stale: false };
    }

    const relation = members("relation");
    const relationParent = members("relationParent");
    const relationTrace = members("relationTrace");
    const contextOrigins = members("contextOrigins");
    const open = members("open");
    const relDigest = params.get("relDigest");
    if (relDigest && relation.ids.length && digest(relation.ids) !== relDigest) {
      relation.stale = true;
      issues.push({ role: "relation", reason: "membership-changed", token: relDigest, stale: true });
    }

    const reach = oneOf(params.get("reach"), REACHES);
    const contextReach = oneOf(params.get("contextReach"), REACHES);
    const view = {
      v: count(params.get("v"), 1),
      legacy: count(params.get("v"), 1) < VERSION,
      snapshotId: text(params.get("snapshotId") || params.get("revision")),
      scope: text(params.get("scope")),
      focus: text(params.get("focus")),
      mode: oneOf(params.get("mode"), MODES, params.get("flow") ? "flow" : "hierarchy"),
      // The raw value matters: an absent mode is not the same input as an explicit one.
      modeParam: oneOf(params.get("mode"), MODES),
      lens: oneOf(params.get("lens"), LENSES, "scope"),
      tab: oneOf(params.get("tab"), TABS, "overview"),
      type: text(params.get("type")) || "all",
      flow: text(params.get("flow")),
      step: Math.max(0, count(params.get("step"), 0)),
      present: params.get("present") === "1",
      level: text(params.get("level")) || "auto",
      dimming: params.get("dim") !== "off",
      categories: params.get("categories") !== "off",
      bundle: params.get("bundle") !== "off",
      candidates: params.get("candidates") === "show" ? true : params.get("candidates") === "hide" ? false : null,
      edge: text(params.get("edge")),
      relationGroup: text(params.get("group")),
      relationView: text(params.get("relationView")),
      reach,
      origin: text(params.get("origin")),
      contextReach,
      from: text(params.get("from")),
      to: text(params.get("to")),
      route: params.get("route") === "1",
      via: list(params.get("via")),
      pathDir: oneOf(params.get("pathDir"), DIRECTIONS, "downstream"),
      pathTypes: params.get("pathTypes") === "*" ? null : list(params.get("pathTypes")),
      pathHops: params.has("pathHops") ? count(params.get("pathHops"), 24) : 24,
      pathChoice: text(params.get("pathChoice")),
      hasPathTypes: params.has("pathTypes"),
      relation,
      relationParent,
      relationTrace,
      contextOrigins,
      open,
    };
    return decorate(view, params, issues, relation);
  }

  /**
   * A view restored from a registry bundle must reach callers in the same shape a hash does,
   * so nothing downstream has to know which encoding carried it.
   */
  function fromBundle(state) {
    const held = ids => ({ ids: list(ids), token: null, encoding: ids && list(ids).length ? "bundle" : "empty", stale: false });
    return {
      v: VERSION,
      legacy: false,
      snapshotId: state.snapshotId,
      scope: state.scope,
      focus: state.focus,
      mode: state.mode,
      modeParam: state.mode,
      lens: state.lens,
      tab: state.tab,
      type: state.type,
      flow: state.flow,
      step: state.step,
      present: state.present,
      level: state.level,
      dimming: state.dimming,
      categories: state.categories,
      bundle: state.bundle,
      candidates: typeof state.candidates === "boolean" ? state.candidates : null,
      edge: state.edge,
      relationGroup: state.relationGroup,
      relationView: state.trace?.kind === "relation" ? "detail" : null,
      reach: state.trace?.direction && !state.trace.origins && state.trace.kind !== "path" ? state.trace.direction : null,
      origin: state.trace?.origin || null,
      contextReach: state.trace?.origins ? state.trace.direction : null,
      from: state.trace?.start || null,
      to: state.trace?.end || null,
      route: state.trace?.kind === "path",
      via: state.trace?.plan ? state.trace.plan.stops.slice(1, -1) : [],
      pathDir: state.trace?.plan?.direction || "downstream",
      pathTypes: state.trace?.plan ? state.trace.plan.types : [],
      pathHops: state.trace?.plan?.maxHops ?? 24,
      pathChoice: state.trace?.choice || null,
      hasPathTypes: Boolean(state.trace?.plan),
      relation: held(state.relation?.edgeIds),
      relationParent: held(state.relation?.parentEdgeIds),
      relationTrace: held(state.trace?.kind === "relation" ? state.trace.edges : null),
      contextOrigins: held(state.trace?.origins),
      open: held(state.open),
    };
  }

  function decorate(view, params, issues, relation) {
    view.issues = issues;
    view.stale = issues.some(issue => issue.stale);
    view.size = params.toString().length + 1;
    view.overBudget = view.size > HASH_LIMIT;
    view.relationRef = relation?.token || null;
    view.localOnly = Boolean(relation?.token);
    view.empty = params.size === 0;
    return view;
  }

  /* --------------------------------------------------------- compatible façade */

  /** Portable snapshot of a view with complete membership; needs no local storage to reopen. */
  function exportBundle(view) {
    const state = normalizeView(view);
    return {
      format: "skylense-view",
      v: VERSION,
      snapshotId: state.snapshotId,
      membership: state.relation ? digest(state.relation.edgeIds) : null,
      view: state,
    };
  }

  /** Link serializer for saved and shared views: refuses to hide a graph behind a reference. */
  function compact(input = {}) {
    const relation = input.edgeIds || input.relation || input.edge
      ? {
          edgeIds: input.edgeIds || list(input.relation) || [],
          parentEdgeIds: input.parentEdgeIds || list(input.relationParent),
        }
      : null;
    if (relation && !relation.edgeIds.length && input.edge) relation.edgeIds = [String(input.edge)];
    const result = serialize(
      {
        snapshotId: input.snapshotId,
        scope: input.scope || "system",
        focus: input.focus,
        mode: input.mode,
        tab: input.tab,
        flow: input.flow,
        open: input.open,
        edge: input.edge,
        relation,
        relationGroup: input.relationGroup,
      },
      { recipes: false, overflow: "throw" },
    );
    const single = relation && relation.edgeIds.length === 1 ? relation.edgeIds[0] : null;
    const relationRef = new URLSearchParams(result.hash).get("relationRef");
    return {
      hash: result.hash,
      localOnly: Boolean(relationRef),
      state: {
        v: VERSION,
        snapshotId: result.state.snapshotId,
        scope: result.state.scope || "system",
        focus: result.state.focus,
        mode: result.state.mode,
        tab: result.state.tab,
        flow: result.state.flow,
        edge: single || result.state.edge,
        relationRef,
        open: result.state.open,
        localOnly: Boolean(relationRef),
        membership: result.membership,
      },
    };
  }

  /** Flat parameter view, kept for callers that only need identity fields. */
  function parse(hash) {
    const view = read(hash);
    return {
      v: view.v,
      snapshotId: view.snapshotId,
      scope: view.scope || "system",
      focus: view.focus,
      mode: view.mode,
      tab: view.tab,
      flow: view.flow,
      edge: view.edge,
      relationRef: view.relationRef,
      relation: view.relation.ids.join(",") || null,
      relationParent: view.relationParent.ids.join(",") || null,
      relDigest: new URLSearchParams(String(hash || "").replace(/^#/, "")).get("relDigest"),
      open: view.open.ids,
      legacy: view.legacy,
      localOnly: view.localOnly,
      issues: view.issues,
    };
  }

  function migrateV1(hash, snapshotId) {
    const view = parse(hash);
    return compact({ ...view, snapshotId: snapshotId || view.snapshotId, edgeIds: view.relation ? list(view.relation) : null }).state;
  }

  /** Selection decoder used by callers that already hold the model's known edge IDs. */
  function decodeRelation(params, knownIds) {
    const search = params instanceof URLSearchParams
      ? params
      : new URLSearchParams(String(params || "").replace(/^#/, ""));
    const view = read("#" + search.toString());
    const allowed = knownIds instanceof Set ? knownIds : new Set(knownIds || []);
    const keep = ids => ids.filter(id => !allowed.size || allowed.has(id));
    const edgeIds = keep(view.relation.ids);
    const parentEdgeIds = keep(view.relationParent.ids);
    return {
      edgeIds,
      parentEdgeIds: parentEdgeIds.length ? parentEdgeIds : null,
      stale: view.relation.stale || (allowed.size > 0 && edgeIds.length !== view.relation.ids.length),
      localOnly: view.localOnly,
      relationRef: view.relationRef,
      issues: view.issues,
    };
  }

  root.SkylenseViewState = Object.freeze({
    MODES, TABS, MEMBER_ROLES, RELATION_THRESHOLD, INLINE_LIMIT, HASH_LIMIT, VERSION,
    digest, useFacts,
    normalizeView, serialize, read, exportBundle,
    compact, parse, migrateV1, decodeRelation,
  });
})(typeof window !== "undefined" ? window : globalThis);
