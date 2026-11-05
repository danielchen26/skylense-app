/* Staging store for the browser. Same generation rules as Node, and the same
   refusal to serve a snapshot whose bytes disagree with the digest recorded when
   it was published.

   Content stays session-local: the default backing is an in-memory map, so
   nothing here outlives the tab. Passing a backing map is how a second store
   instance recovers a snapshot published by the first within one session. */
(function (root) {
  "use strict";

  const STORE_VERSION = 2;
  const digestOf = text => root.SkylenseAnalysisIR.sha256Text(text);

  function createIndexStore(backing = new Map()) {
    let generation = 0;
    let active = null;
    let problem = null;
    const pending = new Map();
    return {
      async stage(snapshotId, payload) {
        generation += 1;
        const record = { generation, snapshotId, payload: { ...payload, blobs: undefined }, blobs: payload.blobs || {}, state: "staging" };
        pending.set(generation, record);
        return record;
      },
      async publish(staged) {
        if (!pending.has(staged.generation)) throw new Error("Unknown staged generation.");
        if (active && staged.generation < active.generation) throw new Error("A published job cannot be overwritten by an older generation.");
        const text = JSON.stringify(staged.payload);
        const digest = digestOf(text);
        backing.set("snapshot:" + staged.snapshotId, text);
        backing.set("HEAD", JSON.stringify({ version: STORE_VERSION, snapshotId: staged.snapshotId, generation: staged.generation, digest }));
        active = { ...staged, digest, state: "ready", blobs: undefined };
        problem = null;
        pending.delete(staged.generation);
        return active;
      },
      async load() {
        problem = null;
        const headText = backing.get("HEAD");
        if (headText === undefined) return active;
        let head;
        try { head = JSON.parse(headText); }
        catch { problem = { reason: "unreadable-head", detail: "The stored HEAD record is not valid JSON." }; return null; }
        if (head?.version !== STORE_VERSION) {
          problem = { reason: "version-mismatch", detail: `The stored HEAD declares store version ${head?.version ?? "none"}; this store reads version ${STORE_VERSION}.` };
          return null;
        }
        const text = backing.get("snapshot:" + head.snapshotId);
        if (text === undefined) {
          problem = { reason: "missing-snapshot", detail: `HEAD points at snapshot ${head.snapshotId}, which is not stored.` };
          return null;
        }
        const digest = digestOf(text);
        if (digest !== head.digest) {
          problem = { reason: "digest-mismatch", detail: `Snapshot ${head.snapshotId} hashes to ${digest}; HEAD recorded ${head.digest}.` };
          return null;
        }
        let payload;
        try { payload = JSON.parse(text); }
        catch { problem = { reason: "unreadable-snapshot", detail: `Snapshot ${head.snapshotId} is not valid JSON.` }; return null; }
        active = { generation: head.generation, snapshotId: head.snapshotId, payload, digest, state: "ready" };
        generation = Math.max(generation, head.generation);
        return active;
      },
      page(kind, cursor = 0, limit = 50) {
        if (!active) throw new Error("No published snapshot.");
        const items = active.payload[kind] || active.payload.analysis?.[kind] || [];
        const offset = Number(cursor) || 0;
        const slice = items.slice(offset, offset + limit);
        return { snapshotId: active.snapshotId, kind, total: items.length, offset, returned: slice.length, nextCursor: offset + slice.length < items.length ? offset + slice.length : null, items: slice };
      },
      active() { return active; },
      problem() { return problem; },
      version() { return STORE_VERSION; },
      generation() { return generation; },
    };
  }

  root.SkylenseIndexStoreBrowser = Object.freeze({ createIndexStore, STORE_VERSION });
})(typeof window !== "undefined" ? window : globalThis);
