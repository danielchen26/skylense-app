/* Shared incremental syntax index. Source is data; only bundled grammars execute. */
(function (root) {
  "use strict";
  const REVISION = "skylense-ast-2";
  /* Stored cache entry envelope. Bumping it retires every entry written by an
     earlier shape instead of hoping the old shape still validates. */
  const FORMAT = "skylense-syntax-entry/1";
  const grammarNames = { python: "python", javascript: "javascript", typescript: "typescript", julia: "julia", go: "go", rust: "rust", java: "java", c: "c", cpp: "cpp", csharp: "c_sharp", ruby: "ruby", php: "php", swift: "swift", kotlin: "kotlin", shell: "bash", lua: "lua", scala: "scala", html: "html", css: "css", json: "json", yaml: "yaml", toml: "toml", vue: "vue" };
  const sourceURL = typeof document !== "undefined" ? document.currentScript?.src || document.baseURI : null;
  let config = {}, initialized, database;
  const parsers = new Map();
  function configure(options) { config = { ...config, ...options }; }
  async function initialize() {
    if (!initialized) initialized = (async () => {
      const base = config.baseURL || new URL("../parsers/", sourceURL).href;
      let runtime = config.runtime;
      const embedded = root.SKYLENSE_PARSER_ASSETS;
      if (!runtime && embedded) {
        const source = new TextDecoder().decode(await decode(embedded, "tree-sitter.mjs"));
        const blob = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
        try { runtime = await import(blob); } finally { URL.revokeObjectURL(blob); }
      }
      if (!runtime) runtime = await import(new URL("tree-sitter.mjs", base).href);
      const bytes = config.loadBytes || (async name => embedded ? decode(embedded, name) : new Uint8Array(await (await fetch(new URL(name, base))).arrayBuffer()));
      await runtime.Parser.init({ wasmBinary: await bytes("tree-sitter.wasm"), locateFile: name => new URL(name, base).href });
      async function loadCompiler() {
        if (config.compiler) return config.compiler;
        if (embedded) {
          const code = new TextDecoder().decode(await decode(embedded, "typescript.js")) + "\nexport default ts;";
          const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
          try { return (await import(url)).default; } finally { URL.revokeObjectURL(url); }
        }
        const response = await fetch(new URL("typescript.js", base));
        if (!response.ok) throw new Error("Could not load the bundled TypeScript semantic resolver.");
        const code = await response.text(), url = URL.createObjectURL(new Blob([code + "\nexport default ts;"], { type: "text/javascript" }));
        try { return (await import(url)).default; } finally { URL.revokeObjectURL(url); }
      }
      return { ...runtime, bytes, loadCompiler };
    })().catch(error => { initialized = null; throw error; });
    return initialized;
  }
  /* standalone.html embeds each parser file gzip-compressed and base64-encoded
     (lib/standalone.mjs parserAssets); inflating it in memory restores the exact
     bytes and reads nothing from the network. */
  async function decode(embedded, name) {
    const value = embedded.encoding === "gzip" ? embedded.files?.[name] : undefined;
    if (typeof value !== "string") throw new Error(`Bundled parser asset ${name} is missing.`);
    const packed = Uint8Array.from(atob(value), c => c.charCodeAt(0));
    return new Uint8Array(await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  }
  /* Browser storage policy: syntax facts only, one IndexedDB store, keys
     prefixed by scope so the selected project is the unit a user can clear.
     `clear` is the control that makes this cache honest to keep. */
  async function browserCache() {
    if (!root.indexedDB) return null;
    if (!database) database = new Promise((resolve, reject) => {
      const open = root.indexedDB.open("skylense-syntax-v1", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("facts");
      open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
    });
    const db = await database;
    const operation = (mode, action) => new Promise((resolve, reject) => {
      const tx = db.transaction("facts", mode), request = action(tx.objectStore("facts"));
      tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
    const scoped = (scope, key) => scopeName(scope) + "\u0000" + key;
    const range = scope => root.IDBKeyRange.bound(scopeName(scope) + "\u0000", scopeName(scope) + "\u0000\uffff");
    return {
      get: (key, scope) => operation("readonly", store => store.get(scoped(scope, key))),
      set: (key, value, scope) => operation("readwrite", store => store.put(value, scoped(scope, key))),
      async clear(selector = {}) {
        const before = await this.status();
        if (selector.all) await operation("readwrite", store => store.clear());
        else await operation("readwrite", store => store.delete(range(selector.scope)));
        const after = await this.status();
        return { scopes: selector.all ? before.scopes : [{ scope: scopeName(selector.scope) }], entries: before.entries - after.entries, bytes: null };
      },
      async status() {
        const keys = await operation("readonly", store => store.getAllKeys());
        const counts = new Map();
        for (const key of keys || []) {
          const scope = String(key).split("\u0000")[0];
          counts.set(scope, (counts.get(scope) || 0) + 1);
        }
        return { kind: "indexeddb", database: "skylense-syntax-v1", entries: (keys || []).length, scopes: [...counts].map(([scope, entries]) => ({ scope, entries })).sort((a, b) => (a.scope < b.scope ? -1 : 1)) };
      },
    };
  }
  const scopeName = scope => (scope == null || scope === "" ? "unscoped" : String(scope));
  /**
   * The clear-cache control that persistent caching requires. `{ all: true }`
   * removes every scope; otherwise exactly the named project scope is removed.
   * Backends that cannot clear say so instead of reporting a silent success.
   */
  async function clearCache(selector = {}) {
    const backend = selector.cache || config.cache || await browserCache();
    if (!backend?.clear) throw new Error("This syntax cache backend does not support clearing.");
    return backend.clear(selector.all ? { all: true } : { scope: scopeName(selector.scope) });
  }
  async function cacheStatus(selector = {}) {
    const backend = selector.cache || config.cache || await browserCache();
    if (!backend?.status) throw new Error("This syntax cache backend does not report status.");
    return backend.status();
  }
  /* Every input the extractor reads, and nothing else. `revision` covers the
     grammar package set, the runtime and the extractor code; `grammar` covers the
     tsx/ts split; `path` is read by the extractor for source-contract file refs;
     `text` is the decoded content. The extractor accepts no caller options, so
     there are none to bind here — an option that changes extracted facts must be
     added to this key at the same time it is added to the extractor. FORMAT binds
     the stored envelope shape so an older entry can never be read as a newer one. */
  async function keyFor(path, grammar, text, revision) {
    const bytes = new TextEncoder().encode(FORMAT + "\0" + revision + "\0" + path + "\0" + grammar + "\0" + text);
    const digest = await root.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  /* A stored entry is untrusted input: it may be truncated, hand-edited, written
     by another version, or left over from an interrupted write. Reusing one that
     merely parses as JSON turns cache corruption into wrong analysis, so an entry
     is only a hit when its envelope matches this request and the facts it carries
     have the shape the extractor produces. */
  function storedFacts(entry, key, revision) {
    if (!entry || typeof entry !== "object" || entry.format !== FORMAT || entry.key !== key || entry.revision !== revision) return null;
    const facts = entry.facts;
    if (!facts || typeof facts !== "object") return null;
    if (facts.parser?.engine !== "tree-sitter") return null;
    if (!Array.isArray(facts.symbols) || !Array.isArray(facts.imports) || !Array.isArray(facts.relationships) || !Array.isArray(facts.diagnostics)) return null;
    if (!facts.structure || typeof facts.structure !== "object" || !Array.isArray(facts.structure.calls)) return null;
    if (typeof facts.status !== "string") return null;
    return facts;
  }
  async function prepare(entries, options = {}) {
    const revision = config.revision || root.SKYLENSE_SYNTAX_VERSION || REVISION;
    /* Cache contents are scoped to the selected project. Sources that do not
       declare a scope share one explicitly named bucket rather than silently
       mixing into whichever project ran last. */
    const scope = scopeName(options.cacheScope);
    const detail = { scope, hits: 0, misses: 0, invalid: 0, stored: 0, declined: 0, readFailures: 0, writeFailures: 0 };
    const report = { engine: "tree-sitter", revision, parsed: 0, reused: 0, unsupported: 0, failed: 0, errors: [], languages: {}, cache: "enabled", cacheDetail: detail };
    let cache = options.cache === false ? null : options.cache || config.cache;
    if (options.cache !== false && !cache) { try { cache = await browserCache(); } catch { report.cache = "unavailable"; } }
    if (!cache) report.cache = options.cache === false ? "disabled" : "unavailable";
    const full = entries.filter(e => typeof e.text === "string");
    for (let i = 0; i < full.length; i++) {
      options.signal?.throwIfAborted();
      const entry = full[i], info = root.SkylenseIngest.classifyPath(entry.path);
      const language = info.language;
      let grammar = grammarNames[language];
      if (/\.[jt]sx$/i.test(entry.path)) grammar = "tsx";
      if (!grammar) { report.unsupported++; continue; }
      options.onProgress?.({ phase: "syntax", completed: i, total: full.length, path: entry.path });
      const key = await keyFor(entry.path, grammar, entry.text, revision);
      let facts = null;
      if (cache) {
        let stored;
        try { stored = await cache.get(key, scope); } catch { report.cache = "degraded"; detail.readFailures++; }
        facts = storedFacts(stored, key, revision);
        if (facts) { detail.hits++; report.reused++; }
        else if (stored === undefined || stored === null) detail.misses++;
        else { detail.invalid++; report.cache = "degraded"; }
      }
      if (!facts) {
        const { Parser, Language, bytes } = await initialize();
        if (!root.SkylenseSyntaxFacts) throw new Error("Syntax extraction module was not loaded.");
        let parser = parsers.get(grammar);
        if (!parser) { const definition = await Language.load(await bytes(`grammars/tree-sitter-${grammar}.wasm`)); parser = new Parser(); parser.setLanguage(definition); parsers.set(grammar, parser); }
        let crashed = null;
        let tree;
        try {
          tree = parser.parse(entry.text);
          if (!tree) throw new Error(`Could not parse ${entry.path}`);
          facts = root.SkylenseSyntaxFacts.extract(tree, entry.text, language, entry.path);
          for (const embedded of facts.embedded || []) {
            const embeddedGrammar = grammarNames[embedded.language];
            if (!embeddedGrammar) continue;
            let embeddedParser = parsers.get(embeddedGrammar);
            if (!embeddedParser) { embeddedParser = new Parser(); embeddedParser.setLanguage(await Language.load(await bytes(`grammars/tree-sitter-${embeddedGrammar}.wasm`))); parsers.set(embeddedGrammar, embeddedParser); }
            let embeddedTree;
            try {
              embeddedTree = embeddedParser.parse(embedded.text);
              const child = root.SkylenseSyntaxFacts.extract(embeddedTree, embedded.text, embedded.language, entry.path);
              const offset = facts.symbols.length, lines = embedded.lineOffset || 0;
              const shifted = value => {
                const copy = { ...value };
                for (const field of ["startIndex", "endIndex", "nameStartIndex", "bodyStartIndex", "bodyEndIndex"]) if (Number.isInteger(copy[field])) copy[field] += embedded.startIndex || 0;
                for (const [line, column] of [["line", "column"], ["nameLine", "nameColumn"], ["endLine", "endColumn"]]) {
                  if (copy[line] === 1 && Number.isInteger(copy[column])) copy[column] += embedded.startColumn || 0;
                  if (Number.isInteger(copy[line])) copy[line] += lines;
                }
                if (Number.isInteger(copy.bodyEndLine)) copy.bodyEndLine += lines;
                if (Number.isInteger(copy.owner)) copy.owner += offset;
                if (copy.sourceContract && root.SkylenseSourceContracts) copy.sourceContract = root.SkylenseSourceContracts.shift(copy.sourceContract, embedded.startIndex || 0, lines, embedded.startColumn || 0, entry.path);
                return copy;
              };
              facts.symbols.push(...child.symbols.map(s => ({ ...shifted(s), index: offset + s.index, parent: Number.isInteger(s.parent) ? s.parent + offset : null })));
              facts.imports.push(...child.imports.map(shifted));
              facts.structure.calls.push(...child.structure.calls.map(call => ({ ...shifted(call), resolution: { kind: "unresolved", reason: "Embedded source call requires project semantic binding" } })));
              if (embeddedTree.rootNode.hasError) facts.diagnostics.push({ kind: "embedded-syntax-error", message: "An embedded source region contains syntax error recovery nodes." });
            } finally { embeddedTree?.delete(); }
          }
          delete facts.embedded;
          if (!Array.isArray(facts.diagnostics)) facts.diagnostics = [];
          if (tree.rootNode.hasError) facts.diagnostics = [...(facts.diagnostics || []), { kind: "syntax-error", message: "The syntax tree contains error recovery nodes; affected relationships may be incomplete." }];
        } catch (error) {
          /* A grammar that throws is this file's failure, not the run's. Before this,
             one shell script containing `[[ … ]]` aborted the analysis of an entire
             repository. The file stays accounted for and falls back to the lexical
             reader; the exception is recorded against its path with a reason.
             The parser instance is discarded because a scanner that threw mid-parse
             leaves its WASM instance in a state the next file would inherit. */
          if (error?.name === "AbortError") throw error;
          parsers.delete(grammar);
          crashed = { kind: "grammar-failure", grammar, message: String(error?.message || error).slice(0, 300) };
        } finally { tree?.delete(); }
        if (crashed) {
          report.failed++;
          report.errors.push({ path: entry.path, ...crashed });
          options.onProgress?.({ phase: "syntax", completed: i + 1, total: full.length, path: entry.path });
          continue;
        }
        report.parsed++;
        /* A failed write is degraded persistence and a declined write is the
           storage policy refusing an oversized entry. Neither is a reuse, and
           both mean the next run parses this file again. */
        if (cache) {
          try { if (await cache.set(key, { format: FORMAT, revision, key, facts }, scope) === false) detail.declined++; else detail.stored++; }
          catch { report.cache = "degraded"; detail.writeFailures++; }
        }
      }
      entry.syntaxFacts = structuredClone(facts);
      for (const issue of facts.diagnostics || []) report.errors.push({ path: entry.path, ...issue });
      report.languages[language] = (report.languages[language] || 0) + 1;
      options.onProgress?.({ phase: "syntax", completed: i + 1, total: full.length, path: entry.path });
    }
    if (root.SkylenseJuliaSemantic) report.juliaSemantic = root.SkylenseJuliaSemantic.enrich(entries);
    if (root.SkylenseTypeScriptSemantics) {
      const needsCompiler = entries.some(e => /\.[cm]?[jt]sx?$/.test(e.path) && e.syntaxFacts);
      if (needsCompiler) {
        const { loadCompiler } = await initialize();
        /* Precise binding is an upgrade over the lexical layer, never a precondition for
           it. The bundled checker overflows its own stack on some real inputs — observed
           on this repository's vendored `parsers/typescript.js` — and losing every
           relation in the repository because the precise pass gave up is the wrong
           trade. The failure is recorded, and the lexical candidates already extracted
           above stand. */
        try {
          report.semantic = await root.SkylenseTypeScriptSemantics.analyze(entries, { ...options, loadCompiler });
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          report.semantic = { engine: "typescript", status: "failed", reason: String(error?.message || error).slice(0, 300), bindings: 0 };
          report.errors.push({ path: null, kind: "semantic-failure", engine: "typescript", message: report.semantic.reason });
        }
      }
    }
    return report;
  }
  root.SkylenseSyntax = { configure, prepare, clearCache, cacheStatus, revision: REVISION, languages: Object.keys(grammarNames) };
})(typeof window !== "undefined" ? window : globalThis);
