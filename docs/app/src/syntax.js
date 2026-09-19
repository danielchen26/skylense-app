/* Shared incremental syntax index. Source is data; only bundled grammars execute. */
(function (root) {
  "use strict";
  const REVISION = "skylense-ast-2";
  const grammarNames = { python: "python", javascript: "javascript", typescript: "typescript", julia: "julia", go: "go", rust: "rust", java: "java", c: "c", cpp: "cpp", csharp: "c_sharp", ruby: "ruby", php: "php", swift: "swift", kotlin: "kotlin", shell: "bash", lua: "lua", scala: "scala", html: "html", css: "css", json: "json", yaml: "yaml", yml: "yaml", toml: "toml", vue: "vue" };
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
        const source = new TextDecoder().decode(decode(embedded["tree-sitter.mjs"]));
        const blob = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
        try { runtime = await import(blob); } finally { URL.revokeObjectURL(blob); }
      }
      if (!runtime) runtime = await import(new URL("tree-sitter.mjs", base).href);
      const bytes = config.loadBytes || (async name => embedded ? decode(embedded[name]) : new Uint8Array(await (await fetch(new URL(name, base))).arrayBuffer()));
      await runtime.Parser.init({ wasmBinary: await bytes("tree-sitter.wasm"), locateFile: name => new URL(name, base).href });
      async function loadCompiler() {
        if (config.compiler) return config.compiler;
        if (embedded) {
          const code = new TextDecoder().decode(decode(embedded["typescript.js"])) + "\nexport default ts;";
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
  function decode(value) {
    if (typeof value !== "string") throw new Error("Bundled grammar asset is missing.");
    return Uint8Array.from(atob(value), c => c.charCodeAt(0));
  }
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
    return { get: key => operation("readonly", store => store.get(key)), set: (key, value) => operation("readwrite", store => store.put(value, key)) };
  }
  async function keyFor(path, language, text, revision) {
    const bytes = new TextEncoder().encode(revision + "\0" + path + "\0" + language + "\0" + text);
    const digest = await root.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  async function prepare(entries, options = {}) {
    const revision = config.revision || root.SKYLENSE_SYNTAX_VERSION || REVISION;
    const report = { engine: "tree-sitter", revision, parsed: 0, reused: 0, unsupported: 0, errors: [], languages: {}, cache: "enabled" };
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
      let facts;
      if (cache) { try { facts = await cache.get(key); } catch { report.cache = "degraded"; } }
      if (facts?.cacheRevision === revision && facts?.parser?.engine === "tree-sitter") report.reused++;
      else {
        const { Parser, Language, bytes } = await initialize();
        if (!root.SkylenseSyntaxFacts) throw new Error("Syntax extraction module was not loaded.");
        let parser = parsers.get(grammar);
        if (!parser) { const definition = await Language.load(await bytes(`grammars/tree-sitter-${grammar}.wasm`)); parser = new Parser(); parser.setLanguage(definition); parsers.set(grammar, parser); }
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
                return copy;
              };
              facts.symbols.push(...child.symbols.map(s => ({ ...shifted(s), index: offset + s.index, parent: Number.isInteger(s.parent) ? s.parent + offset : null })));
              facts.imports.push(...child.imports.map(shifted));
              facts.structure.calls.push(...child.structure.calls.map(call => ({ ...shifted(call), resolution: { kind: "unresolved", reason: "Embedded source call requires project semantic binding" } })));
              if (embeddedTree.rootNode.hasError) facts.diagnostics.push({ kind: "embedded-syntax-error", message: "An embedded source region contains syntax error recovery nodes." });
            } finally { embeddedTree?.delete(); }
          }
          delete facts.embedded;
          facts.cacheRevision = revision;
          if (tree.rootNode.hasError) facts.diagnostics = [...(facts.diagnostics || []), { kind: "syntax-error", message: "The syntax tree contains error recovery nodes; affected relationships may be incomplete." }];
        } finally { tree?.delete(); }
        report.parsed++;
        if (cache) { try { await cache.set(key, facts); } catch { report.cache = "degraded"; } }
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
        report.semantic = await root.SkylenseTypeScriptSemantics.analyze(entries, { ...options, loadCompiler });
      }
    }
    return report;
  }
  root.SkylenseSyntax = { configure, prepare, revision: REVISION, languages: Object.keys(grammarNames) };
})(typeof window !== "undefined" ? window : globalThis);
