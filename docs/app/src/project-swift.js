/* Swift project binding: `Package.swift` read as data, never evaluated.
 *
 * `import Foo` in Swift names a *module*, and a module is a build product, not a
 * file. SwiftPM decides which files make up module `Foo` and which modules a
 * given file is even allowed to import, so the only honest answer comes from the
 * package manifest:
 *   - a target's sources are `Sources/<Target>` (`Tests/<Target>` for a test
 *     target, `Plugins/<Target>` for a plugin), overridden by `path:` and
 *     narrowed by `sources:`;
 *   - `import Foo` compiles only when `Foo` is a target of this package, or a
 *     target exported by a product of a package this one depends on, AND the
 *     importing file's own target declares that dependency. An undeclared module
 *     is a compile error, so it is never a binding here;
 *   - a `.systemLibrary` target names a module the host system provides and a
 *     `.binaryTarget` one that ships prebuilt, so neither can bind to a file in
 *     the snapshot;
 *   - a C target may rename its module through a Clang module map, so
 *     `<root>/module.modulemap` is read for `module <Name>`.
 * Specifications this reader encodes:
 *   PackageDescription  https://docs.swift.org/package-manager/PackageDescription/PackageDescription.html
 *   Package layout      https://github.com/swiftlang/swift-package-manager/blob/main/Documentation/Usage.md
 *   Clang module maps   https://clang.llvm.org/docs/Modules.html#module-map-language
 *   Swift imports       https://docs.swift.org/swift-book/documentation/the-swift-programming-language/declarations/#Import-Declaration
 *
 * A manifest is Swift source, so a literal read is the only read available
 * without running it: `Package(` is scanned textually with balanced brackets and
 * real Swift string literals (escaped, raw `#"…"#` and multi-line `"""`). Any
 * argument that is not a literal — an interpolated target name, a computed
 * `targets:` list, a dependency list built by a function — is recorded as unread
 * and can never become a binding. A manifest that cannot be read at all yields no
 * verdict, so the weaker basename search that ran before still answers. */
