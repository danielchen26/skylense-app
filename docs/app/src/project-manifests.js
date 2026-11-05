/* Build-manifest reading for project binding.
 *
 * A grammar tells you what a file says; a build manifest tells you which files
 * the compiler is allowed to see. Every reader here is data-only: no manifest,
 * build script or setup module is executed, and nothing outside the snapshot is
 * fetched. A manifest that cannot be parsed yields no source root rather than a
 * guessed one, so a missing rule degrades to the weaker path search that ran
 * before instead of inventing a binding.
 *
 * Families (Python, Julia, JVM, C/C++, Swift, Ruby, PHP, Lua) register one resolver each. A
 * resolver answers with the same verdict vocabulary the rest of the analyzer
 * uses, so a manifest-backed rule and a language rule are comparable:
 *   null                                       unhandled — no rule covers this fact
 *   { status: "resolved",   targets: [one] }    the manifest proves this target
 *   { status: "candidate",  targets: [...] }    the manifest names a module whose
 *                                               members are all possible targets
 *   { status: "unresolved", reason, external? } the rule ran and refused to guess
 * Resolved and unresolved verdicts always carry the rule that produced them. */
(function (root) {
  "use strict";

  const dirOf = path => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
  const baseOf = path => (path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path);
  /** Join a snapshot-relative directory and a relative path, refusing to escape the root. */
  function joinPath(dir, relative) {
    const parts = String(dir || "").split("/").filter(Boolean);
    for (const segment of String(relative || "").replace(/\\/g, "/").split("/")) {
      if (!segment || segment === ".") continue;
      if (segment === "..") { if (!parts.length) return null; parts.pop(); continue; }
      parts.push(segment);
    }
    return parts.join("/");
  }
  /** True when `dir` is `path` itself or one of its ancestors. */
  const contains = (dir, path) => (dir ? path === dir || path.startsWith(dir + "/") : true);

  // ---------------------------------------------------------------------------
  // TOML subset: tables, array-of-tables, dotted keys, strings (basic, literal
  // and multi-line), integers, floats, booleans, arrays and inline tables.
  // Enough for pyproject.toml, Project.toml and Cargo.toml; anything richer is
  // skipped rather than half-read. https://toml.io/en/v1.0.0
  // ---------------------------------------------------------------------------
  function parseToml(text) {
    if (typeof text !== "string") return null;
    const out = {};
    let table = out;
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      let line = lines[index].trim();
      if (!line || line.startsWith("#")) continue;
      const arrayTable = /^\[\[(.+)\]\]$/.exec(line);
      const plainTable = !arrayTable && /^\[(.+)\]$/.exec(line);
      if (arrayTable || plainTable) {
        const keys = splitDotted((arrayTable || plainTable)[1].trim());
        // A document that redefines a key as both a value and a table is not
        // valid TOML. Route it into a scratch table instead of throwing: one
        // malformed manifest must never fail the whole analysis.
        table = keys ? tableAt(out, keys, Boolean(arrayTable)) : {};
        continue;
      }
      const assignment = /^([^=]+)=(.*)$/.exec(line);
      if (!assignment) continue;
      const keys = splitDotted(assignment[1].trim());
      if (!keys) continue;
      let raw = assignment[2].trim();
      // Multi-line values: a bare """/''' body or an array that spans lines.
      const multiline = /^("""|''')/.exec(raw);
      if (multiline) {
        const quote = multiline[1];
        let body = raw.slice(quote.length);
        while (!body.includes(quote) && index + 1 < lines.length) body += "\n" + lines[++index];
        raw = JSON.stringify(body.slice(0, Math.max(0, body.indexOf(quote))).replace(/^\n/, ""));
      } else if (raw.startsWith("[")) {
        // Comments are stripped per line before joining: a `#` inside a
        // multi-line array would otherwise swallow the rest of the file.
        raw = stripComment(raw).trim();
        while (balance(raw) > 0 && index + 1 < lines.length) raw += " " + stripComment(lines[++index].trim()).trim();
      }
      const value = parseTomlValue(raw);
      if (value === undefined) continue;
      const holder = tableAt(table, keys.slice(0, -1), false);
      holder[keys[keys.length - 1]] = value;
    }
    return out;
  }
  /** Walk (creating) the table named by `keys`; `arrayTable` appends a new entry
   *  at the last key. Any step that collides with a non-table value yields a
   *  scratch table, so a malformed manifest loses that table instead of failing
   *  the whole analysis. */
  function tableAt(start, keys, arrayTable) {
    let node = start;
    const walk = keys.slice(0, arrayTable ? -1 : keys.length);
    for (const key of walk) {
      let next = node[key];
      if (Array.isArray(next)) next = next[next.length - 1];
      if (!next || typeof next !== "object") {
        if (key in node && (typeof node[key] !== "object" || node[key] === null)) return {};
        next = node[key] = {};
      }
      node = next;
    }
    if (!arrayTable) return node;
    const last = keys[keys.length - 1];
    if (last === undefined) return {};
    if (!Array.isArray(node[last])) {
      if (last in node) return {};
      node[last] = [];
    }
    const entry = {};
    node[last].push(entry);
    return entry;
  }
  /** Depth of unclosed `[`/`{` outside strings, so a multi-line array is read whole. */
  function balance(text) {
    let depth = 0, quote = null;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quote) { if (char === "\\" && quote === '"') i++; else if (char === quote) quote = null; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === "#") break;
      if (char === "[" || char === "{") depth++;
      else if (char === "]" || char === "}") depth--;
    }
    return depth;
  }
  /** `a.b."c d"` -> ["a", "b", "c d"]; null when the key is malformed. */
  function splitDotted(text) {
    const keys = [];
    let current = "", quote = null, seen = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quote) {
        if (char === "\\" && quote === '"') { current += text[++i] ?? ""; continue; }
        if (char === quote) { quote = null; continue; }
        current += char; continue;
      }
      if (char === '"' || char === "'") { quote = char; seen = true; continue; }
      if (char === ".") { if (!current.trim() && !seen) return null; keys.push(seen ? current : current.trim()); current = ""; seen = false; continue; }
      current += char;
    }
    if (quote) return null;
    // A quoted key may legitimately be empty: setuptools writes the root
    // package directory as `package-dir = {"" = "src"}`.
    if (current.trim() || seen) keys.push(seen ? current : current.trim());
    return keys.length ? keys : null;
  }
  function parseTomlValue(raw) {
    const text = stripComment(raw).trim();
    if (!text) return undefined;
    if (text === "true") return true;
    if (text === "false") return false;
    if (text.startsWith('"') || text.startsWith("'")) return readTomlString(text).value;
    if (text.startsWith("[")) return readTomlArray(text).value;
    if (text.startsWith("{")) return readTomlInline(text).value;
    if (/^[+-]?\d[\d_]*$/.test(text)) return Number(text.replace(/_/g, ""));
    if (/^[+-]?\d[\d_]*\.\d+$/.test(text)) return Number(text.replace(/_/g, ""));
    return text;
  }
  /** Drop a trailing `#` comment that is not inside a string. */
  function stripComment(text) {
    let quote = null;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quote) { if (char === "\\" && quote === '"') i++; else if (char === quote) quote = null; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === "#") return text.slice(0, i);
    }
    return text;
  }
  function readTomlString(text) {
    const quote = text[0];
    let value = "", i = 1;
    for (; i < text.length; i++) {
      const char = text[i];
      if (quote === '"' && char === "\\") {
        const next = text[++i];
        value += next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "\r" : next ?? "";
        continue;
      }
      if (char === quote) { i++; break; }
      value += char;
    }
    return { value, rest: text.slice(i) };
  }
  function readTomlArray(text) {
    const value = [];
    let rest = text.slice(1).trim();
    while (rest && !rest.startsWith("]")) {
      if (rest.startsWith(",")) { rest = rest.slice(1).trim(); continue; }
      if (rest.startsWith('"') || rest.startsWith("'")) { const read = readTomlString(rest); value.push(read.value); rest = read.rest.trim(); continue; }
      if (rest.startsWith("[")) { const read = readTomlArray(rest); value.push(read.value); rest = read.rest.trim(); continue; }
      if (rest.startsWith("{")) { const read = readTomlInline(rest); value.push(read.value); rest = read.rest.trim(); continue; }
      const end = rest.search(/[,\]]/);
      const scalar = (end === -1 ? rest : rest.slice(0, end)).trim();
      if (scalar) value.push(parseTomlValue(scalar));
      rest = end === -1 ? "" : rest.slice(end).trim();
    }
    return { value, rest: rest.replace(/^\]/, "") };
  }
  function readTomlInline(text) {
    const value = {};
    let rest = text.slice(1).trim();
    while (rest && !rest.startsWith("}")) {
      if (rest.startsWith(",")) { rest = rest.slice(1).trim(); continue; }
      const equals = rest.indexOf("=");
      if (equals === -1) break;
      const keys = splitDotted(rest.slice(0, equals).trim());
      rest = rest.slice(equals + 1).trim();
      let parsed;
      if (rest.startsWith('"') || rest.startsWith("'")) { const read = readTomlString(rest); parsed = read.value; rest = read.rest.trim(); }
      else if (rest.startsWith("[")) { const read = readTomlArray(rest); parsed = read.value; rest = read.rest.trim(); }
      else if (rest.startsWith("{")) { const read = readTomlInline(rest); parsed = read.value; rest = read.rest.trim(); }
      else { const end = rest.search(/[,}]/); parsed = parseTomlValue(end === -1 ? rest : rest.slice(0, end)); rest = end === -1 ? "" : rest.slice(end).trim(); }
      if (keys) {
        let node = value;
        for (const key of keys.slice(0, -1)) { if (!node[key] || typeof node[key] !== "object") node[key] = {}; node = node[key]; }
        node[keys[keys.length - 1]] = parsed;
      }
    }
    return { value, rest: rest.replace(/^\}/, "") };
  }

  // ---------------------------------------------------------------------------
  // INI/cfg subset for setup.cfg: sections, `key = value`, and the indented
  // continuation lists setuptools uses for `packages` and `package_dir`.
  // https://setuptools.pypa.io/en/latest/userguide/declarative_config.html
  // ---------------------------------------------------------------------------
  function parseIni(text) {
    if (typeof text !== "string") return null;
    const out = {};
    let section = "", key = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/\s+$/, "");
      if (!line.trim() || /^\s*[#;]/.test(line)) continue;
      const header = /^\[([^\]]+)\]\s*$/.exec(line.trim());
      if (header) { section = header[1].trim(); out[section] = out[section] || {}; key = null; continue; }
      if (/^\s/.test(line) && key) { out[section][key] = out[section][key] ? out[section][key] + "\n" + line.trim() : line.trim(); continue; }
      const assignment = /^([^=:]+)[=:](.*)$/.exec(line);
      if (!assignment) { key = null; continue; }
      out[section] = out[section] || {};
      key = assignment[1].trim();
      out[section][key] = assignment[2].trim();
    }
    return out;
  }
  /** An INI value written as a one-per-line list or a comma-separated list. */
  const iniList = value => String(value || "")
    .split(/[\n,]/).map(item => item.trim()).filter(Boolean);

  // ---------------------------------------------------------------------------
  // JSON tolerant of the comments and trailing commas real compile_commands.json
  // and tsconfig-style files carry.
  // ---------------------------------------------------------------------------
  function parseJson(text) {
    if (typeof text !== "string" || !text.trim()) return null;
    try { return JSON.parse(text); } catch { /* fall through to the tolerant pass */ }
    let out = "", quote = false, escape = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quote) { out += char; if (escape) escape = false; else if (char === "\\") escape = true; else if (char === '"') quote = false; continue; }
      if (char === '"') { quote = true; out += char; continue; }
      if (char === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i++; out += "\n"; continue; }
      if (char === "/" && text[i + 1] === "*") { i += 2; while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++; i++; continue; }
      out += char;
    }
    try { return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1")); } catch { return null; }
  }

  // ---------------------------------------------------------------------------
  // Manifest discovery
  // ---------------------------------------------------------------------------
  /** Every included file whose basename is one of `names`, shallowest first. */
  function collect(paths, names) {
    const wanted = Array.isArray(names) ? new Set(names) : names;
    const match = typeof wanted === "function" ? wanted : name => wanted.has(name);
    const found = [];
    for (const path of paths) {
      const name = baseOf(path);
      if (match(name)) found.push({ path, dir: dirOf(path), name });
    }
    const depth = dir => (dir ? dir.split("/").length : 0);
    return found.sort((a, b) => depth(a.dir) - depth(b.dir) || a.path.localeCompare(b.path));
  }
  /** The manifest in the nearest enclosing directory of `path`; null when none encloses it. */
  function nearest(manifests, path) {
    let best = null;
    for (const manifest of manifests) {
      if (!contains(manifest.dir, path)) continue;
      if (!best || manifest.dir.length > best.dir.length) best = manifest;
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Family registry
  // ---------------------------------------------------------------------------
  const registry = [];
  /** Register one family. `forms` are the import fact forms it answers for;
   *  `create(context)` returns `(path, fact) => verdict|null`. */
  function register(entry) {
    if (!entry || typeof entry.id !== "string" || typeof entry.create !== "function" || !Array.isArray(entry.forms))
      throw new Error("A project-binding family needs { id, forms: [...], create(context) }.");
    const existing = registry.findIndex(item => item.id === entry.id);
    const frozen = Object.freeze({ id: entry.id, forms: Object.freeze([...entry.forms]), create: entry.create });
    if (existing >= 0) registry[existing] = frozen; else registry.push(frozen);
  }
  const families = () => registry.map(entry => ({ id: entry.id, forms: [...entry.forms] }));

  /** Verdict factories bound to one family, so every answer names its own engine. */
  function verdicts(engine) {
    return Object.freeze({
      resolved: (targets, rule, proof) => ({ status: "resolved", targets, engine, rule, ...(proof ? { proof } : {}) }),
      candidate: (targets, rule, reason, proof) => ({ status: "candidate", targets, reason, engine, rule, ...(proof ? { proof } : {}) }),
      conditional: (targets, rule, reason, proof) => ({ status: "candidate", conditional: true, targets, reason, engine, rule, ...(proof ? { proof } : {}) }),
      unresolved: (reason, rule, extra) => ({ status: "unresolved", targets: [], reason, engine, rule, ...extra }),
    });
  }

  /** Bind every registered family to one snapshot. Returns
   *  `[{ id, forms: Set, resolve(path, fact) }]` in registration order. */
  function create(fileMap, helpers = {}) {
    const files = [...fileMap.keys()];
    const base = {
      fileMap, files,
      has: path => Boolean(path) && fileMap.has(path),
      dirOf, baseOf, joinPath, contains,
      joinRelative: helpers.joinRelative || joinPath,
      choose: helpers.choose,
      /** `() => { entries: [{ path, directory }], complete }`: paths the snapshot saw but
       *  did not include (excluded, ignored, unread); null when the caller cannot say. */
      droppedPaths: helpers.droppedPaths || null,
      textOf: path => { const value = fileMap.get(path); return typeof value?.text === "string" ? value.text : null; },
      factsOf: path => { const value = fileMap.get(path); return value?.facts || value?.syntaxFacts || value?.entry?.syntaxFacts || null; },
      languageOf: path => fileMap.get(path)?.node?.language || fileMap.get(path)?.entry?.language || null,
      parseToml, parseIni, iniList, parseJson,
      collect: names => collect(files, names),
      nearest,
    };
    return registry.map(entry => Object.freeze({
      id: entry.id,
      forms: new Set(entry.forms),
      resolve: entry.create(Object.freeze({ ...base, engine: entry.id, verdicts: verdicts(entry.id) })),
    }));
  }

  root.SkylenseProjectManifests = Object.freeze({
    parseToml, parseIni, iniList, parseJson,
    dirOf, baseOf, joinPath, contains, collect, nearest,
    register, families, create,
  });
})(typeof window !== "undefined" ? window : globalThis);
