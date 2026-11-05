/* Claim overlay, patch validation and deterministic source-backed enrichment.
   Host agents may propose claims. They cannot overwrite facts or mint resolved-static edges. */
(function (root) {
  "use strict";

  function ir() { return root.SkylenseAnalysisIR; }
  function fail(message, code) {
    const error = new Error(message);
    error.code = code || "INVALID_CLAIM";
    throw error;
  }

  function ensureAnalysis(model) {
    if (model.analysis?.schemaVersion === ir().SCHEMA_VERSION) return model.analysis;
    if (root.SkylenseModelMigrations) return root.SkylenseModelMigrations.migrateModel(model);
    fail("Analysis IR is not attached.", "MISSING_IR");
  }

  /* Four different things are easy to confuse: the cited record exists, the
     quote is accurate, the inference is supported, and a person checked it.
     This answers only the second one. A claim quotes its evidence when the
     evidence excerpt literally contains the claim text, ignoring whitespace
     and comment markers. A shared substring is not an entailment. */
  function normalizeQuote(value) {
    return String(value || "").replace(/^[ \t]*\*[ \t]?/gm, " ").replace(/\s+/g, " ").trim().toLowerCase();
  }
  function quotesEvidence(claim, evidence) {
    if (!claim.text || typeof evidence?.excerpt !== "string" || !evidence.excerpt) return false;
    const needle = normalizeQuote(claim.text);
    return needle.length > 0 && normalizeQuote(evidence.excerpt).includes(needle);
  }
  /* A claim may also rest on facts this snapshot already holds. Citing a real
     relation is weaker than a quote but it is a checkable reference, unlike a
     coincidental overlap of twelve characters. */
  function groundedInFacts(claim, relationIds) {
    return (claim.factIds || []).length > 0 && claim.factIds.every(id => relationIds.has(id));
  }

  /* The one refusal every patch path shares (MCP apply/enrich/propose, CLI propose, library
     callers). A review disposition is a person's record of having read a claim against its
     evidence; only reviewClaim below makes one, behind a human-invoked CLI command or
     workbench action. */
  const REVIEW_REFUSAL = "A claim patch cannot set review to checked, rejected or stale. Review dispositions are recorded only by a person: `skylense review <source|model.json> <claimId> --accept|--reject --reviewer <identity>` or the 核对通过 / 驳回 actions of the workbench claims tab. Host agents and MCP tools may only propose.";

  function validatePatch(model, patch) {
    const analysis = ensureAnalysis(model);
    if (!patch || typeof patch !== "object") fail("Patch must be an object.", "INVALID_PATCH");
    if (patch.snapshotId && patch.snapshotId !== analysis.snapshotId)
      fail("Patch snapshotId does not match the active snapshot.", "STALE_SNAPSHOT");
    if (patch.kind === "resolved-static" || patch.upgradeTo === "resolved-static")
      fail("Claims cannot create or upgrade resolved-static facts.", "FACT_OVERLAY_FORBIDDEN");
    if ((patch.claims || []).some(item => item.kind === "resolved-static" || item.upgradeTo === "resolved-static" || item.resolution === "resolved-static"))
      fail("Claims cannot create or upgrade resolved-static facts.", "FACT_OVERLAY_FORBIDDEN");
    const nodeIds = new Set((model.nodes || []).map(node => node.id));
    const evidenceIds = new Set((analysis.evidence || []).map(item => item.id));
    const claims = [];
    for (const item of patch.claims || []) {
      if ((item?.review !== undefined && item?.review !== null && item?.review !== "proposed") || (item && Object.hasOwn(item, "reviewedBy")))
        fail(REVIEW_REFUSAL, "REVIEW_NOT_PERMITTED");
      if ((item.subjectIds || []).some(id => !nodeIds.has(id) && !(model.hierarchy || []).some(container => container.id === id)))
        fail(`Claim subject ${item.id || "?"} references an unknown node.`, "UNKNOWN_SUBJECT");
      for (const evidenceId of item.evidenceIds || []) {
        if (!evidenceIds.has(evidenceId) && !(item.inlineEvidence && item.inlineEvidence.id === evidenceId))
          fail(`Claim ${item.id || "?"} references unknown evidence.`, "UNKNOWN_EVIDENCE");
      }
      const built = ir().claim({
        ...item,
        snapshotId: analysis.snapshotId,
        review: "proposed",
        support: item.support || "insufficient",
        basis: item.basis || "inference",
        author: item.author || { kind: "agent", identity: "host" },
      });
      const related = (analysis.evidence || []).filter(ev => built.evidenceIds.includes(ev.id));
      const relationIds = new Set((analysis.relations || []).map(item => item.id));
      if (built.support === "supported" && !related.some(ev => quotesEvidence(built, ev)) && !groundedInFacts(built, relationIds))
        fail(`Claim ${built.id} is marked supported but neither quotes a cited excerpt nor rests on a cited fact of this snapshot.`, "UNSUPPORTED_TEXT");
      claims.push(built);
    }
    return { ok: true, snapshotId: analysis.snapshotId, claims };
  }

  function applyPatch(model, patch) {
    const checked = validatePatch(model, patch);
    const analysis = model.analysis;
    const existing = new Map((analysis.claims || []).map(item => [item.id, item]));
    const stored = [];
    for (const item of checked.claims) {
      const current = existing.get(item.id);
      // A reviewed claim is a record that someone checked this text. Replacing
      // it in place would erase that; the replacement becomes a new version
      // that names what it supersedes, including a checked-to-checked change.
      if (current && (current.review === "checked" || current.review === "rejected")) {
        const version = (current.version || 1) + 1;
        const replacement = ir().claim({ ...item, id: `${item.id}#v${version}`, version, supersedes: current.id });
        if (existing.has(replacement.id)) fail(`Claim ${replacement.id} already exists; propose a new id.`, "IDEMPOTENT_CONFLICT");
        existing.set(replacement.id, replacement);
        stored.push(replacement.id);
        continue;
      }
      existing.set(item.id, item);
      stored.push(item.id);
    }
    analysis.claims = [...existing.values()];
    ir().validateIR(analysis);
    return { applied: checked.claims.length, snapshotId: analysis.snapshotId, claims: analysis.claims.length, claimIds: stored };
  }

  function moduleNodes(model) {
    return (model.nodes || []).filter(node => ["module", "class", "interface", "function"].includes(node.kind) || node.sourceRole === "file");
  }

  /* Sources arrive as the acquisition store: a path maps either to the decoded
     text or to a descriptor saying what was read. Only a complete decoding can
     back an exact span. */
  function fullTextOf(sources, path) {
    const value = sources instanceof Map ? sources.get(path) : sources?.[path];
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object") return null;
    if (value.decodeStatus && value.decodeStatus !== "exact") return null;
    return typeof value.text === "string" ? value.text : null;
  }

  const MAX_EXCERPT_UTF16 = 400;
  /* Keep a span inside a budget without ever splitting a surrogate pair, so
     the stored excerpt stays exactly text.slice(start, end). */
  function clampSpan(text, start, end, limit = MAX_EXCERPT_UTF16) {
    let stop = Math.min(end, start + limit);
    const code = stop > start ? text.charCodeAt(stop - 1) : 0;
    if (code >= 0xd800 && code <= 0xdbff) stop--;
    return Math.max(start, stop);
  }
  function trimSpan(text, start, end) {
    let from = start, to = end;
    while (from < to && /\s/.test(text[from])) from++;
    while (to > from && /\s/.test(text[to - 1])) to--;
    return { start: from, end: to };
  }

  /* The first prose paragraph of a document, located in the real file text so
     the quote carries its own offsets instead of a guessed position. */
  function firstParagraphSpan(text) {
    if (typeof text !== "string" || !text.length) return null;
    let cursor = 0;
    for (const part of text.split(/\n[ \t]*\n/)) {
      const span = trimSpan(text, cursor, cursor + part.length);
      cursor += part.length + (text.slice(cursor + part.length).match(/^\n[ \t]*\n/)?.[0].length || 0);
      const value = text.slice(span.start, span.end);
      if (!value || value.startsWith("#") || value.startsWith("```")) continue;
      return { start: span.start, end: clampSpan(text, span.start, span.end) };
    }
    return null;
  }

  /* The documented statement of a module, returned as a span of the file. The
     claim text is read back out of that span, never reassembled from it. The
     comment form follows the language; when a model does not record one, the
     file extension decides rather than a guess about the content. */
  function docstringSpan(text, language, path) {
    if (typeof text !== "string" || !text.length) return null;
    const dialect = language || (/\.pyi?$/i.test(path || "") ? "python" : null);
    if (dialect === "python") {
      const match = text.match(/^(?:\s*(?:async\s+)?def\s+\w+[\s\S]*?:\s*\n)[ \t]*("""[\s\S]*?"""|'''[\s\S]*?''')/)
        || text.match(/^\s*("""[\s\S]*?"""|'''[\s\S]*?''')/);
      if (!match) return null;
      const open = text.indexOf(match[1], match.index) + 3;
      const span = trimSpan(text, open, open + match[1].length - 6);
      return span.end > span.start ? { start: span.start, end: clampSpan(text, span.start, span.end), style: "plain" } : null;
    }
    const block = text.match(/^\s*\/\*\*([\s\S]*?)\*\//);
    if (!block) return null;
    const open = text.indexOf(block[1], block.index);
    const span = trimSpan(text, open, open + block[1].length);
    return span.end > span.start ? { start: span.start, end: clampSpan(text, span.start, span.end), style: "block-comment" } : null;
  }

  function spanEvidence(analysis, id, path, text, span, mode) {
    return ir().evidence({
      id, snapshotId: analysis.snapshotId, fileId: path,
      decodedText: text,
      decodeStatus: "exact",
      range: { startUtf16: span.start, endUtf16: span.end },
      producer: { adapter: "skylense-enrichment", version: "2", mode },
    });
  }

  function enrichFromSources(model, sources = {}) {
    const analysis = ensureAnalysis(model);
    const tasks = [];
    const claims = [];
    // Producer metadata decides authorship. A collector's own labels stay
    // machine output however well written they read; nothing here is reviewed,
    // so no path produces review "checked".
    const authoredModel = analysis.migration?.contentProvenance === "authored";
    const machine = { kind: "agent", identity: "skylense-enrichment", promptVersion: "deterministic-v1" };
    const person = { kind: "human", identity: "model-author" };
    const relationIds = new Set((analysis.relations || []).map(item => item.id));
    const documents = model.documents || [];
    const readme = documents.find(doc => /readme/i.test(doc.path || doc.title || "")) || documents[0];
    const readmePath = readme?.path || readme?.id || null;
    const readmeText = readmePath ? fullTextOf(sources, readmePath) : null;
    const paragraph = readmeText ? firstParagraphSpan(readmeText) : null;
    if (paragraph) {
      const evidence = spanEvidence(analysis, `ev_doc_${analysis.snapshotId}_readme`, readmePath, readmeText, paragraph, "readme-paragraph");
      analysis.evidence.push(evidence);
      claims.push(ir().claim({
        id: `cl_purpose_${analysis.snapshotId}`,
        snapshotId: analysis.snapshotId,
        subjectIds: model.groups?.[0] ? [model.groups[0].id] : (model.nodes[0] ? [model.nodes[0].id] : []),
        predicate: "design-note",
        text: evidence.excerpt,
        evidenceIds: [evidence.id],
        factIds: [],
        basis: "documentation-statement",
        support: "supported",
        review: "proposed",
        author: machine,
      }));
    }
    for (const node of moduleNodes(model)) {
      const path = node.path || null;
      const source = path ? fullTextOf(sources, path) : null;
      const span = source ? docstringSpan(source, node.language, path) : null;
      if (span) {
        const evidence = spanEvidence(analysis, `ev_resp_${node.id}`, path, source, span, "documented-statement");
        analysis.evidence.push(evidence);
        claims.push(ir().claim({
          id: `cl_resp_${node.id}`,
          snapshotId: analysis.snapshotId,
          subjectIds: [node.id],
          predicate: "responsibility",
          text: evidence.excerpt,
          evidenceIds: [evidence.id],
          factIds: [],
          basis: "source-statement",
          support: "supported",
          review: "proposed",
          author: machine,
        }));
        continue;
      }
      if (authoredModel && node.summary) {
        // Prose a person wrote into this model. Nobody checked it against the
        // source in this workspace, so it stays a proposal with no evidence.
        claims.push(ir().claim({
          id: `cl_resp_${node.id}`,
          snapshotId: analysis.snapshotId,
          subjectIds: [node.id],
          predicate: "responsibility",
          text: String(node.summary).slice(0, 400),
          evidenceIds: [],
          factIds: [],
          basis: "human-interpretation",
          support: "insufficient",
          review: "proposed",
          author: person,
        }));
        continue;
      }
      // The generated file statistic is a real derived record, not a quote.
      const derived = node.summary && path ? ir().fromDerivation({
        id: `ev_stat_${node.id}`,
        snapshotId: analysis.snapshotId,
        fileId: path,
        operation: "file-statistics",
        summary: String(node.summary).slice(0, 400),
        inputFileIds: [path],
        producer: { adapter: "skylense-enrichment", version: "2", mode: "derivation" },
      }) : null;
      if (derived) analysis.evidence.push(derived);
      tasks.push({
        id: `task_resp_${node.id}`,
        kind: "responsibility",
        subjectId: node.id,
        status: "pending",
        reasonCode: "missing-source-statement",
        evidenceIds: derived ? [derived.id] : [],
        prompt: `Read ${path || node.id} and write a source-backed responsibility claim. Do not invent runtime behaviour.`,
      });
    }
    const scenarios = (model.flows || []).filter(flow => (flow.nodes || []).length >= 2);
    for (const flow of scenarios) {
      const facts = (flow.edgeIds || []).filter(id => relationIds.has(id));
      claims.push(ir().claim({
        id: `cl_scene_${flow.id}`,
        snapshotId: analysis.snapshotId,
        subjectIds: flow.nodes.slice(0, 12),
        predicate: "scenario-step",
        text: flow.description || flow.label || flow.id,
        evidenceIds: [],
        factIds: facts,
        basis: authoredModel && flow.description ? "human-interpretation" : "inference",
        support: facts.length ? "supported" : "insufficient",
        review: "proposed",
        author: authoredModel && flow.description ? person : machine,
        dependencyFingerprint: ir().sha256Text((flow.edgeIds || flow.nodes).join(",")),
      }));
    }
    if (!scenarios.length) {
      tasks.push({
        id: `task_scene_${analysis.snapshotId}`,
        kind: "scenario",
        status: "pending",
        reasonCode: "no-authored-scenario",
        prompt: "Identify a real entrypoint and a cross-module reading path with existing edge ids. Do not invent edges.",
      });
    }
    const entryNames = /^(main|index|__main__|cli|app|mod|lib)\.[^.]+$/i;
    const entryPatterns = [/if\s+__name__\s*==\s*["']__main__["'][\s\S]{0,160}/, /\b(?:int|func)\s+main\s*\([^)]*\)[\s\S]{0,80}/];
    for (const node of model.nodes || []) {
      if (node.sourceRole !== "file") continue;
      const path = node.path || null;
      const name = String(path || "").split("/").pop() || "";
      const source = path ? fullTextOf(sources, path) : null;
      const found = source ? entryPatterns.map(pattern => source.match(pattern)).find(Boolean) : null;
      if (!entryNames.test(name) && !found) continue;
      // A named file or a matched launch guard makes this a candidate, not a
      // proven entrypoint: the map never observed the program start.
      const evidence = found
        ? spanEvidence(analysis, `ev_entry_${node.id}`, path, source, { start: found.index, end: clampSpan(source, found.index, found.index + found[0].length) }, "entrypoint-pattern")
        : null;
      if (evidence) analysis.evidence.push(evidence);
      claims.push(ir().claim({
        id: `cl_entry_${node.id}`,
        snapshotId: analysis.snapshotId,
        subjectIds: [node.id],
        predicate: "scenario-step",
        text: evidence
          ? `Source entrypoint candidate ${path}: ${evidence.excerpt.replace(/\s+/g, " ").slice(0, 240)}`
          : `Source entrypoint candidate ${path}: the file name matches a conventional entry module.`,
        evidenceIds: evidence ? [evidence.id] : [],
        factIds: [],
        basis: "inference",
        support: "insufficient",
        review: "proposed",
        author: machine,
      }));
    }
    let membership = 0;
    for (const node of model.nodes || []) {
      if (membership >= 40) break;
      if (node.sourceRole !== "symbol" || !node.parentId) continue;
      if (analysis.claims.some(item => item.id === `cl_member_${node.id}`)) continue;
      membership++;
      const containment = `rel_contains_${node.parentId}_${node.id}`;
      const facts = relationIds.has(containment) ? [containment] : [];
      claims.push(ir().claim({
        id: `cl_member_${node.id}`,
        snapshotId: analysis.snapshotId,
        subjectIds: [node.id, node.parentId],
        predicate: "module-membership",
        text: `${node.label} is declared inside ${node.parentId}`,
        evidenceIds: [],
        factIds: facts,
        basis: "source-statement",
        support: facts.length ? "supported" : "insufficient",
        review: "proposed",
        author: machine,
      }));
    }
    for (const item of claims) {
      if (!analysis.claims.some(existing => existing.id === item.id)) analysis.claims.push(item);
    }
    analysis.enrichmentTasks = tasks;
    analysis.readiness = evaluateReadiness(model, analysis, tasks);
    ir().validateIR(analysis);
    return { claims: claims.length, pendingTasks: tasks.length, readiness: analysis.readiness };
  }

  function dimension(id, name, status, evidence, note) {
    return { id, name, status, evidence: evidence || [], note: note || null };
  }

  /* ---------- human review ----------
     A review disposition is a person's statement that they read one claim against the
     evidence it cites. It binds the exact text (sha256) and the content of that evidence, so
     any later change to either no longer carries the check. Agent verdicts, independent
     obligation verification and authored grades are separate records and never count here. */
  const REVIEW_DISPOSITIONS = Object.freeze(["checked", "rejected"]);
  const REVIEW_CHANNELS = Object.freeze(["cli", "ui"]);

  /* What the cited evidence says, not what it is called: file, kind, span and excerpt hash
     (a derived record contributes its summary). Ids are left out so a record minted under a
     new snapshot-bound id with identical content still matches. */
  function evidenceDigest(analysis, ids) {
    const byId = new Map((analysis.evidence || []).map(item => [item.id, item]));
    const rows = [...(ids || [])].map(id => {
      const item = byId.get(id);
      if (!item) return JSON.stringify(["missing", id]);
      return JSON.stringify([item.fileId || null, item.kind || null, item.range ? [item.range.startUtf16 ?? null, item.range.endUtf16 ?? null] : null, item.excerptHash || null, item.kind === "derived" ? item.summary || null : null]);
    }).sort();
    return ir().sha256Text(rows.join("\n"));
  }
  /* What the claim says beyond its words: its predicate and what it is about (subjects, facts,
     counter-evidence). A check of "X is responsible for Y" does not transfer to the same
     sentence filed as a risk of Z. */
  function meaningDigest(claim) {
    const sorted = values => [...(values || [])].sort();
    return ir().sha256Text(JSON.stringify([claim.predicate || null, sorted(claim.subjectIds), sorted(claim.factIds), sorted(claim.counterEvidenceIds)]));
  }
  /* The bytes a claim is about when it cites no evidence: the decoded-text hash of every
     snapshot file under each subject (a container without a path covers every file). A
     rewrite of that file, or a different repository checked out at the same path, changes it. */
  function subjectContentDigest(model, analysis, subjectIds) {
    const files = analysis.snapshot?.files || [];
    const items = new Map([...(model.hierarchy || []), ...(model.nodes || [])].map(item => [item.id, item]));
    const rows = [...(subjectIds || [])].sort().map(id => {
      const item = items.get(id);
      if (!item) return [id, "missing"];
      const prefix = String(item.path || "").replace(/\/+$/, "");
      const covered = files.filter(file => !prefix || file.path === prefix || file.path.startsWith(`${prefix}/`));
      return [id, prefix, covered.map(file => `${file.path}\0${file.decodedTextHash || file.rawHash || ""}`).sort()];
    });
    return ir().sha256Text(JSON.stringify(["subjects", rows]));
  }
  /* What a review is bound to besides text and meaning: the cited evidence content, or the
     subjects' file content when nothing is cited. */
  function bindingDigest(model, analysis, claim) {
    return (claim.evidenceIds || []).length ? evidenceDigest(analysis, claim.evidenceIds) : subjectContentDigest(model, analysis, claim.subjectIds);
  }

  function isHumanChecked(claim) {
    return claim?.review === "checked" && claim.reviewedBy?.kind === "human" && REVIEW_CHANNELS.includes(claim.reviewedBy.channel)
      && claim.reviewedBy.textSha256 === ir().sha256Text(claim.text) && claim.reviewedBy.meaningDigest === meaningDigest(claim);
  }

  function mutableAnalysis(model) {
    const analysis = ensureAnalysis(model);
    if (Object.isFrozen(analysis) || Object.isFrozen(analysis.claims || [])) fail("Reviews are recorded on a mutable model copy.", "READ_ONLY_MODEL");
    return analysis;
  }

  /* Record one human disposition. The only caller is a human-invoked surface (`skylense
     review`, the workbench claims tab); no claim patch, MCP tool or host path reaches it.
     `now` is injected; this function never reads the clock. */
  function reviewClaim(model, claimId, options = {}) {
    const analysis = mutableAnalysis(model);
    const disposition = options.disposition;
    if (!REVIEW_DISPOSITIONS.includes(disposition)) fail("A review disposition is checked or rejected.", "INVALID_REVIEW");
    const identity = typeof options.reviewer?.identity === "string" ? options.reviewer.identity.trim() : "";
    if (!identity || identity.length > 160) fail("A review needs the reviewer's identity, typed by the person reviewing (1–160 characters).", "REVIEWER_REQUIRED");
    const channel = options.reviewer?.channel;
    if (!REVIEW_CHANNELS.includes(channel)) fail("A review is recorded through the CLI or the workbench, by a person.", "REVIEW_NOT_PERMITTED");
    if (typeof options.now !== "string" || !options.now) fail("A review needs an explicit timestamp.", "INVALID_REVIEW");
    const note = options.note === undefined || options.note === null ? null : String(options.note);
    if (note !== null && note.length > 2000) fail("A review note is at most 2000 characters.", "INVALID_REVIEW");
    const claims = analysis.claims || [];
    const index = claims.findIndex(item => item.id === claimId);
    if (index < 0) fail(`Claim ${claimId} is not in the active snapshot; stale claims cannot be reviewed as current.`, "UNKNOWN_CLAIM");
    const current = claims[index];
    const reviewedBy = {
      kind: "human", identity, disposition, at: options.now, channel,
      textSha256: ir().sha256Text(current.text),
      evidenceIds: [...(current.evidenceIds || [])].sort(),
      evidenceDigest: bindingDigest(model, analysis, current),
      meaningDigest: meaningDigest(current),
      note,
    };
    const reviewed = ir().claim({ ...current, review: disposition, reviewedBy });
    analysis.claims = claims.map((item, at) => at === index ? reviewed : item);
    ir().validateIR(analysis);
    analysis.readiness = readinessOf(model, analysis);
    return { claimId, previous: current.review, review: reviewed.review, reviewedBy: reviewed.reviewedBy };
  }

  /* Put back a disposition a person recorded earlier, if it still applies: the claim is in
     this snapshot with the same text, the same meaning (predicate, subjects, facts,
     counter-evidence) and the same evidence content. Otherwise nothing changes and the reason
     is returned, so the caller records that the check was invalidated. Evidence ids follow the
     claim when only the id of an identical record changed. */
  function restoreReview(model, reviewedBy, claimId) {
    const analysis = mutableAnalysis(model);
    if (reviewedBy?.kind !== "human" || !REVIEW_CHANNELS.includes(reviewedBy.channel) || !REVIEW_DISPOSITIONS.includes(reviewedBy.disposition))
      return { restored: false, reasonCode: "not-a-human-review" };
    const claims = analysis.claims || [];
    const index = claims.findIndex(item => item.id === claimId);
    if (index < 0) return { restored: false, reasonCode: "claim-not-current" };
    const current = claims[index];
    if (reviewedBy.textSha256 !== ir().sha256Text(current.text)) return { restored: false, reasonCode: "text-changed" };
    if (reviewedBy.meaningDigest !== meaningDigest(current)) return { restored: false, reasonCode: "meaning-changed" };
    if (reviewedBy.evidenceDigest !== bindingDigest(model, analysis, current))
      return { restored: false, reasonCode: (current.evidenceIds || []).length ? "evidence-changed" : "subject-content-changed" };
    if (current.review === reviewedBy.disposition && current.reviewedBy?.at === reviewedBy.at && current.reviewedBy?.identity === reviewedBy.identity)
      return { restored: true, unchanged: true };
    const restored = ir().claim({ ...current, review: reviewedBy.disposition, reviewedBy: { ...reviewedBy, evidenceIds: [...(current.evidenceIds || [])].sort() } });
    analysis.claims = claims.map((item, at) => at === index ? restored : item);
    return { restored: true, unchanged: false };
  }

  /* Which dimensions rest on interpretation a person must check, and on which claims. A
     dimension listed here satisfies its review requirement only when it rests on at least one
     human-checked claim and none of the claims it rests on is still unreviewed; rejected
     claims support nothing. The other dimensions rest on source facts, graph structure or
     recorded UI journeys and carry no claim review requirement. */
  const REVIEW_REQUIREMENTS = Object.freeze({
    D01: Object.freeze({ predicates: Object.freeze(["design-note"]), subjects: "any" }),
    D02: Object.freeze({ predicates: Object.freeze(["responsibility"]), subjects: "container" }),
    D03: Object.freeze({ predicates: Object.freeze(["responsibility"]), subjects: "node" }),
    D05: Object.freeze({ predicates: Object.freeze(["scenario-step"]), subjects: "any" }),
    D07: Object.freeze({ predicates: Object.freeze(["risk"]), subjects: "any" }),
    D09: Object.freeze({ predicates: Object.freeze(["scenario-step"]), subjects: "any" }),
  });
  function reviewRequirement(model, analysis, id) {
    const rule = REVIEW_REQUIREMENTS[id];
    if (!rule) return null;
    const nodeIds = new Set((model.nodes || []).map(node => node.id));
    const fits = claim => rule.predicates.includes(claim.predicate) && (rule.subjects === "any"
      || (rule.subjects === "node" ? (claim.subjectIds || []).some(subject => nodeIds.has(subject)) : (claim.subjectIds || []).some(subject => !nodeIds.has(subject))));
    const rests = (analysis.claims || []).filter(fits);
    const checked = rests.filter(isHumanChecked).length;
    const rejected = rests.filter(claim => claim.review === "rejected").length;
    const unreviewed = rests.length - checked - rejected;
    return { restsOn: rests.length, humanChecked: checked, rejected, unreviewed, satisfied: checked > 0 && unreviewed === 0 };
  }

  /* D01–D11 content checks. D12 is their closure: no open obligation, every content
     dimension passes and every review requirement is met by a person. */
  function contentDimensions(model, analysis, options) {
    const claims = analysis.claims || [];
    const flows = model.flows || [];
    const groups = model.groups || [];
    const relations = analysis.relations || [];
    const nodes = model.nodes || [];
    const withSummary = nodes.filter(node => node.summary && !/static source declaration|Source hierarchy/i.test(node.summary));
    const withContracts = nodes.filter(node => (node.functions || []).some(fn => (fn.inputs || []).length || (fn.outputs || []).length || fn.sourceContract));
    const dims = [];
    const pass = (id, name, ok, evidence, note) => {
      const row = dimension(id, name, ok ? "pass" : "fail", evidence, note);
      const review = reviewRequirement(model, analysis, id);
      if (review) row.review = review;
      dims.push(row);
    };
    pass("D01", "项目目的与系统边界", claims.some(c => c.predicate === "design-note") || /阅读|architecture|protocol/i.test(model.meta?.description || ""), [model.meta?.description].filter(Boolean));
    pass("D02", "职责层级", groups.length >= 2 && groups.every(g => g.description || g.label !== g.id), groups.map(g => g.id));
    pass("D03", "对象作用与接口含义", withSummary.length >= Math.min(5, nodes.length) && withContracts.length >= 1, [`summaries:${withSummary.length}`, `contracts:${withContracts.length}`]);
    pass("D04", "关系为什么存在", new Set(relations.map(r => r.kind)).size >= 2 && relations.every(r => r.directionMeaning), [...new Set(relations.map(r => r.kind))]);
    pass("D05", "关键任务与场景", flows.some(f => (f.nodes || []).length >= 3 && (f.edgeIds || []).length), flows.map(f => f.id));
    pass("D06", "局部与全局位置", (model.hierarchy || []).length > groups.length, ["hierarchy"]);
    pass("D07", "影响分析", relations.some(r => r.kind === "calls" || r.kind === "imports"));
    pass("D08", "多点关系探索", relations.length > 0 && (model.edges || []).length > 0, [`relations:${relations.length}`], "Path search uses existing graph edges; this is not a proof of execution.");
    pass("D09", "直观阅读导览", flows.some(f => f.description || f.label), flows.map(f => f.id));
    pass("D10", "可核验来源", (analysis.evidence || []).length > 0 && claims.every(c => c.basis), [`evidence:${(analysis.evidence || []).length}`]);
    pass("D11", "直观交互图", Boolean(options.uiVerified), ["viewer-shared-model"], options.uiVerified ? "Browser journeys recorded." : "UI/J-journey evidence is recorded separately and is not auto-passed.");
    return dims;
  }
  function closure(model, analysis, tasks, options) {
    const dims = contentDimensions(model, analysis, options);
    const open = tasks.filter(task => task?.status !== "closed");
    const reviewPending = dims.filter(d => d.review && !d.review.satisfied).map(d => d.id);
    const complete = Boolean(analysis.snapshot && (model.nodes || []).length && analysis.coverage)
      && open.length === 0 && dims.every(d => d.status === "pass") && reviewPending.length === 0;
    return { dims, open, reviewPending, complete };
  }

  /* The one readiness projection. Every surface reads this result rather than
     a stored flag, so an imported model cannot assert readiness and coverage
     and depth cannot disagree.
     deepMapReady is the D12 closure: every content dimension passes, no obligation is open,
     and every review requirement is met by human-checked claims. Agent verdicts never meet
     one, and D11 is never auto-passed, so no automatic path grants it.
     generalCapabilityAccepted is a decision about holdout projects; no path grants it. */
  function evaluateReadiness(model, analysis, tasks, options = {}) {
    const pendingTasks = tasks || analysis.enrichmentTasks || [];
    return Object.freeze({
      sourceMapReady: Boolean(analysis.snapshot && (model.nodes || []).length && analysis.coverage),
      deepMapReady: closure(model, analysis, pendingTasks, options).complete,
      generalCapabilityAccepted: false,
      pendingTasks: pendingTasks.length,
    });
  }
  function readinessOf(model, analysis, options) {
    return evaluateReadiness(model, analysis || ensureAnalysis(model), null, options || {});
  }

  function evaluateDepth(model, inventory, options = {}) {
    const analysis = ensureAnalysis(model);
    const tasks = analysis.enrichmentTasks || [];
    const { dims, open, reviewPending } = closure(model, analysis, tasks, options);
    const readiness = readinessOf(model, analysis, options);
    const note12 = open.length ? "Pending enrichment tasks remain; unknown is not completion."
      : reviewPending.length ? `Human review outstanding for ${reviewPending.join(", ")}; agent verdicts do not count.` : null;
    dims.push(dimension("D12", "主动深化与完成状态", readiness.deepMapReady ? "pass" : "fail", [`pending:${open.length}`, `reviewPending:${reviewPending.length}`], note12));
    const failed = dims.filter(d => d.status === "fail");
    const applicable = inventory?.obligations || dims.map(d => d.id);
    return {
      snapshotId: analysis.snapshotId,
      readiness,
      dimensions: dims,
      failed: failed.map(d => d.id),
      reviewPending,
      independentObligations: applicable,
      // One value, computed here and by coverage from the same projection.
      deepMapReady: readiness.deepMapReady,
      dimensionsComplete: failed.length === 0,
      note: "Scores cannot compensate a failed required dimension. A review requirement is met only by a person's check (skylense review or the workbench), never by an agent verdict.",
    };
  }

  root.SkylenseClaims = Object.freeze({
    validatePatch, applyPatch, enrichFromSources, evaluateReadiness, readinessOf, evaluateDepth,
    quotesEvidence, groundedInFacts, moduleNodes,
    REVIEW_REFUSAL, REVIEW_REQUIREMENTS, reviewClaim, restoreReview, evidenceDigest, meaningDigest, subjectContentDigest, isHumanChecked,
  });
})(typeof window !== "undefined" ? window : globalThis);
