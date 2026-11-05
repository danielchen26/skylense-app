/* Source accounting ledger shared by every acquisition transport (folder, Git,
   provider API, webpage). One vocabulary of terminal states, one reason per
   discovered path, and one place that refuses to call a partial acquisition
   complete.

   Accounting completeness and parse success are two different claims and are
   reported as two different numbers: `accountingComplete` says every discovered
   path was classified into exactly one terminal state with a reason, and
   `parse.successRate` says how many of the parse-eligible ones actually parsed.
   Neither implies the other.

   Memory bound: every discovered path is always counted in `aggregate` and in
   its ignored scope, so the state/reason totals are exact at any repository
   size. Per-path names are retained in full up to `retainBudget` (20000 by
   default); past that, plain ignore matches keep only their scope-attributed
   counts and `summary.pathDetail` reports how many names were dropped. A
   dropped name is still accounted; the summary never pretends otherwise. */
(function (root) {
  'use strict';

  // Terminal accounting states. Nothing else is allowed into a ledger, so a new
  // transport cannot invent a state that downstream reporting silently ignores.
  const STATES = Object.freeze(['parsed', 'metadata-only', 'excluded', 'failed', 'pending']);
  const STATE_SET = new Set(STATES);

  const SOURCE_KINDS = Object.freeze([
    'file', 'directory', 'symlink', 'ignore-file',
    'git-blob', 'git-symlink', 'git-submodule', 'git-lfs-pointer',
    'remote-blob', 'remote-page', 'browser-file',
  ]);
  const KIND_SET = new Set(SOURCE_KINDS);

  // Reason vocabulary, grouped by the state it implies. `reasonFor` maps the
  // short reasons the traversal layers already use onto this vocabulary so a
  // caller never has to pick a state by hand and get it wrong.
  const REASONS = Object.freeze({
    'analyzed': 'parsed',
    'binary-content': 'metadata-only',
    'unsupported-format': 'metadata-only',
    'size-limit': 'metadata-only',
    'text-budget-exhausted': 'metadata-only',
    'git-lfs-pointer-unfetched': 'metadata-only',
    'git-submodule-unfetched': 'metadata-only',
    'builtin-exclusion': 'excluded',
    'ignore-rule': 'excluded',
    'symlink-escapes-source-root': 'excluded',
    'symlink-not-followed': 'excluded',
    'not-regular-file': 'excluded',
    'outside-selected-subpath': 'excluded',
    'unreadable': 'failed',
    'decode-failed': 'failed',
    'fetch-failed': 'failed',
    'rate-limited': 'failed',
    'timeout': 'failed',
    'source-changed-during-acquisition': 'failed',
    'depth-limit': 'pending',
    'file-count-limit': 'pending',
    'traversal-limit': 'pending',
    'tree-truncated': 'pending',
    'page-limit': 'pending',
    'acquisition-partial': 'pending',
  });

  // Short reasons already used by the folder, browser and provider traversals.
  const ALIASES = Object.freeze({
    excluded: 'ignore-rule',
    symlink: 'symlink-not-followed',
    binary: 'binary-content',
    unreadable: 'unreadable',
    'fetch-failed': 'fetch-failed',
    FETCH_FAILED: 'fetch-failed',
    HTTP_ERROR: 'fetch-failed',
    TIMEOUT: 'timeout',
    TOO_LARGE: 'size-limit',
    BINARY: 'binary-content',
  });

  // Only plain ignore matches lose their per-path name under memory pressure:
  // they are reconstructible from the recorded scope plus the ignore rules.
  const AGGREGATABLE = new Set(['ignore-rule', 'builtin-exclusion']);
  const RETAIN_BUDGET = 20000, MAX_PATHS = 200000, MAX_SCOPES = 4000;

  function normalize(value) {
    return String(value == null ? '' : value).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  }

  function indexOf(ledger) {
    let index = ledger.__index;
    if (!index) {
      index = new Map();
      for (const entry of ledger.paths) index.set(entry.path, entry);
      // Non-enumerable so the ledger stays plain JSON when it lands in meta.
      Object.defineProperty(ledger, '__index', { value: index, enumerable: false, configurable: true });
    }
    return index;
  }

  function create(options = {}) {
    const mode = options.mode === 'complete' || options.mode === 'preview' ? options.mode : null;
    return {
      schema: 'skylense-source-accounting-v1',
      sourceKind: options.sourceKind ? String(options.sourceKind) : 'unknown',
      revision: options.revision == null ? null : String(options.revision),
      ref: options.ref == null ? null : String(options.ref),
      mode,
      requestedMode: mode,
      paths: [],
      // Exact totals for every discovered path, keyed state\0reason\0rule.
      aggregate: {},
      scopes: [],
      // Paths the transport knows it never enumerated. A non-empty remainder
      // means discovery itself was incomplete, so no 100% accounting claim.
      unenumerated: [],
      // Acquisition state; `assertComplete` reads it so a partial can never be
      // published or labelled as a complete analysis.
      acquisition: { state: 'complete', reasons: [] },
      retainBudget: Number.isInteger(options.retainBudget) && options.retainBudget > 0 ? Math.min(options.retainBudget, MAX_PATHS) : RETAIN_BUDGET,
      detailDropped: 0,
      notes: [],
    };
  }

  function reasonFor(reason, detail) {
    const key = ALIASES[reason] || reason;
    const resolved = REASONS[key] ? key : 'unreadable';
    const out = { reason: resolved, state: REASONS[resolved] };
    if (detail && typeof detail === 'object') {
      if (detail.source) out.rule = String(detail.source);
      // An ignored scope is a range, not a file. A rule that matched an ancestor
      // directory excludes that whole directory; a rule that matched the path
      // itself belongs to the directory its ignore file governs.
      out.scope = detail.ancestor || detail.directory ? normalize(detail.path) : normalize(detail.base || '');
      if (detail.pattern) out.pattern = String(detail.pattern);
    } else if (resolved === 'builtin-exclusion') {
      // The built-in policy is itself an exclusion scope, so it gets one listed
      // bucket with a count rather than disappearing into a bare state.
      out.scope = '';
    }
    return out;
  }

  function bump(ledger, state, reason, rule) {
    const key = `${state}\u0000${reason}\u0000${rule || ''}`;
    ledger.aggregate[key] = (ledger.aggregate[key] || 0) + 1;
  }

  function unbump(ledger, entry) {
    const key = `${entry.state}\u0000${entry.reason}\u0000${entry.rule || ''}`;
    if (ledger.aggregate[key] > 1) ledger.aggregate[key]--; else delete ledger.aggregate[key];
  }

  function record(ledger, filePath, options = {}) {
    if (!ledger || !Array.isArray(ledger.paths)) throw new TypeError('record needs a ledger created by SkylenseSourceAccounting.create.');
    const path = normalize(filePath);
    if (!path) return null;
    // A path from a remote listing or an archive is untrusted text. One that is
    // absolute or climbs out of the selected root is refused with its own reason
    // rather than recorded as an ordinary member of the source.
    const segments = path.split('/');
    const unsafe = /^([a-zA-Z]:)?\//.test(String(filePath).replace(/\\/g, '/')) || segments.includes('..');
    const reason = unsafe ? 'outside-selected-subpath' : options.reason ? String(options.reason) : null;
    const state = unsafe ? 'excluded' : options.state ? String(options.state) : reason && REASONS[reason] ? REASONS[reason] : null;
    if (!reason) throw new Error(`Accounting entry for ${path} needs a reason; a bare state is not accounting.`);
    if (!STATE_SET.has(state)) throw new Error(`Accounting state must be one of ${STATES.join(', ')}; received ${JSON.stringify(options.state ?? reason)}.`);
    const index = indexOf(ledger);
    const existing = index.get(path);
    // Only an explicitly supplied kind replaces one: the model builder folds in
    // an outcome for a path the traversal already classified, and a directory must
    // not become a file just because the later caller had nothing better to say.
    const explicitKind = options.sourceKind && KIND_SET.has(options.sourceKind) ? options.sourceKind : null;
    const sourceKind = explicitKind || (existing && existing.sourceKind) || (ledger.sourceKind === 'git' ? 'git-blob' : 'file');
    const entry = { path, state, reason, sourceKind };
    if (Number.isFinite(options.bytes)) entry.bytes = options.bytes;
    if (options.rule) entry.rule = String(options.rule);
    if (options.scope != null) entry.scope = normalize(options.scope);
    if (options.detail) entry.detail = String(options.detail).slice(0, 400);
    if (unsafe) { entry.unsafePath = true; entry.detail = 'The listing named a path outside the selected source root; it was refused, not read.'; }

    if (existing) {
      // A path reaches exactly one terminal state. Re-recording the same state is
      // idempotent; a conflicting one is a traversal bug, not something to average.
      if (existing.state === state && existing.reason === reason) return existing;
      if (!options.authoritative) throw new Error(`Path ${path} already reached terminal state ${existing.state} (${existing.reason}); refusing to also record ${state} (${reason}).`);
      // The model builder's outcome for an accepted file supersedes the
      // discovery-time classification; the totals move with it.
      unbump(ledger, existing);
      bump(ledger, state, reason, entry.rule);
      Object.assign(existing, entry);
      return existing;
    }
    bump(ledger, state, reason, entry.rule);
    // Every plain ignore match also lands in its scope bucket, so an exclusion
    // range stays visible and countable even when its path names are aggregated.
    if (state === 'excluded' && entry.scope !== undefined) {
      const bucket = scope(ledger, entry.scope, { kind: reason === 'ignore-rule' ? 'ignored' : reason, rule: entry.rule, source: entry.rule, pattern: options.pattern });
      if (bucket) bucket.count++;
    }
    const aggregatable = state === 'excluded' && AGGREGATABLE.has(reason);
    if (ledger.paths.length >= MAX_PATHS || (aggregatable && ledger.paths.length >= ledger.retainBudget)) { ledger.detailDropped++; return null; }
    ledger.paths.push(entry);
    index.set(path, entry);
    return entry;
  }

  /** An ignored range, listed on its own so exclusions stay auditable and adjustable. */
  function scope(ledger, scopePath, options = {}) {
    if (!ledger || !Array.isArray(ledger.scopes)) throw new TypeError('scope needs a ledger created by SkylenseSourceAccounting.create.');
    const path = normalize(scopePath), kind = options.kind ? String(options.kind) : 'ignored';
    const rule = options.rule ? String(options.rule) : null;
    const pattern = options.pattern ? String(options.pattern).slice(0, 200) : null;
    let scopeIndex = ledger.__scopes;
    const keyOf = item => `${item.path}\u0000${item.kind}\u0000${item.rule || ''}\u0000${item.pattern || ''}`;
    if (!scopeIndex) {
      scopeIndex = new Map(ledger.scopes.map(item => [keyOf(item), item]));
      Object.defineProperty(ledger, '__scopes', { value: scopeIndex, enumerable: false, configurable: true });
    }
    const key = keyOf({ path, kind, rule, pattern });
    const existing = scopeIndex.get(key);
    if (existing) return existing;
    if (ledger.scopes.length >= MAX_SCOPES) { ledger.detailDropped++; return null; }
    const entry = { path, kind, rule, source: options.source ? String(options.source) : null, count: 0 };
    if (pattern) entry.pattern = pattern;
    if (options.note) entry.note = String(options.note).slice(0, 200);
    ledger.scopes.push(entry);
    scopeIndex.set(key, entry);
    return entry;
  }

  /** Paths the transport knows it stopped enumerating. Count may be unknown. */
  function unenumerated(ledger, reason, options = {}) {
    if (!ledger || !Array.isArray(ledger.unenumerated)) throw new TypeError('unenumerated needs a ledger created by SkylenseSourceAccounting.create.');
    const key = ALIASES[reason] || reason;
    const resolved = REASONS[key] ? key : 'acquisition-partial';
    const count = Number.isFinite(options.count) ? options.count : null;
    const scopePath = options.scope == null ? null : normalize(options.scope);
    if (!ledger.unenumerated.some(item => item.reason === resolved && item.scope === scopePath)) {
      ledger.unenumerated.push({ reason: resolved, count, scope: scopePath, ...(options.detail ? { detail: String(options.detail).slice(0, 400) } : {}) });
    }
    partial(ledger, resolved, options.detail);
    return ledger;
  }

  function partial(ledger, reason, detail) {
    if (!ledger || !ledger.acquisition) throw new TypeError('partial needs a ledger created by SkylenseSourceAccounting.create.');
    const key = ALIASES[reason] || reason;
    const resolved = REASONS[key] ? key : 'acquisition-partial';
    const note = detail ? String(detail).slice(0, 400) : null;
    ledger.acquisition.state = 'partial';
    if (!ledger.acquisition.reasons.some(item => item.reason === resolved && (item.detail || null) === note)) {
      ledger.acquisition.reasons.push({ reason: resolved, ...(note ? { detail: note } : {}) });
    }
    return ledger;
  }

  /** Resolve a symlink target against the selected root. Escapes are refused, never followed. */
  function linkDecision(options = {}) {
    const linkPath = normalize(options.linkPath), target = String(options.target ?? '');
    const escapes = (() => {
      if (!target) return true;
      if (/^[a-zA-Z]:[\\/]/.test(target) || target.startsWith('/')) return true;
      const parts = linkPath.split('/').filter(Boolean).slice(0, -1);
      for (const segment of target.replace(/\\/g, '/').split('/')) {
        if (!segment || segment === '.') continue;
        if (segment === '..') { if (!parts.length) return true; parts.pop(); continue; }
        parts.push(segment);
      }
      return false;
    })();
    return {
      sourceKind: options.sourceKind && KIND_SET.has(options.sourceKind) ? options.sourceKind : 'symlink',
      state: 'excluded',
      reason: escapes ? 'symlink-escapes-source-root' : 'symlink-not-followed',
      escapes,
      refused: true,
      target: target.slice(0, 400),
    };
  }

  function emptySummary(reason, note) {
    return {
      accountingComplete: false, snapshotComplete: false, reason,
      discovered: 0, accounted: 0, unaccounted: 0,
      states: Object.fromEntries(STATES.map(state => [state, 0])), reasons: {},
      scopes: [], unenumerated: [],
      pathDetail: { retained: 0, dropped: 0, complete: false, budget: RETAIN_BUDGET },
      parse: { eligible: 0, parsed: 0, failed: 0, metadataOnly: 0, pending: 0, successRate: null },
      acquisition: { state: 'unknown', reasons: [] },
      claims: { accounting: note, parseSuccess: 'No parse-eligible paths were accounted, so there is no parse success rate to report.', snapshot: 'This must not be published or labelled as a complete analysis.' },
    };
  }

  function summarize(ledger) {
    if (!ledger || !Array.isArray(ledger.paths) || !ledger.aggregate) {
      return emptySummary('discovery-ledger-missing', 'No acquisition ledger was supplied, so this report does not claim complete source accounting.');
    }
    const states = Object.fromEntries(STATES.map(state => [state, 0])), reasons = {};
    let discovered = 0;
    for (const [key, count] of Object.entries(ledger.aggregate)) {
      const [state, reason] = key.split('\u0000');
      discovered += count;
      if (states[state] !== undefined) states[state] += count;
      reasons[reason] = (reasons[reason] || 0) + count;
    }
    const knownRemainder = ledger.unenumerated.reduce((sum, item) => sum + (Number.isFinite(item.count) ? item.count : 0), 0);
    const unknownRemainder = ledger.unenumerated.some(item => !Number.isFinite(item.count));
    const accountingComplete = ledger.unenumerated.length === 0;
    // Parse-eligible = accounted minus the ranges nobody asked us to read.
    const eligible = discovered - states.excluded, parsed = states.parsed;
    const successRate = eligible > 0 ? Math.round((parsed / eligible) * 1e4) / 1e4 : null;
    const snapshotComplete = accountingComplete && states.pending === 0 && ledger.acquisition.state === 'complete';
    return {
      accountingComplete, snapshotComplete,
      discovered, accounted: discovered,
      unaccounted: unknownRemainder ? null : knownRemainder,
      states, reasons,
      scopes: ledger.scopes.map(item => ({ ...item })),
      unenumerated: ledger.unenumerated.map(item => ({ ...item })),
      pathDetail: { retained: ledger.paths.length, dropped: ledger.detailDropped, complete: ledger.detailDropped === 0, budget: ledger.retainBudget },
      parse: { eligible, parsed, failed: states.failed, metadataOnly: states['metadata-only'], pending: states.pending, successRate },
      acquisition: { state: ledger.acquisition.state, reasons: ledger.acquisition.reasons.map(item => ({ ...item })) },
      claims: {
        accounting: accountingComplete
          ? `All ${discovered} discovered paths carry one terminal state with a reason${ledger.detailDropped ? `; ${ledger.detailDropped} plain ignore matches are counted under their scope instead of by name` : ''}.`
          : `Discovery stopped early (${[...new Set(ledger.unenumerated.map(item => item.reason))].join(', ')}), so ${discovered} accounted paths are not the whole source and this report does not claim complete accounting.`,
        parseSuccess: successRate === null
          ? 'No parse-eligible paths were discovered, so there is no parse success rate to report.'
          : `${parsed} of ${eligible} parse-eligible paths parsed (${(successRate * 100).toFixed(1)}%). Complete accounting is not parse success.`,
        snapshot: snapshotComplete
          ? 'Acquisition finished without hitting a limit, so this may be published as a complete snapshot.'
          : 'Acquisition is partial; this must not be published or labelled as a complete analysis.',
        scopes: ledger.scopes.length
          ? `${ledger.scopes.length} ignored scopes are listed with their rule and count; adjust the rules to include them rather than treating them as absent.`
          : 'No ignored scopes were applied.',
      },
    };
  }

  /** Fold the model builder's per-entry outcomes in, then attach the summary. */
  function finalize(ledger, options = {}) {
    const files = Array.isArray(options.files) ? options.files : [];
    const target = ledger && Array.isArray(ledger.paths) && ledger.aggregate ? ledger : null;
    if (target) {
      if (options.mode) target.mode = options.mode;
      for (const file of files) if (file && file.path) record(target, file.path, { ...file, authoritative: true });
      for (const reason of options.partialReasons || []) partial(target, reason);
      return { ...target, summary: summarize(target) };
    }
    // No ledger from the transport: report the gap instead of inventing coverage.
    const fallback = create({ sourceKind: options.sourceKind, mode: options.mode });
    for (const file of files) if (file && file.path) record(fallback, file.path, { ...file, authoritative: true });
    unenumerated(fallback, 'acquisition-partial', { detail: 'transport supplied no discovery ledger' });
    const summary = summarize(fallback);
    summary.reason = 'discovery-ledger-missing';
    summary.claims.accounting = 'The acquisition layer supplied no discovery ledger, so excluded and skipped paths are not individually accounted.';
    return { ...fallback, summary };
  }

  /** Gate used before any "complete" claim. Throws instead of publishing a partial. */
  function assertComplete(ledger, label) {
    const summary = ledger && ledger.summary ? ledger.summary : summarize(ledger);
    if (!summary.accountingComplete) throw Object.assign(new Error(`${label || 'This source'} cannot be published as complete: ${summary.claims.accounting}`), { code: 'INCOMPLETE_ACCOUNTING', summary });
    if (!summary.snapshotComplete) {
      const reasons = [...new Set(summary.acquisition.reasons.map(item => item.reason).concat(summary.states.pending ? ['pending-paths'] : []))];
      throw Object.assign(new Error(`${label || 'This source'} cannot be published as complete: acquisition is partial (${reasons.join(', ') || 'unknown reason'}).`), { code: 'INCOMPLETE_ACQUISITION', summary });
    }
    return summary;
  }

  /** A partial acquisition, or an explicitly requested preview, is never "complete". */
  function acquisitionMode(ledger, requestedMode) {
    if (requestedMode === 'preview') return 'preview';
    const summary = ledger && ledger.summary ? ledger.summary : summarize(ledger);
    return summary.snapshotComplete && summary.accountingComplete ? 'complete' : 'preview';
  }

  root.SkylenseSourceAccounting = Object.freeze({
    STATES, SOURCE_KINDS, REASONS,
    create, record, scope, partial, unenumerated, reasonFor, linkDecision,
    summarize, finalize, assertComplete, acquisitionMode,
    limits: { retainBudget: RETAIN_BUDGET, maxPaths: MAX_PATHS, maxScopes: MAX_SCOPES },
  });
})(typeof window !== 'undefined' ? window : globalThis);
