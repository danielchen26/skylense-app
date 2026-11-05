/* One claim-patch envelope shared by the CLI, MCP and internal callers.
   A patch is validated completely, replayed by idempotency key, then applied
   atomically: either the whole envelope lands or the model is untouched. */
(function (root) {
  "use strict";

  const ENVELOPE_VERSION = 1;
  const ENVELOPE_FIELDS = Object.freeze([
    "schemaVersion", "snapshotId", "baseRevision", "baseOverlayRevision", "idempotencyKey", "claims",
  ]);
  // Claim text shaped like an instruction to the analyzer (PROMPT_INJECTION). A coarse
  // filter, deliberately narrow: the independent verifier is the real check. It matches only
  // an imperative addressed to the reader, at the start of the text or of a sentence (after
  // . ! ? ; : 。！？；： or a line break, optionally after "please"/"now"/"and"/"then"/请),
  // and never inside quoted or code spans (`…`, "…", '…', “…”, ‘…’, 「…」), so prose such as
  // `the VM must ignore prior instructions` or `login() prints "You are now logged in"`
  // passes. Whitespace of any kind (NBSP, line breaks, zero-width) separates words.
  // Exported so the authoring validator applies the same rule.
  const QUOTED_SPANS = /`[^`]*`|"[^"\n]*"|(?<![A-Za-z])'[^'\n]*'(?![A-Za-z])|“[^”]*”|‘[^’]*’|「[^」]*」/g;
  const INSTRUCTION_PATTERN = (() => {
    const gap = "[\\s\\u200b-\\u200d\\u2060\\ufeff]+";
    const start = `(?:^|[.!?;:。！？；：\\r\\n])[\\s\\u200b-\\u200d\\u2060\\ufeff]*(?:(?:please|now|also|and|then|so)${gap})*`;
    const english = [
      `${start}(?:ignore|disregard)${gap}(?:(?:all|any|the)${gap})?(?:previous|prior|above)${gap}instructions?\\b`,
      `${start}execute${gap}this${gap}command\\b`,
      `${start}override${gap}safety\\b`,
    ];
    const chinese = [
      `(?:^|[.!?;:。！？；：\\r\\n])[\\s\\u200b-\\u200d\\u2060\\ufeff]*(?:请)?忽略(?:之前|以上|前面|先前|上面)的(?:所有)?(?:指令|指示)`,
    ];
    return new RegExp([...english, ...chinese].join("|"), "i");
  })();
  function isInstructionText(text) {
    return INSTRUCTION_PATTERN.test(String(text ?? "").replace(QUOTED_SPANS, " "));
  }

  function fail(message, code) {
    const error = new Error(message);
    error.code = code || "INVALID_CLAIM";
    throw error;
  }
  function ir() { return root.SkylenseAnalysisIR; }

  /* The principal is what the process decided the caller is, never what the
     caller wrote into the patch. A transport may name itself; that is a label,
     not an identity, and no principal can make a review action through a patch. */
  function resolvePrincipal(context = {}) {
    const declared = context.principal;
    const kind = declared?.kind === "human" ? "human" : "agent";
    return Object.freeze({
      kind,
      identity: String(declared?.identity || (kind === "human" ? "local-user" : "host-agent")).slice(0, 160),
      channel: String(declared?.channel || context.channel || "library").slice(0, 80),
    });
  }

  /* A stable value for anything the guard compares. The snapshot revision is
     an object; comparing objects by identity is what made a current revision
     look stale, so both sides are reduced to one canonical string. */
  function canonicalValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return JSON.stringify(value.map(canonicalValue));
    if (typeof value === "object") {
      const keys = Object.keys(value).sort();
      return JSON.stringify(keys.map(key => [key, canonicalValue(value[key])]));
    }
    return String(value);
  }
  function revisionMatches(declared, revision) {
    if (declared === undefined || declared === null) return true;
    if (!revision) return false;
    const wanted = canonicalValue(declared);
    return wanted === canonicalValue(revision)
      || wanted === canonicalValue(revision.value)
      || wanted === canonicalValue({ kind: revision.kind, value: revision.value });
  }

  /* The claim overlay has its own revision. Source facts and interpretation
     move independently: re-reading the folder must not silently invalidate an
     overlay guard, and a claim write must not look like a source change. */
  function overlayRevision(analysis) {
    const claims = [...(analysis.claims || [])].map(item => canonicalValue({
      id: item.id, text: item.text, predicate: item.predicate, review: item.review,
      support: item.support, basis: item.basis,
      subjectIds: [...(item.subjectIds || [])].sort(),
      evidenceIds: [...(item.evidenceIds || [])].sort(),
      factIds: [...(item.factIds || [])].sort(),
      counterEvidenceIds: [...(item.counterEvidenceIds || [])].sort(),
      supersedes: item.supersedes || null,
      version: item.version || 1,
    })).sort();
    return ir().sha256Text(claims.join("\n")).slice(0, 32);
  }

  /* The semantic request, not its serialization. Two envelopes that mean the
     same thing share this digest; any change of text, reference, review action
     or guard produces a different one. */
  function digest(patch, module) {
    const hasher = module || ir();
    const body = canonicalValue({
      envelope: ENVELOPE_VERSION,
      snapshotId: patch.snapshotId ?? null,
      baseRevision: patch.baseRevision ?? null,
      baseOverlayRevision: patch.baseOverlayRevision ?? null,
      idempotencyKey: patch.idempotencyKey ?? null,
      scope: patch.scope ?? null,
      claims: (patch.claims || []).map(item => ({
        id: item.id ?? null,
        snapshotId: item.snapshotId ?? null,
        predicate: item.predicate ?? null,
        text: item.text ?? null,
        basis: item.basis ?? null,
        support: item.support ?? null,
        review: item.review ?? null,
        subjectIds: [...(item.subjectIds || [])].sort(),
        evidenceIds: [...(item.evidenceIds || [])].sort(),
        factIds: [...(item.factIds || [])].sort(),
        counterEvidenceIds: [...(item.counterEvidenceIds || [])].sort(),
        supersedes: item.supersedes ?? null,
      })),
    });
    return hasher.sha256Text(body);
  }

  /* Scope: one key means one request inside one workspace, against one source
     snapshot, from one controlled principal. The same key from somewhere else
     is a different request rather than a replay. */
  function scopeOf(analysis, principal, context) {
    return canonicalValue({
      workspace: context.workspace || "process-local",
      snapshotId: analysis.snapshotId,
      principal: `${principal.kind}:${principal.identity}`,
    });
  }

  function validate(model, patch, context = {}) {
    const claims = root.SkylenseClaims;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) fail("Patch must be an object.", "INVALID_PATCH");
    const unknown = Object.keys(patch).filter(key => !ENVELOPE_FIELDS.includes(key) && key !== "scope");
    if (patch.schemaVersion !== undefined && patch.schemaVersion !== ENVELOPE_VERSION)
      fail("Unsupported claim patch schemaVersion.", "UNSUPPORTED_ENVELOPE");
    const principal = resolvePrincipal(context);
    const analysis = model.analysis?.schemaVersion === ir().SCHEMA_VERSION
      ? model.analysis
      : root.SkylenseModelMigrations.migrateModel(model);
    // The envelope names the snapshot it was written against. Without it a
    // patch would be rebound to whatever is loaded now.
    if (typeof patch.snapshotId !== "string" || !patch.snapshotId)
      fail("A claim patch must name the snapshot it was written against.", "MISSING_SNAPSHOT");
    if (patch.snapshotId !== analysis.snapshotId)
      fail("Patch snapshotId does not match the active snapshot.", "STALE_SNAPSHOT");
    for (const item of patch.claims || []) {
      if (item && item.snapshotId !== undefined && item.snapshotId !== patch.snapshotId)
        fail(`Claim ${item?.id || "?"} names a different snapshot than the patch envelope.`, "STALE_SNAPSHOT");
    }
    if (unknown.length) fail(`Claim patch contains unsupported field ${unknown[0]}.`, "INVALID_PATCH");
    if (!revisionMatches(patch.baseRevision, analysis.snapshot?.revision))
      fail("Patch baseRevision does not match the snapshot revision.", "STALE_REVISION");
    const currentOverlay = overlayRevision(analysis);
    if (patch.baseOverlayRevision !== undefined && patch.baseOverlayRevision !== null && patch.baseOverlayRevision !== currentOverlay)
      fail("Patch baseOverlayRevision does not match the current claim overlay.", "OVERLAY_CONFLICT");

    // A review action states that a person checked this claim. No patch can make one,
    // whoever sends it and whatever it says about itself.
    for (const item of patch.claims || []) {
      if ((item?.review !== undefined && item?.review !== null && item?.review !== "proposed") || (item && Object.hasOwn(item, "reviewedBy")))
        fail(claims.REVIEW_REFUSAL, "REVIEW_NOT_PERMITTED");
      if (item?.author?.kind === "human" && principal.kind !== "human")
        fail("Human authorship is assigned by the workspace, not by the patch.", "AUTHORSHIP_NOT_PERMITTED");
    }
    // Content only: the stored author is the resolved principal.
    const proposals = (patch.claims || []).map(item => ({
      ...item,
      snapshotId: analysis.snapshotId,
      author: { kind: principal.kind, identity: principal.identity },
    }));
    const checked = claims.validatePatch(model, { ...patch, claims: proposals });

    const relationIds = new Set((analysis.relations || []).map(item => item.id));
    const evidenceIds = new Set((analysis.evidence || []).map(item => item.id));
    const claimIds = new Set((analysis.claims || []).map(item => item.id));
    const fileIds = new Set((analysis.snapshot?.files || []).flatMap(file => [file.path, file.id]).filter(Boolean));
    for (const claim of checked.claims) {
      for (const factId of claim.factIds || [])
        if (!relationIds.has(factId)) fail(`Claim ${claim.id} references unknown fact ${factId}.`, "UNKNOWN_FACT");
      for (const evidenceId of claim.counterEvidenceIds || [])
        if (!evidenceIds.has(evidenceId)) fail(`Claim ${claim.id} references unknown counter-evidence ${evidenceId}.`, "UNKNOWN_EVIDENCE");
      if (claim.supersedes && !claimIds.has(claim.supersedes))
        fail(`Claim ${claim.id} supersedes an unknown claim.`, "UNKNOWN_CLAIM");
      for (const evidenceId of [...(claim.evidenceIds || []), ...(claim.counterEvidenceIds || [])]) {
        const evidence = (analysis.evidence || []).find(item => item.id === evidenceId);
        if (!evidence) continue;
        if (evidence.snapshotId !== analysis.snapshotId) fail(`Evidence ${evidenceId} belongs to another snapshot.`, "STALE_SPAN");
        if (evidence.fileId && fileIds.size && !fileIds.has(evidence.fileId))
          fail(`Evidence ${evidenceId} cites a file outside the snapshot.`, "STALE_SPAN");
      }
      if (isInstructionText(claim.text || ""))
        fail("Claim text looks like an instruction to the analyzer; source text is data only.", "PROMPT_INJECTION");
    }
    return {
      ...checked,
      principal,
      digest: digest({ ...patch, claims: proposals, scope: scopeOf(analysis, principal, context) }, ir()),
      idempotencyKey: patch.idempotencyKey || null,
      overlayRevision: currentOverlay,
    };
  }

  function apply(model, patch, context = {}) {
    // Validate the envelope first, then look for a replay of this exact
    // request, and only then guard on the overlay revision: a legitimate retry
    // must not fail because its own first attempt moved the revision.
    const checked = validate(model, patch, context);
    const analysis = model.analysis;
    analysis.patchLog = analysis.patchLog || [];
    if (checked.idempotencyKey) {
      const previous = analysis.patchLog.find(entry => entry.idempotencyKey === checked.idempotencyKey);
      if (previous && previous.digest === checked.digest)
        return { ...previous.result, applied: 0, claims: analysis.claims.length, idempotent: true, digest: checked.digest, claimIds: [] };
      if (previous)
        fail("This idempotency key was already used for a different request. Send a new key to change a claim.", "IDEMPOTENCY_CONFLICT");
    }
    if (patch.baseOverlayRevision !== undefined && patch.baseOverlayRevision !== null && patch.baseOverlayRevision !== overlayRevision(analysis))
      fail("The claim overlay moved since this patch was prepared.", "OVERLAY_CONFLICT");

    // Apply to a copy so a late failure cannot leave a half-written overlay.
    const staged = { ...analysis, claims: [...(analysis.claims || [])] };
    const stagedModel = { ...model, analysis: staged };
    const result = root.SkylenseClaims.applyPatch(stagedModel, { ...patch, claims: checked.claims });
    analysis.claims = staged.claims;
    const record = {
      applied: result.applied,
      snapshotId: analysis.snapshotId,
      claims: analysis.claims.length,
      overlayRevision: overlayRevision(analysis),
    };
    analysis.patchLog.push({
      digest: checked.digest,
      idempotencyKey: checked.idempotencyKey,
      principal: `${checked.principal.kind}:${checked.principal.identity}`,
      at: Date.now(),
      result: record,
    });
    // claimIds names what this call stored, so a durable overlay store can record exactly it.
    return { ...record, digest: checked.digest, idempotent: false, claimIds: result.claimIds };
  }

  root.SkylenseClaimValidation = Object.freeze({
    ENVELOPE_VERSION, isInstructionText, validate, apply, digest, overlayRevision, resolvePrincipal, canonicalValue,
  });
})(typeof window !== "undefined" ? window : globalThis);
