/* Jobs, hypergraph projection and incremental fingerprints. Views never mutate facts. */
(function (root) {
  "use strict";

  /* queued → running → validating → ready; any active state may reach
     cancelling/cancelled, failed or superseded. The four outcome states are
     terminal: a retry starts a new job, it never resurrects an old one. */
  const JOB_STATES = Object.freeze(["queued", "running", "validating", "ready", "cancelling", "cancelled", "failed", "superseded", "needs-context"]);
  const TERMINAL_STATES = Object.freeze(["ready", "cancelled", "failed", "superseded"]);
  const ACTIVE_STATES = Object.freeze(["queued", "running", "validating", "needs-context"]);
  const ALLOWED_NEXT = Object.freeze({
    queued: Object.freeze(["running", "validating", "cancelling", "cancelled", "failed", "superseded", "needs-context"]),
    running: Object.freeze(["validating", "ready", "cancelling", "cancelled", "failed", "superseded", "needs-context"]),
    validating: Object.freeze(["ready", "cancelling", "cancelled", "failed", "superseded", "needs-context"]),
    "needs-context": Object.freeze(["running", "validating", "cancelling", "cancelled", "failed", "superseded"]),
    cancelling: Object.freeze(["cancelled", "failed"]),
    ready: Object.freeze([]),
    cancelled: Object.freeze([]),
    failed: Object.freeze([]),
    superseded: Object.freeze([]),
  });
  const isTerminal = state => TERMINAL_STATES.includes(state);

  function createJob(input = {}) {
    const state = JOB_STATES.includes(input.state) ? input.state : "queued";
    return Object.freeze({
      id: input.id || `job_${Date.now()}`,
      kind: input.kind || "analyze",
      state,
      generation: Number(input.generation) || 1,
      sourceKey: input.sourceKey || "workspace",
      snapshotId: input.snapshotId || null,
      createdAt: input.createdAt || Date.now(),
      updatedAt: input.updatedAt || Date.now(),
      error: input.error || null,
      progress: Object.freeze({
        acquire: input.progress?.acquire || "pending",
        parse: input.progress?.parse || "pending",
        resolve: input.progress?.resolve || "pending",
        enrich: input.progress?.enrich || "pending",
      }),
    });
  }

  function transition(job, state, extra = {}) {
    if (!JOB_STATES.includes(state)) throw new Error("Unknown job state.");
    if (isTerminal(job.state))
      throw new Error(`A ${job.state} job is terminal and cannot become ${state}; retry creates a new job.`);
    if (!ALLOWED_NEXT[job.state].includes(state))
      throw new Error(`A ${job.state} job cannot become ${state}; that transition is not in the job state machine.`);
    return createJob({ ...job, ...extra, state, updatedAt: Date.now() });
  }

  function fingerprint(files, extra = {}) {
    const ir = root.SkylenseAnalysisIR;
    const rows = [...files].map(file => `${file.path}\0${file.rawHash || file.decodedTextHash || ""}`).sort();
    return ir.sha256Text(JSON.stringify({ files: rows, extra }));
  }

  /**
   * Incremental plan from a file diff. `importGraph` maps each path to the local
   * import targets resolved in the current run; a null entry records an import
   * that found no local provider (a negative lookup). Consumers of changed files
   * rebuild, and when providers may have appeared or disappeared every file that
   * still imports anything rebuilds, because a new provider can satisfy a
   * previously unresolved specifier and a removed one can break a bound one.
   */
  function incrementalPlan(previous, nextFiles, importGraph = {}) {
    const before = new Map((previous || []).map(file => [file.path, file]));
    const after = new Map(nextFiles.map(file => [file.path, file]));
    const added = [], removed = [], changed = [], unchanged = [];
    for (const [path, file] of after) {
      if (!before.has(path)) added.push(path);
      else if ((before.get(path).rawHash || before.get(path).decodedTextHash) !== (file.rawHash || file.decodedTextHash)) changed.push(path);
      else unchanged.push(path);
    }
    for (const path of before.keys()) if (!after.has(path)) removed.push(path);
    const safe = added.length === 0 && removed.length === 0 && changed.length === 0;
    const dirty = new Set([...added, ...changed]);
    const importers = new Map();
    for (const [from, targets] of Object.entries(importGraph)) {
      for (const to of targets || []) {
        if (!to || !after.has(to)) continue;
        if (!importers.has(to)) importers.set(to, new Set());
        importers.get(to).add(from);
      }
    }
    const queue = [...dirty];
    while (queue.length) {
      const path = queue.pop();
      for (const from of importers.get(path) || []) if (!dirty.has(from) && after.has(from)) { dirty.add(from); queue.push(from); }
    }
    if (added.length || removed.length) {
      for (const [from, targets] of Object.entries(importGraph)) {
        if (after.has(from) && (targets || []).length && !dirty.has(from)) dirty.add(from);
      }
    }
    for (const path of removed) dirty.delete(path);
    return {
      added, removed, changed, unchanged,
      reuseSyntax: unchanged,
      rebuildSemantics: [...dirty].sort(),
      equivalentToFullRebuild: safe,
      negativeLookupsRequired: added.length > 0 || removed.length > 0,
    };
  }

  function projectGroups(analysis) {
    const relations = new Map((analysis.relations || []).map(rel => [rel.id, rel]));
    return (analysis.groups || []).map(group => {
      const members = group.memberRelationIds.map(id => relations.get(id)).filter(Boolean);
      const missing = group.memberRelationIds.length - members.length;
      if (missing) throw new Error(`RelationGroup ${group.id} is missing member relations.`);
      const sources = [...new Set(members.map(rel => rel.sourceId))];
      const targets = [...new Set(members.map(rel => rel.targetId).filter(Boolean))];
      return {
        id: group.id,
        kind: "hyperedge-projection",
        semantics: group.semantics,
        sources, targets,
        edgeIds: group.memberRelationIds.slice(),
        activation: group.activation || null,
        candidateCompleteness: group.candidateCompleteness || null,
        viewOnly: true,
      };
    });
  }

  function invalidationClosure(plan, importGraph = {}) {
    const dirty = new Set([...(plan.added || []), ...(plan.changed || []), ...(plan.removed || [])]);
    const importers = new Map();
    for (const [from, targets] of Object.entries(importGraph)) {
      for (const to of targets) {
        if (!importers.has(to)) importers.set(to, []);
        importers.get(to).push(from);
      }
    }
    const queue = [...dirty];
    while (queue.length) {
      const path = queue.pop();
      for (const from of importers.get(path) || []) if (!dirty.has(from)) { dirty.add(from); queue.push(from); }
    }
    return { ...plan, rebuildSemantics: [...dirty], reuseSyntax: (plan.unchanged || []).filter(path => !dirty.has(path)) };
  }

  function canonicalEquivalent(a, b) {
    const ir = root.SkylenseAnalysisIR;
    return ir.canonicalize(a).digest === ir.canonicalize(b).digest;
  }

  /* Generations are isolated per source lane: starting a job for one source can
     never supersede or cancel another source's work, and a late job may only
     publish into its own lane. Activation of the shown slot is arbitrated by the
     workspace, not here. */
  function createJobController({ store } = {}) {
    const jobs = new Map();
    const lanes = new Map();
    let epoch = 0;
    const laneOf = key => {
      if (!lanes.has(key)) lanes.set(key, { startedGeneration: 0, publishedGeneration: 0, lastGood: null });
      return lanes.get(key);
    };
    const entryOf = id => {
      const entry = jobs.get(id);
      if (!entry) throw new Error("Unknown job.");
      return entry;
    };
    const refuseTerminal = (job, action) => {
      if (isTerminal(job.state))
        throw new Error(`A ${job.state} job is terminal and cannot ${action}; retry creates a new job.`);
    };
    // A store makes lanes, generations and terminal job history survive a
    // process restart. A job that was still mid-flight when the process died is
    // marked failed with the restart reason — it is never resurrected, because
    // a retry must create a new job (plan §9.1).
    const serialize = () => ({
      epoch,
      jobs: [...jobs.values()].map(entry => ({ ...entry.job })),
      lanes: [...lanes].map(([sourceKey, lane]) => ({ sourceKey, ...lane })),
    });
    const persist = () => { if (store?.save) { try { store.save(serialize()); } catch { /* a failed history write must not fail analysis */ } } };
    if (store?.load) {
      let restored = null;
      try { restored = store.load(); } catch { restored = null; }
      if (restored && typeof restored === "object") {
        epoch = Math.max(0, Number(restored.epoch) || 0);
        for (const lane of restored.lanes || []) {
          if (!lane || typeof lane.sourceKey !== "string") continue;
          lanes.set(lane.sourceKey, { startedGeneration: lane.startedGeneration || 0, publishedGeneration: lane.publishedGeneration || 0, lastGood: lane.lastGood ?? null });
        }
        for (const saved of restored.jobs || []) {
          if (!saved || typeof saved.id !== "string") continue;
          const job = isTerminal(saved.state)
            ? saved
            : { ...saved, state: "failed", error: "Process restarted before the job reached a terminal state.", finishedByRestart: true };
          jobs.set(job.id, { job, abort: null, sourceKey: job.sourceKey });
          epoch = Math.max(epoch, job.generation || 0);
        }
      }
    }
    return {
      start(kind = "analyze", options = {}) {
        epoch += 1;
        const sourceKey = String(options.sourceKey || "workspace");
        laneOf(sourceKey).startedGeneration = epoch;
        const abort = typeof AbortController === "function" ? new AbortController() : { abort() {}, signal: { aborted: false } };
        const job = createJob({ id: `job_${epoch}`, kind, generation: epoch, state: "running", sourceKey });
        jobs.set(job.id, { job, abort, sourceKey });
        persist();
        return { ...job, abort };
      },
      cancel(id) {
        const entry = entryOf(id);
        refuseTerminal(entry.job, "be cancelled");
        entry.abort.abort();
        if (entry.job.state !== "cancelling") entry.job = transition(entry.job, "cancelling");
        entry.job = transition(entry.job, "cancelled");
        persist();
        return entry.job;
      },
      fail(id, error) {
        const entry = entryOf(id);
        refuseTerminal(entry.job, "fail");
        entry.job = transition(entry.job, "failed", { error: String(error?.message || error) });
        persist();
        return entry.job;
      },
      /* Publishing checks four things before a snapshot becomes visible: the job
         is still active, it was not aborted, its generation is still the newest
         started in its own lane, and staging validation passed. */
      publish(id, snapshotId, options = {}) {
        const entry = entryOf(id);
        refuseTerminal(entry.job, "publish a snapshot");
        if (entry.abort.signal?.aborted) {
          if (entry.job.state !== "cancelling") entry.job = transition(entry.job, "cancelling");
          entry.job = transition(entry.job, "cancelled");
          throw new Error("An aborted job cannot publish a snapshot.");
        }
        const lane = laneOf(entry.sourceKey);
        if (entry.job.generation < lane.startedGeneration) {
          entry.job = transition(entry.job, "superseded");
          return entry.job;
        }
        entry.job = transition(entry.job, "validating");
        if (typeof options.validate === "function" && options.validate(snapshotId) === false) {
          entry.job = transition(entry.job, "failed", { error: "Staging validation rejected the snapshot." });
          return entry.job;
        }
        lane.publishedGeneration = entry.job.generation;
        lane.lastGood = { snapshotId, generation: entry.job.generation, jobId: entry.job.id, at: Date.now() };
        entry.job = transition(entry.job, "ready", { snapshotId });
        persist();
        return entry.job;
      },
      progress(id, stage, state) {
        const entry = entryOf(id);
        refuseTerminal(entry.job, "report progress");
        if (!Object.hasOwn(entry.job.progress, stage)) throw new Error("Unknown job stage.");
        entry.job = createJob({ ...entry.job, progress: { ...entry.job.progress, [stage]: state }, updatedAt: Date.now() });
        persist();
        return entry.job;
      },
      lastGood(sourceKey = "workspace") { return laneOf(String(sourceKey)).lastGood; },
      lanes() { return [...lanes].map(([sourceKey, lane]) => ({ sourceKey, ...lane })); },
      get(id) { return jobs.get(id)?.job || null; },
      signal(id) { return jobs.get(id)?.abort?.signal || null; },
      list() { return [...jobs.values()].map(entry => entry.job); },
    };
  }

  root.SkylenseAnalysisRuntime = Object.freeze({
    JOB_STATES, TERMINAL_STATES, ACTIVE_STATES, ALLOWED_NEXT,
    createJob, transition, fingerprint, incrementalPlan, invalidationClosure, projectGroups, canonicalEquivalent, createJobController,
  });
})(typeof window !== "undefined" ? window : globalThis);
