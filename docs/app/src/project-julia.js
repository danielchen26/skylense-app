/* Julia project binding: Project.toml as a load path, not just a project marker.
 *
 * A bare `using Foo` is answered by the active environment, never by the file
 * tree. Two facts have to line up before a target is provable: the importing
 * file's project must *declare* Foo, and some project in this snapshot must *be*
 * Foo — `name = "Foo"`, with the same `uuid` when both sides state one. Only
 * then is that project's entry point `<project>/src/Foo.jl` the target. Anything
 * weaker is recorded as what it actually is:
 *   declared, no such project here  -> unresolved + an external package reference
 *                                      (a registry dependency that was never fetched)
 *   present but undeclared          -> candidate; a shared development environment
 *                                      could still put it on the load path
 *   two projects named Foo          -> unresolved; which one loads is not stated
 *   uuid disagreement               -> unresolved; a different UUID is a different package
 *   no manifest mentions Foo        -> at most the include graph's same-named top-level
 *                                      module, which is a lexical candidate and never
 *                                      a load-path proof
 * A relative specifier (`using .Inner`) is not an environment question at all:
 * the include graph owns the qualified name of every module a file can see, so
 * this family abstains and the Julia engine's verdict stands.
 *
 * Read, as data, never executed: `name`, `uuid`, `[deps]`, `[weakdeps]`,
 * `[extras]`, `[compat]`, and the `test/` or `docs/` sub-environment stacked on
 * the package it belongs to. Not read: no package depot or registry, no
 * Manifest.toml and therefore no version resolution, no `[targets]` gating of
 * `[extras]`, no macro expansion, no `LOAD_PATH`/`JULIA_LOAD_PATH` from the
 * environment, and no code from the analyzed project.
 * https://pkgdocs.julialang.org/v1/toml-files/
 * https://pkgdocs.julialang.org/v1/creating-packages/
 * https://docs.julialang.org/en/v1/manual/code-loading/
 */
