/* Static call binding from syntax facts, for languages analysed without a toolchain.

   The syntax layer (src/syntax-facts.js, `callBinding` facts and `call.callee`)
   records the shape of each callee and every local binding that could shadow or
   type it. This module decides with the whole snapshot. A call is bound only when
   the language's own scope rules leave exactly one included declaration it can
   name; every other call keeps its candidate path and gets a reason that names
   what was not proven. Nothing is executed and nothing outside the snapshot is read.

   Go  https://go.dev/ref/spec#Declarations_and_scope, #Selectors, #Method_sets
     go-package-function          `f()`: no local binding of f, and the package block
                                  of the caller's package declares f exactly once,
                                  as a function.
     go-imported-package-function `p.F()`: p is an import of this file whose path lies
                                  in the importing file's own go.mod module, and the
                                  package directory declares F once, as a function.
     go-declared-receiver-method  `x.M()`: the static type of x is written in the
                                  source (declared variable or parameter type,
                                  composite literal, declared field, declared result
                                  of a bound call), names a non-interface, non-alias,
                                  non-generic type declared once in its package, and
                                  that type declares M directly. Interface dispatch,
                                  methods promoted through embedding, results of
                                  generic functions and calls on type parameters are
                                  never bound.
     Every Go rule refuses a package with a file that has syntax errors, and a target
     declared in a build-constrained file (//go:build, // +build, _GOOS/_GOARCH name)
     other than the caller's own file.
   Rust https://doc.rust-lang.org/reference/names/name-resolution.html, /paths.html
     rust-module-function         `f()`: no local, block item, block glob or
                                  statement-position macro can shadow f, and the
                                  enclosing module declares exactly one value named f,
                                  a function item.
     rust-module-path-function    `a::b::f()`, `crate::…`, `self::…`, `super::…`: each
                                  segment is a module proven by the rust-mod-file /
                                  path-attribute rules or an inline `mod`, and the
                                  last module declares exactly one value named f.
     rust-use-function            either form above reached through explicit `use`
                                  bindings, followed to the declaring module.
     rust-glob-use-function       either form above where one module supplies the
                                  name through its only unconditional `use p::*`: no
                                  explicit item or import of the name, no module-level
                                  macro invocation, and the item visible to the importer.
     Every Rust rule refuses files with syntax errors, inline modules declared twice
     (cfg alternatives), calls inside block-level `mod`s, a file that is both a crate
     root and another crate's module, and cfg-gated modules or functions. Methods,
     associated functions (`Type::f`), trait dispatch, several globs, extern crates,
     macro-generated items and attribute-macro-rewritten functions stay candidate.
   Java JLS SE 21 §6.4.1 shadowing, §6.5.2 obscuring, §8.4.8, §15.12.1, §15.12.2.1;
        only in files a Maven/Gradle/sbt source root claims (src/project-jvm.js)
     java-imported-type-static-method / java-package-type-static-method
                                  `T.m()`: T is no variable, parameter or field of the
                                  file, no field an enclosing class may inherit and no
                                  static-import member, so it names a type; through a
                                  single-type import, the compilation unit or the
                                  caller's package it names one top-level declaration
                                  on the caller's compile path, and m is static.
     java-enclosing-class-method  `m()`: the innermost enclosing class whose declared or
                                  inherited members include an m is searched.
     java-this-class-method       `this.m()`: the innermost class is searched.
     In each, every supertype must be a proven snapshot declaration, exactly one m of
     the whole hierarchy may accept the argument count (varargs counted), and m must be
     static, private or final, or belong to a class no subclass can extend. Receiver
     expressions, static imports, overloads of one arity, external supertypes, syntax
     errors, Lombok/Manifold and AspectJ sources stay candidate.
   C    ISO/IEC 9899:2018 §6.2.1 scopes, §6.2.2 linkage, §6.9p3, §6.10 preprocessing
     c-static-function            `f()`: f has internal linkage (its first file-scope
                                  declaration is `static`), the calling file defines it
                                  exactly once outside #if, a declaration precedes the
                                  call, the calling function neither declares nor uses
                                  f otherwise, and the whole macro environment is known
                                  and leaves f alone: a compile_commands.json entry
                                  fixes the command line (C driver, allowlisted flags,
                                  no -D/-U f), every #include of the translation unit
                                  is found in the first directory searched for it, no
                                  other file #includes the calling .c file, and no
                                  macro named f exists in any C file of the snapshot.
     External linkage stays candidate: which definition a call to an external
     name reaches is decided by the link (several programs, weak symbols, ELF
     interposition), not by the translation unit.
   Swift lib/AST/ModuleNameLookup.cpp, lib/AST/NameLookup.cpp (see the Swift section)
     swift-module-function        `f(a: x, …)`: a statement of a synchronous, unattributed,
                                  non-generic top-level function of a Package.swift
                                  target, every argument a parameter of that function
                                  declared with a nominal type declared once in the
                                  module, and the module declares exactly one f, a
                                  plain function taking exactly those labels and types.
     Argument labels alone never bind: a module function does not hide an imported
     overload of another type. Methods, closures and calls in types stay candidate.
   C#   spec §12.8.4 simple names, §12.5 member lookup, §12.8.10.2 (see the C# section)
     csharp-static-method         `Type.M(args)`: Type binds to nothing in the member,
                                  the enclosing types or their bases, and is declared in
                                  the caller's own namespace of its .csproj; Type and its
                                  bases have exactly one member M, a static non-generic
                                  method the literal or predefined-type arguments provably
                                  convert to, so no extension member is consulted. */
