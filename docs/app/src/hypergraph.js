/*
 * RelationGroup incidence over stored member relations. No cartesian expansion.
 *
 * Three object kinds stay distinct and must never be merged by a view:
 *   binary relation     one source -> one target, with its own edge ID, type, direction, evidence.
 *   visual bundle       a display aggregation of several binary edges; adds no causality.
 *   semantic relation   a declared multi-participant group with its own ID, incidence, roles
 *   group               and activation condition.
 *
 * `all` is the group's DECLARED joint participation condition; it never proves that anything
 * ran. `any` names candidates; it must never be presented as all-invoked. An activation the
 * producer never declared stays `unspecified`: reading it as `all` would invent a joint condition
 * the source never stated, which is a manufactured claim, not a default value.
 *
 * The declared condition is evaluated over PARTICIPANT identities, never over the union of the
 * member relations' endpoint node ids. Those are different sets: an endpoint union promotes a
 * declared output into a prerequisite, collapses two roles of one node into one obligation, and
 * turns a participant that was never declared required into a required one.
 */
(function (root) {
  "use strict";

  function fail(message) { throw new Error(message); }

  const ACTIVATION_MODES = ["all", "any", "unspecified"];
  const ACTIVATION_LABELS = { all: "all-of", any: "any-of", unspecified: "unspecified" };
  const ACTIVATION_NOTES = {
    all: "declared joint participation; not a runtime execution record",
    any: "candidate participants; not all of them are invoked",
    unspecified: "activation was not declared; the joint condition is unknown and must not be read as all-of or any-of",
  };

  /** Where the projected activation mode came from, so a default is never read as a declaration. */
  function activationOf(group) {
    if (group.semantics === "candidate-targets") return { mode: "any", basis: "semantics" };
    const declared = group.activation?.mode;
    if (ACTIVATION_MODES.includes(declared)) return { mode: declared, basis: "declared" };
    return { mode: "unspecified", basis: "undeclared" };
  }

  const participantView = (participant) => ({
    id: participant.id,
    nodeId: participant.nodeId,
    role: participant.role,
    direction: participant.direction,
    port: participant.port || null,
  });

  /**
   * Resolve the declared obligation of an `all` group against its own participants.
   *
   * requiredParticipantIds wins when it is declared. With no explicit list the declared INPUT
   * participants are the obligation, because a declared output is a product of the operation and
   * never its precondition. Unresolvable references are reported and make the condition
   * unevaluable rather than silently satisfied.
   */
  function requirement(mode, participants, requiredIds) {
    const byId = new Map(participants.map(item => [item.id, item]));
    const missingRefs = requiredIds.filter(id => !byId.has(id));
    if (mode !== "all")
      return { required: [], optional: participants.slice(), basis: mode === "any" ? "candidates" : "undeclared", missingRefs, evaluable: false };
    let required, basis;
    if (requiredIds.length) {
      required = requiredIds.map(id => byId.get(id)).filter(Boolean);
      basis = "declared";
    } else {
      required = participants.filter(item => item.direction === "input");
      basis = required.length ? "declared-inputs" : "none";
    }
    const requiredSet = new Set(required.map(item => item.id));
    return {
      required,
      optional: participants.filter(item => !requiredSet.has(item.id)),
      basis,
      missingRefs,
      // A partly meaningless condition is unknown, not met: nothing here may read as satisfied.
      evaluable: basis !== "none" && missingRefs.length === 0,
    };
  }

  function incidence(group, relationsById) {
    if (!group || !Array.isArray(group.memberRelationIds)) fail("RelationGroup requires memberRelationIds.");
    const members = group.memberRelationIds.map(id => {
      const rel = relationsById.get(id);
      if (!rel) fail(`RelationGroup ${group.id} is missing member ${id}.`);
      return rel;
    });
    const participants = (group.participants || []).map(participantView);
    const roles = {};
    for (const participant of participants) {
      if (!roles[participant.role]) roles[participant.role] = [];
      roles[participant.role].push(participant.nodeId);
    }
    // Roles read off the member endpoints are DERIVED, not declared. `rolesBasis` keeps the two
    // apart so a consumer cannot present a derived source/target split as a declaration.
    const rolesBasis = participants.length ? "declared" : "member-endpoints";
    if (rolesBasis === "member-endpoints") {
      roles.source = [...new Set(members.map(rel => rel.sourceId))];
      roles.target = [...new Set(members.map(rel => rel.targetId).filter(Boolean))];
    }
    const { mode, basis: activationBasis } = activationOf(group);
    const requiredParticipantIds = [...(group.activation?.requiredParticipantIds || [])];
    const resolved = requirement(mode, participants, requiredParticipantIds);
    const memberViews = members.map(rel => ({
      id: rel.id, kind: rel.kind, sourceId: rel.sourceId, targetId: rel.targetId,
      resolution: rel.resolution, evidenceIds: [...(rel.evidenceIds || [])],
    }));
    // The group's own support and its members' support are different provenance levels. Keeping
    // only the union lets a group that declared nothing read as evidenced by its members.
    const declaredEvidenceIds = [...new Set(group.evidenceIds || [])];
    const memberEvidenceIds = [...new Set(memberViews.flatMap(member => member.evidenceIds))];
    const evidenceIds = [...new Set([...declaredEvidenceIds, ...memberEvidenceIds])];
    const unknownReason = mode !== "all"
      ? `activation-${mode}`
      : resolved.missingRefs.length
        ? `unknown-required-participant:${resolved.missingRefs.join(",")}`
        : resolved.basis === "none"
          ? "no-declared-participants"
          : null;
    return {
      id: group.id,
      kind: "relation-group",
      semantics: group.semantics,
      activation: mode,
      activationLabel: ACTIVATION_LABELS[mode],
      activationBasis,
      activationNote: ACTIVATION_NOTES[mode],
      // Can the declared condition be evaluated at all? False means unknown, never satisfied.
      activationEvaluable: resolved.evaluable,
      activationUnknownReason: unknownReason,
      requiredParticipantIds,
      requiredParticipants: resolved.required.map(participantView),
      optionalParticipants: resolved.optional.map(participantView),
      requiredBasis: resolved.basis,
      missingParticipantRefs: [...resolved.missingRefs],
      candidateCompleteness: group.candidateCompleteness || null,
      participants,
      memberRelationIds: [...group.memberRelationIds],
      members: memberViews,
      roles,
      rolesBasis,
      declaredEvidenceIds,
      memberEvidenceIds,
      evidenceIds,
      totals: {
        members: memberViews.length,
        participants: participants.length,
        roles: Object.keys(roles).length,
        evidence: evidenceIds.length,
        declaredEvidence: declaredEvidenceIds.length,
        memberEvidence: memberEvidenceIds.length,
      },
      direction: {
        input: participants.filter(item => item.direction === "input").map(item => item.nodeId),
        output: participants.filter(item => item.direction === "output").map(item => item.nodeId),
        context: participants.filter(item => item.direction === "context").map(item => item.nodeId),
      },
      viewOnly: true,
    };
  }

  /**
   * Is the group's DECLARED condition met by the participants observed to be present?
   *
   * `observed` is always false: a declaration that holds is still a declaration. An `all` group
   * whose condition cannot be evaluated returns `undetermined` rather than a verdict, so no
   * caller can turn an unreadable or undeclared condition into success.
   */
  function activate(edge, observedIds) {
    const seen = new Set(observedIds || []);
    const present = (participant) => seen.has(participant.nodeId);
    const base = {
      groupId: edge.id,
      activation: edge.activation,
      activationBasis: edge.activationBasis || null,
      requiredParticipantIds: [...(edge.requiredParticipantIds || [])],
      optionalParticipantIds: (edge.optionalParticipants || []).map(item => item.id),
      missingParticipantRefs: [...(edge.missingParticipantRefs || [])],
      satisfiedParticipantIds: [],
      missingParticipantIds: [],
      hits: [],
      missing: [],
      observed: false,
      undetermined: false,
      reason: null,
    };
    if (edge.activation === "any") {
      const declared = (edge.participants || []).filter(item => ["candidate", "target"].includes(item.role));
      const candidateIds = declared.length
        ? [...new Set(declared.map(item => item.nodeId))]
        : [...new Set(edge.roles?.candidate || edge.roles?.target || [])];
      const hits = candidateIds.filter(id => seen.has(id));
      return {
        ...base,
        ok: hits.length > 0,
        hits,
        missing: candidateIds.filter(id => !seen.has(id)),
        satisfiedParticipantIds: declared.filter(present).map(item => item.id),
        missingParticipantIds: declared.filter(item => !present(item)).map(item => item.id),
        candidateCompleteness: edge.candidateCompleteness || null,
        note: "any-of candidate set; one present candidate is not an execution trace and the others are not failures",
      };
    }
    if (edge.activation !== "all")
      return {
        ...base,
        ok: false,
        undetermined: true,
        reason: edge.activationUnknownReason || `activation-${edge.activation || "unspecified"}`,
        note: ACTIVATION_NOTES.unspecified,
      };
    const required = edge.requiredParticipants || [];
    if (!edge.activationEvaluable)
      return {
        ...base,
        ok: false,
        undetermined: true,
        reason: edge.activationUnknownReason || "activation-not-evaluable",
        satisfiedParticipantIds: required.filter(present).map(item => item.id),
        missingParticipantIds: required.filter(item => !present(item)).map(item => item.id),
        note: base.missingParticipantRefs.length
          ? `requiredParticipantIds names ${base.missingParticipantRefs.join(", ")}, which this group never declared as a participant; the condition cannot be evaluated`
          : "this group declares no participant obligation, so its joint condition cannot be evaluated from member endpoints",
      };
    // Two roles of one node are two obligations; one observed node satisfies both, separately.
    const satisfied = required.filter(present), outstanding = required.filter(item => !present(item));
    return {
      ...base,
      ok: outstanding.length === 0,
      satisfiedParticipantIds: satisfied.map(item => item.id),
      missingParticipantIds: outstanding.map(item => item.id),
      hits: [...new Set(satisfied.map(item => item.nodeId))],
      missing: [...new Set(outstanding.map(item => item.nodeId))],
      note: outstanding.length === 0
        ? "the declared joint participation condition holds; a declaration only, never a measured run"
        : `the declared joint participation condition is unmet: ${outstanding.map(item => `${item.id} (${item.nodeId})`).join(", ")}`,
    };
  }

  function fromAnalysis(analysis) {
    const relations = new Map((analysis.relations || []).map(rel => [rel.id, rel]));
    return (analysis.groups || []).map(group => incidence(group, relations));
  }

  function binaryCompatible(edge) {
    return (edge.members || []).map(member => ({
      id: member.id,
      source: member.sourceId,
      target: member.targetId,
      type: member.kind,
      fromHyperedge: edge.id,
      viewOnly: true,
    }));
  }

  function query(edge, role) {
    return (edge.roles && edge.roles[role] ? edge.roles[role] : []).slice();
  }

  function noCartesian(group, relationsById) {
    const edge = incidence(group, relationsById);
    const sources = query(edge, "source").length || query(edge, "caller").length;
    const targets = query(edge, "target").length || query(edge, "candidate").length;
    if (group.semantics !== "candidate-targets" && sources && targets && sources * targets > edge.members.length)
      fail(`RelationGroup ${group.id} would expand to a cartesian product; store member relations explicitly.`);
    return edge;
  }

  /**
   * Model-level findings for every declared group: references that resolve to nothing, so a
   * malformed declaration is refused by validation instead of reaching a reader as a condition
   * that looks meaningful. One entry per distinct defect, in declaration order.
   */
  function validateGroups(analysis) {
    const relationIds = new Set((analysis?.relations || []).map(rel => rel.id));
    const findings = [];
    for (const group of analysis?.groups || []) {
      const missingMembers = [...(group.memberRelationIds || [])].filter(id => !relationIds.has(id));
      if (missingMembers.length)
        findings.push({
          groupId: group.id, code: "missing-member-relations", detail: missingMembers,
          missingMemberRelationIds: missingMembers,
          message: `RelationGroup ${group.id} names member relations that are not stored: ${missingMembers.join(", ")}.`,
        });
      const participantIds = (group.participants || []).map(item => item.id);
      const duplicates = participantIds.filter((id, index) => participantIds.indexOf(id) !== index);
      if (duplicates.length)
        findings.push({
          groupId: group.id, code: "duplicate-participant-id", detail: [...new Set(duplicates)],
          message: `RelationGroup ${group.id} declares the participant id ${[...new Set(duplicates)].join(", ")} more than once.`,
        });
      const declared = new Set(participantIds);
      const unknown = [...(group.activation?.requiredParticipantIds || [])].filter(id => !declared.has(id));
      if (unknown.length)
        findings.push({
          groupId: group.id, code: "unknown-required-participant", detail: unknown,
          message: `RelationGroup ${group.id} requires participants it never declared: ${unknown.join(", ")}. requiredParticipantIds names participant identities, not node ids.`,
        });
    }
    return findings;
  }

  /** Strict gate for model admission: a malformed declaration is refused outright. */
  function assertGroups(analysis) {
    const [first] = validateGroups(analysis);
    if (first) fail(first.message);
    return true;
  }

  /** The same findings, for a caller that only wants to report them. */
  function groupDiagnostics(analysis) {
    return validateGroups(analysis);
  }

  /**
   * Project every declared group for the interactive view: real group IDs, participant roles,
   * activation and the projected binary relations each group's members currently live in.
   * Members and evidence are conserved; nothing is expanded into a cartesian product.
   *
   * A declaration whose member relations are not stored cannot be shown as if it were verified,
   * so it is dropped — but never silently: pass a `diagnostics` array to receive the reason for
   * every drop, plus every other model-level finding about these groups.
   */
  function projectGroups(analysis, relations = [], { diagnostics } = {}) {
    const findings = validateGroups(analysis);
    if (Array.isArray(diagnostics)) diagnostics.push(...findings);
    const unstored = new Set(
      findings.filter(item => item.code === "missing-member-relations").map(item => item.groupId),
    );
    const byId = new Map((analysis?.relations || []).map(rel => [rel.id, rel]));
    const projected = [];
    for (const group of analysis?.groups || []) {
      if (unstored.has(group.id)) continue;
      const edge = incidence(group, byId);
      const memberEdgeIds = edge.members.map(member => member.id);
      const memberSet = new Set(memberEdgeIds);
      projected.push({
        ...edge,
        memberEdgeIds,
        nodeIds: [...new Set(edge.participants.map(item => item.nodeId))],
        relationIds: relations
          .filter(relation => (relation.edgeIds || []).some(id => memberSet.has(id)))
          .map(relation => relation.id),
      });
    }
    return projected;
  }

  /** Groups that own at least one of these binary edges, newest declaration order preserved. */
  function groupsForEdges(groups, edgeIds) {
    const wanted = new Set(edgeIds || []);
    return (groups || []).filter(group => group.memberEdgeIds.some(id => wanted.has(id)));
  }

  root.SkylenseHypergraph = Object.freeze({
    incidence, activate, fromAnalysis, binaryCompatible, query, noCartesian,
    projectGroups, groupsForEdges, validateGroups, assertGroups, groupDiagnostics,
  });
})(typeof window !== "undefined" ? window : globalThis);
