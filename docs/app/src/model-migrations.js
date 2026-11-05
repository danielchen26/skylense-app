/* Migrate v1 graph models into Analysis IR v2 without upgrading evidence. */
(function (root) {
  "use strict";

  const KIND_MAP = Object.freeze({
    imports: "imports",
    calls: "calls",
    "call-candidate": "calls",
    inherits: "inherits",
    implements: "implements",
    constructs: "constructs",
    loads: "loads",
    links: "links",
    read: "reads",
    reads: "reads",
    write: "writes",
    writes: "writes",
    data: "references",
    depends: "references",
    types: "references",
    references: "references",
    documents: "documents",
    contains: "contains",
    flow: "references",
    configures: "configures",
    publishes: "publishes",
    subscribes: "subscribes",
    generates: "generates",
  });

  function ir() { return root.SkylenseAnalysisIR; }
  function hash(value) { return ir().sha256Text(value); }

  function mapResolution(edge) {
    const status = edge.evidenceStatus || edge.resolution?.kind || "";
    if (status === "static-resolved" || edge.resolution?.kind === "source") {
      const rule = edge.resolution?.engine || edge.resolution?.kind;
      const context = edge.resolution?.projectContextHash;
      if (rule && context) return { resolution: "resolved-static", reasonCode: null, upgrade: true };
      return { resolution: "legacy-unknown", reasonCode: "insufficient-producer-context", upgrade: false };
    }
    // A conditional candidate has a proven target file and an unevaluated build
    // condition. It is a candidate, and its reason code says which one it is.
    if (status === "conditional-candidate" || edge.resolution?.kind === "conditional-candidate")
      return { resolution: "candidate", reasonCode: "conditional-candidate", upgrade: false };
    if (status === "dispatch-candidate" || edge.type === "call-candidate" || status === "lexical-candidate")
      // A binder's candidate names why it is one (for example c-external-linkage).
      return { resolution: "candidate", reasonCode: edge.resolution?.reasonCode || status || "lexical-candidate", upgrade: false };
    if (status === "unfetched-reference") return { resolution: "external-unfetched", reasonCode: "unfetched-reference", upgrade: false };
    if (status === "source-text" || status === "syntax-tree") return { resolution: "source-declared", reasonCode: null, upgrade: false };
    return { resolution: "legacy-unknown", reasonCode: status || "unmapped-v1-resolution", upgrade: false };
  }

  /* A v1 `description` is an authored claim about the edge. Several of them read
     like "a static semantic binding resolves this call site to a unique included
     source declaration", which is only true when the mapped resolution is
     resolved-static. Copying it onto a relation the mapper downgraded would let
     prose assert a binding the IR does not grant, so the sentence is derived from
     the mapped resolution and the original claim is retained under `legacy`. */
  const RESOLUTION_SENTENCE = Object.freeze({
    "resolved-static": "A static binding resolves this reference to a unique included source declaration.",
    "source-declared": "The reference is declared in the source text; no binding was resolved.",
    candidate: "A candidate reference: the target is one possibility, not a proven binding.",
    "external-unfetched": "The reference names a target outside the fetched source; it was not resolved.",
    "legacy-unknown": "The reference was carried over without producer context, so no resolution is claimed.",
  });
  /** The v1 edge's resolution, with a binding proof replaced by a reference to the edge
   *  that holds it (`edges[].id` equals the relation id), so the proof is stored once. */
  function legacyProvenance(edge) {
    const resolution = edge.resolution;
    if (!resolution || typeof resolution !== "object" || !resolution.proof) return resolution || null;
    const { proof, ...rest } = resolution;
    return { ...rest, proofRef: { edgeId: edge.id, steps: Array.isArray(proof.steps) ? proof.steps.length : 0 } };
  }
  function directionSentence(mappedKind, edge, mapped) {
    const authored = typeof edge.description === "string" ? edge.description.trim() : "";
    if (mapped.resolution === "resolved-static" && authored) return authored;
    const base = `${mappedKind} from ${edge.source} to ${edge.target}`;
    const claim = RESOLUTION_SENTENCE[mapped.resolution] || "No resolution is claimed for this reference.";
    return mapped.reasonCode ? `${base}. ${claim} (${mapped.reasonCode})` : `${base}. ${claim}`;
  }

  /* "generated" means a collector wrote the labels and summaries in this
     model; "authored" means a person did. A collector always leaves its own
     ingestion report behind, so the absence of one is the honest signal for a
     hand-curated bundle. Neither value says the content was ever reviewed. */
  function contentProvenanceOf(model) {
    const declared = model.meta?.contentProvenance;
    if (declared === "generated" || declared === "authored") return declared;
    return model.meta?.ingestion ? "generated" : "authored";
  }

  /* The bytes and decoded text the acquisition step actually held, keyed by
     path. Without an entry for a file nothing about it can be verified, and
     every record naming it has to stay unverified. */
  function createSourceStore(sources) {
    const files = new Map();
    const entries = sources instanceof Map ? sources.entries() : Object.entries(sources || {});
    for (const [path, value] of entries) {
      const descriptor = typeof value === "string" ? { text: value } : (value || {});
      const text = typeof descriptor.text === "string" ? descriptor.text : null;
      const decodeStatus = descriptor.decodeStatus || (text === null ? "unavailable" : "exact");
      files.set(path, {
        text,
        decodeStatus,
        rawHash: descriptor.rawHash || null,
        byteLength: Number.isInteger(descriptor.byteLength) ? descriptor.byteLength : null,
        encoding: descriptor.encoding || (text === null ? null : "utf-8"),
        status: descriptor.status || (text === null ? "unreadable" : "included"),
        reasonCode: descriptor.reasonCode || null,
        decodedTextHash: decodeStatus === "exact" && text !== null ? hash(text) : null,
        index: null,
      });
    }
    return {
      get: path => files.get(path) || null,
      size: files.size,
      lineIndex(path) {
        const file = files.get(path);
        if (!file || file.text === null) return null;
        if (!file.index) file.index = ir().createLineIndex(file.text);
        return file.index;
      },
    };
  }

  const MAX_SPAN_UTF16 = 2048;
  function clampSpan(text, startUtf16, endUtf16) {
    let end = Math.min(endUtf16, startUtf16 + MAX_SPAN_UTF16);
    const code = end > startUtf16 ? text.charCodeAt(end - 1) : 0;
    if (code >= 0xd800 && code <= 0xdbff) end--;
    return end;
  }

  /* A v1 evidence entry names a file and a line range. When the acquisition
     step held that file, the range is resolved into a real UTF-16 span and the
     excerpt is extracted from the stored text; the declared excerpt is only an
     input to check. Otherwise the fragment stays an unverified declaration. */
  function evidenceFromLegacy(snapshotId, item, index, store, diagnostics) {
    const first = Array.isArray(item.evidence) && item.evidence[0];
    if (!first || typeof first.excerpt !== "string" || typeof first.file !== "string") return null;
    const id = `ev_legacy_${item.id}_${index}`;
    const declared = { startLine: first.lineStart || null, endLine: first.lineEnd || first.lineStart || null };
    const source = store.get(first.file);
    const lines = source && source.decodeStatus === "exact" ? store.lineIndex(first.file) : null;
    if (lines) {
      const startLine = Math.min(Math.max(1, declared.startLine || 1), lines.count);
      const endLine = Math.min(Math.max(startLine, declared.endLine || startLine), lines.count);
      const startUtf16 = lines.startOf(startLine);
      const endUtf16 = clampSpan(source.text, startUtf16, endLine < lines.count ? lines.startOf(endLine + 1) - 1 : source.text.length);
      const slice = source.text.slice(startUtf16, Math.max(startUtf16, endUtf16));
      if (!first.excerpt || slice.startsWith(first.excerpt) || first.excerpt.startsWith(slice)) {
        return ir().fromSpan({
          id, snapshotId, fileId: first.file,
          decodedText: source.text,
          rawHash: source.rawHash,
          range: { startUtf16, endUtf16: Math.max(startUtf16, endUtf16) },
          producer: { adapter: "v1-import", version: "1", mode: "declared-line-range" },
        });
      }
      diagnostics?.push({ code: "legacy-excerpt-contradicts-source", edgeId: item.id, file: first.file, declaredLine: declared.startLine });
    }
    return ir().fromLegacy({
      id, snapshotId, fileId: first.file,
      excerpt: first.excerpt,
      declaredRange: declared,
      decodeStatus: "lossy",
      producer: { adapter: "v1-import", version: "1", mode: "legacy-excerpt" },
      reasonCode: lines ? "legacy-excerpt-contradicts-source" : "legacy-excerpt-without-full-file-text",
    });
  }

  const cache = new WeakMap();

  function migrateModel(model, options = {}) {
    if (!model || typeof model !== "object") throw new Error("migrateModel requires a graph model.");
    if (model.analysis && model.analysis.schemaVersion === ir().SCHEMA_VERSION && !options.force)
      return model.analysis;
    if (!options.force && cache.has(model)) return cache.get(model);
    const store = createSourceStore(options.sources);
    const snapshotId = options.snapshotId || model.meta?.revision || model.meta?.id || `snap_${hash(model.meta?.title || "model").slice(0, 12)}`;
    const originKind = /^https:\/\/github.com\//i.test(model.meta?.repository || "") ? "github"
      : model.meta?.ingestion ? "folder" : "files";
    const files = [];
    const seen = new Set();
    for (const node of model.nodes || []) {
      const path = node.path;
      if (!path || seen.has(path)) continue;
      seen.add(path);
      const source = store.get(path);
      files.push(ir().fileRecord({
        id: `file_${hash(path).slice(0, 16)}`,
        path,
        status: source?.status || (node.evidenceStatus === "metadata-only" ? "unsupported-format" : "included"),
        language: node.language || null,
        // Without the stored text this record cannot promise a reproducible
        // decoding, whatever the v1 node asserted about its evidence.
        decodeStatus: source ? source.decodeStatus : "unavailable",
        decodedTextHash: source?.decodedTextHash || null,
        rawHash: source?.rawHash || null,
        byteLength: source?.byteLength ?? null,
        reasonCode: source?.reasonCode || (source ? null : "full-text-not-retained"),
        encoding: source ? source.encoding : null,
      }));
    }
    const snap = ir().snapshot({
      id: snapshotId,
      origin: { kind: originKind, label: model.meta?.title || model.meta?.sourceFolder || "model" },
      revision: { kind: /^[a-f0-9]{40}$/i.test(model.meta?.revision || "") ? "commit" : "content-manifest", value: String(model.meta?.revision || snapshotId) },
      consistency: model.meta?.ingestion?.truncated ? "partial" : "stable",
      policyHash: "skylense-v1-import",
      files,
    });
    const evidence = [];
    const relations = [];
    const groups = [];
    const claims = [];
    const diagnostics = [];
    const nodes = new Map((model.nodes || []).map(node => [node.id, node]));

    for (const container of model.hierarchy || []) {
      if (!container.parentId) continue;
      const childIsNode = nodes.has(container.id);
      const parentIsNode = nodes.has(container.parentId);
      if (childIsNode && parentIsNode) {
        relations.push(ir().binaryRelation({
          id: `rel_contains_${container.parentId}_${container.id}`,
          snapshotId, kind: "contains", sourceId: container.parentId, targetId: container.id,
          resolution: "source-declared",
          directionMeaning: "structural containment; not a dependency or call",
          evidenceIds: [],
          producer: { adapter: "v1-hierarchy", version: "1", rule: "parentId", projectContextHash: hash("hierarchy") },
        }));
      }
    }

    const candidateBuckets = new Map();
    for (const [index, edge] of (model.edges || []).entries()) {
      const mapped = KIND_MAP[edge.type];
      const mappedKind = mapped || "references";
      const resolution = mapResolution(edge);
      const ev = evidenceFromLegacy(snapshotId, edge, index, store, diagnostics);
      if (ev) evidence.push(ev);
      if (!mapped) diagnostics.push({ code: "unmapped-edge-type", edgeId: edge.id, type: edge.type });
      const relation = ir().binaryRelation({
        id: edge.id,
        snapshotId,
        kind: mappedKind,
        sourceId: edge.source,
        targetId: edge.target,
        resolution: resolution.resolution,
        directionMeaning: directionSentence(mappedKind, edge, resolution),
        evidenceIds: ev ? [ev.id] : [],
        callSiteId: edge.callsiteId || edge.callSiteId || null,
        reasonCode: resolution.reasonCode,
        producer: {
          adapter: edge.resolution?.engine || "v1-graph",
          version: "1",
          rule: resolution.upgrade ? (edge.resolution?.engine || "static") : "legacy",
          projectContextHash: resolution.upgrade ? (edge.resolution.projectContextHash || hash(edge.resolution.engine || "legacy")) : hash("legacy"),
        },
        // The authored v1 claim is kept, clearly marked as the source model's own
        // statement rather than as this relation's resolved meaning.
        // A static binding's proof lives once, on the v1 edge this relation shares its id
        // with; the provenance names it rather than carrying a second copy.
        legacy: { kind: edge.type, resolution: edge.evidenceStatus || edge.resolution, provenance: legacyProvenance(edge), description: typeof edge.description === 'string' ? edge.description : null },
      });
      relations.push(relation);
      if (resolution.resolution === "candidate" && (edge.callsiteId || edge.callSiteId)) {
        const key = edge.callsiteId || edge.callSiteId;
        if (!candidateBuckets.has(key)) candidateBuckets.set(key, []);
        candidateBuckets.get(key).push(relation);
      }
    }

    for (const [callSiteId, members] of candidateBuckets) {
      const caller = members[0].sourceId;
      const participants = [
        { id: `${callSiteId}:caller`, nodeId: caller, role: "caller", direction: "output" },
        ...members.map((rel, i) => ({ id: `${callSiteId}:cand${i}`, nodeId: rel.targetId, role: "candidate", direction: "input" })),
      ];
      groups.push(ir().relationGroup({
        id: `grp_${callSiteId}`,
        snapshotId,
        semantics: "candidate-targets",
        participants,
        memberRelationIds: members.map(rel => rel.id),
        explicitPairs: [],
        candidateCompleteness: "unknown",
        callSiteId,
        evidenceIds: [...new Set(members.flatMap(rel => rel.evidenceIds))],
        producer: { adapter: "v1-candidates", version: "1", rule: "callsite-bucket", projectContextHash: hash(callSiteId) },
      }));
    }

    const report = model.meta?.ingestion || {};
    const coverage = ir().coverageLedger({
      snapshotId,
      discovery: { discovered: (report.scanned || files.length) + (report.excluded || 0), included: report.acceptedFiles || files.length, excluded: report.excluded || 0 },
      read: { discovered: report.acceptedFiles || files.length, included: report.analyzedFiles || files.length, unreadable: (report.skipped || []).filter(item => item.reason === "unreadable").length },
      syntax: { complete: report.symbols || 0, unresolved: (report.syntax?.errors || []).length },
      relations: { complete: relations.filter(rel => rel.resolution === "resolved-static" || rel.resolution === "source-declared").length, unresolved: report.unresolved?.length || 0 },
      interpretation: { pending: (model.nodes || []).length, complete: 0 },
      accountingComplete: true,
      notes: report.truncated ? ["Snapshot is partial because ingestion reported truncation."] : [],
    });

    // Who wrote the prose in this model. An automatic collector says so in its
    // own metadata; a hand-curated bundle carries no ingestion report. This is
    // producer provenance, not a statement that anyone verified the content.
    const contentProvenance = contentProvenanceOf(model);
    const authored = contentProvenance === "authored";
    const analysis = {
      schemaVersion: ir().SCHEMA_VERSION,
      snapshotId,
      snapshot: snap,
      evidence,
      relations,
      groups,
      claims,
      coverage,
      readiness: {
        sourceMapReady: Boolean(model.nodes?.length && model.edges),
        deepMapReady: false,
        generalCapabilityAccepted: false,
      },
      diagnostics,
      migration: {
        from: "v1-graph",
        contentProvenance,
        authoredContentPreserved: authored,
        sourceVerified: store.size > 0 && evidence.every(item => item.verification === "source-verified"),
        unverifiedEvidence: evidence.filter(item => item.verification !== "source-verified").length,
        unmappedEdgeTypes: diagnostics.length,
      },
    };
    ir().validateIR(analysis);
    if (!Object.isFrozen(model) && options.attach !== false) ir().attach(model, analysis);
    cache.set(model, analysis);
    return analysis;
  }

  /* The one gate every model entry point goes through: fresh analysis, file
     import, export/reimport, workspace registration and the Worker. A present
     schemaVersion 2 is a format statement, never a reason to skip validation.
     Records that cannot be trusted are moved to analysis.quarantine, which is
     reported rather than silently dropped; the model keeps only facts whose
     references resolve inside its own snapshot. */
  function admitModel(model, options = {}) {
    if (!model || typeof model !== "object") throw Object.assign(new Error("A model must be an object."), { code: "INVALID_MODEL" });
    const analysis = model.analysis?.schemaVersion === ir().SCHEMA_VERSION
      ? model.analysis
      : migrateModel(model, options);
    const store = createSourceStore(options.sources);
    const snapshotId = analysis.snapshotId;
    const quarantine = [];
    const drop = (kind, record, reasonCode) => { quarantine.push({ kind, id: record?.id ?? null, reasonCode }); return false; };
    const nodeIds = new Set((model.nodes || []).map(node => node.id));
    for (const container of model.hierarchy || []) nodeIds.add(container.id);
    for (const group of model.groups || []) nodeIds.add(group.id);
    const fileKeys = new Set();
    for (const file of analysis.snapshot?.files || []) { fileKeys.add(file.path); fileKeys.add(file.id); }

    const evidenceIds = new Set();
    const evidence = (analysis.evidence || []).filter(item => {
      if (!item || typeof item !== "object" || !item.id) return drop("evidence", item, "malformed-record");
      if (evidenceIds.has(item.id)) return drop("evidence", item, "duplicate-id");
      if (item.snapshotId !== snapshotId) return drop("evidence", item, "foreign-snapshot");
      if (item.decodeStatus === "exact" && fileKeys.size && !fileKeys.has(item.fileId)) return drop("evidence", item, "file-outside-snapshot");
      const source = item.fileId ? store.get(item.fileId) : null;
      const verdict = ir().validateEvidence(item, {
        fullText: source && source.decodeStatus === "exact" ? source.text : null,
        knownFileIds: fileKeys.size ? fileKeys : null,
      });
      if (verdict.status === "invalid") return drop("evidence", item, verdict.reasonCode);
      evidenceIds.add(item.id);
      return true;
    });

    const relationIds = new Set();
    const relations = (analysis.relations || []).filter(item => {
      if (!item || typeof item !== "object" || !item.id) return drop("relation", item, "malformed-record");
      if (relationIds.has(item.id)) return drop("relation", item, "duplicate-id");
      if (item.snapshotId !== snapshotId) return drop("relation", item, "foreign-snapshot");
      try { ir().binaryRelation(item); } catch (cause) { return drop("relation", item, "illegal-relation"); }
      if (!nodeIds.has(item.sourceId) || (item.targetId !== null && !nodeIds.has(item.targetId))) return drop("relation", item, "dangling-endpoint");
      if (!(item.evidenceIds || []).every(id => evidenceIds.has(id))) return drop("relation", item, "unknown-evidence-reference");
      if (item.resolution === "resolved-static" && !(item.evidenceIds || []).length) return drop("relation", item, "resolved-static-without-evidence");
      relationIds.add(item.id);
      return true;
    });

    const groups = (analysis.groups || []).filter(item => {
      if (!item || item.snapshotId !== snapshotId) return drop("group", item, "foreign-snapshot");
      try { ir().relationGroup(item); } catch { return drop("group", item, "illegal-group"); }
      if (!(item.memberRelationIds || []).every(id => relationIds.has(id))) return drop("group", item, "unknown-member-relation");
      if (!(item.participants || []).every(participant => nodeIds.has(participant.nodeId))) return drop("group", item, "dangling-participant");
      /* A declaration whose required participants do not resolve, or that repeats a
         participant id, states a joint condition it cannot mean. The hypergraph
         module owns those rules; admission quarantines with its reason code rather
         than letting the group into a registered model. */
      const groupFindings = root.SkylenseHypergraph?.validateGroups?.({ ...analysis, groups: [item] }) || [];
      if (groupFindings.length) return drop("group", item, groupFindings[0].code || "illegal-group-declaration");
      return true;
    });

    const claimIds = new Set();
    const claims = [];
    for (const item of analysis.claims || []) {
      if (!item || typeof item !== "object" || !item.id) { drop("claim", item, "malformed-record"); continue; }
      if (claimIds.has(item.id)) { drop("claim", item, "duplicate-id"); continue; }
      if (item.snapshotId !== snapshotId) { drop("claim", item, "foreign-snapshot"); continue; }
      if (!(item.subjectIds || []).every(id => nodeIds.has(id))) { drop("claim", item, "unknown-subject"); continue; }
      if (!(item.evidenceIds || []).every(id => evidenceIds.has(id))
        || !(item.counterEvidenceIds || []).every(id => evidenceIds.has(id))) { drop("claim", item, "unknown-evidence-reference"); continue; }
      if (!(item.factIds || []).every(id => relationIds.has(id))) { drop("claim", item, "unknown-fact-reference"); continue; }
      let admitted = item;
      // Review state is granted by this workspace, never carried in by a file: a person
      // records it through `skylense review` or the workbench, and that store re-applies it.
      if (item.review === "checked" || item.review === "rejected") {
        admitted = ir().claim({ ...item, review: "proposed", reviewedBy: undefined });
        quarantine.push({ kind: "claim-review", id: item.id, reasonCode: "externally-declared-review-not-accepted" });
      }
      claimIds.add(admitted.id);
      claims.push(admitted);
    }

    analysis.evidence = evidence;
    analysis.relations = relations;
    analysis.groups = groups;
    analysis.claims = claims;
    analysis.enrichmentTasks = (analysis.enrichmentTasks || []).filter(task => !task.subjectId || nodeIds.has(task.subjectId));
    if (quarantine.length) {
      analysis.quarantine = quarantine;
      analysis.diagnostics = [...(analysis.diagnostics || []), { code: "quarantined-records", count: quarantine.length }];
    } else if (analysis.quarantine) delete analysis.quarantine;
    // Readiness is a projection of the current gates, never an imported flag.
    analysis.readiness = root.SkylenseClaims
      ? root.SkylenseClaims.readinessOf(model, analysis)
      : { sourceMapReady: Boolean(analysis.snapshot && (model.nodes || []).length && analysis.coverage), deepMapReady: false, generalCapabilityAccepted: false, pendingTasks: (analysis.enrichmentTasks || []).length };
    analysis.trust = {
      producedBy: options.origin || analysis.trust?.producedBy || "imported-model",
      // Internal consistency is all an admission without the bytes can check.
      checkedHere: store.size ? "source-text-and-internal-consistency" : "internal-consistency",
      basis: store.size ? "source-verified" : "imported-assertion",
      verifiedEvidence: evidence.filter(item => item.verification === "source-verified").length,
      derivedEvidence: evidence.filter(item => item.verification === "derived").length,
      unverifiedEvidence: evidence.filter(item => item.verification === "unverified").length,
      quarantined: quarantine.length,
    };
    ir().validateIR(analysis);
    if (!Object.isFrozen(model)) ir().attach(model, analysis);
    return analysis;
  }

  function identityKey(node) {
    const path = node.path || "";
    const span = node.sourceSpan ? `${node.sourceSpan.lineStart}:${node.sourceSpan.lineEnd}` : "";
    const name = node.qualifiedName || node.label || node.id;
    return `${path}\0${name}\0${span}\0${node.kind || ""}`;
  }

  root.SkylenseModelMigrations = Object.freeze({ KIND_MAP, migrateModel, admitModel, mapResolution, identityKey });
})(typeof window !== "undefined" ? window : globalThis);
