/* Python project binding from the project's own packaging manifests.
 *
 * A Python import names a module inside a package, not a file. Which directory a
 * package lives in is stated by the build configuration: `from demo.util import x`
 * is `lib/demo/util.py` only because a manifest said `package-dir = {"" = "lib"}`.
 * With a different manifest the same line means a different file, and with no
 * manifest nothing is stated at all. So every root here comes from a declaration,
 * and a project that declares none gets no verdict — the weaker path search that
 * ran before still answers, and its candidate status is left alone.
 *
 * Read as data, never executed. `setup.py` is the boundary case that makes the
 * rule visible: its `package_dir` is an argument to a function call, knowable only
 * by running the module. It is therefore recorded as a project that declares
 * nothing, which also stops the enclosing project from claiming files inside it.
 *
 * Declarations read, each named in the verdict it produces:
 *   pyproject [tool.setuptools] package-dir, packages
 *   pyproject [tool.setuptools.packages.find] where, exclude, namespaces
 *   pyproject [tool.poetry] packages = [{ include, from }]
 *   pyproject [tool.hatch.build.targets.wheel] packages
 *   setup.cfg [options] package_dir, packages = find:/find_namespace:
 *   setup.cfg [options.packages.find] where, exclude
 * References: https://setuptools.pypa.io/en/latest/userguide/package_discovery.html
 *             https://docs.python.org/3/reference/import.html (PEP 420, PEP 328)
 */
