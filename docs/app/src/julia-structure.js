/* Bounded Julia source navigation. Lexical evidence only; never executes Julia. */
(function (root) {
  "use strict";
  const LIMITATIONS = Object.freeze([
    "Lexical Julia declarations and literal include/module references, not runtime execution proof.",
    "Multiple dispatch, generated methods, macro expansion and computed include targets are not resolved.",
    "Quoted code, string interpolation and command literals are not inspected as executable source.",
    "Callable-object methods and uncommon operator syntax may not produce declaration previews.",
  ]);
  const OPEN = new Set(["(", "[", "{"]), CLOSE = new Set([")", "]", "}"]);
  const WORD = /[\p{L}\p{Nl}_]/u, WORD_PART = /[\p{L}\p{N}\p{M}_!?′″]/u;
  const BLOCK = new Set(["begin", "if", "for", "while", "let", "try", "do", "quote", "macro"]);
  const RESERVED = new Set("begin end if else elseif for while let try catch finally do quote macro function module baremodule struct mutable abstract primitive type return local global const using import export public where true false nothing break continue in isa".split(" "));
  const bound = (value, fallback, max) => Number.isSafeInteger(value) && value > 0 ? Math.min(value, max) : fallback;

  function lex(text) {
    const tokens = []; let i = 0, line = 1, truncated = false;
    const advance = () => { if (text[i++] === "\n") line++; };
    while (i < text.length) {
      if (tokens.length >= 200000) { truncated = true; break; }
      const start = i, at = line, c = text[i];
      if (c === "\n") { advance(); tokens.push({ value: "\n", kind: "newline", line: at, endLine: at }); continue; }
      if (/\s/.test(c)) { advance(); continue; }
      if (text.slice(i, i + 2) === "#=") {
        let depth = 1; i += 2;
        while (i < text.length && depth) {
          if (text.slice(i, i + 2) === "#=") { depth++; i += 2; }
          else if (text.slice(i, i + 2) === "=#") { depth--; i += 2; }
          else advance();
        }
        if (depth) truncated = true;
        continue;
      }
      if (c === "#") { while (i < text.length && text[i] !== "\n") advance(); continue; }
      if (c === '"' || c === "`") {
        const delimiter = text.slice(i, i + 3) === c.repeat(3) ? c.repeat(3) : c;
        i += delimiter.length; let value = "", simple = c === '"' && delimiter.length === 1, closed = false;
        while (i < text.length) {
          if (text.slice(i, i + delimiter.length) === delimiter) { i += delimiter.length; closed = true; break; }
          if (text[i] === "\\") {
            advance(); const escaped = text[i];
            if (["\\", '"', "$"].includes(escaped)) value += escaped;
            else simple = false;
            if (i < text.length) advance();
          } else { if (text[i] === "$" || text[i] === "\n") simple = false; value += text[i]; advance(); }
        }
        tokens.push({ value: null, literal: simple && closed ? value : null, kind: "string", line: at, endLine: line });
        if (!closed) truncated = true;
        continue;
      }
      // An apostrophe after an expression is Julia's adjoint operator. Only
      // consume a character literal when its complete one-character form fits.
      if (c === "'") {
        const char = text.slice(i).match(/^'(?:\\(?:[abefnrtv\\'"$]|[0-7]{1,3}|x[\da-fA-F]{1,2}|u[\da-fA-F]{1,4}|U[\da-fA-F]{1,8})|[^'\\\r\n])'/u);
        if (char) { i += char[0].length; tokens.push({ value: null, kind: "data", line: at, endLine: line }); continue; }
      }
      if (WORD.test(c)) {
        advance(); while (i < text.length && WORD_PART.test(text[i])) advance();
        tokens.push({ value: text.slice(start, i), kind: "word", line: at, endLine: line }); continue;
      }
      const operator = text.slice(i).match(/^(?:::|==|!=|<=|>=|=>|->|<:|>:|&&|\|\||\+=|-=|\*=|\/=|\^=|\.{3})/);
      if (operator) i += operator[0].length; else advance();
      tokens.push({ value: text.slice(start, i), kind: "punct", line: at, endLine: line });
    }
    // Pairing is independent of `end`, which also appears as an array index.
    const stack = [];
    for (let n = 0; n < tokens.length; n++) {
      const token = tokens[n]; token.depth = stack.length;
      if (OPEN.has(token.value)) stack.push(n);
      else if (CLOSE.has(token.value)) {
        const at = stack.pop();
        if (at !== undefined && "([{"
          .indexOf(tokens[at].value) === ")]}".indexOf(token.value)) { tokens[at].match = n; token.match = at; }
        else truncated = true;
      }
    }
    if (stack.length) truncated = true;
    return { tokens, truncated, lastLine: line };
  }

  function nameAt(tokens, start) {
    let i = start, name = "";
    while (i < tokens.length) {
      const t = tokens[i];
      if (t.kind === "word" && !RESERVED.has(t.value)) { name += t.value; i++; }
      else if (t.value === ":" && tokens[i + 1]?.value === "(" && tokens[i + 1].match != null) {
        const end = tokens[i + 1].match, operator = tokens.slice(i + 2, end);
        if (!operator.length || operator.some(x => x.kind !== "punct" || OPEN.has(x.value) || CLOSE.has(x.value))) return null;
        name += operator.map(x => x.value).join(""); i = end + 1;
      } else if (!name && t.kind === "punct" && /^[+\-*\/%^=<>!&|~⊻÷≤≥≠∈∉⊆⊇]+$/u.test(t.value)) { name = t.value; i++; }
      else return null;
      if (tokens[i]?.value !== ".") break;
      name += "."; i++;
    }
    return name ? { name, next: i } : null;
  }
  function headerEnd(tokens, start) {
    const depth = tokens[start].depth; let end = start;
    for (let i = start + 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.depth === depth && ["\n", ";", "end"].includes(t.value)) break;
      end = i;
    }
    return end;
  }
  function statementEnd(tokens, start) {
    const depth = tokens[start].depth; let end = start;
    for (let i = start + 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.depth === depth && ([";", "end"].includes(t.value) || t.value === "\n" && tokens[i - 1]?.value !== ",")) break;
      end = i;
    }
    return end;
  }
  function literalInclude(tokens, start) {
    const open = tokens[start + 1], stop = open?.match;
    if (open?.value !== "(" || stop == null) return null;
    const part = tokens.slice(start + 2, stop).filter(t => t.kind !== "newline");
    if (part.at(-1)?.value === ",") part.pop();
    if (part.length === 1 && part[0].kind === "string" && part[0].literal != null) return { path: part[0].literal, stop };
    // joinpath(@__DIR__, "subdir", "file.jl") is source-relative. Other
    // joinpath expressions may depend on the working directory and abstain.
    if (part[0]?.value !== "joinpath" || part[1]?.value !== "(" || part.at(-1)?.value !== ")" || part[2]?.value !== "@" || part[3]?.value !== "__DIR__") return null;
    const pieces = []; let i = 4;
    while (i < part.length - 1) {
      if (part[i++].value !== ",") return null;
      if (i === part.length - 1) break;
      if (part[i]?.kind !== "string" || part[i].literal == null || !part[i].literal || /^[\\/]/.test(part[i].literal)) return null;
      pieces.push(part[i++].literal);
    }
    return pieces.length ? { path: pieces.join("/"), stop } : null;
  }

  function analyze(source, options = {}) {
    const original = String(source ?? ""), text = original.slice(0, 512 * 1024), tokenized = lex(text), { tokens } = tokenized;
    const symbols = [], imports = [], frames = [], maxSymbols = bound(options.maxSymbols, 2000, 10000), maxImports = bound(options.maxImports, 4000, 10000);
    let truncated = tokenized.truncated || text.length !== original.length, quotedUntil = -1, last = null, statementStart = true;
    const owner = () => { for (let i = frames.length - 1; i >= 0; i--) if (frames[i].symbol != null) return frames[i].symbol; return null; };
    const suppressed = () => frames.some(frame => frame.quoted);
    const addImport = fact => { if (imports.length < maxImports) imports.push(fact); else truncated = true; };
    function addSymbol(name, kind, start, end) {
      if (!name || suppressed()) return null;
      if (symbols.length >= maxSymbols) { truncated = true; return null; }
      const parent = owner(), symbol = { index: symbols.length, name, qualifiedName: parent === null ? name : `${symbols[parent].qualifiedName}.${name}`, kind, line: tokens[start].line, endLine: tokens[end].endLine, bodyEndLine: tokens[end].endLine, parent };
      symbols.push(symbol); return symbol.index;
    }
    function closeFrame(frame, line) { if (frame?.symbol != null) symbols[frame.symbol].bodyEndLine = Math.max(symbols[frame.symbol].endLine, line); }
    function finishShort(t) {
      const frame = frames.at(-1);
      if (frame?.short && t.depth === frame.depth && last && last.index > frame.assignment && !["=", ",", "+", "-", "*", "/", "&&", "||", "?", ":", "|>"].includes(last.value)) closeFrame(frames.pop(), last.endLine);
    }
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i], previous = tokens[i - 1], next = tokens[i + 1], value = t.value;
      if (i <= quotedUntil) continue;
      if (value === ":" && next?.value === "(" && next.match != null) { quotedUntil = next.match; continue; }
      if (value === "\n" || value === ";") { finishShort(t); statementStart = true; continue; }
      if (value === "end" && previous?.value !== ":" && previous?.value !== ".") {
        finishShort(t);
        if (frames.at(-1)?.depth === t.depth) closeFrame(frames.pop(), t.line);
        statementStart = false; last = { ...t, index: i }; continue;
      }
      const isQuoted = suppressed() || previous?.value === ":" || previous?.value === ".";
      if (!isQuoted && value === "include" && previous?.value !== "@") {
        const target = literalInclude(tokens, i);
        if (target && target.path && !/[\u0000-\u001f]/.test(target.path)) addImport({ specifier: target.path, form: "julia-include", line: t.line, endLine: tokens[target.stop].endLine });
      }
      if (!isQuoted && ["using", "import"].includes(value)) {
        const end = statementEnd(tokens, i); let name = "", stopped = false;
        const flush = () => { if (/^\.*[\p{L}_][\p{L}\p{N}_]*(?:\.[\p{L}_][\p{L}\p{N}_]*)*$/u.test(name)) addImport({ specifier: name, form: "julia-module", line: t.line, endLine: tokens[end].endLine }); name = ""; };
        for (let j = i + 1; j <= end; j++) {
          const part = tokens[j];
          if (part.value === ":") { flush(); stopped = true; break; }
          if (part.value === ",") flush();
          else if (part.value === "as") { flush(); j++; }
          else if (part.kind === "word" || part.value === ".") name += part.value;
        }
        if (!stopped) flush();
      }
      let opened = false;
      if (previous?.value !== ":" && previous?.value !== "." && ["module", "baremodule", "struct", "function", "abstract", "primitive"].includes(value)) {
        const isType = ["abstract", "primitive"].includes(value);
        if (!isType || next?.value === "type") {
          const named = nameAt(tokens, i + (isType ? 2 : 1)), end = headerEnd(tokens, i);
          const kind = ["module", "baremodule"].includes(value) ? "module" : isType ? value : value;
          const symbol = addSymbol(named?.name, kind, i, end);
          frames.push({ depth: t.depth, symbol }); opened = true;
        }
      }
      if (!opened && !isQuoted && statementStart && (t.kind === "word" && !RESERVED.has(value) || t.kind === "punct" && /^[+\-*\/%^=<>!&|~⊻÷≤≥≠]+$/u.test(value))) {
        const named = nameAt(tokens, i), parameter = named && tokens[named.next];
        if (parameter?.value === "(" && parameter.match != null) {
          const end = headerEnd(tokens, i); let assignment = parameter.match + 1;
          while (assignment <= end && tokens[assignment].value !== "=") assignment++;
          // A return type or `where` suffix is allowed, but comparisons and
          // arbitrary expressions after a call cannot create declarations.
          const suffix = tokens.slice(parameter.match + 1, assignment);
          if (assignment <= end && (!suffix.length || ["::", "where"].includes(suffix[0].value)) && !suffix.some(x => ["==", "!=", "&&", "||"].includes(x.value))) {
            const symbol = addSymbol(named.name, "function", i, assignment);
            frames.push({ depth: t.depth, symbol, short: true, assignment });
          }
        }
      }
      if (!opened && BLOCK.has(value) && previous?.value !== ":" && previous?.value !== ".") {
        const inExpression = t.depth > (frames.at(-1)?.depth ?? 0);
        const comprehension = inExpression && (value === "for" || value === "if" && !["(", "[", ",", "="].includes(previous?.value));
        const indexBegin = value === "begin" && inExpression && ["[", ","].includes(previous?.value);
        if (!comprehension && !indexBegin) frames.push({ depth: t.depth, symbol: null, quoted: value === "quote" || value === "macro" || suppressed() });
      }
      // Prefix macros and mutable preserve a declaration's statement head.
      if (!(value === "@" || previous?.value === "@" || ["mutable", "const", "global", "local"].includes(value))) statementStart = false;
      last = { ...t, index: i };
    }
    while (frames.length) {
      const frame = frames.pop(); closeFrame(frame, tokenized.lastLine);
      if (!frame.short) truncated = true;
    }
    return { symbols, imports, truncated, limitations: [...LIMITATIONS] };
  }
  root.SkylenseJuliaStructure = Object.freeze({ analyze, limitations: LIMITATIONS });
})(typeof window !== "undefined" ? window : globalThis);
