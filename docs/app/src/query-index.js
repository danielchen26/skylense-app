/* Snapshot-bound query index. Pagination never silently drops facts. */
(function (root) {
  "use strict";

  /* `claims` is the one queryable collection the claim overlay rewrites inside a
     single source snapshot: SkylenseClaimValidation.apply writes analysis.claims
     and nothing else queryable, so evidence, relations and the source-derived
     collections stay bound to the snapshot alone. A claims cursor also binds the
     overlay revision, or paging across an applied patch would mix two overlays. */
  const OVERLAY_KINDS = Object.freeze(["claims"]);
  const STATIC_REVISION = "s";
  function revisionTag(analysis, kind) {
    if (!OVERLAY_KINDS.includes(kind)) return STATIC_REVISION;
    const validation = root.SkylenseClaimValidation;
    // The overlay revision is the claim-overlay digest, the same value the patch
    // guard uses. Without that module the overlay cannot be identified, and the
    // cursor says so instead of pretending it is checked.
    return validation && validation.overlayRevision ? `o${validation.overlayRevision(analysis || {})}` : "o-unidentified";
  }
  function encodeCursor(snapshotId, kind, offset, revision = STATIC_REVISION) {
    return BufferFrom(`${snapshotId}|${kind}|${offset}|${revision}`).toString("base64url");
  }
  function decodeCursor(cursor, snapshotId, kind, revision = STATIC_REVISION) {
    if (!cursor) return 0;
    let raw;
    try { raw = BufferFrom(cursor, "base64url").toString(); }
    catch { throw new Error("Malformed cursor."); }
    const parts = raw.split("|");
    if (parts.length !== 4) throw new Error("Malformed cursor.");
    const [snap, type, offset, rev] = parts;
    if (snap !== snapshotId) throw new Error("Cursor snapshot does not match the active snapshot.");
    if (type !== kind) throw new Error("Cursor kind does not match the requested collection.");
    if (rev !== revision) throw new Error("Cursor was issued against an earlier claim overlay of this collection; restart paging to read one consistent overlay.");
    const value = Number(offset);
    if (!Number.isInteger(value) || value < 0) throw new Error("Invalid cursor offset.");
    return value;
  }
  function BufferFrom(value, encoding) {
    if (typeof Buffer !== "undefined") return encoding ? Buffer.from(value, encoding) : Buffer.from(value);
    if (encoding === "base64url") {
      const padded = value.replace(/-/g, "+").replace(/_/g, "/");
      const binary = atob(padded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return {
        toString() { return new TextDecoder().decode(bytes); },
      };
    }
    const bytes = new TextEncoder().encode(value);
    return {
      toString(kind) {
        if (kind !== "base64url") return new TextDecoder().decode(bytes);
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
      },
    };
  }

  function build(model) {
    const analysis = model.analysis || {};
    const snapshotId = analysis.snapshotId || model.meta?.id || "unknown";
    const nodes = model.nodes || [];
    const edges = model.edges || [];
    const adjacency = new Map();
    const reverse = new Map();
    function add(map, key, value) {
      const list = map.get(key) || [];
      list.push(value);
      map.set(key, list);
    }
    for (const edge of edges) {
      add(adjacency, edge.source, edge);
      add(reverse, edge.target, edge);
    }
    const ancestors = new Map();
    const byId = new Map((model.hierarchy || []).map(item => [item.id, item]));
    for (const node of nodes) byId.set(node.id, node);
    function walk(id, seen = []) {
      if (ancestors.has(id)) return ancestors.get(id);
      const item = byId.get(id);
      const parent = item?.parentId;
      const chain = parent && !seen.includes(parent) ? [...walk(parent, seen.concat(id)), parent] : [];
      ancestors.set(id, chain);
      return chain;
    }
    for (const item of [...nodes, ...(model.hierarchy || [])]) walk(item.id);
    function page(kind, cursor, limit = 50) {
      const size = Math.max(1, Math.min(Number(limit) || 50, 200));
      const collections = {
        nodes,
        edges,
        hierarchy: model.hierarchy || [],
        claims: analysis.claims || [],
        evidence: analysis.evidence || [],
        relations: analysis.relations || [],
        files: analysis.snapshot?.files || [],
      };
      if (!Object.hasOwn(collections, kind)) throw new Error("Unknown query collection.");
      const items = collections[kind];
      const revision = revisionTag(analysis, kind);
      const offset = decodeCursor(cursor, snapshotId, kind, revision);
      const slice = items.slice(offset, offset + size);
      const next = offset + slice.length < items.length ? encodeCursor(snapshotId, kind, offset + slice.length, revision) : null;
      return {
        snapshotId,
        kind,
        collectionRevision: revision,
        total: items.length,
        offset,
        returned: slice.length,
        complete: next == null,
        nextCursor: next,
        items: slice,
        note: "This page is a view of the complete snapshot collection; omitted items remain stored.",
      };
    }
    return {
      snapshotId,
      adjacency: Object.freeze(adjacency),
      reverse: Object.freeze(reverse),
      ancestors: Object.freeze(ancestors),
      page,
      neighbors(id, direction = "downstream") {
        const down = adjacency.get(id) || [];
        const up = reverse.get(id) || [];
        if (direction === "upstream") return up;
        if (direction === "both") return down.concat(up);
        return down;
      },
    };
  }

  root.SkylenseQueryIndex = Object.freeze({ build, encodeCursor, decodeCursor });
})(typeof window !== "undefined" ? window : globalThis);