(function (root) {
  "use strict";
  const manifests = root.SkylenseProjectManifests;
  if (!manifests) throw new Error("src/project-manifests.js must load before this family.");
  const { parseToml, parseIni, iniList, dirOf, baseOf, joinPath, contains } = manifests;

  /** A module path is dotted identifiers; anything else is not a module name. */
  const MODULE_NAME = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;

  /** PEP 503 normalisation, so `Demo-Tools` and `demo_tools` are one project name. */
  const normalizeName = (value) =>
    typeof value === "string" && value.trim() ? value.trim().toLowerCase().replace(/[-_.]+/g, "_") : null;

  /** The two files a dotted module name can be under one directory. A package
   *  directory and a same-named module file are both listed; the caller applies
   *  importlib's precedence. */
  function moduleCandidates(rootDir, moduleName) {
    const stem = moduleName
      ? [rootDir, String(moduleName).split(".").join("/")].filter(Boolean).join("/")
      : String(rootDir || "");
    if (!stem) return [];
    return [`${stem}.py`, `${stem}/__init__.py`];
  }

  /** `exclude = ["tests", "tests.*"]` as a predicate over dotted module names. */
  function excludes(patterns) {
    const tests = (Array.isArray(patterns) ? patterns : []).filter(item => typeof item === "string").map(pattern => {
      const source = pattern.split("*").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^]*");
      return new RegExp(`^${source}$`);
    });
    return (moduleName) => tests.some(test => test.test(moduleName) || test.test(moduleName.split(".")[0]));
  }

  /**
   * What one manifest *states*, independently of any snapshot.
   * `{ kind, readable, declarations: [{ package, dir, namespaces?, exclude? }], packages, name }`
   * A declaration means "package `package` lives at directory `dir`"; an empty
   * `package` is the root every package is found under.
   */
  function packageRoots(text, manifestPath) {
    const name = baseOf(String(manifestPath || ""));
    const dir = dirOf(String(manifestPath || ""));
    const kind = name === "setup.cfg" ? "setup-cfg" : name === "setup.py" ? "setup-py" : "pyproject";
    const empty = { kind, readable: typeof text === "string", declarations: [], packages: [], name: null };
    if (typeof text !== "string") return { ...empty, readable: false };
    // setup.py declares nothing readable: its values are arguments to a call.
    if (kind === "setup-py") return empty;

    const declarations = [];
    const packages = new Set();
    let projectName = null;
    const at = (value) => joinPath(dir, value);

    if (kind === "pyproject") {
      const data = parseToml(text);
      if (!data) return { ...empty, readable: false };
      projectName = normalizeName(data.project?.name) || normalizeName(data.tool?.poetry?.name);

      const setuptools = data.tool?.setuptools || {};
      const packageDir = setuptools["package-dir"] || setuptools.package_dir;
      if (packageDir && typeof packageDir === "object" && !Array.isArray(packageDir))
        for (const [key, value] of Object.entries(packageDir)) {
          if (typeof value !== "string") continue;
          declarations.push({ package: key, dir: at(value) });
          if (key) packages.add(key);
        }
      for (const item of Array.isArray(setuptools.packages) ? setuptools.packages : [])
        if (typeof item === "string") packages.add(item);
      const find = !Array.isArray(setuptools.packages) && setuptools.packages && typeof setuptools.packages === "object"
        ? setuptools.packages.find : null;
      if (find && typeof find === "object") {
        const where = Array.isArray(find.where) ? find.where : typeof find.where === "string" ? [find.where] : ["."];
        for (const entry of where) {
          if (typeof entry !== "string") continue;
          // `find` under pyproject discovers namespace packages unless told not to.
          declarations.push({ package: "", dir: at(entry), namespaces: find.namespaces !== false, ...(find.exclude ? { exclude: find.exclude } : {}) });
        }
      }

      for (const item of Array.isArray(data.tool?.poetry?.packages) ? data.tool.poetry.packages : []) {
        if (!item || typeof item !== "object" || typeof item.include !== "string") continue;
        // A glob names a file set, not a package root.
        if (/[*?[\]]/.test(item.include)) continue;
        const from = typeof item.from === "string" ? item.from : "";
        declarations.push({ package: item.include, dir: at([from, item.include].filter(Boolean).join("/")) });
        packages.add(item.include);
      }

      const wheel = data.tool?.hatch?.build?.targets?.wheel || {};
      for (const item of Array.isArray(wheel.packages) ? wheel.packages : []) {
        if (typeof item !== "string") continue;
        const target = at(item);
        const leaf = baseOf(target);
        if (!leaf) continue;
        declarations.push({ package: leaf, dir: target });
        packages.add(leaf);
      }
      if (wheel.sources && typeof wheel.sources === "object" && !Array.isArray(wheel.sources))
        for (const source of Object.keys(wheel.sources)) declarations.push({ package: "", dir: at(source) });
    } else {
      const data = parseIni(text);
      if (!data) return { ...empty, readable: false };
      projectName = normalizeName(data.metadata?.name);
      const options = data.options || {};
      for (const item of iniList(options.package_dir)) {
        const index = item.indexOf("=");
        if (index < 0) continue;
        const key = item.slice(0, index).trim();
        const value = item.slice(index + 1).trim();
        if (!value) continue;
        declarations.push({ package: key, dir: at(value) });
        if (key) packages.add(key);
      }
      const declared = String(options.packages || "").trim();
      if (/^find(_namespace)?:/.test(declared)) {
        const find = data["options.packages.find"] || {};
        const where = iniList(find.where);
        const namespaces = declared.startsWith("find_namespace:");
        for (const entry of where.length ? where : ["."])
          declarations.push({ package: "", dir: at(entry), namespaces, ...(find.exclude ? { exclude: iniList(find.exclude) } : {}) });
      } else {
        for (const item of iniList(options.packages)) packages.add(item);
      }
    }

    return { kind, readable: true, declarations, packages: [...packages], name: projectName };
  }

  manifests.register({
    id: "project-python",
    forms: ["python-import", "python-from"],
    create(context) {
      const { has, textOf, factsOf, collect, verdicts } = context;
      const { resolved, candidate, unresolved } = verdicts;

      /* ------------------------------------------------------------ projects */
      /** One project per directory holding any Python manifest, with everything
       *  its manifests declare. A project that declares nothing still exists: it
       *  bounds the claim of the project above it. */
      let projects = null;
      function projectList() {
        if (projects) return projects;
        const byDir = new Map();
        for (const entry of collect(["pyproject.toml", "setup.cfg", "setup.py"])) {
          const read = packageRoots(textOf(entry.path), entry.path);
          const project = byDir.get(entry.dir) || { dir: entry.dir, manifests: [], declarations: [], names: [] };
          project.manifests.push({ path: entry.path, kind: read.kind, readable: read.readable });
          project.declarations.push(...read.declarations.map(item => ({ ...item, manifest: entry.path })));
          if (read.name) project.names.push(read.name);
          byDir.set(entry.dir, project);
        }
        projects = [...byDir.values()];
        return projects;
      }

      /** The project whose directory most closely encloses this file. */
      function projectFor(path) {
        let best = null;
        for (const project of projectList()) {
          if (!contains(project.dir, path)) continue;
          if (!best || project.dir.length > best.dir.length) best = project;
        }
        return best;
      }

      /* ------------------------------------------------------ module lookup */
      const hasPython = (dir) => context.files.some(file => file.startsWith(dir + "/") && /\.py$/.test(file));

      /** The one file a module name is under `rootDir`, applying importlib's
       *  precedence: a package directory is consulted before any source suffix,
       *  so `p/foo/__init__.py` shadows `p/foo.py`. */
      function moduleFile(rootDir, moduleName) {
        const [module, pkg] = moduleCandidates(rootDir, moduleName);
        if (pkg && has(pkg)) return pkg;
        if (module && has(module)) return module;
        return null;
      }

      /** Is every package directory on the way to `moduleName` importable, and was
       *  any of them a PEP 420 namespace package rather than a regular one? */
      function packageChain(rootDir, moduleName, namespacesAllowed) {
        const parts = String(moduleName).split(".");
        let namespace = false;
        for (let index = 0; index < parts.length - 1; index++) {
          const dir = [rootDir, parts.slice(0, index + 1).join("/")].filter(Boolean).join("/");
          if (has(`${dir}/__init__.py`)) continue;
          if (namespacesAllowed && hasPython(dir)) { namespace = true; continue; }
          return { importable: false };
        }
        return { importable: true, namespace };
      }

      /** Does any declared root hold a regular package (an `__init__.py`) for a package
       *  prefix of `moduleName`? Then that package, not a namespace portion, is imported. */
      function regularElsewhere(project, moduleName) {
        const parts = String(moduleName).split(".");
        for (let index = 1; index < parts.length; index++) {
          const prefix = parts.slice(0, index).join(".");
          for (const declaration of project.declarations) {
            let rel = null;
            if (declaration.package === "") rel = prefix;
            else if (prefix === declaration.package) rel = "";
            else if (prefix.startsWith(declaration.package + ".")) rel = prefix.slice(declaration.package.length + 1);
            else continue;
            const dir = [declaration.dir, rel.split(".").filter(Boolean).join("/")].filter(Boolean).join("/");
            if (has(`${dir}/__init__.py`)) return true;
          }
        }
        return false;
      }

      /** Every `{ target, rule, declaration }` a declaration set can prove for one
       *  dotted module name. */
      function lookups(project, moduleName) {
        const found = [];
        for (const declaration of project.declarations) {
          const excluded = declaration.exclude ? excludes(declaration.exclude) : null;
          if (excluded && excluded(moduleName)) return { abstain: true };
          let rootDir = null;
          let relative = null;
          if (declaration.package === "") { rootDir = declaration.dir; relative = moduleName; }
          else if (moduleName === declaration.package) { rootDir = declaration.dir; relative = ""; }
          else if (moduleName.startsWith(declaration.package + ".")) {
            rootDir = declaration.dir;
            relative = moduleName.slice(declaration.package.length + 1);
          } else continue;
          const chain = relative ? packageChain(rootDir, relative, declaration.namespaces !== false) : { importable: true, namespace: false };
          if (!chain.importable) continue;
          // PEP 420: a regular package of the same name on any declared root wins over
          // every namespace portion, whichever root sys.path lists first.
          if (chain.namespace && regularElsewhere(project, moduleName)) continue;
          const target = moduleFile(rootDir, relative);
          if (!target) continue;
          found.push({
            target,
            rule: chain.namespace ? "python-project-namespace-package-root" : "python-project-package-root",
            declaration,
          });
        }
        return { found };
      }

      /** How a declaration reads in a refusal, so a reader can check the rule. */
      const quote = (declaration) =>
        declaration.package === ""
          ? `package-dir "" = "${declaration.dir}"`
          : `package "${declaration.package}" at "${declaration.dir}"`;

      /* `from <package> import <name>`: Python binds a name the package already
         defines before it loads a same-named submodule, so only an unbound name can
         be a module. A statement naming a package and a submodule is a candidate
         set, never a proof of one file. */
      function submodulesFor(project, moduleName, fact) {
        if (fact.form !== "python-from") return [];
        const names = Array.isArray(fact.names) ? fact.names.filter(item => item && item !== "*") : [];
        if (!names.length) return [];
        const bound = new Set();
        let dynamic = false;
        for (const entry of lookups(project, moduleName).found || []) {
          const facts = factsOf(entry.target);
          for (const item of facts?.moduleBindings || []) bound.add(item);
          for (const symbol of facts?.symbols || []) if (symbol.parent == null) bound.add(symbol.name);
          dynamic ||= Boolean(facts?.moduleBindingsDynamic);
        }
        if (dynamic) return [];
        return names
          .filter(item => !bound.has(item))
          .flatMap(item => (lookups(project, `${moduleName}.${item}`).found || []).map(entry => entry.target));
      }

      /** One proven target, an explicit candidate set, or a stated refusal. */
      function answer(project, moduleName, fact, rulePrefix) {
        const { found, abstain } = lookups(project, moduleName);
        if (abstain) return null;
        const targets = [...new Set(found.map(item => item.target))];
        const extra = [...new Set(submodulesFor(project, moduleName, fact))].filter(item => !targets.includes(item));
        if (targets.length > 1) {
          const ordered = [...targets].sort();
          return unresolved(
            `${moduleName} is supplied by ${ordered.join(" and ")} under ${found.map(item => quote(item.declaration)).join(" and ")}; which one wins depends on sys.path order, which no manifest states`,
            `${rulePrefix}-ambiguous-roots`,
          );
        }
        if (targets.length === 1 && extra.length)
          return candidate([...targets, ...extra].sort(), "python-project-from-import-submodules",
            `${moduleName} binds the package and ${extra.length} unbound name(s) could load a submodule of it`);
        if (targets.length === 1) {
          const entry = found.find(item => item.target === targets[0]);
          return resolved(targets, rulePrefix === "python-project-relative-import" ? rulePrefix : entry.rule,
            { root: entry.declaration.dir, module: moduleName, manifest: entry.declaration.manifest });
        }
        if (extra.length) return candidate(extra.sort(), "python-project-from-import-submodules", `${moduleName} supplies no module file, but ${extra.length} submodule(s) could load`);
        return null;
      }

      /* ------------------------------------------------------------ resolver */
      return function resolvePython(path, fact) {
        if (!/\.py$/.test(path)) return null;
        const specifier = String(fact.specifier || "");
        if (!specifier) return null;
        const project = projectFor(path);
        /* No project encloses this file, or the nearest one declares nothing — a
           setup.py-only or unreadable manifest. Either way no root is stated here,
           so this family says nothing and the weaker search keeps its answer. */
        if (!project || !project.declarations.length) return null;

        const relative = /^(\.+)(.*)$/.exec(specifier);
        if (relative) {
          const dots = relative[1].length;
          const tail = relative[2];
          if (tail && !MODULE_NAME.test(tail)) return null;
          /* The importing file's own package under a declared root is the anchor.
             PEP 328: one dot is that package and each further dot climbs one, and
             the anchor that remains must be non-empty — climbing to nothing is
             "attempted relative import beyond top-level package", which Python
             raises rather than resolving elsewhere. */
          for (const declaration of project.declarations) {
            const rootDir = declaration.dir;
            if (!contains(rootDir, path)) continue;
            const inside = rootDir ? path.slice(rootDir.length + 1) : path;
            const segments = inside.split("/");
            segments.pop();
            const own = declaration.package && !segments.length ? [declaration.package] : segments;
            if (dots - 1 >= own.length + (tail ? 0 : 1)) {
              return unresolved(
                `The import climbs ${dots - 1} package level(s) from ${own.join(".") || "a module in no package"}, which reaches beyond the top-level package declared by ${quote(declaration)}`,
                "python-project-relative-import-beyond-top-level",
              );
            }
            const base = own.slice(0, own.length - (dots - 1));
            const moduleName = [...base, ...(tail ? tail.split(".") : [])].join(".");
            if (!moduleName) continue;
            const verdict = answer(project, moduleName, fact, "python-project-relative-import");
            if (verdict) return verdict;
          }
          return null;
        }

        if (!MODULE_NAME.test(specifier)) return null;
        const verdict = answer(project, specifier, fact, "python-project-package-root");
        if (verdict) return verdict;
        /* Every declared root was searched and none supplies this module, so it
           comes from outside the project: an unfetched external reference named by
           the full dotted specifier, which is the name the weaker rule used too. A
           copy that happens to sit outside every root is not importable and must
           not be bound. */
        return unresolved(
          `${specifier} is not supplied by any declared package root (${project.declarations.map(quote).join("; ")})`,
          "python-project-outside-declared-roots",
          { external: { name: specifier, kind: "package", specifier } },
        );
      };
    },
  });

  root.SkylenseProjectPython = Object.freeze({ packageRoots, moduleCandidates });
})(typeof window !== "undefined" ? window : globalThis);
