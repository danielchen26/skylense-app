/* JVM project binding: Maven, Gradle and sbt declared source roots.
 *
 * A JVM import names a type, not a file. The mapping from `a.b.C` to a file is
 * the build's: javac, kotlinc and scalac only see the directories the build
 * declares as source roots, and a type is on the compile classpath of a file
 * only when that file's own module declares the root, or declares a dependency
 * on the module that does. A path that merely ends in `a/b/C.java` proves
 * nothing: a vendored copy under third_party/ is not on anybody's classpath,
 * and the same type declared in src/main and src/test is two declarations.
 *
 * So this family reads the build files as data and answers only what they
 * state:
 *   pom.xml            <sourceDirectory>, <testSourceDirectory>, <modules>,
 *                      <dependency> coordinates, Maven's src/main/java and
 *                      src/test/java defaults
 *                      https://maven.apache.org/pom.html#build
 *   build.gradle[.kts] sourceSets main/test java|kotlin|scala srcDirs/srcDir,
 *                      the conventional src/{main,test}/{java,kotlin,scala} of
 *                      the languages the plugin block names, and
 *                      `project(":path")` dependencies
 *                      https://docs.gradle.org/current/userguide/java_plugin.html#sec:java_project_layout
 *   settings.gradle[.kts]  `include ":a:b"` -> a/b
 *                      https://docs.gradle.org/current/userguide/multi_project_builds.html
 *   build.sbt          scalaSource, javaSource, unmanagedSourceDirectories when
 *                      stated literally, `lazy val x = project.in(file("…"))`,
 *                      `.dependsOn(…)`, and sbt's src/{main,test}/{scala,java}
 *                      https://www.scala-sbt.org/1.x/docs/Directories.html
 *
 * Nothing is executed and nothing is fetched: no Gradle or sbt evaluation, no
 * Maven property or parent-POM resolution off the snapshot, no dependency
 * download, no annotation processing, no module-path/JPMS reading. A build file
 * that cannot be read yields no source root rather than a guessed one, which
 * leaves the weaker path search in src/semantic-project.js answering exactly as
 * it did before. A file the build does not claim is `unhandled` for the same
 * reason: nothing is known about what it may see, so nothing is claimed.
 *
 * Exported pure helpers, for verifiers:
 *   sourceRoots(files, read)            -> index { modules, roots, manifests,
 *                                          skipped, visibleRoots(path), ownerOf(path) }
 *   visibleRoots(files, read, path)     -> index.visibleRoots(path)
 * `index.visibleRoots(path)` is the `visibleRoots(path)` of one snapshot. */
