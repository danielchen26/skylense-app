/* Shared root ignore rules. Glob matching is bounded and does not compile input
   into executable regex. Nested ignore files are deliberately not interpreted. */
(function (root) {
  'use strict';
  const MAX_RULES = 2000, MAX_PATTERN = 1024;
  function compile(text) {
    if (typeof text !== 'string') return [];
    const rules = [];
    for (let line of text.split(/\r?\n/).slice(0, 10000)) {
      // Git ignores unescaped trailing spaces; a backslash preserves one.
      line = line.replace(/(?<!\\) +$/, '');
      if (!line || line.startsWith('#')) continue;
      const negated = line.startsWith('!'); if (negated) line = line.slice(1);
      if (!line || line.length > MAX_PATTERN) continue;
      const directoryOnly = line.endsWith('/'); if (directoryOnly) line = line.slice(0, -1);
      const anchored = line.startsWith('/'); if (anchored) line = line.slice(1);
      if (!line) continue;
      const segments = line.split('/');
      rules.push({ negated, directoryOnly, anchored: anchored || segments.length > 1, segments });
      if (rules.length >= MAX_RULES) break;
    }
    return rules;
  }
  function segmentMatch(pattern, value) {
    // Memoized glob states avoid exponential backtracking on **/** or *a*a*.
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
        // A trailing slash-star-star means contents, not the parent directory.
        result = p === patterns.length - 1 && p > 0 ? v < parts.length : match(p + 1, v) || (v < parts.length && match(p, v + 1));
      }
      else result = v < parts.length && segmentMatch(patterns[p], parts[v]) && match(p + 1, v + 1);
      memo.set(key, result); return result;
    }
    return match(0, 0);
  }
  function matches(rules, path, directory = false) {
    const parts = String(path).replace(/\\/g, '/').split('/').filter(Boolean);
    if (!parts.length) return false;
    // A file cannot be re-included while its ancestor directory remains excluded,
    // matching the behavior of a directory walker and Git's ignore contract.
    for (let length = 1; length <= parts.length; length++) {
      const current = parts.slice(0, length), isDirectory = length < parts.length || directory;
      let excluded = false;
      for (const rule of rules) {
        if (rule.directoryOnly && !isDirectory) continue;
        const hit = rule.anchored ? pathMatch(rule.segments, current) : segmentMatch(rule.segments[0], current.at(-1));
        if (hit) excluded = !rule.negated;
      }
      if (excluded) return true;
    }
    return false;
  }
  root.SkylenseIgnore = Object.freeze({ compile, matches, limits: { maxRules: MAX_RULES, maxPattern: MAX_PATTERN } });
})(typeof window !== 'undefined' ? window : globalThis);