(function (root) {
  "use strict";

  const ENGINE = "semantic-calls";
  const dirOf = path => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
  const fail = reason => ({ reason });
  /* Attributes that neither gate nor rewrite the item they decorate. Any other
     attribute — cfg, test, or an attribute macro such as #[tokio::main] — may
     remove, gate or replace the function, so a call to it is not bound. */
  const RUST_INERT = new Set(["doc", "allow", "warn", "deny", "forbid", "expect", "inline", "cold", "must_use", "deprecated", "track_caller", "no_mangle", "export_name", "link_section", "rustfmt::skip", "optimize", "target_feature"]);
  const inert = name => RUST_INERT.has(name) || /^(?:clippy|rustfmt)::/.test(name);
  const MAX_DEPTH = 8;
  /* Standard macros that expand to an expression or statement, never to an item or a
     binding visible after them. A same-named macro_rules! anywhere in the snapshot, a
     `use` of that name or #[macro_use] in the file removes the guarantee. */
  const RUST_STATEMENT_MACROS = new Set(["println", "print", "eprintln", "eprint", "format", "format_args", "write", "writeln", "assert", "assert_eq", "assert_ne", "debug_assert", "debug_assert_eq", "debug_assert_ne", "panic", "todo", "unimplemented", "unreachable", "vec", "dbg", "matches"]);

  function create(fileMap, helpers = {}) {
    const { joinRelative, resolveProject, droppedPaths, snapshotRoot } = helpers;
    const bindingOf = path => fileMap.get(path)?.facts?.callBinding || null;
    const symbolAt = (path, startIndex) => (fileMap.get(path)?.facts?.symbols || []).filter(symbol => symbol.startIndex === startIndex && symbol.kind === "function");
    let go = null, rust = null, jvm;
    /** The Maven/Gradle/sbt source-root index of this snapshot (src/project-jvm.js),
     *  built once; null when that module is not loaded or no root can be read. */
    function jvmRoots() {
      if (jvm !== undefined) return jvm;
      const J = root.SkylenseProjectJvm;
      try { jvm = J ? J.sourceRoots([...fileMap.keys()], path => fileMap.get(path)?.text) : null; } catch { jvm = null; }
      return jvm;
    }
    /** Every source root on the real classpath of a `visibleRoots(path)` view: its own
     *  roots plus the main roots of each module reachable through non-test dependency
     *  chains (a Gradle api, Maven compile-scope or sbt dependsOn chain exports them).
     *  A superset, for counting declarations; never a place to bind to. */
    function jvmReach(view) {
      const index = jvmRoots(), reach = new Set(view.roots), seen = new Set([view.module]), queue = [...view.dependencies];
      while (queue.length) {
        const dir = queue.shift();
        if (seen.has(dir)) continue;
        seen.add(dir);
        const module = index?.modules.get(dir);
        if (!module) continue;
        for (const item of module.main) reach.add(item);
        for (const dependency of module.deps) if (!dependency.testOnly && !seen.has(dependency.dir)) queue.push(dependency.dir);
      }
      return [...reach].sort();
    }
    /** JVM sources the traversal saw but left out of the snapshot (a file-count or size
     *  cut, ignore rules, read failures). Each still compiles, so it is a possible
     *  declaration site of unknown package; `complete` is false when the drop ledger itself
     *  stopped recording, and then no JVM absence proof holds. Scripts (.kts) are excluded:
     *  they belong to no package. */
    let jvmDrops;
    function jvmDropped() {
      if (jvmDrops) return jvmDrops;
      let dropped;
      try { dropped = typeof droppedPaths === "function" ? droppedPaths() : { entries: [], complete: true }; } catch { dropped = { entries: [], complete: false }; }
      const sources = (dropped.entries || []).filter(entry => !entry.directory && /\.(?:java|kt|scala)$/.test(entry.path)).map(entry => entry.path);
      return (jvmDrops = { sources, complete: dropped.complete !== false });
    }
    const JVM_DROPS_INCOMPLETE = "Some paths of the snapshot were left out without being individually recorded (the drop ledger stopped retaining detail or discovery stopped early), so a JVM source declaring the same name may be missing and no absence proof holds";

    function bound(rule, path, startIndex, steps) {
      const symbols = symbolAt(path, startIndex);
      if (symbols.length !== 1) return fail(`The proven declaration in ${path} has no unique declaration symbol to link to`);
      const symbol = symbols[0];
      return {
        resolution: { kind: "source", path, line: symbol.line, column: symbol.column, name: symbol.name, qualifiedName: symbol.qualifiedName, engine: ENGINE, rule, proof: { rule, steps } },
        evidenceStatus: "resolved-static",
      };
    }

    // ------------------------------------------------------------------ Go
    function goIndex() {
      if (go) return go;
      const modules = [], files = new Map(), byDir = new Map();
      for (const [path, value] of fileMap) {
        if (/(?:^|\/)go\.mod$/.test(path) && typeof value.text === "string") {
          const name = /^\s*module\s+("?)([^\s"]+)\1\s*$/m.exec(value.text)?.[2];
          if (name) modules.push({ dir: dirOf(path), name, path, line: value.text.slice(0, value.text.search(/^\s*module\s/m)).split("\n").length });
        }
        const binding = value.facts?.callBinding;
        if (binding?.language !== "go") continue;
        const file = { path, dir: dirOf(path), pkg: binding.package, test: /_test\.go$/.test(path), facts: binding };
        files.set(path, file);
        const list = byDir.get(file.dir) || []; list.push(file); byDir.set(file.dir, list);
      }
      return (go = { modules, files, byDir, groups: new Map(), packages: new Map() });
    }
    function goModuleOf(dir) {
      let best = null;
      for (const mod of go.modules) if ((mod.dir === "" || dir === mod.dir || dir.startsWith(mod.dir + "/")) && (!best || mod.dir.length > best.dir.length)) best = mod;
      return best;
    }
    /** A package is a directory of files sharing one package clause. Test files join
     *  only when the caller is itself a test file of that package. */
    function goGroup(dir, pkg, includeTests) {
      const key = dir + "\0" + pkg + "\0" + includeTests;
      let group = go.groups.get(key);
      if (group) return group;
      group = { dir, pkg, names: new Map(), functions: new Map(), methods: new Map(), types: new Map(), partial: null };
      const push = (map, name, value) => { const list = map.get(name) || []; list.push(value); map.set(name, list); };
      for (const member of go.byDir.get(dir) || []) {
        if (member.pkg !== pkg || member.test && !includeTests || member.facts.truncated) continue;
        // Go package-level names are unique in every build, so a declaration an error
        // region hides can only collide with a visible one in a build that does not
        // compile. A declaration read from a partial file is itself refused (goGated).
        for (const name of member.facts.names) push(group.names, name, member.path);
        for (const fn of member.facts.functions) push(group.functions, fn.name, { ...fn, path: member.path });
        for (const method of member.facts.methods) push(group.methods, method.receiver + "." + method.name, { ...method, path: member.path });
        for (const type of member.facts.types) push(group.types, type.name, { ...type, path: member.path });
      }
      go.groups.set(key, group);
      return group;
    }
    const callerGroup = file => goGroup(file.dir, file.pkg, file.test);
    /** The package an import path names, proven through the importing file's own go.mod. */
    function goPackage(file, spec) {
      const key = file.dir + "\0" + spec;
      if (go.packages.has(key)) return go.packages.get(key);
      const answer = (() => {
        const mod = goModuleOf(file.dir);
        if (!mod) return fail(`No included go.mod covers ${file.path}, so import path ${spec} names no proven package`);
        if (spec !== mod.name && !spec.startsWith(mod.name + "/")) return fail(`Import path ${spec} is outside module ${mod.name} declared by ${mod.path}; other modules, require, replace and go.work are not evaluated`);
        const dir = spec === mod.name ? mod.dir : joinRelative(mod.dir, spec.slice(mod.name.length + 1));
        if (dir === null || dir === undefined) return fail(`Import path ${spec} does not name a directory inside ${mod.path}`);
        if (goModuleOf(dir) !== mod) return fail(`Directory ${dir} belongs to a nested module, not ${mod.name}`);
        const members = (go.byDir.get(dir) || []).filter(member => !member.test);
        const names = [...new Set(members.map(member => member.pkg))];
        if (!members.length) return fail(`Package directory ${dir || "."} of ${spec} has no included non-test Go file`);
        if (names.length !== 1 || !names[0]) return fail(`Package directory ${dir || "."} declares several package clauses (${names.join(", ")})`);
        return { dir, pkg: names[0], mod, group: goGroup(dir, names[0], false) };
      })();
      go.packages.set(key, answer);
      return answer;
    }
    /** The import of `file` whose local name is `local`, with its proven package. */
    function goImport(file, local) {
      let unproven = null;
      for (const item of file.facts.imports) {
        if (item.name === "." || item.name === "_") continue;
        if (item.name !== null && item.name !== local) continue;
        const pkg = goPackage(file, item.path);
        if (item.name === local) return pkg.group ? { ...pkg, item } : fail(`Import ${local} "${item.path}": ${pkg.reason}`);
        if (pkg.group && pkg.pkg === local) return { ...pkg, item };
        if (!pkg.group && item.path.split("/").at(-1) === local) unproven ||= fail(`Import "${item.path}": ${pkg.reason}`);
      }
      return unproven || fail(`${local} is not an import of ${file.path} whose package is proven; it may be a package-level variable or an unproven import`);
    }
    const contextOf = (path, group) => ({ file: go.files.get(path), group });
    function goNamedType(ctx, ref, steps) {
      if (!ref) return fail("The type is not written as a plain or package-qualified type name");
      let group = ctx.group, where = `package ${group.pkg}`;
      if (ref.pkg) {
        const imported = goImport(ctx.file, ref.pkg);
        if (!imported.group) return imported;
        group = imported.group; where = `package ${imported.pkg} (${imported.dir || "."})`;
        steps.push({ step: `import ${ref.pkg} "${imported.item.path}" is package ${imported.dir || "."} of module ${imported.mod.name}`, path: ctx.file.path, line: imported.item.line });
      }
      const hidden = goGated(ctx, (group.types.get(ref.name) || []).length === 1 ? group.types.get(ref.name)[0] : null);
      if (hidden) return hidden;
      const decls = group.types.get(ref.name) || [], names = group.names.get(ref.name) || [];
      if (decls.length !== 1 || names.length !== 1) return fail(`Type ${ref.name} is not declared exactly once in ${where} (${names.length} package-level declarations)`);
      const decl = decls[0];
      steps.push({ step: `type ${ref.name} is declared once in ${where}`, path: decl.path, line: decl.line });
      return { group, decl };
    }
    function goTypeOf(ctx, expr, steps, depth, want = { index: 0, count: 1 }) {
      if (!expr || depth > MAX_DEPTH) return fail("The receiver expression is not a form whose static type is written in the source");
      if (expr.e !== "call" && want.count !== 1) return fail("A multi-value assignment is bound only from a call with that many declared results");
      switch (expr.e) {
        case "typed":
          steps.push({ step: `${expr.name} is declared with type ${expr.type.pkg ? expr.type.pkg + "." : ""}${expr.type.name}`, path: ctx.file.path, line: expr.line });
          return goNamedType(ctx, expr.type, steps);
        case "value":
          return goNamedType(ctx, expr.type, steps);
        case "init":
          steps.push({ step: `${expr.name} is initialised once, and no other declaration of ${expr.name} exists in the enclosing function`, path: ctx.file.path, line: expr.line });
          return goTypeOf(ctx, expr.value, steps, depth + 1, { index: expr.index, count: expr.count });
        case "call": {
          const target = goCallee(ctx, expr.fn, steps, depth + 1);
          if (!target.decl) return target;
          // A generic function's result may be written as a type parameter that shares
          // a package type's name; its instantiated type is not inferred here.
          if (target.decl.generic) return fail(`${target.decl.name} is generic; the type of its result depends on the instantiation, which is not inferred`);
          const results = target.decl.results;
          if (!Array.isArray(results) || results.length !== want.count) return fail(`${target.decl.name} does not declare exactly ${want.count} result${want.count === 1 ? "" : "s"}`);
          return goNamedType(contextOf(target.decl.path, target.group), results[want.index], steps);
        }
        case "select": {
          if (expr.operand.e === "name") return fail(`${expr.operand.name}.${expr.field} is a package-level value or an untyped name; its type is not written at the call`);
          const base = goTypeOf(ctx, expr.operand, steps, depth + 1);
          if (!base.decl) return base;
          if (base.decl.kind !== "struct") return fail(`Type ${base.decl.name} is not a struct, so field ${expr.field} is not a declared field`);
          if (base.decl.generic) return fail(`Struct ${base.decl.name} is generic; its field types may be type parameters`);
          const found = base.decl.fields.filter(item => item.name === expr.field);
          if (found.length !== 1) return fail(base.decl.embedded ? `Field ${expr.field} is not declared directly on ${base.decl.name}; promotion through an embedded field is not bound` : `Struct ${base.decl.name} declares no field ${expr.field}`);
          steps.push({ step: `field ${base.decl.name}.${expr.field} is declared with its type`, path: base.decl.path, line: base.decl.line });
          return goNamedType(contextOf(base.decl.path, base.group), found[0].type, steps);
        }
        case "name":
          return fail(`${expr.name} has no local declaration; a package-level variable's type is not bound`);
      }
      return fail("The receiver expression is not a form whose static type is written in the source");
    }
    function goFunction(group, name, where) {
      if (name === "init" || name === "_") return fail(`${name} cannot be referenced as a function`);
      const decls = group.functions.get(name) || [], names = group.names.get(name) || [];
      if (decls.length === 1 && names.length === 1) return { decl: decls[0], group };
      if (!names.length) return fail(`${where} declares no package-level ${name}; it may be a builtin, a dot import or excluded source`);
      if (!decls.length) return fail(`${name} in ${where} is a package-level variable, constant or type, not a function`);
      return fail(`${where} declares ${name} ${names.length} times (build-constrained alternatives are not evaluated)`);
    }
    /* A file whose build constraint (`//go:build`, `// +build`, or a _GOOS/_GOARCH name
       suffix) is not evaluated may be excluded from the build. A declaration there binds
       only a call from a file with the identical constraint line and name suffix: every
       configuration that compiles the caller then compiles the callee's file too. */
    const GO_OS = "aix|android|darwin|dragonfly|freebsd|hurd|illumos|ios|js|linux|nacl|netbsd|openbsd|plan9|solaris|wasip1|windows|zos";
    const GO_ARCH = "386|amd64|amd64p32|arm|armbe|arm64|arm64be|loong64|mips|mipsle|mips64|mips64le|mips64p32|mips64p32le|ppc|ppc64|ppc64le|riscv|riscv64|s390|s390x|sparc|sparc64|wasm";
    const GO_SUFFIX = new RegExp(`_((?:${GO_OS})(?:_(?:${GO_ARCH}))?|${GO_ARCH})(?:_test)?\\.go$`);
    const goConstraint = path => ({ line: go.files.get(path)?.facts?.constraint || null, suffix: GO_SUFFIX.exec(path)?.[1] || null });
    function goGated(ctx, decl) {
      if (!decl) return null;
      if (go.files.get(decl.path)?.facts?.partial) return fail(`${decl.name} is declared in ${decl.path}, which has syntax errors, so its declaration is not read reliably`);
      if (decl.path === ctx.file.path) return null;
      const target = goConstraint(decl.path), caller = goConstraint(ctx.file.path);
      if (!target.line && !target.suffix) return null;
      if (target.line === caller.line && target.suffix === caller.suffix) return null;
      const constraint = target.line || `the file name suffix of ${decl.path.split("/").pop()}`;
      return fail(`${decl.name} is declared in ${decl.path}, which carries the build constraint ${constraint}; ${ctx.file.path} does not carry the identical constraint, and build constraints are not evaluated, so it may not be compiled`);
    }
    function goCallee(ctx, fn, steps, depth) {
      if (!fn || depth > MAX_DEPTH) return fail("The callee is a function value or an expression this reader does not type");
      if (fn.e === "name") {
        const found = goFunction(ctx.group, fn.name, `package ${ctx.group.pkg} (${ctx.group.dir || "."})`);
        if (found.decl) { const gated = goGated(ctx, found.decl); if (gated) return gated; found.rule = "go-package-function"; steps.push({ step: `no local declaration of ${fn.name}; package ${ctx.group.pkg} declares it once`, path: found.decl.path, line: found.decl.line }); }
        return found;
      }
      if (fn.e !== "select") return fail(`The callee is a local function value (${fn.e === "typed" || fn.e === "init" ? fn.name : "expression"}), not a declaration`);
      if (fn.operand.e === "name") {
        const imported = goImport(ctx.file, fn.operand.name);
        if (!imported.group) return imported;
        steps.push({ step: `import ${fn.operand.name} "${imported.item.path}" is package ${imported.dir || "."} of module ${imported.mod.name} (${imported.mod.path})`, path: ctx.file.path, line: imported.item.line });
        const found = goFunction(imported.group, fn.field, `package ${imported.pkg} (${imported.dir || "."})`);
        if (found.decl) { const gated = goGated(ctx, found.decl); if (gated) return gated; found.rule = "go-imported-package-function"; steps.push({ step: `package ${imported.pkg} declares ${fn.field} once`, path: found.decl.path, line: found.decl.line }); }
        return found;
      }
      const base = goTypeOf(ctx, fn.operand, steps, depth + 1);
      if (!base.decl) return base;
      const type = base.decl;
      if (type.kind === "interface") return fail(`${type.name} is an interface; ${fn.field} is dispatched dynamically to whichever type the value holds`);
      if (type.kind === "alias") return fail(`${type.name} is a type alias; the aliased type's method set is not followed`);
      if (type.generic) return fail(`${type.name} is a generic type; methods of instantiated types are not bound`);
      const methods = base.group.methods.get(type.name + "." + fn.field) || [];
      if (methods.length !== 1) return fail(methods.length ? `${type.name}.${fn.field} is declared ${methods.length} times` : `${type.name} declares no method ${fn.field} directly; promotion through embedding is not bound`);
      if (methods[0].generic) return fail(`${type.name}.${fn.field} has a generic receiver`);
      const gated = goGated(ctx, methods[0]);
      if (gated) return gated;
      steps.push({ step: `${type.name} declares method ${fn.field} directly`, path: methods[0].path, line: methods[0].line });
      return { decl: methods[0], group: base.group, rule: "go-declared-receiver-method" };
    }
    function goBind(path, call) {
      goIndex();
      const file = go.files.get(path);
      if (!file?.pkg) return null;
      if (file.facts.partial) return fail(`${path} has syntax errors, so the local bindings that could shadow this call are not known completely`);
      if (!call.callee) return fail("The callee expression is not a form this reader binds (function value, conversion, index or closure call)");
      const steps = [];
      const found = goCallee({ file, group: callerGroup(file) }, call.callee, steps, 0);
      if (!found.decl) return found;
      return bound(found.rule, found.decl.path, found.decl.startIndex, steps);
    }

    // ---------------------------------------------------------------- Rust
    function cargo(dir) {
      const text = fileMap.get(dir ? dir + "/Cargo.toml" : "Cargo.toml")?.text;
      return typeof text === "string" ? root.SkylenseProjectManifests?.parseToml?.(text) || null : null;
    }
    function rustPackageOf(path) {
      for (let dir = dirOf(path); ; dir = dirOf(dir)) {
        if (fileMap.has(dir ? dir + "/Cargo.toml" : "Cargo.toml")) {
          const manifest = cargo(dir);
          if (manifest?.package) return { dir, manifest };
        }
        if (!dir) return null;
      }
    }
    function rustEdition(pkg) {
      let edition = pkg.manifest.package?.edition;
      if (edition && typeof edition === "object" && edition.workspace === true) {
        edition = undefined;
        for (let dir = pkg.dir ? dirOf(pkg.dir) : null; dir !== null; dir = dir ? dirOf(dir) : null) {
          const manifest = cargo(dir);
          if (manifest?.workspace) { edition = manifest.workspace.package?.edition; break; }
          if (!dir) break;
        }
        if (edition === undefined) return null;
      }
      if (edition === undefined) return 2015;
      const year = Number(edition);
      return Number.isInteger(year) ? year : null;
    }
    /** Crate root files a Cargo package declares, explicitly or by its layout conventions. */
    function rustIsRoot(path) {
      const pkg = rustPackageOf(path);
      if (!pkg) return null;
      const rel = pkg.dir ? path.slice(pkg.dir.length + 1) : path, meta = pkg.manifest.package || {}, m = pkg.manifest;
      const declared = [m.lib?.path, ...[m.bin, m.example, m.test, m.bench].flatMap(list => Array.isArray(list) ? list.map(item => item?.path) : []), typeof meta.build === "string" ? meta.build : null]
        .filter(item => typeof item === "string").map(item => joinRelative("", item));
      if (declared.includes(rel)) return pkg;
      const auto = (key, pattern) => meta[key] !== false && pattern.test(rel);
      if (!m.lib?.path && rel === "src/lib.rs") return pkg;
      if (meta.build !== false && typeof meta.build !== "string" && rel === "build.rs") return pkg;
      if (auto("autobins", /^src\/(?:main\.rs|bin\/[^/]+\.rs|bin\/[^/]+\/main\.rs)$/)) return pkg;
      if (auto("autoexamples", /^examples\/(?:[^/]+\.rs|[^/]+\/main\.rs)$/)) return pkg;
      if (auto("autotests", /^tests\/(?:[^/]+\.rs|[^/]+\/main\.rs)$/)) return pkg;
      if (auto("autobenches", /^benches\/(?:[^/]+\.rs|[^/]+\/main\.rs)$/)) return pkg;
      return null;
    }
    function rustIndex() {
      if (rust) return rust;
      const nodes = new Map(), parents = new Map(), macroRules = new Set(), partialFiles = [];
      const keyOf = (path, chain) => path + "#" + chain.join("::");
      for (const [path, value] of fileMap) {
        const binding = value.facts?.callBinding;
        if (binding?.language !== "rust" || binding.truncated) continue;
        // A partial file is not indexed, but every `mod` it parsed still makes it a
        // parent of that module file, and an error region that mentions `mod` may hide one.
        if (binding.partial) { partialFiles.push({ path, hidden: binding.errorMentionsMod, pkg: rustPackageOf(path)?.dir ?? null }); continue; }
        for (const name of binding.macroRules || []) macroRules.add(name);
        for (const module of binding.modules) {
          const key = keyOf(path, module.chain);
          // Two inline modules of one name in one parent (cfg alternatives) share a
          // key; neither is told apart here, so both are marked and refused.
          if (nodes.has(key)) { nodes.get(key).duplicate = true; continue; }
          nodes.set(key, { key, path, chain: module.chain, facts: module, children: new Map() });
        }
      }
      for (const node of nodes.values()) for (let n = 1; n < node.chain.length && !node.duplicate; n++) if (nodes.get(keyOf(node.path, node.chain.slice(0, n)))?.duplicate) node.duplicate = true;
      for (const node of nodes.values()) {
        const imports = fileMap.get(node.path)?.facts?.imports || [];
        for (const child of node.facts.children) {
          if (node.children.has(child.name)) { node.children.set(child.name, { key: null, reason: `module ${child.name} is declared more than once` }); continue; }
          if (child.inline) { node.children.set(child.name, { key: keyOf(node.path, [...node.chain, child.name]), conditional: child.conditional, line: child.line, path: node.path }); continue; }
          const fact = imports.find(item => item.form === "rust-mod" && item.startIndex === child.startIndex);
          const verdict = fact && resolveProject ? resolveProject(node.path, fact) : null;
          const target = verdict?.targets?.length === 1 ? verdict.targets[0] : null;
          if (!target || !(verdict.status === "resolved" || verdict.status === "candidate" && verdict.conditional)) {
            node.children.set(child.name, { key: null, reason: `\`mod ${child.name};\` in ${node.path} has no proven module file${verdict?.reason ? ": " + verdict.reason : ""}` });
            continue;
          }
          const conditional = child.conditional || verdict.status !== "resolved";
          node.children.set(child.name, { key: keyOf(target, []), conditional, line: child.line, path: node.path, rule: verdict.rule });
          const list = parents.get(target) || []; list.push(node.key); parents.set(target, list);
        }
      }
      for (const partial of partialFiles) for (const fact of fileMap.get(partial.path)?.facts?.imports || []) {
        if (fact.form !== "rust-mod" || !resolveProject) continue;
        const verdict = resolveProject(partial.path, fact);
        const target = verdict?.targets?.length === 1 ? verdict.targets[0] : null;
        if (target) { const list = parents.get(target) || []; list.push("partial:" + partial.path); parents.set(target, list); }
      }
      return (rust = { nodes, parents, keyOf, macroRules, hiddenParents: partialFiles.filter(item => item.hidden), roots: new Map(), crates: new Map() });
    }
    function rustParent(key) {
      const node = rust.nodes.get(key);
      if (!node) return null;
      if (node.chain.length) return rust.keyOf(node.path, node.chain.slice(0, -1));
      const list = rust.parents.get(node.path) || [];
      return list.length === 1 ? list[0] : null;
    }
    /** The crate root module `key` belongs to, or a reason it is not proven. */
    function rustCrate(key) {
      if (rust.crates.has(key)) return rust.crates.get(key);
      const seen = new Set();
      let current = key, answer;
      for (;;) {
        const node = rust.nodes.get(current);
        if (!node || seen.has(current)) { answer = fail(`${rust.nodes.get(key)?.path || key} is not reachable from a crate root through proven mod declarations`); break; }
        seen.add(current);
        if (node.chain.length) { current = rust.keyOf(node.path, node.chain.slice(0, -1)); continue; }
        const list = rust.parents.get(node.path) || [];
        if (list.length > 1) { answer = fail(`${node.path} is declared as a module by ${list.length} parents, so its crate path is ambiguous`); break; }
        if (list.length === 1 && rustIsRoot(node.path)) { answer = fail(`${node.path} is a crate root of its own and also a module of another crate, so \`crate::\` and the enclosing modules differ between the two builds`); break; }
        if (list.length === 1 && list[0].startsWith("partial:")) { answer = fail(`${node.path} is declared as a module by ${list[0].slice(8)}, which has syntax errors, so its crate path is not proven`); break; }
        // A partial file of the same package whose error region mentions `mod` may
        // declare this module file too (a #[path] can name any file of the package).
        const hiddenBy = list.length === 1 ? rust.hiddenParents.find(item => item.pkg === (rustPackageOf(node.path)?.dir ?? null)) : null;
        if (hiddenBy) { answer = fail(`${hiddenBy.path} has a syntax-error region mentioning \`mod\`, which may declare ${node.path} as a module of another crate`); break; }
        if (list.length === 1) { current = list[0]; continue; }
        const pkg = rustIsRoot(node.path);
        if (!pkg) { answer = fail(`${node.path} is neither a declared crate root nor reachable from one through proven mod declarations; it may not be compiled`); break; }
        answer = { root: current, pkg, edition: rustEdition(pkg), ancestors: seen };
        break;
      }
      rust.crates.set(key, answer);
      return answer;
    }
    function rustChild(context, key, name, steps) {
      const child = rust.nodes.get(key)?.children.get(name);
      if (!child?.key) return fail(child?.reason || `module ${name} is not proven`);
      if (!rust.nodes.has(child.key)) return fail(`module ${name} resolves to ${child.key.split("#")[0]}, whose call-binding facts are unavailable (syntax errors or extraction ceiling)`);
      if (rust.nodes.get(child.key).duplicate) return fail(`module ${name} is declared more than once (cfg alternatives are not evaluated)`);
      if ((child.conditional || rust.nodes.get(child.key).facts.conditional) && !context.ancestors.has(child.key))
        return fail(`module ${name} is gated by #[cfg]; the callee exists only in configurations this adapter does not evaluate`);
      steps.push({ step: `mod ${name} is ${child.rule ? "the module file proven by " + child.rule : "an inline module"} (${rust.nodes.get(child.key).path})`, path: child.path, line: child.line });
      return { key: child.key };
    }
    const moduleLabel = key => { const node = rust.nodes.get(key); return node ? `module ${node.chain.length ? node.chain.join("::") + " in " : ""}${node.path}` : String(key); };
    function rustAncestorOrSelf(ancestor, key) {
      for (let current = key, n = 0; current && n < 64; current = rustParent(current), n++) if (current === ancestor) return true;
      return false;
    }
    /** A glob imports only the names visible from the importing module: a `pub` or
     *  `pub(crate)` item, or any item of a module the importer is nested in. */
    function globVisible(context, key, visibility) {
      if (!context.importer) return true;
      if (visibility === "pub" || visibility === "pub(crate)") return true;
      return rustAncestorOrSelf(key, context.importer);
    }
    /** `use path::*` supplies a name only when no explicit item or import in the
     *  module has it; exactly one unconditional glob must be the source. */
    function rustGlob(context, key, name, want, steps, depth, where) {
      const facts = rust.nodes.get(key).facts, globs = facts.globPaths || [];
      if (facts.macros?.length) return fail(`${where} declares no ${name} explicitly, but its module-level macro invocation ${facts.macros[0]}! may expand to an item or import that shadows the glob`);
      if (globs.length !== 1) return fail(`${where} declares no ${name} explicitly and has ${globs.length} glob imports; which one supplies it is not decided`);
      const glob = globs[0];
      if (glob.conditional) return fail(`The glob import in ${where} is gated by #[cfg]`);
      if (!glob.segments) return fail(`The glob import in ${where} starts outside the crate`);
      if (!globVisible(context, key, glob.visibility)) return fail(`The glob import in ${where} is private to that module, so it supplies nothing to ${moduleLabel(context.importer)}`);
      const target = rustPath({ ...context, importer: null }, key, glob.segments, "module", steps, depth + 1, true);
      if (!target.key) return target;
      if (want === "module" && !rustAncestorOrSelf(target.key, key)) return fail(`Module ${name} would come through a glob from a non-ancestor module, whose module visibility is not read`);
      steps.push({ step: `${where} declares no ${name} explicitly; its only glob import \`use ${glob.segments.join("::")}::*\` supplies it`, path: rust.nodes.get(key).path, line: glob.line, use: true, glob: true });
      return rustLookup({ ...context, importer: key }, target.key, name, want, steps, depth + 1);
    }
    /** Look `name` up in one module namespace. Explicit items and `use` bindings
     *  of the same name conflict at compile time, so exactly one must exist. */
    function rustLookup(context, key, name, want, steps, depth) {
      const node = rust.nodes.get(key);
      if (!node) return fail(`module ${key} is unavailable`);
      if (node.duplicate) return fail(`${moduleLabel(key)} is declared more than once (cfg alternatives are not evaluated)`);
      if (depth > MAX_DEPTH) return fail("The path goes through too many use re-exports");
      const facts = node.facts, where = `module ${node.chain.length ? node.chain.join("::") + " in " : ""}${node.path}`;
      if (facts.unmodelledUse) return fail(`${where} has a use declaration this reader does not model`);
      const uses = facts.uses.filter(item => item.name === name);
      if (want === "value") {
        const fns = facts.functions.filter(item => item.name === name), others = facts.values.filter(item => item === name).length;
        const total = fns.length + uses.length + others;
        if (!total) return facts.globs ? rustGlob(context, key, name, want, steps, depth, where) : fail(`${where} declares no ${name}; it may come from the prelude, an extern crate or a macro`);
        if (total > 1) return fail(`${where} has ${total} items or imports named ${name} (cfg alternatives are not evaluated)`);
        if (fns.length) {
          const fn = fns[0], blocking = fn.attributes.filter(item => !inert(item));
          if (blocking.length) return fail(`fn ${name} carries #[${blocking[0]}], which may gate, rewrite or replace it`);
          if (!globVisible(context, key, fn.visibility)) return fail(`fn ${name} in ${where} is not visible to ${moduleLabel(context.importer)}, so its glob import does not supply it`);
          steps.push({ step: `${where} declares fn ${name} once`, path: node.path, line: fn.line });
          return { fn: { ...fn, path: node.path } };
        }
        if (!uses.length) return fail(`${name} in ${where} is a constant, static or tuple-struct constructor, not a function`);
      } else {
        const kids = facts.children.filter(item => item.name === name).length, types = facts.types.filter(item => item === name).length;
        const total = kids + uses.length + types;
        if (!total) return facts.globs ? rustGlob(context, key, name, want, steps, depth, where) : fail(`${where} declares no module ${name}; it may be an extern crate or a type`);
        if (total > 1) return fail(`${where} has ${total} items or imports named ${name}`);
        if (kids) return rustChild(context, key, name, steps);
        if (!uses.length) return fail(`${name} in ${where} names a type or extern crate, not a module`);
      }
      const use = uses[0];
      if (use.conditional) return fail(`use of ${name} in ${where} is gated by #[cfg]`);
      if (!use.segments) return fail(`use of ${name} in ${where} starts outside the crate (\`::\` path)`);
      if (!globVisible(context, key, use.visibility)) return fail(`use of ${name} in ${where} is private to that module, so a glob import does not re-export it`);
      steps.push({ step: `use ${use.segments.join("::")}${use.segments.at(-1) === name ? "" : " as " + name} in ${where}`, path: node.path, line: use.line, use: true });
      return rustPath({ ...context, importer: null }, key, use.segments, want, steps, depth + 1, true);
    }
    function rustPath(context, key, segments, want, steps, depth, fromUse) {
      if (depth > MAX_DEPTH) return fail("The path goes through too many use re-exports");
      let current = key, index = 0;
      const head = segments[0];
      if (head === "crate") { current = context.root; index = 1; }
      else if (head === "self") index = 1;
      else if (head !== "super" && fromUse) {
        if (context.edition === null) return fail("The crate's edition is not stated in a readable form, so use-path anchoring is unknown");
        if (context.edition < 2018) current = context.root;
      }
      const last = want === "value" ? segments.length - 1 : segments.length;
      if (index > last) return fail(`\`${segments.join("::")}\` names a module, not a function`);
      for (; index < last; index++) {
        if (segments[index] === "super") {
          const parent = rustParent(current);
          if (!parent) return fail(`\`super\` from ${rust.nodes.get(current)?.path || current} has no proven parent module`);
          current = parent;
          continue;
        }
        if (segments[index] === "self" || segments[index] === "crate") return fail(`\`${segments[index]}\` may only start a path`);
        const found = rustLookup(context, current, segments[index], "module", steps, depth);
        if (!found.key) return found;
        current = found.key;
      }
      if (want === "module") return { key: current };
      return rustLookup(context, current, segments[last], "value", steps, depth);
    }
    function rustBind(path, call) {
      rustIndex();
      const callee = call.callee;
      if (callee?.reason) return fail(callee.reason);
      if (!callee?.path) return fail("The callee is a method, an associated function, a closure or an expression; only free-function paths are bound");
      if (callee.shadowed) return fail(`${callee.path[0]} may be shadowed by a local binding, a block-level item or a block-level glob import`);
      const expanding = (callee.macros || []).find(name => !RUST_STATEMENT_MACROS.has(name) || rust.macroRules.has(name) || bindingOf(path).macroUse || bindingOf(path).modules.some(module => module.uses.some(use => use.name === name)));
      if (expanding) return fail(`The enclosing function invokes ${expanding}! in statement position, which may expand to an item or a let binding that shadows ${callee.path[0]}`);
      const key = rust.keyOf(path, callee.chain);
      if (!rust.nodes.has(key)) return fail(bindingOf(path).partial ? `${path} has syntax errors, so the items and bindings that could shadow this call are not known completely` : "The calling module has no call-binding facts");
      if (rust.nodes.get(key).duplicate) return fail(`The calling module ${callee.chain.join("::")} is declared more than once in ${path} (cfg alternatives are not evaluated)`);
      const crate = rustCrate(key);
      if (!crate.root) return crate;
      const steps = [];
      const found = rustPath({ root: crate.root, edition: crate.edition, ancestors: crate.ancestors }, key, callee.path, "value", steps, 0, false);
      if (!found.fn) return found;
      const rule = steps.some(step => step.glob) ? "rust-glob-use-function" : steps.some(step => step.use) ? "rust-use-function" : callee.path.length > 1 ? "rust-module-path-function" : "rust-module-function";
      return bound(rule, found.fn.path, found.fn.startIndex, steps.map(({ use, glob, ...step }) => step));
    }

    // ---------------------------------------------------------------- Java
    // JLS SE 21 https://docs.oracle.com/javase/specs/jls/se21/html/ — 6.4.1 shadowing,
    // 6.4.2/6.5.2 obscuring (a variable wins over a type of the same name), 7.5 imports,
    // 8.4.8 inheritance, 15.12.1 (the class to search, innermost first) and 15.12.2.1
    // (potentially applicable methods: arity, counting varargs).
    const JAVA_OBJECT = ["getClass", "hashCode", "equals", "clone", "toString", "notify", "notifyAll", "wait", "finalize"];
    const JAVA_ENUM = ["values", "valueOf", "name", "ordinal", "compareTo", "getDeclaringClass", "describeConstable"];
    const JAVA_DEPTH = 32;
    let java = null;
    function javaIndex() {
      if (java) return java;
      const files = new Map(), byName = new Map(), unparsed = [];
      let aspect = null;
      for (const [path, value] of fileMap) {
        if (aspect === null && path.endsWith(".aj")) aspect = path;
        const facts = value.facts?.callBinding;
        // A JVM source this reader did not fully model may still declare any type of its
        // package, so it is kept, with its package where that is known, as a possible
        // declaration site. Kotlin and Scala compile to the same classpath.
        if (/\.(?:kt|kts|scala)$/.test(path)) { unparsed.push({ path, package: javaForeignPackage(value.text) }); continue; }
        if (!path.endsWith(".java")) continue;
        if (facts?.language !== "java") { unparsed.push({ path, package: null }); continue; }
        files.set(path, facts);
        if (facts.truncated || facts.partial) { unparsed.push({ path, package: facts.packageKnown ? facts.package : null }); continue; }
        facts.types.forEach((type, index) => {
          if (type.parent !== null || !type.name || type.kind === "anonymous") return;
          const name = (facts.package ? facts.package + "." : "") + type.name, list = byName.get(name) || [];
          list.push({ path, index }); byName.set(name, list);
        });
      }
      for (const path of jvmDropped().sources) unparsed.push({ path, package: null });
      return (java = { files, byName, unparsed, aspect, views: new Map(), hierarchies: new Map() });
    }
    /** The caller's direct compile path (`roots`, where a target may be bound) plus
     *  `reach` (jvmReach), where a duplicate or unread declaration is still counted. */
    function javaView(path) {
      if (!java.views.has(path)) {
        const view = jvmRoots()?.visibleRoots(path) || null;
        java.views.set(path, view ? { ...view, reach: jvmReach(view) } : null);
      }
      return java.views.get(path);
    }
    const javaLabel = (path, index) => { const type = java.files.get(path)?.types[index]; return `${type?.name ? (type.kind === "anonymous" ? "" : type.kind + " ") + type.name : "an anonymous class"} (${path}:${type?.line})`; };
    const javaFinal = type => type.modifiers.includes("final") || type.kind === "record" || type.kind === "anonymous" || type.kind === "enum" && !type.constantBodies;
    const javaApplies = (method, arity) => (method.varargs ? arity >= method.arity - 1 : method.arity === arity);
    /** The package a Kotlin or Scala source states in its head, or null when it is not one plain clause. */
    function javaForeignPackage(text) {
      if (typeof text !== "string") return null;
      const head = text.slice(0, 8192), found = [...head.matchAll(/(?:^|\n)[ \t]*package[ \t]+([^\s;{]+)/g)];
      if (!found.length) return /(?:^|\n)[ \t]*(?:@file|package\b)/.test(head) ? null : "";
      return found.length === 1 && /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(found[0][1]) && !/\r(?!\n)/.test(head) ? found[0][1] : null;
    }
    /** The one top-level declaration of `name` on the compile path of `from`. Every
     *  .java file under a declared source root is compiled whatever its directory. */
    function javaQualified(from, name) {
      const view = javaView(from);
      if (!view) return fail(`No Maven, Gradle or sbt source root claims ${from}, so the types it can see are unknown`);
      const under = (roots, file) => roots.some(dir => dir === "" || file.startsWith(dir + "/"));
      const list = (java.byName.get(name) || []).filter(ref => under(view.reach, ref.path));
      const pkg = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : "";
      const hidden = java.unparsed.filter(item => item.path !== from && (item.package === null || item.package === pkg) && under(view.reach, item.path));
      if (hidden.length) return fail(`${hidden.map(item => item.path).slice(0, 3).join(", ")}${hidden.length > 3 ? ` and ${hidden.length - 3} more` : ""} ${hidden.length === 1 ? "is" : "are"} on the compile path of ${from} in ${pkg ? "package " + pkg : "the default package"} or an unread package, but ${hidden.length === 1 ? "was" : "were"} not fully modelled (syntax errors, Unicode escapes or lone CRs that javac reads differently, Kotlin/Scala, or no call-binding facts), so another declaration of ${name} cannot be excluded`);
      if (list.length === 1 && under(view.roots, list[0].path)) return list[0];
      if (list.length === 1) return fail(`${name} is declared only by ${list[0].path}, in a module ${from} reaches through another module's dependency, not directly; whether that dependency is exported (api, compile scope) is not read`);
      return fail(list.length ? `${name} is declared ${list.length} times on the compile path of ${from}, counting modules reached through dependency chains (${list.map(ref => ref.path).join(", ")})` : `${name} is not declared by any fully parsed Java file on the compile path of ${from}; it may come from a dependency, the JDK or excluded source`);
    }
    /** A simple type name written in `path` inside the body of type `context` (null: top level). */
    function javaResolveType(path, context, ref, steps, depth) {
      if (ref && Number.isInteger(ref.index)) return { path, index: ref.index };
      if (!ref) return fail(`A supertype in ${path} is written in a form this reader does not model`);
      if (ref.qualified) return fail(`${ref.qualified} is a qualified type name; nested and fully qualified type names are not followed`);
      const facts = java.files.get(path), name = ref.name;
      if (facts.typeParameters.includes(name)) return fail(`${name} is a type parameter in ${path}`);
      const nested = facts.types.find(type => type.parent !== null && type.name === name);
      if (nested) return fail(`${path} declares a nested or local type ${name} (line ${nested.line}), which shadows a top-level type of that name where it is in scope`);
      for (let at = context; at !== null; at = facts.types[at].parent) {
        const outer = javaHierarchy(path, at, depth + 1);
        if (!outer.methods) return outer;
        if (outer.memberTypes.has(name)) return fail(`${name} may name a member type inherited by ${javaLabel(path, at)}, which shadows a top-level type of that name`);
      }
      const single = facts.imports.find(item => item.static && !item.onDemand && item.path.split(".").at(-1) === name);
      if (single) return fail(`\`import static ${single.path};\` in ${path} may import a member type named ${name}`);
      const local = facts.types.filter(type => type.parent === null && type.name === name), imported = facts.imports.filter(item => !item.static && !item.onDemand && item.path.split(".").at(-1) === name);
      if (local.length + imported.length > 1) return fail(`${name} is declared or imported by name ${local.length + imported.length} times in ${path}`);
      const own = (facts.package ? facts.package + "." : "") + name;
      if (imported.length) {
        const found = javaQualified(path, imported[0].path);
        if (!found.path) return fail(`\`import ${imported[0].path};\`: ${found.reason}`);
        steps.push({ step: `\`import ${imported[0].path};\` in ${path} names ${name}; it is declared once on that file's compile path, by ${found.path}`, path, line: imported[0].line });
        return { ...found, via: "import" };
      }
      const found = javaQualified(path, own);
      if (!found.path) return local.length ? found : fail(`${name} is neither declared in ${path}, imported by a single-type import, nor declared once in package ${facts.package || "(default)"} on its compile path (${found.reason}); an on-demand import or java.lang may supply it, which is not bound`);
      steps.push({ step: local.length ? `${name} is declared by this compilation unit as ${own}, and nowhere else on its compile path` : `${name} is not imported by name, so ${own} — declared once on the compile path, by ${found.path} — shadows on-demand imports and java.lang`, path: found.path, line: java.files.get(found.path).types[found.index].line });
      return { ...found, via: "package" };
    }
    /** Every method, field and member type that type `index` of `path` declares or may
     *  inherit, over all its supertypes; a reason when any supertype is not proven. */
    function javaHierarchy(path, index, depth = 0) {
      const key = path + "#" + index;
      if (java.hierarchies.has(key)) return java.hierarchies.get(key);
      java.hierarchies.set(key, fail(`The supertype chain of ${javaLabel(path, index)} is cyclic`));
      const answer = (() => {
        if (depth > JAVA_DEPTH) return fail(`The supertype chain of ${javaLabel(path, index)} is too deep`);
        const facts = java.files.get(path);
        if (!facts || facts.truncated || facts.partial) return fail(facts?.lexical ? `${path} contains a lone CR or a Unicode escape that javac translates before tokenizing (JLS 3.3, 3.4), so its declarations as javac reads them are not known` : `${path} has syntax errors or incomplete call-binding facts, so its declarations may be missing`);
        if (facts.rewriting) return fail(`${path} uses Lombok or Manifold, which may add, rewrite or extend members`);
        const type = facts.types[index], label = javaLabel(path, index);
        if (type.kind === "annotation") return fail(`${label} is an annotation interface, whose elements are not modelled`);
        if (!type.supers) return fail(`A supertype of ${label} is written in a form this reader does not model`);
        const methods = type.methods.map(method => ({ ...method, path, type: index })), fields = new Set([...type.fields, ...type.components]), memberTypes = new Set(type.memberTypes);
        const implicit = new Set(JAVA_OBJECT), types = [label];
        if (type.kind === "enum") for (const name of JAVA_ENUM) implicit.add(name);
        if (type.kind === "record") for (const name of type.components) implicit.add(name);
        for (const ref of type.supers) {
          const found = javaResolveType(path, type.parent, ref, [], depth + 1);
          if (!found.path) return fail(`Supertype ${ref?.name || ref?.qualified || "of " + label} of ${label} is not proven: ${found.reason}`);
          const inherited = javaHierarchy(found.path, found.index, depth + 1);
          if (!inherited.methods) return inherited;
          for (const method of inherited.methods) if (!methods.some(item => item.path === method.path && item.startIndex === method.startIndex)) methods.push(method);
          for (const name of inherited.fields) fields.add(name);
          for (const name of inherited.memberTypes) memberTypes.add(name);
          for (const name of inherited.implicit) implicit.add(name);
          for (const name of inherited.types) if (!types.includes(name)) types.push(name);
        }
        return { methods, fields, memberTypes, implicit, types };
      })();
      java.hierarchies.set(key, answer);
      return answer;
    }
    /** The single potentially applicable `callee.name` among the members of `searched`. */
    function javaMethod(searched, callee, steps, wantStatic) {
      const hierarchy = javaHierarchy(searched.path, searched.index);
      if (!hierarchy.methods) return hierarchy;
      const label = javaLabel(searched.path, searched.index), name = callee.name, arity = callee.arity, args = `${arity} argument${arity === 1 ? "" : "s"}`;
      if (hierarchy.implicit.has(name)) return fail(`${name} may name a method ${label} inherits from java.lang.Object or java.lang.Enum, or a record accessor, whose overloads are not read`);
      const named = hierarchy.methods.filter(method => method.name === name), applicable = named.filter(method => javaApplies(method, arity));
      if (applicable.length !== 1) return fail(applicable.length
        ? `${label} has ${applicable.length} methods named ${name} that accept ${args} (${applicable.map(method => `${method.path}:${method.line}`).join(", ")}); overload resolution by argument type is not performed`
        : `Neither ${label} nor its supertypes declare a ${name} that accepts ${args}`);
      const method = applicable[0], owner = java.files.get(method.path).types[method.type], own = method.path === searched.path && method.type === searched.index;
      const is = word => method.modifiers.includes(word);
      if (!own && is("private")) return fail(`The only ${name} accepting ${args} is private to ${javaLabel(method.path, method.type)}; private methods are not inherited`);
      if (!own && owner.kind === "interface" && is("static")) return fail(`The only ${name} accepting ${args} is a static method of interface ${javaLabel(method.path, method.type)}; interface static methods are not inherited`);
      if (!own && owner.kind !== "interface" && !is("public") && !is("protected") && java.files.get(method.path).package !== java.files.get(searched.path).package) return fail(`The only ${name} accepting ${args} is package-private in another package, so it is not a member of ${label}`);
      if (wantStatic && !is("static")) return fail(`${javaLabel(method.path, method.type)} declares ${name} as an instance method; a type-qualified call needs a static one`);
      // An instance method may be overridden by a subclass of the searched class, so only
      // a method no subclass can replace has one runtime callee.
      if (!is("static") && !is("private") && !is("final") && !javaFinal(java.files.get(searched.path).types[searched.index]))
        return fail(`${name} is an overridable instance method of ${label}; a subclass may override it, so the runtime callee is not proven`);
      steps.push({ step: `${hierarchy.types.length > 1 ? `${label} and its supertypes (${hierarchy.types.slice(1).join(", ")}) have` : `${label}, which declares no supertype, has`} exactly one ${name} that accepts ${args}${named.length > 1 ? `, among ${named.length} methods of that name` : ""}; it is ${["static", "private", "final"].filter(is).join(" ") || "in a class no subclass can extend"}`, path: method.path, line: method.line });
      return { method };
    }
    function javaQualifiedCall(path, callee, steps, line) {
      const facts = java.files.get(path), name = callee.qualifier;
      if (facts.values.includes(name)) return fail(`${name} is declared as a variable, parameter or field in ${path}, so ${name}.${callee.name}() may be a call on that value, whose runtime dispatch is not bound; where it is in scope a variable obscures a type of the same name (JLS 6.4.2)`);
      for (let at = callee.owner; at !== null; at = facts.types[at].parent) {
        const enclosing = javaHierarchy(path, at);
        if (!enclosing.methods) return fail(`The enclosing ${javaLabel(path, at)} may inherit a field named ${name}: ${enclosing.reason}`);
        if (enclosing.fields.has(name)) return fail(`${name} may name a field inherited by ${javaLabel(path, at)}, which obscures the type`);
      }
      for (const item of facts.imports) {
        if (!item.static) continue;
        if (!item.onDemand) { if (item.path.split(".").at(-1) === name) return fail(`\`import static ${item.path};\` may import a field named ${name}, which obscures the type`); continue; }
        const owner = javaQualified(path, item.path);
        if (!owner.path) return fail(`\`import static ${item.path}.*;\` may import a field named ${name}: ${owner.reason}`);
        const members = javaHierarchy(owner.path, owner.index);
        if (!members.methods) return fail(`\`import static ${item.path}.*;\` may import a field named ${name}: ${members.reason}`);
        if (members.fields.has(name) || members.memberTypes.has(name)) return fail(`\`import static ${item.path}.*;\` imports a member named ${name}`);
      }
      steps.push({ step: `${name} is not a variable, parameter or field in ${path}, and no enclosing class or static import supplies a field of that name, so ${name} names a type (JLS 6.5.2)`, path, line });
      const target = javaResolveType(path, callee.owner, { name }, steps, 0);
      if (!target.path) return target;
      const found = javaMethod(target, callee, steps, true);
      if (found.method) found.rule = target.via === "import" ? "java-imported-type-static-method" : "java-package-type-static-method";
      return found;
    }
    function javaEnclosingCall(path, callee, steps) {
      const facts = java.files.get(path);
      for (let at = callee.owner; at !== null; at = facts.types[at].parent) {
        const hierarchy = javaHierarchy(path, at);
        if (!hierarchy.methods) return fail(`The enclosing ${javaLabel(path, at)} may have a member ${callee.name}: ${hierarchy.reason}`);
        if (!hierarchy.implicit.has(callee.name) && !hierarchy.methods.some(method => method.name === callee.name)) {
          if (callee.form === "this") return fail(`Neither ${javaLabel(path, at)} nor its supertypes declare a method ${callee.name}`);
          steps.push({ step: `${javaLabel(path, at)} and its supertypes have no member method ${callee.name}, so the search moves to the enclosing class (JLS 15.12.1)`, path, line: facts.types[at].line });
          continue;
        }
        const found = javaMethod({ path, index: at }, callee, steps, false);
        if (found.method) found.rule = callee.form === "this" ? "java-this-class-method" : "java-enclosing-class-method";
        return found;
      }
      return fail(`No enclosing class of the call declares or inherits a method named ${callee.name}; a static import may supply it, which is not bound`);
    }
    function javaBind(path, call) {
      javaIndex();
      const facts = java.files.get(path), callee = call.callee;
      if (facts.partial) return fail(facts.lexical ? `${path} contains a lone CR or a Unicode escape that javac translates before tokenizing (JLS 3.3, 3.4), so javac may read declarations — a field obscuring a type, say — that the syntax tree does not show` : `${path} has syntax errors, so a declaration this call could reach may be missing`);
      if (facts.rewriting) return fail(`${path} uses Lombok or Manifold, which may add members or rewrite calls`);
      if (java.aspect) return fail(`The snapshot contains the AspectJ source ${java.aspect}, whose inter-type declarations may add members to any class`);
      if (!jvmDropped().complete) return fail(JVM_DROPS_INCOMPLETE);
      if (!callee) return fail("The call has a receiver expression (a variable, field, call result, super or qualified this); its static type and runtime dispatch are not bound");
      if (!javaView(path)) return fail(`No Maven, Gradle or sbt source root claims ${path}, so the types and members it can see are unknown`);
      const steps = [];
      const found = callee.form === "qualified" ? javaQualifiedCall(path, callee, steps, call.line) : javaEnclosingCall(path, callee, steps);
      if (!found.method) return found;
      return bound(found.rule, found.method.path, found.method.startIndex, steps);
    }

    // ------------------------------------------------------------------- C
    /* A static function is a local symbol of its object file: the linker cannot
       retarget a call to it, so the translation unit alone decides the binding —
       if the unit's macro environment is known. It is known only when the command
       line is read from compile_commands.json and every header the unit includes is
       a snapshot file, since an unseen header or `-D` may define any macro; the
       premise, as for Go and Rust, is that the unit compiles (so a static function
       used in an expression has exactly one definition in it, §6.9p3, and
       compiler-predefined macros outside the reserved namespace, which GCC and Clang
       define as `1`, cannot name a function that compiles). */
    const C_DRIVER = /^(?:cc|gcc|clang|tcc|icc|icx|pcc|[\w.+-]*-(?:gcc|cc|clang))(?:-\d+(?:\.\d+)*)?(?:\.exe)?$/i;
    const C_WRAPPER = /^(?:ccache|sccache|distcc|icecc)(?:\.exe)?$/i;
    /* An allowlist: a flag outside it may add macros or headers the facts do not see
       (-include, --define-macro, --config, -specs, @file), change the language or
       change the include search, so the command is refused rather than guessed.
       `C_FLAG_ARG` flags take the next token as their value. */
    const C_FLAG_SAFE = [
      /^-(?:c|S|E|w|v|C|P|H|M|MM|MD|MMD|MP|MG|pipe|pthread|pedantic|pedantic-errors|ansi|nostdinc|nostdlib|shared|static|rdynamic|s)$/,
      /^-O\w*$/, /^-g[\w=-]*$/, /^-W(?!p,)[\w=,+.\/-]*$/, /^-m[\w=,.+-]*$/,
      /^-f(?!(?:ms-|blocks|declspec|borland|plugin|pass-plugin|modules|implicit-module|objc|apinotes|preprocessed|directives-only|macro-backtrace))[\w=,+.\/-]*$/,
      /^-std=(?:c|gnu|iso9899:)[\w:]*$/, /^--?(?:target|sysroot)=\S+$/, /^-isysroot\S+$/, /^-[lL]\S+$/, /^-o\S+$/,
      /^-(?:D|U|I|iquote|isystem|idirafter)\S*$/,
    ];
    const C_FLAG_ARG = new Set(["-o", "-MF", "-MT", "-MQ", "-arch", "-target", "-isysroot", "-D", "-U", "-I", "-iquote", "-isystem", "-idirafter"]);
    /** The first token of a command line this reader cannot vouch for, or null. */
    function cUnknownFlag(tokens) {
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (C_FLAG_ARG.has(token)) { i++; continue; }
        if (!token.startsWith("-")) { if (token.startsWith("@")) return token; continue; }
        if (/^-(?:include|imacros)/.test(token) || /^-I-$/.test(token)) return token;
        if (!C_FLAG_SAFE.some(pattern => pattern.test(token))) return token;
      }
      return null;
    }
    /* GCC and Clang search, for one #include: the including file's directory (quoted
       form only), -iquote (quoted only), every -I, every -isystem, the system
       directories, then -idirafter — whatever the order on the command line. */
    const C_SEARCH_RANK = { "current-directory": 0, iquote: 1, I: 2, isystem: 3 };
    const C_LINKAGE_MACROS = new Set(["static", "extern"]);
    const baseName = path => String(path || "").replace(/\\/g, "/").split("/").pop();
    let cx = null;
    function cIndex() {
      if (cx) return cx;
      const files = new Map(), macros = new Map(), includedAs = new Map(), computed = [];
      const note = (name, site) => { const list = macros.get(name) || []; list.push(site); macros.set(name, list); };
      const included = (spec, site) => { const key = baseName(spec); const list = includedAs.get(key) || []; list.push(site); includedAs.set(key, list); };
      const unread = [];
      for (const [path, value] of fileMap) {
        const binding = value.facts?.callBinding;
        if (binding?.language === "c") {
          files.set(path, { path, facts: binding, clipped: Boolean(value.textClipped) });
          for (const item of binding.macros) note(item.name, { path, line: item.line, verb: "#define" });
          for (const item of binding.undefs) note(item.name, { path, line: item.line, verb: "#undef" });
          for (const item of binding.includes) if (item.computed) computed.push({ path, line: item.line }); else included(item.spec, { path, line: item.line });
        }
        // A C or C++ file whose text was not read in full may #include anything.
        if (["c", "cpp"].includes(value.node?.language) && (typeof value.text !== "string" || value.textClipped)) unread.push(path);
        if (typeof value.text !== "string" || !/include|import/.test(value.text)) continue;
        /* Every file's text, C files too: the directive reader above models neither
           #import nor #include_next, and a lone CR or a block comment can hide a
           directive from a line-oriented reader. So any quoted or angled operand after
           include/import anywhere on a line counts (a match inside a comment only
           costs a binding). A directive whose operand is neither is computed; that is
           read only in C-family files, where `# include …` is not a comment. */
        const native = ["c", "cpp"].includes(value.node?.language) || /\.(?:inc|def|inl|ipp|tcc|tpp|x|m|mm)$/i.test(path);
        const lines = value.text.replace(/\\(?:\r\n|\r|\n)/g, "").split(/\r\n|\r|\n/);
        lines.forEach((line, index) => {
          for (const match of line.matchAll(/(?:include|include_next|import)\s*(?:"([^"]*)"|<([^>]*)>)/g)) included(match[1] ?? match[2], { path, line: index + 1 });
          const directive = native && /^(?:.*\*\/)?\s*(?:#|%:)\s*(?:\/\*.*?\*\/\s*)*(?:include|include_next|import)\b\s*(.*)$/.exec(line);
          if (directive && !/^(?:"[^"]*"|<[^>]*>)/.test(directive[1])) computed.push({ path, line: index + 1 });
        });
      }
      let db = null;
      try { db = root.SkylenseProjectNative?.database([...fileMap.keys()], path => fileMap.get(path)?.text) || null; } catch { db = null; }
      /* A compile command for a file outside the snapshot (build/unity.c, an ignored
         harness) is a translation unit that may #include any snapshot .c file. */
      const outside = [], parse = root.SkylenseProjectManifests?.parseJson;
      for (const [path, value] of fileMap) {
        if (baseName(path) !== "compile_commands.json") continue;
        const parsed = typeof value.text === "string" && parse ? parse(value.text) : null;
        if (!Array.isArray(parsed)) { outside.push({ manifest: path, file: "(unreadable database)" }); continue; }
        const landed = new Set();
        for (const records of db?.byFile?.values() || []) for (const record of records) if (record.manifest === path) landed.add(record.spelled);
        for (const item of parsed) if (item && typeof item === "object" && !landed.has(item.file)) { outside.push({ manifest: path, file: String(item.file ?? "(no file)") }); break; }
      }
      return (cx = { files, macros, includedAs, computed, unread, outside, db, commands: new Map(), units: new Map() });
    }
    /** Why this file's facts cannot support a proof, or null. */
    function cFileProblem(file) {
      if (file.clipped) return `${file.path} was clipped before analysis, so its directives were not all read`;
      if (file.facts.truncated) return `Call-binding extraction reached its safety ceiling for ${file.path}`;
      if (file.facts.partial) return `${file.path} has syntax errors — often code that only parses after macro expansion — so its declarations are not reliable`;
      if (file.facts.trigraphs) return `${file.path} contains a trigraph sequence; a directive spelled with trigraphs is invisible to this lexical reader`;
      if (file.facts.loneCarriageReturn) return `${file.path} contains a carriage return not followed by a line feed; the compiler ends a line there, so a directive may hide inside what this reader takes for a comment`;
      const odd = file.facts.unmodelled[0];
      if (odd) return `${file.path}:${odd.line} uses ${odd.directive}, a directive this reader does not model`;
      return null;
    }
    /** Name, kind and replacement shape of one `-D`/`-U` flag. */
    function cCommandMacro(flag) {
      const undef = /^-U/.test(flag), match = /^([A-Za-z_$][\w$]*)(\([^)]*\))?(?:=([\s\S]*))?$/.exec(flag.slice(2));
      if (!match) return { name: null, flag };
      const body = undef ? "" : (match[3] ?? "1").replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, " ");
      const stack = [], close = { ")": "(", "]": "[", "}": "{" };
      let balanced = true;
      for (const char of body) {
        if ("([{".includes(char)) stack.push(char);
        else if (close[char] && stack.pop() !== close[char]) balanced = false;
      }
      return { name: match[1], undef, flag, function: Boolean(match[2]), paste: /##|%:%:/.test(body), balanced: balanced && !stack.length, words: [...new Set(body.match(/[A-Za-z_$][\w$]*/g) || [])] };
    }
    /** The compile commands compile_commands.json records for `path`, re-read for
     *  the flags that put unseen macros or headers into the unit. */
    function cCommands(path) {
      if (cx.commands.has(path)) return cx.commands.get(path);
      const answer = (() => {
        const records = cx.db?.byFile?.get(path) || [];
        if (!records.length) return fail(`No compile_commands.json entry covers ${path}, so its command line is unknown; a -D flag or forced include could define a macro that rewrites the call`);
        const native = root.SkylenseProjectNative, parse = root.SkylenseProjectManifests?.parseJson;
        const macros = [], manifests = [];
        for (const record of records) {
          const text = fileMap.get(record.manifest)?.text;
          const parsed = typeof text === "string" && parse ? parse(text) : null;
          const items = Array.isArray(parsed) ? parsed.filter(item => item && item.file === record.spelled) : [];
          if (!items.length) return fail(`The compile command for ${path} in ${record.manifest} could not be re-read`);
          for (const item of items) {
            const tokens = Array.isArray(item.arguments) ? item.arguments.filter(value => typeof value === "string") : typeof item.command === "string" ? native.tokenize(item.command) : [];
            let at = 0;
            while (at < tokens.length && C_WRAPPER.test(baseName(tokens[at]))) at++;
            const driver = baseName(tokens[at]);
            if (!C_DRIVER.test(driver)) return fail(`The compile command for ${path} in ${record.manifest} runs ${driver || "no driver"}, which this reader does not know to compile it as C (a C++ driver compiles a .c file as C++)`);
            const odd = cUnknownFlag(tokens.slice(at + 1));
            if (odd) return fail(`The compile command for ${path} in ${record.manifest} passes ${odd}, a flag this reader does not know to leave the preprocessed text unchanged; it may add macros or headers the facts do not see, or change how the file is preprocessed`);
            for (const flag of native.flagsOf(tokens.slice(at)).macros) {
              const macro = cCommandMacro(flag);
              if (!macro.name) return fail(`${flag} in ${record.manifest} is not a macro flag this reader can read`);
              macros.push({ ...macro, path: record.manifest });
            }
          }
          manifests.push(record.manifest);
        }
        return { macros, manifests: [...new Set(manifests)] };
      })();
      cx.commands.set(path, answer);
      return answer;
    }
    /** The snapshot header `include` in `from` opens under the unit's search path.
     *  A file missing from the snapshot is not missing on the build machine — the
     *  ingest drops build/, vendor/ and ignored paths, and generated headers exist only
     *  there — so a header binds only when it is in the FIRST directory searched: any
     *  earlier directory could hold an unseen header of the same spelling. */
    function cInclude(from, include, scopes) {
      const spelling = include.system ? `#include <${include.spec}>` : `#include "${include.spec}"`;
      if (include.computed || !include.spec) return fail(`#include ${include.spec} in ${from}:${include.line} is computed by a macro, so the header it opens is not known`);
      if (/^(?:\/|[A-Za-z]:[\\/])/.test(include.spec)) return fail(`${spelling} in ${from}:${include.line} spells an absolute path outside the snapshot`);
      let chosen = null;
      for (const scope of scopes || []) {
        const rank = item => (/^cmake-/.test(item.origin || "") ? 9 : C_SEARCH_RANK[item.origin] ?? C_SEARCH_RANK[item.list] ?? 9);
        const ordered = scope.directories.map((item, index) => ({ item, index, rank: rank(item) })).sort((a, b) => a.rank - b.rank || a.index - b.index);
        const head = ordered[0];
        // -idirafter and CMake-only directories are searched after the system directories.
        if (!head || head.rank > 3) return fail(`${spelling} in ${from}:${include.line} is searched first in the compiler's system directories, outside the snapshot; a header there may define any macro, including one named like the callee`);
        if (!head.item.available) return fail(`${spelling} in ${from}:${include.line} is searched first through a directory outside the snapshot (${head.item.reason}), which may hold the header the compiler opens`);
        const base = head.item.origin === "current-directory" ? dirOf(from) : head.item.dir;
        const candidate = joinRelative(base, include.spec.replace(/\\/g, "/"));
        if (candidate === null || candidate === undefined) return fail(`${spelling} in ${from}:${include.line} leaves the snapshot root from ${base || "the root"}, so the header the compiler opens is not in the snapshot`);
        if (!fileMap.has(candidate)) return fail(`${spelling} in ${from}:${include.line} is not in ${base || "the snapshot root"}, the first directory searched (${head.item.evidence || head.item.origin}); a header absent from the snapshot may still exist there on the build machine (excluded, ignored or generated), so a later directory's copy is not proven to be the one opened`);
        if (chosen && chosen !== candidate) return fail(`${spelling} in ${from}:${include.line} opens a different header under each compile command`);
        chosen = candidate;
      }
      return chosen ? { path: chosen } : fail(`${spelling} in ${from}:${include.line} has no recorded search path`);
    }
    /** The translation unit of `path`: every file it includes, transitively, and every
     *  macro its files and command line define. */
    function cUnit(path) {
      if (cx.units.has(path)) return cx.units.get(path);
      const answer = (() => {
        const command = cCommands(path);
        if (command.reason) return command;
        const scopes = { true: cx.db.searchPath(path, false), false: cx.db.searchPath(path, true) };
        const members = [path], seen = new Set(members);
        let includes = 0;
        for (let k = 0; k < members.length; k++) {
          const file = cx.files.get(members[k]);
          if (!file) return fail(`${members[k]}, included by the translation unit of ${path}, has no C syntax facts (another language, or not analysed)`);
          const problem = cFileProblem(file);
          if (problem) return fail(problem);
          for (const include of file.facts.includes) {
            const target = cInclude(file.path, include, scopes[Boolean(include.system)]);
            if (!target.path) return target;
            includes++;
            if (seen.has(target.path)) continue;
            if (members.length >= 256) return fail(`The translation unit of ${path} includes more than 256 headers`);
            seen.add(target.path); members.push(target.path);
          }
        }
        const macros = [...members.flatMap(member => cx.files.get(member).facts.macros.map(item => ({ ...item, path: member }))), ...command.macros.filter(item => !item.undef)];
        return { members, macros, names: new Set(macros.map(item => item.name)), command, includes };
      })();
      cx.units.set(path, answer);
      return answer;
    }
    /** Macros whose expansion could declare `name`, hide a call or change scoping:
     *  they paste tokens, leave a bracket open, mention `name`, or expand into one that does. */
    function cHazards(unit, name) {
      const bad = new Set(unit.macros.filter(item => item.paste || !item.balanced || item.words.includes(name)).map(item => item.name));
      for (let changed = true; changed;) {
        changed = false;
        for (const item of unit.macros) if (!bad.has(item.name) && item.words.some(word => bad.has(word))) { bad.add(item.name); changed = true; }
      }
      return bad;
    }
    /* A call whose callee the calling file does not define names a function of
       another translation unit (lapi.c calls luaH_new, defined in ltable.c and
       declared in ltable.h). Which definition it reaches is decided by the link:
       which objects and libraries a program links, weak symbols and symbol
       interposition — none of it is in the source. So such a call is never
       resolved; every non-static definition of the name in the snapshot is a
       candidate (a static one has internal linkage and is invisible from another
       unit). No candidate is offered where the call may not be a call of a
       file-scope function at all: a local declaration or use of the name in the
       calling function, a macro of that name anywhere in the snapshot, a reserved
       identifier, or a file-scope declaration of the name in the calling file
       other than a non-static prototype. */
    function cDefinitions() {
      if (cx.definitions) return cx.definitions;
      const index = new Map();
      for (const file of cx.files.values()) for (const item of file.facts.globals) {
        if (item.kind !== "definition" || !item.name) continue;
        const list = index.get(item.name) || [];
        list.push({ path: file.path, startIndex: item.startIndex, static: item.static });
        index.set(item.name, list);
      }
      return (cx.definitions = index);
    }
    function cCandidates(path, call) {
      const file = cx.files.get(path), name = call.callee?.name, fn = name ? file.facts.functions[call.callee.fn] : null;
      if (!fn || file.facts.truncated || name.startsWith("_") || cx.macros.has(name) || fn.names.includes(name)) return null;
      if (file.facts.globals.some(item => item.name === name && (item.kind !== "prototype" || item.static))) return null;
      const targets = [];
      for (const item of cDefinitions().get(name) || []) {
        if (item.static || item.path === path) continue;
        const symbols = symbolAt(item.path, item.startIndex);
        if (symbols.length !== 1 || symbols[0].name !== name) continue;
        targets.push({ path: item.path, line: symbols[0].line, column: symbols[0].column, name, qualifiedName: symbols[0].qualifiedName });
      }
      return targets.length ? targets : null;
    }
    function cBind(path, call) {
      const result = cProve(path, call);
      if (result.resolution) return result;
      const targets = cx.files.has(path) ? cCandidates(path, call) : null;
      return targets ? { ...result, candidates: { targets, engine: ENGINE, rule: "c-external-function-candidate", reasonCode: targets.length === 1 ? "c-external-linkage" : "c-external-linkage-several-definitions" } } : result;
    }
    function cProve(path, call) {
      cIndex();
      const file = cx.files.get(path), callee = call.callee;
      if (!callee?.name) return fail("The callee is not a plain identifier: a function-pointer expression, a member, a parenthesised name or a call outside a function body");
      const name = callee.name, fn = file.facts.functions[callee.fn];
      if (!fn) return fail("The call is not inside a function definition this reader records");
      const problem = cFileProblem(file);
      if (problem) return fail(problem);
      if (name.startsWith("_")) return fail(`${name} is a reserved identifier (C17 7.1.3), which the implementation may define as a macro`);
      const site = cx.macros.get(name)?.[0];
      if (site) return fail(`A macro named ${name} exists in the snapshot (${site.verb} at ${site.path}:${site.line}); the preprocessor is not run, so the call may be rewritten`);
      if (fn.names.includes(name)) return fail(`${name} is declared, or used other than as a callee, inside the calling function; a local variable, parameter or function pointer may shadow the file-scope function`);
      const decls = file.facts.globals.filter(item => item.name === name);
      if (!decls.length) return fail(`${path} has no file-scope declaration of ${name}: a function declared only in a header or defined in another file — static or not — is shared or invisible across translation units, and an undeclared call is not bound`);
      const other = decls.find(item => item.kind !== "definition" && item.kind !== "prototype");
      if (other) return fail(`${name} is declared at ${path}:${other.line} in a form this reader does not bind (${other.kind})`);
      const gated = decls.find(item => item.conditional || file.facts.conditionals.some(([start, end]) => item.line >= start && item.line <= end));
      if (gated) return fail(`The declaration of ${name} at ${path}:${gated.line} lies inside #if/#ifdef; which branch is compiled is not evaluated`);
      const definitions = decls.filter(item => item.kind === "definition");
      if (definitions.length !== 1) return fail(definitions.length ? `${path} defines ${name} ${definitions.length} times` : `${path} declares ${name} but does not define it, so it is defined in another translation unit`);
      const definition = definitions[0], first = decls.reduce((a, b) => (b.startIndex < a.startIndex ? b : a));
      if (!first.static) return fail(`The first declaration of ${name} (${path}:${first.line}) is not static, so ${name} has external linkage: the definition a call reaches is decided by the link — several programs, weak symbols, ELF interposition — not by this file`);
      if (first.startIndex >= call.startIndex) return fail(`${name} is called before its first declaration in ${path} (line ${first.line}); an undeclared call is invalid from C99 and an implicit declaration in C89 has external linkage`);
      // A .c file another unit #includes (unity builds, test harnesses) is compiled
      // again under that unit's macros, which this proof never reads.
      const includer = (cx.includedAs.get(baseName(path)) || []).find(site => site.path !== path) || cx.computed.find(site => site.path !== path);
      if (includer) return fail(`${includer.path}:${includer.line} has an #include that ${cx.includedAs.get(baseName(path))?.includes(includer) ? `names ${baseName(path)}` : "is computed by a macro and may name this file"}; ${path} may also be compiled inside that translation unit, under macros this proof does not read`);
      const elsewhere = cx.outside[0];
      if (elsewhere) return fail(`${elsewhere.manifest} compiles ${elsewhere.file}, which is not in the snapshot; that translation unit may #include ${path} under macros this proof does not read`);
      const unseen = cx.unread.find(other => other !== path);
      if (unseen) return fail(`${unseen} is a C or C++ file whose text was not read in full, so it may #include ${path} under macros this proof does not read`);
      const unit = cUnit(path);
      if (unit.reason) return unit;
      for (const member of unit.members.slice(1)) {
        const shared = cx.files.get(member).facts.globals.find(item => item.name === name);
        if (shared) return fail(`${member}, included by ${path}, declares ${name} at line ${shared.line}; a header declaration is shared by every unit that includes it`);
      }
      const command = unit.command.macros.find(item => item.name === name);
      if (command) return fail(`${command.flag} in ${command.path} defines or undefines ${name} for ${path}`);
      const linkage = unit.macros.find(item => C_LINKAGE_MACROS.has(item.name));
      if (linkage) return fail(`A macro named ${linkage.name} is defined for ${path}${linkage.line ? ` (${linkage.path}:${linkage.line})` : ""}, so the written storage class is not the compiled one`);
      const hazards = cHazards(unit, name);
      const hazard = fn.words.find(word => hazards.has(word));
      if (hazard) return fail(`The calling function uses macro ${hazard}, whose expansion pastes tokens, leaves a bracket open or mentions ${name}; it may declare a local ${name} or hide the call`);
      const wrapper = (callee.within || []).find(word => unit.names.has(word));
      if (wrapper) return fail(`The call is an argument of ${wrapper}, a macro of this translation unit; a macro may discard, stringise or rewrite its arguments`);
      const steps = [
        { step: `the compile command for ${path} in ${unit.command.manifests.join(", ")} runs a C driver with no forced include and no -D/-U of ${name}`, path: unit.command.manifests[0], line: 1 },
        { step: `every #include of the translation unit opens a snapshot header (${unit.members.length - 1} header${unit.members.length === 2 ? "" : "s"}); no C file of the snapshot defines a macro ${name}, and no header declares ${name}`, path, line: file.facts.includes[0]?.line ?? definition.line },
        ...(first === definition ? [] : [{ step: `static ${name} is declared before the call`, path, line: first.line }]),
        { step: `${path} defines static ${name} once, outside any #if; the calling function declares no ${name}`, path, line: definition.line },
      ];
      const result = bound("c-static-function", path, definition.startIndex, steps);
      return result.resolution && result.resolution.name !== name ? fail(`The declaration symbol at ${path}:${definition.line} is not named ${name}`) : result;
    }

    // --------------------------------------------------------------- Swift
    /* Why argument types, not argument labels, are what makes a Swift call provable:
       module-scope lookup of a value name stops at the current module only when it
       finds something other than functions; when it finds only functions it goes on
       into every import, the implicit Swift standard library included
       (lib/AST/ModuleNameLookup.cpp: "If we only found top-level functions or macros,
       keep looking, since we may find additional overloads"). Shadowing then removes
       an imported declaration only when its interface type equals the local one
       (lib/AST/NameLookup.cpp, recordShadowedDeclsAfterSignatureMatch). So a local
       `func max(_ a: V, _ b: V)` does not hide Swift.max, and `max(1, 2)` calls the
       standard library: matching `f(x:y:)` against the module is not enough.
       What is enough: every argument is a parameter of the caller whose declared type
       is a nominal type T declared once in this module (module types shadow imported
       types for type lookup), and the module's single `f` takes exactly those types.
       The local candidate then needs no conversion at all, while an imported
       declaration cannot name T (its module cannot import this one) and can accept
       it only through a generic, existential or superclass parameter, which ranks as
       less specialized. The statement position, the synchronous unattributed caller
       and the non-async, non-throwing, unattributed callee remove the ranking inputs
       that could still prefer an import: a contextual result type, result builders,
       the async-context preference and @_disfavoredOverload. */
    let swift = null;
    function swiftIndex() {
      if (swift) return swift;
      let packages = null;
      try { packages = root.SkylenseProjectSwift?.packages([...fileMap.keys()], path => fileMap.get(path)?.text ?? null) || null; } catch { packages = null; }
      return (swift = { packages, modules: new Map() });
    }
    /** Every module-level name of one SwiftPM target, or why that set is not known. */
    function swiftModule(target) {
      const key = target.manifest + "\0" + target.name;
      if (swift.modules.has(key)) return swift.modules.get(key);
      const answer = (() => {
        const manifest = fileMap.get(target.manifest)?.text;
        const strip = root.SkylenseProjectSwift.stripComments;
        const clean = typeof manifest === "string" ? (strip ? strip(manifest) : manifest) : null;
        if (clean === null || /\bplugins\s*:/.test(clean)) return fail(`${target.manifest} applies build-tool plugins (or could not be read), and a plugin generates module sources outside the snapshot`);
        // SwiftPM picks a Package@swift-X.swift over Package.swift when the toolchain
        // is new enough; that manifest may declare other sources, exclusions or plugins.
        const manifestDir = dirOf(target.manifest);
        const versioned = [...fileMap.keys()].find(path => dirOf(path) === manifestDir && /^Package@swift-[\w.]+\.swift$/.test(path.slice(manifestDir ? manifestDir.length + 1 : 0)));
        if (versioned) return fail(`${versioned} is a version-specific manifest that a newer toolchain uses instead of ${target.manifest}; which one applies is not evaluated`);
        if (target.sourcesUnread) return fail(`target ${target.name} in ${target.manifest} states its path or sources in a form this reader cannot read, so which files it compiles is not known`);
        if (target.excludeUnread) return fail(`target ${target.name} in ${target.manifest} states exclude: or resources: in a form this reader cannot read, so which files it compiles is not known`);
        // exclude: and resources: name exact paths relative to the target directory;
        // a file at or below one is not compiled.
        const join = root.SkylenseProjectManifests?.joinPath;
        const removed = [...(target.exclude || []), ...(target.resources || [])].map(entry => join ? join(target.base, entry) : null);
        if (removed.some(entry => entry === null)) return fail(`an exclude: or resources: path of target ${target.name} points outside the snapshot or cannot be joined to ${target.base}`);
        const tools = /^\s*\/\/\s*swift-tools-version\s*:\s*(\d+)(?:\.(\d+))?/.exec(manifest);
        const toolsVersion = tools ? Number(tools[1]) + Number(tools[2] || 0) / 100 : null;
        const names = new Map(), files = new Set();
        const rootOf = path => target.roots.find(item => item === path || path.startsWith(item ? item + "/" : "")) ?? null;
        // A source the snapshot left out (ignored, too large, binary, cut by a file
        // limit) is still compiled by SwiftPM, and may hold another f.
        const dropped = typeof droppedPaths === "function" ? droppedPaths() : null;
        if (dropped && !dropped.complete) return fail(`The snapshot's record of left-out paths is incomplete, so files of target ${target.name} may be missing from the module`);
        const uncompiled = path => { const base = rootOf(path), rest = base ? path.slice(base.length + 1) : path; return rest.split("/").some(segment => segment.startsWith(".")) || removed.some(entry => path === entry || path.startsWith(entry + "/")); };
        const missing = (dropped?.entries || []).find(entry => rootOf(entry.path) !== null && !uncompiled(entry.path)
          && (/\.swift$/i.test(entry.path) || entry.directory === true || entry.directory === null && !/\.[A-Za-z0-9]+$/.test(entry.path.slice(entry.path.lastIndexOf("/") + 1))));
        if (missing) return fail(`${missing.path} under target ${target.name} was left out of the snapshot, but SwiftPM still compiles ${/\.swift$/i.test(missing.path) ? "it" : "the Swift files it may hold"}; the module's declarations are not all known`);
        for (const path of swift.packages.moduleFiles(target)) {
          if (removed.some(entry => path === entry || path.startsWith(entry + "/"))) continue;
          // SwiftPM never compiles a hidden file or a file below a hidden directory of a
          // target, and never looks inside a playground or Xcode project, nor (tools
          // 5.6+) inside a DocC catalog. Another directory named with an extension may
          // be a file-like resource bundle whose handling is not modelled.
          const base = rootOf(path), rest = base === null ? path : path.slice(base ? base.length + 1 : 0);
          const dirs = rest.split("/").slice(0, -1);
          if (rest.split("/").some(segment => segment.startsWith("."))) continue;
          if (dirs.some(segment => /\.(?:playground|xcodeproj|xcworkspace)$/i.test(segment))) continue;
          if (dirs.some(segment => /\.docc$/i.test(segment))) {
            if (toolsVersion !== null && toolsVersion >= 5.06) continue;
            return fail(`${path} lies in a DocC catalog of target ${target.name}, and the manifest's tools version (${tools ? tools[0].replace(/^\s*\/\/\s*/, "") : "not stated"}) does not establish that SwiftPM skips it`);
          }
          const odd = dirs.find(segment => /\.[A-Za-z0-9]+$/.test(segment));
          if (odd) return fail(`${path} lies in ${odd}, a directory named with an extension, which SwiftPM may treat as a resource rather than sources`);
          const facts = bindingOf(path);
          if (facts?.language !== "swift") return fail(`${path} of target ${target.name} has no Swift call-binding facts`);
          if (facts.truncated) return fail(`${path} of target ${target.name} reached the extraction ceiling`);
          if (facts.parseError) return fail(`${path} of target ${target.name} does not parse cleanly, so the module's declarations are not all known`);
          if (facts.attributes.length) return fail(`${path}:${facts.attributes[0].line} applies @${facts.attributes[0].name} to a module-level declaration; an attached macro may add module-level declarations`);
          if (facts.macros.length) return fail(`${path}:${facts.macros[0].line} expands a freestanding macro at module level, which may add declarations`);
          for (const decl of facts.decls) { const list = names.get(decl.name) || []; list.push({ ...decl, path }); names.set(decl.name, list); }
          files.add(path);
        }
        return { target, names, files };
      })();
      swift.modules.set(key, answer);
      return answer;
    }
    const swiftVisible = (decl, path) => !["private", "fileprivate"].includes(decl.visibility) || decl.path === path;
    function swiftBind(path, call) {
      const callee = call.callee;
      if (!callee) return fail("The call is not a form this reader binds");
      if (callee.refused) return fail(callee.refused);
      swiftIndex();
      const target = swift.packages?.targetOf(path);
      if (!target) return fail(`No readable Package.swift target owns ${path}, so the module that module-level lookup searches is not proven`);
      const module = swiftModule(target);
      if (!module.names) return module;
      if (!module.files.has(path)) return fail(`${path} is excluded, a resource, or under a hidden, playground, Xcode-project or DocC path of target ${target.name}, so SwiftPM does not compile it`);
      const where = `module ${target.name} (${target.manifest})`, steps = [];
      const decls = module.names.get(callee.name) || [];
      if (!decls.length) return fail(`${where} declares no ${callee.name} at module level; it may come from the standard library or an import`);
      if (decls.length > 1) return fail(`${where} has ${decls.length} module-level declarations or uses of ${callee.name} (overloads, variables, types or top-level code)`);
      const fn = decls[0];
      if (fn.kind !== "function") return fail(`${callee.name} in ${where} is a ${fn.kind === "type" ? "type, so the call is an initializer" : fn.kind === "code" ? "name written in module-level code" : fn.kind}, not a function`);
      if (fn.conditional) return fail(`func ${callee.name} in ${fn.path} is inside #if; the other configurations are not evaluated`);
      if (fn.problem) return fail(`func ${callee.name} in ${fn.path} is not bound because ${fn.problem}`);
      if (!swiftVisible(fn, path)) return fail(`func ${callee.name} is ${fn.visibility} to ${fn.path}, so it is not visible from ${path}`);
      const labelOf = label => label === null ? "_" : label;
      if (fn.params.length !== callee.labels.length || fn.params.some((param, index) => param.label !== callee.labels[index]))
        return fail(`func ${callee.name}(${fn.params.map(param => labelOf(param.label) + ":").join("")}) does not take the call's labels (${callee.labels.map(label => labelOf(label) + ":").join("")})`);
      const mismatch = fn.params.findIndex((param, index) => param.type !== callee.types[index]);
      if (mismatch >= 0) return fail(`Argument ${callee.args[mismatch]} has type ${callee.types[mismatch]} but func ${callee.name} declares ${fn.params[mismatch].type}; with any conversion, an imported overload may rank better`);
      steps.push({ step: `the call is a statement of synchronous top-level func ${callee.caller.name}, whose argument${callee.args.length === 1 ? "" : "s"} ${callee.args.join(", ")} ${callee.args.length === 1 ? "is a parameter" : "are parameters"} declared with type ${[...new Set(callee.types)].join(", ")} and not rebound`, path, line: callee.caller.line });
      for (const name of new Set(callee.types)) {
        const types = module.names.get(name) || [];
        if (types.length !== 1 || types[0].kind !== "type") return fail(`${name} is not declared exactly once in ${where} as a type (${types.length} module-level declarations); an imported ${name} could be the parameter type`);
        const type = types[0];
        if (!["struct", "class", "enum", "actor"].includes(type.typeKind)) return fail(`${name} is a ${type.typeKind}, not a nominal struct, class, enum or actor`);
        if (type.generic) return fail(`${name} is generic`);
        if (type.conditional) return fail(`${name} is declared inside #if`);
        if (!swiftVisible(type, path) || !swiftVisible(type, fn.path)) return fail(`${name} is ${type.visibility} to ${type.path}`);
        steps.push({ step: `${type.typeKind} ${name} is declared once in ${where}, so the parameter types name it and no imported declaration can`, path: type.path, line: type.line });
      }
      steps.push({ step: `${where} declares ${callee.name} once at module level: a non-generic, synchronous, non-throwing function whose labels and parameter types are exactly the arguments'`, path: fn.path, line: fn.line });
      return bound("swift-module-function", fn.path, fn.startIndex, steps);
    }

    // ------------------------------------------------------------------ C#
    /* `Type.M(args)`: simple-name lookup of Type (C# spec §12.8.4) visits, in order,
       locals and parameters, then each enclosing type's type parameters and members
       (inherited ones included), then each namespace from the innermost outward —
       its member types first, and only then the using directives of that namespace
       body. So Type is proven when nothing in the member binds it, no enclosing type
       or base has a member of that name, and the caller's own namespace declares it
       in source (a source type wins over a referenced assembly's). Outer namespaces
       and using directives are never searched: a referenced assembly's type in an
       inner namespace, or its global type, could be found first. Member lookup of M
       then covers Type and its base classes; with exactly one member named M, a
       static method whose parameters the arguments provably convert to, overload
       resolution has one applicable candidate, and extension members — classic or
       C# 14 static ones from any assembly — are consulted only when no applicable
       method is found (§12.8.10.2), so they cannot change the target. A partial type
       may receive generated members, so a partial type is bound only in a project
       that references no package, analyzer or UI SDK that could generate them. */
    const CSHARP_OBJECT_MEMBERS = new Set(["Equals", "GetHashCode", "GetType", "ToString", "MemberwiseClone", "ReferenceEquals", "Finalize"]);
    const CSHARP_RECORD_MEMBERS = new Set(["PrintMembers", "Deconstruct", "EqualityContract", "<Clone>$"]);
    /** Implicit identity, numeric and nullable conversions from a proven argument type (§10.2). */
    const CSHARP_CONVERTS = { int: ["int", "long", "float", "double", "decimal"], long: ["long", "float", "double", "decimal"], float: ["float", "double"], double: ["double"], decimal: ["decimal"], char: ["char", "int", "long", "float", "double", "decimal"], string: ["string"], bool: ["bool"] };
    function csharpConverts(arg, to) {
      if (!to) return false;
      if (to === "object" || to === "object?") return true;
      const target = to.replace(/\?$/, "");
      if (arg.kind !== "param") return (CSHARP_CONVERTS[arg.kind] || []).includes(target);
      const from = arg.type.replace(/\?$/, "");
      if (!arg.type.endsWith("?") || from === "string") return (CSHARP_CONVERTS[from] || []).includes(target);
      return to === arg.type;
    }
    function csharpApplicable(method, args) {
      const { params, paramsArray } = method;
      const modified = params.find(param => param.modifiers.length);
      if (modified) return `parameter ${modified.name} is ${modified.modifiers.join(" ")}`;
      if (args.length > params.length && !paramsArray) return `it takes ${params.length} parameter${params.length === 1 ? "" : "s"} and the call passes ${args.length} arguments`;
      for (let i = 0; i < args.length; i++) {
        const to = i < params.length ? params[i].type : paramsArray.element;
        if (!csharpConverts(args[i], to)) return `argument ${args[i].text}${args[i].kind === "param" ? ` (${args[i].type})` : ""} is not proven to convert to ${i < params.length ? `parameter ${params[i].name}` : "the params element"} (${to || "a type that is not a predefined type"})`;
      }
      const missing = params.slice(args.length).find(param => !param.optional);
      return missing ? `parameter ${missing.name} has no argument and no default value` : null;
    }
    let cs = null;
    function csIndex() {
      if (cs) return cs;
      const projects = [], files = new Map(), sources = [], buildNamed = new Map();
      // Every path MSBuild may import under one of these names, keyed case-insensitively:
      // File.Exists finds `Directory.build.props` as well on Windows and macOS.
      const noteBuild = (path, item) => { if (!CS_BUILD_FILE.test(path)) return; const key = path.toLowerCase(); if (!buildNamed.has(key)) buildNamed.set(key, []); buildNamed.get(key).push({ path, ...item }); };
      for (const [path, value] of fileMap) {
        if (/\.csproj$/i.test(path)) projects.push({ path, dir: dirOf(path), text: typeof value.text === "string" ? value.text : null });
        if (/\.cs$/i.test(path)) sources.push(path);
        if (value.facts?.callBinding?.language === "c_sharp") files.set(path, value.facts.callBinding);
        noteBuild(path, { text: typeof value.text === "string" ? value.text : null, dropped: false });
      }
      const ownerOf = path => { let owner = null; for (const project of projects) if ((project.dir === "" || path.startsWith(project.dir + "/")) && (!owner || project.dir.length > owner.dir.length)) owner = project; return owner; };
      const dropped = typeof droppedPaths === "function" ? droppedPaths() : { entries: [], complete: true };
      for (const entry of dropped.entries) noteBuild(entry.path, { text: null, dropped: true });
      // A .git entry at the snapshot root makes it a repository root: a directory in a
      // clone, a `gitdir:` file in a worktree or submodule checkout.
      const gitRoot = fileMap.has(".git") || dropped.entries.some(entry => entry.path === ".git" || entry.path.startsWith(".git/"));
      return (cs = { projects, files, sources, dropped, buildNamed, gitRoot, ownerOf, compilations: new Map() });
    }
    /** Files MSBuild imports into a project by name: the nearest Directory.Build.props,
     *  Directory.Build.targets, Directory.Packages.props and Directory.Build.rsp above it,
     *  and `<project>.csproj.user` beside it. */
    const CS_BUILD_NAMES = ["Directory.Build.props", "Directory.Build.targets", "Directory.Packages.props", "Directory.Build.rsp"];
    const CS_BUILD_FILE = /(^|\/)directory\.(build\.(props|targets|rsp)|packages\.props)$|\.csproj\.user$/i;
    /** Text in a project or imported file that changes which files Microsoft.NET.Sdk
     *  compiles or its default excludes (bin/, obj/, output and publish folders, the
     *  artifacts layout), adds an SDK, imports another file or replaces CoreCompile. */
    const CS_ITEM_CHANGES = /<Compile\b|ItemName\s*=\s*["']\s*Compile\s*["']|EnableDefault(Compile)?Items|DefaultItemExcludes|DefaultExcludesInProjectFolder|OutputPath|PublishDir|UseArtifactsOutput|ArtifactsPath|<Import\b|<Sdk\b|DirectoryBuild\w*Path|CustomBeforeMicrosoft|CustomAfterMicrosoft|Name\s*=\s*["']\s*CoreCompile\b/i;
    /** A response-file switch that sets a property or includes another response file. */
    const CS_RSP_CHANGES = /(^|\s)(--|-|\/)(p|property|rp|restoreProperty)\s*:|(^|\s)@\S/im;
    /** Whether the SDK's default item excludes drop `path` from `project`'s compile glob:
     *  "skip" under a dot-directory (`**\/.*\/**`) or the project's bin/; "obj" under its
     *  obj/, whose generated sources the build adds back as explicit items; "refuse" under
     *  a bin/obj spelling that matches only on a case-insensitive file system; else null. */
    function csDefaultExcluded(project, path) {
      const dirs = path.slice(project.dir ? project.dir.length + 1 : 0).split("/").slice(0, -1);
      if (dirs.some(dir => dir.startsWith("."))) return "skip";
      if (dirs[0] === "bin") return "skip";
      if (dirs[0] === "obj") return "obj";
      if (dirs[0] && /^(bin|obj)$/i.test(dirs[0])) return "refuse";
      return null;
    }
    /** The files a project's default compile glob takes (every .cs file under its
     *  directory, nested project directories included), grouped into types. Refuses
     *  whenever the snapshot does not prove which files MSBuild compiles. */
    function csCompilation(project) {
      if (cs.compilations.has(project.path)) return cs.compilations.get(project.path);
      const answer = (() => {
        if (project.text === null) return fail(`${project.path} was not read into the snapshot`);
        const sdk = /<Project\b[^>]*\bSdk\s*=\s*(["'])(.*?)\1/i.exec(project.text)?.[2];
        if (sdk !== "Microsoft.NET.Sdk") return fail(`${project.path} uses ${sdk ? "SDK " + sdk : "no Sdk attribute"}, and only Microsoft.NET.Sdk's default compile items are modelled (Web, Razor and other SDKs add or remove items)`);
        if (CS_ITEM_CHANGES.test(project.text)) return fail(`${project.path} lists Compile items, changes default items, their excludes or the output paths, adds an SDK or imports another project file, so which files it compiles is not the default glob`);
        const buildFiles = [], imported = [];
        for (let dir = project.dir; ; dir = dirOf(dir)) {
          for (const name of CS_BUILD_NAMES) imported.push(dir ? dir + "/" + name : name);
          if (!dir) break;
        }
        imported.push(project.path + ".user");
        for (const at of imported) for (const item of cs.buildNamed.get(at.toLowerCase()) || []) {
          if (item.dropped) return fail(`${item.path} was left out of the snapshot (excluded or unreadable), and MSBuild imports it into ${project.path}`);
          if (item.path !== at) return fail(`${item.path} is found as ${at.slice(at.lastIndexOf("/") + 1)} on a case-insensitive file system, so whether MSBuild imports it into ${project.path} depends on the build machine`);
          if (item.text === null) return fail(`${item.path} was not read as text, so what it changes in ${project.path} is not known`);
          buildFiles.push({ path: item.path, text: item.text });
        }
        const changes = buildFiles.find(file => /\.rsp$/i.test(file.path) ? CS_RSP_CHANGES.test(file.text) : CS_ITEM_CHANGES.test(file.text));
        if (changes) return fail(`${changes.path} may change the compile items of ${project.path}: it ${/\.rsp$/i.test(changes.path) ? "sets a property or includes a response file" : "lists Compile items, changes default items, their excludes or the output paths, or imports a file that may"}`);
        // Only the nearest file of each name is imported, so one in the snapshot hides
        // those above the root. Folders above the root are never read, so a name not found
        // inside is taken as absent above only at a repository root (a GitHub tree, or .git
        // at the root): the csharp row states the premise that nothing above it is imported.
        const nearest = new Set(buildFiles.map(file => file.path.slice(file.path.lastIndexOf("/") + 1).toLowerCase()));
        const open = CS_BUILD_NAMES.filter(name => !nearest.has(name.toLowerCase()));
        if (open.length && !snapshotRoot?.repository && !cs.gitRoot) return fail(`The snapshot root is not shown to be a repository root (no .git there), so a ${open[0]} above it, which MSBuild imports, may change what ${project.path} compiles`);
        const under = path => !project.dir || path.startsWith(project.dir + "/");
        for (const path of cs.sources) {
          if (!under(path)) continue;
          const excluded = csDefaultExcluded(project, path), facts = cs.files.get(path);
          if (excluded === "refuse") return fail(`${path} is under a bin/obj spelling of ${project.path} that the default excludes match only on a case-insensitive file system, so whether it is compiled is not known`);
          if (excluded === "obj" && (!facts || facts.parseError || facts.truncated || facts.types.length || facts.namespaces.length)) return fail(`${path} under ${project.path}'s obj/ ${facts ? "declares a type or namespace (or does not parse cleanly)" : "has no C# call-binding facts"}, and the build compiles generated sources there`);
          if (excluded) continue;
          if (!facts) return fail(`${path}, compiled by ${project.path}, has no C# call-binding facts (unreadable, over a size limit or not parsed), so the project's declarations are not all known`);
          if (!path.endsWith(".cs")) return fail(`${path} is compiled by the **/*.cs glob only where file matching ignores case, so whether ${project.path} compiles it depends on the build machine`);
        }
        if (!cs.dropped.complete) return fail(`The snapshot's source accounting did not keep every left-out path or stopped discovery early, so files ${project.path} compiles may be missing`);
        const missing = cs.dropped.entries.find(entry => under(entry.path) && !["skip", "obj"].includes(csDefaultExcluded(project, entry.path + (/\.cs$/i.test(entry.path) ? "" : "/x")))
          && (entry.directory || /\.cs$/i.test(entry.path) || (entry.directory === null && !/\.[^/.]+$/.test(entry.path))));
        if (missing) return fail(`${missing.path} under ${project.path} was left out of the snapshot (excluded, unreadable or a symlink not followed), and the project's default glob may compile C# files there`);
        const groups = new Map(), byPart = new Map(), namespaces = new Set();
        for (const [path, facts] of cs.files) {
          if (!under(path) || csDefaultExcluded(project, path)) continue;
          if (facts.parseError || facts.truncated) return fail(`${path}, compiled by ${project.path}, does not parse cleanly, so the project's declarations are not all known`);
          for (const name of facts.namespaces) namespaces.add(name);
          const local = new Map(facts.types.map(type => [type.key, type]));
          const qualify = type => { const own = type.name + (type.typeParams.length ? "`" + type.typeParams.length : ""); return type.outer === null ? (type.namespace ? type.namespace + "." : "") + own : qualify(local.get(type.outer)) + "+" + own; };
          for (const type of facts.types) {
            const part = { ...type, path, qualified: qualify(type) };
            byPart.set(path + "#" + type.key, part);
            const group = groups.get(part.qualified) || { qualified: part.qualified, name: part.name, kind: part.kind, parts: [], members: [] };
            group.parts.push(part);
            group.members.push(...type.members.map(member => ({ ...member, path, owner: part.qualified })));
            groups.set(part.qualified, group);
          }
        }
        return { project, buildFiles, groups, byPart, namespaces, generators: undefined };
      })();
      cs.compilations.set(project.path, answer);
      return answer;
    }
    function csGroupProblem(group) {
      if (group.parts.length > 1 && group.parts.some(part => !part.modifiers.includes("partial"))) return `${group.name} is declared ${group.parts.length} times (${group.parts.map(part => part.path + ":" + part.line).join(", ")}) and not every part is partial`;
      if (new Set(group.parts.map(part => part.kind)).size > 1) return `the parts of ${group.name} declare different kinds`;
      const gated = group.parts.find(part => part.conditional);
      if (gated) return `${group.name} is declared inside #if at ${gated.path}:${gated.line}; other configurations are not evaluated`;
      const unknown = group.parts.find(part => part.unknownMembers.length);
      if (unknown) return `${group.name} has a member this reader does not model (${unknown.unknownMembers[0].type} at ${unknown.path}:${unknown.unknownMembers[0].line})`;
      return null;
    }
    /** The base class of a class or record group: null for object/ValueType. */
    function csBase(comp, group, depth) {
      if (!["class", "record"].includes(group.kind)) return { group: null };
      const declared = group.parts.filter(part => part.base);
      if (!declared.length) return { group: null };
      const part = declared[0], name = part.base.name;
      if (new Set(declared.map(item => item.base.name || item.base.complex)).size > 1) return fail(`the parts of ${group.name} state different base lists`);
      if (!name) return fail(`the first base of ${group.name}, ${part.base.complex}, is not a simple type name this reader resolves; members it would contribute are unknown`);
      if (group.members.some(member => member.name === name)) return fail(`${group.name} has a member named like its base ${name}`);
      const outer = [];
      for (let key = part.outer; key !== null && key !== undefined; key = comp.byPart.get(part.path + "#" + key)?.outer) outer.push(comp.byPart.get(part.path + "#" + key));
      const found = csResolveType(comp, { path: part.path, enclosing: outer, namespace: part.namespace }, name, [], depth + 1);
      if (!found.group) return fail(`the first base ${name} of ${group.name} is not a type of the snapshot this reader resolves (${found.reason}), so the members it contributes are unknown`);
      if (found.group.kind === "interface") return { group: null };
      if (!["class", "record"].includes(found.group.kind)) return fail(`the base ${name} of ${group.name} is a ${found.group.kind}`);
      return { group: found.group };
    }
    /** Members named `name` that `group` inherits, with every base group visited. */
    function csInherited(comp, group, name, depth) {
      const members = [], chain = [];
      for (let current = group, n = 0; ; n++) {
        if (n > MAX_DEPTH || depth > MAX_DEPTH) return fail(`the base chain of ${group.name} is deeper than this reader follows`);
        const base = csBase(comp, current, depth);
        if (base.reason) return base;
        if (!base.group) return { members, chain };
        const problem = csGroupProblem(base.group);
        if (problem) return fail(problem);
        if (chain.includes(base.group)) return fail(`the base chain of ${group.name} is cyclic`);
        chain.push(base.group);
        members.push(...base.group.members.filter(member => member.name === name));
        current = base.group;
      }
    }
    function csResolveType(comp, ctx, name, steps, depth) {
      if (depth > MAX_DEPTH) return fail("Type resolution goes through too many base lists");
      for (const part of ctx.enclosing) {
        const group = comp.groups.get(part.qualified), problem = csGroupProblem(group);
        if (problem) return fail(problem);
        if (group.parts.some(item => item.typeParams.includes(name))) return fail(`${name} is a type parameter of ${group.name}`);
        if (group.parts.some(item => item.primaryParams.includes(name))) return fail(`${name} is a primary-constructor parameter of ${group.name}, in scope in its body`);
        const own = group.members.filter(member => member.name === name);
        if (own.length) {
          if (own.every(member => member.kind === "type" && member.arity === 0)) {
            const nested = comp.groups.get(group.qualified + "+" + name), nestedProblem = nested ? csGroupProblem(nested) : `nested type ${name} is not indexed`;
            if (nestedProblem) return fail(nestedProblem);
            steps.push({ step: `${name} is the nested type ${group.name}.${name}, the only member of ${group.name} so named`, path: nested.parts[0].path, line: nested.parts[0].line });
            return { group: nested };
          }
          return fail(`${group.name} has a ${own[0].kind} named ${name}, which simple-name lookup finds before any type`);
        }
        if (CSHARP_OBJECT_MEMBERS.has(name)) return fail(`${name} is a member every type inherits from object`);
        const inherited = csInherited(comp, group, name, depth);
        if (inherited.reason) return fail(`${name} may be a member inherited by ${group.name}: ${inherited.reason}`);
        if (inherited.members.length) return fail(`${group.name} inherits a ${inherited.members[0].kind} named ${name}, which simple-name lookup finds before any type`);
      }
      const qualified = (ctx.namespace ? ctx.namespace + "." : "") + name;
      if (comp.namespaces.has(qualified)) return fail(`${qualified} is a namespace of project ${comp.project.path}`);
      const group = comp.groups.get(qualified);
      if (!group) return fail(`No type ${name} is declared in namespace ${ctx.namespace || "<global>"} of ${comp.project.path}; enclosing namespaces, using directives and referenced assemblies are not searched, because a type outside the snapshot could be found first`);
      const problem = csGroupProblem(group);
      if (problem) return fail(problem);
      const foreign = group.parts.find(part => cs.ownerOf(part.path) !== comp.project);
      if (foreign) return fail(`${name} is declared in ${foreign.path}, which belongs to another project nested under ${comp.project.dir || "."}`);
      const local = group.parts.find(part => part.modifiers.includes("file") && part.path !== ctx.path);
      if (local) return fail(`${name} is a file-local type of ${local.path}, not visible from ${ctx.path}`);
      steps.push({ step: `${name} is declared in namespace ${ctx.namespace || "<global>"} of ${comp.project.path}${group.parts.length > 1 ? ` (${group.parts.length} partial parts)` : ""}, and nothing in scope before that namespace's member types has that name`, path: group.parts[0].path, line: group.parts[0].line });
      return { group };
    }
    /** Why generated code could extend a partial type in this project, or null. */
    function csGenerators(comp) {
      if (comp.generators !== undefined) return comp.generators;
      const sdk = /<Project\b[^>]*\bSdk\s*=\s*"([^"]*)"/i.exec(comp.project.text)?.[1];
      const files = [{ path: comp.project.path, text: comp.project.text }, ...comp.buildFiles];
      const feeds = files.find(file => /PackageReference|<Analyzer\b|OutputItemType|<Sdk\b|UseWPF|UseWindowsForms|UseMaui|UseRazor/i.test(file.text));
      const markup = [...fileMap.keys()].find(path => (!comp.project.dir || path.startsWith(comp.project.dir + "/")) && /\.(?:xaml|axaml|razor|cshtml)$/i.test(path));
      comp.generators = sdk !== "Microsoft.NET.Sdk" ? `${comp.project.path} uses SDK ${sdk || "(not stated)"}, which may generate partial members (Razor, XAML, Web)`
        : feeds ? `${feeds.path} references packages, analyzers or UI frameworks whose source generators may add members`
        : markup ? `${markup} is markup whose generator emits partial classes` : null;
      return comp.generators;
    }
    function csharpBind(path, call) {
      const callee = call.callee;
      if (!callee) return fail("The call is not a form this reader binds");
      if (callee.refused) return fail(callee.refused);
      csIndex();
      const project = cs.ownerOf(path);
      if (!project) return fail(`No .csproj in the snapshot covers ${path}, so the compilation that declares the namespace's types is not known`);
      const callerExcluded = csDefaultExcluded(project, path);
      if (callerExcluded) return fail(`${path} is under a hidden folder, bin/ or obj/ of ${project.path}, which the default compile glob ${callerExcluded === "skip" ? "excludes" : "may exclude"}, so the call is not proven to be compiled`);
      const comp = csCompilation(project);
      if (!comp.groups) return comp;
      // Top-level statements are the body of the synthesized class Program, which a
      // `partial class Program` in the project extends with members that are in scope.
      const enclosing = callee.topLevel ? comp.groups.get("Program")?.parts.slice(0, 1) || [] : callee.enclosing.map(key => comp.byPart.get(path + "#" + key));
      if (enclosing.some(part => !part)) return fail("An enclosing type of the call has no indexed declaration");
      const steps = [{ step: `${callee.type} is not a local, parameter, range or pattern variable anywhere in the member holding the call`, path, line: call.line }];
      const found = csResolveType(comp, { path, enclosing, namespace: callee.namespace }, callee.type, steps, 0);
      if (!found.group) return found;
      const group = found.group, method = callee.method;
      if (!["class", "struct", "record", "record struct"].includes(group.kind)) return fail(`${group.name} is ${group.kind === "interface" ? "an interface" : "a " + group.kind}; its static members are not bound`);
      if (CSHARP_OBJECT_MEMBERS.has(method)) return fail(`${method} is declared by System.Object, which ${group.name} inherits; its overloads there are not in the snapshot`);
      if (group.kind.startsWith("record") && CSHARP_RECORD_MEMBERS.has(method)) return fail(`${method} is synthesized for record ${group.name}`);
      if (group.kind.startsWith("record") && group.parts.some(part => part.primaryParams.includes(method))) return fail(`${method} is a positional property of record ${group.name}`);
      const inherited = csInherited(comp, group, method, 0);
      if (inherited.reason) return fail(`Members of ${group.name}'s bases are not all known: ${inherited.reason}`);
      const all = [...group.members.filter(member => member.name === method), ...inherited.members];
      if (!all.length) return fail(`${group.name} and its bases declare no ${method}; an extension member or a referenced assembly would supply the target`);
      if (all.length > 1) return fail(`${group.name} and its bases have ${all.length} members named ${method} (overloads or hiding members are not ranked)`);
      const target = all[0];
      if (target.kind !== "method") return fail(`${group.name}.${method} is a ${target.kind}, not a method`);
      if (target.explicit) return fail(`${group.name}.${method} is an explicit interface implementation`);
      if (target.arity) return fail(`${group.name}.${method} is generic; type inference is not evaluated`);
      if (!target.modifiers.includes("static")) return fail(`${group.name}.${method} is an instance method`);
      if (target.modifiers.includes("partial")) return fail(`${group.name}.${method} is a partial method, whose implementation may be generated`);
      if (target.conditional) return fail(`${group.name}.${method} is declared inside #if; other configurations are not evaluated`);
      const access = target.modifiers.filter(item => ["public", "internal", "protected", "private"].includes(item)).join(" ");
      const visible = access === "public" || access === "internal" || access === "protected internal" || enclosing.some(part => part.qualified === target.owner);
      if (!visible) return fail(`${group.name}.${method} is ${access || "private"} and the call is outside ${target.owner}; an inaccessible method is not a candidate`);
      const inapplicable = csharpApplicable(target, callee.args);
      if (inapplicable) return fail(`${group.name}.${method} is not proven applicable: ${inapplicable}; an extension member could then be the target`);
      const involved = new Set([group, ...inherited.chain]);
      for (const part of enclosing) {
        const outer = comp.groups.get(part.qualified);
        involved.add(outer);
        const chain = csInherited(comp, outer, "\0", 0);
        for (const item of chain.chain || []) involved.add(item);
      }
      const partial = [...involved].find(item => item.parts.length > 1 || item.parts.some(part => part.modifiers.includes("partial")));
      if (partial) {
        const reason = csGenerators(comp);
        if (reason) return fail(`${partial.name} is partial and ${reason}`);
        const attributed = partial.parts.find(part => part.attributes) || partial.members.find(member => member.attributes);
        if (attributed) return fail(`${partial.name} is partial and carries attributes (${attributed.path}:${attributed.line}), which source generators read to add members`);
      }
      steps.push({ step: `${group.name}${inherited.chain.length ? ` and its bases ${inherited.chain.map(item => item.name).join(", ")}` : ""} declare exactly one member named ${method}: a non-generic ${access || "private"} static method`, path: target.path, line: target.line });
      steps.push({ step: `every argument (${callee.args.map(arg => arg.text).join(", ") || "none"}) converts implicitly to its parameter, so ${method} is the single applicable candidate and no extension member is consulted`, path, line: call.line });
      return bound("csharp-static-method", target.path, target.startIndex, steps);
    }

    // ------------------------------------------------------ Kotlin, Scala
    /* Kotlin https://kotlinlang.org/spec/overload-resolution.html
         kotlin-package-function   `f()`: nothing inside the enclosing top-level declaration
                                   declares f, no enclosing class, object or companion has
                                   supertypes, no lambda, extension or object expression
                                   encloses the call, no import names f, and the package
                                   declares f exactly once on the caller's compile path,
                                   as a visible non-extension function.
         kotlin-import-function    the same, with f reached through one `import a.b.f`
                                   (or `import a.b.g as f`) and nothing named f in the
                                   caller's own package.
         kotlin-object-method      `Obj.f()`: Obj is a top-level object declared once in
                                   the caller's package or by one explicit import, with no
                                   supertypes, and declares exactly one member named f, a
                                   visible non-extension function; no extension named f is
                                   declared or imported where the call can see it.
         kotlin-companion-method   `C.f()`: the same through the companion object of class C.
       The spec takes the first candidate level that holds an *applicable* callable
       (#call-without-an-explicit-receiver, #call-with-an-explicit-receiver), so a
       declaration that does not accept the arguments falls through to star imports and
       to the default imports. Argument types are not checked here, so a call binds only
       when every lower level is known to hold nothing of that name: every star import
       names a package on the compile path that declares no such name, and the name is
       not in KOTLIN_DEFAULT. A capitalised callee is never bound: it may be a constructor
       or SAM constructor of a class from kotlin.* or java.lang.*.
       Measured reach (November 2026, fwcd/tree-sitter-kotlin d6af96d): 26 resolved calls on
       square/moshi (17 package, 2 import, 4 object, 3 companion), each checked by hand
       against the source; 0 on square/kotlinpoet, whose sources sit in Kotlin Multiplatform
       source sets that no recognised Gradle source root declares.
       Scala: no call is bound. A sound `Obj.f(…)` rule needs import scoping this reader
       does not model — block-local imports and their position, selectors that hide or
       rename (`{X => _, _}`), wildcard imports outranking package members, and inherited
       or Java static members of imported objects — plus implicit views (spec §7.3). The
       bundled tree-sitter-scala 0.19.0 also fails on 19 of the 29 files of scopt/scopt. */
    /* Every non-extension function, and every extension declared on a type parameter or
       on Any, of the packages Kotlin/JVM imports by default (kotlin, kotlin.annotation,
       kotlin.collections, kotlin.comparisons, kotlin.io, kotlin.ranges, kotlin.sequences,
       kotlin.text, kotlin.jvm), read from the kotlin-stdlib API reference
       https://kotlinlang.org/api/core/kotlin-stdlib/ in October 2026, plus Any's members.
       java.lang declares no functions outside classes. A later standard library may add
       a name; this list is the stated catalogue a binding is relative to. */
    const KOTLIN_DEFAULT = new Set(("also append appendRange apply arrayListOf arrayOf arrayOfNulls assert booleanArrayOf buildList buildMap buildSet buildString byteArrayOf "
      + "charArrayOf charset check checkNotNull coerceAtLeast coerceAtMost coerceIn compareBy compareByDescending compareValues compareValuesBy contains context contextOf "
      + "createTempDir createTempFile doubleArrayOf emptyArray emptyList emptyMap emptySequence emptySet enumValueOf enumValues error floatArrayOf generateSequence hashCode "
      + "hashMapOf hashSetOf ifBlank ifEmpty intArrayOf iterator lazy lazyOf let linkedMapOf linkedSetOf linkedStringMapOf linkedStringSetOf listOf "
      + "listOfNotNull longArrayOf mapOf maxOf minOf mutableListOf mutableMapOf mutableSetOf naturalOrder nullsFirst nullsLast onEach onEachIndexed print "
      + "println rangeTo rangeUntil readLine readln readlnOrNull repeat require requireNotNull reverseOrder run runCatching sequence sequenceOf "
      + "setOf setOfNotNull shortArrayOf sortedMapOf sortedSetOf stringMapOf stringSetOf suspend synchronized takeIf takeUnless to toString ubyteArrayOf "
      + "uintArrayOf ulongArrayOf use ushortArrayOf with equals").split(" "));
    let jvmc = null;
    /** Every Kotlin, Scala and Java source of the snapshot with its package and top-level
     *  names. A source with no usable facts (over a size or text budget, a grammar failure,
     *  syntax errors) is kept as partial, so it taints the packages it may belong to. */
    function jvmcIndex() {
      if (jvmc) return jvmc;
      const files = new Map(), byPackage = new Map(), unknown = [];
      const push = (map, key, value) => { const list = map.get(key) || []; list.push(value); map.set(key, list); };
      const add = file => { files.set(file.path, file); if (file.pkg === null) unknown.push(file); else push(byPackage, file.pkg, file); };
      for (const [path, value] of fileMap) {
        const facts = value.facts?.callBinding;
        if (!facts || !["kotlin", "scala", "java"].includes(facts.language)) continue;
        // A script is not a member of any package; it compiles to its own class.
        if (facts.language === "kotlin" && path.endsWith(".kts")) continue;
        const language = facts.language, file = { path, language, pkg: facts.package ?? null, partial: Boolean(facts.partial || facts.truncated), facts, entries: [] };
        if (language === "java") for (const type of facts.types || []) { if (type.parent === null && type.name) file.entries.push({ name: type.name, decl: { kind: "java-type", line: type.line } }); }
        else if (language === "kotlin") for (const decl of facts.declarations) file.entries.push({ name: decl.name, decl });
        else for (const decl of facts.declarations) for (const name of decl.names) file.entries.push({ name, decl });
        add(file);
      }
      // The Java resolver's list of JVM sources it could not model names the files without
      // facts; their package is the one their head states, or unknown.
      for (const item of javaIndex().unparsed) if (!files.has(item.path) && !item.path.endsWith(".kts"))
        add({ path: item.path, language: null, pkg: item.package, partial: true, facts: null, entries: [] });
      return (jvmc = { files, byPackage, unknown, views: new Map() });
    }
    /** The caller's compile path: `roots` as project-jvm states it (own module, direct
     *  dependencies), and `reach` (jvmReach), which adds every module reachable through
     *  dependency chains. Absence is proven over `reach`; a target must lie on `roots`. */
    function jvmcView(path) {
      if (!jvmc.views.has(path)) {
        const view = jvmRoots()?.visibleRoots(path) || null;
        jvmc.views.set(path, view && { ...view, reach: jvmReach(view) });
      }
      return jvmc.views.get(path);
    }
    const onPath = (view, path) => view.reach.some(dir => dir === "" || path.startsWith(dir + "/"));
    const direct = (view, path) => view.roots.some(dir => dir === "" || path.startsWith(dir + "/"));
    const pkgLabel = pkg => (pkg ? `package ${pkg}` : "the default package");
    /** Top-level declarations named `name` in `pkg` among the files on the compile path. */
    function pkgMembers(view, pkg, name) {
      const result = { found: [], taint: null, exists: false };
      for (const file of jvmc.unknown) if (file.partial && onPath(view, file.path)) { result.taint = `${file.path} has no usable syntax facts or did not parse far enough to state its package, so it may declare ${name} in ${pkgLabel(pkg)}`; break; }
      for (const file of jvmc.byPackage.get(pkg) || []) {
        if (!onPath(view, file.path)) continue;
        result.exists = true;
        if (file.partial) result.taint ||= `${file.path} in ${pkgLabel(pkg)} did not parse completely, so its declarations are not all known`;
        for (const entry of file.entries) if (entry.name === name) result.found.push({ ...entry, path: file.path, language: file.language });
      }
      return result;
    }
    const packageRoot = (view, name) => [...jvmc.byPackage.keys()].some(pkg => (pkg === name || pkg.startsWith(name + ".")) && jvmc.byPackage.get(pkg).some(file => onPath(view, file.path)));
    const describe = entry => (entry.language === "kotlin" ? `${entry.decl.extension ? "extension " : ""}${entry.decl.kind}` : entry.language === "java" ? "Java type" : `Scala ${entry.decl.kind}`);

    function kotlinCallable(entry, view, callerPath, label) {
      const decl = entry.decl;
      if (entry.language !== "kotlin" || decl.kind !== "function") return fail(`${label} in ${entry.path} is a ${describe(entry)}, not a function; a property with invoke, a constructor or a Java type is not bound`);
      if (decl.extension) return fail(`${label} in ${entry.path} is an extension function, which needs a receiver`);
      if (decl.platform) return fail(`${label} in ${entry.path} is an expect/actual declaration; platform selection is not evaluated`);
      if (decl.hidden) return fail(`${label} in ${entry.path} is @Deprecated(level = HIDDEN), which removes it from resolution`);
      if (decl.visibility === "protected") return fail(`${label} in ${entry.path} is protected`);
      if (decl.visibility === "private" && entry.path !== callerPath) return fail(`${label} in ${entry.path} is private and not accessible from the call`);
      if (decl.visibility === "internal" && jvmRoots()?.ownerOf(entry.path)?.module !== view.module) return fail(`${label} in ${entry.path} is internal to another module`);
      if (!direct(view, entry.path)) return fail(`${label} in ${entry.path} is reached only through a dependency of a dependency, whose api or implementation scope is not read`);
      return null;
    }
    /* KOTLIN_DEFAULT is Kotlin/JVM's default-import catalogue. Kotlin/JS, Native and
       common source sets import more by default (kotlin.js.*, kotlin.native.*), so a
       module binds only when its own build states a JVM or Android Kotlin plugin and no
       build covering it states another Kotlin platform. A plugin applied by a convention
       plugin, an allprojects/subprojects block or an unread catalogue alias is unknown. */
    const KOTLIN_JVM = /\bkotlin\s*\(\s*["'](?:jvm|android)["']\s*\)|\borg\.jetbrains\.kotlin\.(?:jvm|android)\b|["']kotlin(?:-android)?["']/;
    const KOTLIN_OTHER = /\bkotlin\s*\(\s*["'](?:js|multiplatform|native[\w.]*)["']\s*\)|\borg\.jetbrains\.kotlin\.(?:js|multiplatform|native)\b|["']kotlin(?:2js|-multiplatform|-platform-(?:js|common|native)|-native[\w-]*)["']|\bkonan\b|<goal>\s*js\s*<\/goal>/;
    const kotlinPlatforms = new Map();
    function kotlinPlatform(view) {
      if (kotlinPlatforms.has(view.module)) return kotlinPlatforms.get(view.module);
      const answer = (() => {
        const dir = view.module, at = name => (dir ? dir + "/" + name : name);
        const module = jvmRoots()?.modules.get(dir);
        for (const [path, value] of fileMap) {
          if (!/(?:^|\/)(?:build\.gradle(?:\.kts)?|pom\.xml)$/.test(path) || typeof value.text !== "string") continue;
          const owner = dirOf(path);
          if ((owner === "" || dir === owner || dir.startsWith(owner + "/")) && KOTLIN_OTHER.test(value.text)) return fail(`${path} applies a non-JVM Kotlin platform (JS, Native or multiplatform), whose default imports are not catalogued`);
        }
        if (module?.kinds.includes("maven") && fileMap.has(at("pom.xml"))) return null;
        const script = [at("build.gradle.kts"), at("build.gradle")].map(path => fileMap.get(path)).find(value => typeof value?.text === "string");
        if (!script) return fail(`Module ${dir || "."} has no readable Gradle or Maven build file of its own, so its Kotlin platform is not stated`);
        const text = script.text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
        const aliases = [...text.matchAll(/\balias\s*\(\s*([\w.]+)\s*\)/g)].map(match => match[1]);
        if (aliases.length) return fail(`The build of module ${dir || "."} applies plugins through version-catalogue aliases (${aliases.slice(0, 3).join(", ")}), which are not read, so its Kotlin platform is not known`);
        if (!KOTLIN_JVM.test(text)) return fail(`The build of module ${dir || "."} does not itself apply the Kotlin JVM or Android plugin, so its Kotlin platform and default imports are not known`);
        return null;
      })();
      kotlinPlatforms.set(view.module, answer);
      return answer;
    }
    function kotlinBind(path, call) {
      if (path.endsWith(".kts")) return fail("A Kotlin script runs with an implicit receiver supplied by its host (a Gradle Project or a script definition), whose members are candidates for every call");
      const J = jvmcIndex(), file = J.files.get(path);
      if (!file) return null;
      if (!jvmDropped().complete) return fail(JVM_DROPS_INCOMPLETE);
      if (file.partial) return fail(`${path} did not parse completely as Kotlin (or declares context parameters), so its scopes are not all known`);
      const callee = call.callee;
      if (!callee) return fail("The callee is not a plain name or a member selected from a plain name (a qualified path, this, super, a safe call or an expression); it is not bound");
      if (callee.blocked) return fail(callee.blocked);
      const view = jvmcView(path);
      if (!view) return fail(`No Maven, Gradle or sbt source root covers ${path}, so the declarations on its compile path are not known`);
      const platform = kotlinPlatform(view);
      if (platform) return platform;
      const facts = file.facts, pkg = facts.package, steps = [];
      const local = item => item.alias || item.path.at(-1);
      const stars = [];
      for (const item of facts.imports) if (item.star) {
        const target = item.path.join(".");
        if (!pkgMembers(view, target, "").exists) return fail(`\`import ${target}.*\` names no package on the compile path; what it supplies is not known, and a lower-priority callable is chosen whenever a higher one does not accept the arguments`);
        stars.push({ item, target });
      }
      /** The levels below the one that answered must declare nothing that could take over. */
      const lower = (packages, name, matches, why) => {
        for (const scope of packages) {
          const found = pkgMembers(view, scope, name);
          if (found.taint) return fail(found.taint);
          const hit = found.found.find(matches);
          if (hit) return fail(`${hit.path}:${hit.decl.line} declares ${hit.name} as a ${describe(hit)} in ${pkgLabel(scope)}, ${why}`);
        }
        return null;
      };
      if (callee.form === "name") {
        const name = callee.name;
        if (callee.shadowed) return fail(`${name} is declared inside the enclosing declaration (a local, parameter or member), which is a higher-priority candidate`);
        if (/^[A-Z]/.test(name)) return fail(`${name} is capitalised and may be a constructor or SAM constructor of a class Kotlin imports by default (kotlin.*, java.lang.*), which this reader does not catalogue`);
        if (KOTLIN_DEFAULT.has(name)) return fail(`The Kotlin default imports declare ${name}; a declaration of that name in the snapshot is chosen only if it accepts the arguments, and argument types are not checked`);
        const explicit = facts.imports.filter(item => !item.star && local(item) === name);
        if (explicit.length > 1) return fail(`${explicit.length} imports name ${name}; all of them are candidates`);
        let found, rule;
        const skip = new Set();
        if (explicit.length === 1) {
          const item = explicit[0], scope = item.path.slice(0, -1).join("."), declared = item.path.at(-1);
          const members = pkgMembers(view, scope, declared);
          if (!members.exists) return fail(`\`import ${item.path.join(".")}\` names no package on the compile path; it imports an object member or a declaration from outside the snapshot`);
          if (members.taint) return fail(members.taint);
          if (members.found.length !== 1) return fail(`${pkgLabel(scope)} declares ${declared} ${members.found.length} times on the compile path; overloads, properties and classes of one name are all candidates and argument types are not checked`);
          found = members.found[0]; rule = "kotlin-import-function"; skip.add(scope);
          steps.push({ step: `import ${item.path.join(".")}${item.alias ? " as " + item.alias : ""} names ${pkgLabel(scope)}, which declares ${declared} once`, path, line: item.line });
          if (scope !== pkg) { const fallback = lower([pkg], name, () => true, "a lower-priority candidate the call reaches when the import does not accept the arguments"); if (fallback) return fallback; }
        } else {
          const members = pkgMembers(view, pkg, name);
          if (members.taint) return fail(members.taint);
          if (members.found.length !== 1) return fail(members.found.length ? `${pkgLabel(pkg)} declares ${name} ${members.found.length} times on the compile path; overloads, properties and classes of one name are all candidates and argument types are not checked` : `${pkgLabel(pkg)} declares no ${name} on the compile path; it may come from a star import, the standard library or a dependency`);
          found = members.found[0]; rule = "kotlin-package-function"; skip.add(pkg);
        }
        const target = kotlinCallable(found, view, path, name);
        if (target) return target;
        const fallthrough = lower(stars.map(star => star.target).filter(scope => !skip.has(scope)), name, () => true, "which a star import supplies at a lower priority");
        if (fallthrough) return fallthrough;
        if (rule === "kotlin-package-function") steps.push({ step: `nothing in the enclosing declaration or an import names ${name}; ${pkgLabel(pkg)} declares it once on the compile path`, path: found.path, line: found.decl.line });
        else steps.push({ step: `fun ${found.name} is declared once in ${found.path}, and ${pkgLabel(pkg)} declares no ${name}`, path: found.path, line: found.decl.line });
        steps.push({ step: `no star import supplies ${name}, and the Kotlin default imports declare no ${name}`, path, line: call.line });
        return bound(rule, found.path, found.decl.startIndex, steps);
      }
      const { receiver, name } = callee;
      if (callee.shadowed) return fail(`${receiver} is declared inside the enclosing declaration, or an extension named ${name} is, so ${receiver}.${name} may not name the top-level declaration`);
      if (KOTLIN_DEFAULT.has(name)) return fail(`The Kotlin default imports declare an extension ${name} for any receiver; when the member does not accept the arguments the call resolves there`);
      if (packageRoot(view, receiver)) return fail(`${receiver} is also the first segment of a package on the compile path, so ${receiver}.${name} may be a fully qualified call`);
      if (facts.imports.some(item => !item.star && local(item) === name)) return fail(`An import names ${name}; an imported extension of that name is a candidate when the member does not accept the arguments`);
      const entries = [], seen = new Set();
      const add = list => { for (const entry of list) { const key = entry.path + ":" + (entry.decl.startIndex ?? entry.decl.line); if (!seen.has(key)) { seen.add(key); entries.push(entry); } } };
      for (const item of facts.imports) {
        if (item.star || local(item) !== receiver) continue;
        const scope = item.path.slice(0, -1).join("."), members = pkgMembers(view, scope, item.path.at(-1));
        if (!members.exists) return fail(`\`import ${item.path.join(".")}\` names no package on the compile path; ${receiver} may be declared outside the snapshot`);
        if (members.taint) return fail(members.taint);
        add(members.found);
        steps.push({ step: `import ${item.path.join(".")}${item.alias ? " as " + item.alias : ""} names ${pkgLabel(scope)}`, path, line: item.line });
      }
      const same = pkgMembers(view, pkg, receiver);
      if (same.taint) return fail(same.taint);
      add(same.found);
      if (entries.length !== 1) return fail(entries.length ? `${receiver} has ${entries.length} declarations among the explicit imports and ${pkgLabel(pkg)}` : `${receiver} is neither declared in ${pkgLabel(pkg)} on the compile path nor explicitly imported; it may be a star-imported, default-imported or external declaration`);
      const entry = entries[0], decl = entry.decl;
      if (entry.language !== "kotlin") return fail(`${receiver} resolves to a ${describe(entry)} in ${entry.path}; only Kotlin objects and companions are bound`);
      let owner, rule;
      if (decl.kind === "object") { owner = decl; rule = "kotlin-object-method"; }
      else if (decl.kind === "class") {
        if (!decl.companion) return fail(`class ${receiver} in ${entry.path} declares no companion object, so ${receiver}.${name} is not a companion member`);
        if (decl.flavor === "enum") return fail(`enum class ${receiver} has generated static members (values, valueOf, entries) besides its companion`);
        if (!decl.known) return fail(`The body of ${receiver} did not parse into declarations only`);
        const nested = decl.members.filter(member => member.name === name && member.kind !== "function" && member.kind !== "property");
        if (nested.length) return fail(`${receiver} declares a nested ${nested[0].kind} named ${name}, which ${receiver}.${name}() would construct`);
        owner = decl.companion; rule = "kotlin-companion-method";
      } else return fail(`${receiver} resolves to a ${describe(entry)} in ${entry.path}, not an object or a class with a companion`);
      const where = rule === "kotlin-object-method" ? `object ${receiver}` : `the companion object of ${receiver}`;
      if (decl.platform) return fail(`${receiver} is an expect/actual declaration; platform selection is not evaluated`);
      if (decl.visibility === "private" && entry.path !== path || decl.visibility === "internal" && jvmRoots()?.ownerOf(entry.path)?.module !== view.module) return fail(`${receiver} in ${entry.path} is not visible from ${path}`);
      if (owner.supertypes) return fail(`${where} declares supertypes; their inherited members named ${name} are candidates that are not read`);
      if (!owner.known) return fail(`The body of ${where} did not parse into declarations only, so its members are not all known`);
      const members = owner.members.filter(member => member.name === name);
      if (members.length !== 1) return fail(members.length ? `${where} declares ${members.length} members named ${name}; overloads are all candidates and argument types are not checked` : `${where} declares no member ${name}; it may be inherited or an extension`);
      const target = kotlinCallable({ decl: members[0], language: "kotlin", path: entry.path }, view, members[0].visibility === "private" ? null : path, `${receiver}.${name}`);
      if (target) return target;
      const extensions = lower([...new Set([pkg, ...stars.map(star => star.target)])], name, hit => hit.language === "kotlin" && hit.decl.extension, "an extension the call reaches when the member does not accept the arguments");
      if (extensions) return extensions;
      steps.push({ step: `${receiver} is the ${decl.kind} declared once in ${entry.path} among the explicit imports and ${pkgLabel(pkg)}`, path: entry.path, line: decl.line });
      steps.push({ step: `${where} has no supertypes and declares ${name} once, as a function`, path: entry.path, line: members[0].line });
      steps.push({ step: `no extension named ${name} is declared in ${pkgLabel(pkg)}, imported or star-imported, and the Kotlin default imports declare none`, path, line: call.line });
      return bound(rule, entry.path, members[0].startIndex, steps);
    }

    function scalaBind() {
      return fail("Scala calls are never bound: import scoping is not modelled (block-local imports and their position, selectors that hide or rename a name, wildcard imports that outrank package members, inherited and Java static members of imported objects), nor are implicit views; and the bundled tree-sitter-scala 0.19.0 grammar fails on most real Scala (19 of the 29 files of scopt/scopt)");
    }
    return function bind(path, call) {
      const binding = bindingOf(path);
      if (!binding) return null;
      if (binding.truncated) return fail("Call-binding extraction reached its safety ceiling for this file");
      if (binding.language === "go") return goBind(path, call);
      if (binding.language === "rust") return rustBind(path, call);
      if (binding.language === "java") return javaBind(path, call);
      if (binding.language === "c") return cBind(path, call);
      if (binding.language === "swift") return swiftBind(path, call);
      if (binding.language === "c_sharp") return csharpBind(path, call);
      if (binding.language === "kotlin") return kotlinBind(path, call);
      if (binding.language === "scala") return scalaBind(path, call);
      return null;
    };
  }

  root.SkylenseSemanticCalls = Object.freeze({ create, ENGINE });
})(typeof window !== "undefined" ? window : globalThis);
