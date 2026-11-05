/* Shared ignore rules. Globs are bounded and never compiled into executable regex.

   Documented precedence, applied by `resolve` and identical for every transport:
   1. A path is excluded if it matches an exclusion rule, or if any ancestor
      directory of it is excluded. An excluded directory cannot be re-included
      from inside, matching Git's rule.
   2. Among the rules that match one path, the winner is the rule from the
      deepest ignore-file base. A nested `.gitignore` therefore overrides a
      shallower one, including overriding it with a negation.
   3. Rules from the same base are resolved last-one-wins, so a later line in a
      file overrides an earlier line.
   Precedence never depends on the order in which ignore files were read, because
   the browser, provider and filesystem transports discover them in different
   orders. Rule truncation is reported, never applied silently. */
(function (root) {
  'use strict';
  const MAX_RULES = 8000, MAX_PATTERN = 1024;
  function compile(text, options = {}) {
    if (typeof text !== 'string') return [];
    const base = String(options.base || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const source = options.source || (base ? `${base}/.gitignore` : '.gitignore');
    const depth = base ? base.split('/').filter(Boolean).length : 0;
    const rules = [];
    let truncated = false;
    for (let line of text.split(/\r?\n/).slice(0, 10000)) {
      line = line.replace(/(?<!\\) +$/, '');
      if (!line || line.startsWith('#')) continue;
      const pattern = line;
      const negated = line.startsWith('!'); if (negated) line = line.slice(1);
      if (!line || line.length > MAX_PATTERN) continue;
      const directoryOnly = line.endsWith('/'); if (directoryOnly) line = line.slice(0, -1);
      const anchored = line.startsWith('/'); if (anchored) line = line.slice(1);
      if (!line) continue;
      const segments = line.split('/');
      if (rules.length >= MAX_RULES) { truncated = true; break; }
      rules.push({ negated, directoryOnly, anchored: anchored || segments.length > 1, segments, base, depth, source, pattern, order: rules.length });
    }
    if (truncated) {
      // Silently dropping rules would quietly change which files are excluded.
      const note = `${source} declares more than ${MAX_RULES} ignore rules; the rules past that limit were not applied and exclusion coverage for this scope is incomplete.`;
      const report = options.report;
      if (report && Array.isArray(report.warnings)) report.warnings.push(note);
      if (report && report.accounting) root.SkylenseSourceAccounting?.partial(report.accounting, 'acquisition-partial', note);
      if (typeof options.onTruncate === 'function') options.onTruncate({ source, base, limit: MAX_RULES, note });
    }
    return rules;
  }
  function segmentMatch(pattern, value) {
    const memo = new Map();
    function match(p, v) {
      const key = p + ':' + v; if (memo.has(key)) return memo.get(key);
      let result;
      if (p === pattern.length) result = v === value.length;
      else if (pattern[p] === '*') result = match(p + 1, v) || (v < value.length && match(p, v + 1));
      else if (pattern[p] === '?') result = v < value.length && match(p + 1, v + 1);
      else if (pattern[p] === '\\' && p + 1 < pattern.length) result = pattern[p + 1] === value[v] && match(p + 2, v + 1);
      else if (pattern[p] === '[') {
        const end = pattern.indexOf(']', p + 1);
        if (end < 0) result = value[v] === '[' && match(p + 1, v + 1);
        else {
          let pos = p + 1, negated = false, selected = false;
          if (pattern[pos] === '!' || pattern[pos] === '^') { negated = true; pos++; }
          for (; pos < end; pos++) {
            if (pos + 2 < end && pattern[pos + 1] === '-') { selected ||= value[v] >= pattern[pos] && value[v] <= pattern[pos + 2]; pos += 2; }
            else selected ||= value[v] === pattern[pos];
          }
          result = v < value.length && (negated ? !selected : selected) && match(end + 1, v + 1);
        }
      } else result = pattern[p] === value[v] && match(p + 1, v + 1);
      memo.set(key, result); return result;
    }
    return match(0, 0);
  }
  function pathMatch(patterns, parts) {
    const memo = new Map();
    function match(p, v) {
      const key = p + ':' + v; if (memo.has(key)) return memo.get(key);
      let result;
      if (p === patterns.length) result = v === parts.length;
      else if (patterns[p] === '**') {
        result = p === patterns.length - 1 && p > 0 ? v < parts.length : match(p + 1, v) || (v < parts.length && match(p, v + 1));
      }
      else result = v < parts.length && segmentMatch(patterns[p], parts[v]) && match(p + 1, v + 1);
      memo.set(key, result); return result;
    }
    return match(0, 0);
  }
  function underBase(parts, base) {
    if (!base) return parts;
    const prefix = base.split('/').filter(Boolean);
    if (parts.length < prefix.length) return null;
    for (let i = 0; i < prefix.length; i++) if (parts[i] !== prefix[i]) return null;
    return parts.slice(prefix.length);
  }
  /** The single precedence implementation. Returns the winning exclusion, or null. */
  function resolve(rules, path, directory = false) {
    const parts = String(path).replace(/\\/g, '/').split('/').filter(Boolean);
    if (!parts.length || !Array.isArray(rules) || !rules.length) return null;
    for (let length = 1; length <= parts.length; length++) {
      const current = parts.slice(0, length), isDirectory = length < parts.length || directory;
      let winner = null, winnerDepth = -1, winnerOrder = -1, position = 0;
      for (const rule of rules) {
        const index = position++;
        const relative = underBase(current, rule.base || '');
        if (!relative || !relative.length) continue;
        if (rule.directoryOnly && !isDirectory) continue;
        const hit = rule.anchored ? pathMatch(rule.segments, relative) : segmentMatch(rule.segments[0], relative.at(-1));
        if (!hit) continue;
        const depth = Number.isInteger(rule.depth) ? rule.depth : (rule.base ? String(rule.base).split('/').filter(Boolean).length : 0);
        const order = Number.isInteger(rule.order) ? rule.order : index;
        // Deeper ignore file wins outright; same base falls back to last line.
        if (depth > winnerDepth || (depth === winnerDepth && order >= winnerOrder)) { winner = rule; winnerDepth = depth; winnerOrder = order; }
      }
      if (winner && !winner.negated) {
        return {
          path: current.join('/'), scope: current.join('/'), source: winner.source || null,
          pattern: winner.pattern || winner.segments.join('/'), base: winner.base || '',
          depth: winnerDepth, excluded: true, ancestor: length < parts.length,
          directory: length < parts.length || directory, directoryRule: !!winner.directoryOnly,
        };
      }
    }
    return null;
  }
  function matches(rules, path, directory = false) { return resolve(rules, path, directory) !== null; }
  /* Reporting variant. A traversal that skips a directory does not always tell us
     the path was a directory, and without that a `build/`-style rule would lose its
     attribution entirely. Retrying as a directory affects reporting only; `matches`
     stays strict so a file is never excluded by a directory-only rule. */
  function matchDetail(rules, path, directory = false) {
    const strict = resolve(rules, path, directory);
    if (strict || directory) return strict;
    const asDirectory = resolve(rules, path, true);
    return asDirectory ? { ...asDirectory, inferredDirectory: true } : null;
  }
  root.SkylenseIgnore = Object.freeze({ compile, matches, matchDetail, resolve, underBase, limits: { maxRules: MAX_RULES, maxPattern: MAX_PATTERN } });
})(typeof window !== 'undefined' ? window : globalThis);
