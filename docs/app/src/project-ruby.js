/* Ruby project binding from the project's own gem declarations.
 *
 * `require "demo/util"` names a feature, not a file: Ruby searches each
 * directory on $LOAD_PATH, in order, for `demo/util.rb`. Which directories are on
 * $LOAD_PATH is stated by a gemspec's `require_paths` (RubyGems adds them when the
 * gem is activated) and by a Gemfile that brings a local gem into the bundle with
 * `gemspec` or `gem "x", path: "..."` (Bundler activates it the same way). A
 * require reaches resolved-static only when exactly one declared directory holds
 * the feature and nothing in scope is unread; anything else stays a candidate or
 * a stated refusal.
 *
 * Read as data, never executed. A gemspec and a Gemfile are Ruby programs, so only
 * what a plain top-level literal states is read:
 *   - `spec.require_paths = ["lib"]`, `%w[lib ext]` or a string, written directly
 *     in the Gem::Specification block. A computed value (`%w[a] - %w[b]`, a method
 *     call, a trailing `if`), any other write to require_paths (`<<`, `[0] =`,
 *     `prepend`, `|=`, ...), an assignment inside a nested block (if, case, loop,
 *     method), conflicting assignments, or a gemspec that can reach the spec
 *     object indirectly (send, eval, instance_eval, or passing the spec variable
 *     to another method) is recorded as unread.
 *   - Gemfile `gemspec` and `gem "x", path:` written at top level or inside
 *     `group`/`source` blocks. One inside `if`, `platforms`, `install_if`, `env`
 *     or any other block, one with a `platforms:`/`install_if:` option, or a gem
 *     declared twice is recorded as unread.
 * An unread declaration keeps every require in its scope a candidate: it might
 * have put a directory ahead of the one found. So does a declared directory whose
 * contents are not in the snapshot (outside it, excluded, or absent).
 *
 * RubyGems' documented default `require_paths` is ["lib"]; it is applied only to a
 * gemspec that constructs a Gem::Specification and neither assigns nor otherwise
 * reaches require_paths. Bundler reads gems.rb before Gemfile in one directory.
 * References: https://guides.rubygems.org/specification-reference/#require_paths=
 *             https://bundler.io/v2.5/man/gemfile.5.html (gemspec, path, platforms, install_if)
 *             https://docs.ruby-lang.org/en/3.3/Kernel.html#method-i-require
 */
