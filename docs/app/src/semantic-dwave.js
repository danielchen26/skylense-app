/* D-wave structure: config, markdown, notebooks, Vue/HTML resource mapping.
   Never executes page JS, macros or notebook cells. */
(function (root) {
  "use strict";

  function json(text) {
    try { return JSON.parse(text); } catch { return null; }
  }

  function markdownLinks(path, text) {
    const facts = [];
    const re = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    let match;
    while ((match = re.exec(text))) {
      const spec = match[2];
      if (/^(https?:|mailto:|#)/i.test(spec)) {
        facts.push({ form: "md-link", specifier: spec, line: text.slice(0, match.index).split("\n").length, external: true });
      } else {
        facts.push({ form: "md-link", specifier: spec.split("#")[0], line: text.slice(0, match.index).split("\n").length });
      }
    }
    return facts;
  }

  function vueResources(path, text) {
    const facts = [];
    const re = /<(?:script|img|source)[^>]+src=["']([^"']+)["'][^>]*>|<(?:link)[^>]+href=["']([^"']+)["'][^>]*>/gi;
    let match;
    while ((match = re.exec(text))) {
      const spec = match[1] || match[2];
      facts.push({ form: match[0].toLowerCase().includes("script") ? "html-script" : "html-link", specifier: spec, line: text.slice(0, match.index).split("\n").length });
    }
    return facts;
  }

  function notebookCells(path, text) {
    const data = json(text);
    if (!data || !Array.isArray(data.cells)) return { cells: [], facts: [] };
    const cells = data.cells.map((cell, index) => ({
      index,
      kind: cell.cell_type || "code",
      source: Array.isArray(cell.source) ? cell.source.join("") : String(cell.source || ""),
    }));
    return { cells, facts: cells.filter(cell => cell.kind === "markdown").flatMap(cell => markdownLinks(`${path}#cell-${cell.index}`, cell.source)) };
  }

  /** Line (1-based) of every JSON member key, addressed by its key path. Package
   *  manifests are strict JSON, so skipping over strings is enough to give each
   *  declared entry its own span instead of pointing every property at line 1. */
  function jsonKeyLines(text) {
    const lines = new Map(), keys = [], array = [];
    let line = 1, depth = 0, expectKey = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === "\n") { line++; continue; }
      if (c === '"') {
        let end = i + 1;
        while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
        if (expectKey && depth) {
          let key;
          try { key = JSON.parse(text.slice(i, end + 1)); } catch { key = text.slice(i + 1, end); }
          keys[depth - 1] = key;
          lines.set(keys.slice(0, depth).join("\u0000"), line);
          expectKey = false;
        }
        i = end;
        continue;
      }
      if (c === "{" || c === "[") { depth++; array[depth - 1] = c === "["; expectKey = c === "{"; continue; }
      if (c === "}" || c === "]") { depth = Math.max(0, depth - 1); keys.length = depth; expectKey = false; continue; }
      if (c === ",") { expectKey = depth > 0 && !array[depth - 1]; continue; }
      if (c === ":") expectKey = false;
    }
    return lines;
  }

  function configRelations(path, text) {
    const facts = [];
    if (/(?:^|\/)package\.json$/.test(path)) {
      const data = json(text);
      if (!data || typeof data !== "object") return facts;
      const keyLines = jsonKeyLines(text);
      const at = (...keys) => keyLines.get(keys.join("\u0000")) ?? keyLines.get(keys[0]) ?? 1;
      // npm documents both the single-executable string form and the object form of bin.
      // https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#bin
      if (typeof data.bin === "string") {
        const command = typeof data.name === "string" && data.name ? data.name.split("/").pop() : "bin";
        facts.push({ form: "config-bin", specifier: data.bin.replace(/^\.\//, ""), name: command, key: "bin", entry: data.bin, line: at("bin") });
      } else if (data.bin && typeof data.bin === "object" && !Array.isArray(data.bin)) {
        for (const [name, spec] of Object.entries(data.bin)) {
          if (typeof spec === "string") facts.push({ form: "config-bin", specifier: spec.replace(/^\.\//, ""), name, key: `bin.${name}`, entry: spec, line: at("bin", name) });
          else facts.push({ form: "config-bin", specifier: `bin.${name}`, name, key: `bin.${name}`, line: at("bin", name), unresolved: true, reason: `package.json bin entry "${name}" is not a file path string` });
        }
      } else if (data.bin !== undefined) {
        facts.push({ form: "config-bin", specifier: "bin", key: "bin", line: at("bin"), unresolved: true, reason: "package.json bin must be a file path string or an object of command names" });
      }
      if (typeof data.main === "string") facts.push({ form: "config-main", specifier: data.main.replace(/^\.\//, ""), key: "main", entry: data.main, line: at("main") });
      else if (data.main !== undefined) facts.push({ form: "config-main", specifier: "main", key: "main", line: at("main"), unresolved: true, reason: "package.json main must be a file path string" });
      if (data.scripts && typeof data.scripts === "object") {
        for (const name of Object.keys(data.scripts)) facts.push({ form: "config-script", specifier: name, name, key: `scripts.${name}`, line: at("scripts", name), unresolved: true, reason: "package.json scripts are read as text and never executed" });
      }
    }
    if (/(?:^|\/)pyproject\.toml$/.test(path)) {
      const match = text.match(/\[project\.scripts\]([\s\S]*?)(?:\n\[|\s*$)/);
      if (match) {
        const header = text.slice(0, match.index).split("\n").length;
        match[1].split("\n").forEach((line, offset) => {
          const pair = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*"([^"]+)"/);
          if (pair) facts.push({ form: "config-script", specifier: pair[2].split(":")[0].replace(/\./g, "/") + ".py", module: pair[2].split(":")[0], name: pair[1], key: `project.scripts.${pair[1]}`, line: header + offset });
        });
      }
    }
    return facts;
  }

  function collect(path, text, language) {
    if (typeof text !== "string") return [];
    // A markdown file's links are extracted once, by the document reader that
    // owns its heading and link structure; extracting them again here gave every
    // link a second relation with the same file, line and excerpt. Formats that
    // reader does not handle still need this extractor: notebook markdown cells,
    // .rst, and any .mdx not classified as markdown.
    if (language === "markdown") return [];
    if (/\.(?:md|mdx|rst)$/i.test(path)) return markdownLinks(path, text);
    if (language === "vue" || /\.vue$/i.test(path)) return vueResources(path, text);
    if (/\.ipynb$/i.test(path)) return notebookCells(path, text).facts;
    if (/(?:^|\/)package\.json$|(?:^|\/)pyproject\.toml$/.test(path)) return configRelations(path, text);
    return [];
  }

  const CONFIG_ENTRIES = new Set(["config-bin", "config-main", "config-script"]);

  function resolve(path, fact, helpers) {
    const { joinRelative, choose } = helpers;
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (CONFIG_ENTRIES.has(fact.form)) {
      if (fact.unresolved) return { status: "unresolved", targets: [], reason: fact.reason || "Declared configuration entry is not resolved", engine: "semantic-dwave", rule: "config-entry" };
      const spec = String(fact.specifier || "").replace(/^\.\//, "");
      // A declared entry belongs to the package that owns this manifest: a
      // same-named file elsewhere in the repository is another package's file.
      const owned = joinRelative(dir, spec);
      // Only `main` carries Node's documented extension and directory defaults.
      // https://nodejs.org/api/modules.html#all-together
      const ordered = fact.form === "config-main"
        ? [owned, owned && owned + ".js", owned && owned + ".json", owned && owned + ".node", owned && owned + "/index.js", owned && owned + "/index.json"]
        : [owned];
      for (const candidate of ordered) {
        const hit = candidate ? choose([candidate]) : null;
        if (!hit?.targets.length) continue;
        // A console script names a module, not a file: which file `a.b` is depends on
        // the package roots the project declares, which this reader does not apply.
        if (fact.module) return { status: "candidate", targets: hit.targets, reason: `The ${fact.key} entry names the module ${fact.module}; ${hit.targets[0]} is that module only if the project's package root is the manifest directory, which this entry does not state`, engine: "semantic-dwave", rule: `package-entry-${fact.key}` };
        return { status: "resolved", targets: hit.targets, engine: "semantic-dwave", rule: `package-entry-${fact.key || fact.form}`, proof: { entry: fact.entry ?? spec, resolvedFrom: dir || "the package root" } };
      }
      return { status: "unresolved", targets: [], reason: `The ${fact.key || fact.form} entry "${fact.entry ?? spec}" does not name an included file inside ${dir || "the package root"}`, engine: "semantic-dwave", rule: "config-entry" };
    }
    if (fact.form === "md-link" || fact.form === "html-script" || fact.form === "html-link") {
      if (fact.external) return { status: "unresolved", targets: [], reason: fact.reason || "External document reference", external: { name: fact.specifier, kind: "url", specifier: fact.specifier }, engine: "semantic-dwave", rule: "document-reference" };
      const spec = String(fact.specifier || "").replace(/^\.\//, "");
      const own = joinRelative(dir, spec);
      // A page is never loaded: a <base> element, the server's routing or a bundler
      // decides which URL a src/href fetches, so a matching file stays a candidate.
      const page = fact.form !== "md-link";
      // A document link is read relative to the linking document, so the exact
      // joined path is the link's target. A snapshot-root path or an appended
      // extension is a guess at what the author meant.
      const exact = own ? choose([own]) : { targets: [] };
      if (exact.targets.length && !page) return { ...exact, status: "resolved", engine: "semantic-dwave", rule: "document-reference" };
      const result = exact.targets.length ? exact : choose([spec, joinRelative(dir, spec + ".md"), joinRelative(dir, spec + ".py"), joinRelative(dir, spec + ".js")]);
      if (!result.targets.length) return { ...result, status: "unresolved", engine: "semantic-dwave", rule: "document-reference" };
      return { ...result, status: "candidate", engine: "semantic-dwave", rule: "document-reference",
        reason: page ? `${result.targets[0]} matches the authored reference, but the page is never loaded, so which URL it fetches (a <base> element, server routing, a bundler) is not established`
          : `${result.targets[0]} is not the path the link names relative to ${path}; it matches only after a root-relative or extension guess` };
    }
    return null;
  }

  root.SkylenseSemanticDWave = Object.freeze({ collect, resolve, markdownLinks, vueResources, notebookCells, configRelations });
})(typeof window !== "undefined" ? window : globalThis);
