/* Skylense Analysis IR v2. Facts, claims and views stay separate. Shared by
   Node, Worker and browser. Canonical text is never rewritten or silently cut. */
(function (root) {
  "use strict";

  const SCHEMA_VERSION = 2;
  const RELATION_KINDS = Object.freeze([
    "contains", "imports", "calls", "inherits", "implements", "reads", "writes",
    "publishes", "subscribes", "configures", "references", "documents", "generates",
    "constructs", "loads", "links",
  ]);
  const RESOLUTIONS = Object.freeze([
    "source-declared", "resolved-static", "candidate", "unresolved",
    "external-unfetched", "legacy-unknown",
  ]);
  const FILE_STATUSES = Object.freeze(["included", "excluded", "unreadable", "unsupported-format"]);
  const DECODE_STATUSES = Object.freeze(["exact", "lossy", "binary", "unavailable"]);
  const CLAIM_PREDICATES = Object.freeze([
    "responsibility", "module-membership", "scenario-step", "design-note", "risk",
  ]);
  const CLAIM_BASIS = Object.freeze([
    "source-statement", "documentation-statement", "inference", "human-interpretation",
  ]);
  const CLAIM_SUPPORT = Object.freeze(["supported", "conflicting", "insufficient"]);
  const CLAIM_REVIEW = Object.freeze(["proposed", "checked", "rejected", "stale"]);
  const GROUP_SEMANTICS = Object.freeze(["candidate-targets", "declared-operation", "declared-members"]);
  const READINESS = Object.freeze(["sourceMapReady", "deepMapReady", "generalCapabilityAccepted"]);

  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: false });

  function fail(message) { throw new Error(message); }
  function isPlain(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
  function text(value, name, max = 4000) {
    if (typeof value !== "string" || !value.length || value.length > max) fail(`${name} must be a nonempty string of at most ${max} characters.`);
    return value;
  }
  function optionalText(value, name, max = 8000) {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string" || value.length > max) fail(`${name} must be a string of at most ${max} characters.`);
    return value;
  }
  function enumOf(value, allowed, name) {
    if (!allowed.includes(value)) fail(`${name} is not a known ${name} value.`);
    return value;
  }
  function sortedKeys(object) {
    return Object.keys(object).sort();
  }

  /* Compact SHA-256. Matches Node crypto.createHash('sha256') on Uint8Array. */
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  function rotr(value, bits) { return (value >>> bits) | (value << (32 - bits)); }
  function sha256Bytes(input) {
    const source = input instanceof Uint8Array ? input : encoder.encode(String(input));
    const length = source.length;
    const padded = new Uint8Array(((length + 9 + 63) & ~63));
    for (let i = 0; i < length; i++) padded[i] = source[i];
    padded[length] = 0x80;
    const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
    view.setUint32(padded.length - 4, (length * 8) >>> 0);
    view.setUint32(padded.length - 8, Math.floor((length * 8) / 0x100000000));
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    const w = new Uint32Array(64);
    for (let offset = 0; offset < padded.length; offset += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7].map(word => word.toString(16).padStart(8, "0")).join("");
  }
  function sha256Text(value) { return sha256Bytes(encoder.encode(value == null ? "" : String(value))); }
  function utf8Slice(text, startUtf16, endUtf16) {
    if (typeof text !== "string") fail("Evidence text must be a JavaScript string.");
    if (!Number.isInteger(startUtf16) || !Number.isInteger(endUtf16) || startUtf16 < 0 || endUtf16 < startUtf16 || endUtf16 > text.length)
      fail("Evidence range must be a half-open UTF-16 interval inside the decoded text.");
    return text.slice(startUtf16, endUtf16);
  }

  /* One line index per full decoded text. Lines are 1-based. A span is the
     half-open UTF-16 interval [start,end): an end sitting on the next line
     start still belongs to the last included line. */
  function createLineIndex(text) {
    const starts = [0];
    for (let at = 0; at < text.length; at++) if (text.charCodeAt(at) === 10) starts.push(at + 1);
    const lineAt = offset => {
      const clamped = Math.max(0, Math.min(offset, text.length));
      let low = 0, high = starts.length - 1;
      while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (starts[mid] <= clamped) low = mid; else high = mid - 1;
      }
      return low + 1;
    };
    return {
      count: starts.length,
      lineAt,
      startOf(line) { return starts[Math.max(1, Math.min(line, starts.length)) - 1]; },
      linesOf(startUtf16, endUtf16) {
        const startLine = lineAt(startUtf16);
        return { startLine, endLine: endUtf16 === startUtf16 ? startLine : lineAt(endUtf16 - 1) };
      },
    };
  }
  /* Every span of one file is verified against the same full text. Hashing and
     indexing that text once per span made evidence cost O(spans × file size): a
     55k-line file with thousands of call spans spent minutes re-hashing identical
     bytes. The last few texts are kept; a hit is the identical string, so the
     answer is the one a fresh computation would give. */
  const textFacts = new Map();
  function fullTextFacts(text) {
    let facts = textFacts.get(text);
    if (!facts) {
      facts = { hash: sha256Text(text), index: createLineIndex(text) };
      if (textFacts.size >= 4) textFacts.delete(textFacts.keys().next().value);
      textFacts.set(text, facts);
    }
    return facts;
  }

  function evidenceProducer(input, fallbackMode) {
    return Object.freeze({
      adapter: text(input?.adapter || "skylense", "producer.adapter", 80),
      version: text(input?.version || "2", "producer.version", 40),
      mode: text(input?.mode || fallbackMode, "producer.mode", 40),
    });
  }
  function declaredLine(value, name) {
    if (value === undefined || value === null) return null;
    if (!Number.isInteger(value) || value < 1) fail(`${name} must be a 1-based integer line number.`);
    return value;
  }
  function idList(values, name) {
    return Object.freeze([...(values || [])].map((id, i) => text(id, `${name}[${i}]`, 240)));
  }

  /* Exact evidence extracted from the stored full text of one file. Declared
     lines, excerpts and hashes are inputs to verify, never a source of truth. */
  function fromSpan(input) {
    if (!isPlain(input)) fail("Evidence must be an object.");
    const snapshotId = text(input.snapshotId, "snapshotId", 160);
    const fileId = text(input.fileId, "fileId", 240);
    if (typeof input.decodedText !== "string") fail("Exact evidence requires the complete decoded text of the named file.");
    const decodedText = input.decodedText;
    const startUtf16 = Number(input.range?.startUtf16), endUtf16 = Number(input.range?.endUtf16);
    const excerpt = utf8Slice(decodedText, startUtf16, endUtf16);
    const { hash: decodedTextHash, index } = fullTextFacts(decodedText);
    const { startLine, endLine } = index.linesOf(startUtf16, endUtf16);
    const excerptHash = sha256Text(excerpt);
    const wantedStart = declaredLine(input.range?.startLine, "startLine");
    const wantedEnd = declaredLine(input.range?.endLine, "endLine");
    if (wantedStart !== null && wantedStart !== startLine) fail(`startLine ${wantedStart} contradicts line ${startLine} computed from the UTF-16 start offset.`);
    if (wantedEnd !== null && wantedEnd !== endLine) fail(`endLine ${wantedEnd} contradicts line ${endLine} computed from the UTF-16 end offset.`);
    if (input.decodedTextHash && input.decodedTextHash !== decodedTextHash) fail("decodedTextHash does not match the supplied decoded text.");
    if (input.excerptHash && input.excerptHash !== excerptHash) fail("excerptHash does not match the UTF-16 slice.");
    if (input.excerpt != null && input.excerpt !== excerpt) fail("Evidence excerpt must equal the source slice; rewriting is forbidden.");
    return Object.freeze({
      id: input.id || `ev_${sha256Text(snapshotId + "\0" + fileId + "\0" + startUtf16 + "\0" + endUtf16).slice(0, 16)}`,
      snapshotId, fileId,
      kind: "source-span",
      verification: "source-verified",
      rawHash: optionalText(input.rawHash, "rawHash", 64) || null,
      decodedTextHash,
      range: Object.freeze({ startUtf16, endUtf16, startLine, endLine }),
      /* Omit the key when there is no byte range instead of setting it to
         `undefined`: these records cross JSON transports, where an undefined
         value disappears, and an in-process reader would then disagree with a
         CLI or MCP reader about the same evidence. JSON already dropped it, so
         canonical digests are unchanged. */
      ...(input.byteRange && Number.isInteger(input.byteRange.start)
        ? { byteRange: Object.freeze({ start: input.byteRange.start, end: input.byteRange.end }) }
        : {}),
      excerptHash,
      excerpt,
      decodeStatus: "exact",
      producer: evidenceProducer(input.producer, "syntax"),
    });
  }

  /* A fragment carried by a v1 model or an undecodable file. Its declared
     location is preserved as a claim about the fragment, not as a fact: no
     full text was read, so nothing here is verified. */
  function fromLegacy(input) {
    if (!isPlain(input)) fail("Evidence must be an object.");
    const snapshotId = text(input.snapshotId, "snapshotId", 160);
    const fileId = text(input.fileId, "fileId", 240);
    const decodeStatus = enumOf(input.decodeStatus || "lossy", DECODE_STATUSES, "decodeStatus");
    if (decodeStatus === "exact") fail("Legacy excerpt evidence cannot be exact; the full text of the file was never read.");
    const excerpt = typeof input.excerpt === "string" ? input.excerpt : null;
    const declared = input.declaredRange || input.range || null;
    const startLine = declaredLine(declared?.startLine, "startLine");
    const endLine = declaredLine(declared?.endLine, "endLine") ?? startLine;
    return Object.freeze({
      id: input.id || `ev_${sha256Text(snapshotId + "\0" + fileId + "\0" + (startLine ?? "") + "\0" + (excerpt ?? "")).slice(0, 16)}`,
      snapshotId, fileId,
      kind: "legacy-excerpt",
      verification: "unverified",
      rawHash: optionalText(input.rawHash, "rawHash", 64) || null,
      decodedTextHash: null,
      range: startLine === null ? null : Object.freeze({ startUtf16: null, endUtf16: null, startLine, endLine }),
      excerptHash: excerpt === null ? null : sha256Text(excerpt),
      excerpt,
      decodeStatus,
      producer: evidenceProducer(input.producer, "declared-location"),
      reasonCode: optionalText(input.reasonCode, "reasonCode", 120) || "legacy-excerpt-without-full-text",
    });
  }

  /* A statistic or summary computed from other records. It quotes no file, so
     it carries the operation and the records it was computed from instead. */
  function fromDerivation(input) {
    if (!isPlain(input)) fail("Evidence must be an object.");
    const snapshotId = text(input.snapshotId, "snapshotId", 160);
    const operation = text(input.operation, "derivation.operation", 80);
    const summary = text(input.summary, "derivation.summary", 4000);
    const inputEvidenceIds = idList(input.inputEvidenceIds, "inputEvidenceIds");
    const inputFactIds = idList(input.inputFactIds, "inputFactIds");
    const inputFileIds = idList(input.inputFileIds, "inputFileIds");
    if (!inputEvidenceIds.length && !inputFactIds.length && !inputFileIds.length)
      fail("Derived evidence must name the records it was computed from.");
    return Object.freeze({
      id: input.id || `ev_derived_${sha256Text(snapshotId + "\0" + operation + "\0" + summary).slice(0, 16)}`,
      snapshotId,
      fileId: optionalText(input.fileId, "fileId", 240) || null,
      kind: "derived",
      verification: "derived",
      rawHash: null,
      decodedTextHash: null,
      range: null,
      excerptHash: null,
      excerpt: null,
      decodeStatus: "unavailable",
      summary,
      derivation: Object.freeze({ operation, inputEvidenceIds, inputFactIds, inputFileIds }),
      producer: evidenceProducer(input.producer, "derivation"),
      reasonCode: optionalText(input.reasonCode, "reasonCode", 120) || "derived-from-analysis",
    });
  }

  /* Single entry point. Every producer routes through one of the three
     constructors so no path can invent an exact span it never read. */
  function evidence(input) {
    if (!isPlain(input)) fail("Evidence must be an object.");
    if (input.kind === "derived" || input.derivation || input.operation) return fromDerivation(input);
    const status = input.decodeStatus || (typeof input.decodedText === "string" ? "exact" : null);
    if (status === "exact") return fromSpan(input);
    return fromLegacy(status === null ? input : { ...input, decodeStatus: status });
  }

  /* verified: the record was recomputed from the text it names.
     unavailable: nothing contradicts it, but nothing confirms it either.
     invalid: the record contradicts the material it claims to come from. */
  function validateEvidence(record, context = {}) {
    if (!isPlain(record)) return Object.freeze({ status: "invalid", reasonCode: "evidence-not-an-object" });
    const kind = record.kind || (record.decodeStatus === "exact" ? "source-span" : "legacy-excerpt");
    if (kind === "derived") {
      const inputs = record.derivation || {};
      const known = (ids, allowed) => !allowed || (ids || []).every(id => allowed.has(id));
      if (!known(inputs.inputEvidenceIds, context.knownEvidenceIds)
        || !known(inputs.inputFactIds, context.knownFactIds)
        || !known(inputs.inputFileIds, context.knownFileIds))
        return Object.freeze({ status: "invalid", reasonCode: "derivation-input-missing" });
      return Object.freeze({ status: "verified", reasonCode: null });
    }
    if (kind !== "source-span") return Object.freeze({ status: "unavailable", reasonCode: record.reasonCode || "no-full-text" });
    const fullText = typeof context.fullText === "string" ? context.fullText : null;
    if (fullText === null) return Object.freeze({ status: "unavailable", reasonCode: "file-text-not-loaded" });
    const { startUtf16, endUtf16 } = record.range || {};
    if (!Number.isInteger(startUtf16) || !Number.isInteger(endUtf16) || startUtf16 < 0 || endUtf16 < startUtf16 || endUtf16 > fullText.length)
      return Object.freeze({ status: "invalid", reasonCode: "span-outside-text" });
    if (fullText.slice(startUtf16, endUtf16) !== record.excerpt) return Object.freeze({ status: "invalid", reasonCode: "excerpt-does-not-match-slice" });
    const facts = fullTextFacts(fullText);
    if (facts.hash !== record.decodedTextHash) return Object.freeze({ status: "invalid", reasonCode: "decoded-text-hash-mismatch" });
    const lines = facts.index.linesOf(startUtf16, endUtf16);
    if (lines.startLine !== record.range.startLine || lines.endLine !== record.range.endLine)
      return Object.freeze({ status: "invalid", reasonCode: "line-numbers-contradict-offsets" });
    return Object.freeze({ status: "verified", reasonCode: null });
  }

  /* One immutable record per source file: what was read, how it decoded and
     what it hashes to. decodeStatus "exact" means the complete decoded text
     was held and hashed, so a span can be extracted from it later. */
  function fileRecord(input) {
    if (!isPlain(input)) fail("FileRecord must be an object.");
    const status = enumOf(input.status, FILE_STATUSES, "status");
    const decodeStatus = enumOf(input.decodeStatus || "unavailable", DECODE_STATUSES, "decodeStatus");
    const decodedTextHash = optionalText(input.decodedTextHash, "decodedTextHash", 64);
    if (decodeStatus === "exact" && !decodedTextHash)
      fail(`File ${input.path} cannot declare an exact decoding without the hash of its decoded text.`);
    return Object.freeze({
      id: text(input.id, "file.id", 240),
      path: text(input.path, "file.path", 4096),
      rawHash: optionalText(input.rawHash, "rawHash", 64),
      decodedTextHash,
      encoding: optionalText(input.encoding, "encoding", 40),
      byteLength: Number.isInteger(input.byteLength) ? input.byteLength : null,
      status,
      reasonCode: optionalText(input.reasonCode, "reasonCode", 120),
      language: optionalText(input.language, "language", 40),
      decodeStatus,
    });
  }

  function snapshot(input) {
    if (!isPlain(input)) fail("SourceSnapshot must be an object.");
    const files = (input.files || []).map(fileRecord);
    const paths = new Set();
    for (const file of files) {
      if (paths.has(file.path)) fail("Snapshot file paths must be unique.");
      paths.add(file.path);
    }
    const originKind = enumOf(input.origin?.kind || "folder", ["folder", "git", "github", "files", "webpage"], "origin.kind");
    const revisionKind = enumOf(input.revision?.kind || "content-manifest", ["commit", "content-manifest"], "revision.kind");
    const manifestHash = input.manifestHash || sha256Text(files.map(file => `${file.path}\0${file.rawHash || ""}\0${file.status}`).join("\n"));
    return Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      id: text(input.id || `snap_${manifestHash.slice(0, 16)}`, "snapshot.id", 160),
      origin: Object.freeze({ kind: originKind, label: text(input.origin?.label || "workspace", "origin.label", 240) }),
      revision: Object.freeze({ kind: revisionKind, value: text(input.revision?.value || manifestHash, "revision.value", 120) }),
      manifestHash,
      policyHash: text(input.policyHash || "default", "policyHash", 120),
      consistency: enumOf(input.consistency || "stable", ["stable", "changed-during-read", "partial"], "consistency"),
      files,
    });
  }

  function producer(input = {}) {
    return Object.freeze({
      adapter: text(input.adapter || "skylense", "producer.adapter", 80),
      version: text(input.version || "2", "producer.version", 40),
      rule: optionalText(input.rule, "producer.rule", 80) || "unspecified",
      projectContextHash: optionalText(input.projectContextHash, "producer.projectContextHash", 64) || null,
    });
  }

  function binaryRelation(input) {
    if (!isPlain(input)) fail("BinaryRelation must be an object.");
    const kind = enumOf(input.kind, RELATION_KINDS, "kind");
    const resolution = enumOf(input.resolution, RESOLUTIONS, "resolution");
    if (resolution === "resolved-static" && (typeof input.targetId !== "string" || !input.targetId))
      fail("resolved-static relations require a real targetId.");
    if (resolution === "unresolved" && !input.reasonCode) fail("unresolved relations require a reasonCode.");
    if (resolution === "resolved-static" && (!input.producer?.rule || !input.producer?.projectContextHash))
      fail("resolved-static relations require producer.rule and projectContextHash.");
    return Object.freeze({
      id: text(input.id, "relation.id", 240),
      snapshotId: text(input.snapshotId, "snapshotId", 160),
      kind, sourceId: text(input.sourceId, "sourceId", 240),
      targetId: input.targetId == null ? null : text(input.targetId, "targetId", 240),
      resolution,
      directionMeaning: text(input.directionMeaning || `${kind} from source to target`, "directionMeaning", 400),
      evidenceIds: Object.freeze([...(input.evidenceIds || [])].map((id, i) => text(id, `evidenceIds[${i}]`, 160))),
      callSiteId: optionalText(input.callSiteId, "callSiteId", 240),
      groupId: optionalText(input.groupId, "groupId", 240),
      reasonCode: optionalText(input.reasonCode, "reasonCode", 120),
      producer: producer(input.producer),
      legacy: input.legacy ? Object.freeze({ ...input.legacy }) : undefined,
    });
  }

  function relationGroup(input) {
    if (!isPlain(input)) fail("RelationGroup must be an object.");
    const semantics = enumOf(input.semantics, GROUP_SEMANTICS, "semantics");
    const participants = (input.participants || []).map((item, i) => {
      if (!isPlain(item)) fail(`participants[${i}] must be an object.`);
      return Object.freeze({
        id: text(item.id, "participant.id", 240),
        nodeId: text(item.nodeId, "participant.nodeId", 240),
        role: text(item.role, "participant.role", 80),
        port: optionalText(item.port, "participant.port", 80),
        direction: enumOf(item.direction, ["input", "output", "context"], "participant.direction"),
      });
    });
    if (semantics === "candidate-targets") {
      if (input.activation) fail("candidate-targets groups cannot use activation.");
      const hasCaller = participants.some(item => item.role === "caller" || item.role === "source");
      const hasCandidate = participants.some(item => item.role === "candidate" || item.role === "target");
      if (!hasCaller || !hasCandidate) fail("candidate-targets groups need a caller and at least one candidate.");
    }
    return Object.freeze({
      id: text(input.id, "group.id", 240),
      snapshotId: text(input.snapshotId, "snapshotId", 160),
      semantics, participants: Object.freeze(participants),
      memberRelationIds: Object.freeze([...(input.memberRelationIds || [])]),
      explicitPairs: Object.freeze((input.explicitPairs || []).map(pair => Object.freeze({ ...pair }))),
      ...(input.activation ? { activation: Object.freeze({
        mode: enumOf(input.activation.mode, ["all", "any", "unspecified"], "activation.mode"),
        requiredParticipantIds: Object.freeze([...(input.activation.requiredParticipantIds || [])]),
      }) } : {}),
      ...(input.candidateCompleteness
        ? { candidateCompleteness: enumOf(input.candidateCompleteness, ["exhaustive-in-declared-static-context", "partial", "unknown"], "candidateCompleteness") }
        : {}),
      callSiteId: optionalText(input.callSiteId, "callSiteId", 240),
      evidenceIds: Object.freeze([...(input.evidenceIds || [])]),
      reasonCode: optionalText(input.reasonCode, "reasonCode", 120),
      producer: producer(input.producer),
    });
  }

  /* What a person recorded when they checked or rejected one claim: who, when, and the exact
     text and evidence they looked at. It exists only beside a checked or rejected review; a
     claim whose text no longer hashes to what was checked cannot carry it. */
  function reviewRecord(input, claimText) {
    if (!isPlain(input)) fail("A checked or rejected claim needs the human review record it was checked against.");
    if (input.kind !== "human") fail("Only a person records a review disposition; reviewedBy.kind must be human.");
    const textSha256 = text(input.textSha256, "reviewedBy.textSha256", 64);
    if (textSha256 !== sha256Text(claimText)) fail("reviewedBy.textSha256 does not match the claim text; the check no longer applies.");
    return Object.freeze({
      kind: "human",
      identity: text(input.identity, "reviewedBy.identity", 160),
      disposition: enumOf(input.disposition, ["checked", "rejected"], "reviewedBy.disposition"),
      at: text(String(input.at ?? ""), "reviewedBy.at", 64),
      channel: enumOf(input.channel, ["cli", "ui"], "reviewedBy.channel"),
      textSha256,
      evidenceIds: idList(input.evidenceIds, "reviewedBy.evidenceIds"),
      evidenceDigest: text(input.evidenceDigest, "reviewedBy.evidenceDigest", 64),
      meaningDigest: text(input.meaningDigest, "reviewedBy.meaningDigest", 64),
      note: optionalText(input.note, "reviewedBy.note", 2000),
    });
  }

  function claim(input) {
    if (!isPlain(input)) fail("Claim must be an object.");
    const review = enumOf(input.review, CLAIM_REVIEW, "review");
    const claimText = text(input.text, "claim.text", 8000);
    const reviewedBy = review === "checked" || review === "rejected" ? reviewRecord(input.reviewedBy, claimText) : null;
    if (reviewedBy && reviewedBy.disposition !== review) fail("reviewedBy.disposition must equal the claim review.");
    if (reviewedBy && JSON.stringify([...reviewedBy.evidenceIds].sort()) !== JSON.stringify([...(input.evidenceIds || [])].sort()))
      fail("reviewedBy.evidenceIds do not match the claim evidence; the check no longer applies.");
    return Object.freeze({
      id: text(input.id, "claim.id", 240),
      snapshotId: text(input.snapshotId, "snapshotId", 160),
      subjectIds: Object.freeze((input.subjectIds || []).map((id, i) => text(id, `subjectIds[${i}]`, 240))),
      predicate: enumOf(input.predicate, CLAIM_PREDICATES, "predicate"),
      text: claimText,
      evidenceIds: Object.freeze([...(input.evidenceIds || [])]),
      factIds: Object.freeze([...(input.factIds || [])]),
      basis: enumOf(input.basis, CLAIM_BASIS, "basis"),
      support: enumOf(input.support, CLAIM_SUPPORT, "support"),
      review,
      author: Object.freeze({
        kind: enumOf(input.author?.kind || "agent", ["human", "agent"], "author.kind"),
        identity: text(input.author?.identity || "skylense", "author.identity", 160),
        model: optionalText(input.author?.model, "author.model", 80),
        promptVersion: optionalText(input.author?.promptVersion, "author.promptVersion", 40),
      }),
      dependencyFingerprint: text(input.dependencyFingerprint || sha256Text(JSON.stringify(input.subjectIds || [])), "dependencyFingerprint", 64),
      counterEvidenceIds: Object.freeze([...(input.counterEvidenceIds || [])]),
      // A reviewed claim is replaced by a new version, never edited in place.
      version: Number.isInteger(input.version) && input.version > 0 ? input.version : 1,
      supersedes: optionalText(input.supersedes, "supersedes", 240),
      // Present only with a checked or rejected review, so the key is absent otherwise.
      ...(reviewedBy ? { reviewedBy } : {}),
    });
  }

  function coverageLedger(input) {
    if (!isPlain(input)) fail("CoverageLedger must be an object.");
    const layer = (name, value = {}) => Object.freeze({
      discovered: Number(value.discovered) || 0,
      included: Number(value.included) || 0,
      excluded: Number(value.excluded) || 0,
      unreadable: Number(value.unreadable) || 0,
      unsupported: Number(value.unsupported) || 0,
      complete: Number(value.complete) || 0,
      pending: Number(value.pending) || 0,
      failed: Number(value.failed) || 0,
      unresolved: Number(value.unresolved) || 0,
      name,
    });
    return Object.freeze({
      snapshotId: text(input.snapshotId, "snapshotId", 160),
      discovery: layer("discovery", input.discovery),
      read: layer("read", input.read),
      syntax: layer("syntax", input.syntax),
      relations: layer("relations", input.relations),
      interpretation: layer("interpretation", input.interpretation),
      accountingComplete: input.accountingComplete !== false,
      mixedCompletenessForbidden: true,
      notes: Object.freeze([...(input.notes || [])]),
    });
  }

  function emptyIR(snapshotId) {
    return {
      schemaVersion: SCHEMA_VERSION,
      snapshotId,
      snapshot: null,
      evidence: [],
      relations: [],
      groups: [],
      claims: [],
      coverage: null,
      readiness: { sourceMapReady: false, deepMapReady: false, generalCapabilityAccepted: false },
      diagnostics: [],
    };
  }

  /* Internal consistency of one IR: every record belongs to this snapshot,
     ids are unique, and every reference resolves. Endpoint existence against
     the graph nodes is checked by the admission gate, which sees the model. */
  function validateIR(ir) {
    if (!isPlain(ir) || ir.schemaVersion !== SCHEMA_VERSION) fail("IR schemaVersion must be 2.");
    const snapshotId = ir.snapshotId;
    const fileKeys = new Set();
    for (const file of ir.snapshot?.files || []) { fileKeys.add(file.path); fileKeys.add(file.id); }
    const evidenceIds = new Set();
    for (const item of ir.evidence || []) {
      if (evidenceIds.has(item.id)) fail("Duplicate evidence id.");
      evidenceIds.add(item.id);
      if (item.snapshotId !== snapshotId) fail(`Evidence ${item.id} belongs to another snapshot.`);
      if (item.decodeStatus === "exact" && fileKeys.size && !fileKeys.has(item.fileId))
        fail(`Evidence ${item.id} names a file outside this snapshot.`);
    }
    const relationIds = new Set();
    for (const item of ir.relations || []) {
      binaryRelation(item);
      if (relationIds.has(item.id)) fail("Duplicate relation id.");
      relationIds.add(item.id);
      if (item.snapshotId !== snapshotId) fail(`Relation ${item.id} belongs to another snapshot.`);
      if (item.resolution === "resolved-static" && !item.evidenceIds.length) fail(`resolved-static relation ${item.id} cites no evidence.`);
      for (const evidenceId of item.evidenceIds) if (!evidenceIds.has(evidenceId)) fail(`Relation ${item.id} references unknown evidence.`);
    }
    for (const group of ir.groups || []) {
      relationGroup(group);
      if (group.snapshotId !== snapshotId) fail(`RelationGroup ${group.id} belongs to another snapshot.`);
      for (const id of group.memberRelationIds) if (!relationIds.has(id)) fail(`RelationGroup ${group.id} references unknown member relation.`);
    }
    const claimIds = new Set();
    for (const item of ir.claims || []) {
      claim(item);
      if (claimIds.has(item.id)) fail("Duplicate claim id.");
      claimIds.add(item.id);
      if (item.snapshotId !== snapshotId) fail(`Claim ${item.id} belongs to another snapshot.`);
      for (const evidenceId of item.evidenceIds) if (!evidenceIds.has(evidenceId)) fail(`Claim ${item.id} references unknown evidence.`);
      for (const evidenceId of item.counterEvidenceIds) if (!evidenceIds.has(evidenceId)) fail(`Claim ${item.id} references unknown counter-evidence.`);
      for (const factId of item.factIds) if (!relationIds.has(factId)) fail(`Claim ${item.id} references unknown fact.`);
    }
    return true;
  }

  function canonicalize(ir) {
    validateIR(ir);
    const clone = JSON.parse(JSON.stringify({
      schemaVersion: ir.schemaVersion,
      snapshotId: ir.snapshotId,
      snapshot: ir.snapshot ? {
        ...ir.snapshot,
        files: [...ir.snapshot.files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
      } : null,
      evidence: [...(ir.evidence || [])].sort((a, b) => a.id < b.id ? -1 : 1),
      relations: [...(ir.relations || [])].sort((a, b) => a.id < b.id ? -1 : 1),
      groups: [...(ir.groups || [])].sort((a, b) => a.id < b.id ? -1 : 1),
      claims: [...(ir.claims || [])].sort((a, b) => a.id < b.id ? -1 : 1),
      coverage: ir.coverage || null,
      readiness: ir.readiness || null,
      diagnostics: [...(ir.diagnostics || [])].sort((a, b) => String(a.code || a) < String(b.code || b) ? -1 : 1),
    }));
    return { digest: sha256Text(JSON.stringify(clone)), value: clone };
  }

  function attach(model, ir) {
    if (!isPlain(model)) fail("Cannot attach IR to a non-object model.");
    validateIR(ir);
    model.analysis = ir;
    if (!isPlain(model.meta)) model.meta = {};
    model.meta.analysisSchemaVersion = SCHEMA_VERSION;
    model.meta.readiness = ir.readiness;
    return model;
  }

  root.SkylenseAnalysisIR = Object.freeze({
    SCHEMA_VERSION, RELATION_KINDS, RESOLUTIONS, FILE_STATUSES, DECODE_STATUSES,
    CLAIM_PREDICATES, CLAIM_BASIS, CLAIM_SUPPORT, CLAIM_REVIEW, GROUP_SEMANTICS, READINESS,
    sha256Bytes, sha256Text, utf8Slice, createLineIndex,
    evidence, fromSpan, fromLegacy, fromDerivation, validateEvidence,
    fileRecord, snapshot, binaryRelation, relationGroup, claim, coverageLedger,
    emptyIR, validateIR, canonicalize, attach, producer,
  });
})(typeof window !== "undefined" ? window : globalThis);
