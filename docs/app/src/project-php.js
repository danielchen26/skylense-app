/* PHP project binding from composer.json autoload declarations.
 *
 * PHP has no import of files by name: `use App\Models\User;` only introduces an
 * alias, and the class is loaded when first used, by whatever autoloader is
 * registered. In a Composer project that autoloader is generated from the
 * package's own `autoload` and `autoload-dev` maps, so the class-to-file mapping
 * is a declaration that can be read as data:
 *   psr-4     "App\\": "src/"     App\Models\User -> src/Models/User.php
 *   psr-0     "Acme_": "lib/"     Acme_Util_Str   -> lib/Acme/Util/Str.php
 *   classmap  ["database/"]       every class declared in a scanned file
 *   files     ["src/helpers.php"] always included; supplies namespaced functions
 * A name binds only when the maps yield exactly one existing file and that file
 * declares the name. Several files, a file that does not declare the class, or an
 * unreadable entry stay a candidate or a stated refusal. Nothing is executed: no
 * vendor/autoload.php, no Composer plugin, no generated classmap is read.
 *
 * Packages in the snapshot that the root requires through a `path` repository
 * contribute their `autoload` map (never their `autoload-dev`, which Composer
 * applies to the root package only).
 * References: https://getcomposer.org/doc/04-schema.md#autoload
 *             https://www.php-fig.org/psr/psr-4/  https://www.php-fig.org/psr/psr-0/
 *             https://getcomposer.org/doc/05-repositories.md#path
 *             https://www.php.net/manual/en/language.namespaces.rules.php
 */
