/* SourceContract v1: provenance for signature inputs/outputs. No guessed business roles. */
(function (root) {
  "use strict";
  const PARAM = new Set(["complete", "partial", "unsupported", "not-applicable"]);
  const RET = new Set(["explicit", "unannotated", "partial", "unsupported", "not-applicable"]);
  const ENGINES = new Set(["tree-sitter", "lexical"]);
  function fail(message) { throw new Error(message); }
  function integer(value, name) {
    if (!Number.isSafeInteger(value) || value < 0) fail(`${name} must be a nonnegative integer.`);
    return value;
  }
  function createLineIndex(text) {
    const source = String(text);
    const starts = [0];
    for (let i = 0; i < source.length; i++) if (source[i] === "\n") starts.push(i + 1);
    return Object.freeze({
      text: source,
      at(index) {
        const pos = Math.max(0, Math.min(Number(index) || 0, source.length));
        let lo = 0, hi = starts.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >>> 1;
          if (starts[mid] <= pos) lo = mid;
          else hi = mid - 1;
        }
        return lo + 1;
      },
    });
  }
  let activeLines = null;
  function usingLineIndex(text, fn) {
    const previous = activeLines;
    activeLines = createLineIndex(text);
    try { return fn(activeLines); }
    finally { activeLines = previous; }
  }
  function lineAt(text, index) {
    if (activeLines && activeLines.text === text) return activeLines.at(index);
    return createLineIndex(text).at(index);
  }
  function piece(file, text, startIndex, endIndex, lineStart, lineEnd) {
    integer(startIndex, "startIndex"); integer(endIndex, "endIndex");
    if (endIndex < startIndex) fail("Source span end precedes start.");
    const slice = String(text).slice(startIndex, endIndex);
    return Object.freeze({ text: slice, span: Object.freeze({ file: String(file || ""), startIndex, endIndex, lineStart: integer(lineStart, "lineStart") || 1, lineEnd: Math.max(integer(lineEnd, "lineEnd"), 1) }) });
  }
  function pieceFromNode(file, text, node) {
    if (!node) return null;
    const lineStart = node.startPosition.row + 1;
    const lineEnd = node.endPosition.row + (node.endPosition.column === 0 && node.endPosition.row > node.startPosition.row ? 0 : 1);
    return piece(file, text, node.startIndex, node.endIndex, lineStart, lineEnd);
  }
  function item(pieces, representation = "contiguous") {
    const list = (pieces || []).filter(Boolean);
    const text = list.map(entry => entry.text).join("");
    return Object.freeze({ text, representation: list.length > 1 ? "composite" : representation, pieces: Object.freeze(list.map(entry => Object.freeze({ text: entry.text, span: Object.freeze({ ...entry.span }) }))) });
  }
  function itemFromNode(file, text, node, extra = {}) {
    const source = pieceFromNode(file, text, node);
    if (!source) return null;
    return Object.freeze({ ...item([source]), ...extra });
  }
  function trimRange(text, startIndex, endIndex) {
    let start = startIndex, end = endIndex;
    while (start < end && /[ \t]/.test(text[start])) start++;
    while (end > start && /[ \t]/.test(text[end - 1])) end--;
    return [start, end];
  }
  function itemFromRange(file, text, startIndex, endIndex, lineStart, lineEnd, extra = {}) {
    if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex) || endIndex <= startIndex) return null;
    const [start, end] = trimRange(text, startIndex, endIndex);
    if (end <= start) return null;
    const from = lineAt(text, start);
    const to = lineAt(text, end - 1);
    return Object.freeze({ ...item([piece(file, text, start, end, from, to)]), ...extra });
  }
  function statusBlock(status, items, reason) {
    const block = { status, items: Object.freeze((items || []).filter(Boolean)) };
    if (reason) block.reason = String(reason);
    return Object.freeze(block);
  }
  function contract(fields) {
    const result = {
      version: 1,
      language: String(fields.language || ""),
      engine: ENGINES.has(fields.engine) ? fields.engine : fail("Unknown contract engine."),
      signature: fields.signature || null,
      parameters: fields.parameters || statusBlock("unsupported", [], "No parameter adapter."),
      returns: fields.returns || statusBlock("unsupported", [], "No return adapter."),
      issues: Object.freeze(Array.isArray(fields.issues) ? fields.issues : []),
    };
    if (fields.receiver) result.receiver = fields.receiver;
    if (fields.documentation) result.documentation = fields.documentation;
    return Object.freeze(result);
  }
  function notApplicable(language, engine, reason) {
    return contract({ language, engine, parameters: statusBlock("not-applicable", [], reason), returns: statusBlock("not-applicable", [], reason) });
  }
  function deriveInputs(value) {
    if (!value || value.parameters?.status === "not-applicable" || value.parameters?.status === "unsupported") return [];
    return (value.parameters.items || []).map(entry => entry.text);
  }
  function deriveOutputs(value) {
    if (!value || value.returns?.status !== "explicit") return [];
    return (value.returns.items || []).map(entry => entry.text);
  }
  function compatible(value) { return { inputs: deriveInputs(value), outputs: deriveOutputs(value), sourceContract: value }; }
  function shiftSpan(span, deltaIndex, deltaLine, startColumn, file) {
    if (!span) return span;
    const copy = { ...span, startIndex: span.startIndex + deltaIndex, endIndex: span.endIndex + deltaIndex, lineStart: span.lineStart + deltaLine, lineEnd: span.lineEnd + deltaLine, file: file || span.file };
    if (span.lineStart === 1 && Number.isInteger(startColumn)) { /* first-line column shift is recorded in lineStart only; offsets already include startIndex */ }
    return copy;
  }
  function shiftItem(entry, deltaIndex, deltaLine, startColumn, file) {
    if (!entry) return entry;
    return { ...entry, pieces: (entry.pieces || []).map(part => ({ text: part.text, span: shiftSpan(part.span, deltaIndex, deltaLine, startColumn, file) })) };
  }
  function shift(value, deltaIndex, deltaLine, startColumn, file) {
    if (!value || value.version !== 1) return value;
    const next = {
      ...value,
      signature: value.signature ? { text: value.signature.text, span: shiftSpan(value.signature.span, deltaIndex, deltaLine, startColumn, file) } : null,
      parameters: { ...value.parameters, items: (value.parameters.items || []).map(entry => shiftItem(entry, deltaIndex, deltaLine, startColumn, file)) },
      returns: { ...value.returns, items: (value.returns.items || []).map(entry => shiftItem(entry, deltaIndex, deltaLine, startColumn, file)) },
      issues: (value.issues || []).map(issue => issue.span ? { ...issue, span: shiftSpan(issue.span, deltaIndex, deltaLine, startColumn, file) } : issue),
    };
    if (value.receiver) next.receiver = shiftItem(value.receiver, deltaIndex, deltaLine, startColumn, file);
    if (value.documentation?.raw) next.documentation = { ...value.documentation, raw: { text: value.documentation.raw.text, span: shiftSpan(value.documentation.raw.span, deltaIndex, deltaLine, startColumn, file) } };
    return next;
  }
  function validatePiece(entry, name, source) {
    object(entry, name); object(entry.span, `${name}.span`);
    integer(entry.span.startIndex, `${name}.startIndex`); integer(entry.span.endIndex, `${name}.endIndex`);
    if (entry.span.endIndex < entry.span.startIndex) fail(`${name} span is inverted.`);
    if (typeof entry.text !== "string") fail(`${name}.text must be a string.`);
    if (typeof entry.span.file !== "string") fail(`${name}.file must be a string.`);
    integer(entry.span.lineStart, `${name}.lineStart`); integer(entry.span.lineEnd, `${name}.lineEnd`);
    if (entry.span.lineStart < 1 || entry.span.lineEnd < entry.span.lineStart) fail(`${name} line range is invalid.`);
    if (typeof source === "string" && source.slice(entry.span.startIndex, entry.span.endIndex) !== entry.text)
      fail(`${name} text does not match the original source slice.`);
  }
  function object(value, name) { if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be an object.`); }
  function validateItem(entry, name, source) {
    object(entry, name);
    if (!["contiguous", "composite"].includes(entry.representation)) fail(`${name}.representation is invalid.`);
    if (!Array.isArray(entry.pieces) || !entry.pieces.length) fail(`${name} needs pieces.`);
    if (typeof entry.text !== "string") fail(`${name}.text must be a string.`);
    let joined = "";
    for (const part of entry.pieces) { validatePiece(part, name, source); joined += part.text; }
    if (joined !== entry.text) fail(`${name}.text must equal concatenated pieces.`);
  }
  function validate(value, source) {
    if (value === undefined || value === null) return;
    object(value, "sourceContract");
    if (value.version !== 1) fail("sourceContract.version must be 1.");
    if (typeof value.language !== "string") fail("sourceContract.language must be a string.");
    if (!ENGINES.has(value.engine)) fail("sourceContract.engine is invalid.");
    if (value.signature) validatePiece(value.signature, "sourceContract.signature", source);
    object(value.parameters, "sourceContract.parameters");
    if (!PARAM.has(value.parameters.status)) fail("sourceContract.parameters.status is invalid.");
    if (!Array.isArray(value.parameters.items)) fail("sourceContract.parameters.items must be an array.");
    if (value.parameters.items.length > 2000) fail("sourceContract.parameters.items exceeds the 2000-item resource ceiling.");
    for (const entry of value.parameters.items) validateItem(entry, "parameter", source);
    object(value.returns, "sourceContract.returns");
    if (!RET.has(value.returns.status)) fail("sourceContract.returns.status is invalid.");
    if (!Array.isArray(value.returns.items)) fail("sourceContract.returns.items must be an array.");
    for (const entry of value.returns.items) validateItem(entry, "return", source);
    if (value.receiver) validateItem(value.receiver, "receiver", source);
    if (value.documentation) {
      object(value.documentation, "documentation");
      if (value.documentation.kind !== "python-docstring") fail("documentation.kind is invalid.");
      validatePiece(value.documentation.raw, "documentation.raw", source);
    }
    if (!Array.isArray(value.issues)) fail("sourceContract.issues must be an array.");
  }
  root.SkylenseSourceContracts = Object.freeze({
    piece, pieceFromNode, item, itemFromNode, itemFromRange, statusBlock, contract, notApplicable,
    deriveInputs, deriveOutputs, compatible, shift, validate, PARAM, RET, trimRange, lineAt,
    createLineIndex, usingLineIndex,
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
