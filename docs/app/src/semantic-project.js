/* Project-local import and call binding for languages that have syntax facts
   but not a compiler service.

   Every resolver here answers with one explicit verdict, so a weaker fallback
   can never turn an adapter's abstention back into a confident target:
     null                                     unhandled — no rule covers this fact
     { status: "resolved",   targets: [one] } a language rule proved this target
     { status: "candidate",  targets: [...] } name matches without a proving rule
     { status: "unresolved", reason, external? } the rule ran and refused to guess
   Resolved and unresolved results carry the rule that produced them. */
(function (root) {
  "use strict";

  const LOCAL_FORMS = new Set([
    "go-import", "rust-mod", "rust-use", "java-import", "c-include",
    "csharp-using", "ruby-relative", "ruby-require", "php-include", "php-use",
    "lua-require", "shell-source", "kotlin-import", "swift-import", "scala-import",
  ]);

  const dirOf = path => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
  const CSHARP_TYPES = new Set(["class", "struct", "interface", "enum", "record"]);
  const RUST_ROOT = /(?:^|\/)(?:mod|lib|main)\.rs$/;
  /** How many files ending in a Lua module path still make a candidate set worth showing. */
  const LUA_SUFFIX_LIMIT = 3;
  const resolved = (targets, rule, proof) => ({ status: "resolved", targets, engine: "semantic-project", rule, ...(proof ? { proof } : {}) });
  /** A language rule found this target, but a build condition decides whether it
   *  is compiled. That is a candidate for one configuration, never a fact. */
  const conditional = (targets, rule, reason, proof) => ({ status: "candidate", conditional: true, targets, reason, engine: "semantic-project", rule, ...(proof ? { proof } : {}) });
  const unresolved = (reason, rule, extra) => ({ status: "unresolved", targets: [], reason, engine: "semantic-project", rule, ...extra });

  function create(fileMap, helpers) {
    const { joinRelative, choose } = helpers;
    const files = [...fileMap.keys()];
    const byDir = new Map();
    for (const path of files) {
      const dir = dirOf(path);
      const list = byDir.get(dir) || [];
      list.push(path);
      byDir.set(dir, list);
    }
    const directories = new Set([""]);
    for (const path of files) for (let dir = dirOf(path); dir; dir = dirOf(dir)) directories.add(dir);
    function pathsEnding(suffix) {
      return files.filter(path => path === suffix || path.endsWith("/" + suffix));
    }
    const factsOf = path => { const value = fileMap.get(path); return value?.facts || value?.syntaxFacts || value?.entry?.syntaxFacts || null; };
    const textOf = path => { const value = fileMap.get(path); return typeof value?.text === "string" ? value.text : null; };
    const symbolsOf = path => factsOf(path)?.symbols || [];
    /* Manifest-backed families (Python, Julia, JVM, C/C++, Swift, Ruby, PHP, Lua). A build
       manifest states which files the compiler may see, so a family verdict
       outranks every path or basename search in this file and is consulted first.
       A family that has no manifest for the fact answers `null`, leaving the
       weaker rules below exactly as they were. */
    const families = root.SkylenseProjectManifests?.create?.(fileMap, helpers) || [];

    // C#: namespace identity comes from namespace declarations only. A file
    // basename is never evidence and a suffix of a longer namespace is a
    // different namespace.
    // https://learn.microsoft.com/dotnet/csharp/language-reference/language-specification/namespaces
    let csharp = null;
    function csharpIndex() {
      if (csharp) return csharp;
      const namespaces = new Map(), types = new Map(), projects = [];
      for (const path of files) {
        if (/\.csproj$/i.test(path)) {
          const dir = dirOf(path), references = new Set();
          for (const match of String(textOf(path) || "").matchAll(/<ProjectReference\b[^>]*\bInclude\s*=\s*"([^"]+)"/gi)) {
            const target = joinRelative(dir, match[1].replace(/\\/g, "/"));
            if (target) references.add(target);
          }
          projects.push({ path, dir, references });
        }
        if (!/\.cs$/i.test(path)) continue;
        for (const symbol of symbolsOf(path)) {
          const name = String(symbol.qualifiedName || symbol.name || "");
          const table = symbol.kind === "module" ? namespaces : CSHARP_TYPES.has(symbol.kind) ? types : null;
          if (!name || !table) continue;
          const declarations = table.get(name) || new Map();
          declarations.set(path, [...(declarations.get(path) || []), { line: symbol.line, endLine: symbol.bodyEndLine || symbol.endLine }]);
          table.set(name, declarations);
        }
      }
      return (csharp = { namespaces, types, projects });
    }
    function csharpOwner(path, projects) {
      let owner = null;
      for (const project of projects) {
        if (path !== project.path && !path.startsWith(project.dir ? project.dir + "/" : "")) continue;
        if (!owner || project.dir.length > owner.dir.length) owner = project;
      }
      return owner;
    }
    /** Files a using directive in `path` may see: its own MSBuild project plus referenced ones. */
    function csharpScope(path, index) {
      const owner = index.projects.length ? csharpOwner(path, index.projects) : null;
      if (!owner) return { label: "the included snapshot", has: () => true };
      const reachable = new Set([owner.path]), queue = [owner];
      while (queue.length) {
        const current = queue.shift();
        for (const reference of current.references) {
          if (reachable.has(reference)) continue;
          reachable.add(reference);
          const next = index.projects.find(project => project.path === reference);
          if (next) queue.push(next);
        }
      }
      return {
        label: `${owner.path} and the projects it references`,
        has: file => { const own = csharpOwner(file, index.projects); return Boolean(own) && reachable.has(own.path); },
      };
    }
    /** `using static X` names a type, `using A = X` is an alias, anything else a namespace. */
    function csharpDirectiveKind(path, fact) {
      const text = textOf(path);
      let declaration = "";
      if (text !== null && Number.isInteger(fact.startIndex) && Number.isInteger(fact.endIndex)) declaration = text.slice(fact.startIndex, fact.endIndex);
      else if (text !== null && Number.isInteger(fact.line)) declaration = text.split("\n")[fact.line - 1] || "";
      if (/\busing\s+static\b/.test(declaration)) return "static";
      if (/\busing\s+(?:unsafe\s+)?[A-Za-z_]\w*\s*=/.test(declaration)) return "alias";
      return "namespace";
    }
    /** Namespace scopes enclosing the directive, innermost first, then the global scope. */
    function csharpLookupScopes(path, fact) {
      const enclosing = symbolsOf(path).filter(symbol => symbol.kind === "module" && (
        Number.isInteger(symbol.bodyStartIndex) && Number.isInteger(symbol.bodyEndIndex) && Number.isInteger(fact.startIndex)
          ? symbol.bodyStartIndex <= fact.startIndex && fact.startIndex <= symbol.bodyEndIndex
          : symbol.line <= fact.line && fact.line <= (symbol.bodyEndLine || symbol.endLine)));
      const innermost = enclosing.map(symbol => String(symbol.qualifiedName || symbol.name || "")).filter(Boolean).sort((a, b) => b.length - a.length)[0] || "";
      const scopes = [];
      for (let current = innermost; current; current = current.includes(".") ? current.slice(0, current.lastIndexOf(".")) : "") scopes.push(current);
      scopes.push("");
      return scopes;
    }

    // Rust: module files follow the declaring file, never directory adjacency.
    // https://doc.rust-lang.org/reference/items/modules.html#module-source-filenames
    /** Crate root files a Cargo.toml target declares with `path = "..."` ([lib],
     *  [[bin]], [[example]], [[test]], [[bench]]). A crate root owns its directory
     *  the way lib.rs does, whatever the file is called.
     *  https://doc.rust-lang.org/cargo/reference/cargo-targets.html#the-path-field */
    let rustDeclaredRoots = null;
    function rustCargoTargets() {
      if (rustDeclaredRoots) return rustDeclaredRoots;
      rustDeclaredRoots = new Map();
      for (const manifest of files) if (/(?:^|\/)Cargo\.toml$/.test(manifest)) {
        const text = textOf(manifest) || "", dir = dirOf(manifest), roots = [];
        for (const section of text.split(/^(?=\s*\[)/m)) {
          if (!/^\s*\[\[?\s*(?:lib|bin|example|test|bench)\s*\]\]?/.test(section)) continue;
          const declared = /^\s*path\s*=\s*"([^"]+)"/m.exec(section)?.[1];
          const target = declared ? joinRelative(dir, declared) : null;
          if (target && fileMap.has(target)) roots.push(target);
        }
        rustDeclaredRoots.set(dir, roots);
      }
      return rustDeclaredRoots;
    }
    const rustIsRoot = path => RUST_ROOT.test(path) || [...rustCargoTargets().values()].some(roots => roots.includes(path));
    /* A file loaded by `#[path = "…"] mod x;` is read the way a mod.rs file is: its own
       `mod y;` children sit beside it, not in a directory named after it, whether the
       declaration sits inside an inline block or not (rustc_expand module.rs,
       mod_file_path / DirOwnership::Owned). Declarations outside inline blocks are
       collected first; inline ones are anchored afterwards, against that set. */
    let rustPathLoaded = null;
    function rustPathLoadedFiles() {
      if (rustPathLoaded) return rustPathLoaded;
      rustPathLoaded = new Set();
      const nested = [];
      for (const file of files) {
        if (!file.endsWith(".rs")) continue;
        for (const fact of factsOf(file)?.imports || []) {
          if (fact.form !== "rust-mod") continue;
          const declared = rustAttributes(file, fact).path;
          if (declared === null) continue;
          const inline = rustInlineChain(file, fact);
          if (inline.length) { nested.push({ file, fact, inline, declared }); continue; }
          const target = joinRelative(dirOf(file), declared);
          if (target && fileMap.has(target)) rustPathLoaded.add(target);
        }
      }
      for (const { file, fact, inline, declared } of nested) {
        const target = joinRelative(rustModuleDir(file, inline, rustInlineDirs(file, fact)), declared);
        if (target && fileMap.has(target)) rustPathLoaded.add(target);
      }
      return rustPathLoaded;
    }
    /** The directory `mod x;` children of `path` (inside the inline blocks `inline`)
     *  are read from. An inline `#[path = "d"] mod a { … }` contributes d instead of a. */
    function rustModuleDir(path, inline, components = inline) {
      const base = rustIsRoot(path) || rustPathLoadedFiles().has(path) ? dirOf(path) : path.replace(/\.rs$/, "");
      return components.length ? [base, ...components].filter(Boolean).join("/") : base;
    }
    /** Directory components of the inline blocks a declaration sits in: each block's
     *  `#[path]` value when it carries one, else its name. */
    function rustInlineDirs(path, fact) {
      const symbols = symbolsOf(path);
      const byIndex = new Map(symbols.map((symbol, order) => [Number.isInteger(symbol.index) ? symbol.index : order, symbol]));
      let current = symbols.find(symbol => symbol.kind === "module" && (Number.isInteger(fact.startIndex)
        ? symbol.startIndex === fact.startIndex
        : symbol.line === fact.line && symbol.name === fact.specifier));
      const dirs = [];
      while (current && current.parent != null) {
        const parent = byIndex.get(current.parent);
        if (!parent || parent.kind !== "module") break;
        const declared = rustAttributes(path, { startIndex: parent.startIndex }).path;
        dirs.unshift(declared === null ? String(parent.name || "") : declared);
        current = parent;
      }
      return dirs.filter(Boolean);
    }
    /** Names of the inline `mod name { ... }` blocks the declaration sits in, outermost first. */
    function rustInlineChain(path, fact) {
      const symbols = symbolsOf(path);
      const byIndex = new Map(symbols.map((symbol, order) => [Number.isInteger(symbol.index) ? symbol.index : order, symbol]));
      let current = symbols.find(symbol => symbol.kind === "module" && (Number.isInteger(fact.startIndex)
        ? symbol.startIndex === fact.startIndex
        : symbol.line === fact.line && symbol.name === fact.specifier));
      const chain = [];
      while (current && current.parent != null) {
        const parent = byIndex.get(current.parent);
        if (!parent || parent.kind !== "module") break;
        chain.unshift(String(parent.name || ""));
        current = parent;
      }
      return chain.filter(Boolean);
    }
    /** Outer attributes such as `#[path = "..."]` sit immediately before the item. */
    function rustAttributes(path, fact) {
      const text = textOf(path), result = { path: null, conditional: false, cfg: null, cfgAttrPath: null };
      if (text === null || !Number.isInteger(fact.startIndex)) return result;
      let cursor = fact.startIndex;
      while (cursor > 0) {
        const head = text.slice(0, cursor).replace(/\s+$/, "");
        if (!head.endsWith("]")) break;
        const open = head.lastIndexOf("#[");
        if (open < 0) break;
        const body = head.slice(open + 2, head.length - 1);
        const declared = /^\s*path\s*=\s*"([^"]*)"/.exec(body);
        if (declared && result.path === null) result.path = declared[1];
        if (/^\s*cfg\b/.test(body)) { result.conditional = true; result.cfg = `#[${body.trim()}]`; }
        else if (/^\s*cfg_attr\b/.test(body)) {
          if (/\bpath\s*=/.test(body)) result.cfgAttrPath ||= `#[${body.trim()}]`;
          else { result.conditional = true; result.cfg ||= `#[${body.trim()}]`; }
        }
        cursor = open;
      }
      return result;
    }
    /** A file found only because its path or name matches the specifier. No rule
     *  of the language proves it, so it is a candidate under the rule that found it. */
    const suffixCandidate = (targets, rule, reason) => ({ status: "candidate", targets: [...new Set(targets)].sort(), reason, engine: "semantic-project", rule });
    const listed = paths => paths.slice(0, 6).join(", ") + (paths.length > 6 ? ` and ${paths.length - 6} more` : "");
    /** Several files match by name: a decided refusal, so no weaker search below
     *  can pick one of them as if it were proven. */
    const ambiguous = (paths, rule, what) => unresolved(`${what}: ${listed([...paths].sort())} all match by path or name, and no rule decides between them`, rule);
    let goModuleNames = null;
    /** Module paths the included go.mod files declare. */
    function goModules() {
      if (goModuleNames) return goModuleNames;
      goModuleNames = [];
      for (const file of files) if (/(?:^|\/)go\.mod$/.test(file)) {
        const name = /^\s*module\s+([^\s/][^\s]*)/m.exec(textOf(file) || "")?.[1];
        if (name) goModuleNames.push(name.replace(/^"|"$/g, ""));
      }
      return goModuleNames;
    }
    /* `use crate::a::b` names modules, and a module is what a `mod` declaration
       proves (rust-mod below: module files, #[path], inline `mod x { }` blocks),
       never a file that merely sits at <dir>/a.rs. A module is a node
       { file, chain }: the file holding it and its inline block names. Built from
       the same rust-mod verdicts this file returns; src/semantic-calls.js builds its
       own tree from call-binding facts, which do not exist at import resolution. */
    const rustInlineModules = path => symbolsOf(path).filter(symbol => symbol.kind === "module" && Number.isInteger(symbol.bodyStartIndex));
    const sameChain = (a, b) => a.length === b.length && a.every((name, i) => name === b[i]);
    let rustTree = null;
    /** Every `mod` declaration with its verdict, and the parents each module file has. */
    function rustModTree() {
      if (rustTree) return rustTree;
      const declarations = new Map(), parents = new Map();
      for (const path of files) {
        if (!path.endsWith(".rs")) continue;
        const list = [];
        for (const fact of factsOf(path)?.imports || []) {
          if (fact.form !== "rust-mod") continue;
          const chain = rustInlineChain(path, fact), verdict = resolveFact(path, fact);
          list.push({ name: String(fact.specifier || ""), chain, verdict });
          const target = verdict?.targets?.length === 1 && (verdict.status === "resolved" || verdict.conditional) ? verdict.targets[0] : null;
          if (target) { const owners = parents.get(target) || []; owners.push({ file: path, chain }); parents.set(target, owners); }
        }
        for (const symbol of rustInlineModules(path))
          list.push({ name: String(symbol.name || ""), chain: rustInlineChain(path, { startIndex: symbol.startIndex, line: symbol.line, specifier: symbol.name }), inline: true });
        declarations.set(path, list);
      }
      return (rustTree = { declarations, parents });
    }
    /** The module that contains `fact`: its file plus the inline blocks around it. */
    function rustEnclosing(path, fact) {
      const around = rustInlineModules(path).filter(symbol => Number.isInteger(fact.startIndex) && symbol.bodyStartIndex <= fact.startIndex && fact.startIndex <= symbol.bodyEndIndex)
        .sort((a, b) => b.bodyStartIndex - a.bodyStartIndex)[0];
      return { file: path, chain: around ? [...rustInlineChain(path, { startIndex: around.startIndex, line: around.line, specifier: around.name }), String(around.name)] : [] };
    }
    /** A crate root: a lib.rs/main.rs or Cargo-declared target that no proven `mod`
     *  declaration names as a module. Owning a directory (mod.rs) is a separate question. */
    const rustIsCrateRoot = file => !(rustModTree().parents.get(file) || []).length
      && (/(?:^|\/)(?:lib|main)\.rs$/.test(file) || [...rustCargoTargets().values()].some(roots => roots.includes(file)));
    /** Parent module of `node`, or a reason. */
    function rustParentModule(node) {
      if (node.chain.length) return { node: { file: node.file, chain: node.chain.slice(0, -1) } };
      const owners = rustModTree().parents.get(node.file) || [];
      if (owners.length === 1) return { node: owners[0] };
      if (owners.length > 1) return { reason: `${node.file} is declared as a module by ${owners.length} parents` };
      if (rustIsCrateRoot(node.file)) return { reason: `${node.file} is a crate root, which has no parent module` };
      return { reason: `no included \`mod\` declaration names ${node.file} as a module` };
    }
    /** Child module `name` of `node` as a `mod` declaration proves it, or a reason. */
    function rustChildModule(node, name) {
      const found = (rustModTree().declarations.get(node.file) || []).filter(item => item.name === name && sameChain(item.chain, node.chain));
      if (!found.length) return null;
      if (found.length > 1) return { reason: `module ${name} is declared more than once in ${node.file}` };
      const [item] = found;
      if (item.inline) return { node: { file: node.file, chain: [...node.chain, name] } };
      const verdict = item.verdict, target = verdict?.targets?.length === 1 ? verdict.targets[0] : null;
      if (!target || !(verdict.status === "resolved" || verdict.conditional))
        return { reason: `\`mod ${name};\` in ${node.file} has no proven module file${verdict?.reason ? ": " + verdict.reason : ""}` };
      return { node: { file: target, chain: [] }, conditional: verdict.status !== "resolved", rule: verdict.rule };
    }

    /* A script-directory `source` (fact.anchor "script-dir", from src/syntax-facts.js).
       A caveat whose only reasons are earlier `source` commands (fact.after) is
       lifted when each of them binds statically to an included file that is
       inert for this use: fully read and parsed, no cd/pushd/popd (also through
       builtin or command), eval or trap, no further `source`, no redefinition of
       source, cd, dirname, readlink, realpath or pwd, and, for the variable form,
       no occurrence of the variable's name at all. These are the same rules the
       sourcing file itself is held to. The verdict reads the other file's text,
       so it is valid only for that text; the semantic cache key and the edge's
       projectContextHash both carry every included file's text hash (src/ingest.js
       semanticManifest), so an edit to the sourced file invalidates it. */
    function shellScriptDir(path, fact, spec, seen) {
      const dir = dirOf(path);
      const target = joinRelative(dir, String(fact.path || ""));
      if (!target || !fileMap.has(target)) return unresolved(`${spec} names ${target || fact.path} relative to the directory of ${path}, which is not included in this snapshot`, "shell-source-script-dir");
      const proof = { via: fact.via, ...(fact.variable ? { variable: fact.variable } : {}), relativeTo: dir || "the snapshot root", path: fact.path };
      if (!fact.caveat) return resolved([target], "shell-source-bash-source-dir", proof);
      const inert = shellEarlierSourcesInert(path, fact, seen);
      if (inert.length) return resolved([target], "shell-source-bash-source-dir", { ...proof, earlierSources: inert });
      return { status: "candidate", targets: [target], reason: `${spec} names ${target}, but ${fact.caveat}`, engine: "semantic-project", rule: "shell-source-script-dir", proof };
    }
    /** The inert files the earlier `source` commands load, or [] when any one is not shown inert. */
    function shellEarlierSourcesInert(path, fact, seen) {
      if (!Array.isArray(fact.after) || !fact.after.length) return [];
      const key = path + "\0" + fact.startIndex;
      if (seen.has(key)) return [];
      const visiting = new Set([...seen, key]), loaded = [];
      const own = (factsOf(path)?.imports || []).filter(item => item.form === "shell-source" && item.anchor === "script-dir");
      for (const start of fact.after) {
        const earlier = own.find(item => item.startIndex === start);
        if (!earlier) return [];
        const spec = String(earlier.specifier || "").replace(/^["']+|["']+$/g, "");
        const verdict = shellScriptDir(path, earlier, spec, visiting);
        if (verdict.status !== "resolved" || verdict.targets.length !== 1) return [];
        const file = verdict.targets[0], value = fileMap.get(file), shell = factsOf(file)?.shell, text = textOf(file);
        if (!shell || shell.partial || shell.moves || shell.sources || shell.redefines || text === null || value?.textClipped || value?.entry?.truncated === true || value?.entry?.status === "truncated") return [];
        if (fact.variable && new RegExp(String.raw`\b${fact.variable}\b`).test(text)) return [];
        loaded.push(file);
      }
      return [...new Set(loaded)];
    }
    function resolveFact(path, fact) {
      for (const family of families) {
        if (!family.forms.has(fact.form)) continue;
        const verdict = family.resolve(path, fact);
        if (verdict) return verdict;
      }
      // Julia `using`/`import` of a local module is decided by the Julia engine, which owns
      // the include context that gives a module its qualified name. Surfacing its verdict
      // here keeps a weaker basename lookup from overriding a stated abstention.
      if (fact.form === "julia-module") {
        const binding = fact.moduleBinding;
        if (!binding) return null;
        if (binding.status === "resolved" && fileMap.has(binding.target))
          return resolved([binding.target], binding.rule || "julia-module-binding", { module: binding.module, specifier: String(fact.specifier || "") });
        return unresolved(binding.reason || "No local Julia module binding was established for this specifier", "julia-module-binding");
      }
      if (!LOCAL_FORMS.has(fact.form)) return null;
      const dir = dirOf(path);
      const spec = String(fact.specifier || "").replace(/\\/g, "/").replace(/^["'<]+|["'>]+$/g, "");
      if (!spec || spec.includes("\0")) return unresolved("Empty or invalid specifier", "specifier-guard");
      if (fact.form === "c-include" && fact.system)
        return unresolved("System header is outside the included snapshot", "c-include-system", { external: { name: spec, kind: "system-header", specifier: spec } });
      if (fact.form === "go-import") {
        if (spec.startsWith("./") || spec.startsWith("../")) return choose([joinRelative(dir, spec)]);
        // An import path inside a module some included go.mod declares is decided by
        // that declaration (src/source-resolver.js); a directory that merely ends in
        // the same path segments must not pre-empt it.
        if (goModules().some(name => spec === name || spec.startsWith(name + "/"))) return null;
        const tail = spec.split("/").filter(Boolean).join("/");
        const packages = files.filter(file => file.endsWith(".go") && (file.startsWith(tail + "/") || file.includes("/" + tail + "/")));
        // Only a directory that ends in the import path is that package; a
        // subpackage below it is a different package, not a competing match.
        const dirs = [...new Set(packages.map(file => dirOf(file)))].filter(found => found === tail || found.endsWith("/" + tail));
        if (dirs.length === 1) return suffixCandidate((byDir.get(dirs[0]) || []).filter(file => file.endsWith(".go") && !file.endsWith("_test.go")), "go-import-included-path",
          `${dirs[0]} ends in the import path ${spec}, but no included go.mod declares a module that contains it, so the directory is a candidate package, not a proven one`);
        if (dirs.length > 1) return ambiguous(dirs, "go-import-included-path", `Ambiguous local Go package path ${spec}`);
        return { targets: [], reason: "Go module path is not a unique included package", external: { name: spec, kind: "module", specifier: spec } };
      }
      if (fact.form === "rust-mod") {
        const inline = rustInlineChain(path, fact), attributes = rustAttributes(path, fact), dirs = rustInlineDirs(path, fact);
        // `#[cfg_attr(pred, path = "…")]` picks the module file per configuration.
        if (attributes.cfgAttrPath)
          return unresolved(`\`mod ${spec};\` carries ${attributes.cfgAttrPath}, so which file it loads depends on a build configuration this adapter does not evaluate`, "rust-mod-path-attribute");
        // A cfg predicate decides whether the module is compiled at all. The
        // module file is real, the edge is not: it holds only for build
        // configurations this snapshot cannot evaluate.
        // https://doc.rust-lang.org/reference/conditional-compilation.html
        const gate = target => attributes.conditional
          ? conditional([target], "rust-mod-cfg-gated", `\`mod ${spec};\` is gated by ${attributes.cfg}; the module file ${target} exists but is compiled only when that predicate holds, and this adapter does not evaluate build configuration`, { declaration: `mod ${spec};`, cfg: attributes.cfg, moduleFile: target })
          : null;
        if (attributes.path !== null) {
          // Outside an inline module the path is relative to the declaring
          // file's directory. Inside inline blocks it is relative to the
          // declaring file's own module directory plus the block names.
          // https://doc.rust-lang.org/reference/items/modules.html#the-path-attribute
          const anchor = inline.length ? rustModuleDir(path, inline, dirs) : dir;
          const target = joinRelative(anchor, attributes.path);
          if (!target || !fileMap.has(target))
            return unresolved(`#[path = "${attributes.path}"] on \`mod ${spec};\`${inline.length ? ` inside inline module ${inline.join("::")}` : ""} names ${target || attributes.path}, which is not included in this snapshot`, "rust-mod-path-attribute");
          return gate(target) || resolved([target], "rust-mod-path-attribute", { declaration: `mod ${spec};`, attribute: attributes.path, inline, relativeTo: anchor || "the source root" });
        }
        const base = rustModuleDir(path, inline, dirs);
        const file = joinRelative(base, spec + ".rs"), directory = joinRelative(base, spec + "/mod.rs");
        const hits = [file, directory].filter(candidate => candidate && fileMap.has(candidate));
        if (hits.length > 1) return unresolved(`Ambiguous Rust module \`${spec}\`: ${file} and ${directory} both exist, which rustc rejects (E0761)`, "rust-mod-file");
        if (hits.length === 1) return gate(hits[0]) || resolved(hits, "rust-mod-file", { declaration: `mod ${spec};`, moduleDirectory: base || "the crate root directory", inline, considered: [file, directory] });
        return unresolved(`No module file for \`mod ${spec};\` declared in ${path}: neither ${file} nor ${directory} is included`, "rust-mod-file");
      }
      if (fact.form === "rust-use") {
        const parts = spec.split("::").filter(Boolean);
        if (!["crate", "self", "super"].includes(parts[0]))
          return unresolved("External crate or unfetched dependency", "rust-use-external", { external: { name: spec, kind: "crate", specifier: spec } });
        let node = rustEnclosing(path, fact), rest = parts.slice(1);
        if (parts[0] === "crate") {
          // The crate root is reached from this module through proven parents only.
          for (const seen = new Set(); !(node.chain.length === 0 && rustIsCrateRoot(node.file)); ) {
            const key = node.file + "#" + node.chain.join("::");
            if (seen.has(key)) return unresolved(`\`${spec}\`: the mod declarations above ${path} form a cycle`, "rust-use-crate");
            seen.add(key);
            const up = rustParentModule(node);
            if (!up.node) return unresolved(`\`${spec}\` starts at the crate root, but ${path} is not reachable from a crate root through proven mod declarations: ${up.reason}`, "rust-use-crate");
            node = up.node;
          }
        } else {
          let lead = 0;
          for (; parts[lead] === "self" || parts[lead] === "super"; lead++) {
            if (parts[lead] === "self") continue;
            const up = rustParentModule(node);
            if (!up.node) return unresolved(`\`${spec}\`: the parent of ${node.file}${node.chain.length ? "::" + node.chain.join("::") : ""} is not proven: ${up.reason}`, "rust-use-path");
            node = up.node;
          }
          rest = parts.slice(lead);
        }
        const anchor = node.file, names = rest.filter(name => /^\w+$/.test(name)), walked = [];
        let conditionalStep = null;
        for (const name of names) {
          const child = rustChildModule(node, name);
          if (!child) break; // not a module of this one: an item, which ends the module path
          if (!child.node) return unresolved(`\`${spec}\`: ${child.reason}`, "rust-use-path");
          node = child.node; walked.push(name);
          if (child.conditional) conditionalStep ||= name;
        }
        if (node.file === path)
          return unresolved(`\`${spec}\` names ${walked.length ? `the inline module ${node.chain.join("::")} of` : "an item of"} ${path} itself, so it has no other module file`, "rust-use-path");
        const proof = { anchor, segments: walked, module: node.chain.length ? `${node.file}::${node.chain.join("::")}` : node.file };
        return conditionalStep
          ? conditional([node.file], "rust-use-path", `module ${conditionalStep} on the path \`${spec}\` is gated by #[cfg], which this adapter does not evaluate`, proof)
          : resolved([node.file], "rust-use-path", proof);
      }
      if (fact.form === "csharp-using") {
        const index = csharpIndex(), kind = csharpDirectiveKind(path, fact), scope = csharpScope(path, index);
        const tables = kind === "static" ? [["type", index.types]]
          : kind === "alias" ? [["namespace", index.namespaces], ["type", index.types]]
          : [["namespace", index.namespaces]];
        const searched = [], blocked = [];
        for (const prefix of csharpLookupScopes(path, fact)) {
          const full = prefix ? `${prefix}.${spec}` : spec;
          searched.push(full);
          for (const [label, table] of tables) {
            const declarations = table.get(full);
            if (!declarations) continue;
            const visible = [...declarations.keys()].filter(file => scope.has(file));
            if (!visible.length) { blocked.push(`${full} (declared in ${[...declarations.keys()].join(", ")})`); continue; }
            if (visible.length > 1) return unresolved(`Ambiguous C# ${label} ${full}: ${visible.join(", ")} all declare it, and this adapter binds a using directive only when one included file declares the ${label}`, `csharp-using-${label}`);
            return resolved(visible, `csharp-using-${label}`, { identity: full, directive: kind, declarations: declarations.get(visible[0]), scope: scope.label, searched });
          }
        }
        if (blocked.length) return unresolved(`C# ${blocked.join("; ")} is outside ${scope.label}; no project reference proves it is visible from ${path}`, "csharp-using-project-scope");
        const what = kind === "static" ? "type" : kind === "alias" ? "namespace or type" : "namespace";
        return unresolved(`No included C# ${what} is named ${searched.join(" or ")}; a file basename is not namespace evidence`, `csharp-using-${kind}`, { external: { name: spec, kind: "package", specifier: spec } });
      }
      if (fact.form === "java-import" || fact.form === "kotlin-import" || fact.form === "scala-import") {
        const rel = spec.replace(/\./g, "/");
        const ext = fact.form === "kotlin-import" ? [".kt", ".kts"] : fact.form === "scala-import" ? [".scala"] : [".java"];
        const hits = [...new Set(ext.flatMap(kind => pathsEnding(rel + kind)))];
        const rule = fact.form + "-included-path";
        if (hits.length === 1) return suffixCandidate(hits, rule,
          `${hits[0]} ends in ${rel}${ext[0]}, but no build manifest declares the source root it would sit under and its package clause is not checked, so the path suffix is a candidate, not a binding`);
        if (hits.length > 1) return ambiguous(hits, rule, `Ambiguous ${fact.form} ${spec}`);
        return { targets: [], reason: `${fact.form} is not a unique included type or namespace`, external: { name: spec, kind: "package", specifier: spec } };
      }
      if (fact.form === "c-include") {
        // A quoted include is searched first in the including file's own directory;
        // that one step is the preprocessor's rule and needs no build manifest.
        // https://gcc.gnu.org/onlinedocs/cpp/Search-Path.html
        // Named like project-native's rule for the same proof, and never like the guess below.
        const own = joinRelative(dir, spec);
        if (own && fileMap.has(own)) return resolved([own], "c-include-quoted-current-directory", { searched: dir || "the snapshot root", via: "the including file's own directory" });
        // Anything further depends on an include search path no manifest states here,
        // so the same-path and same-basename files are candidates, never the target.
        const hits = [...new Set([joinRelative("", spec), ...pathsEnding(spec.split("/").pop())].filter(candidate => candidate && fileMap.has(candidate)))];
        if (hits.length === 1) return suffixCandidate(hits, "c-include-included-path",
          `${hits[0]} is not in the including file's directory; it would be opened only through an include directory, and no compile_commands.json or CMakeLists.txt states one for ${path}`);
        if (hits.length > 1) return ambiguous(hits, "c-include-included-path", `Ambiguous #include "${spec}"`);
        return { targets: [], reason: "External, unavailable, excluded or unresolved target" };
      }
      if (fact.form === "ruby-relative") return choose([joinRelative(dir, spec + ".rb"), joinRelative(dir, spec)]);
      if (fact.form === "ruby-require") {
        const hits = pathsEnding(spec.replace(/\.rb$/, "") + ".rb");
        if (hits.length === 1) return suffixCandidate(hits, "ruby-require-included-path",
          `${hits[0]} ends in ${spec}, but $LOAD_PATH is not read, so which directory require searches is not stated`);
        if (hits.length > 1) return ambiguous(hits, "ruby-require-included-path", `Ambiguous Ruby require ${spec}`);
        return { targets: [], reason: "Ruby require is not a unique included file", external: { name: spec, kind: "gem", specifier: spec } };
      }
      /* PHP include/require: a path that starts with ./ or ../ is relative to the
         working directory, and any other relative path is searched on include_path
         (whose default "." is the working directory) before the including file's
         own directory. Neither is stated by the snapshot, so a literal relative
         path is a candidate. Only __DIR__ and dirname(__FILE__) anchor a path to
         the including file. https://www.php.net/manual/en/function.include.php */
      if (fact.form === "php-include") {
        if (fact.anchor === "file-dir") {
          const target = joinRelative(dir, String(fact.path || ""));
          if (!target || !fileMap.has(target)) return unresolved(`${fact.via} anchors the include to ${dir || "the snapshot root"}, and ${target || fact.path} is not included in this snapshot`, "php-include-file-dir");
          const proof = { anchor: fact.via, relativeTo: dir || "the snapshot root", path: fact.path };
          if (fact.caveat) return { status: "candidate", targets: [target], reason: `${spec} names ${target}, but ${fact.caveat}`, engine: "semantic-project", rule: "php-include-file-dir", proof };
          return resolved([target], "php-include-file-dir", proof);
        }
        if (/^(?:\/|[A-Za-z]:|[a-z][\w+.-]*:\/\/)/.test(spec)) return unresolved(`${spec} is an absolute path or stream wrapper outside the snapshot`, "php-include-absolute");
        const explicit = /^\.\.?\//.test(spec);
        const hits = [joinRelative(dir, spec), joinRelative("", spec)].filter(candidate => candidate && fileMap.has(candidate));
        const rule = explicit ? "php-include-working-directory" : "php-include-include-path";
        const why = explicit
          ? `${spec} is relative to the working directory of the running script, which no file in the snapshot states`
          : `${spec} is searched on include_path (default ".", the working directory) before the including file's directory, and neither include_path nor the working directory is stated`;
        if (hits.length) return suffixCandidate(hits, rule, why);
        return unresolved(`No included file is ${spec} relative to ${dir || "the snapshot root"} or the snapshot root; ${why}`, rule);
      }
      /* Lua require without a declared search path: the default package.path
         templates "./?.lua;./?/init.lua" are relative to the working directory of
         the process, which the snapshot does not state.
         https://www.lua.org/manual/5.4/manual.html#pdf-package.path */
      if (fact.form === "lua-require") {
        const rel = spec.replace(/\./g, "/");
        const hits = [...new Set([rel + ".lua", rel + "/init.lua"].flatMap(stem => [joinRelative(dir, stem), joinRelative("", stem)]).filter(candidate => candidate && fileMap.has(candidate)))];
        /* The module tree often lives below the snapshot root (data/core/common.lua
           for require "core.common", run with data/ on package.path). Every file
           whose path ends in the module path is a candidate when there are few;
           package.path is set by the running process, so none is proven. */
        const rootOf = (file, tail) => file.slice(0, file.length - tail.length).replace(/\/$/, "");
        const found = [rel + ".lua", rel + "/init.lua"].flatMap(tail => pathsEnding(tail).map(file => ({ file, root: rootOf(file, tail) })));
        const tails = [...new Set(found.map(item => item.file))].sort();
        if (tails.length > hits.length && tails.length <= LUA_SUFFIX_LIMIT) return suffixCandidate(tails, "lua-require-path-suffix",
          `${listed(tails)} end${tails.length === 1 ? "s" : ""} in the module path of ${spec}, so ${tails.length === 1 ? "it is" : "each is"} found only if the running package.path holds ?.lua or ?/init.lua under ${listed([...new Set(found.map(item => item.root || "the snapshot root"))])}; no rockspec build.modules, .luarc.json runtime.path or package.path assignment declares that`);
        if (hits.length) return suffixCandidate(hits, "lua-require-default-path",
          `${spec} matches the default package.path templates ./?.lua and ./?/init.lua only if the process runs from ${listed([...new Set(hits.map(dirOf))].map(item => item || "the snapshot root"))}; no rockspec build.modules, .luarc.json runtime.path or package.path assignment declares where ${spec} is found`);
        return { targets: [], reason: tails.length ? `${tails.length} included files end in the module path of ${spec}, more than the ${LUA_SUFFIX_LIMIT} a candidate set may hold, and no declaration says which directory package.path searches` : "No rockspec, .luarc.json or package.path declaration supplies this module and no included file matches the default templates", external: { name: spec, kind: "module", specifier: spec } };
      }
      /* Bash `source`/`.`: a path containing a slash is opened relative to the
         working directory, and a bare name is searched on PATH first and then the
         working directory. Only ${BASH_SOURCE[0]}-based directories name the
         sourcing file's own directory.
         https://www.gnu.org/software/bash/manual/bash.html#index-source */
      if (fact.form === "shell-source") {
        if (fact.anchor === "script-dir") return shellScriptDir(path, fact, spec, new Set());
        if (spec.startsWith("/") || spec.startsWith("~")) return unresolved(`${spec} is an absolute path outside the snapshot`, "shell-source-absolute");
        const slash = spec.includes("/");
        const hits = [joinRelative(dir, spec), joinRelative("", spec)].filter(candidate => candidate && fileMap.has(candidate));
        const rule = slash ? "shell-source-working-directory" : "shell-source-path-search";
        const why = slash
          ? `${spec} is opened relative to the working directory of the shell, which no file in the snapshot states`
          : `a bare name is searched on PATH before the working directory, and neither is stated by the snapshot`;
        if (hits.length) return suffixCandidate(hits, rule, why);
        return unresolved(`No included file is ${spec} relative to ${dir || "the snapshot root"} or the snapshot root; ${why}`, rule);
      }
      if (fact.form === "swift-import") {
        const name = spec.split(".").pop();
        const hits = files.filter(file => file === name + ".swift" || file.endsWith("/" + name + ".swift"));
        if (hits.length === 1) return suffixCandidate(hits, "swift-import-included-path",
          `${hits[0]} is named like the module ${spec}, but a Swift module is a target, and no Package.swift declares one here; a file name is not a module`);
        if (hits.length > 1) return ambiguous(hits, "swift-import-included-path", "Ambiguous local Swift module file");
        return { targets: [], reason: "Swift import is not a unique included file", external: { name: spec, kind: "module", specifier: spec } };
      }
      if (fact.form === "php-use") {
        const stem = spec.replace(/\\/g, "/");
        const hits = [...new Set([joinRelative(dir, stem + ".php"), joinRelative("", stem + ".php"), ...pathsEnding(stem.split("/").pop() + ".php")].filter(candidate => candidate && fileMap.has(candidate)))];
        if (hits.length === 1) return suffixCandidate(hits, "php-use-included-path",
          `${hits[0]} matches the name ${spec}, but no composer.json autoload map is read, so the class-to-file mapping is not stated`);
        if (hits.length > 1) return ambiguous(hits, "php-use-included-path", `Ambiguous PHP use ${spec}`);
        return { targets: [], reason: "PHP use is not a unique included file", external: { name: spec, kind: "module", specifier: spec } };
      }
      return null;
    }
    return function resolve(path, fact) {
      const result = resolveFact(path, fact);
      if (!result || result.status) return result;
      // Forms without a dedicated language rule report the generic project lookup
      // they ran: one included path is resolved and several are competing candidates.
      // Finding nothing is not a verdict here, so it stays unhandled and the next
      // resolver (for example the go.mod or JVM source-layout rules) still decides.
      return { ...result, status: result.targets.length === 1 ? "resolved" : result.targets.length ? "candidate" : "unhandled", engine: "semantic-project", rule: fact.form + "-included-path" };
    };
  }

  function localCallEdges(fileMap, limits = {}) {
    const max = Number(limits.maxEdges) || 100000;
    const extra = [];
    for (const [path, value] of fileMap) {
      const language = value.node?.language || value.entry?.language;
      if (["python", "javascript", "typescript", "tsx", "jsx", "julia"].includes(language)) continue;
      const calls = value.facts?.structure?.calls || [];
      const symbols = value.facts?.symbols || [];
      const byName = new Map();
      for (const [index, symbol] of symbols.entries()) {
        if (!["function", "method", "class", "struct"].includes(symbol.kind)) continue;
        const list = byName.get(symbol.name) || [];
        list.push({ index, symbol });
        byName.set(symbol.name, list);
      }
      for (const call of calls) {
        // A call another resolver already bound to a proven target has no competing candidate.
        if (call.resolution?.kind && call.resolution.kind !== "unresolved" || limits.skip?.has(call)) continue;
        const matches = byName.get(call.name) || [];
        if (matches.length === 1 && value.symbolNodes?.get(matches[0].index)) {
          extra.push({
            path,
            fromOwner: call.owner,
            toIndex: matches[0].index,
            name: call.name,
            line: call.line,
            endLine: call.endLine,
            resolution: "candidate",
            reasonCode: "unique-same-file-name",
          });
        } else if (!matches.length) {
          extra.push({
            path, fromOwner: call.owner, toIndex: null, name: call.name, line: call.line, endLine: call.endLine,
            resolution: "unresolved", reasonCode: "no-unique-included-callee",
          });
        } else {
          extra.push({
            path, fromOwner: call.owner, toIndex: null, name: call.name, line: call.line, endLine: call.endLine,
            resolution: "candidate", reasonCode: "ambiguous-same-file-name",
            candidates: matches.map(item => item.index),
          });
        }
        if (extra.length >= max) return extra;
      }
    }
    return extra;
  }

  function projectContextHash(fileMap, ir) {
    const rows = [...fileMap.keys()].sort().map(path => path + "\0" + (fileMap.get(path).node?.language || ""));
    return ir.sha256Text(rows.join("\n"));
  }

  root.SkylenseSemanticProject = Object.freeze({
    LOCAL_FORMS, create, localCallEdges, projectContextHash,
  });
})(typeof window !== "undefined" ? window : globalThis);
