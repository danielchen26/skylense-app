/* Project-aware static module resolution. Ambiguous targets remain unresolved. */
(function (root) {
  "use strict";
  let typescript;
  function configure(options = {}) { if (options.typescript) typescript = options.typescript; }
  function json(text) {
    if (!text) return null;
    let out = "", quote = false, escape = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i], next = text[i + 1];
      if (quote) { out += c; if (escape) escape = false; else if (c === "\\") escape = true; else if (c === '"') quote = false; }
      else if (c === '"') { quote = true; out += c; }
      else if (c === "/" && next === "/") { while (i < text.length && text[i] !== "\n") i++; out += "\n"; }
      else if (c === "/" && next === "*") { i += 2; while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) { out += text[i] === "\n" ? "\n" : " "; i++; } i++; }
      else out += c;
    }
    let clean = ""; quote = false; escape = false;
    for (let i = 0; i < out.length; i++) {
      const c = out[i];
      if (quote) { clean += c; if (escape) escape = false; else if (c === "\\") escape = true; else if (c === '"') quote = false; }
      else if (c === '"') { quote = true; clean += c; }
      else if (c !== "," || !/^[\s]*[}\]]/.test(out.slice(i + 1))) clean += c;
    }
    try { return JSON.parse(clean); } catch { return null; }
  }
  function create(files, { joinRelative, choose }) {
    const dirname = p => p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    const configs = new Map(), packages = [], goModules = [], pythonRoots = new Set();
    for (const [path, file] of files) {
      if (/(?:^|\/)(?:tsconfig|jsconfig)(?:\.[^/]*)?\.json$/.test(path)) configs.set(path, json(file.text));
      if (/(?:^|\/)package\.json$/.test(path)) { const value = json(file.text); if (value?.name) packages.push({ dir: dirname(path), value }); }
      if (/(?:^|\/)go\.mod$/.test(path)) { const name = /^\s*module\s+([^\s/][^\s]*)/m.exec(file.text || "")?.[1]; if (name) goModules.push({ dir: dirname(path), name }); }
      // A Python distribution root below the snapshot root: a directory with its own build
      // manifest. Its import roots are the directory and its src/ layout.
      if (/(?:^|\/)(?:pyproject\.toml|setup\.py|setup\.cfg)$/.test(path) && path.includes("/")) pythonRoots.add(dirname(path));
    }
    const extensions = [".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs", ".json", ".vue", ".svelte"];
    function jsCandidates(path) {
      if (!path) return [];
      const substitution = { ".js": [".ts", ".tsx", ".d.ts", ".js", ".jsx"], ".jsx": [".tsx", ".d.ts", ".jsx"], ".mjs": [".mts", ".d.mts", ".mjs"], ".cjs": [".cts", ".d.cts", ".cjs"] };
      const extension = /\.[^./]+$/.exec(path)?.[0];
      if (substitution[extension]) return substitution[extension].map(e => path.slice(0, -extension.length) + e);
      if (files.has(path)) return [path];
      return [...extensions.map(e => path + e), ...extensions.map(e => path + "/index" + e)];
    }
    const chooseOrdered = candidates => { const target = candidates.find(p => p && files.has(p)); return target ? choose([target]) : choose([]); };
    const unresolved = reason => ({ targets: [], reason });
    const external = specifier => ({ targets: [], external: { name: specifier, kind: "package", specifier }, reason: "Declared external module reference; target source is not indexed" });
    function configFor(path) {
      let dir = dirname(path);
      while (true) {
        for (const name of ["tsconfig.json", "jsconfig.json"]) {
          const configPath = dir ? dir + "/" + name : name;
          if (configs.has(configPath)) return configPath;
        }
        if (!dir) return null; dir = dirname(dir);
      }
    }
    function compilerOptions(path, seen = new Set()) {
      if (!path || seen.has(path)) return {};
      seen.add(path);
      const data = configs.get(path); if (!data) return {};
      const dir = dirname(path); let inherited = {};
      // TypeScript 5 accepts an array of bases; later entries override earlier ones.
      for (const item of Array.isArray(data.extends) ? data.extends : [data.extends]) {
        if (typeof item !== "string" || !item.startsWith(".")) continue;
        const parent = joinRelative(dir, item);
        inherited = { ...inherited, ...compilerOptions(configs.has(parent) ? parent : parent + ".json", seen) };
      }
      const options = data.compilerOptions || {};
      const base = typeof options.baseUrl === "string" ? joinRelative(dir, options.baseUrl) ?? "" : inherited.base ?? dir;
      return { ...inherited, base, ...(options.paths && typeof options.paths === "object" ? { paths: options.paths, pathsBase: base } : {}) };
    }
    // The same bundled compiler resolves imports for both graph construction
    // and semantic calls. The virtual host can only read indexed source files.
    const parsedConfigs = new Map(), moduleResults = new Map(), directories = new Set([""]);
    for (const path of files.keys()) { let dir = dirname(path); while (dir) { directories.add(dir); dir = dirname(dir); } }
    const norm = path => path.replace(/^\//, "").replace(/\/$/, "");
    const host = { fileExists: path => files.has(norm(path)), readFile: path => files.get(norm(path))?.text, directoryExists: path => directories.has(norm(path)), getCurrentDirectory: () => "/", getDirectories: () => [], readDirectory: () => [], useCaseSensitiveFileNames: true };
    function compilerResolve(path, spec) {
      if (!typescript) return null;
      const key = path + "\0" + spec;
      if (moduleResults.has(key)) return moduleResults.get(key);
      const ts = typescript, configPath = configFor(path);
      if (!parsedConfigs.has(configPath)) {
        const defaults = { allowJs: true, checkJs: true, noEmit: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.Preserve };
        const parsed = configPath ? ts.parseJsonConfigFileContent(configs.get(configPath) || {}, host, "/" + dirname(configPath), undefined, "/" + configPath) : { options: {} };
        parsedConfigs.set(configPath, { ...defaults, ...parsed.options });
      }
      const resolved = ts.resolveModuleName(spec, "/" + path, parsedConfigs.get(configPath), host).resolvedModule;
      const target = resolved && norm(resolved.resolvedFileName);
      const result = target && files.has(target) ? { targets: [target] } : null;
      moduleResults.set(key, result);
      return result;
    }
    /** The `paths` entry that claims this specifier, with its substituted candidates.
     *  Project configuration is read as data; nothing from the analyzed project runs. */
    function configuredAlias(config, spec) {
      for (const [pattern, targets] of Object.entries(config.paths || {}).sort(([a], [b]) => Number(b === spec) - Number(a === spec) || b.split("*")[0].length - a.split("*")[0].length)) {
        const [before, after = ""] = pattern.split("*"), star = pattern.includes("*");
        if (star ? !spec.startsWith(before) || !spec.endsWith(after) : spec !== pattern) continue;
        const captured = star ? spec.slice(before.length, after ? -after.length : undefined) : "";
        const substitutions = (Array.isArray(targets) ? targets : []).filter(t => typeof t === "string").map(t => joinRelative(config.pathsBase, t.replace("*", captured))).filter(Boolean);
        return { pattern, substitutions };
      }
      return null;
    }
    // A `paths` pattern maps a specifier into the project's own source tree. When the
    // mapped file is not in the snapshot the specifier is an unresolved local module,
    // never an external package: inventing a dependency would hide the miss.
    const aliasMiss = alias => unresolved(`The configured path alias "${alias.pattern}" maps this specifier to ${alias.substitutions.join(", ") || "no path"}, which is not an included file`);
    const SCRIPT_FILE = /\.(?:[cm]?[jt]sx?)$/;
    /* js-relative-exact-source-extension. A relative specifier that spells a
       TypeScript-only source extension (`./auth.server.ts`, `.tsx`, `.mts`, `.cts`)
       that names an included file exactly offers that file as a candidate, never a
       binding: which configuration governs a file is open-world. moduleSuffixes can
       send `./x.ts` to `x.ios.ts` from any tsconfig whose `include` reaches the file —
       one in a dropped or ignored directory, or a project reference that is never
       read — and a bundler alias (vite, webpack), a Deno import map or URL decoding of
       a `%` escape can remap a relative specifier with nothing in the snapshot that
       proves their absence. The compiler's pick is offered too when it differs.
       Returns null when the rule does not apply. */
    function exactSourceExtension(path, spec) {
      if (!/^\.\.?\//.test(spec) || !/\.(?:[cm]?ts|tsx)$/.test(spec) || /\.d\.(?:[cm]?ts|tsx)$/.test(spec) || /[?#]/.test(spec) || !SCRIPT_FILE.test(path)) return null;
      const target = joinRelative(dirname(path), spec);
      if (!target || !files.has(target)) return null;
      return { targets: [...new Set([target, ...(compilerResolve(path, spec)?.targets || [])])], status: "candidate", engine: "source-resolver", rule: "js-relative-exact-source-extension",
        reasonCode: "js-relative-exact-source-extension-unproven",
        reason: `${target} is the file this specifier spells, but the binding is unproven: a tsconfig anywhere (moduleSuffixes), a bundler alias or an import map can redirect a relative specifier, and which of them governs this file is not established by the snapshot` };
    }
    /** The first `extends` of this config chain that is not an included, readable
     *  file: a package specifier (node_modules is never read) or a missing relative file. */
    function unreadableExtends(configPath, seen = new Set()) {
      if (!configPath || seen.has(configPath)) return null;
      seen.add(configPath);
      const data = configs.has(configPath) ? configs.get(configPath) : files.has(configPath) ? json(files.get(configPath).text) : undefined;
      if (!data || typeof data !== "object") return { config: configPath, extends: configPath };
      const list = data.extends === undefined ? [] : Array.isArray(data.extends) ? data.extends : [data.extends];
      for (const item of list) {
        if (typeof item !== "string" || !item.startsWith(".")) return { config: configPath, extends: String(item) };
        const parent = joinRelative(dirname(configPath), item);
        const found = parent !== null && (files.has(parent) ? parent : files.has(parent + ".json") ? parent + ".json" : null);
        if (!found) return { config: configPath, extends: item };
        const deeper = unreadableExtends(found, seen);
        if (deeper) return deeper;
      }
      return null;
    }
    /** One key of a package.json "imports"/"exports" map, picked as Node does:
     *  an exact key, else the star pattern with the longest prefix. */
    function matchSubpathKey(map, spec) {
      if (Object.hasOwn(map, spec) && !spec.includes("*")) return { key: spec, captured: null };
      let best = null;
      for (const key of Object.keys(map)) {
        const star = key.indexOf("*");
        if (star < 0 || key.indexOf("*", star + 1) >= 0) continue;
        const before = key.slice(0, star), after = key.slice(star + 1);
        if (!spec.startsWith(before) || spec === before || spec.length < key.length || !spec.endsWith(after)) continue;
        if (!best || before.length > best.before.length || (before.length === best.before.length && key.length > best.key.length)) best = { key, before, captured: spec.slice(before.length, spec.length - after.length) };
      }
      return best;
    }
    /** The single string a conditional target reaches whatever the active conditions:
     *  every leaf names the same path. Arrays, null leaves and disagreeing leaves are not one. */
    function unconditionalTarget(value) {
      if (typeof value === "string") return value;
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const leaves = new Set();
      const walk = node => {
        if (typeof node === "string") { leaves.add(node); return true; }
        if (!node || typeof node !== "object" || Array.isArray(node)) return false;
        const keys = Object.keys(node);
        return keys.length > 0 && keys.every(key => !/^\d+$/.test(key) && walk(node[key]));
      };
      return walk(value) && leaves.size === 1 ? [...leaves][0] : null;
    }
    const INVALID_SEGMENT = /(?:^|\/)(?:\.|\.\.|node_modules)(?:\/|$)/i;
    /* js-package-imports. A `#` specifier is looked up in the "imports" map of the
       importer's package scope — the nearest package.json above it (Node's
       PACKAGE_IMPORTS_RESOLVE; tsc follows the same map under node16/nodenext/bundler).
       This rule never binds: the governing package.json can be one the snapshot left
       out, tsc consults `paths` and `baseUrl` (of whichever config governs the file)
       first, compiles against the TypeScript source while the runtime loads the
       emitted output, and resolves conditions, trailing-slash folder keys and pattern
       precedence differently per tool. So when one exact or single-star key matches
       a "./" target with no ".", ".." or node_modules segment that is an included
       file, that file is offered as a candidate: with the most specific reason the
       snapshot shows, else `js-package-imports-unproven`. Returns null when the rule
       does not apply. */
    function packageImports(path, spec) {
      if (!spec.startsWith("#") || spec === "#" || spec.startsWith("#/") || !SCRIPT_FILE.test(path)) return null;
      let dir = dirname(path), scope = null;
      while (true) {
        const manifest = dir ? dir + "/package.json" : "package.json";
        if (files.has(manifest)) { scope = { dir, manifest, value: json(files.get(manifest).text) }; break; }
        if (!dir) break; dir = dirname(dir);
      }
      const map = scope?.value?.imports;
      if (!map || typeof map !== "object" || Array.isArray(map)) return null;
      const match = matchSubpathKey(map, spec);
      if (!match) return null;
      const candidate = (reasonCode, reason, targets = []) => ({ targets, status: "candidate", engine: "source-resolver", rule: "js-package-imports", reasonCode, reason });
      const raw = unconditionalTarget(map[match.key]);
      if (raw === null) return candidate("package-imports-conditional", `The "imports" entry "${match.key}" in ${scope.manifest} depends on which resolver conditions are active, and they are not evaluated`);
      if (!raw.startsWith("./") || INVALID_SEGMENT.test(raw.slice(2)) || (match.captured !== null && INVALID_SEGMENT.test(match.captured))) return null;
      const target = joinRelative(scope.dir, match.captured === null ? raw : raw.replaceAll("*", match.captured));
      if (!target || !files.has(target)) return null;
      const siblings = jsCandidates(target).filter(p => p !== target && files.has(p));
      if (siblings.length) return candidate("package-imports-source-substitution", `${target} is the "imports" target, but the compiler substitutes ${siblings[0]} for it, so the type-checked and the run file differ`, [target]);
      const configPath = configFor(path);
      const blocked = unreadableExtends(configPath);
      if (blocked) return candidate("tsconfig-extends-unreadable", `${blocked.config} extends "${blocked.extends}", which is not an included file, so the \`paths\` it may contribute (tried before package imports) are unknown`, [target]);
      const config = compilerOptions(configPath);
      const alias = configuredAlias(config, spec);
      if (alias) return candidate("tsconfig-paths-precedes-imports", `The path alias "${alias.pattern}" in ${configPath} claims this specifier before package imports are consulted`, [target]);
      if (config.base !== undefined && chooseOrdered(jsCandidates(joinRelative(config.base, spec))).targets.length) return candidate("tsconfig-baseurl-precedes-imports", `A file under baseUrl answers this specifier before package imports are consulted`, [target]);
      return candidate("js-package-imports-unproven", `${target} is what the "imports" entry "${match.key}" in ${scope.manifest} names, but subpath-import binding is unproven: a left-out package.json, the config that governs this file, emitted output and per-tool condition and pattern rules can each send it elsewhere`, [target]);
    }
    function javascript(path, spec) {
      const dir = dirname(path);
      const exact = exactSourceExtension(path, spec) || packageImports(path, spec);
      if (exact) return exact;
      const compiled = compilerResolve(path, spec);
      if (compiled) return compiled;
      const config = compilerOptions(configFor(path));
      const alias = spec.startsWith(".") ? null : configuredAlias(config, spec);
      // Framework source extensions are not resolved by TypeScript itself.
      // Otherwise its failure is authoritative once the compiler is available.
      if (typescript && !/\.(?![cm]?[jt]sx?$)[^./]+$/.test(spec)) {
        if (alias) return aliasMiss(alias);
        if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("#") || /^[@~]\//.test(spec)) return unresolved("The included project configuration does not resolve this source module");
        return jsWorkspacePackage(path, spec) || external(spec);
      }
      if (spec.startsWith(".")) return chooseOrdered(jsCandidates(joinRelative(dir, spec)));
      if (alias) {
        const result = chooseOrdered(alias.substitutions.flatMap(jsCandidates));
        return result.targets.length ? result : aliasMiss(alias);
      }
      if (config.base !== undefined) { const result = chooseOrdered(jsCandidates(joinRelative(config.base, spec))); if (result.targets.length) return result; }
      for (const { dir: packageDir, value } of packages) {
        if (spec !== value.name && !spec.startsWith(value.name + "/")) continue;
        const sub = spec.slice(value.name.length).replace(/^\//, "");
        return chooseOrdered(packageEntries(value, sub).flatMap(t => jsCandidates(joinRelative(packageDir, t))));
      }
      if (spec.startsWith("/") || spec.startsWith("#") || /^[@~]\//.test(spec)) return unresolved("Unconfigured local path alias");
      return external(spec);
    }
    /** The entry files a package.json names for `sub` (empty: the package itself). */
    function packageEntries(value, sub) {
      const exportValue = typeof value.exports === "string" ? !sub && value.exports : value.exports?.[sub ? "./" + sub : "."];
      return typeof exportValue === "string" ? [exportValue] : exportValue && typeof exportValue === "object" ? Object.values(exportValue).filter(v => typeof v === "string") : sub ? [sub] : [value.source, value.module, value.main, "index"].filter(v => typeof v === "string");
    }
    /* A bare JS/TS specifier that names a package.json below the snapshot root: a
       workspace package of a monorepo. A package manager links it into node_modules,
       which is never read, so whether that copy is the one the build uses is not
       evaluated: each source file it reaches is a candidate, never a resolved relation. */
    function jsWorkspacePackage(path, spec) {
      const found = new Set(), dirs = [];
      for (const { dir, value } of packages) {
        if (!dir || (spec !== value.name && !spec.startsWith(value.name + "/"))) continue;
        const sub = spec.slice(value.name.length).replace(/^\//, "");
        // A built entry (dist/…) is not in the source tree; its source layout stands in.
        const entries = [...packageEntries(value, sub), ...(sub ? ["src/" + sub] : ["src/index", "index"])];
        const target = entries.flatMap(t => jsCandidates(joinRelative(dir, t))).find(p => p && files.has(p));
        if (target) { found.add(target); dirs.push(dir); }
      }
      const targets = [...found].filter(target => target !== path).sort();
      if (!targets.length || targets.length > SIBLING_TARGETS) return null;
      return { targets, status: "candidate", engine: "source-resolver", rule: "js-workspace-package", reasonCode: "sibling-package",
        reason: `${spec} is the name of the package.json in ${dirs.sort().join(" and ")} inside the snapshot; a package manager links it through node_modules, which is not read, so which copy the build uses is not evaluated` };
    }
    /* An absolute Python import that no file at the snapshot root provides, but that a
       distribution root inside the snapshot (a directory with its own pyproject.toml,
       setup.py or setup.cfg) does: a monorepo's sibling package, or a package whose source
       sits below the root. Whether that distribution is the one installed is not evaluated,
       so every match is a candidate, never a resolved relation. */
    const SIBLING_TARGETS = 4;
    function pythonSiblingPackage(path, module, names) {
      if (!pythonRoots.size || !module) return null;
      const stems = [...pythonRoots].sort().flatMap(dir => [dir, dir + "/src"]).map(prefix => prefix + "/" + module.replace(/\./g, "/"));
      const found = new Set();
      for (const stem of stems) {
        const direct = [stem + ".py", stem + "/__init__.py"].filter(p => files.has(p));
        for (const target of direct) found.add(target);
        if (direct.length) continue;
        for (const name of names || []) if (name !== "*") for (const sub of [stem + "/" + name + ".py", stem + "/" + name + "/__init__.py"]) if (files.has(sub)) found.add(sub);
      }
      const targets = [...found].filter(target => target !== path).sort();
      if (!targets.length || targets.length > SIBLING_TARGETS) return null;
      return { targets, status: "candidate", engine: "source-resolver", rule: "python-sibling-package-root", reasonCode: "sibling-package",
        reason: `${module} is not provided at the snapshot root; ${targets.length === 1 ? "a package" : `${targets.length} packages`} below a distribution root inside the snapshot provide${targets.length === 1 ? "s" : ""} it, and which distribution is installed is not evaluated` };
    }
    return function resolve(path, fact) {
      const spec = fact.specifier || "", form = fact.form || "", dir = dirname(path);
      // A computed specifier has no static target. Saying so is the answer; a
      // path guess from surrounding text would be an invented relationship.
      if (["dynamic-expression", "commonjs-expression"].includes(form))
        return unresolved(`The module specifier is the expression \`${spec}\`, whose value is only known when the program runs; no code was executed, so this reference has no static target`);
      if (["javascript-static", "js-import", "javascript-import", "dynamic-literal", "commonjs-literal"].includes(form)) return javascript(path, spec);
      if (form.startsWith("python")) {
        let module = spec, prefixes = ["", "src"];
        if (module.startsWith(".")) {
          const dots = module.match(/^\.+/)[0].length, parts = dir ? dir.split("/") : [];
          if (dots > parts.length + (files.has("__init__.py") ? 1 : 0)) return unresolved("Relative import escapes source root");
          prefixes = [parts.slice(0, parts.length - dots + 1).join("/")]; module = module.slice(dots);
        }
        const stems = prefixes.map(prefix => [prefix, module.replace(/\./g, "/")].filter(Boolean).join("/"));
        const direct = choose(stems.flatMap(stem => [stem + ".py", (stem ? stem + "/" : "") + "__init__.py"]));
        // Python checks attributes already bound by the imported module before
        // trying a same-named submodule. Never turn a known value into a file edge.
        const bindings = new Set(); let dynamic = false;
        for (const target of direct.targets) {
          const file = files.get(target), facts = file?.facts || file?.syntaxFacts || file?.entry?.syntaxFacts;
          for (const name of facts?.moduleBindings || []) bindings.add(name);
          for (const symbol of facts?.symbols || []) if (symbol.parent == null) bindings.add(symbol.name);
          dynamic ||= !!facts?.moduleBindingsDynamic;
        }
        const sub = form === "python-from" && !dynamic ? (fact.names || []).filter(n => n !== "*" && !bindings.has(n)).flatMap(name => stems.flatMap(stem => { const base = (stem ? stem + "/" : "") + name; return [base + ".py", base + "/__init__.py"]; })).filter(p => files.has(p)) : [];
        if (direct.targets.length || sub.length) return { targets: [...new Set([...direct.targets, ...sub])] };
        if (direct.reason === "Ambiguous local resolution") return direct;
        if (!spec.startsWith(".")) { const sibling = pythonSiblingPackage(path, module, form === "python-from" ? fact.names : []); if (sibling) return sibling; }
        return spec.startsWith(".") ? direct : external(spec);
      }
      if (form === "go-import") {
        // The longest declared module path wins, as nested modules shadow their parent.
        // When two included go.mod files declare the same path, the importing file's
        // own go.mod answers: a copy elsewhere is not the module this file builds in.
        const own = goModules.filter(item => !item.dir || path === item.dir || path.startsWith(item.dir + "/")).sort((a, b) => b.dir.length - a.dir.length)[0];
        const matches = goModules.filter(item => spec === item.name || spec.startsWith(item.name + "/"));
        const longest = Math.max(-1, ...matches.map(item => item.name.length));
        const tied = matches.filter(item => item.name.length === longest);
        const mod = tied.includes(own) ? own : tied[0];
        if (mod) {
          const packageDir = joinRelative(mod.dir, spec.slice(mod.name.length).replace(/^\//, "")) ?? mod.dir;
          const targets = [...files.keys()].filter(p => dirname(p) === packageDir && p.endsWith(".go") && !p.endsWith("_test.go"));
          if (!targets.length && (own === mod || tied.length === 1)) return unresolved("Go package is within this module but its source files are unavailable");
          // A package of the importing file's own module is what go.mod proves. Another
          // module is used only through a require/replace or go.work entry, none of
          // which is evaluated here, so its package is a candidate.
          // A Go import names a package, not a file. A one-file package is that file;
          // a package of several files is a candidate set over its files, since the
          // import alone does not say which file holds what the importer uses.
          if (own === mod) return targets.length === 1
            ? { targets, status: "resolved", engine: "source-resolver", rule: "go-module-path-own-module", proof: { module: mod.name, goMod: joinRelative(mod.dir, "go.mod") ?? "go.mod", package: packageDir || "." } }
            : { targets, status: "candidate", engine: "source-resolver", rule: "go-module-path-package-files",
              reason: `${spec} is the package ${packageDir || "."} of ${mod.name}, the module of ${path}; the import names the package, which has ${targets.length} source files, so each file is a candidate rather than a proven target` };
          // When several go.mod files declare this path and none is the importer's own,
          // each copy is equally possible: offer every tied package, not the first by path order.
          const copies = tied.map(item => ({ item, dir: joinRelative(item.dir, spec.slice(item.name.length).replace(/^\//, "")) ?? item.dir }));
          const tiedTargets = [...new Set(copies.flatMap(copy => [...files.keys()].filter(p => dirname(p) === copy.dir && p.endsWith(".go") && !p.endsWith("_test.go"))))].sort();
          const declaredBy = tied.map(item => joinRelative(item.dir, "go.mod") ?? "go.mod");
          if (!tiedTargets.length) return unresolved("Go package is within this module but its source files are unavailable");
          return { targets: tiedTargets, status: "candidate", engine: "source-resolver", rule: "go-module-path-other-module",
            reason: `${spec} is in the module ${mod.name} declared by ${declaredBy.join(" and ")}, not in ${own ? `${own.name}, the module of ${path}` : `a module that contains ${path}`}; require, replace and go.work entries are not evaluated, so which copy the build uses is not established` };
        }
        return external(spec);
      }
      // Rust module files and C# namespaces are resolved by the language adapter
      // in src/semantic-project.js, which owns the module-file and namespace-identity
      // rules. This resolver reports them as unhandled so a weaker path or basename
      // lookup here can never override the adapter's verdict.
      if (["c-include", "cpp-include"].includes(form)) {
        const result = choose([joinRelative(dir, spec), spec, "include/" + spec]);
        return result.targets.length ? result : fact.system ? external(spec) : result;
      }
      if (["java-import", "kotlin-import", "scala-import"].includes(form)) {
        const stem = spec.replace(/\./g, "/"), ext = form === "java-import" ? ".java" : form === "kotlin-import" ? ".kt" : ".scala";
        const result = choose([stem + ext, "src/" + stem + ext, "src/main/" + form.split("-")[0] + "/" + stem + ext]);
        return result.targets.length ? result : external(spec);
      }
      if (form === "ruby-relative") return choose([joinRelative(dir, spec), joinRelative(dir, spec + ".rb")]);
      if (form === "ruby-require") { const result = choose([spec, spec + ".rb", "lib/" + spec + ".rb"]); return result.targets.length ? result : external(spec); }
      if (form === "php-include" || form === "shell-source") return choose([joinRelative(dir, spec), spec]);
      if (form === "lua-require") { const stem = spec.replace(/\./g, "/"), result = choose([stem + ".lua", stem + "/init.lua", joinRelative(dir, stem + ".lua")]); return result.targets.length ? result : external(spec); }
      if (form === "css-import") return choose([joinRelative(dir, spec)]);
      if (form === "swift-import") {
        const name = spec.split(".").pop();
        const result = choose([...files.keys()].filter(p => p === name + ".swift" || p.endsWith("/" + name + ".swift")));
        return result.targets.length ? result : external(spec);
      }
      if (form === "php-use") {
        const stem = spec.replace(/\\/g, "/");
        const result = choose([stem + ".php", "src/" + stem + ".php"]);
        return result.targets.length ? result : external(spec);
      }
      if (form === "markdown-link" || form === "md-link") {
        const clean = spec.split(/[?#]/)[0];
        if (!clean || /^(?:[a-z][\w+.-]*:|\/|#)/i.test(clean)) return external(spec);
        // A link is read relative to the document that holds it; that exact path is
        // its target. The same path from the snapshot root is only a guess.
        const own = joinRelative(dir, clean);
        if (own && files.has(own)) return { targets: [own], status: "resolved", engine: "source-resolver", rule: "markdown-link-document-relative" };
        const guess = choose([clean]);
        return guess.targets.length
          ? { ...guess, status: "candidate", engine: "source-resolver", rule: "markdown-link-root-guess", reason: `${guess.targets[0]} is the link's path read from the snapshot root, not relative to ${path}, which is how the link is resolved` }
          : guess;
      }
      if (["php-use", "swift-import"].includes(form)) return external(spec);
      return null;
    };
  }
  root.SkylenseSourceResolver = { create, configure };
})(typeof window !== "undefined" ? window : globalThis);
