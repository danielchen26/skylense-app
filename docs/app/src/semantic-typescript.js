/* JavaScript/TypeScript binding uses the compiler's symbol table, never source execution. */
(function (root) {
  "use strict";
  let compiler, previousProgram, previousSignature;
  async function analyze(entries, options = {}) {
    const candidates = entries.filter(e => /\.(?:[cm]?[jt]sx?)$/.test(e.path) && e.syntaxFacts);
    if (!candidates.length) return { engine: "typescript", checked: 0, resolvedCalls: 0 };
    if (!compiler) compiler = await options.loadCompiler();
    const ts = compiler, fileMap = new Map(entries.map(e => [e.path, { entry: e, text: e.text, facts: e.syntaxFacts }]));
    root.SkylenseSourceResolver.configure?.({ typescript: ts });
    const norm = p => p.replace(/^\//, "");
    const joinRelative = (base, tail) => { const parts = base ? base.split("/") : []; for (const part of tail.split("/")) { if (!part || part === ".") continue; if (part === "..") { if (!parts.length) return null; parts.pop(); } else parts.push(part); } return parts.join("/"); };
    const choose = values => { const matches = [...new Set(values.filter(p => p && fileMap.has(p)))]; return { targets: matches.length === 1 ? matches : [] }; };
    const resolver = root.SkylenseSourceResolver.create(fileMap, { joinRelative, choose });
    const settings = { allowJs: true, checkJs: true, noLib: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler };
    const host = {
      getSourceFile: (name, version) => { const value = fileMap.get(norm(name)); if (!value || typeof value.text !== "string") return undefined; return ts.createSourceFile(name, value.text, version, true); },
      getDefaultLibFileName: () => "", writeFile() {}, getCurrentDirectory: () => "/", getDirectories: () => [],
      directoryExists: dir => [...fileMap.keys()].some(p => p.startsWith(norm(dir).replace(/\/$/, "") + "/")),
      fileExists: name => fileMap.has(norm(name)), readFile: name => fileMap.get(norm(name))?.text,
      getCanonicalFileName: name => name, useCaseSensitiveFileNames: () => true, getNewLine: () => "\n",
      resolveModuleNames: (names, from) => names.map(spec => { const result = resolver(norm(from), { form: "js-import", specifier: spec }); const path = result?.targets.length === 1 ? result.targets[0] : null; return path && /\.[cm]?[jt]sx?$/.test(path) ? { resolvedFileName: "/" + path, extension: path.endsWith(".tsx") ? ts.Extension.Tsx : path.endsWith(".jsx") ? ts.Extension.Jsx : /\.m?js$/.test(path) ? ts.Extension.Js : ts.Extension.Ts, isExternalLibraryImport: false } : undefined; }),
    };
    const signature = JSON.stringify(entries.map(e => [e.path, /\.(?:[cm]?[jt]sx?|json)$/.test(e.path) ? e.text : null]));
    const program = previousProgram && previousSignature === signature ? previousProgram : ts.createProgram(candidates.map(e => "/" + e.path), settings, host);
    const checker = program.getTypeChecker(); let resolvedCalls = 0, resolvedRelationships = 0;
    for (let i = 0; i < candidates.length; i++) {
      options.signal?.throwIfAborted();
      const entry = candidates[i], source = program.getSourceFile("/" + entry.path), facts = entry.syntaxFacts;
      // Semantic results depend on every current dependency, so never persist them
      // inside content-only cached syntax facts or carry targets from an older run.
      const calls = (facts.structure?.calls || []).map(call => ({ ...call, resolution: { kind: "unresolved", reason: "The current project symbol table did not resolve a unique included callable declaration" } }));
      // Rebuild heritage facts from the compiler AST. Syntax-only heritage
      // identifiers can include generic arguments and are not proven targets.
      const relationships = [];
      const byLine = new Map(); calls.forEach(call => { if (!byLine.has(call.line)) byLine.set(call.line, []); byLine.get(call.line).push(call); });
      const ownerAt = (start, end) => facts.symbols.map((s, index) => ({ s, index }))
        .filter(({ s }) => Number.isInteger(s.startIndex) && Number.isInteger(s.endIndex) && s.startIndex <= start && s.endIndex >= end)
        .sort((a, b) => (a.s.endIndex - a.s.startIndex) - (b.s.endIndex - b.s.startIndex))[0]?.index ?? null;
      const declarationTarget = (declaration, targetSource, other, kinds = ["function", "class"]) => {
        if ((ts.isArrowFunction(declaration) || ts.isFunctionExpression(declaration)) && ts.isVariableDeclaration(declaration.parent)) declaration = declaration.parent;
        let anchor = declaration.name;
        if (ts.isConstructorDeclaration(declaration)) anchor = declaration.getChildren(targetSource).find(child => child.kind === ts.SyntaxKind.ConstructorKeyword);
        const position = anchor?.getStart(targetSource);
        // Modifiers such as `export`, `async`, `public` and decorators are not
        // consistently included in the two parsers' declaration-node spans.
        // Their actual declaration-name token is the shared exact anchor.
        const matches = other.symbols.filter(symbol => kinds.includes(symbol.kind) && (
          Number.isInteger(position) && Number.isInteger(symbol.nameStartIndex) ? symbol.nameStartIndex === position :
            symbol.startIndex === declaration.getStart(targetSource) && symbol.endIndex === declaration.end
        ));
        return matches.length === 1 ? matches[0] : null;
      };
      function visit(node) {
        if ((ts.isClassDeclaration(node) || ts.isClassExpression(node) || ts.isInterfaceDeclaration(node)) && node.heritageClauses?.length) {
          const owner = declarationTarget(node, source, facts, ["class", "interface"]);
          for (const clause of node.heritageClauses) for (const type of clause.types) {
            const expression = type.expression, start = expression.getStart(source), location = source.getLineAndCharacterOfPosition(start);
            const form = clause.token === ts.SyntaxKind.ImplementsKeyword ? "implements" : "inherits";
            const relation = { form, name: expression.getText(source), owner: owner?.index ?? null, line: location.line + 1, endLine: source.getLineAndCharacterOfPosition(type.end).line + 1, column: location.character, startIndex: start, endIndex: type.end, resolution: { kind: "unresolved", reason: "Heritage target is not a unique included class or interface declaration" } };
            if (owner && (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression))) {
              let symbol = checker.getSymbolAtLocation(expression);
              if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
              const declarations = symbol?.declarations || [];
              // Parameter values, computed mixins, type aliases and merged
              // declarations remain unresolved instead of borrowing a name.
              if (declarations.length === 1) {
                const declaration = declarations[0], classExtends = form === "inherits" && !ts.isInterfaceDeclaration(node);
                if (ts.isClassDeclaration(declaration) || (!classExtends && ts.isInterfaceDeclaration(declaration))) {
                  const targetSource = declaration.getSourceFile(), path = norm(targetSource.fileName), other = fileMap.get(path)?.facts;
                  const target = other && declarationTarget(declaration, targetSource, other, ["class", "interface"]);
                  if (target) {
                    relation.resolution = { kind: "source", path, line: target.line, column: target.column, name: target.name, index: target.index, engine: "typescript-symbols" };
                    relation.evidenceStatus = "resolved-static"; resolvedRelationships++;
                  }
                }
              }
            }
            relationships.push(relation);
          }
        }
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
          const start = node.getStart(source), end = node.end, location = source.getLineAndCharacterOfPosition(start), line = location.line + 1;
          let declaration = checker.getResolvedSignature(node)?.declaration;
          if (!declaration && ts.isNewExpression(node)) { let symbol = checker.getSymbolAtLocation(node.expression); if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol); declaration = symbol?.valueDeclaration; }
          const callable = declaration && (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration) || ts.isConstructorDeclaration(declaration) || ts.isArrowFunction(declaration) || ts.isFunctionExpression(declaration) || ts.isClassDeclaration(declaration));
          if (callable) {
            const targetSource = declaration.getSourceFile(), path = norm(targetSource.fileName), other = fileMap.get(path)?.facts;
            if (other) {
              const target = declarationTarget(declaration, targetSource, other);
              if (target) {
                const name = node.expression.getText(source), column = location.character;
                const existing = (byLine.get(line) || []).find(call => call.name === name && call.column === column && (!Number.isInteger(call.startIndex) || call.startIndex === start));
                const call = existing || { name, column, owner: ownerAt(start, end), line, endLine: source.getLineAndCharacterOfPosition(end).line + 1, startIndex: start, endIndex: end };
                call.resolution = { kind: "source", path, line: target.line, column: target.column, nameLine: target.nameLine, nameColumn: target.nameColumn, index: target.index, name: target.name, engine: "typescript-symbols" };
                call.evidenceStatus = "resolved-static";
                if (!existing) calls.push(call);
                resolvedCalls++;
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      }
      if (source) visit(source);
      facts.structure = { ...(facts.structure || {}), calls };
      facts.relationships = relationships;
      options.onProgress?.({ phase: "semantic", completed: i + 1, total: candidates.length, path: entry.path });
    }
    previousProgram = program; previousSignature = signature;
    return { engine: "typescript", version: ts.version, checked: candidates.length, resolvedCalls, resolvedRelationships, scope: "Included JavaScript/TypeScript project call and class/interface heritage bindings; no runtime execution, contract-validity proof or external type library inference." };
  }
  root.SkylenseTypeScriptSemantics = { analyze };
})(typeof window !== "undefined" ? window : globalThis);