(function (root) {
  "use strict";
  const manifests = root.SkylenseProjectManifests;
  if (!manifests) throw new Error("src/project-manifests.js must load before this family.");
  const { baseOf, joinPath, contains } = manifests;

  /** Lines a statement may continue over, and lines a literal array may span.
   *  Beyond either, the statement is recorded as unread rather than read further. */
  const MAX_CONTINUATION = 64;

  /**
   * Ruby source split into lines with comments removed, in one linear pass:
   * `{ raw, code, line }` per line, where `raw` keeps string contents and `code`
   * blanks them (so keywords and braces inside strings are never counted).
   * Heredoc bodies and =begin/=end blocks become empty lines.
   */
  function rubyLines(text) {
    const out = [], lines = String(text).split(/\r?\n/);
    let inBlock = false, heredoc = null, percent = null;
    /** Delimiter pairs of %-literals; any other punctuation closes with itself. */
    const PAIRS = { "[": "]", "(": ")", "{": "}", "<": ">" };
    /** Characters after which `/` or `%` starts a literal rather than an operator. */
    const OPERAND_START = /[=([{,;!~|&?:+\-*<>^]$/;
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index], number = index + 1;
      if (inBlock) { if (/^=end\b/.test(line)) inBlock = false; out.push({ raw: "", code: "", line: number }); continue; }
      if (heredoc) {
        if ((heredoc.indented ? line.trim() : line) === heredoc.tag) heredoc = null;
        out.push({ raw: "", code: "", line: number });
        continue;
      }
      if (!percent && /^=begin\b/.test(line)) { inBlock = true; out.push({ raw: "", code: "", line: number }); continue; }
      let raw = "", code = "", quote = null;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        /* A %-literal (%w[...], %i(...), %q{...}, %r|...|) or a regex body is text,
           not code: blanked in `code` exactly like a string, delimiters included, so
           `%w[end]` or `/do|end/` can never open or close a block. A %-literal may
           span lines (multi-line word lists are common in gemspecs). */
        if (percent) {
          raw += char;
          if (char === "\\") { raw += line[i + 1] ?? ""; code += "  "; i++; continue; }
          if (percent.open && char === percent.open) percent.depth++;
          else if (char === percent.close && --percent.depth === 0) percent = null;
          code += " ";
          continue;
        }
        if (quote) {
          raw += char;
          if (char === "\\") { raw += line[i + 1] ?? ""; code += "  "; i++; continue; }
          if (char === quote) { code += quote === "/" ? " " : char; quote = null; } else code += " ";
          continue;
        }
        if (char === '"' || char === "'") { quote = char; raw += char; code += char; continue; }
        const before = code.replace(/\s+$/, "");
        const operand = !before || OPERAND_START.test(before) || /\b(?:if|unless|when|while|until|and|or|not|return|puts|p)$/.test(before);
        if (char === "%") {
          const literal = /^%([qQwWiIrsx]?)([^\w\s])/.exec(line.slice(i, i + 3));
          if (literal && (literal[1] || operand)) {
            const open = literal[2];
            percent = { open: PAIRS[open] ? open : null, close: PAIRS[open] || open, depth: 1 };
            raw += line.slice(i, i + literal[0].length);
            code += "%" + " ".repeat(literal[0].length - 1);
            i += literal[0].length - 1;
            continue;
          }
        }
        if (char === "/" && operand && line[i + 1] !== " " && line[i + 1] !== "=") { quote = "/"; raw += char; code += " "; continue; }
        if (char === "#") break;
        raw += char; code += char;
      }
      // `<<~TAG`, `<<-TAG`, `<<"TAG"` or `<<TAG` (upper case) opens a heredoc whose
      // body runs to the terminator line. The tag is read from `raw` because a
      // quoted tag is blanked in `code`; `x << y` (with a space) is an append.
      for (const open of code.matchAll(/<<([~-]?)(["']?)(?=[A-Za-z_"'])/g)) {
        const tag = /^[A-Za-z_]\w*/.exec(raw.slice(open.index + open[0].length))?.[0];
        if (tag && (open[1] || open[2] || /^[A-Z_][A-Z0-9_]*$/.test(tag))) { heredoc = { tag, indented: Boolean(open[1]) }; break; }
      }
      out.push({ raw, code, line: number });
    }
    return out;
  }
  /** Kept for callers that want the comment-stripped text itself. */
  const stripRubyComments = text => rubyLines(text).map(item => item.raw).join("\n");

  /**
   * Block nesting per line: `before[i]` is the stack of open blocks when line i
   * starts, each `{ kind, line }`. `kind` is the keyword (`if`, `case`, `def`, ...)
   * or, for `do`/`{` blocks, the first word of the opening line (`group`, `each`).
   */
  function blockStacks(lines) {
    const stack = [], before = [];
    const STATEMENT = /^\s*(?:[\w.@$:\[\]]+\s*(?:=|\|\|=)\s*)?(if|unless|while|until|case|begin|def|class|module|for)\b/;
    for (const { code, line } of lines) {
      before.push(stack.slice());
      const head = STATEMENT.exec(code);
      const loopHead = head && ["while", "until", "for"].includes(head[1]);
      // A one-line `def x = ...` or `class X; end` closes itself through its own `end`.
      if (head && !(head[1] === "def" && /^\s*def\s+[\w.?!]+(?:\([^)]*\))?\s*=/.test(code))) stack.push({ kind: head[1], line });
      const first = /^\s*([A-Za-z_]\w*)/.exec(code)?.[1] || "";
      // Only the keywords themselves: `:end` and `end:` are symbols, `.end` and
      // `end?` are method calls.
      for (const token of code.matchAll(/(?<![.:\w$@])\b(?:do|end)\b(?![:?!\w])|[{}]/g)) {
        const value = token[0];
        if (value === "do") { if (!loopHead) stack.push({ kind: first, line }); }
        else if (value === "{") stack.push({ kind: first, line, brace: true });
        else stack.pop();
      }
    }
    return before;
  }

  /** One literal Ruby string; null for an interpolated or non-literal value. */
  function rubyString(raw) {
    const text = String(raw || "").trim();
    const single = /^'((?:[^'\\]|\\.)*)'$/.exec(text);
    if (single) return single[1].replace(/\\(['\\])/g, "$1");
    const double = /^"((?:[^"\\#]|\\.|#(?!\{))*)"$/.exec(text);
    if (double && !/\\[^"\\]/.test(double[1])) return double[1].replace(/\\(["\\])/g, "$1");
    return null;
  }

  /** `["lib", 'ext']`, `%w[lib ext]` or `"lib"`, optionally `.freeze`, and nothing
   *  else → list of strings; null for anything computed. */
  function rubyStringList(raw) {
    const text = String(raw || "").trim().replace(/\.freeze$/, "").trim();
    // The body may not contain any closing delimiter: `%w[a] - %w[b]` is an
    // expression, not one word list.
    const words = /^%[wW]([[({<])([^\])}>]*)([\])}>])$/.exec(text);
    if (words) {
      const pairs = { "[": "]", "(": ")", "{": "}", "<": ">" };
      if (pairs[words[1]] !== words[3] || /#\{|[[({<]/.test(words[2])) return null;
      return words[2].split(/\s+/).filter(Boolean);
    }
    if (text.startsWith("[") && text.endsWith("]")) {
      const body = text.slice(1, -1).trim();
      if (!body) return [];
      const items = [];
      for (const part of body.split(",").map(item => item.trim()).filter(Boolean)) {
        const value = rubyString(part);
        if (value === null) return null;
        items.push(value);
      }
      return items;
    }
    const single = rubyString(text);
    return single === null ? null : [single];
  }

  /** The literal value of `key: "x"` or `:key => "x"` in an option list; undefined
   *  when absent, null when present but not a literal string. */
  function rubyOption(options, key) {
    const match = new RegExp(String.raw`(?:^|[,\s(])(?:${key}:|:${key}\s*=>)\s*([^,)]+)`).exec(options);
    if (!match) return undefined;
    return rubyString(match[1]);
  }

  const RELATIVE = value => typeof value === "string" && value !== "" && !/^(?:\/|~|[A-Za-z]:)/.test(value);
  const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  /** Reaching the spec object indirectly: a write this reader cannot see. */
  const INDIRECT = /\b(?:send|public_send|__send__|instance_variable_set|instance_eval|instance_exec|class_eval|module_eval|class_exec|module_exec|eval|binding|define_method|method)\b\s*[(:'"]?/;

  /**
   * What one gemspec states, independently of any snapshot.
   * `{ readable, requirePaths: [dir], defaulted, unread: [reason] }` with paths
   * relative to the gemspec's directory.
   */
  function gemspecRequirePaths(text) {
    if (typeof text !== "string") return { readable: false, requirePaths: [], defaulted: false, unread: ["the gemspec could not be read"] };
    const lines = rubyLines(text);
    const header = lines.find(item => /\bGem::Specification\.new\b/.test(item.code));
    if (!header)
      return { readable: false, requirePaths: [], defaulted: false, unread: ["it does not construct a Gem::Specification literally (a YAML, eval or generated gemspec is not run)"] };
    const stacks = blockStacks(lines);
    const headerIndex = lines.indexOf(header);
    const variable = /\bGem::Specification\.new\b[^|]*(?:\bdo\b|\{)\s*\|\s*([a-z_]\w*)/.exec(header.code)?.[1]
      || /\b([a-z_]\w*)\s*=\s*Gem::Specification\.new\b/.exec(header.code)?.[1] || null;
    const opensBlock = /\bGem::Specification\.new\b.*(?:\bdo\b|\{)/.test(header.code);
    const specDepth = stacks[headerIndex].length + (opensBlock ? 1 : 0);
    const assigned = [], unread = [];
    if (!variable) unread.push(`the specification on line ${header.line} is not bound to a block or local variable, so which object require_paths belongs to is not stated`);
    const passes = variable ? new RegExp(String.raw`(?:[(,]\s*|\b(?:yield|return|[a-z_]\w*[!?]?)\s+)${escapeRegExp(variable)}\s*(?:[,)]|$)`) : null;
    for (let index = 0; index < lines.length; index++) {
      const { raw, code, line } = lines[index];
      if (!code.trim()) continue;
      const indirect = INDIRECT.exec(code);
      if (indirect) unread.push(`line ${line} calls ${indirect[0].replace(/[\s(:'"]+$/, "")}, which can set require_paths without writing it`);
      if (passes && index !== headerIndex && passes.test(code)) unread.push(`line ${line} passes the specification ${variable} to other code, which can set require_paths`);
      for (const match of code.matchAll(/\.\s*require_paths?\b/g)) {
        const after = code.slice(match.index + match[0].length);
        const assignment = /^\s*=(?![=~>])/.exec(after);
        if (!assignment) {
          // Only a read handed to another call (`(*s.require_paths)`, `, s.require_paths`)
          // declares nothing; every other use may change the list.
          if (/^\s*(?:[),\]}]|$)/.test(after)) continue;
          unread.push(`require_paths is modified on line ${line} (${raw.trim().slice(0, 80)}), which only running the gemspec decides`);
          continue;
        }
        const depth = stacks[index].length;
        if (depth !== specDepth) {
          const block = stacks[index].at(-1);
          unread.push(`require_paths is assigned on line ${line} inside ${block ? `a \`${block.kind}\` block (line ${block.line})` : "an unexpected scope"}, so whether it runs is decided by evaluating the gemspec`);
          continue;
        }
        // The value as written: the rest of this line in `raw` (strings intact),
        // extended over following lines only while a literal array is still open.
        // `raw` and `code` have equal length (strings are blanked in place).
        const offset = match.index + match[0].length + assignment[0].length;
        let value = raw.slice(offset);
        const open = /^\s*(\[|%[wW][[({<])/.exec(value);
        if (open) {
          const closer = { "[": "]", "(": ")", "{": "}", "<": ">" }[open[1].at(-1)];
          let extra = 0;
          while (!value.slice(open[0].length).includes(closer) && extra < MAX_CONTINUATION && index + 1 < lines.length) { value += " " + lines[++index].raw; extra++; }
        }
        const list = rubyStringList(value.replace(/\s+/g, " ").trim());
        if (!list) { unread.push(`require_paths is assigned a computed value on line ${line} (${value.trim().slice(0, 80)})`); continue; }
        const bad = list.filter(item => !RELATIVE(item));
        if (bad.length) { unread.push(`require_paths on line ${line} names ${bad.join(", ")}, which is not a directory inside the gem`); continue; }
        assigned.push({ line, list });
      }
    }
    if (unread.length) return { readable: true, requirePaths: [], defaulted: false, unread: [...new Set(unread)] };
    const distinct = [...new Set(assigned.map(item => item.list.join("\0")))];
    if (distinct.length > 1)
      return { readable: true, requirePaths: [], defaulted: false, unread: [`require_paths is assigned ${distinct.length} different values (lines ${assigned.map(item => item.line).join(", ")}); which one holds depends on control flow that is not evaluated`] };
    if (!assigned.length) return { readable: true, requirePaths: ["lib"], defaulted: true, unread: [] };
    return { readable: true, requirePaths: assigned[0].list, defaulted: false, unread: [] };
  }

  /** Blocks a Gemfile declaration may sit in and still be activated by a plain
   *  `Bundler.setup`: groups (all are set up unless `without` is configured, which
   *  is environment, not snapshot) and source blocks. */
  const UNCONDITIONAL_BLOCKS = new Set(["group", "source"]);

  /**
   * What one Gemfile states: local gems brought into the bundle.
   * `{ gemspecs: [{ dir, name|null, line }], pathGems: [{ name, dir, line }], unread: [reason] }`
   * with directories relative to the Gemfile's directory.
   */
  function gemfileDeclarations(text) {
    const out = { gemspecs: [], pathGems: [], unread: [] };
    if (typeof text !== "string") { out.unread.push("the Gemfile could not be read"); return out; }
    const lines = rubyLines(text), stacks = blockStacks(lines);
    const names = new Map();
    for (let index = 0; index < lines.length; index++) {
      const start = index, line = lines[index].line;
      // An option list continued on following lines (`gem "x",\n  path: "y"`):
      // only each new line's own tail is tested, so the join is linear.
      const parts = [lines[index].raw];
      while (/(?:,|\\)\s*$/.test(parts.at(-1)) && index + 1 < lines.length && parts.length <= MAX_CONTINUATION) parts.push(lines[++index].raw);
      if (parts.length > MAX_CONTINUATION) { out.unread.push(`the statement on line ${line} continues over more than ${MAX_CONTINUATION} lines and is not read`); continue; }
      const trimmed = parts.map(part => part.replace(/\\\s*$/, "")).join(" ").trim();
      if (!trimmed) continue;
      const enclosing = stacks[start].find(block => !UNCONDITIONAL_BLOCKS.has(block.kind));
      const conditional = enclosing ? `sits inside a \`${enclosing.kind}\` block (line ${enclosing.line}), which is not evaluated` : null;
      if (INDIRECT.test(lines[start].code)) { out.unread.push(`line ${line} evaluates code (${trimmed.slice(0, 60)}), which can declare gems`); continue; }
      if (/^gemspec\b/.test(trimmed)) {
        if (conditional) { out.unread.push(`gemspec on line ${line} ${conditional}`); continue; }
        const options = trimmed.slice("gemspec".length);
        const path = rubyOption(options, "path"), name = rubyOption(options, "name");
        if (path === null || name === null) { out.unread.push(`gemspec on line ${line} has a computed path: or name: option`); continue; }
        if (path !== undefined && !RELATIVE(path) && path !== ".") { out.unread.push(`gemspec on line ${line} points at ${path}, outside the snapshot`); continue; }
        out.gemspecs.push({ dir: path === undefined ? "." : path, name: name ?? null, line });
        continue;
      }
      const gem = /^gem\s*\(?\s*(['"])([^'"#]+)\1(.*)$/.exec(trimmed);
      if (gem) {
        names.set(gem[2], (names.get(gem[2]) || 0) + 1);
        const path = rubyOption(gem[3], "path");
        if (path === undefined) continue;
        if (conditional) { out.unread.push(`gem "${gem[2]}" on line ${line} ${conditional}`); continue; }
        if (/(?:^|[,\s(])(?:platforms?|install_if):|:(?:platforms?|install_if)\s*=>/.test(gem[3])) { out.unread.push(`gem "${gem[2]}" on line ${line} is conditional (platforms/install_if), which is not evaluated`); continue; }
        if (path === null) { out.unread.push(`gem "${gem[2]}" on line ${line} has a computed path: option`); continue; }
        if (!RELATIVE(path) && path !== ".") { out.unread.push(`gem "${gem[2]}" on line ${line} points at ${path}, outside the snapshot`); continue; }
        out.pathGems.push({ name: gem[2], dir: path, line });
        continue;
      }
      if (/^path\b/.test(trimmed)) { out.unread.push(`the path source block on line ${line} loads every gemspec below a directory, which is not reproduced`); continue; }
      if (/^eval_gemfile\b/.test(trimmed)) { out.unread.push(`eval_gemfile on line ${line} evaluates another file, which is not run`); continue; }
    }
    // A gem declared twice is decided by whichever declaration Bundler keeps,
    // which depends on the branch that runs.
    out.pathGems = out.pathGems.filter(item => {
      if ((names.get(item.name) || 0) < 2) return true;
      out.unread.push(`gem "${item.name}" is declared ${names.get(item.name)} times; which declaration Bundler keeps depends on evaluating the Gemfile`);
      return false;
    });
    return out;
  }

  manifests.register({
    id: "project-ruby",
    forms: ["ruby-require"],
    create(context) {
      const { has, textOf, collect, verdicts, files } = context;
      const { resolved, candidate, unresolved } = verdicts;

      /** Directories that hold at least one included file. A declared require path
       *  with none is outside the snapshot, excluded from it, or absent: its
       *  contents are unknown, not empty. */
      let populated = null;
      const holdsFiles = dir => {
        if (!populated) {
          populated = new Set([""]);
          for (const file of files) for (let at = file.lastIndexOf("/"); at > 0; at = file.lastIndexOf("/", at - 1)) {
            const dir = file.slice(0, at);
            if (populated.has(dir)) break;
            populated.add(dir);
          }
        }
        return populated.has(dir);
      };

      /* ------------------------------------------------------------- gems */
      let gemList = null;
      /** Every gemspec with the directories it puts on $LOAD_PATH. */
      function gems() {
        if (gemList) return gemList;
        gemList = collect(name => name.endsWith(".gemspec") && name.length > ".gemspec".length).map(entry => {
          const read = gemspecRequirePaths(textOf(entry.path));
          const unread = read.unread.map(reason => `${entry.path}: ${reason}`);
          const loadPath = [];
          for (const item of read.requirePaths) {
            const dir = joinPath(entry.dir, item);
            const quote = read.defaulted ? `${entry.path} (RubyGems default require_paths ["lib"])` : `${entry.path} require_paths "${item}"`;
            if (dir === null) { unread.push(`${entry.path}: require_paths "${item}" is outside the snapshot, so what it holds is unknown`); continue; }
            loadPath.push({ dir, source: entry.path, quote, rule: read.defaulted ? "ruby-gemspec-default-require-path" : "ruby-gemspec-require-path" });
          }
          return { path: entry.path, dir: entry.dir, name: baseOf(entry.path).replace(/\.gemspec$/, ""), loadPath, unread };
        });
        return gemList;
      }
      const gemsIn = dir => gems().filter(gem => gem.dir === dir);

      let bundleList = null;
      /** Every Gemfile with the load path of the local gems it activates. Bundler
       *  looks for gems.rb before Gemfile, so a Gemfile beside a gems.rb is ignored. */
      function bundles() {
        if (bundleList) return bundleList;
        const found = collect(["gems.rb", "Gemfile"]);
        const withGemsRb = new Set(found.filter(entry => entry.name === "gems.rb").map(entry => entry.dir));
        bundleList = found.filter(entry => entry.name === "gems.rb" || !withGemsRb.has(entry.dir)).map(entry => {
          const read = gemfileDeclarations(textOf(entry.path));
          const loadPath = [], activated = new Set(), unread = read.unread.map(reason => `${entry.path}: ${reason}`);
          const activate = (gem, via, rule) => {
            activated.add(gem.path);
            unread.push(...gem.unread);
            for (const item of gem.loadPath) loadPath.push({ ...item, quote: `${via} → ${item.quote}`, rule, gemspecRule: item.rule });
          };
          for (const declaration of read.gemspecs) {
            const dir = joinPath(entry.dir, declaration.dir);
            const matches = dir === null ? [] : gemsIn(dir).filter(gem => !declaration.name || gem.name === declaration.name);
            if (matches.length !== 1) {
              unread.push(`${entry.path}: gemspec on line ${declaration.line} finds ${matches.length ? `${matches.length} gemspecs (${matches.map(gem => gem.path).join(", ")}) and names none` : `no gemspec in ${dir || "the snapshot root"}`}`);
              continue;
            }
            activate(matches[0], `${entry.path} gemspec (line ${declaration.line})`, "ruby-bundler-gemspec");
          }
          for (const declaration of read.pathGems) {
            const dir = joinPath(entry.dir, declaration.dir);
            const all = dir === null ? [] : gemsIn(dir);
            const named = all.filter(gem => gem.name === declaration.name);
            const matches = named.length ? named : all;
            if (matches.length !== 1) {
              unread.push(`${entry.path}: gem "${declaration.name}" path: "${declaration.dir}" on line ${declaration.line} finds ${matches.length ? `${matches.length} gemspecs` : "no gemspec"} in ${dir || "the snapshot root"}; Bundler's generated stand-in specification is not reproduced`);
              continue;
            }
            activate(matches[0], `${entry.path} gem "${declaration.name}", path: "${declaration.dir}" (line ${declaration.line})`, "ruby-bundler-path-gem");
          }
          return { path: entry.path, dir: entry.dir, loadPath, activated, unread };
        });
        return bundleList;
      }

      const nearestBy = (list, path) => {
        let best = null;
        for (const item of list) if (contains(item.dir, path) && (!best || item.dir.length > best.dir.length)) best = item;
        return best;
      };

      /** The declared $LOAD_PATH a file runs under: its own gem's require_paths and
       *  every local gem its nearest bundle activates. A bundle nested inside the gem
       *  (an example app, a benchmark harness) runs with what *it* activates, so the
       *  enclosing gem counts only when that bundle activates it. */
      function scopeFor(path) {
        const gemDir = nearestBy(gems(), path)?.dir;
        const bundle = nearestBy(bundles(), path);
        let own = gemDir === undefined ? [] : gemsIn(gemDir);
        if (bundle && gemDir !== undefined && bundle.dir.length > gemDir.length) own = own.filter(gem => bundle.activated.has(gem.path));
        const loadPath = [], seen = new Set(), unread = [];
        for (const gem of own) { unread.push(...gem.unread); for (const item of gem.loadPath) if (!seen.has(item.dir)) { seen.add(item.dir); loadPath.push(item); } }
        if (bundle) { unread.push(...bundle.unread); for (const item of bundle.loadPath) if (!seen.has(item.dir)) { seen.add(item.dir); loadPath.push(item); } }
        return { loadPath, unread: [...new Set(unread)], declared: Boolean(own.length || bundle) };
      }

      const pathsEnding = suffix => files.filter(file => file === suffix || file.endsWith("/" + suffix));

      /* ------------------------------------------------------------ resolver */
      return function resolveRuby(path, fact) {
        if (!/\.rb$/.test(path)) return null;
        const specifier = String(fact.specifier || "");
        // A path require is relative to the working directory or absolute; a
        // native extension is not a Ruby source file. Neither is a load-path rule.
        if (!specifier || /^(?:\.{1,2}\/|\/|~)/.test(specifier) || /\.(?:so|bundle|dll|o)$/.test(specifier)) return null;
        const scope = scopeFor(path);
        if (!scope.declared || (!scope.loadPath.length && !scope.unread.length)) return null;
        const feature = specifier.replace(/\.rb$/, "") + ".rb";
        const hits = [];
        for (const [order, item] of scope.loadPath.entries()) {
          const target = item.dir ? `${item.dir}/${feature}` : feature;
          if (has(target) && !hits.some(hit => hit.target === target)) hits.push({ target, item, order });
        }
        const searched = scope.loadPath.map(item => item.quote).join("; ");
        if (hits.length === 1) {
          const { target, item, order } = hits[0];
          /* A declared directory with no included file may still hold the feature.
             Within one gem, require_paths keep their declared order, so a later one
             cannot shadow the hit; another gem's directory may sit anywhere. */
          const unknown = scope.loadPath.filter((entry, at) => !holdsFiles(entry.dir) && (entry.source !== item.source || at < order));
          const blockers = [...scope.unread, ...unknown.map(entry => `${entry.quote} names ${entry.dir || "the snapshot root"}, which holds no included file (outside, excluded or absent), so what it supplies is unknown`)];
          if (!blockers.length)
            return resolved([target], item.rule, { loadPathEntry: item.dir || ".", declaration: item.quote, manifest: item.source, feature, searched: scope.loadPath.map(entry => entry.dir || ".") });
          return candidate([target], "ruby-require-unread-declaration",
            `${feature} is found under ${item.quote}, but ${blockers.join("; ")}, so a directory ahead of it on $LOAD_PATH is not ruled out`);
        }
        if (hits.length > 1)
          return candidate(hits.map(hit => hit.target).sort(), "ruby-require-several-load-paths",
            `${feature} exists under ${hits.length} declared require paths (${hits.map(hit => hit.item.quote).join("; ")}); Ruby takes the first on $LOAD_PATH, and the activation order is not stated by any manifest`);
        const elsewhere = pathsEnding(feature);
        if (elsewhere.length)
          return candidate(elsewhere.sort(), "ruby-require-undeclared-load-path",
            `${feature} is not under any declared require path (${searched || "none readable"}); ${elsewhere.length === 1 ? `${elsewhere[0]} matches` : `${elsewhere.length} files match`} only if a -I flag, RUBYLIB, Rake or RSpec configuration adds its directory, and none of those is read${scope.unread.length ? `; also ${scope.unread.join("; ")}` : ""}`);
        return unresolved(
          `${feature} is not under any declared require path (${searched || "none readable"}) and no included file supplies it, so it comes from an installed gem or the standard library`,
          "ruby-require-outside-declared-paths",
          { external: { name: specifier, kind: "gem", specifier } },
        );
      };
    },
  });

  root.SkylenseProjectRuby = Object.freeze({ gemspecRequirePaths, gemfileDeclarations, stripRubyComments });
})(typeof window !== "undefined" ? window : globalThis);
