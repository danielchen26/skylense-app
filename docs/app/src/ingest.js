/* Skylense source analysis. Pure, bounded, and intentionally independent of execution. */
(function (root) {
  "use strict";
  const LIMITS = Object.freeze({ maxFiles: 300, maxFileBytes: 256 * 1024, maxTotalBytes: 10 * 1024 * 1024, maxEntities: 1000, maxSymbolsPerFile: 100, maxSymbolsTotal: 2000, maxDocumentSymbolsPerFile: 20, maxDocumentSymbolsTotal: 200, maxDocumentNavigation: 100, maxEvidenceBytes: 1024 * 1024, maxSerializedBytes: 14 * 1024 * 1024, maxEdges: 3000 });
  const EXCLUDED_DIRS = new Set([".git", ".hg", ".svn", "node_modules", ".venv", "venv", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox", ".cache", "coverage", ".next", ".nuxt", "dist", "build", "target", "vendor"]);
  const CODE = { jl: "julia", py: "python", pyw: "python", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript", go: "go", rs: "rust", java: "java", c: "c", h: "c", cpp: "cpp", hpp: "cpp", cc: "cpp", cs: "csharp", rb: "ruby", php: "php", swift: "swift", kt: "kotlin", scala: "scala", sh: "shell", bash: "shell", zsh: "shell", sql: "sql", r: "r", lua: "lua", vue: "vue", svelte: "svelte" };
  const TEXT = new Set(["txt", "md", "mdx", "markdown", "rst", "html", "htm", "css", "scss", "sass", "less", "json", "jsonc", "yaml", "yml", "toml", "ini", "cfg", "conf", "xml", "csv", "tsv", "log", "lock", "properties", "gitignore", "gitattributes", "editorconfig", "dockerignore", "svg"]);
  const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "ico", "avif", "bmp", "tif", "tiff", "heic"]);
  const ARCHIVE = new Set(["zip", "tar", "gz", "bz2", "xz", "7z", "rar", "tgz"]);
  const BINARY = new Set(["wasm", "exe", "dll", "so", "dylib", "a", "o", "obj", "class", "pyc", "pyo", "db", "sqlite", "sqlite3", "woff", "woff2", "ttf", "otf", "mp3", "mp4", "mov", "webm", "wav", "ogg", "flac", "parquet", "npy", "npz", "pickle", "pkl", "pt", "pth", "safetensors", "onnx", "h5", "hdf5", "ckpt", "bin"]);
  const encoder = new TextEncoder();
  const baseName = (path) => path.split("/").pop();
  function isSensitive(path) {
    return path.split("/").some((part) => /^(?:\.env(?:\..*)?|\.ssh|\.aws|\.gnupg|\.kube|\.git-credentials|\.npmrc|\.pypirc|\.netrc|credentials(?:\.[\w-]+)?|secrets?(?:\.[\w-]+)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|.*\.(?:pem|key|p12|pfx|keystore))$/i.test(part));
  }
  function isExcludedPath(path) {
    if (typeof path !== "string") return true;
    const parts = path.replace(/\\/g, "/").split("/");
    return parts.some((part) => EXCLUDED_DIRS.has(part.toLowerCase())) || isSensitive(path.replace(/\\/g, "/"));
  }
  function classifyPath(path) {
    const name = baseName(String(path).replace(/\\/g, "/")).toLowerCase(), ext = name.includes(".") ? name.split(".").pop() : "";
    const sensitive = isSensitive(String(path));
    if (sensitive) return { kind: "sensitive", language: null, text: false, sensitive: true };
    if (CODE[ext]) return { kind: "source", language: CODE[ext], text: true, sensitive: false };
    if (["html", "htm"].includes(ext)) return { kind: "document", language: "html", text: true, sensitive: false };
    if (["md", "mdx", "markdown"].includes(ext)) return { kind: "document", language: "markdown", text: true, sensitive: false };
    if (TEXT.has(ext) || /^(?:readme|license|licence|copying|notice|makefile|dockerfile|gemfile|procfile)$/i.test(name)) return { kind: ["json", "yaml", "yml", "toml", "ini", "cfg", "conf", "lock"].includes(ext) ? "config" : "document", language: ext || "text", text: true, sensitive: false };
    return { kind: IMAGE.has(ext) ? "image" : ARCHIVE.has(ext) ? "archive" : ext === "pdf" ? "pdf" : BINARY.has(ext) ? "binary" : "file", language: null, text: false, sensitive: false };
  }
  // The same deterministic order controls every transport before file/content
  // budgets. Source trees win over documents, generated reports and agent notes.
  function pathPriority(path) {
    const value = String(path).replace(/\\/g, "/"), info = classifyPath(value);
    const parts = value.toLowerCase().split("/"), name = parts.at(-1);
    const auxiliary = parts.some(part => [".claude", ".codex", ".agents", "archive", "archives", "reports", "results"].includes(part));
    const sourceRoot = parts.some(part => ["src", "lib", "app", "apps", "packages", "server", "client"].includes(part));
    if (info.kind === "source") return auxiliary ? 4 : sourceRoot ? 0 : 1;
    if (info.kind === "config") return auxiliary ? 5 : 2;
    if (parts.length === 1 && /^(readme|license|licence|notice|copying)(\.|$)/.test(name)) return 2;
    if (info.text) return auxiliary ? 6 : 3;
    return 7;
  }
  function comparePaths(a, b) {
    const x = typeof a === "string" ? a : a.path, y = typeof b === "string" ? b : b.path;
    return pathPriority(x) - pathPriority(y) || (x < y ? -1 : x > y ? 1 : 0);
  }
  function normalizePath(input) {
    if (typeof input !== "string" || input.length > 4096 || /[\u0000-\u001f\u007f]/.test(input)) return null;
    let path = input.replace(/\\/g, "/");
    if (/^(?:\/|[a-z]:|[a-z][\w+.-]*:\/\/)/i.test(path)) return null;
    const parts = [];
    for (const part of path.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") return null;
      parts.push(part);
    }
    return parts.length && parts.length <= 61 ? parts.join("/") : null;
  }
  function joinRelative(base, suffix) {
    const parts = base ? base.split("/") : [];
    for (const part of suffix.replace(/\\/g, "/").split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") { if (!parts.length) return null; parts.pop(); }
      else parts.push(part);
    }
    return parts.join("/");
  }
  function hash(value) {
    let a = 2166136261, b = 2246822519;
    for (let i = 0; i < value.length; i++) { a = Math.imul(a ^ value.charCodeAt(i), 16777619); b = Math.imul(b ^ value.charCodeAt(i), 3266489917); }
    return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
  }
  function idFactory() {
    const claimed = new Map();
    return (prefix, value) => {
      const key = prefix + ":" + value, stem = prefix + "_" + hash(key);
      let id = stem, suffix = 1;
      while (claimed.has(id) && claimed.get(id) !== key) id = stem + "_" + suffix++;
      claimed.set(id, key); return id;
    };
  }
  function bound(value, fallback, ceiling) { return Number.isSafeInteger(value) && value > 0 ? Math.min(value, ceiling) : fallback; }
  function safeUrl(value) { try { const u = new URL(value); return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; } }
  function truncateBytes(text, limit, bytes = encoder.encode(text)) {
    if (bytes.length <= limit) return { text, bytes: bytes.length, truncated: false };
    let stop = limit;
    while (stop > 0 && (bytes[stop] & 0xc0) === 0x80) stop--;
    return { text: new TextDecoder().decode(bytes.subarray(0, stop)), bytes: stop, truncated: true };
  }
  // Reuse source offsets across every excerpt and HTML reference in one build.
  // LF boundaries preserve split("\n") semantics, including CRLF and an empty
  // final line, without splitting or rescanning a complete file per reference.
  function indexLines(text) {
    const starts = [0];
    for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) starts.push(at + 1);
    return {
      length: starts.length,
      lineAt(offset) {
        let low = 0, high = starts.length;
        while (low < high) { const middle = (low + high) >>> 1; if (starts[middle] <= offset) low = middle + 1; else high = middle; }
        return low;
      },
      excerpt(start, end) {
        if (start > end || start > starts.length) return "";
        return text.slice(starts[start - 1], end < starts.length ? starts[end] - 1 : text.length);
      },
    };
  }
  function lineEvidence(file, lines, start, end = start, url) {
    const lineStart = Math.max(1, start), lineEnd = Math.min(lines.length, end);
    return { file, lineStart, lineEnd, excerpt: lines.excerpt(lineStart, lineEnd), ...(url ? { url } : {}) };
  }
  // Tokens retain source offsets. Comments, quoted data, template bodies and Python
  // triple strings cannot manufacture declarations or dependency keywords.
  function tokenize(text, python = false) {
    const tokens = []; let i = 0, line = 1;
    const push = (kind, value, start, atLine) => tokens.push({ kind, value, start, end: i, line: atLine, endLine: line });
    while (i < text.length) {
      let c = text[i], start = i, atLine = line;
      if (/\s/.test(c)) { if (c === "\n") line++; i++; continue; }
      if ((python && c === "#") || (!python && text.slice(i, i + 2) === "//")) { while (i < text.length && text[i] !== "\n") i++; continue; }
      if (!python && text.slice(i, i + 2) === "/*") { i += 2; while (i < text.length && text.slice(i, i + 2) !== "*/") { if (text[i] === "\n") line++; i++; } i = Math.min(text.length, i + 2); continue; }
      if (c === "\"" || c === "'" || (!python && c === "`")) {
        const triple = python && text.slice(i, i + 3) === c.repeat(3), delimiter = triple ? c.repeat(3) : c; i += delimiter.length;
        let value = "", escaped = false;
        while (i < text.length && text.slice(i, i + delimiter.length) !== delimiter) {
          if (text[i] === "\n") line++;
          if (text[i] === "\\") { escaped = true; value += text.slice(i, i + 2); i += 2; }
          else value += text[i++];
        }
        const closed = text.slice(i, i + delimiter.length) === delimiter;
        if (closed) i += delimiter.length;
        push(triple || c === "`" || escaped || !closed ? "data" : "string", value, start, atLine); continue;
      }
      if (!python && c === "/") {
        const prev = tokens[tokens.length - 1], before = tokens[tokens.length - 2];
        // Arrow punctuation is tokenized separately; only an adjacent => pair
        // opens an expression here, not an arbitrary greater-than comparison.
        const afterArrow = prev?.value === ">" && before?.value === "=" && before.end === prev.start;
        if (!prev || afterArrow || ["=", "(", "[", "{", ":", ",", ";", "!", "?", "return", "yield"].includes(prev.value)) {
          i++; let bracket = false;
          while (i < text.length && text[i] !== "\n") { const ch = text[i++]; if (ch === "\\") i++; else if (ch === "[") bracket = true; else if (ch === "]") bracket = false; else if (ch === "/" && !bracket) break; }
          while (/[a-z]/i.test(text[i] || "")) i++;
          push("data", "", start, atLine); continue;
        }
      }
      if (/[\p{L}_$]/u.test(c)) { i++; while (i < text.length && /[\p{L}\p{N}_$]/u.test(text[i])) i++; push("word", text.slice(start, i), start, atLine); continue; }
      i++; push("punct", c, start, atLine);
    }
    return tokens;
  }
  function codeFacts(text, language) {
    const python = language === "python", tokens = tokenize(text, python), symbols = [], imports = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i], next = tokens[i + 1], prev = tokens[i - 1];
      if (t.kind !== "word") continue;
      if ((python && ["def", "class"].includes(t.value)) || (!python && ["function", "class", "interface", "enum"].includes(t.value))) {
        const name = next?.value === "*" ? tokens[i + 2] : next;
        if (name?.kind === "word" && (!prev || prev.value !== ".")) symbols.push({ name: name.value, kind: t.value === "def" ? "function" : t.value, line: t.line, endLine: name.endLine });
      }
      if (!python && ["const", "let", "var"].includes(t.value) && next?.kind === "word") {
        // A lexical arrow-function declaration; scan only this statement, at most 60 tokens.
        const slice = tokens.slice(i + 2, i + 62); let arrow = false;
        for (let k = 0; k < slice.length - 1; k++) { if (slice[k].value === ";" || ["const", "let", "var"].includes(slice[k].value)) break; if (slice[k].value === "=" && slice[k + 1].value === ">") { arrow = true; break; } }
        if (arrow) symbols.push({ name: next.value, kind: "function", line: t.line, endLine: next.endLine });
      }
      if (python && ["import", "from"].includes(t.value)) {
        // Python import statements must begin a physical line (possibly after a
        // semicolon/colon). Parenthesized imports may span lines.
        if (prev && prev.endLine === t.line && ![";", ":"].includes(prev.value)) continue;
        let end = i + 1, depth = 0;
        while (end < tokens.length) { const x = tokens[end]; if (!depth && (x.line > tokens[end - 1].endLine || x.value === ";")) break; if (x.value === "(") depth++; if (x.value === ")") depth--; end++; }
        const part = tokens.slice(i + 1, end);
        if (t.value === "from") {
          const at = part.findIndex((x) => x.kind === "word" && x.value === "import");
          if (at < 0) continue;
          const module = part.slice(0, at).map((x) => x.value).join("");
          if (!/^[.\p{L}\p{N}_]+$/u.test(module)) continue;
          const names = []; let expect = true;
          for (const x of part.slice(at + 1)) { if (x.value === ",") expect = true; else if (expect && (x.kind === "word" || x.value === "*")) { names.push(x.value); expect = false; } }
          imports.push({ specifier: module, names, form: "python-from", line: t.line, endLine: part.at(-1)?.endLine || t.line });
        } else {
          let name = "", alias = false;
          for (const x of [...part, { value: "," }]) { if (x.value === ",") { if (name) imports.push({ specifier: name, names: [], form: "python-import", line: t.line, endLine: part.at(-1)?.endLine || t.line }); name = ""; alias = false; } else if (x.value === "as") alias = true; else if (!alias && (x.kind === "word" || x.value === ".")) name += x.value; }
        }
      }
      if (!python && ["import", "export", "require"].includes(t.value) && prev?.value !== ".") {
        if (t.value === "require" || (t.value === "import" && next?.value === "(")) {
          const target = tokens[i + 2];
          if (next?.value === "(" && target?.kind === "string" && [")", ","].includes(tokens[i + 3]?.value)) imports.push({ specifier: target.value, form: t.value === "require" ? "commonjs-literal" : "dynamic-literal", line: t.line, endLine: target.endLine });
        } else if (t.value === "import" && next?.kind === "string") imports.push({ specifier: next.value, form: "javascript-static", line: t.line, endLine: next.endLine });
        else {
          for (let j = i + 1; j < Math.min(tokens.length, i + 160); j++) {
            const x = tokens[j]; if (x.value === ";" || (j > i + 1 && ["import", "export", "const", "function"].includes(x.value))) break;
            if (x.value === "from" && tokens[j + 1]?.kind === "string") { imports.push({ specifier: tokens[j + 1].value, form: "javascript-static", line: t.line, endLine: tokens[j + 1].endLine }); break; }
          }
        }
      }
    }
    return { symbols, imports };
  }
  function documentFacts(text, language, lines) {
    const symbols = [], imports = [], lineAt = lines.lineAt;
    if (language === "markdown") {
      let fenced = false; const lines = text.split("\n");
      lines.forEach((line, index) => {
        if (/^\s*(?:```|~~~)/.test(line)) { fenced = !fenced; return; } if (fenced) return;
        const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/); if (heading) symbols.push({ name: heading[1], kind: "section", line: index + 1, endLine: index + 1 });
        for (const match of line.matchAll(/(?<!!)\[[^\]\n]*\]\(<?([^\s)>]+)>?(?:\s+["'][^)]*)?\)/g)) imports.push({ specifier: match[1], form: "markdown-link", line: index + 1, endLine: index + 1 });
      });
    } else {
      // Preserve resource-bearing opening tags while masking executable/style
      // bodies. Script data cannot manufacture tags, but an authored script src
      // is a useful, explicit source relationship even though no code is run.
      const blank = (value) => value.replace(/[^\n]/g, " "), pieces = [];
      // Scan whole tags before finding raw-text bodies: a literal "<script>"
      // inside another tag's quoted attribute is not a script element.
      const markup = /<!--[\s\S]*?(?:-->|$)|<\/?([a-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
      let cursor = 0, rawTag;
      while ((rawTag = markup.exec(text))) {
        if (rawTag[0].startsWith("<!--")) {
          pieces.push(text.slice(cursor, rawTag.index), blank(rawTag[0])); cursor = markup.lastIndex;
        } else if (!rawTag[0].startsWith("</") && /^(?:script|style)$/i.test(rawTag[1])) {
          const close = new RegExp("</" + rawTag[1] + "\\s*>", "gi"); close.lastIndex = markup.lastIndex;
          const closing = close.exec(text), end = closing ? closing.index : text.length;
          pieces.push(text.slice(cursor, markup.lastIndex), blank(text.slice(markup.lastIndex, end)));
          cursor = end; markup.lastIndex = closing ? close.lastIndex : text.length;
        }
      }
      const masked = pieces.join("") + text.slice(cursor);
      let heading = null;
      // Match whole tags before examining attributes, so data-href and strings
      // inside other attributes cannot masquerade as an authored hyperlink.
      for (const match of masked.matchAll(/<\/?([a-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
        const tag = match[1].toLowerCase(), closing = match[0].startsWith("</");
        if (/^h[1-6]$/.test(tag)) {
          if (!closing) heading = { tag, start: match.index, body: match.index + match[0].length };
          else if (heading?.tag === tag) { const name = masked.slice(heading.body, match.index).replace(/<[^>]*>/g, "").trim(); if (name) symbols.push({ name, kind: "section", line: lineAt(heading.start), endLine: lineAt(match.index + match[0].length) }); heading = null; }
        }
        if (closing || !["a", "link", "script"].includes(tag)) continue;
        const attributes = match[0].slice(1 + match[1].length, -1);
        const values = new Map();
        for (const attr of attributes.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
          const name = attr[1].toLowerCase();
          // HTML keeps the first value when an attribute is duplicated.
          if (!values.has(name)) values.set(name, attr[2] || attr[3] || attr[4] || "");
        }
        const attribute = tag === "script" ? "src" : "href";
        if (!values.has(attribute)) continue;
        const form = tag === "script" ? "html-script" : tag === "link" && /(?:^|\s)stylesheet(?:\s|$)/i.test(values.get("rel") || "") ? "html-stylesheet" : "html-link";
        imports.push({ specifier: values.get(attribute), form, line: lineAt(match.index), endLine: lineAt(match.index + match[0].length) });
      }
    }
    return { symbols, imports };
  }
  function build(entries, options = {}) {
    if (!Array.isArray(entries)) throw new TypeError("entries must be an array of file descriptors.");
    const complete = options.mode === "complete";
    const limits = { ...LIMITS, maxFiles: bound(options.maxFiles, LIMITS.maxFiles, 100000), maxFileBytes: bound(options.maxFileBytes, LIMITS.maxFileBytes, LIMITS.maxFileBytes), maxTotalBytes: bound(options.maxTotalBytes, LIMITS.maxTotalBytes, LIMITS.maxTotalBytes) };
    if (complete) Object.assign(limits, { maxFiles: 100000, maxFileBytes: 64 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024, maxEntities: 500000, maxSymbolsPerFile: Number.MAX_SAFE_INTEGER, maxSymbolsTotal: Number.MAX_SAFE_INTEGER, maxDocumentSymbolsPerFile: Number.MAX_SAFE_INTEGER, maxDocumentSymbolsTotal: Number.MAX_SAFE_INTEGER, maxDocumentNavigation: Number.MAX_SAFE_INTEGER, maxEdges: 500000, maxEvidenceBytes: 128 * 1024 * 1024, maxSerializedBytes: 128 * 1024 * 1024 });
    const resourceFailure = message => { throw Object.assign(new Error(message + " Complete indexing stopped; choose a narrower source or explicitly request preview mode."), { code: "RESOURCE_LIMIT" }); };

    const report = { ...(options.report && typeof options.report === "object" ? options.report : {}), analyzer: options.report?.syntax?.engine === "tree-sitter" ? "skylense-syntax-v1" : "skylense-static-v2", mode: complete ? "complete" : "preview", limits, inputEntries: entries.length, acceptedFiles: 0, analyzedFiles: 0, metadataOnlyFiles: 0, textBytes: 0, truncatedFiles: 0, skipped: Array.isArray(options.report?.skipped) ? options.report.skipped.slice(0, 1000) : [], warnings: Array.isArray(options.report?.warnings) ? options.report.warnings.slice(0, 1000) : [], unresolved: [], capabilities: { hierarchy: "Filesystem and source declaration boundaries for accepted paths; syntax nesting when a supported parser is available", symbols: "Supported syntax-tree declarations, lexical fallbacks and authored document headings; parser coverage is reported per file", relationships: "Included static import/link/resource references, declared external dependencies, and conservatively bound call sites", execution: false, aiInference: false, unsupported: "Other text is previewed; binary/PDF/image/archive contents are metadata only. Literal JS dynamic imports and re-exports are supported. Computed targets, dynamic member dispatch, notebook cells and arbitrary-language runtime call graphs are not resolved; configured path resolution depends on included manifests. Python bare calls may abstain for shadowing, ambiguity or missing sources." } };
    let symbolsUsed = 0, evidenceBytes = 0, evidenceTruncated = 0;
    const sourceLines = new Map(), excerptCache = new Map();
    function evidence(file, text, start, end, url) {
      if (!sourceLines.has(file)) sourceLines.set(file, indexLines(text));
      const key = file + "\0" + start + "\0" + end;
      let cached = excerptCache.get(key);
      if (!cached) {
        const item = lineEvidence(file, sourceLines.get(file), start, end, url), bytes = encoder.encode(item.excerpt);
        const clipped = truncateBytes(item.excerpt, 2048, bytes);
        cached = { item: { ...item, excerpt: clipped.text }, byteLength: bytes.length, clipped };
        // Scratch data belongs to this build only. Cap retained previews, not
        // graph facts; every uncached reference follows the same extraction.
        if (excerptCache.size < 8192) excerptCache.set(key, cached);
      }
      const item = { ...cached.item }, remaining = Math.max(0, limits.maxEvidenceBytes - evidenceBytes);
      if (complete && remaining < Math.min(2048, cached.byteLength)) resourceFailure("Source evidence safety ceiling reached.");
      const clipped = remaining >= 2048 ? cached.clipped : { ...truncateBytes(cached.clipped.text, remaining), truncated: cached.byteLength > remaining };
      evidenceBytes += clipped.bytes;
      if (clipped.truncated) { item.excerpt = clipped.text; item.excerptTruncated = true; evidenceTruncated++; }
      return item;
    }
    const noteSkip = (path, reason) => { if (report.skipped.length < 1000) report.skipped.push({ path, reason }); };
    const id = idFactory(), rootId = id("dir", "."), nodes = [], hierarchy = [], documents = [], edges = [], accepted = new Map(), directoryIds = new Map([["", rootId]]);
    const title = typeof options.title === "string" && options.title.trim() ? options.title.trim().slice(0, 240) : "Imported workspace";
    const group = { id: rootId, label: title, color: "#5b93be", kind: "container", parentId: null, group: rootId, level: 1, path: "", description: "Source hierarchy · expand folders to inspect files. Containment does not imply execution." };
    hierarchy.push({ ...group });
    const prepared = [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") { noteSkip("", "Invalid entry"); continue; }
      const path = normalizePath(entry.path);
      if (!path) { if (complete) resourceFailure("Invalid or unsupported source path."); noteSkip(String(entry.path || "").slice(0, 300), "Invalid or excessively deep relative path"); continue; }
      if (isExcludedPath(path)) { noteSkip(path, "Excluded generated, dependency, version-control or sensitive path"); continue; }
      prepared.push({ ...entry, path, ...(entry.kind === "directory" || /[\\/]$/.test(entry.path) ? { kind: "directory" } : {}) });
    }
    prepared.sort(comparePaths);
    function ensureDirectories(path, itself = false) {
      const parts = path.split("/"); if (!itself) parts.pop();
      let parent = rootId, current = "";
      for (const part of parts) { current = current ? current + "/" + part : part; if (!directoryIds.has(current)) { const cid = id("dir", current); directoryIds.set(current, cid); hierarchy.push({ id: cid, label: part, kind: "container", group: rootId, parentId: parent, level: current.split("/").length + 1, path: current, description: "Directory boundary · actual source path" }); } parent = directoryIds.get(current); }
      return parent;
    }
    let fileCount = 0;
    for (const entry of prepared) {
      const directory = entry.status === "directory" || entry.kind === "directory" || /[\\/]$/.test(entry.path);
      if (accepted.has(entry.path)) { noteSkip(entry.path, "Duplicate path; first descriptor retained"); continue; }
      if (!directory && fileCount >= limits.maxFiles) { if (complete) resourceFailure("Source file safety ceiling reached."); noteSkip(entry.path, "File count limit"); continue; }
      const missingDirectories = entry.path.split("/").slice(0, directory ? undefined : -1).reduce((state, part) => { state.path = state.path ? state.path + "/" + part : part; if (!directoryIds.has(state.path)) state.count++; return state; }, { path: "", count: 0 }).count;
      if (hierarchy.length + nodes.length + missingDirectories + (directory ? 0 : 1) > limits.maxEntities) { if (complete) resourceFailure("Graph entity safety ceiling reached."); noteSkip(entry.path, "Hierarchy entity limit"); continue; }
      const parentId = ensureDirectories(entry.path, directory);
      if (directory) { accepted.set(entry.path, { entry, directory: true }); continue; }
      fileCount++; const info = classifyPath(entry.path), nodeId = id("file", entry.path), url = safeUrl(entry.url);
      const node = { id: nodeId, label: baseName(entry.path), path: entry.path, kind: info.kind === "source" ? "module" : info.kind === "config" ? "schema" : info.text ? "document" : "file", parentId, group: rootId, level: entry.path.split("/").length + 1, language: info.language, fileKind: info.kind, size: Number.isSafeInteger(entry.size) && entry.size >= 0 ? entry.size : typeof entry.text === "string" ? encoder.encode(entry.text).length : null, functions: [], inputs: [], outputs: [], evidence: [], documentIds: [], evidenceStatus: "metadata-only", summary: "File metadata only; contents were not analyzed.", ...(url ? { url } : {}) };
      let text = null, facts = { symbols: [], imports: [] };
      if (typeof entry.text === "string" && !entry.text.includes("\0") && (info.text || info.kind === "file") && !["binary", "unreadable", "symlink", "metadata-only", "excluded"].includes(entry.status)) {
        const remaining = limits.maxTotalBytes - report.textBytes;
        if (remaining > 0) {
          if (complete && (encoder.encode(entry.text).length > limits.maxFileBytes || encoder.encode(entry.text).length > remaining)) resourceFailure("Source content safety ceiling reached.");
          const clipped = truncateBytes(entry.text, Math.min(limits.maxFileBytes, remaining)); text = clipped.text; report.textBytes += clipped.bytes;
          const truncated = clipped.truncated || entry.status === "truncated" || entry.truncated === true; if (truncated) report.truncatedFiles++;
          const preview = truncateBytes(text, 256 * 1024);
          const docId = id("doc", entry.path); documents.push({ id: docId, title: entry.path, path: entry.path, content: preview.text, status: truncated || preview.truncated ? "truncated" : "source", previewTruncated: preview.truncated, sourceBytes: clipped.bytes, ...(url ? { url } : {}) }); node.documentIds.push(docId);
          const lines = indexLines(text); sourceLines.set(entry.path, lines);
          node.evidence = [evidence(entry.path, text, 1, Math.min(8, lines.length), url)]; node.evidenceStatus = "source-text";
          node.previewTruncated = preview.truncated;
          node.summary = `${info.language || "Text"} · ${lines.length} source lines${preview.truncated || truncated ? " · preview truncated" : ""}`;
          if (entry.syntaxFacts) {
            facts = entry.syntaxFacts;
            if (!Array.isArray(facts.symbols) || !Array.isArray(facts.imports)) throw new Error("Invalid prepared syntax facts for " + entry.path);
          }
          else if (["python", "javascript", "typescript"].includes(info.language)) {
            facts = codeFacts(text, info.language);
            if (info.language === "python" && root.SkylensePythonStructure) {
              facts.structure = root.SkylensePythonStructure.analyze(text);
              facts.symbols = facts.structure.symbols;
              if (facts.structure.truncated) report.warnings.push(`${entry.path}: Python structure extraction reached its bounded budget.`);
            }
          }
          else if (info.language === "julia" && root.SkylenseJuliaStructure) {
            facts = root.SkylenseJuliaStructure.analyze(text);
            if (facts.truncated) report.warnings.push(`${entry.path}: Julia structure extraction reached its bounded budget.`);
          }
          else if (["html", "markdown"].includes(info.language)) facts = documentFacts(text, info.language, lines);
          if (complete && (facts.truncated || facts.structure?.truncated)) resourceFailure(entry.path + ": syntax extraction reached its safety ceiling.");
          const parser = entry.syntaxFacts?.parser || (["python", "javascript", "typescript"].includes(info.language) || (info.language === "julia" && root.SkylenseJuliaStructure) ? info.language + "-lexical" : ["html", "markdown"].includes(info.language) ? "document-structure" : "text-preview");
          const status = entry.syntaxFacts?.diagnostics?.length || truncated ? "partial" : entry.syntaxFacts?.status || (parser === "text-preview" ? "preview-only" : parser === "document-structure" ? "document-structure" : "analyzed");
          node.analysis = { parser, status, diagnostics: entry.syntaxFacts?.diagnostics || [], unresolvedCount: 0 };
          report.analyzedFiles++;
        } else { if (complete) resourceFailure("Source content safety ceiling reached."); noteSkip(entry.path, "Text budget exhausted; metadata retained"); }
      }
      if (text === null) { report.metadataOnlyFiles++; node.summary = `${info.kind} · ${entry.status || "metadata only"}${node.size !== null ? " · " + node.size + " bytes" : ""}`; node.analysis = { parser: "metadata-only", status: "metadata-only", diagnostics: [], unresolvedCount: 0 }; }
      nodes.push(node); accepted.set(entry.path, { entry, node, text, facts, url });
    }
    const fileMap = new Map([...accepted].filter(([, value]) => value.node));
    // Allocate declaration previews fairly across files. Documentation has its
    // own small budget and cannot displace source declarations.
    const codeFiles = [...fileMap].filter(([, v]) => !["html", "markdown"].includes(v.node.language));
    const documentFiles = [...fileMap].filter(([, v]) => ["html", "markdown"].includes(v.node.language));
    let documentSymbols = 0;
    for (const [collection, perFile, total] of [[codeFiles, limits.maxSymbolsPerFile, limits.maxSymbolsTotal], [documentFiles, limits.maxDocumentSymbolsPerFile, limits.maxDocumentSymbolsTotal]]) {
      let used = 0;
      const rounds = Math.min(perFile, collection.reduce((n, [, value]) => Math.max(n, value.facts.symbols.length), 0));
      for (let index = 0; index < rounds && used < total; index++) for (const [path, value] of collection) {
        const symbol = value.facts.symbols[index]; if (!symbol || used >= total) continue;
        value.node.functions.push({ name: symbol.name, qualifiedName: symbol.qualifiedName || symbol.name, kind: symbol.kind, description: `${value.facts.parser?.engine === "tree-sitter" ? "Syntax-tree" : "Lexical"} ${symbol.kind} declaration at line ${symbol.line}; no runtime or type-checking claim.`, inputs: [], outputs: [], evidenceStatus: "lexical-candidate", evidence: [evidence(path, value.text, symbol.line, symbol.endLine, value.url)] }); used++;
      }
      if (collection === documentFiles) documentSymbols = used;
      symbolsUsed += used;
      for (const [path, value] of collection) if (value.facts.symbols.length > value.node.functions.length) report.warnings.push(`${path}: ${collection === documentFiles ? "document section" : "symbol"} preview limited by per-file (${perFile}) or collection (${total}) budget.`);
    }
    // Source files are kept even when navigation nodes reach the entity budget.
    // Round-robin expansion gives each source a first declaration before any
    // source receives its second. Parents precede children in lexical order.
    let navigableSymbols = 0, symbolContainers = 0, navigationCandidates = 0, documentNavigation = 0;
    for (const [path, value] of fileMap) {
      value.node.sourceRole = "file"; value.symbolNodes = new Map(); value.boundaries = new Map();
      value.wantedParents = new Set(value.facts.symbols.slice(0, value.node.functions.length).map(symbol => symbol.parent).filter(parent => Number.isInteger(parent)));
      if (options.kind !== "webpage") navigationCandidates += value.node.functions.length;
    }
    if (options.kind !== "webpage") for (const collection of [codeFiles, documentFiles]) {
      const rounds = collection.reduce((n, [, value]) => Math.max(n, value.node.functions.length), 0);
      for (let index = 0; index < rounds; index++) for (const [path, value] of collection) {
        const symbol = value.facts.symbols[index], preview = value.node.functions[index];
        if (!preview || (collection === documentFiles && documentNavigation >= limits.maxDocumentNavigation)) continue;
        if (!value.fileBoundary) {
          if (value.node.level >= 62 || nodes.length + hierarchy.length + 2 > limits.maxEntities) { if (complete) resourceFailure("Source navigation depth or entity ceiling reached."); continue; }
          const fileId = id("source", path), parentId = value.node.parentId, level = value.node.level;
          value.fileBoundary = { id: fileId, level };
          hierarchy.push({ id: fileId, label: value.node.label, kind: "container", sourceRole: "file-container", path, parentId, group: rootId, level, description: "Source file boundary · declarations are contained here; containment does not imply a call.", documentIds: [...value.node.documentIds], evidence: value.node.evidence }); symbolContainers++;
          value.node.parentId = fileId; value.node.level++; value.node.label = "Source · " + value.node.label;
        }
        if (Number.isInteger(symbol.parent) && !value.boundaries.has(symbol.parent)) continue;
        const parent = value.boundaries.get(symbol.parent) || value.fileBoundary;
        if (parent.level >= 63 || nodes.length + hierarchy.length >= limits.maxEntities) { if (complete) resourceFailure("Source navigation depth or entity ceiling reached."); continue; }
        const symbolId = id("symbol", path + "\0" + (symbol.qualifiedName || symbol.name) + "\0" + symbol.line + "\0" + (symbol.column || 0) + "\0" + index);
        let symbolParent = parent.id, symbolLevel = parent.level + 1;
        if (value.wantedParents.has(index) && parent.level < 62 && nodes.length + hierarchy.length + 2 <= limits.maxEntities) {
          const boundary = { id: id("scope", symbolId), label: symbol.name, kind: "container", sourceRole: "symbol-container", path, qualifiedName: preview.qualifiedName, parentId: parent.id, group: rootId, level: symbolLevel, description: `Lexical ${symbol.kind} scope · ${preview.qualifiedName}`, documentIds: [...value.node.documentIds], evidence: preview.evidence };
          hierarchy.push(boundary); value.boundaries.set(index, boundary); symbolContainers++; symbolParent = boundary.id; symbolLevel++;
        }
        const bodyEnd = Math.max(symbol.endLine, Math.min(symbol.bodyEndLine || symbol.endLine, symbol.line + 31));
        nodes.push({ id: symbolId, label: symbol.name, qualifiedName: preview.qualifiedName, path, kind: symbol.kind === "section" ? "document" : symbol.kind === "struct" ? "class" : ["class", "function", "interface", "module"].includes(symbol.kind) ? symbol.kind : "schema", sourceRole: "symbol", parentId: symbolParent, group: rootId, level: symbolLevel, summary: `${preview.qualifiedName} · ${symbol.kind} · lines ${symbol.line}–${symbol.bodyEndLine || symbol.endLine}. Static source declaration; not a runtime trace.`, functions: [], inputs: [], outputs: [], documentIds: [...value.node.documentIds], evidenceStatus: "source-text", evidence: [evidence(path, value.text, symbol.line, bodyEnd, value.url)], sourceSpan: { lineStart: symbol.line, lineEnd: symbol.bodyEndLine || symbol.endLine }, ...(value.node.url ? { url: value.node.url } : {}) });
        preview.nodeId = symbolId; value.symbolNodes.set(index, symbolId); navigableSymbols++;
        if (collection === documentFiles) documentNavigation++;
      }
    }
    report.navigableSymbols = navigableSymbols; report.symbolContainers = symbolContainers; report.documentSymbols = documentSymbols; report.documentNavigation = documentNavigation;
    report.selection = "source-first; declarations allocated across files before separately bounded document sections";
    if (navigableSymbols < navigationCandidates) report.warnings.push("Some symbol navigation nodes were limited by the hierarchy entity, document or depth budget; declaration previews are retained.");
    const urlMap = new Map(); for (const [path, value] of fileMap) { const url = value.url; if (url) { const u = new URL(url); u.hash = ""; urlMap.set(u.href, path); } }
    const juliaModules = new Map();
    for (const [path, value] of fileMap) if (value.node.language === "julia") for (const symbol of value.facts.symbols) {
      if (symbol.kind !== "module" || Number.isInteger(symbol.parent)) continue;
      const found = juliaModules.get(symbol.name) || []; found.push(path); juliaModules.set(symbol.name, found);
    }
    function choose(candidates) { const matches = [...new Set(candidates.filter((path) => path && fileMap.has(path)))]; return matches.length === 1 ? { targets: matches } : { targets: [], reason: matches.length > 1 ? "Ambiguous local resolution" : "External, unavailable, excluded or unresolved target" }; }
    const extendedResolver = root.SkylenseSourceResolver?.create(fileMap, { joinRelative, choose });
    function resolve(path, fact, entry) {
      const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "", spec = fact.specifier;
      const extended = extendedResolver?.(path, fact, entry); if (extended) return extended;
      if (fact.form === "julia-include") {
        if (/^(?:[a-z]:|\/|[a-z][\w+.-]*:\/\/)/i.test(spec)) return { targets: [], reason: "Julia include is outside the selected relative source tree" };
        return choose([joinRelative(dir, spec)]);
      }
      if (fact.form === "julia-module") {
        if (/^[A-Za-z_]\w*$/.test(spec)) {
          const candidates = juliaModules.get(spec) || [];
          if (candidates.length) return choose(candidates);
        }
        return { targets: [], reason: "No unique included top-level Julia module declaration; package and relative-module bindings are not resolved" };
      }
      if (fact.form.startsWith("python")) {
        let module = spec, prefix = "";
        if (module.startsWith(".")) { const dots = module.match(/^\.+/)[0].length; const parts = dir ? dir.split("/") : []; if (dots > parts.length + (fileMap.has("__init__.py") ? 1 : 0)) return { targets: [], reason: "Relative import escapes source root" }; prefix = parts.slice(0, parts.length - dots + 1).join("/"); module = module.slice(dots); }
        const stem = [prefix, module.replace(/\./g, "/")].filter(Boolean).join("/");
        const modules = [stem + ".py", (stem ? stem + "/" : "") + "__init__.py"];
        const direct = choose(modules);
        if (fact.form === "python-from") {
          const submodules = [];
          for (const name of fact.names || []) if (name !== "*") { const sub = (stem ? stem + "/" : "") + name; const result = choose([sub + ".py", sub + "/__init__.py"]); submodules.push(...result.targets); }
          if (submodules.length) return { targets: [...new Set([...direct.targets, ...submodules])] };
        }
        return direct;
      }
      if (["html-link", "html-script", "html-stylesheet", "markdown-link"].includes(fact.form)) {
        if (!spec || spec.startsWith("#") || /^(?:javascript|data|mailto|tel):/i.test(spec)) return { targets: [], ignored: true };
        if (entry.url) { try { const u = new URL(spec.replace(/&amp;/g, "&"), entry.url); u.hash = ""; if (!["http:", "https:"].includes(u.protocol)) return { targets: [], ignored: true }; if (urlMap.has(u.href)) return { targets: [urlMap.get(u.href)] }; if (/^[a-z][\w+.-]*:/i.test(spec) || spec.startsWith("/")) return { targets: [], reason: "Linked URL was not included in this bounded collection" }; } catch { return { targets: [], reason: "Invalid link URL" }; } }
        let clean; try { clean = decodeURIComponent(spec.split(/[?#]/)[0]); } catch { return { targets: [], reason: "Invalid encoded link" }; }
        if (/^(?:[a-z][\w+.-]*:|\/)/i.test(clean)) return { targets: [], reason: "Linked URL was not included in this bounded collection" };
        const joined = joinRelative(dir, clean); return choose([joined, joined && joined + "/index.html", joined && joined + "/README.md"]);
      }
      if (!spec.startsWith(".")) return { targets: [], reason: "Package or path alias requires an external resolver" };
      const joined = joinRelative(dir, spec); if (!joined) return { targets: [], reason: "Relative import escapes source root" };
      const suffixes = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".json"];
      if (fileMap.has(joined)) return { targets: [joined] };
      return choose([...suffixes.map((ext) => joined + ext), ...suffixes.map((ext) => joined + "/index" + ext)]);
    }
    const externalNodes = new Map(); let externalContainer = null, externalReferenceEdges = 0;
    function externalTarget(value, reference) {
      const name = String(reference.name || reference.specifier || "External reference");
      const key = (value.node.language || "text") + "\0" + (reference.kind || "package") + "\0" + name;
      if (externalNodes.has(key)) return externalNodes.get(key);
      if (nodes.length + hierarchy.length + (externalContainer ? 1 : 2) > limits.maxEntities) {
        if (complete) resourceFailure("External reference entity ceiling reached."); return null;
      }
      if (!externalContainer) {
        externalContainer = id("external-scope", ".");
        hierarchy.push({ id: externalContainer, label: "External dependencies", kind: "container", group: rootId, parentId: rootId, level: 2, description: "Declared external references; dependency contents are not part of the indexed source." });
      }
      const target = id("external", key);
      nodes.push({ id: target, label: name, path: "external:" + key.replace(/\0/g, ":"), kind: "external", sourceRole: "external-reference", parentId: externalContainer, group: rootId, level: 3, language: value.node.language, status: "unfetched-reference", evidenceStatus: "unfetched-reference", summary: "Declared external dependency reference; package contents were not fetched or indexed, and runtime availability is not verified.", functions: [], inputs: [], outputs: [], evidence: [], documentIds: [], externalReference: { name, kind: reference.kind || "package", specifier: String(reference.specifier || name) } });
      externalNodes.set(key, target); return target;
    }
    let edgeCap = false;
    for (const [path, value] of fileMap) for (const fact of value.facts.imports) {
      const resolution = resolve(path, fact, value.entry); if (resolution.ignored) continue;
      if (!resolution.targets.length && resolution.external) {
        const target = externalTarget(value, resolution.external);
        if (!target || edges.length >= limits.maxEdges) { if (complete) resourceFailure("External relationship safety ceiling reached."); edgeCap = true; continue; }
        edges.push({ id: id("edge", path + "\0external\0" + fact.line + "\0" + fact.form + "\0" + target + "\0" + edges.length), source: value.node.id, target, type: "imports", label: fact.specifier.slice(0, 240), evidenceStatus: "source-text", description: "The source declares this external dependency reference. Its contents and runtime binding were not inspected; this does not count as a resolved local-code relationship.", evidence: [evidence(path, value.text, fact.line, fact.endLine, value.url)], externalReference: true });
        externalReferenceEdges++; continue;
      }
      if (!resolution.targets.length) { if (value.node.analysis) value.node.analysis.unresolvedCount++; if (report.unresolved.length < (complete ? Number.MAX_SAFE_INTEGER : 1000)) report.unresolved.push({ file: path, line: fact.line, specifier: fact.specifier.slice(0, 256), reason: resolution.reason }); continue; }
      for (const target of resolution.targets) {
        if (edges.length >= limits.maxEdges) { if (complete) resourceFailure("Relationship safety ceiling reached."); edgeCap = true; break; }
        const type = ["html-script", "html-stylesheet"].includes(fact.form) ? "loads" : fact.form.endsWith("link") ? "links" : "imports";
        edges.push({ id: id("edge", path + "\0" + fact.line + "\0" + fact.form + "\0" + fact.specifier + "\0" + target + "\0" + edges.length), source: value.node.id, target: fileMap.get(target).node.id, type, label: fact.specifier.slice(0, 240), evidenceStatus: "lexical-candidate", description: `${fact.form}: static source reference resolves to an included local file. This is a lexical dependency candidate, not a verified execution, call or runtime flow.`, evidence: [evidence(path, value.text, fact.line, fact.endLine, value.url)] });
      }
    }
    const nodesById = new Map(nodes.map(node => [node.id, node]));
    let callCandidates = 0, unresolvedCalls = 0, semanticCalls = 0, dispatchCandidates = 0, dispatchCallsites = 0;
    const sourceTargets = new Map();
    for (const [path, value] of fileMap) for (let index = 0; index < value.facts.symbols.length; index++) { const symbol = value.facts.symbols[index], key = path + "\0" + symbol.line + "\0" + symbol.name, list = sourceTargets.get(key) || []; list.push({ value, index, symbol }); sourceTargets.set(key, list); }
    function sourceTarget(reference) {
      const candidates = (sourceTargets.get(reference.path + "\0" + reference.line + "\0" + reference.name) || []).filter(item => (reference.column === undefined || item.symbol.column === reference.column) && (reference.qualifiedName === undefined || item.symbol.qualifiedName === reference.qualifiedName));
      return candidates.length === 1 ? candidates[0].value.symbolNodes.get(candidates[0].index) : undefined;
    }
    let structuralRelationships = 0, unresolvedRelationships = 0;
    for (const [path, value] of fileMap) for (const [relationshipIndex, relationship] of (value.facts.relationships || []).entries()) {
      if (!["inherits", "implements"].includes(relationship.form)) continue;
      const from = value.symbolNodes.get(relationship.owner), target = relationship.resolution?.kind === "source" ? sourceTarget(relationship.resolution) : undefined;
      if (!from || !target) {
        unresolvedRelationships++;
        if (value.node.analysis) value.node.analysis.unresolvedCount++;
        if (report.unresolved.length < (complete ? Number.MAX_SAFE_INTEGER : 1000)) report.unresolved.push({ file: path, line: relationship.line, specifier: relationship.name, kind: relationship.form, reason: relationship.resolution?.reason || "Structural target is outside the unique included declaration set or navigation budget" });
        continue;
      }
      if (edges.length >= limits.maxEdges) { if (complete) resourceFailure("Structural relationship safety ceiling reached."); edgeCap = true; break; }
      edges.push({ id: id("edge", path + "\0heritage\0" + relationship.line + "\0" + (relationship.column || 0) + "\0" + relationship.form + "\0" + target + "\0" + relationshipIndex), source: from, target, type: relationship.form, label: (relationship.form === "implements" ? "implements " : "extends ") + relationship.name, evidenceStatus: "static-resolved", resolution: { engine: relationship.resolution.engine || "typescript-symbols", kind: "source" }, description: "A declared class or interface heritage reference resolves through the project symbol table to this unique included source definition. This is a structural relationship, not an execution sequence or proof that the implementation satisfies the contract.", evidence: [evidence(path, value.text, relationship.line, relationship.endLine, value.url)] });
      structuralRelationships++;
    }
    report.structuralRelationships = structuralRelationships; report.unresolvedRelationships = unresolvedRelationships;
    for (const [path, value] of fileMap) for (const [callIndex, call] of (value.facts.structure?.calls || []).entries()) {
      const from = call.owner === null ? value.node.id : value.symbolNodes.get(call.owner);
      const dispatch = call.resolution.kind === "source-candidates", semantic = call.resolution.kind === "source";
      let targets = [];
      if (semantic) targets = [sourceTarget(call.resolution)];
      else if (dispatch) targets = (call.resolution.targets || []).map(sourceTarget);
      else if (call.resolution.kind === "local") targets = [value.symbolNodes.get(call.resolution.symbol)];
      else if (call.resolution.kind === "import") {
        const reference = call.resolution;
        const resolved = resolve(path, { form: "python-from", specifier: reference.module, names: [] }, value.entry);
        if (resolved.targets.length === 1) {
          const other = fileMap.get(resolved.targets[0]);
          const index = other.facts.structure?.callableExports?.[reference.name];
          if (Number.isInteger(index)) targets = [other.symbolNodes.get(index)];
        }
      }
      targets = [...new Set(targets.filter(Boolean))];
      if (!from || !targets.length) {
        unresolvedCalls++;
        if (report.unresolved.length < (complete ? Number.MAX_SAFE_INTEGER : 1000)) report.unresolved.push({ file: path, line: call.line, specifier: call.name, kind: "call", reason: call.resolution.reason || "Call target is outside the supported, unique included declaration set or navigation budget" });
        continue;
      }
      const callsiteId = id("callsite", path + "\0" + call.line + "\0" + (call.column || 0) + "\0" + call.name + "\0" + callIndex);
      if (dispatch) dispatchCallsites++;
      for (const target of targets) {
        if (edges.length >= limits.maxEdges) { if (complete) resourceFailure("Relationship safety ceiling reached."); edgeCap = true; break; }
        const targetNode = nodesById.get(target), type = dispatch ? "call-candidate" : targetNode?.kind === "class" ? "constructs" : "calls";
        edges.push({ id: id("edge", path + "\0call\0" + call.line + "\0" + (call.column || 0) + "\0" + call.name + "\0" + target + "\0" + edges.length), source: from, target, type, label: call.name + "()", callsiteId, ...(dispatch ? { dispatchCandidateCount: targets.length } : {}), evidenceStatus: dispatch ? "dispatch-candidate" : semantic ? "static-resolved" : "lexical-candidate", resolution: { engine: call.resolution.engine || (dispatch ? "julia-static-binding" : semantic ? "typescript-checker" : "lexical-binding"), kind: call.resolution.kind }, description: dispatch ? "A source call can refer to this included method through static module bindings. These edges form a candidate set; argument types and runtime multiple dispatch are not evaluated." : semantic ? "A static semantic binding resolves this call site to a unique included source declaration. Runtime dispatch and execution order are not observed." : "A source call expression resolves lexically to this unique included declaration. Decorators, rebinding and runtime behavior are not verified; this is not an observed execution or ordering claim.", evidence: [evidence(path, value.text, call.line, call.endLine, value.url)] });
        callCandidates++; if (semantic) semanticCalls++; if (dispatch) dispatchCandidates++;
      }
    }
    report.externalReferences = externalNodes.size; report.externalReferenceEdges = externalReferenceEdges;
    report.callCandidates = callCandidates; report.semanticCalls = semanticCalls; report.dispatchCandidates = dispatchCandidates; report.dispatchCallsites = dispatchCallsites; report.unresolvedCalls = unresolvedCalls;
    if (options.kind === "webpage") {
      let headingCount = 0, referenceCount = 0;
      for (const [path, value] of fileMap) {
        if (!["html", "markdown"].includes(value.node.language) || value.text === null) continue;
        if (nodes.length + hierarchy.length >= limits.maxEntities) { report.warnings.push("Webpage containers limited by hierarchy entity budget."); break; }
        const pageId = id("page", path);
        hierarchy.push({ id: pageId, label: value.node.label, path, kind: "container", group: rootId, parentId: value.node.parentId, level: value.node.level, description: "Collected page · source, authored sections and hyperlink references" });
        value.node.parentId = pageId; value.node.level++;
        for (const symbol of value.facts.symbols) {
          if (headingCount >= (complete ? limits.maxEntities : 40) || nodes.length + hierarchy.length >= limits.maxEntities) break;
          nodes.push({ id: id("section", path + "\0" + symbol.line + "\0" + symbol.name), label: symbol.name.slice(0, 180), path, kind: "module", group: rootId, parentId: pageId, level: value.node.level, summary: "Authored page section · source text, not an inferred component", evidenceStatus: "source-text", documentIds: [...value.node.documentIds], functions: [], inputs: [], outputs: [], evidence: [evidence(path, value.text, symbol.line, symbol.endLine, value.url)] }); headingCount++;
        }
        const references = new Map();
        for (const fact of value.facts.imports) {
          const resolution = resolve(path, fact, value.entry);
          if (resolution.ignored || resolution.targets.length) continue;
          const resource = ["html-script", "html-stylesheet"].includes(fact.form);
          let targetUrl;
          try { targetUrl = safeUrl(new URL(fact.specifier.replace(/&amp;/g, "&"), value.entry.url || options.url).href); } catch { targetUrl = null; }
          if (!targetUrl) continue;
          let target = references.get(targetUrl);
          if (!target) {
            if (referenceCount >= (complete ? limits.maxEntities : 40) || nodes.length + hierarchy.length >= limits.maxEntities) break;
            target = id("reference", path + "\0" + targetUrl); references.set(targetUrl, target);
            const parsed = new URL(targetUrl);
            nodes.push({ id: target, label: (parsed.hostname + parsed.pathname).slice(0, 180), path: targetUrl, url: targetUrl, kind: "external", group: rootId, parentId: pageId, level: value.node.level, summary: `Unfetched ${resource ? "resource" : "hyperlink"} reference · target contents were not inspected`, status: "unfetched-reference", evidenceStatus: "unfetched-reference", documentIds: [...value.node.documentIds], functions: [], inputs: [], outputs: [], evidence: [evidence(path, value.text, fact.line, fact.endLine, value.url)] }); referenceCount++;
          }
          if (edges.length < limits.maxEdges) edges.push({ id: id("edge", path + (resource ? "\0resource\0" : "\0hyperlink\0") + fact.line + "\0" + targetUrl + "\0" + edges.length), source: value.node.id, target, type: resource ? "loads" : "links", label: (resource ? "resource · " : "hyperlink · ") + fact.specifier.slice(0, 240), evidenceStatus: "source-text", description: resource ? "The collected source contains this authored resource attribute. The target was not fetched; this does not establish successful loading or code execution." : "The collected source contains this authored hyperlink. The target was not fetched; the link does not establish a code dependency or execution relationship.", evidence: [evidence(path, value.text, fact.line, fact.endLine, value.url)] });
        }
      }
      report.pageSections = headingCount; report.unfetchedReferences = referenceCount;
      if (!complete && (headingCount >= 40 || referenceCount >= 40)) report.warnings.push("Webpage section and unfetched-reference previews are limited to 40 each.");
    }
    if (edgeCap) report.warnings.push(`Relationship output limited to ${limits.maxEdges}.`);
    if (!nodes.length) nodes.push({ id: id("file", "__skylense_empty_manifest__"), label: "No accepted files", kind: "document", parentId: rootId, group: rootId, level: 2, description: "The collection contained no accepted files. Check the ingestion report for limits, exclusions and transport failures.", evidenceStatus: "metadata-only", functions: [], inputs: [], outputs: [], evidence: [], documentIds: [] });
    report.evidenceBytes = evidenceBytes; report.truncatedExcerpts = evidenceTruncated;
    if (evidenceTruncated) report.warnings.push("Some excerpts are partial because of preview budgets; bounded source previews remain in documents.");
    report.truncated = Boolean(evidenceTruncated || (symbolsUsed - documentSymbols) >= limits.maxSymbolsTotal || options.report?.truncated || report.truncatedFiles || report.warnings.some(item => typeof item === "string" && /limited|budget/i.test(item)) || report.skipped.some(item => /limit|budget/i.test(item.reason || "")) || edgeCap);
    report.previewTruncated = Boolean(evidenceTruncated || documents.some(doc => doc.previewTruncated));
    report.indexCompleteness = { mode: complete ? "complete" : "preview", collection: complete && !options.report?.truncated ? "complete" : "partial", declarations: complete ? report.syntax?.errors?.length ? "partial-syntax-errors" : "complete-for-supported-parsers" : "bounded", relationships: "static-supported-references", runtime: false };
    if (complete) report.truncated = Boolean(options.report?.truncated || report.truncatedFiles || edgeCap);
    report.acceptedFiles = fileCount; report.directories = directoryIds.size - 1; report.relationships = edges.length; report.symbols = symbolsUsed;
    const source = typeof options.source === "string" ? options.source : options.kind || "folder";
    const revision = typeof options.revision === "string" ? options.revision : hash([...fileMap].map(([path, file]) => path + "\0" + (file.text === null ? file.node.size : hash(file.text))).join("\n"));
    const model = { meta: { id: "ingest_" + hash(source + "\0" + title), title, description: "Automatically collected source hierarchy and bounded static reference analysis.", version: 1, source, revision, sourceFolder: title, ...(safeUrl(options.url) ? { repository: safeUrl(options.url) } : {}), evidenceNote: "Automatically analyzed source text. Imports and hyperlinks are lexical candidates resolved against included files; Call-site bindings report their static or lexical provenance and do not form a complete runtime call graph. No code was executed and no runtime flow is inferred. Excerpts may be partial when preview budgets are reached; bounded source previews are available in documents. Preview limits, skipped files and unresolved references are recorded in the ingestion report.", defaultScope: "system", defaultOpen: [], ingestion: report, count: { groups: 1, containers: hierarchy.length, nodes: nodes.length, edges: edges.length, functions: report.symbols, documents: documents.length } }, groups: [group], hierarchy, nodes, edges, flows: [], documents };
    root.SkylenseSourceInsights?.enrich(model);
    // Escaped JSON can be much larger than UTF-8 source text (for example logs
    // containing backslashes or control characters). Cap the actual pretty JSON
    // used by CLI/browser exports, keeping every graph identity and relationship.
    const outputSize = () => encoder.encode(JSON.stringify(model, null, 2)).length + 1;
    const exportTarget = limits.maxSerializedBytes - 4096;
    let serializedBytes = outputSize();
    if (serializedBytes > exportTarget) {
      if (!complete) report.truncated = true; report.previewTruncated = true; report.serializedPreviewTruncated = true;
      report.warnings.push("Document previews were shortened to keep the exported model below the model export limit; node and relationship identities are unchanged.");
      const trimmed = new Set();
      for (let pass = 0; pass < 20 && serializedBytes > exportTarget; pass++) {
        let changed = false;
        for (const doc of documents) {
          if (!doc.content.length) continue;
          const before = encoder.encode(doc.content).length;
          doc.content = truncateBytes(doc.content, Math.floor(before / 2)).text;
          if (doc.status !== "truncated") report.truncatedFiles++;
          doc.status = "truncated"; doc.previewBytes = encoder.encode(doc.content).length;
          doc.originalPreviewBytes ??= before; trimmed.add(doc.id); changed = true;
        }
        if (!changed && complete) resourceFailure("Graph metadata and source evidence exceed the model export ceiling.");
        if (!changed) {
          // Rare path-heavy manifests can spend their entire budget on evidence.
          // Preserve the line references and make omitted text explicit.
          for (const item of [...nodes, ...hierarchy, ...edges, ...nodes.flatMap(node => node.functions || [])]) for (const entry of item.evidence || []) {
            if (!entry.excerpt) continue;
            entry.excerpt = truncateBytes(entry.excerpt, Math.floor(encoder.encode(entry.excerpt).length / 2)).text;
            entry.excerptTruncated = true; changed = true;
          }
        }
        if (!changed) break;
        serializedBytes = outputSize();
      }
      report.serializedTrimmedDocuments = trimmed.size;
      for (const node of nodes) if (node.documentIds?.some(docId => trimmed.has(docId))) node.previewTruncated = true;
      if (outputSize() > exportTarget) resourceFailure("Graph metadata exceeds the " + (limits.maxSerializedBytes / 1024 / 1024) + " MiB export ceiling.");
    }
    report.serializedBytes = 0;
    report.serializedBytes = outputSize();
    // Only this non-negative integer changed in the second measurement. Its
    // decimal digit growth is the exact UTF-8/pretty-JSON byte delta.
    report.serializedBytes += String(report.serializedBytes).length - 1;
    return model;
  }
  root.SkylenseIngest = Object.freeze({ build, classifyPath, comparePaths, pathPriority, isExcludedPath, limits: LIMITS });
})(typeof window !== "undefined" ? window : globalThis);