(function (root) {
  "use strict";

  const manifests = root.SkylenseProjectManifests;
  if (!manifests) throw new Error("src/project-manifests.js must load before src/project-jvm.js.");
  const { dirOf, baseOf, joinPath, contains } = manifests;

  // Bounds. The corpus gate analyzes 7 200-file checkouts, so the index is
  // built once per snapshot and every manifest read is capped.
  const MAX_MANIFEST_BYTES = 1024 * 1024;
  const MAX_MANIFESTS = 2000;
  const MAX_PACKAGE_MEMBERS = 25;
  const MAX_PACKAGE_HEAD = 8192;

  const MANIFEST_NAMES = new Set(["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts", "build.sbt"]);
  const FORM_EXTENSIONS = { "java-import": [".java"], "kotlin-import": [".kt", ".kts"], "scala-import": [".scala"] };
  const SOURCE_EXTENSIONS = [".java", ".kt", ".kts", ".scala"];
  const FORM_LABEL = { "java-import": "Java type", "kotlin-import": "Kotlin declaration", "scala-import": "Scala declaration" };
  const GRADLE_LANGUAGES = ["java", "kotlin", "scala"];

  const isSource = path => SOURCE_EXTENSIONS.some(extension => path.endsWith(extension));
  const unique = list => [...new Set(list)];

  function moduleOf(modules, dir) {
    let entry = modules.get(dir);
    if (!entry) modules.set(dir, (entry = { dir, kinds: [], main: new Set(), test: new Set(), deps: [], coordinates: null }));
    return entry;
  }
  const addDependency = (entry, dir, testOnly) => {
    if (dir === null || dir === entry.dir) return;
    const existing = entry.deps.find(dependency => dependency.dir === dir);
    if (existing) { if (!testOnly) existing.testOnly = false; return; }
    entry.deps.push({ dir, testOnly: Boolean(testOnly) });
  };

  // ---------------------------------------------------------------------------
  // Maven. Bounded text scanning: an XML dependency is not needed to read four
  // element names, and the POM is never executed or interpolated against
  // anything outside itself.
  // ---------------------------------------------------------------------------
  const XML_COMMENT = /<!--[\s\S]*?-->/g;
  const tagValue = (text, name) => {
    const match = new RegExp(`<${name}\\s*>([^<]*)</${name}\\s*>`).exec(text);
    return match ? match[1].trim() : null;
  };
  const tagValues = (text, name) =>
    [...text.matchAll(new RegExp(`<${name}\\s*>([^<]*)</${name}\\s*>`, "g"))].map(match => match[1].trim()).filter(Boolean);
  const element = (text, name) => {
    const match = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}\\s*>`).exec(text);
    return match ? match[1] : null;
  };
  const dropElements = (text, name) => text.replace(new RegExp(`<${name}\\b[^>]*>[\\s\\S]*?</${name}\\s*>`, "g"), "");

  /** A `${basedir}`-anchored literal path. Any other `${property}` is a value
   *  this reader cannot know, so it states no root rather than a wrong one. */
  function mavenDirectory(dir, raw) {
    const value = String(raw || "").trim().replace(/\\/g, "/").replace(/^\$\{(?:project\.)?basedir\}\/?/, "");
    if (!value || value.includes("${")) return null;
    return joinPath(dir, value);
  }

  function readMaven(dir, text, state) {
    const body = String(text).replace(XML_COMMENT, "");
    const parent = element(body, "parent");
    const own = dropElements(body, "parent");
    const entry = moduleOf(state.modules, dir);
    entry.kinds.push("maven");
    const groupId = tagValue(own, "groupId") || (parent ? tagValue(parent, "groupId") : null);
    const artifactId = tagValue(own, "artifactId");
    if (groupId && artifactId && !groupId.includes("${") && !artifactId.includes("${")) {
      entry.coordinates = `${groupId}:${artifactId}`;
      if (!state.coordinates.has(entry.coordinates)) state.coordinates.set(entry.coordinates, dir);
    }
    // <sourceDirectory> lives in <build>; a <profiles> copy is conditional on a
    // profile this adapter cannot evaluate, so it is not read.
    const build = element(dropElements(own, "profiles"), "build");
    const stated = build ? tagValue(build, "sourceDirectory") : null;
    const statedTest = build ? tagValue(build, "testSourceDirectory") : null;
    // A stated directory replaces the default; only an absent element leaves it.
    const main = stated === null ? joinPath(dir, "src/main/java") : mavenDirectory(dir, stated);
    const test = statedTest === null ? joinPath(dir, "src/test/java") : mavenDirectory(dir, statedTest);
    if (main !== null) entry.main.add(main);
    if (test !== null) entry.test.add(test);
    for (const name of tagValues(own, "module")) {
      const child = mavenDirectory(dir, name);
      if (child === null || child === dir) continue;
      moduleOf(state.modules, child).kinds.push("maven-module");
      state.declaredMavenModules.add(child);
    }
    // <dependencyManagement> states versions, not dependencies; reading it as one
    // would widen visibility to modules this module does not actually depend on.
    const declarations = dropElements(dropElements(own, "dependencyManagement"), "pluginManagement");
    for (const match of declarations.matchAll(/<dependency\b[^>]*>([\s\S]*?)<\/dependency\s*>/g)) {
      const group = tagValue(match[1], "groupId"), artifact = tagValue(match[1], "artifactId");
      if (!group || !artifact || artifact.includes("${")) continue;
      const resolved = /^\$\{project\.(?:parent\.)?groupId\}$/.test(group) ? groupId : group;
      if (!resolved || resolved.includes("${")) continue;
      state.mavenDependencies.push({ from: dir, coordinates: `${resolved}:${artifact}`, testOnly: tagValue(match[1], "scope") === "test" });
    }
  }

  // ---------------------------------------------------------------------------
  // Gradle and sbt scripts. Both are programs; only literal statements are read.
  // ---------------------------------------------------------------------------
  /** Drop line and block comments without touching string contents. */
  function stripScriptComments(text) {
    let out = "", index = 0, quote = null;
    while (index < text.length) {
      const char = text[index];
      if (quote) {
        out += char;
        if (char === "\\") { index++; out += text[index] ?? ""; }
        else if (char === quote) quote = null;
        index++;
        continue;
      }
      if (char === '"' || char === "'") { quote = char; out += char; index++; continue; }
      if (char === "/" && text[index + 1] === "/") { while (index < text.length && text[index] !== "\n") index++; continue; }
      if (char === "/" && text[index + 1] === "*") {
        index += 2;
        while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index++;
        index += 2;
        continue;
      }
      out += char; index++;
    }
    return out;
  }
  /** Index of the `}` closing the `{` at `open`, or -1 when the script is unbalanced. */
  function matchingBrace(text, open) {
    let depth = 0, quote = null;
    for (let index = open; index < text.length; index++) {
      const char = text[index];
      if (quote) { if (char === "\\") index++; else if (char === quote) quote = null; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === "{") depth++;
      else if (char === "}" && !--depth) return index;
    }
    return -1;
  }
  /** Every `header { … }` block, as `{ name, body }` where `name` is the first
   *  matched capture group. A header with no brace, or an unbalanced brace, is
   *  skipped rather than half-read. */
  function namedBlocks(text, pattern) {
    const found = [], expression = new RegExp(pattern, "g");
    let match;
    while ((match = expression.exec(text))) {
      let index = match.index + match[0].length;
      while (index < text.length && /\s/.test(text[index])) index++;
      if (text[index] !== "{") continue;
      const end = matchingBrace(text, index);
      if (end === -1) continue;
      found.push({ name: match.slice(1).find(Boolean) || null, body: text.slice(index + 1, end) });
      expression.lastIndex = end;
    }
    return found;
  }
  const stringLiterals = value =>
    [...String(value).matchAll(/"([^"\n]*)"|'([^'\n]*)'/g)].map(match => match[1] ?? match[2]).filter(Boolean);

  const SRC_DIRS = "(setSrcDirs|srcDirs|srcDir)";
  const GRADLE_DOTTED = new RegExp(
    `\\bsourceSets\\s*(?:\\.\\s*(main|test)\\b|\\[\\s*["'](main|test)["']\\s*\\]|\\.\\s*(?:getByName|named)\\s*\\(\\s*["'](main|test)["']\\s*\\))` +
    `\\s*(?:\\.\\s*get\\(\\)\\s*)?\\.\\s*(java|kotlin|scala)\\s*\\.\\s*${SRC_DIRS}\\s*(=|\\+=)?\\s*([^\\n;]*)`, "g");
  const GRADLE_QUALIFIED = new RegExp(`\\b(java|kotlin|scala)\\s*\\.\\s*${SRC_DIRS}\\s*(=|\\+=)?\\s*([^\\n;]*)`, "g");
  const GRADLE_BARE = new RegExp(`\\b${SRC_DIRS}\\s*(=|\\+=)?\\s*([^\\n;]*)`, "g");
  const SCOPE_BLOCK = "(?:^|[^\\w.])(main|test)\\b|(?:getByName|named)\\s*\\(\\s*[\"'](main|test)[\"']\\s*\\)";

  /** Literal source-directory statements, as { scope, language, replace, dirs }.
   *  `srcDirs =` / `setSrcDirs(…)` replace the convention for that source set and
   *  language; `srcDir` / `srcDirs(…)` / `+=` add to it. */
  function gradleSourceDirectives(text) {
    const found = [];
    const add = (scope, language, keyword, operator, tail) => {
      const dirs = stringLiterals(tail);
      if (!scope || !language || !dirs.length) return;
      found.push({ scope, language, replace: operator === "=" || keyword === "setSrcDirs", dirs });
    };
    for (const match of text.matchAll(GRADLE_DOTTED))
      add(match[1] || match[2] || match[3], match[4], match[5], match[6], match[7]);
    for (const sourceSets of namedBlocks(text, "\\bsourceSets\\b")) {
      for (const scoped of namedBlocks(sourceSets.body, SCOPE_BLOCK)) {
        for (const language of namedBlocks(scoped.body, "(?:^|[^\\w.])(java|kotlin|scala)\\b"))
          for (const statement of language.body.matchAll(GRADLE_BARE))
            add(scoped.name, language.name, statement[1], statement[2], statement[3]);
        for (const statement of scoped.body.matchAll(GRADLE_QUALIFIED))
          add(scoped.name, statement[1], statement[2], statement[3], statement[4]);
      }
    }
    return found;
  }
  /** Languages the script's plugin declarations name. The Kotlin and Scala JVM
   *  plugins both apply the Java plugin, so they bring its layout with them.
   *  https://docs.gradle.org/current/userguide/scala_plugin.html */
  function gradleLanguages(text) {
    const declarations = namedBlocks(text, "\\bplugins\\b").map(block => block.body);
    for (const match of text.matchAll(/\bapply\s*(?:\(\s*)?plugin\s*[:=]\s*["']([^"']+)["']/g)) declarations.push(match[1]);
    const body = declarations.join("\n"), languages = new Set();
    if (/\bkotlin\b/i.test(body)) languages.add("kotlin");
    if (/\bscala\b/i.test(body)) languages.add("scala");
    if (languages.size || /\b(?:java|java-library|application|war)\b/i.test(body)) languages.add("java");
    return languages;
  }
  const gradleProjectDir = (settingsDir, value) => {
    const relative = String(value).replace(/^:+/, "").split(":").filter(Boolean).join("/");
    return relative ? joinPath(settingsDir, relative) : settingsDir;
  };
  /** Stated project dependencies. Only a literal project path counts, and only when it names a
   *  module the settings file declared; `projects.myCore` is Gradle's type-safe accessor for the
   *  module `:my-core`.
   *  https://docs.gradle.org/current/userguide/multi_project_builds.html#sub:type-safe-project-accessors */
  function gradleDependencies(dir, text, state) {
    for (const match of text.matchAll(/\b(\w+)\s*\(?\s*project\s*\(\s*(?:path\s*[:=]\s*)?["']([^"']+)["']\s*\)/g))
      state.gradleDependencies.push({ from: dir, path: match[2], testOnly: /^test/i.test(match[1]) });
    for (const match of text.matchAll(/\b(\w+)\s*\(?\s*projects\s*\.\s*([A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*)/g))
      state.gradleDependencies.push({
        from: dir,
        path: ":" + match[2].replace(/\s+/g, "").split(".").map(segment => segment.replace(/([a-z\d])([A-Z])/g, "$1-$2").toLowerCase()).join(":"),
        testOnly: /^test/i.test(match[1]),
      });
  }

  function readGradleSettings(dir, text, state) {
    const body = stripScriptComments(String(text));
    state.gradleSettings.push(dir);
    moduleOf(state.modules, dir).kinds.push("gradle-root");
    state.gradleModules.push({ dir, settings: dir, languages: new Set(), directives: [] });
    for (const match of body.matchAll(/\binclude\b\s*\(?([^\n)]*)\)?/g))
      for (const value of stringLiterals(match[1])) {
        const child = gradleProjectDir(dir, value);
        if (child === null) continue;
        moduleOf(state.modules, child).kinds.push("gradle-module");
        state.gradleModules.push({ dir: child, settings: dir, languages: new Set(), directives: [] });
      }
  }
  function readGradleBuild(dir, text, state) {
    const body = stripScriptComments(String(text));
    moduleOf(state.modules, dir).kinds.push("gradle");
    state.gradleModules.push({ dir, settings: null, languages: gradleLanguages(body), directives: gradleSourceDirectives(body) });
    // `allprojects`/`subprojects` apply plugins to modules whose own script says
    // nothing, so their language set is shared with every module underneath.
    for (const block of namedBlocks(body, "\\b(?:allprojects|subprojects)\\b")) {
      const languages = gradleLanguages(block.body);
      if (languages.size) state.gradleShared.push({ dir, languages });
    }
    gradleDependencies(dir, body, state);
  }

  // ---------------------------------------------------------------------------
  // sbt
  // ---------------------------------------------------------------------------
  const SBT_SETTING = /(?:(Compile|Test)\s*\/\s*)?\b(scalaSource|javaSource|unmanagedSourceDirectories)\b\s*(?:in\s+(Compile|Test)\s*)?(:=|\+\+=|\+=)\s*([^\n]*)/g;
  /** Literal directories in an sbt setting value. A value that reads any other
   *  setting is computed at load time and is not a stated directory. */
  function sbtLiterals(value) {
    const text = String(value);
    if (/\.value\b/.test(text.replace(/baseDirectory\s*\.\s*value/g, ""))) return null;
    const found = [];
    for (const match of text.matchAll(/baseDirectory\s*\.\s*value((?:\s*\/\s*"[^"\n]*")+)/g)) found.push(stringLiterals(match[1]).join("/"));
    for (const match of text.matchAll(/\bfile\s*\(\s*"([^"\n]*)"\s*\)/g)) found.push(match[1]);
    return found.length ? found : null;
  }
  function readSbt(dir, text, state) {
    const body = stripScriptComments(String(text));
    const markers = [...body.matchAll(/\blazy\s+val\s+(\w+)\s*=/g)];
    const regions = [{ name: null, dir, text: markers.length ? body.slice(0, markers[0].index) : body }];
    for (let index = 0; index < markers.length; index++) {
      const region = body.slice(markers[index].index, index + 1 < markers.length ? markers[index + 1].index : body.length);
      if (!/\bproject\b/.test(region)) continue;
      const located = /\bproject\b[\s\S]{0,40}?\bfile\s*\(\s*"([^"\n]*)"\s*\)/.exec(region);
      const projectDir = joinPath(dir, located ? located[1] : markers[index][1]);
      if (projectDir === null) continue;
      regions.push({ name: markers[index][1], dir: projectDir, text: region });
      state.sbtProjects.set(markers[index][1], projectDir);
    }
    for (const region of regions) {
      const entry = moduleOf(state.modules, region.dir);
      entry.kinds.push("sbt");
      // sbt's default layout. https://www.scala-sbt.org/1.x/docs/Directories.html
      const layout = {
        main: { scala: ["src/main/scala"], java: ["src/main/java"], extra: [], replaced: false },
        test: { scala: ["src/test/scala"], java: ["src/test/java"], extra: [], replaced: false },
      };
      for (const match of region.text.matchAll(SBT_SETTING)) {
        const scope = (match[1] || match[3] || "Compile") === "Test" ? "test" : "main";
        const dirs = sbtLiterals(match[5]);
        if (!dirs) continue;
        if (match[2] === "unmanagedSourceDirectories") {
          if (match[4] === ":=") { layout[scope].replaced = true; layout[scope].extra = [...dirs]; }
          else layout[scope].extra.push(...dirs);
          continue;
        }
        const key = match[2] === "javaSource" ? "java" : "scala";
        if (match[4] === ":=") layout[scope][key] = [dirs[0]];
        else layout[scope][key].push(...dirs);
      }
      for (const scope of ["main", "test"]) {
        const declared = layout[scope].replaced ? layout[scope].extra : [...layout[scope].scala, ...layout[scope].java, ...layout[scope].extra];
        for (const value of declared) {
          const resolved = joinPath(region.dir, value);
          if (resolved !== null) entry[scope].add(resolved);
        }
      }
      for (const match of region.text.matchAll(/\.\s*dependsOn\s*\(([^)]*)\)/g))
        for (const argument of match[1].split(",")) {
          const name = /([A-Za-z_]\w*)/.exec(argument);
          if (name) state.sbtDependencies.push({ from: region.dir, name: name[1], testOnly: /%\s*"test/.test(argument) });
        }
    }
  }

  // ---------------------------------------------------------------------------
  // The index
  // ---------------------------------------------------------------------------
  /** Every declared source root of a snapshot, with the module and scope that
   *  declared it. `files` are snapshot-relative paths; `read(path)` returns the
   *  manifest text or null. Pure: no I/O beyond `read`, no execution. */
  function sourceRoots(files, read) {
    const state = {
      modules: new Map(), coordinates: new Map(), declaredMavenModules: new Set(), mavenDependencies: [],
      gradleModules: [], gradleShared: [], gradleSettings: [], gradleDependencies: [], sbtProjects: new Map(), sbtDependencies: [],
    };
    const found = [];
    for (const path of Array.isArray(files) ? files : []) {
      const name = baseOf(path);
      if (MANIFEST_NAMES.has(name)) found.push({ path, dir: dirOf(path), name, depth: path.split("/").length });
    }
    found.sort((left, right) => left.depth - right.depth || (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    const accepted = found.slice(0, MAX_MANIFESTS), manifestPaths = [], skipped = [];
    const textOf = entry => {
      let text = null;
      try { text = read(entry.path); } catch { return null; }
      if (typeof text !== "string") return null;
      if (text.length > MAX_MANIFEST_BYTES) { skipped.push(entry.path); return null; }
      return text;
    };
    // Settings files are read before build scripts so an `include` names the
    // module before that module's own script is read.
    const groups = [
      [entry => entry.name === "pom.xml", readMaven],
      [entry => entry.name.startsWith("settings.gradle"), readGradleSettings],
      [entry => entry.name.startsWith("build.gradle"), readGradleBuild],
      [entry => entry.name === "build.sbt", readSbt],
    ];
    for (const [matches, reader] of groups) for (const entry of accepted) {
      if (!matches(entry)) continue;
      const text = textOf(entry);
      if (text === null) continue;
      manifestPaths.push(entry.path);
      // One unreadable manifest loses its own roots, never the whole index.
      try { reader(entry.dir, text, state); } catch { skipped.push(entry.path); }
    }
    // A <module> whose own pom.xml is outside the snapshot still has Maven's
    // default layout: the aggregator stated the module, not its directories.
    for (const dir of state.declaredMavenModules) {
      const entry = state.modules.get(dir);
      if (!entry || entry.kinds.includes("maven")) continue;
      const main = joinPath(dir, "src/main/java"), test = joinPath(dir, "src/test/java");
      if (main !== null) entry.main.add(main);
      if (test !== null) entry.test.add(test);
    }
    for (const gradle of state.gradleModules) {
      const entry = state.modules.get(gradle.dir) || moduleOf(state.modules, gradle.dir);
      const languages = new Set(gradle.languages);
      for (const shared of state.gradleShared) if (contains(shared.dir, gradle.dir)) for (const language of shared.languages) languages.add(language);
      const replaced = new Set(gradle.directives.filter(directive => directive.replace).map(directive => `${directive.scope}/${directive.language}`));
      for (const language of GRADLE_LANGUAGES) {
        if (!languages.has(language)) continue;
        for (const scope of ["main", "test"]) {
          if (replaced.has(`${scope}/${language}`)) continue;
          const dir = joinPath(gradle.dir, `src/${scope}/${language}`);
          if (dir !== null) entry[scope].add(dir);
        }
      }
      for (const directive of gradle.directives) for (const value of directive.dirs) {
        const dir = joinPath(gradle.dir, value);
        if (dir !== null) entry[directive.scope === "test" ? "test" : "main"].add(dir);
      }
    }
    for (const dependency of state.mavenDependencies) {
      const target = state.coordinates.get(dependency.coordinates);
      if (target === undefined) continue;
      addDependency(moduleOf(state.modules, dependency.from), target, dependency.testOnly);
    }
    for (const dependency of state.gradleDependencies) {
      // A project path is relative to the settings file that declared the build.
      for (const settings of state.gradleSettings.length ? state.gradleSettings : [""]) {
        if (!contains(settings, dependency.from)) continue;
        const target = gradleProjectDir(settings, dependency.path);
        if (target !== null && state.modules.has(target)) addDependency(moduleOf(state.modules, dependency.from), target, dependency.testOnly);
      }
    }
    for (const dependency of state.sbtDependencies) {
      const target = state.sbtProjects.get(dependency.name);
      if (target === undefined) continue;
      addDependency(moduleOf(state.modules, dependency.from), target, dependency.testOnly);
    }
    const roots = [];
    for (const entry of state.modules.values()) {
      for (const dir of entry.main) roots.push({ dir, module: entry.dir, scope: "main" });
      for (const dir of entry.test) roots.push({ dir, module: entry.dir, scope: "test" });
    }
    // Longest first: the innermost declared root owns the file.
    roots.sort((left, right) => right.dir.length - left.dir.length || left.dir.localeCompare(right.dir) || left.scope.localeCompare(right.scope));
    const ownerOf = path => {
      const file = String(path || "");
      for (const entry of roots) if (entry.dir === "" || file.startsWith(entry.dir + "/")) return entry;
      return null;
    };
    /** Source roots on the compile path of `path`: its own module's main roots,
     *  its module's test roots when it is itself a test source, and the main
     *  roots of every module its module states a dependency on. Null when no
     *  declared root claims the file. */
    const visible = path => {
      const owner = ownerOf(path);
      if (!owner) return null;
      const module = state.modules.get(owner.module);
      if (!module) return null;
      const set = new Set(module.main), dependencies = [];
      if (owner.scope === "test") for (const dir of module.test) set.add(dir);
      for (const dependency of module.deps) {
        if (dependency.testOnly && owner.scope !== "test") continue;
        const target = state.modules.get(dependency.dir);
        if (!target) continue;
        dependencies.push(dependency.dir);
        for (const dir of target.main) set.add(dir);
      }
      return { module: module.dir, scope: owner.scope, root: owner.dir, roots: [...set].sort(), dependencies: dependencies.sort() };
    };
    return Object.freeze({ modules: state.modules, roots, manifests: manifestPaths, skipped: unique(skipped), ownerOf, visibleRoots: visible });
  }
  const visibleRoots = (files, read, path) => sourceRoots(files, read).visibleRoots(path);

  // ---------------------------------------------------------------------------
  // The resolver
  // ---------------------------------------------------------------------------
  manifests.register({
    id: "project-jvm",
    forms: ["java-import", "kotlin-import", "scala-import"],
    create(context) {
      const { verdicts } = context;
      let index;                       // undefined: not built. null: unusable.
      let byDirectory = null, byBase = null;
      const packageNames = new Map(), views = new Map();

      function build() {
        byDirectory = new Map();
        byBase = new Map();
        for (const path of context.files) {
          if (!isSource(path)) continue;
          const dir = context.dirOf(path), name = context.baseOf(path);
          const siblings = byDirectory.get(dir);
          if (siblings) siblings.push(path); else byDirectory.set(dir, [path]);
          const named = byBase.get(name);
          if (named) named.push(path); else byBase.set(name, [path]);
        }
        for (const list of byDirectory.values()) list.sort();
        for (const list of byBase.values()) list.sort();
        return sourceRoots(context.files, context.textOf);
      }
      function state() {
        if (index === undefined) { try { index = build() || null; } catch { index = null; } }
        return index;
      }
      /** The package clauses a source file declares, outermost first. Java and
       *  Kotlin allow one; Scala allows a chain, which joins into one name.
       *  https://docs.oracle.com/javase/specs/jls/se21/html/jls-7.html#jls-7.4 */
      function packagesOf(path) {
        if (packageNames.has(path)) return packageNames.get(path);
        const text = context.textOf(path);
        const names = [];
        if (typeof text === "string") {
          const head = text.slice(0, MAX_PACKAGE_HEAD);
          const chained = path.endsWith(".scala");
          // The terminator is a lookahead: a chained `package a` / `package b` pair
          // must not lose its second clause to the newline the first one matched.
          for (const match of head.matchAll(/(?:^|[\r\n])[ \t]*package[ \t]+([A-Za-z_$][\w$]*(?:[ \t]*\.[ \t]*[A-Za-z_$][\w$]*)*)[ \t]*(?=[;{\r\n]|$)/g)) {
            names.push(match[1].replace(/[ \t]/g, ""));
            if (!chained || names.length >= 8) break;
          }
        }
        const declared = names.length ? unique([names[0], names.join(".")]) : null;
        packageNames.set(path, declared);
        return declared;
      }
      /** Candidate files for `segments` under the visible roots. A file whose own
       *  package clause contradicts its directory is not evidence for that type. */
      function lookup(view, segments, extensions) {
        const relative = segments.join("/"), expected = segments.slice(0, -1).join(".");
        const hits = [], contradicted = [];
        for (const dir of view.roots) for (const extension of extensions) {
          const candidate = dir ? `${dir}/${relative}${extension}` : `${relative}${extension}`;
          if (!context.has(candidate)) continue;
          const declared = packagesOf(candidate);
          if (declared && !declared.includes(expected)) { contradicted.push(`${candidate} declares package ${declared[0]}`); continue; }
          hits.push(candidate);
        }
        return { hits: unique(hits), contradicted: unique(contradicted) };
      }
      /** The type's own language first; all JVM languages compile against one
       *  classpath, so a Java type in a visible root is a real target for a
       *  Kotlin or Scala import when nothing of its own language matches. */
      function locate(view, segments, extensions) {
        const own = lookup(view, segments, extensions);
        if (own.hits.length) return { hits: own.hits, contradicted: own.contradicted, cross: false };
        const other = lookup(view, segments, SOURCE_EXTENSIONS.filter(extension => !extensions.includes(extension)));
        return { hits: other.hits, contradicted: unique([...own.contradicted, ...other.contradicted]), cross: other.hits.length > 0 };
      }
      const visibleDirectories = (view, segments) => {
        const relative = segments.join("/");
        return view.roots.map(dir => (dir ? `${dir}/${relative}` : relative)).filter(candidate => byDirectory.has(candidate));
      };
      const outside = (segments, extensions) => {
        const relative = segments.join("/"), found = [];
        for (const extension of extensions) for (const path of byBase.get(segments[segments.length - 1] + extension) || [])
          if (path === `${relative}${extension}` || path.endsWith(`/${relative}${extension}`)) found.push(path);
        return unique(found).sort();
      };
      /** Files of `dirs` whose own declarations include the name `member`. */
      function declaringMember(dirs, member) {
        const found = [];
        for (const dir of dirs) for (const file of byDirectory.get(dir) || []) {
          const symbols = context.factsOf(file)?.symbols || [];
          if (symbols.some(symbol => String(symbol.name || "") === member || String(symbol.qualifiedName || "").split(".").pop() === member)) found.push(file);
        }
        return unique(found).sort();
      }
      const searchedPhrase = view =>
        `the ${view.scope} compile path of ${view.module ? `module ${view.module}` : "the root module"} (searched ${view.roots.length ? view.roots.map(dir => dir || ".").join(", ") : "no declared source root"})`;
      const proofOf = (view, spec, extra) => ({ specifier: spec, module: view.module || ".", scope: view.scope, sourceRoot: view.root || ".", visibleRoots: view.roots, ...(view.dependencies.length ? { dependencies: view.dependencies } : {}), ...extra });
      const ambiguous = (view, spec, label, hits) => verdicts.unresolved(
        `${label} ${spec} is declared by ${hits.join(" and ")}, and both are on ${searchedPhrase(view)}; two declarations of one type are not a single target, so no binding is claimed`,
        "jvm-type-import-ambiguous", { candidates: hits });

      function packageImport(path, fact, view, segments, extensions, spec, label) {
        const directories = visibleDirectories(view, segments);
        if (directories.length) {
          const members = unique(directories.flatMap(dir => byDirectory.get(dir) || [])).filter(file => file !== path).sort();
          if (!members.length)
            return verdicts.unresolved(
              `${spec} names package directory ${directories.join(", ")} on ${searchedPhrase(view)}, which contains no included source file other than ${path}`,
              "jvm-package-import-empty");
          const shown = members.slice(0, MAX_PACKAGE_MEMBERS);
          return verdicts.candidate(shown, "jvm-package-import",
            `${spec} imports a package, not a type: every declaration of ${directories.join(", ")} becomes available, so each of these ${members.length} source files is a candidate declaration site and none is the proven target${members.length > shown.length ? `; the first ${MAX_PACKAGE_MEMBERS} are reported` : ""}`,
            proofOf(view, spec, { packageDirectories: directories, memberCount: members.length }));
        }
        if (segments.length > 1) {
          // `a.b.C.member` imports a member of the type a.b.C, which is the file
          // this import really references.
          const owner = segments.slice(0, -1);
          const found = locate(view, owner, extensions);
          if (found.hits.length === 1)
            return verdicts.resolved(found.hits, "jvm-static-member-import", proofOf(view, spec, { type: owner.join("."), member: segments[segments.length - 1] }));
          if (found.hits.length > 1) return ambiguous(view, spec, label, found.hits);
          const parents = visibleDirectories(view, owner);
          if (parents.length) {
            // A Kotlin or Scala top-level declaration lives in the package, not in a
            // type of the same name, so the declaring file is whichever file of that
            // package declares the name. Absence of the name is not a candidate set.
            const member = segments[segments.length - 1];
            const declaring = declaringMember(parents, member).filter(file => file !== path);
            if (declaring.length === 1)
              return verdicts.resolved(declaring, "jvm-member-import-declaration", proofOf(view, spec, { packageDirectories: parents, member }));
            if (declaring.length > 1)
              return verdicts.candidate(declaring.slice(0, MAX_PACKAGE_MEMBERS), "jvm-package-member-import",
                `${spec} names ${member} in package ${parents.join(", ")}, and ${declaring.length} source files of that package declare that name, so each is a candidate declaration site and none is the proven target`,
                proofOf(view, spec, { packageDirectories: parents, member, declaringCount: declaring.length }));
            return verdicts.unresolved(
              `${spec} names ${member} in package ${parents.join(", ")} on ${searchedPhrase(view)}, but no included source file of that package declares ${member}`,
              "jvm-member-import-undeclared");
          }
        }
        return verdicts.unresolved(
          `${spec} names neither a package directory nor a type on ${searchedPhrase(view)}; package and member imports are bound only inside the source roots the build declares`,
          "jvm-package-import-not-in-source-roots", { external: { name: spec, kind: "package", specifier: spec } });
      }

      function typeImport(path, fact, view, segments, extensions, spec, label) {
        const found = locate(view, segments, extensions);
        if (found.hits.length === 1)
          return verdicts.resolved(found.hits, found.cross ? "jvm-type-import-cross-language" : "jvm-type-import-source-root",
            proofOf(view, spec, { declaredPackage: segments.slice(0, -1).join("."), type: segments[segments.length - 1] }));
        if (found.hits.length > 1) return ambiguous(view, spec, label, found.hits);
        // `a.b.Outer.Inner` is declared by the file of the outermost type.
        const nested = [...found.contradicted];
        for (let cut = segments.length - 1; cut >= 1; cut--) {
          if (!/^[A-Z]/.test(segments[cut - 1])) break;
          const outer = locate(view, segments.slice(0, cut), extensions);
          nested.push(...outer.contradicted);
          if (outer.hits.length === 1)
            return verdicts.resolved(outer.hits, "jvm-nested-type-import", proofOf(view, spec, { outerType: segments.slice(0, cut).join("."), nested: segments.slice(cut).join(".") }));
          if (outer.hits.length > 1) return ambiguous(view, spec, label, outer.hits);
        }
        const contradicted = unique(nested);
        if (contradicted.length)
          return verdicts.unresolved(
            `${label} ${spec} has no declaration on ${searchedPhrase(view)}: ${contradicted.join("; ")}, and a file whose declared package contradicts its own directory is not evidence for that type`,
            "jvm-type-import-package-mismatch", { external: { name: spec, kind: "package", specifier: spec } });
        const elsewhere = outside(segments, SOURCE_EXTENSIONS);
        if (elsewhere.length)
          return verdicts.unresolved(
            `${label} ${spec} is not declared on ${searchedPhrase(view)}; ${elsewhere.join(", ")} ${elsewhere.length === 1 ? "matches that type path" : "match that type path"} but ${elsewhere.length === 1 ? "lies" : "lie"} outside every source root the build declares, so ${elsewhere.length === 1 ? "it is" : "they are"} on no compile path and a path suffix is not classpath evidence`,
            "jvm-type-import-outside-source-roots", { external: { name: spec, kind: "package", specifier: spec }, outside: elsewhere });
        return verdicts.unresolved(
          `No included file declares ${label} ${spec} on ${searchedPhrase(view)}; the type comes from a dependency whose source is outside this snapshot`,
          "jvm-type-import-not-in-source-roots", { external: { name: spec, kind: "package", specifier: spec } });
      }

      function decide(path, fact) {
        const extensions = FORM_EXTENSIONS[fact.form];
        if (!extensions) return null;
        const built = state();
        if (!built) return null;
        const spec = String(fact.specifier || "").replace(/[`\s]/g, "");
        // Anything that is not a plain dotted name is not a stated type path.
        if (!spec || /[^\w$.*]/.test(spec)) return null;
        const segments = spec.split(".").filter(segment => segment && segment !== "*" && segment !== "_");
        if (!segments.length) return null;
        // The index is immutable, so a file's compile path is computed once however
        // many imports that file declares.
        let view = views.get(path);
        if (view === undefined) views.set(path, (view = built.visibleRoots(path)));
        // No build file claims this file, so nothing is known about what it may
        // see. That is unhandled, not an abstention: the weaker path search in
        // src/semantic-project.js keeps answering exactly as it did before.
        if (!view) return null;
        const label = FORM_LABEL[fact.form];
        const last = String(spec.split(".").pop());
        const isPackage = last === "*" || last === "_" || /^[a-z]/.test(segments[segments.length - 1]);
        return isPackage
          ? packageImport(path, fact, view, segments, extensions, spec, label)
          : typeImport(path, fact, view, segments, extensions, spec, label);
      }

      return function resolve(path, fact) {
        // A resolver never throws: a malformed manifest degrades to unhandled.
        try { return decide(path, fact); } catch { return null; }
      };
    },
  });

  root.SkylenseProjectJvm = Object.freeze({
    sourceRoots, visibleRoots,
    MAX_MANIFEST_BYTES, MAX_MANIFESTS, MAX_PACKAGE_MEMBERS,
  });
})(typeof window !== "undefined" ? window : globalThis);
