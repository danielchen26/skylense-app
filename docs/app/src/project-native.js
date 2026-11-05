/* C and C++ project binding from the compilation database and CMake include directories.
 *
 * A `#include` is not a name lookup. The preprocessor walks an ordered list of
 * directories and takes the first one that holds the *spelled* path, so the only
 * honest way to bind `#include "util.h"` is to know that list. This family reads
 * it from two data files and nothing else:
 *
 *   compile_commands.json  the per-file command line, i.e. `-I`, `-iquote`,
 *                          `-isystem`, `-idirafter` (and MSVC `/I`) plus the
 *                          `-D`/`-U` macro flags, which are recorded in the proof
 *                          and never evaluated.
 *                          https://clang.llvm.org/docs/JSONCompilationDatabase.html
 *   CMakeLists.txt         `include_directories`, `target_include_directories`,
 *                          `add_executable`/`add_library` source lists and
 *                          `add_subdirectory`, with literal relative paths and
 *                          `${CMAKE_CURRENT_SOURCE_DIR}`/`${CMAKE_CURRENT_LIST_DIR}`.
 *                          https://cmake.org/cmake/help/latest/command/target_include_directories.html
 *
 * Search order, per the GCC and Clang preprocessor documentation
 * (https://gcc.gnu.org/onlinedocs/cpp/Search-Path.html):
 *   quoted form  `"…"`  the including file's own directory, then `-iquote`, then
 *                       every `-I`, every `-isystem`, then `-idirafter` — each list
 *                       in command order, the lists in this order whatever the
 *                       command line interleaves — then the CMake directories in scope.
 *   angle form   `<…>`  the same lists without `-iquote`, and the CMake
 *                       directories — never the including file's directory.
 * The first directory that contains the spelled path wins. There is no basename
 * search and no fallback: when the list is exhausted the relation is unresolved
 * with the searched directories named, and an angle include additionally records
 * an out-of-snapshot system-header reference. A header found only after an
 * include directory outside the snapshot is a candidate: that directory may hold
 * the copy the compiler opens.
 *
 * What this family does NOT do: it does not preprocess, does not evaluate macros
 * or `#if`, does not pick a conditional-compilation branch, and never reads a
 * system include root outside the snapshot. Nothing is executed; the manifests
 * are read as data. A manifest that cannot be read yields no scope rather than a
 * guessed one, so the file falls back to the weaker path search that ran before. */
