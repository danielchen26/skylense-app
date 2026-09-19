/* Static Python declarations and conservative direct-call candidates. No source execution. */
(function (root) {
  "use strict";
  const KEYWORDS = new Set("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case type".split(" "));
  const LIMITATIONS = Object.freeze([
    "Lexical source candidates, not runtime execution or dispatch proof.",
    "Member calls, callable values, inheritance, decorators and dynamic namespace changes are not resolved.",
    "F-string expressions are not inspected; lambda and comprehension calls conservatively abstain.",
    "Conditional or repeated bindings, wildcard imports, global and nonlocal declarations conservatively abstain.",
    "Calls inside declarations with Python type-parameter scopes conservatively abstain.",
  ]);
  function bounded(value, fallback, ceiling) { return Number.isSafeInteger(value) && value > 0 ? Math.min(value, ceiling) : fallback; }
  function lex(text) {
    const tokens = []; let i = 0, line = 1, column = 0, truncated = false;
    const advance = () => { const value = text[i++]; if (value === "\n") { line++; column = 0; } else if (value === "\t") column += 8 - column % 8; else column++; return value; };
    while (i < text.length) {
      if (tokens.length >= 200000) { truncated = true; break; }
      const start = i, atLine = line, col = column, char = text[i];
      if (char === "\n") { advance(); tokens.push({ kind: "newline", value: "\n", line: atLine, endLine: atLine, column: col }); continue; }
      if (/\s/.test(char)) { advance(); continue; }
      if (char === "#") { while (i < text.length && text[i] !== "\n") advance(); continue; }
      if (char === "\\" && /^(?:\r?\n)/.test(text.slice(i + 1, i + 3))) { advance(); if (text[i] === "\r") advance(); advance(); continue; }
      let quoteAt = i;
      if (/[rRuUbBfF]/.test(char)) {
        const prefix = text.slice(i).match(/^[rRuUbBfF]{1,2}(?=["'])/);
        if (prefix) quoteAt += prefix[0].length;
      }
      if (text[quoteAt] === '"' || text[quoteAt] === "'") {
        while (i < quoteAt) advance();
        const quote = text[i], delimiter = text.slice(i, i + 3) === quote.repeat(3) ? quote.repeat(3) : quote;
        for (let n = 0; n < delimiter.length; n++) advance();
        while (i < text.length && text.slice(i, i + delimiter.length) !== delimiter) {
          if (text[i] === "\\") { advance(); if (i < text.length) advance(); }
          else { if (delimiter.length === 1 && text[i] === "\n") break; advance(); }
        }
        if (text.slice(i, i + delimiter.length) === delimiter) for (let n = 0; n < delimiter.length; n++) advance();
        tokens.push({ kind: "data", value: "", line: atLine, endLine: line, column: col }); continue;
      }
      if (/[\p{L}_]/u.test(char)) {
        advance(); while (i < text.length && /[\p{L}\p{N}_]/u.test(text[i])) advance();
        tokens.push({ kind: "word", value: text.slice(start, i), line: atLine, endLine: line, column: col }); continue;
      }
      advance();
      tokens.push({ kind: "punct", value: char, line: atLine, endLine: line, column: col });
    }
    return { tokens, truncated };
  }
  function statements(tokens) {
    const result = []; let current = [], depth = 0, lineIndent = null;
    const flush = () => { if (current.length) result.push({ tokens: current, indent: lineIndent ?? current[0].column }); current = []; };
    for (const token of tokens) {
      if (token.kind === "newline") { if (depth === 0) { flush(); lineIndent = null; } continue; }
      if (lineIndent === null) lineIndent = token.column;
      if (["(", "[", "{"].includes(token.value)) depth++;
      else if ([")", "]", "}"].includes(token.value)) depth = Math.max(0, depth - 1);
      current.push(token);
    }
    flush(); return result;
  }
  function topLevelIndex(tokens, value, start = 0) {
    let depth = 0;
    for (let i = start; i < tokens.length; i++) {
      const current = tokens[i].value;
      if (depth === 0 && current === value) return i;
      if (["(", "[", "{"].includes(current)) depth++;
      else if ([")", "]", "}"].includes(current)) depth--;
    }
    return -1;
  }
  function splitArguments(tokens) {
    const output = []; let group = [], depth = 0;
    for (const token of tokens) {
      if (token.value === "," && depth === 0) { output.push(group); group = []; continue; }
      group.push(token);
      if (["(", "[", "{"].includes(token.value)) depth++;
      else if ([")", "]", "}"].includes(token.value)) depth--;
    }
    output.push(group); return output;
  }
  function analyze(source, options = {}) {
    const maxSymbols = bounded(options.maxSymbols, 2000, 10000), maxCalls = bounded(options.maxCalls, 6000, 20000);
    const original = String(source ?? ""), text = original.slice(0, 512 * 1024);
    const tokenized = lex(text), symbols = [], calls = [], imports = [], scopes = [], callJobs = [];
    let truncated = tokenized.truncated || text.length !== original.length;
    const newScope = (kind, parent, symbol, indent) => { const scope = { kind, parent, symbol, indent, bodyIndent: kind === "module" ? 0 : null, bindings: new Map(), restricted: new Set(), wildcard: false }; scopes.push(scope); return scope; };
    const moduleScope = newScope("module", null, null, -1), stack = [moduleScope];
    const bind = (scope, name, binding) => { if (!name || KEYWORDS.has(name)) return; if (!scope.bindings.has(name)) scope.bindings.set(name, []); scope.bindings.get(name).push(binding); };
    function shadowTargets(scope, tokens, conditional = false) {
      // Attribute and subscript writes do not bind their base name. Destructuring
      // names are included, but names inside attribute/subscript targets are not.
      let subscript = 0;
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i], previous = tokens[i - 1], next = tokens[i + 1];
        if (token.value === "[" && (subscript || previous?.kind === "word" || previous?.value === "]")) { subscript++; continue; }
        if (token.value === "]" && subscript) { subscript--; continue; }
        if (!subscript && token.kind === "word" && previous?.value !== "." && next?.value !== "." && next?.value !== "[") bind(scope, token.value, { kind: "shadow", conditional });
      }
    }
    function parseImports(tokens, scope, conditional) {
      const offset = tokens[0]?.value === "from" ? tokens.findIndex(token => token.value === "import") : tokens[0]?.value === "import" ? 0 : -1;
      if (offset < 0) return false;
      const from = tokens[0].value === "from", module = from ? tokens.slice(1, offset).map(token => token.value).join("") : null;
      let names = tokens.slice(offset + 1); if (names[0]?.value === "(" && names.at(-1)?.value === ")") names = names.slice(1, -1);
      for (const item of splitArguments(names)) {
        if (item.some(token => token.value === "*")) { scope.wildcard = true; continue; }
        const at = item.findIndex(token => token.value === "as"), pathTokens = at < 0 ? item : item.slice(0, at);
        const name = pathTokens.map(token => token.value).join(""), alias = at >= 0 ? item[at + 1]?.value : from ? name : pathTokens[0]?.value;
        if (!name || !alias) continue;
        const record = { module: from ? module : name, name: from ? name : null, alias, line: tokens[0].line, endLine: tokens.at(-1).endLine, owner: scope.symbol };
        imports.push(record); bind(scope, alias, { kind: from ? "import" : "module-import", import: record, conditional });
      }
      return true;
    }
    function inspect(tokens, scope, conditional = false, skipCalls = false) {
      if (!tokens.length) return;
      const separator = topLevelIndex(tokens, ";");
      if (separator >= 0) {
        const suite = ["if", "elif", "else", "while", "for", "with", "except", "try", "finally", "case"].includes(tokens[0].value);
        let start = 0, depth = 0;
        for (let i = 0; i <= tokens.length; i++) {
          const value = tokens[i]?.value;
          if (i === tokens.length || value === ";" && depth === 0) { inspect(tokens.slice(start, i), scope, conditional || (start > 0 && suite), skipCalls); start = i + 1; }
          else if (["(", "[", "{"].includes(value)) depth++;
          else if ([")", "]", "}"].includes(value)) depth--;
        }
        return;
      }
      if (parseImports(tokens, scope, conditional)) return;
      const first = tokens[0].value;
      if (first === "global" || first === "nonlocal") { for (const token of tokens.slice(1)) if (token.kind === "word") scope.restricted.add(token.value); return; }
      if (first === "case") {
        const colon = topLevelIndex(tokens, ":");
        // Pattern constructors are not calls. Captures can rebind names, so
        // conservative pattern binding is preferable to a false callable edge.
        shadowTargets(scope, tokens.slice(1, colon < 0 ? undefined : colon), true);
        if (colon >= 0 && colon < tokens.length - 1) inspect(tokens.slice(colon + 1), scope, true);
        return;
      }
      const comprehension = tokens.some(token => token.value === "for") && !["for", "async"].includes(first);
      const lambda = tokens.some(token => token.value === "lambda");
      // Statements whose grammar adds another lexical scope abstain rather than
      // letting comprehension/lambda variables leak or manufacture direct calls.
      const uncertainScope = comprehension || lambda;
      let depth = 0, assignmentStart = 0;
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i], previous = tokens[i - 1], next = tokens[i + 1];
        if (token.value === "=" && depth === 0 && !["=", "!", "<", ">", ":"].includes(previous?.value) && next?.value !== "=") {
          const lhs = tokens.slice(assignmentStart, i).filter(item => !["+", "-", "*", "/", "%", "|", "&", "^"].includes(item.value));
          const annotation = topLevelIndex(lhs, ":"); shadowTargets(scope, annotation < 0 ? lhs : lhs.slice(0, annotation), conditional); assignmentStart = i + 1;
        }
        if (token.value === ":" && next?.value === "=" && previous?.kind === "word") bind(scope, previous.value, { kind: "shadow", conditional });
        if (["(", "[", "{"].includes(token.value)) depth++;
        else if ([")", "]", "}"].includes(token.value)) depth--;
        if (skipCalls || token.kind !== "word" || next?.value !== "(" || previous?.value === "." || KEYWORDS.has(token.value)) continue;
        if (callJobs.length >= maxCalls) { truncated = true; continue; }
        callJobs.push({ name: token.value, line: token.line, endLine: token.endLine, owner: scope.symbol, scope, uncertainScope });
      }
      if (first === "for" || first === "async" && tokens[1]?.value === "for") {
        const begin = first === "async" ? 2 : 1, stop = topLevelIndex(tokens, "in", begin);
        if (stop >= 0) shadowTargets(scope, tokens.slice(begin, stop), true);
      }
      if (["with", "except"].includes(first) || first === "async" && tokens[1]?.value === "with") {
        for (let i = 0; i < tokens.length; i++) if (tokens[i].value === "as") {
          let end = i + 1, depth = 0;
          while (end < tokens.length) {
            const value = tokens[end].value;
            if (!depth && [":", ","].includes(value)) break;
            if (["(", "[", "{"].includes(value)) depth++;
            else if ([")", "]", "}"].includes(value)) depth--;
            end++;
          }
          shadowTargets(scope, tokens.slice(i + 1, end), true);
        }
      }
      if (first === "del") shadowTargets(scope, tokens.slice(1), true);
      // An annotation alone makes a name local inside a function.
      if (scope.kind === "function" && tokens[0].kind === "word" && tokens[1]?.value === ":") bind(scope, first, { kind: "shadow", conditional });
      if (["if", "elif", "else", "while", "for", "with", "except", "try", "finally"].includes(first)) {
        const colon = topLevelIndex(tokens, ":"); if (colon >= 0 && colon < tokens.length - 1) inspect(tokens.slice(colon + 1), scope, true, true);
      }
    }
    for (const statement of statements(tokenized.tokens)) {
      const tokens = statement.tokens, first = tokens[0];
      while (stack.length > 1 && statement.indent <= stack.at(-1).indent) stack.pop();
      const scope = stack.at(-1);
      if (scope.bodyIndent === null) scope.bodyIndent = statement.indent;
      for (const current of stack) if (current.symbol !== null) symbols[current.symbol].bodyEndLine = tokens.at(-1).endLine;
      const defAt = first.value === "async" && tokens[1]?.value === "def" ? 1 : 0;
      const keyword = tokens[defAt], name = tokens[defAt + 1];
      const isDeclaration = ["class", "def"].includes(keyword?.value) && name?.kind === "word";
      const colon = isDeclaration ? topLevelIndex(tokens, ":", defAt + 2) : -1;
      if (!isDeclaration || colon < 0) { inspect(tokens, scope, statement.indent > scope.bodyIndent); continue; }
      if (symbols.length >= maxSymbols) {
        truncated = true; bind(scope, name.value, { kind: "shadow" });
        const omitted = newScope(keyword.value === "class" ? "class" : "function", scope, null, statement.indent); omitted.omitted = true;
        if (colon < tokens.length - 1) inspect(tokens.slice(colon + 1), omitted); else stack.push(omitted);
        continue;
      }
      const parent = scope.symbol, index = symbols.length, kind = keyword.value === "class" ? "class" : "function";
      const symbol = { index, name: name.value, qualifiedName: parent === null ? name.value : symbols[parent].qualifiedName + "." + name.value, kind, line: first.line, endLine: tokens[colon].endLine, bodyEndLine: tokens.at(-1).endLine, parent };
      symbols.push(symbol); bind(scope, name.value, { kind: "local", symbol: index, conditional: statement.indent > scope.bodyIndent });
      // Base expressions, argument defaults and annotations are evaluated in the
      // enclosing scope. Declaration names themselves are never call sites.
      inspect(tokens.slice(defAt + 2, colon), scope);
      const inner = newScope(kind, scope, index, statement.indent);
      inner.uncertainTypeParameters = tokens[defAt + 2]?.value === "[";
      if (kind === "function") {
        const open = topLevelIndex(tokens, "(", defAt + 2), close = (() => { let depth = 0; for (let i = open; i >= 0 && i < colon; i++) { if (tokens[i].value === "(") depth++; else if (tokens[i].value === ")" && --depth === 0) return i; } return -1; })();
        if (tokens[open]?.value === "(" && close >= 0) for (const argument of splitArguments(tokens.slice(open + 1, close))) {
          const parameter = argument.find(token => token.kind === "word"); if (parameter) bind(inner, parameter.value, { kind: "shadow" });
        }
      }
      if (colon < tokens.length - 1) inspect(tokens.slice(colon + 1), inner);
      else stack.push(inner);
    }
    function resolve(job) {
      if (job.uncertainScope) return { kind: "unresolved", reason: "Lambda or comprehension scope is not resolved" };
      let scope = job.scope, skipClasses = scope.kind === "function";
      while (scope) {
        if (scope.omitted) return { kind: "unresolved", reason: "Enclosing declaration omitted by symbol limit" };
        if (scope.uncertainTypeParameters) return { kind: "unresolved", reason: "Type-parameter scopes require deeper analysis" };
        if (scope.kind === "class" && skipClasses) { scope = scope.parent; continue; }
        if (scope.restricted.has(job.name)) return { kind: "unresolved", reason: "Global or nonlocal binding requires deeper scope analysis" };
        if (scope.wildcard) return { kind: "unresolved", reason: "Wildcard import makes this namespace ambiguous" };
        const bindings = scope.bindings.get(job.name) || [];
        if (bindings.length) {
          if (bindings.length !== 1 || bindings[0].kind === "shadow" || bindings[0].conditional) return { kind: "unresolved", reason: "Name has shadowing, repeated or conditional bindings" };
          const binding = bindings[0];
          if (binding.kind === "local") return { kind: "local", symbol: binding.symbol };
          if (binding.kind === "import") return { kind: "import", module: binding.import.module, name: binding.import.name, alias: binding.import.alias };
          return { kind: "unresolved", reason: "Imported module is not a directly declared callable" };
        }
        if (scope.kind === "function" || scope.kind === "class") skipClasses = true;
        scope = scope.parent;
      }
      return { kind: "unresolved", reason: "No unique declaration or explicit from-import binding in source" };
    }
    for (const { scope, uncertainScope, ...job } of callJobs) calls.push({ ...job, resolution: resolve({ ...job, scope, uncertainScope }) });
    const callableExports = Object.create(null);
    if (!moduleScope.wildcard) for (const [name, bindings] of moduleScope.bindings) if (!moduleScope.restricted.has(name) && bindings.length === 1 && bindings[0].kind === "local" && !bindings[0].conditional) callableExports[name] = bindings[0].symbol;
    return { symbols, calls, imports, callableExports, limitations: [...LIMITATIONS], truncated };
  }
  root.SkylensePythonStructure = Object.freeze({ analyze });
})(typeof globalThis !== "undefined" ? globalThis : window);
