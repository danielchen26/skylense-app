/* Language adapter registry.
 *
 * A grammar is not a semantic engine. Twenty-four grammars are twenty-four
 * parsers, not twenty-four compiler-grade resolvers, so every adapter states
 * each capability separately and names what it does not do.
 *
 * `items` is the itemized truth, one status per capability:
 *   supported       produced at the strongest state this capability has: a
 *                   relation reaches resolved-static, a contract carries an
 *                   explicit source-backed part.
 *   candidate-only  produced, and deliberately never raised above candidate.
 *   unannotated     produced, but this language or source carries no annotation
 *                   to read, so the part is reported unannotated, never guessed.
 *   reported        not resolvable in principle; every occurrence is reported
 *                   individually with a reason instead of dropped or invented.
 *   unsupported     not produced. Requires an entry in `unsupported`.
 *   not-applicable  the language has no such construct. Requires an entry too.
 *
 * `syntax`, `semantic`, `status`, `needsProject` and `limits` are the earlier
 * coarse fields, kept for existing consumers. Where the two disagree, `items`
 * describes what the code does; the coarse list is a compatibility surface. */
(function (root) {
  "use strict";

  const SYNTAX = "syntax";
  const SEMANTIC = "semantic";

  /** The nine capabilities every adapter answers for, in reading order. */
  const CAPABILITY_ITEMS = Object.freeze([
    "inventory", "grammar-ast", "declarations", "source-contract",
    "local-modules", "project-binding", "type-call-resolution",
    "config-relations", "runtime-unknown",
  ]);
  const STATES = Object.freeze(["supported", "candidate-only", "unannotated", "reported", "unsupported", "not-applicable"]);
  /** Every status that obliges the adapter to name the missing feature. */
  const MUST_EXPLAIN = Object.freeze(["unsupported", "not-applicable"]);
  /** Semantic states a relation may carry. Compatible with the v1 names. */
  const RESOLUTION_STATES = Object.freeze(["resolved-static", "conditional-candidate", "candidate", "unresolved", "external-unfetched", "unsupported", "error"]);

  const NO_CONTRACT = "This format has no callable signature to contract.";
  const NO_DECLARATIONS = "Members are data. No named code declaration is extracted, and inventing one would be a fabricated symbol.";
  const NO_CALLS = "This format has no call sites.";
  const NO_CONFIG = "This language does not declare project entry points; a manifest that does is its own adapter row.";
  const NO_RUNTIME = "This format has no runtime module resolution to abstain from.";
  const NO_MODULES = "This format references no modules.";
  /* Source-root binding is one rule for the three JVM languages, so what it does
     not read is stated once and cannot drift between the rows. */
  const JVM_NOT_READ = "Nothing is executed: no Gradle or sbt evaluation, no Maven plugin or lifecycle run, and no property or parent-POM interpolation off the snapshot — a <sourceDirectory> whose value is an unknown ${property} states no directory, and the default does not silently take its place. No dependency resolution off the snapshot: no repository, lockfile, version catalogue or artifact contents, so a type from a downloaded jar stays an external reference. Dependency visibility is direct only; a module reached transitively through another module's api scope is an abstention, not a bind. Not read either: generated sources and annotation processing (build/generated, target/generated-sources, Lombok, Dagger, KSP, protobuf), module-info.java requires/exports, Maven <profiles> build sections, Android Gradle source-set conventions, Bazel/Buck/Ant, and classpath ordering. The binding is file-level: symbol identity inside a file is not resolved.";
  /** What a JVM import is worth when no build manifest is in scope. */
  const JVM_NO_MANIFEST = "A type import reaches resolved-static only under a source root a build manifest declares (pom.xml, Gradle or sbt). Without one, a file whose path ends in the imported name is a candidate under the rule <language>-import-included-path, because neither the source root nor the package clause is established, and several such files are reported unresolved as ambiguous.";
  /** What a C/C++ include is worth when no compile command or CMake scope covers the file. */
  const NATIVE_NO_MANIFEST = "Without compile_commands.json or CMake scope for the file, only the preprocessor's first step is proven: a quoted include found in the including file's own directory (c-include-quoted-current-directory). A header reached at the snapshot root or by its basename elsewhere is a candidate (c-include-included-path), several such headers are reported unresolved as ambiguous, and an angle include never binds.";

  const adapters = [
    { id: "typescript", languages: ["typescript", "tsx", "javascript", "jsx"], grammar: "tree-sitter-typescript", wave: "A", version: "typescript/2",
      syntax: ["declarations", "imports", "heritage", "signatures", "sourceContract"],
      semantic: ["project-symbols", "call-binding", "import-resolution"],
      needsProject: ["tsconfig"], localTools: false,
      engines: ["syntax-facts", "source-resolver", "semantic-typescript"],
      items: {
        inventory: "supported", "grammar-ast": "supported", declarations: "supported", "source-contract": "supported",
        "local-modules": "candidate-only", "project-binding": "supported", "type-call-resolution": "supported",
        "config-relations": "not-applicable", "runtime-unknown": "reported",
      },
      languageItems: { javascript: { "source-contract": "unannotated" }, jsx: { "source-contract": "unannotated" } },
      unsupported: {
        "local-modules": "No TypeScript or JavaScript import reaches resolved-static: which configuration and resolver govern a file is open-world. A tsconfig anywhere whose include reaches the file — in a dropped build/ or gitignored directory, or behind a project reference that is never read — can set moduleSuffixes, and a vite or webpack alias, a Deno import map or URL decoding can remap even a relative specifier, with nothing in the snapshot that proves their absence (ReviewTs fixtures A, D, U, R4–R7). So a relative specifier that spells a TypeScript-only extension offers that file as a candidate (js-relative-exact-source-extension, reason js-relative-exact-source-extension-unproven), a # subpath import offers the file its package.json \"imports\" entry names (js-package-imports, reason js-package-imports-unproven or a more specific one), and every other resolved import — extensionless, .js-to-.ts substitution, paths aliases, workspace packages — is a candidate too, because the same specifier form is answered by the bundled compiler in one profile and by an extension/path search in another.",
        "config-relations": NO_CONFIG,
      },
      projectContext: {
        manifests: ["tsconfig.json", "jsconfig.json", "package.json"],
        compilerOptions: "module, moduleResolution, baseUrl, paths and extends (including an array of bases) are read from the included configuration; package.json \"imports\" maps give candidates only",
        dependencyAvailability: "snapshot only; node_modules, published types and registry contents are never fetched",
        conditionalEnvironment: "not evaluated; conditional exports pick the declared string values without running a resolver condition",
      },
      limits: "Computed property names, dynamic import expressions and runtime mixins stay unresolved." },
    { id: "python", languages: ["python"], grammar: "tree-sitter-python", wave: "A", version: "python/3",
      syntax: ["declarations", "imports", "signatures", "sourceContract"],
      semantic: ["lexical-binding", "relative-imports", "declared-package-roots"],
      needsProject: ["pyproject.toml", "setup.cfg"], localTools: false,
      engines: ["syntax-facts", "python-structure", "source-resolver", "project-python"],
      items: {
        inventory: "supported", "grammar-ast": "supported", declarations: "supported", "source-contract": "supported",
        "local-modules": "supported", "project-binding": "supported", "type-call-resolution": "candidate-only",
        "config-relations": "not-applicable", "runtime-unknown": "unsupported",
      },
      unsupported: {
        "local-modules": "A module reaches resolved-static only through a package root the project itself declares. Without such a declaration the snapshot-root and src/ search still runs and stays a candidate, because which directory is on sys.path is then not stated anywhere in the snapshot.",
        "project-binding": "setup.py is never executed and never scraped, so a project whose only manifest is setup.py declares no root. No site-packages directory, installed distribution, wheel, .pth file or virtual environment is consulted, and no environment marker, extra or dynamic metadata is evaluated. setuptools' implicit auto-discovery is deliberately not reproduced: a manifest that declares no package root yields no binding rather than a guessed src/ or flat layout.",
        "type-call-resolution": "Deliberately never raised above candidate: two adversarial rounds found false bindings; module rebinding is not statically enumerable. A Python call is a lexical candidate (python-structure): which object a module-level name denotes when the call runs depends on everything that can rebind it — aliases of modules, sys.modules entries (mock.patch.dict included), getattr and importlib.import_module results, a package's __path__, names injected into builtins, decorators, walruses in defaults and annotations, private-name mangling, source encodings and comments a lone CR ends — and that surface could not be enumerated soundly from the snapshot. Imports keep their own resolved-static binding through declared package roots (project-binding).",
        "config-relations": NO_CONFIG,
        "runtime-unknown": "importlib.import_module, __import__ and getattr module access produce no reference at all, so they are covered only by the global capability limitation rather than by an individual entry.",
      },
      projectContext: {
        manifests: ["pyproject.toml", "setup.cfg"],
        compilerOptions: "package roots come from [tool.setuptools] package-dir/packages, [tool.setuptools.packages.find] where/include/exclude/namespaces, [tool.poetry] packages, [tool.hatch.build.targets.wheel] packages and setup.cfg [options] package_dir/packages; relative imports follow the package rules of the declared layout",
        dependencyAvailability: "snapshot only; site-packages is never read",
        conditionalEnvironment: "not evaluated; conditional and try/except imports bind no unique name",
      },
      limits: "Decorators, dynamic getattr and runtime rebinding are not unique bindings." },
    { id: "julia", languages: ["julia"], grammar: "tree-sitter-julia", wave: "A", version: "julia/3",
      syntax: ["declarations", "modules", "signatures", "sourceContract"],
      semantic: ["module-include", "method-candidates", "declared-environment"],
      needsProject: ["Project.toml", "JuliaProject.toml"], localTools: false,
      engines: ["syntax-facts", "julia-structure", "semantic-julia", "project-julia"],
      items: {
        inventory: "supported", "grammar-ast": "supported", declarations: "supported", "source-contract": "unannotated",
        "local-modules": "supported", "project-binding": "supported", "type-call-resolution": "candidate-only",
        "config-relations": "not-applicable", "runtime-unknown": "unsupported",
      },
      unsupported: {
        "local-modules": "A relative `using .Inner` is proven by the include graph that gives the module its qualified name. A bare `using Foo` is an environment question, not a file-tree question: it reaches resolved-static only through a declared project, and a same-named top-level module found only by the include graph stays a candidate.",
        "project-binding": "No package depot or registry is read, and no Manifest.toml, so no version is resolved: a [compat] bound is recorded as declared evidence only. [targets] gating of [extras] is not applied, LOAD_PATH and JULIA_LOAD_PATH are not consulted, macros are not expanded, and no manifest or package code is executed.",
        "config-relations": NO_CONFIG,
        "runtime-unknown": "A computed include path or eval produces no reference, so it is covered by the global limitation rather than by an individual entry.",
      },
      projectContext: {
        manifests: ["Project.toml", "JuliaProject.toml"],
        compilerOptions: "name, uuid, [deps], [weakdeps], [extras] and [compat] are read as data; a test/ or docs/ sub-environment stacks on the package that owns it",
        dependencyAvailability: "snapshot only; the package depot is never read, and a declared dependency with no providing manifest is recorded as an unfetched external package",
        conditionalEnvironment: "conditional includes and conditional using are recorded as conditional candidates and never bound",
      },
      limits: "Multiple dispatch candidates stay candidate-targets; macros are not expanded." },
    { id: "go", languages: ["go"], grammar: "tree-sitter-go", wave: "B", version: "go/3",
      syntax: ["declarations", "imports", "signatures", "sourceContract"], semantic: ["project-local-imports", "call-binding"], needsProject: ["go.mod"], localTools: false,
      engines: ["syntax-facts", "semantic-project", "source-resolver", "semantic-calls"],
      items: {
        inventory: "supported", "grammar-ast": "supported", declarations: "supported", "source-contract": "supported",
        "local-modules": "supported", "project-binding": "supported", "type-call-resolution": "supported",
        "config-relations": "not-applicable", "runtime-unknown": "unsupported",
      },
      unsupported: {
        "local-modules": "Go has no relative imports, so an import reaches resolved-static only through the module path the importing file's own go.mod declares, and only for a package with one non-test file (go-module-path-own-module). A Go import names a package, so a package with several files is a candidate set over them (go-module-path-package-files). When two included go.mod files declare the same path, the importing file's own go.mod answers. A directory that merely ends in the import path, with no go.mod covering it, is a candidate (go-import-included-path).",
        "project-binding": "require, replace, exclude and go.work are not evaluated, so a package of another module included in the snapshot is a candidate (go-module-path-other-module), not a binding; no module is downloaded.",
        "type-call-resolution": "A call reaches resolved-static only through three rules of src/semantic-calls.js: go-package-function (`f()` with no local binding of f, and f declared exactly once in the caller's package block — test files join only for test callers), go-imported-package-function (`p.F()` where p is an import inside the importing file's own go.mod module) and go-declared-receiver-method (`x.M()` where x's type is written in the source — a declared variable, parameter or receiver type, a composite literal, a declared field of a non-generic struct or the declared result of a bound non-generic call — names a non-interface, non-alias, non-generic type declared once, and that type declares M directly). Everything else stays a candidate or unresolved with a reason: interface method calls (dynamic dispatch), methods and fields promoted through embedding, methods of generic types, results of generic functions (a result written as a type parameter is never read as a package type) and calls on type parameters, function values and closures, package-level variables, untyped locals (range, type switch, multi-assignment from non-calls), dot imports, other modules and the standard library. Build constraints are not evaluated: a name declared in several build-constrained files is ambiguous, and a declaration in a file with a //go:build or // +build line or a _GOOS/_GOARCH name binds only calls written in that same file. A package with any file that has syntax errors binds nothing, because every rule concludes from what the package does not declare.",
        "config-relations": NO_CONFIG,
        "runtime-unknown": "plugin.Open and reflection-based dispatch produce no reference; only the global limitation covers them.",
      },
      projectContext: {
        manifests: ["go.mod"],
        compilerOptions: "the module path declared by go.mod maps import paths to included package directories",
        dependencyAvailability: "snapshot only; no module download, vendor directory or proxy access",
        conditionalEnvironment: "build tags and GOOS/GOARCH constraints are not evaluated",
      },
      limits: "A one-file package of the importing file's own go.mod module binds; a multi-file package is a candidate set over its files; other modules and GOPATH-shaped directories are candidates, and build tags, replace directives, go.work and module download are not evaluated. Calls bind to package functions, imported-package functions and directly declared methods of statically written types; interface, embedded and generic dispatch stay candidate." },
    { id: "rust", languages: ["rust"], grammar: "tree-sitter-rust", wave: "B", version: "rust/4",
      syntax: ["declarations", "imports", "signatures", "sourceContract"], semantic: ["project-local-imports", "call-binding"], needsProject: ["Cargo.toml"], localTools: false,
      engines: ["syntax-facts", "semantic-project", "semantic-calls"],
      items: {
        inventory: "supported", "grammar-ast": "supported", declarations: "supported", "source-contract": "supported",
        "local-modules": "supported", "project-binding": "supported", "type-call-resolution": "supported",
        "config-relations": "not-applicable", "runtime-unknown": "unsupported",
      },
      unsupported: {
        "config-relations": NO_CONFIG,
        "type-call-resolution": "A call reaches resolved-static only for free-function paths (rules rust-module-function, rust-module-path-function, rust-use-function, rust-glob-use-function in src/semantic-calls.js): the calling file must be reachable from a Cargo crate root (src/lib.rs, src/main.rs, src/bin, examples, tests, benches, build.rs or a declared [lib]/[[bin]] path) through mod declarations proven by rust-mod-file or #[path], and must not also be a crate root of its own; no local binding, block-level item, block glob or statement-position macro (other than standard expression macros such as println! that no snapshot macro_rules!, use or #[macro_use] redefines) may shadow the first segment; every segment must be a proven module (inline or file, not cfg-gated unless it encloses the caller, not an inline module declared twice as cfg alternatives) or an explicit `use` binding, followed with edition-correct anchoring (crate-relative use paths in 2015, module-relative from 2018; edition.workspace is read); and the last module must hold exactly one value of that name, a fn item without cfg, test or attribute-macro attributes. A single unconditional glob import is followed only where no explicit item has the name, the module has no module-level macro invocation, and the item is visible to the importer. Files with syntax errors, calls inside block-level `mod` items, method calls, associated functions (`Type::f`, `Self::f`), trait dispatch, closures and function values, extern crates, macros and macro-generated items, several globs and cfg alternatives stay candidate or unresolved with a reason.",
        "runtime-unknown": "Macro-generated and build-script-generated modules produce no reference until the generated source is supplied.",
      },
      projectContext: {
        manifests: ["Cargo.toml"],
        compilerOptions: "Cargo.toml locates the crate root, so module files follow the declaring file rather than directory adjacency",
        dependencyAvailability: "snapshot only; no crate registry access, so every external crate path stays external",
        conditionalEnvironment: "#[cfg] predicates are not evaluated: a cfg-gated mod resolves its module file and reports a conditional candidate",
      },
      limits: "crate/self/super module files inside the snapshot may bind; free-function calls bind through the proven module tree, while methods, associated functions, trait solving and proc macros stay candidate or unsupported." },
    { id: "java", languages: ["java"], grammar: "tree-sitter-java", wave: "B", version: "java/4",
      syntax: ["declarations", "imports", "signatures", "sourceContract"], semantic: ["project-local-imports", "declared-source-roots", "call-binding"], needsProject: ["pom.xml", "build.gradle", "settings.gradle"], localTools: false,
      engines: ["syntax-facts", "semantic-project", "source-resolver", "project-jvm", "semantic-calls"],
      items: {
        inventory: "supported", "grammar-ast": "supported", declarations: "supported", "source-contract": "supported",
        "local-modules": "supported", "project-binding": "supported", "type-call-resolution": "supported",
        "config-relations": "not-applicable", "runtime-unknown": "unsupported",
      },
      unsupported: {
        "local-modules": JVM_NO_MANIFEST,
        "project-binding": JVM_NOT_READ,
        "config-relations": NO_CONFIG,
        "type-call-resolution": "A call reaches resolved-static only through four rules of src/semantic-calls.js, and only in a file a Maven, Gradle or sbt source root claims: java-imported-type-static-method and java-package-type-static-method (`T.m(…)` where T is no variable, parameter or field of the file, no field inherited by an enclosing class and no static-import member, and names — through a single-type import, this compilation unit or the caller's own package, never an on-demand import or java.lang — exactly one top-level declaration on the caller's compile path), java-enclosing-class-method (`m(…)`, searching the innermost enclosing class whose declared or inherited members include an m, as JLS 15.12.1 does) and java-this-class-method (`this.m(…)`). In each, the searched type and every supertype must be proven declarations in fully parsed snapshot files, exactly one method of that name across the whole hierarchy may accept the call's argument count (varargs counted), it must not be an implicit java.lang.Object/Enum member or record accessor, and it must be static, private or final, or declared in a final class, record, anonymous class or enum without constant bodies — anything a subclass could override stays unbound. Everything else stays a candidate or unresolved with a reason: calls on a value receiver (instance dispatch), super and qualified-this calls, fully qualified and nested type qualifiers, static imports, overloads distinguished only by argument types (including a static method hidden by a subclass), any supertype outside the snapshot (a JDK or dependency class such as RuntimeException), any calling file with syntax errors or a lone CR or Unicode escape that javac reads differently from the syntax tree (JLS 3.3, 3.4), a type lookup whose package on the compile path holds a Java file that was not fully modelled or a Kotlin/Scala source (its package read in javac order, unknown counting as a match), Lombok or Manifold use, and any snapshot holding an AspectJ .aj source. A name declared as a variable anywhere in the file is treated as possibly obscuring the type of that name; generated sources and build profiles are not read.",
        "runtime-unknown": "Reflection, service loaders and annotation processors produce no reference.",
      },
      projectContext: {
        manifests: ["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"],
        compilerOptions: "source roots come from Maven <sourceDirectory>/<testSourceDirectory>/<modules> and the src/main/java + src/test/java defaults, and from Gradle sourceSets main|test java srcDir/srcDirs literals plus settings.gradle includes; a main source sees its module's main roots and the main roots of the modules it declares a dependency on, a test source additionally sees its own test roots",
        dependencyAvailability: "snapshot only; no classpath, jar, repository or lockfile is opened, so a type from a dependency stays an external reference",
        conditionalEnvironment: "not evaluated; a <profiles> build section or an unknown ${property} states no directory",
      },
      limits: "A type binds when exactly one visible declared root holds it and that file's own package clause agrees with its directory; a wildcard or package import is a candidate set over the package's files, and a type on both the main and test path of a test source stays unresolved because -Xprefer decides it. Calls bind to static methods of types named by single-type import or package, and to static, private or final methods (or methods of final classes) of the enclosing classes; instance dispatch, overloads of one arity and supertypes outside the snapshot stay candidate." },
    { id: "c", languages: ["c"], grammar: "tree-sitter-c", wave: "B", version: "c/4",
      syntax: ["declarations", "signatures", "sourceContract"], semantic: ["project-local-imports", "include-search-path", "call-binding"], needsProject: ["compile_commands.json", "CMakeLists.txt"], localTools: false,
      engines: ["syntax-facts", "semantic-project", "source-resolver", "project-native", "semantic-calls"],
      items: {
        inventory: "supported", "grammar-ast": "supported", declarations: "supported", "source-contract": "supported",
        "local-modules": "supported", "project-binding": "supported", "type-call-resolution": "supported",
        "config-relations": "not-applicable", "runtime-unknown": "unsupported",
      },
      unsupported: {
        "local-modules": NATIVE_NO_MANIFEST,
        "project-binding": "-D/-U macros are recorded in the proof and never evaluated. A generator expression or an unexpanded ${VAR} is recorded as an unresolved include directory rather than guessed, and an include directory outside the snapshot is recorded as unavailable. There is no preprocessing, no macro evaluation, no conditional-compilation branch selection and no system include root off the snapshot.",
        "config-relations": NO_CONFIG,
        "type-call-resolution": "A call reaches resolved-static only through c-static-function in src/semantic-calls.js: `f(…)` with a plain identifier callee, where f has internal linkage (its first file-scope declaration is `static`, and it precedes the call), the calling file defines f exactly once outside any #if/#ifdef, the calling function neither declares f (local, parameter, function pointer, typedef, nested block) nor uses it other than as a callee, and the whole macro environment of the translation unit is known and leaves f alone. That environment is known only when compile_commands.json records the file's command line — a C driver (a C++ driver compiles .c as C++) whose every flag is on an allowlist of flags that leave the preprocessed text alone (-c, -o, -O, -g, -W except -Wp, -f except language-changing ones, -m, -std=c…, -D/-U, -I/-iquote/-isystem/-idirafter; anything else, such as -include, --define-macro, --config, -specs or @file, abstains), with no -D/-U of f — and every #include of the unit, transitively, is found in the FIRST directory GCC and Clang search for it (the including file's own directory for the quoted form, then -iquote, every -I, every -isystem, whatever the command-line order). A header missing from the snapshot is not missing on the build machine — build/, vendor/, ignored and generated headers are not ingested — so a header found only in a later directory, a path leaving the snapshot root, or a header outside the snapshot (<stdio.h> included) makes every call of that unit a candidate. A .c file that any other snapshot file names in an #include, #include_next or #import (read from every file's text, so a lone CR or a comment cannot hide it), or any C-family file with a computed #include or text not read in full, also abstains, because the file is then compiled again under macros this proof does not read; so does every call while compile_commands.json compiles a file that is not in the snapshot (an excluded build/unity.c may #include any source). An -I that duplicates an -isystem or -idirafter directory is dropped, as GCC and Clang do. Directives are read lexically after line splicing, with comments and the %: digraph handled; a file with trigraphs, a carriage return not followed by a line feed (the compiler ends a line there), syntax errors or an unmodelled directive (#include_next, #import) abstains. No macro named f may exist in any C file of the snapshot, f may not start with an underscore (reserved), no unit macro may be named static or extern, the call may not be an argument of a unit macro, and the calling function may not use a unit macro that pastes tokens, leaves a bracket open or mentions f, since any of these can rename, hide or declare the callee. External linkage is never bound: a definition in the same file or a single header-declared definition in the snapshot is still chosen by the link — several programs or libraries may define the name, a weak definition yields to a strong one, and ELF interposition (LD_PRELOAD, -fPIC default visibility) can replace it at load time — so those calls stay candidates with that reason. Premise, as for Go and Rust: the unit compiles, and no file outside the snapshot #includes the calling .c file; a compiler-predefined macro outside the reserved namespace (GCC/Clang define unix, linux and similar as 1) could not name a function that compiles. A call of a name the calling file does not define names a function with external linkage, defined in another translation unit; which definition it reaches is decided by the link, which is not read, so every non-static definition of that name in the snapshot is a candidate (c-external-function-candidate) and none is resolved. No candidate is offered when the calling function declares or uses the name, a macro of that name exists in the snapshot, the name is reserved, or the calling file declares it static or as anything but a prototype.",
        "runtime-unknown": "Function pointers and dlopen targets produce no reference.",
      },
      projectContext: {
        manifests: ["compile_commands.json", "CMakeLists.txt"],
        compilerOptions: "the per-file include search path is read from compile_commands.json (-I, -iquote, -isystem, -idirafter, MSVC /I on a cl driver) and from CMake include_directories/target_include_directories with literal paths and ${CMAKE_CURRENT_SOURCE_DIR}; add_subdirectory extends the scope",
        dependencyAvailability: "snapshot only; an include directory outside the snapshot is recorded as unavailable and system headers stay external",
        conditionalEnvironment: "the preprocessor is not run, so #if branches are all retained as source and no configuration is selected",
      },
      limits: "A quoted include binds only what the preprocessor would open — the including file's own directory, then -iquote, then every -I, then every -isystem, then -idirafter (whatever the command-line order), then the CMake directories in scope; an angle include never searches the including file's directory, and a header found only after a directory the snapshot did not read completely is a candidate (c-include-after-unavailable-directory), since that directory may hold the copy the compiler opens: a directory outside the snapshot root, one absent from the snapshot, or one where the spelled header was excluded, ignored or left unread by source accounting. A fully read earlier directory is trusted not to hold the header; headers generated at build time into a source directory are not modelled. No basename search binds: with a manifest an exhausted search path is unresolved with the searched directories named, and without one a same-named header elsewhere is at most a candidate. A call binds only to a static function of its own file, and only when compile_commands.json records an allowlisted command line and every included header is found in the first directory searched for it; external-linkage calls, units that include system headers and .c files another file #includes stay candidate." },
    { id: "cpp", languages: ["cpp"], grammar: "tree-sitter-cpp", wave: "B", version: "cpp/3",
      syntax: ["declarations", "signatures", "sourceContract"], semantic: ["project-local-imports", "include-search-path"], needsProject: ["compile_commands.json", "CMakeLists.txt"], localTools: false,
      engines: ["syntax-facts", "semantic-project", "source-resolver", "project-native"],
      items: {
        inventory: "supported", "grammar-ast": "supported", declarations: "supported", "source-contract": "supported",
        "local-modules": "supported", "project-binding": "supported", "type-call-resolution": "candidate-only",
        "config-relations": "not-applicable", "runtime-unknown": "unsupported",
      },
      unsupported: {
        "local-modules": NATIVE_NO_MANIFEST,
        "project-binding": "-D/-U macros are recorded in the proof and never evaluated. A generator expression or an unexpanded ${VAR} is recorded as an unresolved include directory rather than guessed, and an include directory outside the snapshot is recorded as unavailable. There is no preprocessing, no macro evaluation, no conditional-compilation branch selection and no system include root off the snapshot; C++20 modules and header units are not resolved.",
        "config-relations": NO_CONFIG,
        "type-call-resolution": "Deliberately never raised above candidate. An unqualified call `f(x)` in C++ names an overload set, not a declaration: argument-dependent lookup adds functions from the namespaces of every argument's class, enum, pointer and template-argument types, so a header the snapshot does not hold can contribute the winner; overload resolution then ranks implicit conversions, default arguments and function templates (deduction and SFINAE decide which candidates exist); using-directives and inline namespaces widen what unqualified lookup sees; inside a member function, class-scope lookup — including dependent base classes, resolved only at instantiation — runs before namespace scope; inside a template the call is bound at instantiation (two-phase lookup); and `f` may itself be a type or an object with operator(). Each of these needs type checking that a syntax tree does not provide. The narrowest conceivable case — a zero-argument call (no ADL) in a non-member, non-template function at global scope, with f declared once in a unit whose headers are all in the snapshot and carry no using-directive — still inherits every macro hazard of C and leaves class-scope and template rules to a reader that does not evaluate them, so no c-static-function-like rule is applied to C++.",
        "runtime-unknown": "Template instantiation, virtual dispatch and dlopen targets produce no reference.",
      },
      projectContext: {
        manifests: ["compile_commands.json", "CMakeLists.txt"],
        compilerOptions: "the per-file include search path is read from compile_commands.json (-I, -iquote, -isystem, -idirafter, MSVC /I on a cl driver) and from CMake include_directories/target_include_directories with literal paths and ${CMAKE_CURRENT_SOURCE_DIR}; add_subdirectory extends the scope",
        dependencyAvailability: "snapshot only; an include directory outside the snapshot is recorded as unavailable and standard library headers stay external",
        conditionalEnvironment: "the preprocessor is not run, so #if branches are all retained as source and no configuration is selected",
      },
      limits: "A quoted include binds only what the preprocessor would open — own directory, -iquote, every -I, every -isystem, then -idirafter, whatever the command-line order — and an angle include never searches the including file's directory; a header found only after a directory the snapshot did not read completely (outside the root, absent, or with the spelled header excluded, ignored or unread) is a candidate, while a fully read earlier directory is trusted — headers generated at build time into a source directory are not modelled; no basename search binds, so without a manifest a same-named header elsewhere is at most a candidate. Templates, generated headers and C++20 modules stay incomplete." },
    { id: "csharp", languages: ["csharp"], grammar: "tree-sitter-c_sharp", wave: "B", version: "csharp/4",
      syntax: ["declarations", "signatures", "sourceContract"], semantic: ["project-local-imports", "call-binding"], needsProject: [], localTools: false,
      engines: ["syntax-facts", "semantic-project", "semantic-calls"],
      items: {
        inventory: "supported", "grammar-ast": "supported", declarations: "supported", "source-contract": "supported",
        "local-modules": "supported", "project-binding": "supported", "type-call-resolution": "supported",
        "config-relations": "not-applicable", "runtime-unknown": "unsupported",
      },
      unsupported: {
        "type-call-resolution": "A call reaches resolved-static only as `Type.M(args)` under rule csharp-static-method (src/semantic-calls.js), in a file a .csproj with Sdk=\"Microsoft.NET.Sdk\" covers with that SDK's default compile glob, and only when the snapshot proves which files MSBuild compiles. The csproj, every Directory.Build.props/.targets and Directory.Packages.props on the way to the snapshot root and the csproj.user must be read as text and state no Compile items, EnableDefault(Compile)Items, DefaultItemExcludes, output, intermediate, publish or artifacts path, Import, Sdk element, CustomBefore/After or DirectoryBuild*Path property, and no CoreCompile override; a Directory.Build.rsp must set no property and include no response file. Such a file left out of the snapshot (ignored, unreadable) or spelt in another letter case refuses the project, as do other SDKs (Web, Razor, NoTargets) and projects without one. Folders above the snapshot root are never read, so a name not found in the snapshot binds only at a repository root (a GitHub tree, or a folder with a .git directory or, in a worktree or submodule checkout, a .git file at its root), on the stated premise that MSBuild imports nothing from above the repository root; any other root, such as a project folder selected below its repository, is refused. The project's .cs files must all be in the snapshot with facts and parse (the **/*.cs glob is matched case-sensitively, so a .CS file refuses). Files under hidden folders and the project's bin/ are not compiled, so they are neither callers nor targets; obj/ files the build generates are ignored only when they declare no type or namespace, and any other obj/ file, a .cs file without facts (unreadable, size-limited), a left-out path or unfollowed symlink under the project (built-in exclusions such as build/ or vendor/, ignore rules) or discovery that stopped early refuses the project. Properties set on the command line or in the environment and package build props/targets are not visible and are assumed not to change Compile items. Type must bind to nothing in the member that holds the call (no local, parameter, lambda, pattern, range or out variable), to no type parameter, primary-constructor parameter or member of an enclosing type or of its base classes — every first base must be a snapshot type, so an external base such as ControllerBase abstains — and must be declared in the caller's own namespace in the caller's project; outer namespaces, using directives, aliases and referenced assemblies are never searched, because a type outside the snapshot could be found first. Type and its base classes must have exactly one member named M: a static, non-generic, non-partial method outside #if, accessible from the call, that is not an Object or record-synthesized member. Every argument must be positional and either a literal (int-range integer, real, string, bool, char) or a parameter of the member declared with a predefined type, and each must convert implicitly to its parameter (identity, the implicit numeric and nullable conversions, object; params arrays and optional parameters counted) — so M is the single applicable candidate and extension members, classic or C# 14 static ones, are never consulted. A partial type involved is bound only when the project has the plain Microsoft.NET.Sdk, no PackageReference, Analyzer or UI framework in the csproj or Directory.Build files, no XAML/Razor markup and no attribute on any part, since source generators add partial members outside the snapshot. Everything else stays a candidate or unresolved with the reason: unqualified calls (enclosing members, local functions, `using static`), instance and extension-syntax calls, overloads, named or ref/out arguments, arguments whose type is not proven, generic methods and qualified receivers. Interceptors rewrite a call after it is bound and are not read.",
        "config-relations": NO_CONFIG,
        "runtime-unknown": "Reflection, source generators and runtime assembly loading produce no reference.",
      },
      projectContext: {
        manifests: [".csproj"],
        compilerOptions: "ProjectReference entries scope which files a using directive may see; namespace identity comes from namespace declarations only",
        dependencyAvailability: "snapshot only; no NuGet package or reference assembly is opened",
        conditionalEnvironment: "#if symbols are not evaluated",
      },
      limits: "A using directive binds when exactly one included file in scope declares the namespace or type; ProjectReference entries scope that visibility, and source generators and reference assemblies are not loaded. `Type.M(args)` binds when Type is declared in the caller's own namespace and project and has exactly one member M, a static method the arguments provably convert to; overloads, unqualified calls and arguments of unproven type stay candidate. A project whose App.csproj.user is left out of the snapshot (Visual Studio's standard .gitignore ignores *.user) is refused, because MSBuild imports that file. Any mention of OutputPath, IntermediateOutputPath, BaseOutputPath, BaseIntermediateOutputPath or PublishDir in the csproj or its imported build files refuses the project, even when the value moves no source folder, since these paths feed the default compile excludes." },
    { id: "swift", languages: ["swift"], grammar: "tree-sitter-swift", wave: "C", version: "swift/4",
      syntax: ["declarations", "signatures", "sourceContract"], semantic: ["project-local-imports", "package-targets", "call-binding"], needsProject: ["Package.swift"], localTools: false,
      engines: ["syntax-facts", "semantic-project", "project-swift", "semantic-calls"],
      items: {
        inventory: "supported", "grammar-ast": "supported", declarations: "supported", "source-contract": "supported",
        "local-modules": "supported", "project-binding": "supported", "type-call-resolution": "supported",
        "config-relations": "not-applicable", "runtime-unknown": "unsupported",
      },
      unsupported: {
        "local-modules": "A Swift module is a target, so an import binds only through a Package.swift that declares the target and the importing target's dependency on it. Without a manifest, a file named like the module is a candidate (swift-import-included-path), and several such files are reported unresolved as ambiguous.",
        "project-binding": "Package.swift is read as data, never evaluated: an interpolated target name, a computed targets list or a non-literal dependencies/sources value is recorded as unread and can never become a binding. Only .package(path:) siblings inside the snapshot contribute modules; URL and registry dependencies, Package.resolved and .build are not fetched. No bridging header, umbrella header or generated interface is read, and #if canImport, Package@swift-*.swift and .when(platforms:) conditions are not evaluated.",
        "type-call-resolution": "A call reaches resolved-static only under rule swift-module-function (src/semantic-calls.js), and argument labels alone never suffice: when module-scope lookup finds only functions it continues into every import, the standard library included, and an imported overload is shadowed only by a declaration of identical type, so a local func max(_:_:) does not hide Swift.max. The call must be a bare `f(label: arg, …)` written as a statement (directly or in statement-level if/guard/for/while/repeat/do/switch blocks) of a synchronous, non-generic top-level function with at least two statements outside #if and no attribute but discardableResult/inlinable/usableFromInline/inline; every argument must be a parameter of that function declared with a plain type name, rebound nowhere in it, and nothing in the function may bind f — no parameter, local, nested function or local struct/enum/class/actor/protocol/typealias named f (backticks ignored), and for f named `error` no pattern-less catch block around the call. The file must belong to a Package.swift target in a package with no Package@swift-*.swift and no build-tool plugin, whose path:/sources:/exclude:/resources: are literal; the target's compiled sources are its files minus the exact exclude: and resource paths (SwiftPM takes no globs there), hidden files and directories, playground and Xcode project contents and, from tools version 5.6, DocC catalogs — any other directory named with an extension makes the module unknown — and they must all be in the snapshot and parse: a .swift file or a directory under the target that the snapshot left out (ignored, too large, binary, cut by the file limit), or an incomplete record of left-out paths, makes the module unknown, since SwiftPM still compiles it. There may be no freestanding macro and no non-built-in attribute at module level. The target must declare exactly one module-level f — no overload, variable, type, macro or top-level-code use of the name — visible from the caller, outside #if (directives inside comments and strings are ignored), non-generic, not async or throwing, without default, variadic or inout parameters, whose labels and parameter types are exactly the arguments'; and each such type must be a non-generic struct, class, enum or actor declared once in the module. An imported overload then cannot name the type and can accept it only through a generic, existential or superclass parameter, which ranks below the exact local match. Everything else stays a candidate or unresolved with the reason: methods and calls inside types or extensions (Self's members, inherited and protocol-extension ones, come first), closures and result builders, calls in expression position or with a trailing closure, literal or computed arguments, async callers and Xcode projects without Package.swift.",
        "config-relations": NO_CONFIG,
        "runtime-unknown": "Protocol witness dispatch and Objective-C runtime lookup produce no reference.",
      },
      projectContext: {
        manifests: ["Package.swift", "module.modulemap"],
        compilerOptions: "target path:/sources: and the declared target dependency edges are read; build settings and flags are not",
        dependencyAvailability: "snapshot only; only .package(path:) siblings inside the snapshot contribute modules",
        conditionalEnvironment: "#if canImport and .when(platforms:) conditions are not evaluated",
      },
      limits: "An import binds to the target its package declares it may import; a multi-file target is a candidate set over that target's files, and system, binary and unfetched modules stay external. A free-function call binds only when every argument is a parameter whose type is a nominal type of the module and the module's single function of that name takes exactly those labels and types; methods, closures, literals and overloads stay candidate." },
    { id: "kotlin", languages: ["kotlin"], grammar: "tree-sitter-kotlin", wave: "C", version: "kotlin/4",
      syntax: ["declarations", "signatures", "sourceContract"], semantic: ["project-local-imports", "declared-source-roots", "call-binding"], needsProject: ["build.gradle.kts", "settings.gradle.kts", "pom.xml"], localTools: false,
      engines: ["syntax-facts", "semantic-project", "source-resolver", "project-jvm", "semantic-calls"],
      items: {
        inventory: "supported", "grammar-ast": "supported", declarations: "supported", "source-contract": "supported",
        "local-modules": "supported", "project-binding": "supported", "type-call-resolution": "supported",
        "config-relations": "not-applicable", "runtime-unknown": "unsupported",
      },
      unsupported: {
        "local-modules": JVM_NO_MANIFEST,
        "project-binding": JVM_NOT_READ + " The Kotlin-specific gaps are the same kind: kotlin-maven-plugin <sourceDirs> and the Android Gradle plugin's own source sets are not read, and expect/actual platform selection is not evaluated.",
        "type-call-resolution": "A call reaches resolved-static only through four rules of src/semantic-calls.js, and only in a .kt file under a source root a build manifest declares that parsed completely: kotlin-package-function (`f()` declared exactly once in the caller's package on its compile path) and kotlin-import-function (`f()` through one `import a.b.f`, with nothing named f in the caller's package), each a visible non-extension function with no expect/actual or @Deprecated(HIDDEN); kotlin-object-method and kotlin-companion-method (`Obj.f()` where Obj is a top-level object, or the companion of a class, declared once in the caller's package or by one explicit import, with no supertypes, declaring exactly one member f, a visible non-extension function, and no extension named f in the caller's package, its imports or its star imports). Kotlin picks the first candidate level that holds an applicable callable, and argument types are not checked, so a call binds only when nothing could take over at a lower level: every star import must name a package on the compile path, which declares nothing of that name, and the name must not be one the default imports declare (a catalogue of kotlin.*, kotlin.collections.*, kotlin.text.* and the other default packages read from the kotlin-stdlib API reference in October 2026 — a later standard library may add a name). Never bound: overloads, properties with invoke and constructors (every capitalised callee, since kotlin.* and java.lang.* classes are not catalogued); calls inside lambdas and anonymous functions (an implicit receiver is not stated at the call), extension bodies (an accessor on its own line counts as part of its property), object expressions, enum/data/value/annotation classes and classes or objects with supertypes; calls whose name a local, parameter or member of the enclosing declaration declares; qualified, safe, this and super calls; scripts (.kts); files with parse errors or context parameters. Only Kotlin/JVM and Android modules bind: the module's own Gradle build must apply kotlin(\"jvm\"), kotlin(\"android\") or their plugin ids literally (a Maven module counts as JVM), and no build covering it may apply Kotlin/JS, Native or multiplatform, whose default imports are not catalogued; plugins applied through version-catalogue aliases, convention plugins or allprojects/subprojects blocks are unknown. Absence is proven over every module reachable through dependency chains (Gradle api/implementation, Maven compile scope, sbt dependsOn), while the target itself must lie in the caller's module or a direct dependency. A JVM source in the snapshot without usable facts (over a size or text budget, a grammar failure) taints the packages it may declare. Backticked names are compared unquoted. Declarations inside jars, generated sources or a split package outside the snapshot are not read. Measured reach (November 2026, grammar fwcd/tree-sitter-kotlin d6af96d): 26 resolved calls on square/moshi, each checked by hand against the source, and 0 on square/kotlinpoet, whose sources sit in Kotlin Multiplatform source sets no recognised Gradle source root declares; parse failures fell from 27 of kotlinpoet's 125 files and 11 of moshi's 86 to 2 and 0.",
        "config-relations": NO_CONFIG,
        "runtime-unknown": "Extension-receiver and interface dispatch produce no resolved target.",
      },
      projectContext: {
        manifests: ["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts", "pom.xml"],
        compilerOptions: "source roots come from Gradle sourceSets main|test kotlin|java srcDir/srcDirs literals and the conventional src/{main,test}/{kotlin,java} the declared plugins bring; project(\":a:b\") dependencies scope cross-module visibility, with test configurations visible only from test sources",
        dependencyAvailability: "snapshot only; no classpath, jar, repository or version catalogue is opened",
        conditionalEnvironment: "expect/actual platform selection is not evaluated",
      },
      limits: "A type binds when exactly one visible declared root holds it and its package clause agrees with its directory; a Kotlin member import binds when exactly one file of the visible package declares the name, and a star import is a candidate set. Calls bind to unique package functions, imported functions and object/companion members only where no lambda, supertype, extension, star import outside the snapshot or default-import name could take over; everything else stays a candidate." },
    { id: "scala", languages: ["scala"], grammar: "tree-sitter-scala", wave: "C", version: "scala/4",
      syntax: ["declarations", "signatures", "sourceContract"], semantic: ["project-local-imports", "declared-source-roots"], needsProject: ["build.sbt", "build.gradle"], localTools: false,
      engines: ["syntax-facts", "semantic-project", "source-resolver", "project-jvm", "semantic-calls"],
      items: {
        inventory: "supported", "grammar-ast": "supported", declarations: "supported", "source-contract": "supported",
        "local-modules": "supported", "project-binding": "supported", "type-call-resolution": "candidate-only",
        "config-relations": "not-applicable", "runtime-unknown": "unsupported",
      },
      unsupported: {
        "local-modules": JVM_NO_MANIFEST,
        "project-binding": JVM_NOT_READ + " The compiler's TASTy output is not read either, so a symbol that only exists after compilation is never a target.",
        "type-call-resolution": "Deliberately never raised above candidate. src/semantic-calls.js refuses every Scala call with a reason: which object a name `Obj` denotes depends on import scoping this reader does not model — imports inside blocks and templates and their position (an import is in scope only after it and only in its block), selectors that hide or rename a name (`import q.{X => _, _}`), wildcard imports that outrank package members of other files (precedence 3 over 4 in 2.13 and 3), and the inherited and Java static members an `import a.B._` brings — and a member that does not accept the arguments is retried through an implicit view (spec §7.3), which needs implicit resolution. The bundled grammar, tree-sitter-scala 0.19.0, reads only Scala 2 syntax and fails on much of that as well: 19 of the 29 files of scopt/scopt have parse errors (`private[…] object`, `sealed trait`, `def ++(`), and a measured run over scopt bound 0 of 2,051 calls. Calls stay same-file lexical candidates or unresolved with that reason.",
        "config-relations": NO_CONFIG,
        "runtime-unknown": "Implicit resolution and macro expansion produce no reference.",
      },
      projectContext: {
        manifests: ["build.sbt", "build.gradle", "build.gradle.kts", "settings.gradle"],
        compilerOptions: "source roots come from sbt scalaSource/javaSource/unmanagedSourceDirectories when stated literally, lazy val subprojects with .dependsOn, and the src/{main,test}/{scala,java} defaults; Gradle scala source sets are read the same way as the Java ones",
        dependencyAvailability: "snapshot only; no classpath, jar, repository or lockfile is opened",
        conditionalEnvironment: "not evaluated; a computed sbt setting states no directory",
      },
      limits: "A type binds when exactly one visible declared root holds it and its chained package clause agrees with its directory; `a.b._` and `a.b.{C, D}` are candidate sets, and implicits and TASTy stay unsupported. Calls are never bound: import scoping and implicit views are not modelled, so they stay candidates." },
    { id: "ruby", languages: ["ruby"], grammar: "tree-sitter-ruby", wave: "C", version: "ruby/3",
      syntax: ["declarations", "signatures", "sourceContract"], semantic: ["project-local-imports", "declared-require-paths"],
      needsProject: ["*.gemspec", "Gemfile", "gems.rb"], localTools: false,
      engines: ["syntax-facts", "semantic-project", "source-resolver", "project-ruby"],
      items: {
        inventory: "supported", "grammar-ast": "supported", declarations: "supported", "source-contract": "unannotated",
        "local-modules": "supported", "project-binding": "supported", "type-call-resolution": "candidate-only",
        "config-relations": "not-applicable", "runtime-unknown": "unsupported",
      },
      unsupported: {
        "local-modules": "require_relative is file-relative and reaches resolved-static. A bare `require \"x/y\"` where no gemspec or Gemfile declares a require path matches by path suffix only and stays a candidate (several matches are reported ambiguous), because which directories are on $LOAD_PATH is then not stated.",
        "project-binding": "Gemspecs and Gemfiles are Ruby programs and are never run. Only a literal require_paths (array, %w[] or string) assigned directly in the Gem::Specification block is read. Recorded as unread instead, which keeps every require in that scope a candidate: a computed value (including word-list arithmetic or a trailing if), any other write to require_paths (<<, +=, |=, [i] =, prepend, push, ...), an assignment inside a conditional, loop or method, conflicting assignments, and a gemspec that can reach the spec object indirectly (send, eval, instance_eval, or the spec variable passed to other code). RubyGems' documented default [\"lib\"] applies only when none of these occur. In a Gemfile, a gemspec or path gem inside if/unless/case, platforms, install_if, env or any block other than group/source, one with a platforms:/install_if: option, or a gem declared twice is unread; gems.rb is read instead of a Gemfile beside it, as Bundler does. A declared require path outside the snapshot, or one holding no included file (excluded, such as vendor/, or absent) that could precede the hit, keeps the require a candidate. A bundle nested inside a gem (an example app) uses only the gems it activates itself. Not read: -I flags, RUBYLIB, Rakefile TestTask libs, .rspec, `bundle config without`, Bundler `path` blocks, eval_gemfile, git/registry gems and installed gems; a path gem without a gemspec gets no stand-in specification. Native extensions (.so/.bundle) are not searched.",
        "config-relations": NO_CONFIG,
        "runtime-unknown": "define_method, method_missing, const_get, autoload and a computed require argument produce no reference.",
      },
      projectContext: {
        manifests: ["*.gemspec", "Gemfile", "gems.rb"],
        compilerOptions: "$LOAD_PATH comes from literal, unconditional gemspec require_paths (or RubyGems' default lib) of the enclosing gem and of every local gem the nearest bundle (gems.rb, else Gemfile) activates through `gemspec` or `gem ..., path:`",
        dependencyAvailability: "snapshot only; installed, git and registry gems stay external references",
        conditionalEnvironment: "not evaluated; a declaration under a condition, platform or install_if is unread, and all Gemfile groups are treated as set up",
      },
      limits: "require_relative binds file-relative; `require` binds when exactly one declared require path holds the feature, several declared hits or an undeclared match stay candidates, and gems and metaprogramming stay unresolved." },
    { id: "php", languages: ["php"], grammar: "tree-sitter-php", wave: "C", version: "php/3",
      syntax: ["declarations", "signatures", "sourceContract"], semantic: ["project-local-imports", "composer-autoload"],
      needsProject: ["composer.json"], localTools: false,
      engines: ["syntax-facts", "semantic-project", "source-resolver", "project-php"],
      items: {
        inventory: "supported", "grammar-ast": "supported", declarations: "supported", "source-contract": "unannotated",
        "local-modules": "supported", "project-binding": "supported", "type-call-resolution": "candidate-only",
        "config-relations": "not-applicable", "runtime-unknown": "unsupported",
      },
      unsupported: {
        "local-modules": "An include anchored with __DIR__ or dirname(__FILE__[, n]) reaches resolved-static, parenthesized or not; an unqualified dirname() reaches it only in a global-namespace file that imports no dirname function, and otherwise (namespaced code not writing \\dirname, or a `use function …\\dirname`) stays a candidate because a namespace or imported function can shadow it. A literal relative include is searched on include_path and the working directory, neither of which the snapshot states, so it stays a candidate; without composer.json a `use` that matches a file by name stays a candidate too.",
        "project-binding": "composer.json autoload/autoload-dev psr-4, psr-0, classmap and files are read as data; vendor/autoload.php and Composer plugins are never executed, and no generated classmap or vendor package is read, so a dependency's class stays an external reference. A name binds only when the maps give exactly one existing file and that file declares the name; Composer's own lookup order between several matches is not reproduced (they stay candidates). A class an autoload \"files\" entry declares unconditionally binds to that file ahead of psr-4/psr-0/classmap, since it is defined before any lookup; one declared only inside an if/for/while/try block stays a candidate alongside whatever the maps give. A classmap class referenced in a different letter case stays a candidate, because Composer's class map is keyed by the exact name. Wildcard classmap entries and absolute autoload or path-repository paths are recorded as unread, which keeps names in that scope candidates. Path repositories contribute only packages the root requires, and only their autoload map. A qualified class name that no autoload map covers (a builtin or dependency class) produces no relation, an unqualified name used without a `use` clause is not resolved, and `use const` is reported because Composer does not autoload constants.",
        "config-relations": NO_CONFIG,
        "runtime-unknown": "Variable includes, spl_autoload_register callbacks, __autoload, string class names and call_user_func produce no reference.",
      },
      projectContext: {
        manifests: ["composer.json"],
        compilerOptions: "class-to-file mapping comes from autoload and autoload-dev psr-4, psr-0, classmap (with exclude-from-classmap) and files of the root package plus the autoload of path-repository packages it requires",
        dependencyAvailability: "snapshot only; vendor/ is not interpreted",
        conditionalEnvironment: "not evaluated",
      },
      limits: "use statements and qualified class names bind through the composer.json autoload maps when exactly one declaring file results; __DIR__-anchored includes bind; literal includes stay candidates and the autoloader is never run." },
    { id: "lua", languages: ["lua"], grammar: "tree-sitter-lua", wave: "C", version: "lua/3",
      syntax: ["declarations", "signatures", "sourceContract"], semantic: ["project-local-imports", "declared-module-paths"],
      needsProject: ["*.rockspec", ".luarc.json", ".luarc.jsonc"], localTools: false,
      engines: ["syntax-facts", "semantic-project", "source-resolver", "project-lua"],
      items: {
        inventory: "supported", "grammar-ast": "supported", declarations: "supported", "source-contract": "unannotated",
        "local-modules": "candidate-only", "project-binding": "supported", "type-call-resolution": "candidate-only",
        "config-relations": "not-applicable", "runtime-unknown": "unsupported",
      },
      unsupported: {
        "local-modules": "Lua has no file-relative require: without a declaration, the default package.path templates ./?.lua and ./?/init.lua are relative to the working directory of the process, which the snapshot does not state, so a matching file is a candidate. A module tree below the snapshot root (data/core/common.lua for require \"core.common\") is found the same way: every file whose path ends in the module path as ?.lua or ?/init.lua is a candidate (lua-require-path-suffix) while there are at most three, and more stay an external reference. The standard libraries coroutine, debug, io, math, os, package, string, table and utf8 are preloaded into package.loaded, so their require opens no file and is an external standard-library reference (lua-require-standard-library), never a local candidate.",
        "project-binding": "A rockspec is Lua code and is never run: only literal build.modules and build.install.lua tables are read, relative to the rockspec's directory, and a computed value, a later write to build or a build.platforms override is recorded as unread, which keeps requires in that scope candidates; C modules are not bound. .luarc.json runtime.path is the language server's search, relative to its directory, with workspace.library roots inside the snapshot; when the file sets none, LuaLS's default [\"?.lua\", \"?/init.lua\"] only proposes candidates, and without runtime.pathStrict the server also matches under any subdirectory of the workspace or a library root, so a second such match stays a candidate. A literal package.path assignment in code is relative to the unstated working directory and only proposes candidates; package.cpath, LUA_PATH, luarocks trees and busted/.busted configuration are not read.",
        "config-relations": NO_CONFIG,
        "runtime-unknown": "Computed require arguments and metatable dispatch produce no reference; anywhere in the project, a computed package.path write (including through package[k], an alias or package passed as a value), a literal package.path template that reaches another file for the module, or a package.preload/searchers change keeps a declared require a candidate.",
      },
      projectContext: {
        manifests: ["*.rockspec", ".luarc.json", ".luarc.jsonc"],
        compilerOptions: "module-to-file mapping comes from literal rockspec build.modules/build.install.lua and .luarc runtime.path templates; literal package.path assignments only propose candidates",
        dependencyAvailability: "snapshot only; installed rocks stay external references",
        conditionalEnvironment: "build.platforms overrides are not evaluated",
      },
      limits: "A require binds when the rockspec or an explicit .luarc runtime.path in scope gives exactly one existing file and no project code makes package.path reach another file for it or edits package.preload/searchers; undeclared, package.path-only, LuaLS-default-template and default-path matches stay candidates, and a rockspec whose build is rewritten after assignment (including multiple assignment or any _ENV use) or nests tables past 64 levels is unread." },
    { id: "shell", languages: ["shell"], grammar: "tree-sitter-bash", wave: "C", version: "shell/4",
      syntax: ["declarations", "signatures", "sourceContract"], semantic: ["project-local-imports", "script-directory-source"], needsProject: [], localTools: false,
      engines: ["syntax-facts", "semantic-project", "source-resolver"],
      items: {
        inventory: "supported", "grammar-ast": "supported", declarations: "supported", "source-contract": "not-applicable",
        "local-modules": "supported", "project-binding": "not-applicable", "type-call-resolution": "candidate-only",
        "config-relations": "not-applicable", "runtime-unknown": "unsupported",
      },
      unsupported: {
        "source-contract": "Shell functions declare no parameters or result type, so the contract reports not-applicable rather than an invented signature.",
        "local-modules": "Only a path built on the sourcing file's real directory — $(dirname \"$(readlink -f \"${BASH_SOURCE[0]}\")\"), the realpath form, either inside cd-and-pwd, or one top-level variable assigned exactly once from them — reaches resolved-static, and only in a file declared as bash (a bash shebang, or a .sh/.bash name without a shebang) that does not redefine source, cd, dirname, readlink, realpath or pwd, when no cd/pushd/popd (also through builtin or command), eval or trap can run before it is evaluated (a loop body counts as running before), and, for the variable form, no printf -v, getopts or eval can reassign the variable. An earlier `source` can run first too: it is allowed only when it binds statically to an included, fully parsed file that itself has no cd, eval, trap, further source or such redefinition and never names the variable; otherwise the later source stays a candidate. ${BASH_SOURCE%/*} and $(dirname \"${BASH_SOURCE[0]}\") without readlink name a symlink's directory when the script is run through one, so they stay candidates. A $0-based directory names the invoked script, which is this file only when it is executed, so it stays a candidate; a literal path with a slash is relative to the working directory and a bare name is searched on PATH first, so both stay candidates.",
        "project-binding": "Shell has no project manifest or module search path to declare: `source` resolves against the working directory and PATH at run time, and the file-relative idioms above are local-module rules, not project configuration. PATH and the environment are not consulted.",
        "config-relations": NO_CONFIG,
        "runtime-unknown": "A sourced path built from any other variable, command substitution or expansion produces no reference.",
      },
      projectContext: { manifests: [], compilerOptions: "none", dependencyAvailability: "snapshot only; scripts are never executed", conditionalEnvironment: "not evaluated" },
      limits: "source/. binds when its path is built on the file's own readlink -f/realpath-resolved BASH_SOURCE directory in a bash file with nothing that can cd or reassign it first; symlink-sensitive, working-directory, PATH and $0-relative paths stay candidates, and scripts are not executed." },
    { id: "html", languages: ["html"], grammar: "tree-sitter-html", wave: "D", version: "html/2",
      syntax: ["structure", "links"], semantic: ["project-local-imports"], needsProject: [], localTools: false,
      engines: ["document-structure", "semantic-project", "source-resolver"],
      items: {
        inventory: "supported", "grammar-ast": "supported", declarations: "supported", "source-contract": "not-applicable",
        "local-modules": "candidate-only", "project-binding": "unsupported", "type-call-resolution": "not-applicable",
        "config-relations": "not-applicable", "runtime-unknown": "unsupported",
      },
      unsupported: {
        "source-contract": NO_CONTRACT,
        "local-modules": "An authored src/href that matches an included file becomes a resource candidate (document-reference). The page is never loaded, so a <base> element, server routing or a bundler could fetch another URL; the relationship is not a verified fetch.",
        "project-binding": "No build configuration is read; a bundler's rewriting of these URLs is not modelled.",
        "type-call-resolution": NO_CALLS,
        "config-relations": NO_CONFIG,
        "runtime-unknown": "Page JavaScript is never executed, so DOM-inserted resources produce no reference.",
      },
      projectContext: { manifests: [], compilerOptions: "none", dependencyAvailability: "only resources included in the snapshot", conditionalEnvironment: "not evaluated" },
      limits: "Authored script/link targets inside the snapshot are candidates; the page is never loaded and page JS is not executed." },
    { id: "css", languages: ["css"], grammar: "tree-sitter-css", wave: "D", version: "css/2",
      syntax: ["structure"], semantic: [], needsProject: [], localTools: false,
      engines: ["syntax-facts", "source-resolver"],
      items: {
        inventory: "supported", "grammar-ast": "supported", declarations: "supported", "source-contract": "not-applicable",
        "local-modules": "candidate-only", "project-binding": "unsupported", "type-call-resolution": "not-applicable",
        "config-relations": "not-applicable", "runtime-unknown": "not-applicable",
      },
      unsupported: {
        "source-contract": NO_CONTRACT,
        "local-modules": "A relative @import that matches an included file becomes a candidate. The coarse `semantic: []` list below understates this; the item row is the accurate claim.",
        "project-binding": "No preprocessor include path or bundler alias is read.",
        "type-call-resolution": NO_CALLS,
        "config-relations": NO_CONFIG,
        "runtime-unknown": NO_RUNTIME,
      },
      projectContext: { manifests: [], compilerOptions: "none", dependencyAvailability: "snapshot only", conditionalEnvironment: "not evaluated" },
      limits: "Computed selectors are not evaluated." },
    { id: "vue", languages: ["vue"], grammar: "tree-sitter-vue", wave: "D", version: "vue/2",
      syntax: ["structure", "embedded-script"], semantic: ["project-local-imports"], needsProject: [], localTools: false,
      engines: ["syntax-facts", "source-resolver"],
      items: {
        inventory: "supported", "grammar-ast": "supported", declarations: "supported", "source-contract": "supported",
        "local-modules": "candidate-only", "project-binding": "candidate-only", "type-call-resolution": "unsupported",
        "config-relations": "not-applicable", "runtime-unknown": "unsupported",
      },
      unsupported: {
        "source-contract": "A <script lang=\"ts\"> block carries explicit parameter and return parts; a plain JavaScript <script> has no annotations, so its parts are reported unannotated rather than guessed.",
        "project-binding": "The embedded script's imports use the same configured JavaScript resolution as a .ts file (tsconfig paths, package.json), but the component is never type-checked, so an import that reaches an included file through that configuration stays a candidate.",
        "type-call-resolution": "An embedded-script call site is reported as unresolved with a reason; the single-file component is not type-checked, so no call binding is claimed.",
        "config-relations": NO_CONFIG,
        "runtime-unknown": "Dynamic component resolution and runtime template compilation produce no reference.",
      },
      projectContext: {
        manifests: ["tsconfig.json", "package.json"],
        compilerOptions: "the embedded script's imports use the same configured JavaScript resolution as a .ts file",
        dependencyAvailability: "snapshot only",
        conditionalEnvironment: "not evaluated",
      },
      limits: "Embedded-script imports and authored src/href targets inside the snapshot are candidates; not a full SFC typecheck." },
    { id: "json", languages: ["json"], grammar: "tree-sitter-json", wave: "D", version: "json/2",
      syntax: ["structure"], semantic: [], needsProject: [], localTools: false,
      engines: ["syntax-facts", "semantic-dwave"],
      items: {
        inventory: "supported", "grammar-ast": "supported", declarations: "not-applicable", "source-contract": "not-applicable",
        "local-modules": "not-applicable", "project-binding": "not-applicable", "type-call-resolution": "not-applicable",
        "config-relations": "supported", "runtime-unknown": "not-applicable",
      },
      unsupported: {
        declarations: NO_DECLARATIONS, "source-contract": NO_CONTRACT, "local-modules": NO_MODULES,
        "project-binding": "A manifest is the project context other adapters read; it has none of its own.",
        "type-call-resolution": NO_CALLS, "runtime-unknown": NO_RUNTIME,
      },
      projectContext: {
        manifests: ["package.json"],
        compilerOptions: "package.json bin and main entries resolve inside the directory that owns the manifest",
        dependencyAvailability: "declared dependency versions are read as text; nothing is fetched",
        conditionalEnvironment: "scripts are read as text and never executed",
      },
      limits: "Schema validation is not performed." },
    { id: "yaml", languages: ["yaml"], grammar: "tree-sitter-yaml", wave: "D", version: "yaml/2",
      syntax: [], semantic: [], needsProject: [], localTools: false,
      engines: ["syntax-facts"],
      items: {
        inventory: "supported", "grammar-ast": "supported", declarations: "not-applicable", "source-contract": "not-applicable",
        "local-modules": "not-applicable", "project-binding": "not-applicable", "type-call-resolution": "not-applicable",
        "config-relations": "unsupported", "runtime-unknown": "not-applicable",
      },
      unsupported: {
        declarations: NO_DECLARATIONS, "source-contract": NO_CONTRACT, "local-modules": NO_MODULES,
        "project-binding": "No YAML format is interpreted as project configuration.",
        "type-call-resolution": NO_CALLS, "runtime-unknown": NO_RUNTIME,
        "config-relations": "Workflow, compose and chart files are parsed as structure only: no job, service or template reference becomes a relation.",
      },
      projectContext: { manifests: [], compilerOptions: "none", dependencyAvailability: "snapshot only", conditionalEnvironment: "not evaluated" },
      limits: "The grammar parses the file and parse errors are reported, but no mapping key, sequence or anchor becomes a structure entry, so no `structure` feature is declared." },
    { id: "toml", languages: ["toml"], grammar: "tree-sitter-toml", wave: "D", version: "toml/2",
      syntax: [], semantic: [], needsProject: [], localTools: false,
      engines: ["syntax-facts", "semantic-dwave"],
      items: {
        inventory: "supported", "grammar-ast": "supported", declarations: "not-applicable", "source-contract": "not-applicable",
        "local-modules": "not-applicable", "project-binding": "not-applicable", "type-call-resolution": "not-applicable",
        "config-relations": "candidate-only", "runtime-unknown": "not-applicable",
      },
      unsupported: {
        declarations: NO_DECLARATIONS, "source-contract": NO_CONTRACT, "local-modules": NO_MODULES,
        "config-relations": "A [project.scripts] entry names a module (`demo.cli:main`). It is mapped to demo/cli.py inside the manifest's directory as a candidate, because the package root that would make that file the module demo.cli is not applied here.",
        "project-binding": "Cargo.toml and Project.toml are used as project markers by the Rust and Julia adapters; this adapter reads neither.",
        "type-call-resolution": NO_CALLS, "runtime-unknown": NO_RUNTIME,
      },
      projectContext: {
        manifests: ["pyproject.toml"],
        compilerOptions: "pyproject.toml [project.scripts] entry points map to a candidate module file inside the manifest's directory",
        dependencyAvailability: "declared versions are read as text; nothing is fetched",
        conditionalEnvironment: "not evaluated",
      },
      limits: "The grammar parses the file and parse errors are reported, but no table or key becomes a structure entry, so no `structure` feature is declared; only pyproject.toml [project.scripts] is interpreted, as candidate configuration relations." },
    { id: "markdown", languages: ["markdown"], grammar: null, wave: "D", version: "markdown/2",
      syntax: ["headings", "links"], semantic: ["project-local-imports"], needsProject: [], localTools: false,
      engines: ["document-structure", "source-resolver"],
      items: {
        inventory: "supported", "grammar-ast": "unsupported", declarations: "supported", "source-contract": "not-applicable",
        "local-modules": "supported", "project-binding": "not-applicable", "type-call-resolution": "not-applicable",
        "config-relations": "not-applicable", "runtime-unknown": "not-applicable",
      },
      unsupported: {
        "grammar-ast": "No markdown grammar is loaded. Headings and links come from a line-based document reader that skips fenced code, so nesting inside HTML blocks and reference-style links are not modelled.",
        "local-modules": "A link binds relative to the document that holds it. The same path read from the snapshot root instead is a candidate (markdown-link-root-guess), never the target.",
        "source-contract": NO_CONTRACT, "project-binding": "A document declares no project configuration.",
        "type-call-resolution": NO_CALLS, "config-relations": NO_CONFIG, "runtime-unknown": NO_RUNTIME,
      },
      projectContext: { manifests: [], compilerOptions: "none", dependencyAvailability: "only documents included in the snapshot", conditionalEnvironment: "not evaluated" },
      limits: "Local relative links may bind; document claims stay documentation-statement until independently reviewed." },
  ];

  function freezeList(value) { return Object.freeze([...(value || [])]); }
  function freezeAdapter(item) {
    return Object.freeze({
      ...item,
      languages: freezeList(item.languages),
      syntax: freezeList(item.syntax),
      semantic: freezeList(item.semantic),
      needsProject: freezeList(item.needsProject),
      engines: freezeList(item.engines),
      items: Object.freeze({ ...item.items }),
      unsupported: Object.freeze({ ...item.unsupported }),
      projectContext: Object.freeze({ ...item.projectContext, manifests: freezeList(item.projectContext?.manifests) }),
      languageItems: Object.freeze({ ...item.languageItems }),
    });
  }
  const registry = Object.freeze(adapters.map(freezeAdapter));

  function byLanguage(language) {
    const key = String(language || "").toLowerCase();
    return registry.find(item => item.languages.includes(key) || item.id === key) || null;
  }

  /** Item statuses for one language, after this language's own overrides. */
  function itemsFor(adapter, language) {
    return Object.freeze({ ...adapter.items, ...(adapter.languageItems?.[String(language || "").toLowerCase()] || {}) });
  }

  /** Every item this language does not produce, with the reason it does not.
   *  A missing reason is a registry defect, reported rather than hidden. */
  function unsupportedFeatures(adapter, language) {
    const items = itemsFor(adapter, language), rows = [];
    for (const item of CAPABILITY_ITEMS) {
      const state = items[item];
      const reason = adapter.unsupported?.[item];
      if (MUST_EXPLAIN.includes(state)) rows.push({ item, state, reason: reason || null, ...(reason ? {} : { undeclared: true }) });
      else if (reason) rows.push({ item, state, reason, partial: true });
    }
    return rows;
  }

  function capability(language) {
    const adapter = byLanguage(language);
    if (!adapter) {
      return {
        language: language || null, present: false, syntax: [], semantic: [],
        status: "unsupported", reasonCode: "no-adapter",
        version: "no-adapter",
        items: Object.freeze({ inventory: "supported", "grammar-ast": "unsupported", declarations: "unsupported", "source-contract": "unsupported", "local-modules": "unsupported", "project-binding": "unsupported", "type-call-resolution": "unsupported", "config-relations": "unsupported", "runtime-unknown": "unsupported" }),
        unsupportedFeatures: CAPABILITY_ITEMS.filter(item => item !== "inventory").map(item => ({ item, state: "unsupported", reason: "No adapter is registered for this language. The file keeps its inventory record, byte identity and source excerpt." })),
        resolutionStates: RESOLUTION_STATES,
        message: "No grammar adapter is registered for this language.",
      };
    }
    return {
      language, adapter: adapter.id, wave: adapter.wave, present: true,
      version: adapter.version,
      grammar: adapter.grammar, syntax: adapter.syntax, semantic: adapter.semantic,
      status: adapter.semantic.length ? "syntax+semantic" : "syntax-only",
      needsProject: adapter.needsProject, localTools: adapter.localTools, limits: adapter.limits,
      engines: adapter.engines,
      items: itemsFor(adapter, language),
      unsupportedFeatures: unsupportedFeatures(adapter, language),
      projectContext: adapter.projectContext,
      resolutionStates: RESOLUTION_STATES,
      grammarIsNotSemantic: "A loaded grammar produces a syntax tree. Each item above states separately whether a resolver acted on it.",
    };
  }

  function matrix() {
    return registry.map(item => capability(item.id));
  }

  /** Registry rows whose unsupported/not-applicable item carries no reason. */
  function audit() {
    const missing = [];
    for (const adapter of registry) for (const language of adapter.languages) {
      for (const row of unsupportedFeatures(adapter, language)) if (row.undeclared) missing.push(`${language}.${row.item}`);
      for (const item of CAPABILITY_ITEMS) {
        const state = itemsFor(adapter, language)[item];
        if (!STATES.includes(state)) missing.push(`${language}.${item}=${state}`);
      }
    }
    return { complete: missing.length === 0, missing, items: CAPABILITY_ITEMS, states: STATES };
  }

  /* Execution profiles. Everything above is WASM/JavaScript, so the browser and
     a local CLI run produce the same IR from the same source bytes: there is no
     capability that exists only behind a local install today. Native language
     services would be an enhancement; until a bridge delivers one under this
     same schema, they are listed as unavailable in both profiles rather than
     advertised as "full capability, local only". */
  const PROFILES = Object.freeze({
    browser: Object.freeze({ id: "browser", engine: "wasm-worker", items: "all rows above", sameIR: true, note: "Grammars run as WASM in a Worker; large indexes are persisted in shards." }),
    local: Object.freeze({ id: "local", engine: "node", items: "all rows above", sameIR: true, note: "The CLI and local bridge run the same first-party analyzers and emit the same IR, so one viewer reads both." }),
  });
  const LOCAL_ENHANCEMENTS = Object.freeze([
    Object.freeze({ id: "native-language-service", state: "unsupported", available: { browser: false, local: false }, reason: "No rust-analyzer, gopls, clangd, jdtls or pyright integration exists. Neither profile has compiler-grade resolution for those languages, and no UI may offer it as a local upgrade." }),
    Object.freeze({ id: "generated-artifacts", state: "unsupported", available: { browser: false, local: false }, reason: "Build hooks are never executed. Generated code and build outputs must be supplied as source before they can be analyzed." }),
  ]);
  const SOURCE_KINDS = Object.freeze([
    Object.freeze({ id: "folder", claims: "Files the user selected, with per-path accounting.", forbidden: "Nothing outside the selection." }),
    Object.freeze({ id: "git-repo", claims: "Files at the pinned revision, with a source ledger.", forbidden: "Nothing about revisions or branches that were not fetched." }),
    Object.freeze({ id: "web-page", claims: "Only the fetched pages and the resources fetched with them.", forbidden: "Server-side implementation, private endpoints or any source not returned by the fetch. A URL is not evidence about the code behind it." }),
  ]);
  function profiles() {
    return { profiles: PROFILES, sameIR: true, localEnhancements: LOCAL_ENHANCEMENTS, sourceKinds: SOURCE_KINDS };
  }

  function detectProject(files) {
    const names = new Set((files || []).map(file => String(file.path || file).split("/").pop()));
    const hits = [];
    if ([...names].some(name => /^tsconfig.*\.json$/i.test(name))) hits.push({ adapter: "typescript", manifest: "tsconfig" });
    if (names.has("package.json")) hits.push({ adapter: "typescript", manifest: "package.json" });
    if (names.has("pyproject.toml") || names.has("setup.cfg") || names.has("setup.py") || names.has("requirements.txt")) hits.push({ adapter: "python", manifest: "python-project" });
    if (names.has("Project.toml")) hits.push({ adapter: "julia", manifest: "Project.toml" });
    if (names.has("go.mod")) hits.push({ adapter: "go", manifest: "go.mod" });
    if (names.has("Cargo.toml")) hits.push({ adapter: "rust", manifest: "Cargo.toml" });
    if (names.has("compile_commands.json")) hits.push({ adapter: "c", manifest: "compile_commands.json" });
    if (names.has("CMakeLists.txt")) hits.push({ adapter: "c", manifest: "CMakeLists.txt" });
    if ([...names].some(name => name.endsWith(".csproj") || name.endsWith(".sln"))) hits.push({ adapter: "csharp", manifest: "msbuild" });
    if (names.has("Package.swift")) hits.push({ adapter: "swift", manifest: "Package.swift" });
    if (names.has("pom.xml") || names.has("build.gradle") || names.has("build.gradle.kts") || names.has("settings.gradle") || names.has("settings.gradle.kts")) hits.push({ adapter: "java", manifest: "jvm-build" });
    if (names.has("build.sbt")) hits.push({ adapter: "scala", manifest: "build.sbt" });
    if (names.has("Gemfile") || names.has("gems.rb") || [...names].some(name => name.endsWith(".gemspec"))) hits.push({ adapter: "ruby", manifest: "gemspec/Gemfile" });
    if (names.has("composer.json")) hits.push({ adapter: "php", manifest: "composer.json" });
    if (names.has(".luarc.json") || names.has(".luarc.jsonc") || [...names].some(name => name.endsWith(".rockspec"))) hits.push({ adapter: "lua", manifest: "rockspec/.luarc" });
    return hits;
  }

  function extractSyntax(language, text, path, options) {
    const facts = root.SkylenseSyntaxFacts;
    if (!facts) return { status: "unsupported", reasonCode: "syntax-facts-unloaded", symbols: [], contracts: [] };
    const cap = capability(language);
    if (!cap.present) return { status: "unsupported", reasonCode: "no-adapter", symbols: [], contracts: [] };
    const tree = options?.tree;
    if (!tree) return { status: "pending", reasonCode: "tree-not-supplied", symbols: [], contracts: [], capability: cap };
    try {
      const extracted = facts.extractFromTree(language, text, tree, path);
      return { status: "complete", reasonCode: null, capability: cap, ...extracted };
    } catch (error) {
      return { status: "failed", reasonCode: "extract-error", message: String(error.message || error), capability: cap, symbols: [], contracts: [] };
    }
  }

  function resolveProject(language, context) {
    const cap = capability(language);
    if (!cap.semantic.length) {
      return { status: "unsupported", reasonCode: "syntax-only-adapter", capability: cap, bindings: [], note: cap.limits };
    }
    if (language === "typescript" || language === "javascript" || language === "tsx") {
      return { status: root.SkylenseTypeScriptSemantics ? "available" : "pending", reasonCode: null, capability: cap, engine: "semantic-typescript" };
    }
    if (language === "python") {
      return { status: root.SkylensePythonStructure ? "available" : "pending", reasonCode: null, capability: cap, engine: "python-structure" };
    }
    if (language === "julia") {
      return { status: root.SkylenseJuliaSemantics ? "available" : "pending", reasonCode: null, capability: cap, engine: "semantic-julia" };
    }
    if (cap.semantic.includes("project-local-imports")) {
      return { status: root.SkylenseSemanticProject ? "available" : "pending", reasonCode: null, capability: cap, engine: "semantic-project" };
    }
    return { status: "unsupported", reasonCode: "semantic-wave-pending", capability: cap, bindings: [] };
  }

  function diagnostics(language) {
    const cap = capability(language);
    return {
      adapter: cap.adapter || null,
      version: cap.version,
      claimedSemantic: Boolean(cap.semantic?.length),
      honest: cap.status !== "syntax-only" || !cap.semantic?.length,
      itemized: cap.items,
      unsupportedFeatures: cap.unsupportedFeatures,
      limits: cap.limits || cap.message,
    };
  }

  function dependenciesForInvalidation(language, file) {
    const cap = capability(language);
    return {
      adapter: cap.adapter || null,
      syntaxKey: [file?.decodedTextHash, language, cap.grammar, "syntax-facts"].join("\0"),
      semanticKey: cap.semantic.length ? [file?.path, file?.decodedTextHash, language, ...(cap.needsProject || []), "semantic-project"].join("\0") : null,
      projectInputs: cap.needsProject || [],
    };
  }

  root.SkylenseLanguageAdapters = Object.freeze({
    adapters: registry,
    byLanguage, capability, matrix, audit, profiles, detectProject, extractSyntax, resolveProject, diagnostics, dependenciesForInvalidation,
    CAPABILITY_ITEMS, STATES, RESOLUTION_STATES,
    SYNTAX, SEMANTIC,
  });
})(typeof window !== "undefined" ? window : globalThis);
