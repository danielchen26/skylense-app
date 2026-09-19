/* Skylense source analysis. Pure, bounded, and intentionally independent of execution. */
(function (root) {
  "use strict";
  const LIMITS = Object.freeze({ maxFiles: 300, maxFileBytes: 256 * 1024, maxTotalBytes: 10 * 1024 * 1024, maxEntities: 1000, maxSymbolsPerFile: 100, maxSymbolsTotal: 2000, maxEvidenceBytes: 1024 * 1024, maxSerializedBytes: 14 * 1024 * 1024, maxEdges: 3000 });
  const EXCLUDED_DIRS = new Set([".git", ".hg", ".svn", "node_modules", ".venv", "venv", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox", ".cache", "coverage", ".next", ".nuxt", "dist", "build", "target", "vendor"]);
  const CODE = { py: "python", pyw: "python", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript", go: "go", rs: "rust", java: "java", c: "c", h: "c", cpp: "cpp", hpp: "cpp", cc: "cpp", cs: "csharp", rb: "ruby", php: "php", swift: "swift", kt: "kotlin", scala: "scala", sh: "shell", bash: "shell", zsh: "shell", sql: "sql", r: "r", lua: "lua", vue: "vue", svelte: "svelte" };
  const TEXT = new Set(["txt", "md", "mdx", "markdown", "rst", "html", "htm", "css", "scss", "sass", "less", "json", "jsonc", "yaml", "yml", "toml", "ini", "cfg", "conf", "xml", "csv", "tsv", "log", "lock", "properties", "gitignore", "gitattributes", "editorconfig", "dockerignore", "svg"]);
  const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "ico", "avif", "bmp", "tif", "tiff", "heic"]);
  const ARCHIVE = new Set(["zip", "tar", "gz", "bz2", "xz", "7z", "rar", "tgz"]);
  const BINARY = new Set(["wasm", "exe", "dll", "so", "dylib", "a", "o", "obj", "class", "pyc", "pyo", "db", "sqlite", "sqlite3", "woff", "woff2", "ttf", "otf", "mp3", "mp4", "mov", "webm", "wav", "ogg", "flac", "parquet", "npy", "npz", "pickle", "pkl", "pt", "pth", "bin"]);
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
  function truncateBytes(text, limit) {
    const bytes = encoder.encode(text);
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
      // Comments and executable/style element contents are not navigational markup.
      const masked = text.replace(/<!--[\s\S]*?(?:-->|$)|<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, (m) => m.replace(/[^\n]/g, " "));
      let heading = null;
      // Match whole tags before examining attributes, so data-href and strings
      // inside other attributes cannot masquerade as an authored hyperlink.
      for (const match of masked.matchAll(/<\/?([a-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
        const tag = match[1].toLowerCase(), closing = match[0].startsWith("</");
        if (/^h[1-6]$/.test(tag)) {
          if (!closing) heading = { tag, start: match.index, body: match.index + match[0].length };
          else if (heading?.tag === tag) { const name = masked.slice(heading.body, match.index).replace(/<[^>]*>/g, "").trim(); if (name) symbols.push({ name, kind: "section", line: lineAt(heading.start), endLine: lineAt(match.index + match[0].length) }); heading = null; }
        }
        if (closing || !["a", "link"].includes(tag)) continue;
        const attributes = match[0].slice(1 + match[1].length, -1);
        for (const attr of attributes.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
          if (attr[1].toLowerCase() !== "href") continue;
          imports.push({ specifier: attr[2] || attr[3] || attr[4] || "", form: "html-link", line: lineAt(match.index), endLine: lineAt(match.index + match[0].length) }); break;
        }
      }
    }
    return { symbols, imports };
  }
  function build(entries, options = {}) {
    if (!Array.isArray(entries)) throw new TypeError("entries must be an array of file descriptors.");
    const limits = { maxFiles: bound(options.maxFiles, LIMITS.maxFiles, 1000), maxFileBytes: bound(options.maxFileBytes, LIMITS.maxFileBytes, LIMITS.maxFileBytes), maxTotalBytes: bound(options.maxTotalBytes, LIMITS.maxTotalBytes, LIMITS.maxTotalBytes), maxEntities: LIMITS.maxEntities, maxSymbolsPerFile: LIMITS.maxSymbolsPerFile, maxSymbolsTotal: LIMITS.maxSymbolsTotal, maxEvidenceBytes: LIMITS.maxEvidenceBytes, maxSerializedBytes: LIMITS.maxSerializedBytes, maxEdges: LIMITS.maxEdges };
    const report = { ...(options.report && typeof options.report === "object" ? options.report : {}), analyzer: "skylense-static-v1", limits, inputEntries: entries.length, acceptedFiles: 0, analyzedFiles: 0, metadataOnlyFiles: 0, textBytes: 0, truncatedFiles: 0, skipped: Array.isArray(options.report?.skipped) ? options.report.skipped.slice(0, 1000) : [], warnings: Array.isArray(options.report?.warnings) ? options.report.warnings.slice(0, 1000) : [], unresolved: [], capabilities: { hierarchy: "Filesystem structure for accepted paths", symbols: "Lexical Python and JavaScript/TypeScript declarations; HTML/Markdown headings", relationships: "Locally resolved import/link candidates only", execution: false, aiInference: false, unsupported: "Other text is previewed; binary/PDF/image/archive contents are metadata only. Dynamic imports, aliases, re-exports, runtime dispatch and arbitrary language call graphs are not resolved." } };
    let symbolsUsed = 0, evidenceBytes = 0, evidenceTruncated = 0;
    const sourceLines = new Map();
    function evidence(file, text, start, end, url) {
      if (!sourceLines.has(file)) sourceLines.set(file, indexLines(text));
      const item = lineEvidence(file, sourceLines.get(file), start, end, url), remaining = Math.max(0, limits.maxEvidenceBytes - evidenceBytes);
      const clipped = truncateBytes(item.excerpt, Math.min(2048, remaining)); evidenceBytes += clipped.bytes;
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
      if (!path) { noteSkip(String(entry.path || "").slice(0, 300), "Invalid or excessively deep relative path"); continue; }
      if (isExcludedPath(path)) { noteSkip(path, "Excluded generated, dependency, version-control or sensitive path"); continue; }
      prepared.push({ ...entry, path, ...(entry.kind === "directory" || /[\\/]$/.test(entry.path) ? { kind: "directory" } : {}) });
    }
    prepared.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
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
      if (!directory && fileCount >= limits.maxFiles) { noteSkip(entry.path, "File count limit"); continue; }
      const missingDirectories = entry.path.split("/").slice(0, directory ? undefined : -1).reduce((state, part) => { state.path = state.path ? state.path + "/" + part : part; if (!directoryIds.has(state.path)) state.count++; return state; }, { path: "", count: 0 }).count;
      if (hierarchy.length + nodes.length + missingDirectories + (directory ? 0 : 1) > limits.maxEntities) { noteSkip(entry.path, "Hierarchy entity limit"); continue; }
      const parentId = ensureDirectories(entry.path, directory);
      if (directory) { accepted.set(entry.path, { entry, directory: true }); continue; }
      fileCount++; const info = classifyPath(entry.path), nodeId = id("file", entry.path), url = safeUrl(entry.url);
      const node = { id: nodeId, label: baseName(entry.path), path: entry.path, kind: info.kind === "source" ? "module" : info.kind === "config" ? "schema" : info.text ? "document" : "file", parentId, group: rootId, level: entry.path.split("/").length + 1, language: info.language, fileKind: info.kind, size: Number.isSafeInteger(entry.size) && entry.size >= 0 ? entry.size : typeof entry.text === "string" ? encoder.encode(entry.text).length : null, functions: [], inputs: [], outputs: [], evidence: [], documentIds: [], evidenceStatus: "metadata-only", summary: "File metadata only; contents were not analyzed.", ...(url ? { url } : {}) };
      let text = null, facts = { symbols: [], imports: [] };
      if (typeof entry.text === "string" && !entry.text.includes("\0") && (info.text || info.kind === "file") && !["binary", "unreadable", "symlink", "metadata-only", "excluded"].includes(entry.status)) {
        const remaining = limits.maxTotalBytes - report.textBytes;
        if (remaining > 0) {
          const clipped = truncateBytes(entry.text, Math.min(limits.maxFileBytes, remaining)); text = clipped.text; report.textBytes += clipped.bytes;
          const truncated = clipped.truncated || entry.status === "truncated" || entry.truncated === true; if (truncated) report.truncatedFiles++;
          const docId = id("doc", entry.path); documents.push({ id: docId, title: entry.path, path: entry.path, content: text, status: truncated ? "truncated" : "source", ...(url ? { url } : {}) }); node.documentIds.push(docId);
          const lines = indexLines(text); sourceLines.set(entry.path, lines);
          node.evidence = [evidence(entry.path, text, 1, Math.min(8, lines.length), url)]; node.evidenceStatus = "source-text";
          node.summary = `${info.language || "Text"} · ${lines.length} preview lines${truncated ? " · preview truncated" : ""}`;
          if (["python", "javascript", "typescript"].includes(info.language)) facts = codeFacts(text, info.language);
          else if (["html", "markdown"].includes(info.language)) facts = documentFacts(text, info.language, lines);
          node.functions = facts.symbols.slice(0, Math.min(limits.maxSymbolsPerFile, limits.maxSymbolsTotal - symbolsUsed)).map((symbol) => ({ name: symbol.name, kind: symbol.kind, description: `Lexical ${symbol.kind} declaration at line ${symbol.line}; no runtime or type-checking claim.`, inputs: [], outputs: [], evidenceStatus: "lexical-candidate", evidence: [evidence(entry.path, text, symbol.line, symbol.endLine, url)] }));
          symbolsUsed += node.functions.length;
          if (facts.symbols.length > node.functions.length) report.warnings.push(`${entry.path}: symbol preview limited by per-file (${limits.maxSymbolsPerFile}) or collection (${limits.maxSymbolsTotal}) budget.`);
          report.analyzedFiles++;
        } else { noteSkip(entry.path, "Text budget exhausted; metadata retained"); }
      }
      if (text === null) { report.metadataOnlyFiles++; node.summary = `${info.kind} · ${entry.status || "metadata only"}${node.size !== null ? " · " + node.size + " bytes" : ""}`; }
      nodes.push(node); accepted.set(entry.path, { entry, node, text, facts });
    }
    const fileMap = new Map([...accepted].filter(([, value]) => value.node));
    const urlMap = new Map(); for (const [path, value] of fileMap) { const url = safeUrl(value.entry.url); if (url) { const u = new URL(url); u.hash = ""; urlMap.set(u.href, path); } }
    function choose(candidates) { const matches = [...new Set(candidates.filter((path) => path && fileMap.has(path)))]; return matches.length === 1 ? { targets: matches } : { targets: [], reason: matches.length > 1 ? "Ambiguous local resolution" : "External, unavailable, excluded or unresolved target" }; }
    function resolve(path, fact, entry) {
      const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "", spec = fact.specifier;
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
      if (["html-link", "markdown-link"].includes(fact.form)) {
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
    let edgeCap = false;
    for (const [path, value] of fileMap) for (const fact of value.facts.imports) {
      const resolution = resolve(path, fact, value.entry); if (resolution.ignored) continue;
      if (!resolution.targets.length) { if (report.unresolved.length < 1000) report.unresolved.push({ file: path, line: fact.line, specifier: fact.specifier.slice(0, 256), reason: resolution.reason }); continue; }
      for (const target of resolution.targets) {
        if (edges.length >= limits.maxEdges) { edgeCap = true; break; }
        const type = fact.form.endsWith("link") ? "links" : "imports";
        edges.push({ id: id("edge", path + "\0" + fact.line + "\0" + fact.form + "\0" + fact.specifier + "\0" + target + "\0" + edges.length), source: value.node.id, target: fileMap.get(target).node.id, type, label: fact.specifier.slice(0, 240), evidenceStatus: "lexical-candidate", description: `${fact.form}: literal source reference resolves to an included local file. This is a lexical dependency candidate, not a verified execution, call or runtime flow.`, evidence: [evidence(path, value.text, fact.line, fact.endLine, safeUrl(value.entry.url))] });
      }
    }
    if (options.kind === "webpage") {
      let headingCount = 0, referenceCount = 0;
      for (const [path, value] of fileMap) {
        if (!["html", "markdown"].includes(value.node.language) || value.text === null) continue;
        if (nodes.length + hierarchy.length >= limits.maxEntities) { report.warnings.push("Webpage containers limited by hierarchy entity budget."); break; }
        const pageId = id("page", path);
        hierarchy.push({ id: pageId, label: value.node.label, path, kind: "container", group: rootId, parentId: value.node.parentId, level: value.node.level, description: "Collected page · source, authored sections and hyperlink references" });
        value.node.parentId = pageId; value.node.level++;
        for (const symbol of value.facts.symbols) {
          if (headingCount >= 40 || nodes.length + hierarchy.length >= limits.maxEntities) break;
          nodes.push({ id: id("section", path + "\0" + symbol.line + "\0" + symbol.name), label: symbol.name.slice(0, 180), path, kind: "module", group: rootId, parentId: pageId, level: value.node.level, summary: "Authored page section · source text, not an inferred component", evidenceStatus: "source-text", documentIds: [...value.node.documentIds], functions: [], inputs: [], outputs: [], evidence: [evidence(path, value.text, symbol.line, symbol.endLine, safeUrl(value.entry.url))] }); headingCount++;
        }
        const references = new Map();
        for (const fact of value.facts.imports) {
          const resolution = resolve(path, fact, value.entry);
          if (resolution.ignored || resolution.targets.length) continue;
          let targetUrl;
          try { targetUrl = safeUrl(new URL(fact.specifier.replace(/&amp;/g, "&"), value.entry.url || options.url).href); } catch { targetUrl = null; }
          if (!targetUrl) continue;
          let target = references.get(targetUrl);
          if (!target) {
            if (referenceCount >= 40 || nodes.length + hierarchy.length >= limits.maxEntities) break;
            target = id("reference", path + "\0" + targetUrl); references.set(targetUrl, target);
            const parsed = new URL(targetUrl);
            nodes.push({ id: target, label: (parsed.hostname + parsed.pathname).slice(0, 180), path: targetUrl, url: targetUrl, kind: "external", group: rootId, parentId: pageId, level: value.node.level, summary: "Unfetched hyperlink reference · target contents were not inspected", status: "unfetched-reference", evidenceStatus: "unfetched-reference", documentIds: [...value.node.documentIds], functions: [], inputs: [], outputs: [], evidence: [evidence(path, value.text, fact.line, fact.endLine, safeUrl(value.entry.url))] }); referenceCount++;
          }
          if (edges.length < limits.maxEdges) edges.push({ id: id("edge", path + "\0hyperlink\0" + fact.line + "\0" + targetUrl + "\0" + edges.length), source: value.node.id, target, type: "links", label: "hyperlink · " + fact.specifier.slice(0, 240), evidenceStatus: "source-text", description: "The collected source contains this authored hyperlink. The target was not fetched; the link does not establish a code dependency or execution relationship.", evidence: [evidence(path, value.text, fact.line, fact.endLine, safeUrl(value.entry.url))] });
        }
      }
      report.pageSections = headingCount; report.unfetchedReferences = referenceCount;
      if (headingCount >= 40 || referenceCount >= 40) report.warnings.push("Webpage section and unfetched-reference previews are limited to 40 each.");
    }
    if (edgeCap) report.warnings.push(`Relationship output limited to ${limits.maxEdges}.`);
    if (!nodes.length) nodes.push({ id: id("file", "__skylense_empty_manifest__"), label: "No accepted files", kind: "document", parentId: rootId, group: rootId, level: 2, description: "The collection contained no accepted files. Check the ingestion report for limits, exclusions and transport failures.", evidenceStatus: "metadata-only", functions: [], inputs: [], outputs: [], evidence: [], documentIds: [] });
    report.evidenceBytes = evidenceBytes; report.truncatedExcerpts = evidenceTruncated;
    if (evidenceTruncated) report.warnings.push("Some excerpts are partial because of preview budgets; bounded source previews remain in documents.");
    report.truncated = Boolean(evidenceTruncated || symbolsUsed >= limits.maxSymbolsTotal || options.report?.truncated || report.truncatedFiles || report.warnings.some(item => typeof item === "string" && /limited|budget/i.test(item)) || report.skipped.some(item => /limit|budget/i.test(item.reason || "")) || edgeCap);
    report.acceptedFiles = fileCount; report.directories = hierarchy.length - 1; report.relationships = edges.length; report.symbols = nodes.reduce((sum, node) => sum + (node.functions?.length || 0), 0);
    const source = typeof options.source === "string" ? options.source : options.kind || "folder";
    const revision = typeof options.revision === "string" ? options.revision : hash([...fileMap].map(([path, file]) => path + "\0" + (file.text === null ? file.node.size : hash(file.text))).join("\n"));
    const model = { meta: { id: "ingest_" + hash(source + "\0" + title), title, description: "Automatically collected source hierarchy and bounded static reference analysis.", version: 1, source, revision, sourceFolder: title, ...(safeUrl(options.url) ? { repository: safeUrl(options.url) } : {}), evidenceNote: "Automatically analyzed source text. Imports and hyperlinks are lexical candidates resolved against included files; no code was executed, no call graph or runtime flow is inferred. Excerpts may be partial when preview budgets are reached; bounded source previews are available in documents. Preview limits, skipped files and unresolved references are recorded in the ingestion report.", defaultScope: "system", defaultOpen: [], ingestion: report, count: { groups: 1, containers: hierarchy.length, nodes: nodes.length, edges: edges.length, functions: report.symbols, documents: documents.length } }, groups: [group], hierarchy, nodes, edges, flows: [], documents };
    // Escaped JSON can be much larger than UTF-8 source text (for example logs
    // containing backslashes or control characters). Cap the actual pretty JSON
    // used by CLI/browser exports, keeping every graph identity and relationship.
    const outputSize = () => encoder.encode(JSON.stringify(model, null, 2)).length + 1;
    const exportTarget = limits.maxSerializedBytes - 4096;
    let serializedBytes = outputSize();
    if (serializedBytes > exportTarget) {
      report.truncated = true; report.serializedPreviewTruncated = true;
      report.warnings.push("Document previews were shortened to keep the exported model below 14 MiB; node and relationship identities are unchanged.");
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
      if (outputSize() > exportTarget) throw new Error("Graph metadata exceeds the 14 MiB export limit. Reduce maxFiles or select a narrower source folder.");
    }
    report.serializedBytes = 0;
    report.serializedBytes = outputSize();
    report.serializedBytes = outputSize();
    return model;
  }
  root.SkylenseIngest = Object.freeze({ build, classifyPath, isExcludedPath, limits: LIMITS });
})(typeof window !== "undefined" ? window : globalThis);
