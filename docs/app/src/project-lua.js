/* Lua project binding from the project's own module declarations.
 *
 * `require "demo.util"` names a module, not a file. The Lua searcher substitutes
 * the name (dots become directory separators) into each `?` template of
 * package.path, in order, and opens the first file that exists. Three project
 * declarations say where modules live, and each is read as data:
 *   rockspec  build.modules / build.install.lua  { ["demo.util"] = "src/demo/util.lua" }
 *             maps a module name straight to a file, relative to the rockspec's
 *             directory (the source directory `luarocks make` builds from).
 *   .luarc.json / .luarc.jsonc  runtime.path  ["src/?.lua", "src/?/init.lua"]
 *             the language server's templates, relative to the workspace (the
 *             directory holding the file); LuaLS's documented default
 *             ["?.lua", "?/init.lua"] applies when the file sets none, but it
 *             only proposes candidates (the Lua runtime never reads .luarc), and
 *             workspace.library directories are searched with the same templates.
 *   package.path = "./src/?.lua;" .. package.path   (a literal assignment in code)
 *             templates relative to the working directory of the process, which
 *             nothing in the snapshot states — so these only ever yield candidates.
 * A require reaches resolved-static only when the rockspec/.luarc declarations in
 * scope yield exactly one existing file, nothing in scope is unread, no Lua file
 * in the project makes package.path reach another file for the module (a
 * computed write, an alias or package passed as a value counts), and none edits
 * package.preload/searchers.
 * With runtime.pathStrict false (LuaLS's default) the server also matches the
 * templates under any subdirectory of the workspace and of each library root,
 * so a second such match keeps it a candidate. Tables nested past 64 levels
 * make the rockspec unread, as does any write to build after its assignment.
 * Nothing is executed: a rockspec is Lua code, and a computed value, a
 * build.platforms override or a non-literal table entry is recorded as unread.
 * References: https://github.com/luarocks/luarocks/wiki/Rockspec-format
 *             https://luals.github.io/wiki/settings/#runtimepath
 *             https://www.lua.org/manual/5.4/manual.html#pdf-package.searchpath
 */