(function (root) {
  "use strict";

  const manifests = root.SkylenseProjectManifests;
  if (!manifests) throw new Error("src/project-manifests.js must load before this family.");

  // JuliaProject.toml is consulted before Project.toml in the same directory.
  // https://docs.julialang.org/en/v1/manual/environment-variables/#JULIA_PROJECT
  const FILES = ["JuliaProject.toml", "Project.toml"];
  // Characters are a lower bound on UTF-8 bytes, so this never lets 1 MiB through.
  const MAX_MANIFEST_CHARS = 1024 * 1024;
  const MAX_MANIFESTS = 2000;
  // A package name is a Julia identifier. https://docs.julialang.org/en/v1/manual/variables/
  const NAME = /^[\p{L}_][\p{L}\p{N}_!]*$/u;
  // Sub-environments Pkg stacks on the package that owns them.
  const STACKED = new Set(["test", "docs"]);

  const plainTable = value => (value && typeof value === "object" && !Array.isArray(value) ? value : null);
  const normalizeUuid = value => (typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null);

  /** A `[deps]`-shaped table as name -> declared string (uuid, or a compat bound), raw. */
  function stringMap(value) {
    const out = new Map(), source = plainTable(value);
    if (!source) return out;
    for (const key of Object.keys(source)) {
      if (!NAME.test(key)) continue;
      const declared = source[key];
      out.set(key, typeof declared === "string" && declared.trim() ? declared.trim() : null);
    }
    return out;
  }

  /** One project record, or null when the manifest states nothing usable. Oversized,
   *  unreadable and unparseable manifests yield no project rather than a guessed one. */
  function readProject(item, read) {
    let text = null;
    try { text = read(item.path); } catch { return null; }
    if (typeof text !== "string" || !text.length || text.length > MAX_MANIFEST_CHARS) return null;
    let parsed = null;
    try { parsed = manifests.parseToml(text); } catch { parsed = null; }
    if (!plainTable(parsed)) return null;
    const declaredName = typeof parsed.name === "string" ? parsed.name.trim() : "";
    const name = NAME.test(declaredName) ? declaredName : null;
    const deps = stringMap(parsed.deps), weakdeps = stringMap(parsed.weakdeps), extras = stringMap(parsed.extras);
    // One lookup table per manifest, built once: a project's declarations are read
    // as often as the package has imports, and re-merging them per fact is waste.
    const declared = new Map();
    for (const [section, table] of [["deps", deps], ["weakdeps", weakdeps], ["extras", extras]])
      for (const [key, uuid] of table) if (!declared.has(key)) declared.set(key, { section, uuid });
    return {
      path: item.path, dir: item.dir, file: item.name, name,
      uuid: typeof parsed.uuid === "string" && parsed.uuid.trim() ? parsed.uuid.trim() : null,
      entry: name ? manifests.joinPath(item.dir, "src/" + name + ".jl") : null,
      deps, weakdeps, extras, compat: stringMap(parsed.compat), declared,
    };
  }

  /** Every Project.toml / JuliaProject.toml among `files`, read through `read(path)`,
   *  shallowest first and at most one project per directory. */
  function projects(files, read) {
    const found = [], seen = new Set();
    for (const item of manifests.collect(files, FILES)) {
      if (found.length >= MAX_MANIFESTS) break;
      // `collect` sorts JuliaProject.toml before Project.toml, so the first readable
      // manifest in a directory is the one Julia would prefer.
      if (seen.has(item.dir)) continue;
      const record = readProject(item, read);
      if (!record) continue;
      seen.add(item.dir);
      found.push(record);
    }
    return found;
  }

  /** The environment a file's imports are answered in: the nearest enclosing project, plus
   *  the package under test when that project is a `test/` or `docs/` sub-environment. Pkg
   *  builds the test environment from test/Project.toml *and* the package being tested, so
   *  such a file sees its own declarations plus that one package — deliberately not the
   *  package's own dependencies, which are not in the test environment.
   *  https://pkgdocs.julialang.org/v1/creating-packages/#Test-specific-dependencies-in-Julia-1.2-and-above */
  function environmentFor(list, path) {
    const project = manifests.nearest(list, path);
    if (!project) return null;
    const role = manifests.baseOf(project.dir);
    // A project that declares no name is an environment, not a package: exactly the
    // shape Pkg stacks. A named package that merely lives in a `test/` directory is not.
    const stackable = !project.name && Boolean(project.dir) && STACKED.has(role);
    const parent = stackable ? manifests.nearest(list, manifests.dirOf(project.dir)) : null;
    const under = parent && parent.path !== project.path && parent.name ? parent : null;
    return { project, under, role: under ? role : null, stack: under ? [project, under] : [project] };
  }

  manifests.register({
    id: "project-julia",
    forms: ["julia-module"],
    create(context) {
      const { verdicts, has } = context;

      // Built once per snapshot, on the first Julia import this snapshot contains.
      let list = null, byName = null;
      const build = () => (list ||= projects(context.files, context.textOf));
      function providers(name) {
        if (!byName) {
          byName = new Map();
          for (const project of build()) if (project.name) byName.set(project.name, [...(byName.get(project.name) || []), project]);
        }
        return byName.get(name) || [];
      }
      // The environment depends only on the importing file's directory, so one lookup
      // serves every file and every import in it.
      const environments = new Map();
      function environmentOf(path) {
        const dir = context.dirOf(path);
        if (!environments.has(dir)) environments.set(dir, environmentFor(build(), dir));
        return environments.get(dir);
      }

      /** A project proves the load path; its entry point is `<project dir>/src/<Name>.jl`. */
      function entryOf(project, name, specifier, fact, rule, proof) {
        const entry = project.entry;
        if (!entry || !has(entry))
          return verdicts.unresolved(
            `${project.path} declares name = "${name}", so the package entry point is ${entry || `src/${name}.jl`}, which is not included in this snapshot`,
            rule + "-entry-missing");
        // A `using` inside a conditional branch names a real file, but whether the
        // statement is compiled at all is decided by a condition nothing here evaluates.
        if (fact.conditional)
          return verdicts.conditional([entry], rule + "-conditional",
            `A conditional \`using ${specifier}\` is loaded only when its branch is taken; ${entry} is the declared entry point of ${name}, but this adapter does not evaluate the condition.`,
            proof);
        return verdicts.resolved([entry], rule, proof);
      }

      function fromEnvironment(env, name, specifier, fact) {
        const project = env.project;
        if (project.name === name)
          return entryOf(project, name, specifier, fact, "julia-project-self",
            { specifier, manifest: project.path, package: name, environment: project.dir || "the snapshot root" });
        if (env.under && env.under.name === name)
          return entryOf(env.under, name, specifier, fact, "julia-project-under-test",
            { specifier, manifest: env.under.path, package: name, environment: project.path, stackedAs: env.role });
        const declared = project.declared.get(name);
        const found = providers(name).filter(item => item.path !== project.path);
        if (declared) {
          if (!found.length)
            return verdicts.unresolved(
              `${project.path} declares "${name}" in [${declared.section}]${declared.uuid ? ` as ${declared.uuid}` : ""}, but no Project.toml in this snapshot declares name = "${name}": the dependency lives in a package depot or registry that was never fetched`,
              "julia-project-dep-unfetched",
              { external: { name, kind: "package", specifier } });
          if (found.length > 1)
            return verdicts.unresolved(
              `"${name}" is declared in ${project.path} [${declared.section}], but ${found.length} manifests in this snapshot declare name = "${name}" (${found.map(item => item.path).join(", ")}); which one this environment loads is not stated`,
              "julia-project-dep-ambiguous");
          const provider = found[0], wanted = normalizeUuid(declared.uuid), stated = normalizeUuid(provider.uuid);
          if (wanted && stated && wanted !== stated)
            return verdicts.unresolved(
              `${project.path} declares ${name} = "${declared.uuid}", but ${provider.path} declares uuid = "${provider.uuid}": a different UUID is a different package, so this dependency is not the ${name} in this snapshot`,
              "julia-project-dep-uuid-mismatch");
          const compat = project.compat.get(name);
          return entryOf(provider, name, specifier, fact, "julia-project-dep", {
            specifier, importer: project.path, manifest: provider.path, package: name, section: declared.section,
            ...(provider.uuid ? { uuid: provider.uuid } : {}),
            // A compat bound is recorded as declared evidence; no version is resolved.
            ...(compat ? { compat } : {}),
          });
        }
        if (!found.length) return null;
        const targets = found.map(item => item.entry).filter(entry => entry && has(entry));
        if (!targets.length) return null;
        return verdicts.candidate(targets, "julia-project-undeclared",
          `${found.length > 1 ? `${found.length} projects in this snapshot declare` : `${found[0].path} declares`} name = "${name}", but ${project.path} does not list "${name}" in [deps], [weakdeps] or [extras], so this snapshot does not prove it is on the load path; a shared development environment could still supply it`,
          { specifier, importer: project.path, candidates: found.map(item => item.path) });
      }

      /** No manifest mentions the package. The include graph may still have found a
       *  same-named top-level module — a lexical match in this file's include context,
       *  which is not proof that `using` would find it on the load path. */
      function unproven(env, name, specifier, fact) {
        const binding = fact.moduleBinding;
        if (!binding || binding.status !== "resolved" || !binding.target || !has(binding.target)) return null;
        const where = env ? `${env.project.path} does not declare` : `no Project.toml or JuliaProject.toml in this snapshot declares`;
        return verdicts.candidate([binding.target], "julia-module-include-context-unproven",
          `\`using ${specifier}\` names a top-level package, and ${where} "${name}" as a dependency; the include graph found a module named "${binding.module || name}" in ${binding.target}, which is a same-named declaration in this file's include context and not a proof that the package is on the load path`,
          { specifier, module: binding.module || name, includeContextRule: binding.rule || "julia-module-include-context" });
      }

      return function resolve(path, fact) {
        try {
          if (fact.form !== "julia-module") return null;
          const specifier = String(fact.specifier || "");
          if (!specifier || specifier.startsWith(".")) return null;
          const name = specifier.split(".")[0];
          if (!NAME.test(name)) return null;
          const env = build().length ? environmentOf(path) : null;
          const verdict = env ? fromEnvironment(env, name, specifier, fact) : null;
          return verdict || unproven(env, name, specifier, fact);
        } catch {
          // Never throw out of a resolver: a surprising manifest degrades to "no rule
          // ran" so the Julia include-graph verdict still answers this fact.
          return null;
        }
      };
    },
  });

  root.SkylenseProjectJulia = Object.freeze({ projects, environmentFor, readProject });
})(typeof window !== "undefined" ? window : globalThis);