(function (root) {
  "use strict";

  const manifests = root.SkylenseProjectManifests;
  if (!manifests) throw new Error("src/project-manifests.js must load before this family.");

  const MANIFEST_NAME = "Package.swift";
  /* Bounded by construction: a huge manifest is skipped rather than half-read,
     and a snapshot cannot make this reader scan an unbounded number of them. */
  const MAX_MANIFEST_BYTES = 1024 * 1024;
  const MAX_MANIFESTS = 2000;
  const MAX_TARGETS = 500;

  const TARGET_CALL = /^\.(target|executableTarget|testTarget|systemLibrary|binaryTarget|macro|plugin)\s*\(/;
  const PRODUCT_CALL = /^\.(library|executable|plugin)\s*\(/;
  const DEPENDENCY_CALL = /^\.(target|product|byName|targetItem)\s*\(/;
  const PACKAGE_DEPENDENCY = /^\.package\s*\(/;
  const MODULE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const SWIFT_SOURCE = /\.swift$/;
  const CLANG_SOURCE = /\.(?:c|cc|cpp|cxx|m|mm|s)$/i;
  const CLANG_HEADER = /\.(?:h|hh|hpp|hxx)$/i;
  const VERSIONED_MANIFEST = /^Package@swift-[\w.]+\.swift$/;
  // SwiftPM's predefined source directories, in the order it searches them.
  const PREDEFINED = { testTarget: ["Tests"], plugin: ["Plugins"], default: ["Sources", "Source", "src", "srcs"] };

  const brief = text => String(text).replace(/\s+/g, " ").trim().slice(0, 60);
  const dirOf = manifests.dirOf;
  const baseOf = manifests.baseOf;

  // ---------------------------------------------------------------------------
  // Swift literal scanning
  // ---------------------------------------------------------------------------
  /** One Swift string literal starting at `at`: basic, raw (`#"…"#`) or
   *  multi-line (`"""…"""`). `value` is null when the literal interpolates a
   *  runtime expression or is unterminated, because neither can be read as data.
   *  Returns null when `at` does not begin a string literal at all. */
  function readString(text, at) {
    let hashes = 0;
    while (text[at + hashes] === "#") hashes++;
    let i = at + hashes;
    if (text[i] !== '"') return null;
    const pounds = "#".repeat(hashes);
    const quote = text.startsWith('"""', i) ? '"""' : '"';
    i += quote.length;
    const terminator = quote + pounds;
    const escape = "\\" + pounds;
    let value = "", interpolated = false;
    while (i < text.length) {
      if (text.startsWith(terminator, i)) return { end: i + terminator.length, value: interpolated ? null : value };
      if (text.startsWith(escape, i)) {
        const next = text[i + escape.length];
        if (next === "(") {
          interpolated = true;
          const nested = segments(text, i + escape.length);
          i = nested.broken ? text.length : nested.end;
          continue;
        }
        value += next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "\r" : next ?? "";
        i += escape.length + 1;
        continue;
      }
      value += text[i++];
    }
    return { end: text.length, value: null };
  }

  /** Comma-separated segments of the bracketed group opening at `at`, split at
   *  the group's own depth so nested calls and arrays stay in one piece. String
   *  literals are skipped whole, so a bracket or comma inside one is text. */
  function segments(text, at) {
    const open = text[at];
    const close = open === "(" ? ")" : open === "[" ? "]" : open === "{" ? "}" : null;
    if (!close) return { items: [], end: at, broken: true };
    const items = [];
    let depth = 0, start = at + 1, i = start;
    for (; i < text.length; i++) {
      const char = text[i];
      if (char === '"' || char === "#") {
        const literal = readString(text, i);
        if (literal) { i = literal.end - 1; continue; }
      }
      if (char === "(" || char === "[" || char === "{") { depth++; continue; }
      if (char === ")" || char === "]" || char === "}") {
        if (depth > 0) { depth--; continue; }
        if (char !== close) return { items, end: i, broken: true };
        items.push(text.slice(start, i));
        return { items: items.filter(item => item.trim()), end: i + 1 };
      }
      if (char === "," && depth === 0) { items.push(text.slice(start, i)); start = i + 1; }
    }
    return { items, end: text.length, broken: true };
  }

  /** `name: value` split. An argument that does not start with an identifier and
   *  a colon is positional, which is how `.byName("Helper")` is written. */
  function labeled(item) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([\s\S]*?)\s*$/.exec(item);
    return match ? { label: match[1], value: match[2] } : { label: null, value: item.trim() };
  }

  /** The value of `text` when it is exactly one readable string literal. */
  function literal(text) {
    const trimmed = String(text).trim();
    if (!trimmed) return null;
    const read = readString(trimmed, 0);
    return read && read.end === trimmed.length ? read.value : null;
  }

  /** A literal `[...]` of string literals. `unread` counts entries that are not. */
  function literalList(text) {
    const trimmed = String(text).trim();
    if (!trimmed.startsWith("[")) return null;
    const parsed = segments(trimmed, 0);
    if (parsed.broken) return null;
    const values = [];
    let unread = 0;
    for (const item of parsed.items) {
      const value = literal(item);
      if (value === null) unread++; else values.push(value);
    }
    return { values, unread };
  }

  /** Strip line and nested block comments, preserving offsets and newlines so a
   *  comment can never hide or shift a declaration. Strings are kept verbatim. */
  function stripComments(text) {
    let out = "";
    for (let i = 0; i < text.length;) {
      const char = text[i];
      if (char === '"' || char === "#") {
        const read = readString(text, i);
        if (read) { out += text.slice(i, read.end); i = read.end; continue; }
      }
      if (char === "/" && text[i + 1] === "/") {
        while (i < text.length && text[i] !== "\n") { out += " "; i++; }
        continue;
      }
      if (char === "/" && text[i + 1] === "*") {
        let depth = 0;
        while (i < text.length) {
          if (text[i] === "/" && text[i + 1] === "*") { depth++; out += "  "; i += 2; continue; }
          if (text[i] === "*" && text[i + 1] === "/") { depth--; out += "  "; i += 2; if (depth <= 0) break; continue; }
          out += text[i] === "\n" ? "\n" : " ";
          i++;
        }
        continue;
      }
      out += char;
      i++;
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Manifest reading
  // ---------------------------------------------------------------------------
  /** One `dependencies:` entry of a target. */
  function dependencyOf(item) {
    const text = item.trim();
    const direct = literal(text);
    if (direct !== null) return { kind: "byName", name: direct, source: `"${direct}"` };
    const call = DEPENDENCY_CALL.exec(text);
    if (!call) return { kind: "unread", source: brief(text) };
    const parsed = segments(text, call[0].length - 1);
    if (parsed.broken) return { kind: "unread", source: brief(text) };
    let name = null, packageName = null, positional = null;
    for (const argument of parsed.items) {
      const { label, value } = labeled(argument);
      if (label === "name") name = literal(value);
      else if (label === "package") packageName = literal(value);
      else if (label === null && positional === null) positional = literal(value);
    }
    if (name === null) name = positional;
    if (name === null) return { kind: "unread", source: brief(text) };
    return call[1] === "product"
      ? { kind: "product", name, package: packageName, source: brief(text) }
      : { kind: "byName", name, source: brief(text) };
  }

  /** One `products:` entry: the product name and the targets it exports. */
  function productOf(item) {
    const text = item.trim();
    const call = PRODUCT_CALL.exec(text);
    if (!call) return { unread: `product entry \`${brief(text)}\` is not a literal product declaration` };
    const parsed = segments(text, call[0].length - 1);
    if (parsed.broken) return { unread: `product entry \`${brief(text)}\` has an unbalanced argument list` };
    let name = null, targets = null, targetsUnread = false;
    for (const argument of parsed.items) {
      const { label, value } = labeled(argument);
      if (label === "name") name = literal(value);
      else if (label === "targets") {
        const list = literalList(value);
        if (!list || list.unread) targetsUnread = true; else targets = list.values;
      }
    }
    if (name === null) return { unread: `a product declares a name this reader cannot read literally (\`${brief(text)}\`)` };
    if (targetsUnread || targets === null)
      return { unread: `product "${name}" declares a \`targets:\` list this reader cannot read literally` };
    return { name, targets };
  }

  /** One `targets:` entry. `{ unread }` states why an entry could not be read. */
  function targetOfEntry(item) {
    const text = item.trim();
    const call = TARGET_CALL.exec(text);
    if (!call) return { unread: `target entry \`${brief(text)}\` is not a literal target declaration` };
    const parsed = segments(text, call[0].length - 1);
    if (parsed.broken) return { unread: `target entry \`${brief(text)}\` has an unbalanced argument list` };
    let name = null, path = null, sources = null, sourcesUnread = false;
    let dependencies = [], dependenciesUnread = false;
    // Paths SwiftPM removes from compilation, relative to the target directory:
    // `exclude:` entries and `resources:` rules are exact paths, never globs.
    const exclude = [], resources = []; let excludeUnread = false;
    for (const argument of parsed.items) {
      const { label, value } = labeled(argument);
      if (label === "name") { name = literal(value); continue; }
      if (label === "path") { path = literal(value); if (path === null) sourcesUnread = true; continue; }
      if (label === "sources") {
        const list = literalList(value);
        if (!list || list.unread) sourcesUnread = true; else sources = list.values;
        continue;
      }
      if (label === "exclude") {
        const list = literalList(value);
        if (!list || list.unread) excludeUnread = true; else exclude.push(...list.values);
        continue;
      }
      if (label === "resources") {
        const list = String(value).trim().startsWith("[") ? segments(String(value).trim(), 0) : null;
        if (!list || list.broken) { excludeUnread = true; continue; }
        for (const entry of list.items) {
          const rule = entry.trim(), match = /^\.(?:process|copy|embedInCode)\s*\(/.exec(rule);
          const args = match ? segments(rule, match[0].length - 1) : null;
          const first = args && !args.broken ? args.items[0] : null;
          const resource = first !== null && first !== undefined && !labeled(first).label ? literal(labeled(first).value) : null;
          if (resource === null) excludeUnread = true; else resources.push(resource);
        }
        continue;
      }
      if (label === "dependencies") {
        const list = String(value).trim().startsWith("[") ? segments(String(value).trim(), 0) : null;
        if (!list || list.broken) { dependenciesUnread = true; continue; }
        for (const entry of list.items) {
          const dependency = dependencyOf(entry);
          if (dependency.kind === "unread") dependenciesUnread = true; else dependencies.push(dependency);
        }
      }
    }
    if (name === null) return { unread: `a target declares a name this reader cannot read literally (\`${brief(text)}\`)` };
    return { kind: call[1], name, path, sources, sourcesUnread, dependencies, dependenciesUnread, exclude, resources, excludeUnread };
  }

  /** Index of the `(` that opens the top-level `Package(` call. `.package(` and
   *  `PackageDescription` are different tokens and never match. */
  function findPackageCall(text) {
    const match = /(?:^|[^.\w])Package\s*\(/.exec(text);
    return match ? match.index + match[0].indexOf("(") : -1;
  }

  /** `module <Name>` of a Clang module map, which is what renames a C target's
   *  module. https://clang.llvm.org/docs/Modules.html#module-declaration */
  function moduleMapName(text) {
    if (typeof text !== "string") return null;
    const match = /(?:^|\n)\s*(?:explicit\s+|framework\s+)*module\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(text);
    return match ? match[1] : null;
  }

  /** Read one `Package.swift` as data. An unusable manifest states its reason and
   *  contributes no rule, so the analysis degrades instead of guessing. */
  function parseManifest(manifestPath, text) {
    const dir = dirOf(manifestPath);
    const unusable = reason => ({ manifest: manifestPath, dir, usable: false, reason, targets: [], products: [], localPaths: [], unread: [reason] });
    if (typeof text !== "string") return unusable("the manifest text was not read into this snapshot");
    if (text.length > MAX_MANIFEST_BYTES) return unusable(`the manifest is larger than the ${MAX_MANIFEST_BYTES}-byte reading budget`);
    const clean = stripComments(text);
    const at = findPackageCall(clean);
    if (at < 0) return unusable("no `Package(` declaration could be found in the manifest");
    const parsed = segments(clean, at);
    if (parsed.broken) return unusable("the `Package(` argument list is unbalanced");
    let name = null, targetsValue = null, productsValue = null, dependenciesValue = null;
    for (const argument of parsed.items) {
      const { label, value } = labeled(argument);
      if (label === "name") name = literal(value);
      else if (label === "targets") targetsValue = value;
      else if (label === "products") productsValue = value;
      else if (label === "dependencies") dependenciesValue = value;
    }
    if (targetsValue === null) return unusable("the `Package(` call declares no `targets:` argument");
    const targetItems = String(targetsValue).trim().startsWith("[") ? segments(String(targetsValue).trim(), 0) : null;
    if (!targetItems || targetItems.broken)
      return unusable("the `targets:` value is not a literal array, so the target list cannot be read as data");
    const unread = [];
    const targets = [];
    for (const item of targetItems.items.slice(0, MAX_TARGETS)) {
      const target = targetOfEntry(item);
      if (target.unread) unread.push(target.unread); else targets.push(target);
    }
    if (targetItems.items.length > MAX_TARGETS)
      unread.push(`${targetItems.items.length - MAX_TARGETS} further target entries exceeded the ${MAX_TARGETS}-target reading budget`);
    const products = [];
    if (productsValue !== null) {
      const productItems = String(productsValue).trim().startsWith("[") ? segments(String(productsValue).trim(), 0) : null;
      if (!productItems || productItems.broken) unread.push("the `products:` value is not a literal array");
      else for (const item of productItems.items) {
        const product = productOf(item);
        if (product.unread) unread.push(product.unread); else products.push(product);
      }
    }
    // Only a `.package(path:)` dependency names a package inside this snapshot.
    // A URL or registry dependency is not fetched, so it contributes no module.
    const localPaths = [];
    if (dependenciesValue !== null) {
      const items = String(dependenciesValue).trim().startsWith("[") ? segments(String(dependenciesValue).trim(), 0) : null;
      if (!items || items.broken) unread.push("the package-level `dependencies:` value is not a literal array");
      else for (const item of items.items) {
        const text2 = item.trim();
        if (!PACKAGE_DEPENDENCY.test(text2)) continue;
        const call = segments(text2, text2.indexOf("("));
        if (call.broken) { unread.push(`package dependency \`${brief(text2)}\` has an unbalanced argument list`); continue; }
        for (const argument of call.items) {
          const { label, value } = labeled(argument);
          if (label !== "path") continue;
          const relative = literal(value);
          if (relative === null) { unread.push(`a \`.package(path:)\` dependency states a path this reader cannot read literally`); continue; }
          const joined = manifests.joinPath(dir, relative);
          if (joined === null) unread.push(`the \`.package(path: "${relative}")\` dependency points outside the snapshot root`);
          else localPaths.push(joined);
        }
      }
    }
    return {
      manifest: manifestPath, dir, usable: true, reason: null,
      name: name === null ? baseOf(dir) || dir || "." : name,
      nameUnread: name === null,
      targets, products, localPaths, unread,
    };
  }

  // ---------------------------------------------------------------------------
  // Snapshot index
  // ---------------------------------------------------------------------------
  /** Read every `Package.swift` in `files` (text via `read`) and bind the result
   *  to the snapshot: which target owns which file, which module each target
   *  builds, and which modules a target is allowed to import. */
  function packages(files, read) {
    const paths = [...files];
    const found = manifests.collect(paths, name => name === MANIFEST_NAME).slice(0, MAX_MANIFESTS);
    const list = found.map(entry => {
      try { return parseManifest(entry.path, read(entry.path)); }
      catch (error) {
        const reason = `the manifest could not be read as data (${brief(error && error.message)})`;
        return { manifest: entry.path, dir: entry.dir, usable: false, reason, targets: [], products: [], localPaths: [], unread: [reason] };
      }
    });
    const usable = list.filter(entry => entry.usable);
    const byManifest = new Map(list.map(entry => [entry.manifest, entry]));
    const byDirectory = new Map(list.map(entry => [entry.dir, entry]));

    const directories = new Set([""]);
    for (const path of paths) for (let dir = dirOf(path); dir; dir = dirOf(dir)) directories.add(dir);
    const fileSet = new Set(paths);

    /** SwiftPM's default source directory for a target: the first predefined
     *  directory that exists, else the canonical one so a reason can name it. */
    function defaultBase(pkg, target) {
      const names = PREDEFINED[target.kind] || PREDEFINED.default;
      for (const name of names) {
        const joined = manifests.joinPath(pkg.dir, `${name}/${target.name}`);
        if (joined !== null && directories.has(joined)) return joined;
      }
      return manifests.joinPath(pkg.dir, `${names[0]}/${target.name}`);
    }

    const dirOwners = new Map(), fileOwners = new Map();
    const push = (map, key, target) => { const list2 = map.get(key) || []; list2.push(target); map.set(key, list2); };
    for (const pkg of usable) {
      for (const target of pkg.targets) {
        target.manifest = pkg.manifest;
        target.packageDir = pkg.dir;
        target.files = [];
        target.base = target.path === null ? defaultBase(pkg, target) : manifests.joinPath(pkg.dir, target.path);
        target.roots = target.base === null ? []
          : target.sources === null ? [target.base]
          : target.sources.map(source => manifests.joinPath(target.base, source)).filter(source => source !== null);
        for (const rootPath of target.roots) {
          if (fileSet.has(rootPath)) push(fileOwners, rootPath, target);
          else push(dirOwners, rootPath, target);
        }
      }
    }

    const ownerCache = new Map();
    /** Targets that declare `path` among their sources, restricted to the nearest
     *  enclosing package: a file inside a nested package belongs to that
     *  package's targets, never to an outer target that merely contains it. */
    function ownersOf(path) {
      if (ownerCache.has(path)) return ownerCache.get(path);
      let owners = fileOwners.get(path) || null;
      if (!owners) for (let dir = dirOf(path); ; dir = dirOf(dir)) {
        const hit = dirOwners.get(dir);
        if (hit) { owners = hit; break; }
        if (!dir) break;
      }
      const home = manifests.nearest(usable, path);
      const kept = (owners || []).filter(target => !home || target.packageDir === home.dir);
      ownerCache.set(path, kept);
      return kept;
    }
    const targetOf = path => { const owners = ownersOf(path); return owners.length === 1 ? owners[0] : null; };

    // A manifest is not a target source, and neither is a version-specific one.
    // https://github.com/swiftlang/swift-package-manager/blob/main/Documentation/Usage.md
    for (const path of paths) {
      const name = baseOf(path);
      if (name === MANIFEST_NAME || VERSIONED_MANIFEST.test(name)) continue;
      const owner = targetOf(path);
      if (owner) owner.files.push(path);
    }
    for (const pkg of usable) for (const target of pkg.targets) target.files.sort();

    const moduleCache = new Map();
    /** A package's two name spaces, which are not the same one:
     *  `byTarget` is what a `dependencies:` entry or a product's `targets:` list
     *  names, and `byModule` is what `import` names. A Clang module map renames
     *  the module — `module CShim` in `Sources/CShimTarget/include/module.modulemap`
     *  makes the module `CShim` while the target stays `CShimTarget` — so the two
     *  differ exactly when a map says so.
     *  https://clang.llvm.org/docs/Modules.html#module-declaration */
    function modulesOf(pkg) {
      if (moduleCache.has(pkg.manifest)) return moduleCache.get(pkg.manifest);
      const byTarget = new Map(), byModule = new Map();
      for (const target of pkg.targets) {
        if (!byTarget.has(target.name)) byTarget.set(target.name, target);
        const map = target.files.find(file => baseOf(file) === "module.modulemap");
        target.moduleMap = map || null;
        target.moduleMapName = map ? moduleMapName(read(map)) : null;
        target.module = target.moduleMapName || target.name;
        if (!byModule.has(target.module)) byModule.set(target.module, target);
      }
      const names = Object.freeze({ byTarget, byModule });
      moduleCache.set(pkg.manifest, names);
      return names;
    }

    /** Local packages this one declares a `.package(path:)` dependency on. */
    const localPackagesOf = pkg => pkg.localPaths
      .map(dir => byDirectory.get(dir))
      .filter(entry => entry && entry.usable);
    /** SwiftPM identifies a local package by its directory name, and `name:` is
     *  the legacy spelling of the same identity. Both are matched, case-insensitively. */
    function packageNamed(pkg, name) {
      const wanted = String(name || "").toLowerCase();
      const locals = localPackagesOf(pkg);
      if (!name) return locals;
      return locals.filter(entry => String(entry.name).toLowerCase() === wanted || baseOf(entry.dir).toLowerCase() === wanted);
    }

    /** Every module `target` is allowed to import, with the manifest text that
     *  declares the edge. A module missing from this map is a compile error in
     *  Swift, which is why it is never bound. */
    const visibleCache = new Map();
    function visibleFrom(target) {
      const key = `${target.manifest}\0${target.name}`;
      if (visibleCache.has(key)) return visibleCache.get(key);
      const pkg = byManifest.get(target.manifest);
      const visible = new Map();
      const own = modulesOf(pkg);
      /** One dependency edge makes the depended-on target importable, under the
       *  module's own name rather than the target's. `modulesOf` is what sets
       *  `module`, so it must have run for the target's package first. */
      const admit = (dependent, via) => {
        modulesOf(byManifest.get(dependent.manifest));
        visible.set(dependent.module, { target: dependent, via });
      };
      for (const dependency of target.dependencies) {
        if (dependency.kind === "byName") {
          const local = own.byTarget.get(dependency.name);
          if (local) { admit(local, `target "${target.name}" dependencies: ${dependency.source}`); continue; }
          // An unqualified name may also name a product of a dependency package.
          for (const other of localPackagesOf(pkg)) {
            const product = other.products.find(entry => entry.name === dependency.name);
            if (!product) continue;
            for (const name of product.targets) {
              const exported = modulesOf(other).byTarget.get(name);
              if (exported) admit(exported, `target "${target.name}" dependencies: ${dependency.source} -> ${other.manifest} product "${product.name}" targets ["${product.targets.join('", "')}"]`);
            }
          }
          continue;
        }
        for (const other of packageNamed(pkg, dependency.package)) {
          const product = other.products.find(entry => entry.name === dependency.name);
          if (!product) continue;
          for (const name of product.targets) {
            const exported = modulesOf(other).byTarget.get(name);
            if (exported) admit(exported, `target "${target.name}" dependencies: .product(name: "${dependency.name}", package: "${dependency.package ?? ""}") -> ${other.manifest} product "${product.name}" targets ["${product.targets.join('", "')}"]`);
          }
        }
      }
      visibleCache.set(key, visible);
      return visible;
    }

    /** Is `name` a module of this package, or of a local package it depends on?
     *  Used only to tell "you forgot a dependency" from "this module is not in
     *  the snapshot at all"; it never authorizes a binding by itself. */
    function anyModule(pkg, name) {
      const own = modulesOf(pkg).byModule.get(name);
      if (own) return own;
      for (const other of localPackagesOf(pkg)) {
        const exported = modulesOf(other).byModule.get(name);
        if (exported) return exported;
      }
      return null;
    }

    /** Unread entries of this package and of every local package it depends on:
     *  an absent module is only evidence when the whole target list was read. */
    function unreadAround(pkg) {
      const reasons = [...pkg.unread];
      for (const other of localPackagesOf(pkg)) reasons.push(...other.unread);
      for (const dir of pkg.localPaths) {
        const entry = byDirectory.get(dir);
        if (!entry) reasons.push(`the \`.package(path: "${dir}")\` dependency has no ${MANIFEST_NAME} in this snapshot`);
        else if (!entry.usable) reasons.push(`${entry.manifest}: ${entry.reason}`);
      }
      return reasons;
    }

    /** The files that make up a target's module: its Swift sources, or, for a
     *  Clang target, its compiled sources and headers. */
    function moduleFiles(target) {
      const swift = target.files.filter(file => SWIFT_SOURCE.test(file));
      if (swift.length) return swift;
      return target.files.filter(file => CLANG_SOURCE.test(file) || CLANG_HEADER.test(file));
    }

    return Object.freeze({
      list, usable, targetOf, ownersOf, modulesOf, visibleFrom, anyModule,
      unreadAround, moduleFiles, localPackagesOf, packageNamed,
      packageOf: path => manifests.nearest(usable, path),
      /** The module a target builds: its name, or the name its Clang module map
       *  declares. Reading the maps is what sets it, so force that first. */
      moduleNameOf: target => { modulesOf(byManifest.get(target.manifest)); return target.module; },
    });
  }

  // ---------------------------------------------------------------------------
  // Family
  // ---------------------------------------------------------------------------
  manifests.register({
    id: "project-swift",
    forms: ["swift-import"],
    create(context) {
      const { verdicts } = context;
      let index = null, built = false;
      /** Built once per snapshot: the corpus gate analyzes whole checkouts, so a
       *  per-fact reparse of every manifest would be a defect. A manifest this
       *  reader cannot read leaves `index` without a usable package, and the
       *  resolver then abstains entirely. */
      function build() {
        if (built) return index;
        built = true;
        try { index = packages(context.files, context.textOf); }
        catch { index = null; }
        return index;
      }

      /** No defect in this reader may end an analysis: a throw degrades to
       *  `null`, and the weaker basename search answers as it did before. */
      function resolve(path, fact) {
        if (fact.form !== "swift-import") return null;
        try { return decide(path, fact); } catch { return null; }
      }

      function decide(path, fact) {
        const snapshot = build();
        if (!snapshot || !snapshot.usable.length) return null;
        const pkg = snapshot.packageOf(path);
        if (!pkg) return null;
        const specifier = String(fact.specifier || "").trim();
        // `import Foo.Bar` imports a declaration of module `Foo`; the module is
        // the first component. https://docs.swift.org/swift-book/documentation/the-swift-programming-language/declarations/#Import-Declaration
        const module = specifier.split(".")[0];
        if (!MODULE_NAME.test(module)) return null;

        const partlyUnread = () => {
          const reasons = snapshot.unreadAround(pkg);
          return reasons.length
            ? verdicts.unresolved(`\`import ${module}\` matches no readable target, and ${reasons.length} manifest entr${reasons.length === 1 ? "y" : "ies"} around ${pkg.manifest} could not be read as data: ${reasons[0]}`, "swift-package-targets-partly-unread")
            : null;
        };
        const external = () => verdicts.unresolved(
          `"${module}" is not a target of ${pkg.manifest} or of a local package it depends on, so it is a module outside this snapshot; its contents were not fetched`,
          "swift-module-outside-package",
          { external: { name: module, kind: "module", specifier: specifier } });

        const owners = snapshot.ownersOf(path);
        if (owners.length > 1) return verdicts.unresolved(
          `${owners.length} targets of ${pkg.manifest} declare source directories containing ${path} (${owners.map(target => `"${target.name}"`).join(", ")}), so the module this file belongs to is ambiguous`,
          "swift-target-ownership-ambiguous");
        const owner = owners[0] || null;
        if (!owner) {
          if (snapshot.anyModule(pkg, module)) return verdicts.unresolved(
            `${path} is not inside any target's sources declared by ${pkg.manifest}, so no target dependency can prove \`import ${module}\``,
            "swift-file-outside-declared-targets");
          // A file no target compiles cannot bind whatever the unread entries say,
          // so the module is reported as the out-of-snapshot reference it is.
          return external();
        }

        if (module === snapshot.moduleNameOf(owner)) return verdicts.unresolved(
          `${path} is already part of module "${module}" (target "${owner.name}" of ${owner.manifest}), and Swift ignores an import of the declaring module`,
          "swift-self-module-import");

        const hit = snapshot.visibleFrom(owner).get(module);
        if (!hit) {
          if (owner.dependenciesUnread) return verdicts.unresolved(
            `target "${owner.name}" of ${owner.manifest} declares a \`dependencies:\` entry this reader cannot read literally, so \`import ${module}\` can be neither proved nor refused`,
            "swift-target-dependencies-unread");
          if (snapshot.anyModule(pkg, module)) return verdicts.unresolved(
            `"${module}" is a target reachable from ${pkg.manifest}, but target "${owner.name}" does not declare it in \`dependencies:\`, and Swift cannot import an undeclared module`,
            "swift-target-dependency-not-declared");
          return partlyUnread() || external();
        }

        const target = hit.target;
        const proof = {
          manifest: target.manifest,
          target: target.name,
          importer: `${owner.name} (${owner.manifest})`,
          dependency: hit.via,
          sources: target.roots.join(", ") || "none",
          ...(target.moduleMapName === module ? { moduleMap: target.moduleMap } : {}),
        };
        if (target.kind === "systemLibrary") return verdicts.unresolved(
          `"${module}" is the \`.systemLibrary\` target "${target.name}" of ${target.manifest}: it names a module the host system provides, and no source file in this snapshot implements it`,
          "swift-system-library-target",
          { external: { name: module, kind: "system-module", specifier: specifier } });
        if (target.kind === "binaryTarget") return verdicts.unresolved(
          `"${module}" is the \`.binaryTarget\` "${target.name}" of ${target.manifest}: its module ships as a prebuilt artifact that was not fetched`,
          "swift-binary-target",
          { external: { name: module, kind: "binary-module", specifier: specifier } });
        if (target.sourcesUnread) return verdicts.unresolved(
          `target "${target.name}" of ${target.manifest} declares a \`path:\`/\`sources:\` value this reader cannot read literally, so the file set of module "${module}" is unknown`,
          "swift-target-sources-unread");
        if (target.base === null) return verdicts.unresolved(
          `target "${target.name}" of ${target.manifest} declares a source path outside the snapshot root`,
          "swift-target-path-outside-root");

        const members = snapshot.moduleFiles(target);
        if (members.length === 1) return verdicts.resolved(members, "swift-package-target-single-source", proof);
        if (members.length > 1) return verdicts.candidate(
          members, "swift-package-target-module-files",
          `\`import ${module}\` names target "${target.name}" of ${target.manifest}, whose ${members.length} source files are compiled into one module; a Swift module is a directory of files, so no single file is the module.`,
          proof);
        return verdicts.unresolved(
          `target "${target.name}" of ${target.manifest} declares no source file in this snapshot (${target.roots.join(", ") || "no source directory"}), so module "${module}" has no file to bind`,
          "swift-target-without-sources");
      }

      return resolve;
    },
  });

  root.SkylenseProjectSwift = Object.freeze({
    packages, parseManifest, moduleMapName,
    readString, segments, literal, literalList, stripComments,
  });
})(typeof window !== "undefined" ? window : globalThis);