(function (root) {
  "use strict";
  const manifests = root.SkylenseProjectManifests;
  if (!manifests) throw new Error("src/project-manifests.js must load before this family.");
  const { dirOf, joinPath, contains, parseJson } = manifests;

  /* ------------------------------------------------------------- lexer */
  /** Lua tokens with comments dropped: { type: "name"|"string"|"number"|"op", value, line }. */
  function tokenize(text) {
    const tokens = [], source = String(text || "");
    let i = 0, line = 1;
    const bracketAt = /\[(=*)\[/y, nameAt = /[A-Za-z_][A-Za-z0-9_]*/y, numberAt = /(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/y;
    const longBracket = at => { bracketAt.lastIndex = at; const match = bracketAt.exec(source); return match ? match[1].length : -1; };
    while (i < source.length) {
      const char = source[i];
      if (char === "\n") { line++; i++; continue; }
      if (/\s/.test(char)) { i++; continue; }
      if (source.startsWith("--", i)) {
        const level = longBracket(i + 2);
        if (level >= 0) {
          const close = "]" + "=".repeat(level) + "]", end = source.indexOf(close, i + 4 + level);
          const stop = end < 0 ? source.length : end + close.length;
          line += (source.slice(i, stop).match(/\n/g) || []).length; i = stop; continue;
        }
        while (i < source.length && source[i] !== "\n") i++;
        continue;
      }
      if (char === '"' || char === "'") {
        let value = "", j = i + 1, ok = false;
        for (; j < source.length; j++) {
          const c = source[j];
          if (c === "\\") {
            const next = source[++j];
            // Only escapes with one fixed meaning; anything else makes the string non-literal.
            const simple = { n: "\n", t: "\t", "\\": "\\", '"': '"', "'": "'" }[next];
            if (simple === undefined) { value = null; }
            else if (value !== null) value += simple;
            continue;
          }
          if (c === "\n") break;
          if (c === char) { ok = true; break; }
          if (value !== null) value += c;
        }
        tokens.push({ type: ok && value !== null ? "string" : "bad", value, line });
        i = j + 1; continue;
      }
      if (char === "[") {
        const level = longBracket(i);
        if (level >= 0) {
          const close = "]" + "=".repeat(level) + "]", start = i + 2 + level, end = source.indexOf(close, start);
          const body = end < 0 ? source.slice(start) : source.slice(start, end);
          tokens.push({ type: end < 0 ? "bad" : "string", value: body.replace(/^\r?\n/, ""), line });
          line += (body.match(/\n/g) || []).length;
          i = end < 0 ? source.length : end + close.length; continue;
        }
      }
      nameAt.lastIndex = i;
      const name = nameAt.exec(source);
      if (name) { tokens.push({ type: "name", value: name[0], line }); i += name[0].length; continue; }
      numberAt.lastIndex = i;
      const number = numberAt.exec(source);
      if (number) { tokens.push({ type: "number", value: Number(number[0]), line }); i += number[0].length; continue; }
      const op = /^(?:\.\.\.|\.\.|==|~=|<=|>=|::|[-+*/%^#&~|<>=(){}[\];:,.])/.exec(source.slice(i, i + 3));
      tokens.push({ type: "op", value: op ? op[0] : char, line });
      i += op ? op[0].length : 1;
    }
    return tokens;
  }

  /** A value that is not a literal; carries the reason so it can be quoted. */
  class Unread { constructor(reason) { this.reason = reason; } }

  /** Table constructors nested deeper than this make the whole manifest unread. */
  const MAX_DEPTH = 64;
  /** Parse one literal value at `tokens[at]`: string, number, boolean, nil or a
   *  table constructor. Returns `{ value, next }`; a non-literal becomes Unread
   *  and parsing skips to the end of that expression. Throws an Unread past MAX_DEPTH. */
  function literalAt(tokens, at, depth = 0) {
    const token = tokens[at];
    if (!token) return { value: new Unread("the value is missing"), next: at };
    let parsed;
    if (token.type === "string") parsed = { value: token.value, next: at + 1 };
    else if (token.type === "number") parsed = { value: token.value, next: at + 1 };
    else if (token.type === "name" && ["true", "false", "nil"].includes(token.value)) parsed = { value: token.value === "true" ? true : token.value === "false" ? false : null, next: at + 1 };
    else if (token.type === "op" && token.value === "{") {
      if (depth >= MAX_DEPTH) throw new Unread(`line ${token.line} nests tables more than ${MAX_DEPTH} levels deep`);
      parsed = tableAt(tokens, at, depth + 1);
    }
    if (parsed && !isContinuation(tokens[parsed.next])) return parsed;
    return { value: new Unread(`line ${token.line} computes the value instead of writing a literal`), next: skipExpression(tokens, at) };
  }
  /** Does this token continue an expression (so the value before it is not a lone literal)? */
  const isContinuation = token => token && token.type === "op" && ["..", "+", "-", "*", "/", "%", "^", "(", ".", ":", "[", "==", "~=", "<", ">", "<=", ">=", "or", "and"].includes(token.value)
    || token && token.type === "name" && ["or", "and"].includes(token.value);
  /** Skip one expression: to the next `,`/`;`/`}` at depth 0, or a new top-level statement. */
  function skipExpression(tokens, at) {
    let depth = 0, i = at;
    for (; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type === "op" && ["{", "(", "["].includes(token.value)) depth++;
      else if (token.type === "op" && ["}", ")", "]"].includes(token.value)) { if (depth === 0) return i; depth--; }
      else if (depth === 0 && token.type === "op" && [",", ";"].includes(token.value)) return i;
      else if (depth === 0 && i > at && token.type === "name" && tokens[i + 1]?.type === "op" && tokens[i + 1].value === "=" && !isContinuation(tokens[i - 1])) return i;
    }
    return i;
  }
  function tableAt(tokens, at, depth) {
    const keyed = Object.create(null), list = [];
    let i = at + 1;
    while (i < tokens.length && !(tokens[i].type === "op" && tokens[i].value === "}")) {
      const token = tokens[i];
      if (token.type === "op" && [",", ";"].includes(token.value)) { i++; continue; }
      let key = null;
      if (token.type === "op" && token.value === "[") {
        const inner = tokens[i + 1];
        if (inner?.type === "string" && tokens[i + 2]?.value === "]" && tokens[i + 3]?.value === "=") { key = inner.value; i += 4; }
        else { const skipped = skipExpression(tokens, i); keyed[`\0unread${i}`] = new Unread(`line ${token.line} uses a computed table key`); i = skipped; continue; }
      } else if (token.type === "name" && tokens[i + 1]?.type === "op" && tokens[i + 1].value === "=") { key = token.value; i += 2; }
      const parsed = literalAt(tokens, i, depth);
      if (key === null) list.push(parsed.value); else keyed[key] = parsed.value;
      i = Math.max(parsed.next, i + 1);
    }
    const value = list.length && !Object.keys(keyed).length ? list : Object.assign(keyed, list.length ? { "\0list": list } : {});
    return { value, next: i + 1 };
  }

  /**
   * What one rockspec states: `{ readable, modules: [{ module, file, line? }], unread: [reason] }`
   * with files relative to the rockspec's directory.
   */
  function rockspecModules(text) {
    const out = { readable: false, modules: [], unread: [] };
    if (typeof text !== "string") { out.unread.push("the rockspec could not be read"); return out; }
    const tokens = tokenize(text);
    let build;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type !== "name" || tokens[i - 1]?.type === "op" && [".", ":"].includes(tokens[i - 1].value)) continue;
      // _ENV is the rockspec's environment (LuaRocks loads it with load(..., env)), so
      // `_ENV.build = ...` or `_ENV["build"] = ...` after the assignment replaces build too.
      if (build !== undefined && token.value === "_ENV") { build = new Unread(`line ${token.line} writes through _ENV, which can change build`); break; }
      if (token.value !== "build") continue;
      const after = tokens[i + 1];
      if (build === undefined && after?.value === "=" && after.type === "op" && tokens[i + 2]) {
        let parsed;
        try { parsed = literalAt(tokens, i + 2); } catch (error) { if (error instanceof Unread) { build = error; break; } throw error; }
        build = parsed.value;
        i = Math.max(parsed.next, i + 2) - 1;
        continue;
      }
      // The rockspec runs top to bottom: a later write to build replaces or edits what was read.
      if (build !== undefined && after?.type === "op" && ["=", ".", "[", ":", ","].includes(after.value)) {
        build = new Unread(`line ${token.line} changes build after it is assigned`);
        break;
      }
    }
    out.readable = true;
    if (build === undefined) return out;
    if (build instanceof Unread) { out.unread.push(`build is not a literal table (${build.reason})`); return out; }
    if (!build || typeof build !== "object" || Array.isArray(build)) { out.unread.push("build is not a table"); return out; }
    const collectMap = (map, label) => {
      if (map === undefined) return;
      if (map instanceof Unread) { out.unread.push(`${label} is not a literal table (${map.reason})`); return; }
      if (!map || typeof map !== "object" || Array.isArray(map)) { out.unread.push(`${label} is not a table`); return; }
      for (const [module, value] of Object.entries(map)) {
        if (module.startsWith("\0")) { out.unread.push(`${label} has ${value instanceof Unread ? value.reason : "positional entries"}`); continue; }
        if (value instanceof Unread) { out.unread.push(`${label}["${module}"] ${value.reason}`); continue; }
        // A table names C sources compiled into a native module, not a Lua file.
        if (typeof value === "string" && /\.lua$/.test(value)) out.modules.push({ module, file: value, via: label });
        else if (typeof value === "string" && !/\.(?:c|cc|cpp|cxx|m)$/.test(value)) out.unread.push(`${label}["${module}"] = "${value}" is not a .lua file`);
      }
    };
    collectMap(build.modules, "build.modules");
    if (build.install && typeof build.install === "object" && !(build.install instanceof Unread)) collectMap(build.install.lua, "build.install.lua");
    else if (build.install instanceof Unread) out.unread.push(`build.install is not a literal table (${build.install.reason})`);
    if (build.platforms !== undefined) {
      const platforms = build.platforms instanceof Unread || !build.platforms || typeof build.platforms !== "object" ? [] : Object.entries(build.platforms);
      if (build.platforms instanceof Unread || platforms.some(([key, value]) => key.startsWith("\0") || value instanceof Unread || value && typeof value === "object" && (value.modules !== undefined || value.install !== undefined)))
        out.unread.push("build.platforms overrides the module list per platform, and the platform is not evaluated");
    }
    return out;
  }

  /** What one .luarc.json states: `{ readable, templates, defaulted, strict, libraries, unread }`. */
  function luarcPath(text) {
    const data = parseJson(text);
    const out = { readable: false, templates: [], defaulted: false, strict: false, libraries: [], unread: [] };
    if (!data || typeof data !== "object" || Array.isArray(data)) { out.unread.push("the file could not be parsed as JSON"); return out; }
    out.readable = true;
    const setting = key => (data[key] !== undefined ? data[key] : key.split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), data));
    const path = setting("runtime.path");
    if (path === undefined) { out.templates = ["?.lua", "?/init.lua"]; out.defaulted = true; }
    else if (Array.isArray(path) && path.every(item => typeof item === "string")) out.templates = path;
    else out.unread.push("runtime.path is not a list of strings");
    out.strict = setting("runtime.pathStrict") === true;
    const libraries = setting("workspace.library");
    for (const item of Array.isArray(libraries) ? libraries : libraries === undefined ? [] : [libraries]) {
      if (typeof item !== "string") { out.unread.push("workspace.library has a non-string entry"); continue; }
      if (/\$\{|^~|^\/|^[A-Za-z]:/.test(item)) continue; // outside the snapshot: a library there supplies no included file
      out.libraries.push(item);
    }
    return out;
  }

  /** Every write to the searcher path in one Lua file: `package.path = ...`,
   *  `package["path"] = ...`, the same through a `local p = package` alias, and any
   *  other use of `package` as a value (whose writes cannot be followed).
   *  `[{ line, templates: [string], literal: boolean, what }]`. */
  function packagePathAssignments(text) {
    const tokens = tokenize(text), found = [], bases = new Set(["package"]);
    const isOp = (token, value) => token?.type === "op" && token.value === value;
    const afterDot = i => tokens[i - 1]?.type === "op" && [".", ":"].includes(tokens[i - 1].value);
    /** Length of a `<base>.path` / `<base>["path"]` reference at i, else 0. */
    const pathRef = i => {
      if (!(tokens[i]?.type === "name" && bases.has(tokens[i].value)) || afterDot(i)) return 0;
      if (isOp(tokens[i + 1], ".") && tokens[i + 2]?.type === "name" && tokens[i + 2].value === "path") return 3;
      if (isOp(tokens[i + 1], "[") && tokens[i + 2]?.type === "string" && tokens[i + 2].value === "path" && isOp(tokens[i + 3], "]")) return 4;
      return 0;
    };
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type !== "name" || !bases.has(token.value) || afterDot(i)) continue;
      const next = tokens[i + 1], ref = pathRef(i);
      if (ref) {
        if (!isOp(tokens[i + ref], "=")) continue; // a read of package.path
        const parts = [];
        let j = i + ref + 1, literal = true;
        for (;;) {
          const value = tokens[j], inner = pathRef(j);
          if (value?.type === "string") { parts.push(value.value); j++; }
          else if (inner) { parts.push(null); j += inner; }
          else { literal = false; break; }
          if (isOp(tokens[j], "..")) { j++; continue; }
          if (isContinuation(tokens[j])) literal = false;
          break;
        }
        const joined = parts.map(part => (part === null ? "\0" : part)).join("");
        const templates = literal ? joined.split(";").filter(item => item && !item.includes("\0")) : [];
        found.push({ line: token.line, templates, literal, what: literal ? "assigns package.path" : "assigns package.path a computed value" });
        continue;
      }
      if (next?.type === "op" && [".", ":"].includes(next.value)) continue; // another field
      if (isOp(next, "[")) {
        // package[k] = ... with a computed key may be package.path.
        let depth = 0, k = i + 1;
        for (; k < tokens.length; k++) { if (isOp(tokens[k], "[")) depth++; else if (isOp(tokens[k], "]") && --depth === 0) break; }
        if (!(tokens[i + 2]?.type === "string") && isOp(tokens[k + 1], "=")) found.push({ line: token.line, templates: [], literal: false, what: "writes a computed field of package" });
        continue;
      }
      // `local p = package` / `p = package`: follow writes through p.
      const alias = tokens[i - 2];
      if (isOp(tokens[i - 1], "=") && alias?.type === "name" && !afterDot(i - 2) && !isOp(tokens[i - 3], ",") && !isOp(next, ",") && !isContinuation(next)) { bases.add(alias.value); continue; }
      found.push({ line: token.line, templates: [], literal: false, what: "uses package as a value, so a write to package.path through it cannot be followed" });
    }
    return found;
  }

  /** Modules luaL_openlibs stores in package.loaded (Lua 5.4 manual §6; `_G` is not a require name). */
  const STANDARD_LIBRARIES = new Set(["coroutine", "debug", "io", "math", "os", "package", "string", "table", "utf8"]);

  manifests.register({
    id: "project-lua",
    forms: ["lua-require"],
    create(context) {
      const { has, textOf, collect, verdicts, files } = context;
      const { resolved, candidate, unresolved } = verdicts;

      const nearestBy = (list, path) => {
        let best = null;
        for (const item of list) if (contains(item.dir, path) && (!best || item.dir.length > best.dir.length)) best = item;
        return best;
      };

      let rockspecList = null;
      /** One project per directory holding rockspecs, merging every version's map. */
      function rockspecs() {
        if (rockspecList) return rockspecList;
        const byDir = new Map();
        for (const entry of collect(name => name.endsWith(".rockspec"))) {
          const read = rockspecModules(textOf(entry.path));
          const project = byDir.get(entry.dir) || { dir: entry.dir, manifests: [], modules: new Map(), unread: [] };
          project.manifests.push(entry.path);
          project.unread.push(...read.unread.map(reason => `${entry.path}: ${reason}`));
          for (const item of read.modules) {
            const file = joinPath(entry.dir, item.file);
            if (file === null) { project.unread.push(`${entry.path}: ${item.via}["${item.module}"] points outside the snapshot`); continue; }
            const list = project.modules.get(item.module) || [];
            if (!list.some(other => other.file === file)) list.push({ file, quote: `${entry.path} ${item.via}["${item.module}"] = "${item.file}"`, manifest: entry.path });
            project.modules.set(item.module, list);
          }
          byDir.set(entry.dir, project);
        }
        rockspecList = [...byDir.values()];
        return rockspecList;
      }

      let luarcList = null;
      function luarcs() {
        if (luarcList) return luarcList;
        const byDir = new Map();
        for (const entry of collect([".luarc.json", ".luarc.jsonc"])) {
          if (byDir.has(entry.dir)) { byDir.get(entry.dir).unread.push(`${entry.path}: a second language-server configuration in the same directory`); continue; }
          const read = luarcPath(textOf(entry.path));
          const roots = [entry.dir, ...read.libraries.map(item => joinPath(entry.dir, item)).filter(item => item !== null)];
          byDir.set(entry.dir, { dir: entry.dir, path: entry.path, ...read, roots, unread: read.unread.map(reason => `${entry.path}: ${reason}`) });
        }
        luarcList = [...byDir.values()];
        return luarcList;
      }

      const assignments = new Map();
      /** Literal package.path assignments in Lua files under `dir`. */
      function packagePaths(dir) {
        if (assignments.has(dir)) return assignments.get(dir);
        const found = [];
        for (const file of files) {
          if (!/\.lua$/.test(file) || !contains(dir, file)) continue;
          const text = textOf(file);
          if (text === null || !text.includes("package")) continue;
          for (const item of packagePathAssignments(text)) found.push({ ...item, file });
        }
        assignments.set(dir, found);
        return found;
      }

      const searcherEdits = new Map();
      /** Code under `dir` that changes how require searches: `[{ file, line, field, key }]`
       *  (`key` is the literal package.preload key, or null when it is not one). */
      function searcherChanges(dir) {
        if (searcherEdits.has(dir)) return searcherEdits.get(dir);
        const found = [];
        for (const file of files) {
          if (!/\.lua$/.test(file) || !contains(dir, file)) continue;
          const text = textOf(file);
          if (text === null || !/package\s*\.\s*(?:preload|searchers|loaders)/.test(text)) continue;
          const tokens = tokenize(text);
          for (let i = 0; i + 2 < tokens.length; i++) {
            if (!(tokens[i].type === "name" && tokens[i].value === "package" && tokens[i + 1].value === "." && ["preload", "searchers", "loaders"].includes(tokens[i + 2].value))) continue;
            if (tokens[i - 1]?.type === "op" && [".", ":"].includes(tokens[i - 1].value)) continue;
            const field = tokens[i + 2].value, next = tokens[i + 3];
            let key = null;
            if (field === "preload" && next?.value === "." && tokens[i + 4]?.type === "name") key = tokens[i + 4].value;
            else if (field === "preload" && next?.value === "[" && tokens[i + 4]?.type === "string" && tokens[i + 5]?.value === "]") key = tokens[i + 4].value;
            found.push({ file, line: tokens[i].line, field, key });
          }
        }
        searcherEdits.set(dir, found);
        return found;
      }

      const substitute = (template, module) => template.split("?").join(module.replace(/\./g, "/"));
      const quoteList = list => list.map(item => `"${item}"`).join(", ");

      /* ------------------------------------------------------------ resolver */
      return function resolveLua(path, fact) {
        if (!/\.lua$/.test(path)) return null;
        const module = String(fact.specifier || "");
        if (!module || /[\\\0]/.test(module)) return null;
        // The standard libraries are opened into package.loaded before any chunk
        // runs (luaL_openlibs), and require returns package.loaded[name] without
        // searching, so no file of the snapshot is ever loaded for them.
        if (STANDARD_LIBRARIES.has(module))
          return unresolved(`${module} is a Lua standard library, preloaded into package.loaded by the interpreter, so require "${module}" opens no file`, "lua-require-standard-library", { external: { name: module, kind: "standard-library", specifier: module } });
        const rockspec = nearestBy(rockspecs(), path), luarc = nearestBy(luarcs(), path);
        const hits = [], unread = [], extra = [];
        if (rockspec) {
          unread.push(...rockspec.unread);
          for (const item of rockspec.modules.get(module) || []) if (has(item.file)) hits.push({ target: item.file, quote: item.quote, rule: "lua-rockspec-build-module", manifest: item.manifest });
        }
        if (luarc) {
          unread.push(...luarc.unread);
          for (const rootDir of luarc.roots) for (const template of luarc.templates) {
            if (/^(?:\/|~|[A-Za-z]:)/.test(template)) continue;
            const target = joinPath(rootDir, substitute(template, module));
            if (target && has(target)) hits.push({ target, quote: `${luarc.path} runtime.path "${template}"${luarc.defaulted ? " (LuaLS default)" : ""}${rootDir !== luarc.dir ? ` under workspace.library "${rootDir}"` : ""}`, rule: "lua-luarc-runtime-path", manifest: luarc.path, defaulted: luarc.defaulted });
          }
          // LuaLS without pathStrict also accepts the template under any subdirectory
          // of the workspace and of each workspace.library root.
          if (!luarc.strict) for (const template of luarc.templates) {
            if (/^(?:\/|~|[A-Za-z]:)/.test(template)) continue;
            const tail = substitute(template, module).replace(/^\.\//, "");
            for (const file of files) if (luarc.roots.some(rootDir => contains(rootDir, file)) && file.endsWith("/" + tail) && !hits.some(hit => hit.target === file) && !extra.includes(file)) extra.push(file);
          }
        }
        const targets = [...new Set(hits.map(hit => hit.target))].sort();
        const projectDir = [rockspec?.dir, luarc?.dir].filter(item => item !== undefined).sort((a, b) => b.length - a.length)[0] ?? "";
        if (hits.length) {
          // Code that edits the searcher decides before (or instead of) the declared map.
          for (const item of packagePaths(projectDir)) {
            if (!item.literal) { unread.push(`${item.file}:${item.line} ${item.what}, which changes where require searches`); continue; }
            // A literal template matters only if, from either likely working directory, it opens another file.
            const reached = [];
            for (const template of item.templates) {
              if (/^(?:\/|~|[A-Za-z]:)/.test(template)) continue;
              for (const anchor of new Set([dirOf(item.file), projectDir])) {
                const target = joinPath(anchor, substitute(template, module));
                if (target && has(target) && !targets.includes(target) && !reached.includes(target)) reached.push(target);
              }
            }
            if (reached.length) unread.push(`${item.file}:${item.line} assigns package.path, whose templates reach ${reached.join(", ")} for ${module}`);
          }
          for (const item of searcherChanges(projectDir)) if (item.key === null || item.key === module)
            unread.push(`${item.file}:${item.line} changes package.${item.field}${item.key !== null ? `["${item.key}"]` : ""}, which can supply ${module} without opening a file`);
          if (hits.every(hit => hit.defaulted))
            unread.push(`${luarc.path} sets no runtime.path, and LuaLS's default templates describe the editor's search, not the running package.path, whose working directory nothing in the snapshot states`);
        }
        if (targets.length === 1 && !unread.length && !extra.length) {
          const hit = hits.find(item => item.rule === "lua-rockspec-build-module") || hits[0];
          return resolved(targets, hit.rule, { module, declaration: hits.map(item => item.quote).join("; "), manifest: hit.manifest });
        }
        if (targets.length === 1)
          return candidate([...targets, ...extra].sort(), `${hits[0].rule}-${extra.length ? "non-strict" : "unread-declaration"}`, extra.length
            ? `${hits[0].quote} supplies ${targets[0]}, but runtime.pathStrict is not true in ${luarc.path}, so the language server also matches ${extra.join(", ")}`
            : `${hits[0].quote} supplies ${targets[0]}, but ${unread.join("; ")}`);
        if (targets.length > 1)
          return candidate(targets, "lua-require-several-declared-files",
            `${module} is supplied by ${targets.length} files (${hits.map(item => `${item.target} via ${item.quote}`).join("; ")}); the searcher opens the first template that exists, and the declarations do not order these against each other`);

        /* Nothing declared supplies it. A literal package.path template names
           files relative to the working directory, which is not stated, so it
           can only propose candidates: the assigning file's directory and the
           project root are the usual working directories, and neither is proven. */
        const assigned = packagePaths(projectDir);
        const proposals = [];
        for (const item of assigned) for (const template of item.templates) {
          if (/^(?:\/|~|[A-Za-z]:)/.test(template)) continue;
          for (const anchor of new Set([dirOf(item.file), projectDir])) {
            const target = joinPath(anchor, substitute(template, module));
            if (target && has(target) && !proposals.some(other => other.target === target)) proposals.push({ target, item, template });
          }
        }
        const dynamic = assigned.filter(item => !item.literal);
        if (proposals.length)
          return candidate(proposals.map(item => item.target).sort(), "lua-package-path-template",
            `${proposals.map(item => `${item.target} matches package.path template "${item.template}" (${item.item.file}:${item.item.line})`).join("; ")}; package.path templates are opened relative to the working directory of the running process, which nothing in the snapshot states${dynamic.length ? `, and ${dynamic.map(item => `${item.file}:${item.line} ${item.what}`).join(", ")}` : ""}`);
        if (!rockspec && !luarc) return null;
        const declared = [rockspec ? `${rockspec.manifests.join(", ")} build.modules (${quoteList([...rockspec.modules.keys()]) || "none"})` : null, luarc ? `${luarc.path} runtime.path ${quoteList(luarc.templates)}` : null].filter(Boolean).join("; ");
        const rel = module.replace(/\./g, "/");
        const elsewhere = files.filter(file => file === rel + ".lua" || file.endsWith("/" + rel + ".lua") || file === rel + "/init.lua" || file.endsWith("/" + rel + "/init.lua")).sort();
        if (elsewhere.length)
          return candidate(elsewhere, "lua-require-undeclared-module",
            `${module} is not supplied by the declarations in scope (${declared}); ${elsewhere.join(", ")} match${elsewhere.length === 1 ? "es" : ""} only if the running package.path reaches ${elsewhere.length === 1 ? "it" : "them"}, which is not stated${unread.length ? `; also ${unread.join("; ")}` : ""}`);
        return unresolved(`${module} is not supplied by the declarations in scope (${declared}) and no included file matches it, so it comes from an installed rock or the Lua runtime`,
          "lua-require-outside-declared-modules", { external: { name: module, kind: "module", specifier: module } });
      };
    },
  });

  root.SkylenseProjectLua = Object.freeze({ tokenize, rockspecModules, luarcPath, packagePathAssignments });
})(typeof window !== "undefined" ? window : globalThis);