(function (root) {
  "use strict";

  const manifests = root.SkylenseProjectManifests;
  if (!manifests) throw new Error("src/project-manifests.js must load before this family.");

  const DATABASE_NAME = "compile_commands.json";
  const CMAKE_NAME = "CMakeLists.txt";
  /* Bounds. A decoded manifest longer than 1 MiB of text is skipped: UTF-8 byte
     length is never below the UTF-16 code-unit count, so this is a conservative
     1 MiB byte cap that costs no re-encoding. */
  const MAX_MANIFEST_TEXT = 1024 * 1024;
  const MAX_MANIFESTS = 2000;
  const MAX_ENTRIES = 20000;
  const MAX_REASON_DIRECTORIES = 12;

  const ABSOLUTE = /^(?:\/|[A-Za-z]:[\\/])/;
  const isAbsolute = value => ABSOLUTE.test(String(value || ""));
  /** Canonical absolute form: forward slashes, `.` and `..` folded, no trailing slash. */
  function canonical(value) {
    const raw = String(value || "").replace(/\\/g, "/");
    const drive = /^[A-Za-z]:\//.test(raw) ? raw.slice(0, 2) : "";
    const parts = [];
    for (const segment of raw.slice(drive.length).split("/")) {
      if (!segment || segment === ".") continue;
      if (segment === "..") { parts.pop(); continue; }
      parts.push(segment);
    }
    return drive + "/" + parts.join("/");
  }
  /** `absolute` expressed relative to `base`, or null when it is not inside it. */
  function under(base, absolute) {
    if (typeof base !== "string" || !base) return null;
    if (absolute === base) return "";
    const prefix = base.endsWith("/") ? base : base + "/";
    return absolute.startsWith(prefix) ? absolute.slice(prefix.length) : null;
  }

  // ---------------------------------------------------------------------------
  // Compile command lines
  // ---------------------------------------------------------------------------
  /** Split a compile command the way a POSIX shell would, honouring quotes and
   *  backslash escapes. No variable expansion, no globbing, no execution. */
  function tokenize(command) {
    const text = String(command || ""), tokens = [];
    let current = "", quote = null, started = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quote) {
        if (quote === '"' && char === "\\" && i + 1 < text.length) { current += text[++i]; continue; }
        if (char === quote) { quote = null; continue; }
        current += char; continue;
      }
      if (char === '"' || char === "'") { quote = char; started = true; continue; }
      if (char === "\\" && i + 1 < text.length) { current += text[++i]; started = true; continue; }
      if (/\s/.test(char)) { if (started || current) tokens.push(current); current = ""; started = false; continue; }
      current += char; started = true;
    }
    if (started || current) tokens.push(current);
    return tokens;
  }

  /* Longest spelling first so `-isystem` is never read as `-I` plus a value. The
     `list` is the preprocessor list the directory joins. */
  const PATH_FLAGS = [
    { flag: "-idirafter", list: "idirafter", msvc: false },
    { flag: "-isystem", list: "isystem", msvc: false },
    { flag: "-iquote", list: "iquote", msvc: false },
    { flag: "-I", list: "I", msvc: false },
    { flag: "/I", list: "I", msvc: true },
  ];
  const MACRO_FLAGS = [
    { flag: "-D", msvc: false }, { flag: "-U", msvc: false },
    { flag: "/D", msvc: true }, { flag: "/U", msvc: true },
  ];
  /* MSVC spells its flags with a leading slash, which is indistinguishable from
     an absolute POSIX path (`/Users/...` would read as `/U sers/...`). Slash
     flags are therefore honoured only when the driver is cl or clang-cl. */
  const MSVC_DRIVER = /(?:^|\/)(?:cl|clang-cl)(?:\.exe)?$/i;

  /** Include-directory and macro flags of one command line, in command order. */
  function flagsOf(tokens) {
    const msvc = MSVC_DRIVER.test(String(tokens[0] || "").replace(/\\/g, "/"));
    const includes = [], macros = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      let handled = false;
      for (const spec of PATH_FLAGS) {
        if (spec.msvc && !msvc) continue;
        if (!token.startsWith(spec.flag)) continue;
        handled = true;
        const inline = token.slice(spec.flag.length);
        const value = inline || (i + 1 < tokens.length ? tokens[++i] : "");
        if (value) includes.push({ flag: spec.flag, list: spec.list, raw: value });
        break;
      }
      if (handled) continue;
      for (const spec of MACRO_FLAGS) {
        if (spec.msvc && !msvc) continue;
        if (!token.startsWith(spec.flag)) continue;
        handled = true;
        const inline = token.slice(spec.flag.length);
        const value = inline || (i + 1 < tokens.length ? tokens[++i] : "");
        if (value) macros.push("-" + spec.flag.slice(1) + value);
        break;
      }
    }
    return { includes, macros };
  }

  // ---------------------------------------------------------------------------
  // CMake language subset
  // ---------------------------------------------------------------------------
  /** Drop `#` comments that are not inside a quoted argument. */
  function stripCmakeComments(text) {
    let out = "", quote = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quote) {
        if (char === "\\") { out += char + (text[++i] ?? ""); continue; }
        if (char === '"') quote = false;
        out += char; continue;
      }
      if (char === '"') { quote = true; out += char; continue; }
      if (char === "#") { while (i < text.length && text[i] !== "\n") i++; out += "\n"; continue; }
      out += char;
    }
    return out;
  }
  /** Whitespace-separated arguments of one command, honouring quoted arguments. */
  function cmakeArgs(body) {
    const args = [];
    let current = "", quote = false, started = false;
    for (let i = 0; i < body.length; i++) {
      const char = body[i];
      if (quote) {
        if (char === "\\") { current += body[++i] ?? ""; continue; }
        if (char === '"') { quote = false; continue; }
        current += char; continue;
      }
      if (char === '"') { quote = true; started = true; continue; }
      if (/\s/.test(char)) { if (started || current) args.push(current); current = ""; started = false; continue; }
      current += char; started = true;
    }
    if (started || current) args.push(current);
    return args;
  }
  /** `name(arg …)` commands with balanced parentheses, lower-cased names.
   *  An unterminated command ends the read: half a command is not a command. */
  function cmakeCommands(text) {
    const source = stripCmakeComments(String(text || ""));
    const pattern = /([A-Za-z_][A-Za-z0-9_]*)[ \t]*\(/g;
    const out = [];
    let match;
    while ((match = pattern.exec(source))) {
      let depth = 1, i = pattern.lastIndex, quote = false;
      for (; i < source.length && depth; i++) {
        const char = source[i];
        if (quote) { if (char === "\\") i++; else if (char === '"') quote = false; continue; }
        if (char === '"') { quote = true; continue; }
        if (char === "(") depth++;
        else if (char === ")") depth--;
      }
      if (depth) break;
      out.push({ name: match[1].toLowerCase(), args: cmakeArgs(source.slice(pattern.lastIndex, i - 1)) });
      pattern.lastIndex = i;
    }
    return out;
  }
  const CMAKE_INCLUDE_KEYWORDS = new Set(["SYSTEM", "BEFORE", "AFTER", "PRIVATE", "PUBLIC", "INTERFACE"]);
  const CMAKE_TARGET_KEYWORDS = new Set([
    "STATIC", "SHARED", "MODULE", "OBJECT", "INTERFACE", "ALIAS", "IMPORTED", "UNKNOWN",
    "GLOBAL", "EXCLUDE_FROM_ALL", "WIN32", "MACOSX_BUNDLE",
  ]);

  // ---------------------------------------------------------------------------
  // Index
  // ---------------------------------------------------------------------------
  /** Build the include-search index for one snapshot.
   *  `files` is the included path list, `read(path)` returns decoded text or null.
   *  Pure: no I/O beyond `read`, and the same input always yields the same index. */
  function database(files, read) {
    const known = new Set(files);
    const has = path => Boolean(path) && known.has(path);
    const dirOf = manifests.dirOf, joinPath = manifests.joinPath, contains = manifests.contains;
    const found = manifests.collect(files, name => name === DATABASE_NAME || name === CMAKE_NAME).slice(0, MAX_MANIFESTS);
    const notes = [];
    const byFile = new Map();
    const cmakeDirectories = new Map();   // CMakeLists dir -> { include: [...], subdirectories: [dir] }
    const cmakeTargets = [];              // { name, dir, manifest, sources: Set, complete, include: [...] }

    const bounded = path => {
      const text = read(path);
      if (typeof text !== "string") return null;
      if (text.length > MAX_MANIFEST_TEXT) { notes.push(`${path} exceeds the 1 MiB manifest cap and was not read`); return null; }
      return text;
    };

    for (const manifest of found) {
      const text = bounded(manifest.path);
      if (text === null) continue;
      if (manifest.name === DATABASE_NAME) readDatabase(manifest, text);
      else readCmake(manifest, text);
    }

    /** One compilation database. Entries name absolute build-machine paths, so the
     *  snapshot root is anchored first and every path is then expressed relative
     *  to it; anything that falls outside stays recorded as unavailable. */
    function readDatabase(manifest, text) {
      const parsed = manifests.parseJson(text);
      if (!Array.isArray(parsed)) { notes.push(`${manifest.path} is not a JSON array of compile commands`); return; }
      const raw = [];
      for (const item of parsed) {
        if (raw.length >= MAX_ENTRIES) { notes.push(`${manifest.path} has more than ${MAX_ENTRIES} entries; the rest were not read`); break; }
        if (!item || typeof item !== "object" || typeof item.file !== "string" || !item.file) continue;
        const directory = typeof item.directory === "string" ? item.directory : "";
        const directoryAbsolute = isAbsolute(directory) ? canonical(directory) : null;
        const fileAbsolute = isAbsolute(item.file)
          ? canonical(item.file)
          : directoryAbsolute ? canonical(directoryAbsolute + "/" + item.file) : null;
        const tokens = Array.isArray(item.arguments)
          ? item.arguments.filter(value => typeof value === "string")
          : typeof item.command === "string" ? tokenize(item.command) : null;
        if (!tokens) { notes.push(`${manifest.path} entry for ${item.file} has neither a command string nor an arguments array`); continue; }
        raw.push({ directory, directoryAbsolute, fileAbsolute, tokens, spelled: item.file });
      }
      if (!raw.length) return;

      /* Root anchor. Two independent derivations vote: the database's own
         directory inside the snapshot against an entry's `directory`, and the
         longest suffix of an entry's `file` that is an included path. The winner
         is the prefix under which the most entries name included files, so an
         anchor is only accepted because it maps real snapshot paths. */
      const candidates = new Set();
      for (const entry of raw) {
        if (entry.directoryAbsolute) {
          if (!manifest.dir) candidates.add(entry.directoryAbsolute);
          else if (entry.directoryAbsolute.endsWith("/" + manifest.dir)) candidates.add(entry.directoryAbsolute.slice(0, -(manifest.dir.length + 1)) || "/");
        }
        if (!entry.fileAbsolute) continue;
        const segments = entry.fileAbsolute.replace(/^[A-Za-z]:\//, "").replace(/^\//, "").split("/");
        for (let i = 0; i < segments.length; i++) {
          const suffix = segments.slice(i).join("/");
          if (!has(suffix)) continue;
          candidates.add(entry.fileAbsolute.slice(0, entry.fileAbsolute.length - suffix.length).replace(/\/$/, "") || "/");
          break;
        }
      }
      let anchor = null, best = -1;
      for (const candidate of [...candidates].sort((a, b) => b.length - a.length || a.localeCompare(b))) {
        let score = 0;
        for (const entry of raw) {
          if (!entry.fileAbsolute) continue;
          const relative = under(candidate, entry.fileAbsolute);
          if (relative !== null && has(relative)) score++;
        }
        if (score > best) { best = score; anchor = candidate; }
      }
      if (!anchor || best <= 0) { notes.push(`${manifest.path} names no included source file; no snapshot root could be anchored to it`); return; }

      for (const entry of raw) {
        const file = entry.fileAbsolute === null ? null : under(anchor, entry.fileAbsolute);
        if (file === null || !has(file)) continue;
        const buildDir = entry.directoryAbsolute === null ? null : under(anchor, entry.directoryAbsolute);
        const { includes, macros } = flagsOf(entry.tokens);
        const directories = includes.map(include => placeFlagDirectory(include, anchor, buildDir, entry, manifest.path));
        const record = { file, manifest: manifest.path, buildDirectory: buildDir, spelled: entry.spelled, macros, directories };
        const list = byFile.get(file) || [];
        list.push(record);
        byFile.set(file, list);
      }
    }

    /** One `-I`-family flag placed inside the snapshot, or recorded as unavailable. */
    function placeFlagDirectory(include, anchor, buildDir, entry, manifestPath) {
      const base = { flag: include.flag, list: include.list, origin: include.list, raw: include.raw, manifest: manifestPath, evidence: `${include.flag}${include.raw}` };
      if (isAbsolute(include.raw)) {
        const absolute = canonical(include.raw);
        const relative = under(anchor, absolute);
        if (relative === null)
          return { ...base, dir: null, available: false, reason: `${include.flag}${include.raw} names ${absolute}, which is outside this snapshot; its headers were not collected` };
        return { ...base, dir: relative, available: true };
      }
      if (buildDir === null)
        return { ...base, dir: null, available: false, reason: `${include.flag}${include.raw} is relative to the build directory ${entry.directory || "(unstated)"}, which is not placed inside this snapshot` };
      const joined = joinPath(buildDir, include.raw);
      if (joined === null)
        return { ...base, dir: null, available: false, reason: `${include.flag}${include.raw} resolves outside the snapshot root from ${buildDir || "the snapshot root"}` };
      return { ...base, dir: joined, available: true };
    }

    /** One CMakeLists.txt: directory includes, target includes, target sources, subdirectories. */
    function readCmake(manifest, text) {
      const dir = manifest.dir;
      const scope = cmakeDirectories.get(dir) || { include: [], subdirectories: [] };
      cmakeDirectories.set(dir, scope);
      for (const command of cmakeCommands(text)) {
        if (command.name === "include_directories") {
          for (const arg of command.args) {
            if (CMAKE_INCLUDE_KEYWORDS.has(arg)) continue;
            scope.include.push(placeCmakeDirectory(arg, dir, manifest.path, "cmake-include-directories", null));
          }
          continue;
        }
        if (command.name === "target_include_directories") {
          const name = command.args[0];
          if (!name) continue;
          const target = targetFor(name, dir, manifest.path);
          for (const arg of command.args.slice(1)) {
            if (CMAKE_INCLUDE_KEYWORDS.has(arg)) continue;
            target.include.push(placeCmakeDirectory(arg, dir, manifest.path, "cmake-target-include-directories", name));
          }
          continue;
        }
        if (command.name === "add_executable" || command.name === "add_library") {
          const name = command.args[0];
          if (!name) continue;
          const target = targetFor(name, dir, manifest.path);
          for (const arg of command.args.slice(1)) {
            if (CMAKE_TARGET_KEYWORDS.has(arg)) continue;
            if (/[$*?]/.test(arg)) { target.complete = false; continue; }
            const joined = isAbsolute(arg) ? null : joinPath(dir, arg);
            if (joined === null) { target.complete = false; continue; }
            if (has(joined)) target.sources.add(joined);
          }
          continue;
        }
        if (command.name === "add_subdirectory") {
          const arg = command.args[0];
          if (!arg || /[$*?]/.test(arg) || isAbsolute(arg)) continue;
          const joined = joinPath(dir, arg);
          if (joined !== null) scope.subdirectories.push(joined);
        }
      }
    }
    function targetFor(name, dir, manifestPath) {
      let target = cmakeTargets.find(item => item.name === name && item.dir === dir);
      if (!target) { target = { name, dir, manifest: manifestPath, sources: new Set(), complete: true, include: [] }; cmakeTargets.push(target); }
      return target;
    }
    /** A CMake include-directory argument. A generator expression or an unexpanded
     *  variable is recorded as unresolved; it is never guessed at. */
    function placeCmakeDirectory(arg, dir, manifestPath, origin, target) {
      const command = origin === "cmake-target-include-directories" ? "target_include_directories" : "include_directories";
      const base = { flag: command, list: "I", origin, raw: arg, manifest: manifestPath, ...(target ? { target } : {}), evidence: `${command}(${target ? target + " " : ""}${arg}) in ${manifestPath}` };
      if (arg.includes("$<"))
        return { ...base, dir: null, available: false, reason: `${base.flag} in ${manifestPath} lists the generator expression ${arg}, whose value is chosen by CMake at generate time and is not evaluated here` };
      const substituted = arg.replace(/\$\{CMAKE_CURRENT_SOURCE_DIR\}|\$\{CMAKE_CURRENT_LIST_DIR\}/g, dir || ".");
      if (substituted.includes("${"))
        return { ...base, dir: null, available: false, reason: `${base.flag} in ${manifestPath} lists ${arg}, which contains a CMake variable this reader does not expand` };
      if (isAbsolute(substituted))
        return { ...base, dir: null, available: false, reason: `${base.flag} in ${manifestPath} lists the absolute path ${substituted}, which cannot be placed inside this snapshot` };
      const anchoredAtRoot = /^\$\{CMAKE_CURRENT_(?:SOURCE|LIST)_DIR\}/.test(arg);
      const joined = joinPath(anchoredAtRoot ? "" : dir, substituted);
      if (joined === null)
        return { ...base, dir: null, available: false, reason: `${base.flag} in ${manifestPath} lists ${arg}, which resolves outside the snapshot root` };
      return { ...base, dir: joined, available: true };
    }

    /* CMake scope of one file. `include_directories` is a directory property
       inherited by subdirectories, so the outermost governing CMakeLists
       contributes first; `target_include_directories` is appended only for the
       targets that actually list the file as a source, which is why a
       same-directory file belonging to no target gains nothing from a PRIVATE
       include path.

       The directory trees each CMakeLists governs are computed once — a
       CMakeLists governs its own directory plus the `add_subdirectory` closure,
       which may reach a sibling tree — and the per-file answer is memoized. Both
       matter: the corpus gate analyzes whole checkouts and this runs per fact. */
    let governed = null;
    function governedTrees() {
      if (governed) return governed;
      governed = [];
      for (const [dir, scope] of cmakeDirectories) {
        const roots = new Set([dir]), queue = [...scope.subdirectories];
        while (queue.length) {
          const next = queue.shift();
          if (roots.has(next)) continue;
          roots.add(next);
          const child = cmakeDirectories.get(next);
          if (child) queue.push(...child.subdirectories);
        }
        governed.push({ dir, depth: dir.split("/").filter(Boolean).length, roots: [...roots] });
      }
      governed.sort((a, b) => a.depth - b.depth || a.dir.localeCompare(b.dir));
      return governed;
    }
    const scopeCache = new Map();
    function cmakeScope(path) {
      const cached = scopeCache.get(path);
      if (cached) return cached;
      const list = [];
      for (const entry of governedTrees())
        if (entry.roots.some(dir => contains(dir, path))) list.push(...cmakeDirectories.get(entry.dir).include);
      for (const target of cmakeTargets) if (target.sources.has(path)) list.push(...target.include);
      scopeCache.set(path, list);
      return list;
    }

    /** Ordered include search path for `path`. `null` when no manifest covers the
     *  file at all — the required answer for a snapshot without these build files.
     *  Returns one scope per compilation-database entry, since two commands for
     *  the same file may disagree. */
    function searchPath(path, quoted) {
      const entries = byFile.get(path) || [];
      const cmake = cmakeScope(path);
      if (!entries.length && !cmake.length) return null;
      const own = { flag: null, list: "current-directory", origin: "current-directory", raw: null, dir: dirOf(path), available: true, manifest: null, evidence: "the including file's own directory" };
      if (!entries.length) {
        return [{ manifest: cmake[0].manifest, entry: null, macros: [], directories: [...(quoted ? [own] : []), ...cmake] }];
      }
      /* GCC and Clang search -iquote (quoted form only), then every -I, then every
         -isystem, then the system directories, then -idirafter — whatever the order
         the flags appear in on the command line. The sort is stable, so each list
         keeps its own command order. Both drivers then drop duplicates: an -I that
         names a directory also given as -isystem or -idirafter is ignored (the
         directory is searched at its system position), and a directory repeated in
         the -I/-isystem/-idirafter chain is searched only where it first appears.
         https://gcc.gnu.org/onlinedocs/cpp/Invocation.html#index-I */
      const RANK = { iquote: 0, I: 1, isystem: 2, idirafter: 3 };
      return entries.map(entry => {
        const system = new Set(entry.directories.filter(item => item.available && (item.list === "isystem" || item.list === "idirafter")).map(item => item.dir));
        const chain = new Set();
        const flagged = entry.directories.filter(item => (quoted || item.list !== "iquote") && !(item.list === "I" && item.available && system.has(item.dir)))
          .map((item, index) => ({ item, index })).sort((a, b) => (RANK[a.item.list] ?? 4) - (RANK[b.item.list] ?? 4) || a.index - b.index).map(({ item }) => item)
          .filter(item => {
            if (item.list === "iquote" || !item.available) return true;
            if (chain.has(item.dir)) return false;
            chain.add(item.dir);
            return true;
          });
        return {
          manifest: entry.manifest, entry, macros: entry.macros,
          directories: [...(quoted ? [own] : []), ...flagged, ...cmake],
        };
      });
    }

    return { files: known, has, byFile, cmakeDirectories, cmakeTargets, notes, searchPath, cmakeScope };
  }

  // ---------------------------------------------------------------------------
  // Family
  // ---------------------------------------------------------------------------
  const RULES = {
    "current-directory": "c-include-quoted-current-directory",
    iquote: "c-include-compile-database-iquote-path",
    I: "c-include-compile-database-include-path",
    isystem: "c-include-compile-database-system-path",
    idirafter: "c-include-compile-database-idirafter-path",
    "cmake-include-directories": "c-include-cmake-include-directories",
    "cmake-target-include-directories": "c-include-cmake-target-include-directories",
  };
  const label = dir => (dir ? dir : "the snapshot root");
  /** A bounded, de-duplicated prose list: an abstention names its cause without
   *  turning into an unbounded transcript of the search path. */
  const listOf = (values, cap = MAX_REASON_DIRECTORIES) => {
    const unique = [...new Set(values)];
    return unique.length > cap
      ? unique.slice(0, cap).join(", ") + ` and ${unique.length - cap} more`
      : unique.join(", ");
  };

  manifests.register({
    id: "project-native",
    forms: ["c-include"],
    create(context) {
      const { verdicts, joinPath, has, dirOf, contains } = context;
      let index = null, built = false;
      /** Built once per snapshot: the corpus gate analyzes whole checkouts, so a
       *  per-fact reparse would be a defect. A parse failure degrades to no index. */
      function build() {
        if (built) return index;
        built = true;
        try { index = database(context.files, path => context.textOf(path)); }
        catch { index = null; }
        return index;
      }
      /* A snapshot path that is absent is not absent on the build machine unless the
         snapshot read that place completely. Built once: every directory that holds an
         included file, and every path the traversal saw but left out (excluded,
         ignored, unread). */
      let seen = null;
      function coverage() {
        if (seen) return seen;
        const present = new Set();
        for (const file of context.files) for (let dir = dirOf(file); ; dir = dirOf(dir)) { if (present.has(dir)) break; present.add(dir); if (!dir) break; }
        let dropped = null;
        try { dropped = context.droppedPaths ? context.droppedPaths() : null; } catch { dropped = null; }
        const files = new Set(), roots = [];
        for (const item of dropped?.entries || []) { files.add(item.path); if (item.directory !== false) roots.push(item.path); }
        return (seen = { present, files, roots, known: Boolean(dropped && dropped.complete) });
      }
      /** Why `candidate`, missing from the snapshot, may still exist where the compiler
       *  looks, or null when the snapshot read that place completely. */
      function unseen(candidate, item) {
        const where = `${label(item.dir)} (${item.evidence})`;
        if (!candidate) return `${where} resolves the spelled path outside the snapshot root`;
        const cover = coverage(), dir = item.dir;
        if (!cover.known) return `the snapshot does not record every path it left out, so ${where} may hold an unread ${candidate}`;
        if (cover.files.has(candidate)) return `${candidate} exists but was excluded, ignored or not read by this snapshot`;
        const parent = cover.roots.find(entry => entry === candidate || contains(entry, candidate));
        if (parent) return `${candidate} lies under ${parent}, which this snapshot excluded or did not read`;
        if (!cover.present.has(dir)) return `${label(dir)} is absent from the snapshot (searched via ${item.evidence}); it may exist, or be generated, on the build machine`;
        return null;
      }

      return function resolve(path, fact) {
        if (fact.form !== "c-include") return null;
        try {
          const table = build();
          if (!table) return null;
          const spec = String(fact.specifier || "").replace(/\\/g, "/").replace(/^["'<]+|["'>]+$/g, "");
          if (!spec || spec.includes("\0")) return null;
          const quoted = fact.system !== true;
          const scopes = table.searchPath(path, quoted);
          if (!scopes) return null;
          const external = quoted ? undefined : { external: { name: spec, kind: "system-header", specifier: spec } };
          if (isAbsolute(spec))
            return verdicts.unresolved(`#include ${quoted ? `"${spec}"` : `<${spec}>`} in ${path} spells an absolute path; the preprocessor opens it directly and no snapshot file can be proven to be that file`, "c-include-absolute-path", external);

          const searched = [], unavailable = [], hits = [];
          for (const scope of scopes) {
            let hit = null, skipped = null;
            for (const item of scope.directories) {
              if (!item.available) { if (item.reason) unavailable.push(item.reason); skipped ||= item.reason || `${item.evidence} is outside this snapshot`; continue; }
              searched.push(`${label(item.dir)} (${item.evidence})`);
              const candidate = joinPath(item.dir, spec);
              if (candidate && has(candidate)) { hit = { target: candidate, item, scope, skipped }; break; }
              skipped ||= unseen(candidate, item);
            }
            hits.push(hit);
          }
          const found = hits.filter(Boolean);
          const targets = [...new Set(found.map(item => item.target))].sort();
          const spelling = quoted ? `#include "${spec}"` : `#include <${spec}>`;

          if (!targets.length) {
            const detail = searched.length
              ? `searched ${listOf(searched)}`
              : "the include search path this file's build command supplies is empty";
            const extra = unavailable.length ? `; include directories outside this snapshot were not searched: ${listOf(unavailable, 4)}` : "";
            const manifestList = listOf(scopes.map(scope => scope.manifest).filter(Boolean));
            return verdicts.unresolved(
              `No included header satisfies ${spelling} in ${path}: ${detail}${extra}. ${manifestList || "The build manifest"} supplies the include search path, and a file that merely shares the basename is not that header.`,
              quoted ? "c-include-quoted-search-path-exhausted" : "c-include-system-search-path-exhausted",
              external);
          }
          if (targets.length > 1)
            return verdicts.candidate(targets, "c-include-conflicting-database-entries",
              `${spelling} in ${path} resolves to a different header under each compile command for this file (${listOf(found.map(item => `${item.target} via ${label(item.item.dir)}`))}); no single target is proven.`,
              { manifests: [...new Set(scopes.map(scope => scope.manifest).filter(Boolean))] });

          const winner = found[0];
          const proof = {
            manifest: winner.item.manifest || winner.scope.manifest,
            directory: label(winner.item.dir),
            via: winner.item.evidence,
            ...(winner.item.target ? { cmakeTarget: winner.item.target } : {}),
            spelled: spec,
            searched: [...new Set(searched)].slice(0, MAX_REASON_DIRECTORIES),
            ...(winner.scope.macros?.length ? { macros: winner.scope.macros.slice(0, 32) } : {}),
            ...(unavailable.length ? { unavailableIncludeDirectories: [...new Set(unavailable)].slice(0, MAX_REASON_DIRECTORIES) } : {}),
          };
          // A directory searched earlier that is outside the snapshot, or that the
          // snapshot did not read completely, may hold the header the compiler opens.
          const shadowed = found.find(item => item.skipped);
          if (shadowed)
            return verdicts.candidate(targets, "c-include-after-unavailable-directory",
              `${spelling} in ${path} is found in ${label(shadowed.item.dir)} (${shadowed.item.evidence}), but a directory searched before it may hold an unseen copy the compiler opens instead: ${shadowed.skipped}; no single target is proven.`,
              proof);
          if (found.length < hits.length)
            return verdicts.conditional(targets, "c-include-per-command-search-path",
              `${spelling} in ${path} is satisfied by ${targets[0]} under ${found.length} of the ${hits.length} compile commands recorded for this file; the remaining commands do not supply a directory that contains it, so the edge holds only for those configurations.`,
              proof);
          return verdicts.resolved(targets, RULES[winner.item.origin] || "c-include-search-path", proof);
        } catch {
          // Never throw out of a resolver: an unreadable manifest leaves the
          // weaker path search exactly as it was.
          return null;
        }
      };
    },
  });

  root.SkylenseProjectNative = Object.freeze({ database, searchPath: (index, path, quoted) => index.searchPath(path, quoted), tokenize, flagsOf, cmakeCommands, canonical });
})(typeof window !== "undefined" ? window : globalThis);