(function (root) {
  "use strict";
  const manifests = root.SkylenseProjectManifests;
  if (!manifests) throw new Error("src/project-manifests.js must load before this family.");
  const { joinPath, contains, parseJson } = manifests;

  const CLASS_KINDS = new Set(["class", "interface", "enum", "trait"]);
  const asList = value => (Array.isArray(value) ? value : [value]);

  /**
   * What one composer.json states, independently of any snapshot.
   * `{ readable, name, requires: Set, entries: [{ kind, prefix?, path, dev }], exclude: [glob], repositories: [url], unread: [reason] }`
   * with paths relative to the composer.json directory.
   */
  function autoloadMap(text) {
    const data = parseJson(text);
    const out = { readable: false, name: null, requires: new Set(), entries: [], exclude: [], repositories: [], unread: [] };
    if (!data || typeof data !== "object" || Array.isArray(data)) { out.unread.push("composer.json could not be parsed as JSON"); return out; }
    out.readable = true;
    out.name = typeof data.name === "string" ? data.name.toLowerCase() : null;
    for (const key of ["require", "require-dev"])
      if (data[key] && typeof data[key] === "object") for (const name of Object.keys(data[key])) out.requires.add(name.toLowerCase());
    for (const [section, dev] of [["autoload", false], ["autoload-dev", true]]) {
      const autoload = data[section];
      if (autoload === undefined) continue;
      if (!autoload || typeof autoload !== "object" || Array.isArray(autoload)) { out.unread.push(`"${section}" is not an object`); continue; }
      for (const kind of ["psr-4", "psr-0"]) {
        const map = autoload[kind];
        if (map === undefined) continue;
        if (!map || typeof map !== "object" || Array.isArray(map)) { out.unread.push(`"${section}"."${kind}" is not an object`); continue; }
        for (const [prefix, dirs] of Object.entries(map)) {
          if (kind === "psr-4" && prefix && !prefix.endsWith("\\")) { out.unread.push(`"${section}"."psr-4" prefix "${prefix}" does not end with a namespace separator, which Composer rejects`); continue; }
          for (const dir of asList(dirs)) {
            if (typeof dir !== "string") { out.unread.push(`"${section}"."${kind}" "${prefix}" has a non-string directory`); continue; }
            out.entries.push({ kind, prefix: prefix.replace(/^\\/, ""), path: dir, dev });
          }
        }
      }
      for (const kind of ["classmap", "files"]) {
        const list = autoload[kind];
        if (list === undefined) continue;
        if (!Array.isArray(list)) { out.unread.push(`"${section}"."${kind}" is not an array`); continue; }
        for (const item of list) {
          if (typeof item !== "string") { out.unread.push(`"${section}"."${kind}" has a non-string entry`); continue; }
          // Composer expands wildcards in classmap paths; a glob names a file set
          // this reader does not enumerate, so it is recorded rather than guessed.
          if (/[*?[\]]/.test(item)) { out.unread.push(`"${section}"."${kind}" entry "${item}" is a wildcard, which is not expanded`); continue; }
          out.entries.push({ kind, path: item, dev });
        }
      }
      for (const pattern of asList(autoload["exclude-from-classmap"] || [])) if (typeof pattern === "string") out.exclude.push(pattern);
    }
    const repositories = Array.isArray(data.repositories) ? data.repositories : data.repositories && typeof data.repositories === "object" ? Object.values(data.repositories) : [];
    for (const repository of repositories)
      if (repository && repository.type === "path" && typeof repository.url === "string") out.repositories.push(repository.url);
    return out;
  }

  /** Composer glob tokens: `**` crosses segments, `*` stays within one. Matched by
   *  a dynamic program over tokens × characters, so time is polynomial in the
   *  pattern and path lengths whatever the wildcards (no regex backtracking). */
  function globTokens(pattern) {
    const tokens = [];
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] === "*" && pattern[i + 1] === "*") { tokens.push("**"); i++; while (pattern[i + 1] === "*") i++; }
      else if (pattern[i] === "*") tokens.push("*");
      else tokens.push({ char: pattern[i] });
    }
    return tokens;
  }
  /** Does `path` match `tokens` fully (prefix: also when the rest starts with `/`)? */
  function globMatch(tokens, path, prefix) {
    let row = new Uint8Array(path.length + 1);
    row[0] = 1;
    for (const token of tokens) {
      const next = new Uint8Array(path.length + 1);
      for (let i = 0; i <= path.length; i++) {
        if (typeof token === "object") { if (i > 0 && row[i - 1] && path[i - 1] === token.char) next[i] = 1; continue; }
        if (row[i]) next[i] = 1;
        else if (i > 0 && next[i - 1] && (token === "**" || path[i - 1] !== "/")) next[i] = 1;
      }
      row = next;
    }
    if (row[path.length]) return true;
    if (prefix) for (let i = 0; i < path.length; i++) if (row[i] && path[i] === "/") return true;
    return false;
  }
  const ABSOLUTE = /^(?:\/|\\|[A-Za-z]:[\\/]|[a-z][a-z0-9+.-]*:\/\/)/i;

  /** Composer's exclude-from-classmap glob (`*` within a segment, `**` across). */
  function excludeTest(patterns, baseDir) {
    const tests = patterns.map(pattern => globTokens(joinPath(baseDir, pattern.replace(/^\/+/, "")) ?? pattern));
    return path => tests.some(tokens => globMatch(tokens, path, true));
  }

  manifests.register({
    id: "project-php",
    forms: ["php-use", "php-name"],
    create(context) {
      const { has, textOf, factsOf, collect, verdicts, files } = context;
      const { resolved, candidate, unresolved } = verdicts;

      /* ---------------------------------------------------------- packages */
      let packageList = null;
      function packages() {
        if (packageList) return packageList;
        packageList = collect(["composer.json"]).map(entry => ({ path: entry.path, dir: entry.dir, ...autoloadMap(textOf(entry.path)) }));
        return packageList;
      }
      const nearestPackage = path => {
        let best = null;
        for (const item of packages()) if (contains(item.dir, path) && (!best || item.dir.length > best.dir.length)) best = item;
        return best;
      };
      /** Packages a root pulls in from the snapshot through path repositories it requires. */
      function pathPackages(rootPackage) {
        const found = [], unread = [];
        for (const url of rootPackage.repositories) {
          if (ABSOLUTE.test(url)) { unread.push(`${rootPackage.path}: path repository "${url}" is an absolute path outside the snapshot`); continue; }
          const pattern = joinPath(rootPackage.dir, url.replace(/\/+$/, ""));
          if (pattern === null) { unread.push(`${rootPackage.path}: path repository "${url}" is outside the snapshot`); continue; }
          const tokens = globTokens(pattern.replace(/\*+/g, "*"));
          const matches = packages().filter(item => item !== rootPackage && globMatch(tokens, item.dir, false));
          for (const item of matches) if (item.name && rootPackage.requires.has(item.name)) found.push(item);
        }
        return { found, unread };
      }

      /** The autoloader a file runs under: the root package that owns it (itself,
       *  or the package requiring it through a path repository) with its maps. */
      const scopes = new Map();
      function scopeFor(path) {
        const own = nearestPackage(path);
        if (!own) return null;
        if (scopes.has(own.path)) return scopes.get(own.path);
        let rootPackage = own;
        for (const other of packages()) if (other !== own && pathPackages(other).found.includes(own)) { rootPackage = other; break; }
        const members = [{ pkg: rootPackage, dev: true }, ...pathPackages(rootPackage).found.map(pkg => ({ pkg, dev: false }))];
        const entries = [], unread = [...pathPackages(rootPackage).unread];
        for (const { pkg, dev } of members) {
          unread.push(...pkg.unread.map(reason => `${pkg.path}: ${reason}`));
          const excluded = pkg.exclude.length ? excludeTest(pkg.exclude, pkg.dir) : () => false;
          for (const entry of pkg.entries) {
            if (entry.dev && !dev) continue;
            // Composer keeps an absolute autoload path absolute; it names the
            // filesystem, not this snapshot.
            if (ABSOLUTE.test(entry.path)) { unread.push(`${pkg.path}: "${entry.path}" is an absolute path outside the snapshot`); continue; }
            const at = joinPath(pkg.dir, entry.path.replace(/\/+$/, ""));
            if (at === null) { unread.push(`${pkg.path}: "${entry.path}" is outside the snapshot`); continue; }
            entries.push({ ...entry, at, manifest: pkg.path, excluded, quote: `${pkg.path} ${entry.dev ? "autoload-dev" : "autoload"} ${entry.kind}${entry.prefix !== undefined ? ` "${entry.prefix.replace(/\\/g, "\\\\")}"` : ""} => "${entry.path}"` });
          }
        }
        const scope = { root: rootPackage, entries, unread };
        scopes.set(own.path, scope);
        return scope;
      }

      /* ----------------------------------------------------- declarations */
      /** Fully qualified class-like and function names one file declares. */
      const declared = new Map();
      function declarationsOf(path) {
        if (declared.has(path)) return declared.get(path);
        const symbols = factsOf(path)?.symbols || [];
        const modules = symbols.filter(symbol => symbol.kind === "module");
        const namespaceOf = symbol => {
          if (symbol.parent != null) { const parent = symbols.find(item => item.index === symbol.parent); if (parent?.kind === "module") return parent.name; }
          let best = "";
          for (const module of modules) if (module.bodyStartIndex === undefined && module.startIndex < symbol.startIndex) best = module.name;
          return best;
        };
        const qualify = symbol => (namespaceOf(symbol) ? `${namespaceOf(symbol)}\\${symbol.name}` : symbol.name);
        const topLevel = symbol => symbol.parent == null || symbols.find(item => item.index === symbol.parent)?.kind === "module";
        const classSymbols = symbols.filter(symbol => CLASS_KINDS.has(symbol.kind) && topLevel(symbol));
        const result = {
          classes: new Set(classSymbols.map(qualify)),
          // Declared only inside if/for/while/try: whether the class exists depends on run time.
          unconditionalClasses: new Set(classSymbols.filter(symbol => !symbol.conditional).map(qualify)),
          functions: new Set(symbols.filter(symbol => symbol.kind === "function" && topLevel(symbol)).map(qualify)),
          readable: Boolean(factsOf(path)),
        };
        declared.set(path, result);
        return result;
      }
      const lower = value => value.toLowerCase();
      const declares = (path, name, table) => [...declarationsOf(path)[table]].some(item => lower(item) === lower(name));
      const underEntry = (entry, file) => (file === entry.at || file.startsWith(entry.at ? entry.at + "/" : "")) && /\.(?:php|inc)$/.test(file) && !entry.excluded(file);

      /** Composer's class map is keyed by the exact declared name (isset() on a
       *  PHP array), so each classmap entry is indexed once: name -> files. */
      const classmapIndex = new Map();
      function classmapFiles(entry, name, folded = false) {
        let index = classmapIndex.get(entry);
        if (!index) {
          index = { exact: new Map(), folded: new Map() };
          const add = (map, key, file) => { if (!map.has(key)) map.set(key, []); map.get(key).push(file); };
          for (const file of files) if (underEntry(entry, file))
            for (const declaredName of declarationsOf(file).classes) { add(index.exact, declaredName, file); add(index.folded, lower(declaredName), file); }
          classmapIndex.set(entry, index);
        }
        return (folded ? index.folded.get(lower(name)) : index.exact.get(name)) || [];
      }

      /** Every `{ target, entry, rule }` the maps give for one fully qualified class. */
      function classLookups(scope, name) {
        const found = [], covering = [], conditional = [];
        // Autoload "files" entries are included when the autoloader registers, so a
        // class they declare unconditionally exists before any lookup and the
        // autoloader is never asked. A declaration inside a branch may not run, so
        // the maps below are consulted too and the result stays a candidate.
        for (const entry of scope.entries)
          if (entry.kind === "files" && has(entry.at) && declares(entry.at, name, "classes"))
            (declares(entry.at, name, "unconditionalClasses") ? found : conditional).push({ target: entry.at, entry, rule: "php-composer-files-class" });
        if (found.length) return { found, covering, caseOnly: [], conditional: [] };
        for (const entry of scope.entries) {
          if (entry.kind === "classmap") {
            for (const file of classmapFiles(entry, name)) found.push({ target: file, entry, rule: "php-composer-classmap" });
            continue;
          }
          if (entry.kind === "files" || !name.startsWith(entry.prefix)) continue;
          let relative;
          if (entry.kind === "psr-4") relative = name.slice(entry.prefix.length).replace(/\\/g, "/");
          else {
            const cut = name.lastIndexOf("\\");
            relative = (cut >= 0 ? name.slice(0, cut + 1).replace(/\\/g, "/") : "") + name.slice(cut + 1).replace(/_/g, "/");
          }
          if (!relative) continue;
          const target = joinPath(entry.at, relative + ".php");
          if (target && has(target)) found.push({ target, entry, rule: entry.kind === "psr-4" ? "php-composer-psr4" : "php-composer-psr0" });
          // An empty fallback prefix covers every name, including a dependency's,
          // so only a named prefix says the class belongs to this project.
          else if (entry.prefix) covering.push({ entry, missing: target });
        }
        // A classmap class spelled in another case misses Composer's map; PHP then
        // has the class only if something loaded it first.
        const caseOnly = found.length ? [] : scope.entries.filter(entry => entry.kind === "classmap").flatMap(entry => classmapFiles(entry, name, true));
        return { found, covering, caseOnly: [...new Set(caseOnly)].sort(), conditional };
      }

      /** The fully qualified name PHP resolves a reference to, or null.
       *  https://www.php.net/manual/en/language.namespaces.rules.php */
      function qualifiedName(path, fact) {
        const specifier = String(fact.specifier || "").replace(/^\\/, "");
        if (fact.form === "php-use") return specifier;
        const namespace = String(fact.namespace || "");
        if (fact.qualified === "fully") return specifier;
        if (fact.qualified === "namespace") return [namespace, specifier.replace(/^namespace\\/i, "")].filter(Boolean).join("\\");
        const [head, ...rest] = specifier.split("\\");
        const imports = (factsOf(path)?.imports || []).filter(item => item.form === "php-use" && (item.useKind || "class") === "class" && String(item.namespace || "") === namespace);
        const alias = imports.find(item => lower(item.alias || String(item.specifier).split("\\").pop()) === lower(head));
        if (alias) return [alias.specifier, ...rest].join("\\");
        return [namespace, specifier].filter(Boolean).join("\\");
      }

      /* ------------------------------------------------------------ resolver */
      return function resolvePhp(path, fact) {
        if (!/\.(?:php|phtml|inc)$/.test(path)) return null;
        const scope = scopeFor(path);
        const isName = fact.form === "php-name";
        /* Without composer.json no autoloader is declared. A qualified name in code
           is then bound by whichever earlier include defined the class, which is not
           a module reference; the `use` statement keeps the weaker search. */
        if (!scope) return isName ? { status: "unresolved", targets: [], ignored: true, engine: "project-php", rule: "php-name-no-autoloader", reason: "No composer.json declares an autoloader for this file" } : null;
        const name = qualifiedName(path, fact);
        if (!name) return null;
        const kind = isName ? "class" : fact.useKind || "class";

        if (kind === "const")
          return unresolved(`use const ${name}: Composer autoloads classes only, so the constant is defined by whichever file ran first, which is not decided statically`, "php-composer-use-const");

        if (kind === "function") {
          const entries = scope.entries.filter(entry => entry.kind === "files");
          const hits = [...new Set(entries.filter(entry => has(entry.at)).filter(entry => declares(entry.at, name, "functions")).map(entry => entry.at))];
          if (hits.length === 1 && !scope.unread.length) {
            const entry = entries.find(item => item.at === hits[0]);
            return resolved(hits, "php-composer-files-function", { name, declaration: entry.quote, manifest: entry.manifest });
          }
          if (hits.length)
            return candidate(hits.sort(), "php-composer-files-function", hits.length > 1
              ? `${name} is declared by ${hits.length} autoload "files" entries; PHP would reject the second declaration, so which one is meant is not decided`
              : `${name} is declared by ${hits[0]}, but ${scope.unread.join("; ")}`);
          const elsewhere = files.filter(file => /\.php$/.test(file) && declares(file, name, "functions")).sort();
          if (elsewhere.length)
            return candidate(elsewhere, "php-use-function-not-autoloaded",
              `${name} is declared by ${elsewhere.join(", ")}, which no autoload "files" entry includes; the function exists only if something includes that file first`);
          return unresolved(`use function ${name}: no autoload "files" entry and no included file declares it`, "php-composer-use-function",
            { external: { name, kind: "package", specifier: name } });
        }

        const { found, covering, caseOnly, conditional } = classLookups(scope, name);
        const targets = [...new Set(found.map(item => item.target))].sort();
        if (conditional.length) {
          const all = [...new Set([...conditional.map(item => item.target), ...targets])].sort();
          return candidate(all, "php-composer-files-class-conditional",
            `${[...new Set(conditional.map(item => item.target))].join(", ")} declares ${name} only inside a conditional block of an autoload "files" entry; whether that branch runs is decided at run time${targets.length ? `, and otherwise the autoloader loads ${targets.join(", ")}` : ""}`);
        }
        if (targets.length === 1) {
          const entry = found.find(item => item.target === targets[0]);
          // A file naming its own class is not a dependency on another module.
          if (isName && targets[0] === path) return { status: "unresolved", targets: [], ignored: true, engine: "project-php", rule: "php-name-self", reason: `${name} is declared by the referencing file itself` };
          if (!declares(targets[0], name, "classes"))
            return candidate(targets, `${entry.rule}-declaration-mismatch`,
              `${entry.entry.quote} maps ${name} to ${targets[0]}, but that file declares no class, interface, trait or enum named ${name}; the autoloader would include it and the name would stay undefined`);
          if (scope.unread.length)
            return candidate(targets, `${entry.rule}-unread-declaration`, `${entry.entry.quote} maps ${name} to ${targets[0]}, but ${scope.unread.join("; ")}`);
          return resolved(targets, entry.rule, { name, declaration: entry.entry.quote, manifest: entry.entry.manifest, ...(fact.form === "php-name" ? { reference: fact.qualified } : {}) });
        }
        if (targets.length > 1)
          return candidate(targets, "php-composer-several-files",
            `${name} is supplied by ${targets.length} files under ${[...new Set(found.map(item => item.entry.quote))].join("; ")}; Composer's lookup order picks one at run time, and this rule binds only a single file`);
        if (caseOnly.length)
          return candidate(caseOnly, "php-composer-classmap-case-mismatch",
            `${caseOnly.join(", ")} declares ${name} with different letter case; Composer's class map is keyed by the exact name, so the autoloader misses it and the class exists only if something loaded it first`);
        if (covering.length) {
          const { entry: prefix, missing } = covering.sort((a, b) => b.entry.prefix.length - a.entry.prefix.length)[0];
          const asDir = missing ? missing.replace(/\.php$/, "") : null;
          if (fact.form === "php-use" && asDir && files.some(file => file.startsWith(asDir + "/")))
            return unresolved(`${name} is a namespace under ${prefix.quote} (directory ${asDir}), not a class file; a namespace import binds no file`, "php-composer-namespace-import");
          return unresolved(`${prefix.quote} declares ${name} inside this project, but ${missing || "the mapped file"} is not included in this snapshot`, `php-composer-${prefix.kind === "psr-4" ? "psr4" : "psr0"}-missing`);
        }
        if (isName)
          return { status: "unresolved", targets: [], ignored: true, engine: "project-php", rule: "php-name-outside-autoload", reason: `No autoload map of ${scope.root.path} covers ${name}` };
        return unresolved(`No autoload map of ${scope.root.path} covers ${name}, so it comes from a dependency or PHP itself`, "php-composer-outside-autoload",
          { external: { name, kind: "package", specifier: name } });
      };
    },
  });

  root.SkylenseProjectPhp = Object.freeze({ autoloadMap });
})(typeof window !== "undefined" ? window : globalThis);
