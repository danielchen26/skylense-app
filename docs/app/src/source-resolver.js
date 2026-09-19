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
    const configs = new Map(), packages = [], goModules = [];
    for (const [path, file] of files) {
      if (/(?:^|\/)(?:tsconfig|jsconfig)(?:\.[^/]*)?\.json$/.test(path)) configs.set(path, json(file.text));
      if (/(?:^|\/)package\.json$/.test(path)) { const value = json(file.text); if (value?.name) packages.push({ dir: dirname(path), value }); }
      if (/(?:^|\/)go\.mod$/.test(path)) { const name = /^\s*module\s+([^\s/][^\s]*)/m.exec(file.text || "")?.[1]; if (name) goModules.push({ dir: dirname(path), name }); }
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
      if (typeof data.extends === "string" && data.extends.startsWith(".")) {
        const parent = joinRelative(dir, data.extends);
        inherited = compilerOptions(configs.has(parent) ? parent : parent + ".json", seen);
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
    function javascript(path, spec) {
      const dir = dirname(path);
      const compiled = compilerResolve(path, spec);
      if (compiled) return compiled;
      // Framework source extensions are not resolved by TypeScript itself.
      // Otherwise its failure is authoritative once the compiler is available.
      if (typescript && !/\.(?![cm]?[jt]sx?$)[^./]+$/.test(spec)) return spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("#") || /^[@~]\//.test(spec) ? unresolved("The included project configuration does not resolve this source module") : external(spec);
      if (spec.startsWith(".")) return chooseOrdered(jsCandidates(joinRelative(dir, spec)));
      const config = compilerOptions(configFor(path));
      for (const [pattern, targets] of Object.entries(config.paths || {}).sort(([a], [b]) => Number(b === spec) - Number(a === spec) || b.split("*")[0].length - a.split("*")[0].length)) {
        const [before, after = ""] = pattern.split("*"), star = pattern.includes("*");
        if (star ? !spec.startsWith(before) || !spec.endsWith(after) : spec !== pattern) continue;
        const captured = star ? spec.slice(before.length, after ? -after.length : undefined) : "";
        const candidates = (Array.isArray(targets) ? targets : []).filter(t => typeof t === "string").flatMap(t => jsCandidates(joinRelative(config.pathsBase, t.replace("*", captured))));
        return chooseOrdered(candidates);
      }
      if (config.base !== undefined) { const result = chooseOrdered(jsCandidates(joinRelative(config.base, spec))); if (result.targets.length) return result; }
      for (const { dir: packageDir, value } of packages) {
        if (spec !== value.name && !spec.startsWith(value.name + "/")) continue;
        const sub = spec.slice(value.name.length).replace(/^\//, "");
        const exportValue = typeof value.exports === "string" ? !sub && value.exports : value.exports?.[sub ? "./" + sub : "."];
        const targets = typeof exportValue === "string" ? [exportValue] : exportValue && typeof exportValue === "object" ? Object.values(exportValue).filter(v => typeof v === "string") : sub ? [sub] : [value.source, value.module, value.main, "index"].filter(v => typeof v === "string");
        return chooseOrdered(targets.flatMap(t => jsCandidates(joinRelative(packageDir, t))));
      }
      if (spec.startsWith("/") || spec.startsWith("#") || /^[@~]\//.test(spec)) return unresolved("Unconfigured local path alias");
      return external(spec);
    }
    return function resolve(path, fact) {
      const spec = fact.specifier || "", form = fact.form || "", dir = dirname(path);
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
        return spec.startsWith(".") ? direct : external(spec);
      }
      if (form === "go-import") {
        for (const mod of goModules) if (spec === mod.name || spec.startsWith(mod.name + "/")) {
          const packageDir = joinRelative(mod.dir, spec.slice(mod.name.length).replace(/^\//, "")) ?? mod.dir;
          const targets = [...files.keys()].filter(p => dirname(p) === packageDir && p.endsWith(".go") && !p.endsWith("_test.go"));
          return targets.length ? { targets } : unresolved("Go package is within this module but its source files are unavailable");
        }
        return external(spec);
      }
      if (form === "rust-mod") {
        const base = /(?:^|\/)(?:mod|lib|main)\.rs$/.test(path) ? dir : path.replace(/\.rs$/, "");
        return choose([joinRelative(base, spec + ".rs"), joinRelative(base, spec + "/mod.rs")]);
      }
      if (form === "rust-use") {
        if (!/^(?:crate|self|super)::/.test(spec)) return external(spec);
        let base = dir;
        if (spec.startsWith("crate::")) { let cursor = dir; while (cursor && !files.has(cursor + "/Cargo.toml")) cursor = dirname(cursor); base = (cursor ? cursor + "/" : "") + "src"; }
        else if (spec.startsWith("super::")) base = dirname(dir);
        const names = spec.replace(/^(?:crate|self|super)::/, "").split("::").filter(n => /^\w+$/.test(n));
        while (names.length) { const stem = joinRelative(base, names.join("/")); const result = choose([stem + ".rs", stem + "/mod.rs"]); if (result.targets.length) return result; names.pop(); }
        return unresolved("Rust module path cannot be uniquely resolved from included files");
      }
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
      if (["php-use", "csharp-using", "swift-import"].includes(form)) return external(spec);
      return null;
    };
  }
  root.SkylenseSourceResolver = { create, configure };
})(typeof window !== "undefined" ? window : globalThis);
