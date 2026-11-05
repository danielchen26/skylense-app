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
    // Every binding below was proved against exactly these program inputs, so
    // the resolution carries their digest. A consumer that cannot reproduce this
    // context must not treat the binding as a current fact, and a synthesized
    // constant would grant that trust without the evidence.
    const signature = JSON.stringify(entries.map(e => [e.path, /\.(?:[cm]?[jt]sx?|json)$/.test(e.path) ? e.text : null]));
    const projectContextHash = root.SkylenseAnalysisIR?.sha256Text
      ? root.SkylenseAnalysisIR.sha256Text("typescript-program\0" + ts.version + "\0" + signature)
      : null;
    const program = previousProgram && previousSignature === signature ? previousProgram : ts.createProgram(candidates.map(e => "/" + e.path), settings, host);
    const checker = program.getTypeChecker(); let resolvedCalls = 0, resolvedRelationships = 0;
    /* The program's own inputs are the project context of every binding below: each
       included path, the exact text of every file the checker may read, and the compiler
       version that read them. A binding can only be re-verified against the same inputs,
       so a snapshot without this hash stays a candidate instead of a static fact. */
    const provenance = rule => ({ engine: "typescript-symbols", rule, ...(projectContextHash ? { projectContextHash } : {}) });
    /** Does this module declare `name` itself, ahead of any `export *`? */
    function declaresExport(statement, name) {
      if (ts.isExportDeclaration(statement)) {
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) return statement.exportClause.elements.some(element => element.name?.text === name);
        if (statement.exportClause && ts.isNamespaceExport(statement.exportClause)) return statement.exportClause.name?.text === name;
        return false;
      }
      if (!statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) return false;
      if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === name);
      return Boolean(statement.name && ts.isIdentifier(statement.name) && statement.name.text === name);
    }
    // ECMAScript excludes a name that two `export *` sources provide with different
    // declarations: the barrel exports nothing under that name. The checker still hands
    // back the first one it recorded, so picking it would be a guess.
    // https://tc39.es/ecma262/#sec-getexportednames
    const ambiguityCache = new Map();
    function ambiguousStarExport(moduleSymbol, name) {
      const files = (moduleSymbol?.declarations || []).filter(declaration => ts.isSourceFile(declaration));
      if (!files.length) return false;
      const key = files.map(file => file.fileName).join("\0") + "\0" + name;
      if (ambiguityCache.has(key)) return ambiguityCache.get(key);
      const stars = [];
      let explicit = false;
      for (const file of files) for (const statement of file.statements) {
        if (declaresExport(statement, name)) { explicit = true; break; }
        if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && !statement.exportClause) stars.push(statement.moduleSpecifier);
      }
      let ambiguous = false;
      if (!explicit && stars.length > 1) {
        const providers = new Set();
        for (const specifier of stars) {
          const target = checker.getSymbolAtLocation(specifier);
          if (!target) continue;
          let exported = checker.getExportsOfModule(target).find(symbol => symbol.name === name);
          if (!exported) continue;
          if (exported.flags & ts.SymbolFlags.Alias) { try { exported = checker.getAliasedSymbol(exported); } catch { /* unresolvable alias stays its own provider */ } }
          const declaration = exported.declarations?.[0];
          providers.add(declaration ? `${norm(declaration.getSourceFile().fileName)}:${declaration.pos}` : `${name}@unresolved`);
        }
        ambiguous = providers.size > 1;
      }
      ambiguityCache.set(key, ambiguous);
      return ambiguous;
    }
    /** The barrel an identifier was imported from, with the name it is exported under. */
    function importBinding(expression) {
      if (!ts.isIdentifier(expression)) return null;
      const symbol = checker.getSymbolAtLocation(expression);
      if (!symbol || !(symbol.flags & ts.SymbolFlags.Alias)) return null;
      for (const declaration of symbol.declarations || []) {
        const specifier = ts.isImportSpecifier(declaration) ? declaration.parent?.parent?.parent?.moduleSpecifier
          : ts.isImportClause(declaration) ? declaration.parent?.moduleSpecifier : null;
        if (!specifier) continue;
        const exported = ts.isImportSpecifier(declaration) ? (declaration.propertyName || declaration.name) : declaration.name;
        return { module: checker.getSymbolAtLocation(specifier), name: exported?.text || "", specifier };
      }
      return null;
    }
    /** The reason an imported name cannot be bound at all, or null when it can. */
    function bindingRefusal(expression) {
      const binding = importBinding(expression);
      if (!binding?.module || !binding.name || !ambiguousStarExport(binding.module, binding.name)) return null;
      const from = (binding.module.declarations || []).filter(declaration => ts.isSourceFile(declaration)).map(declaration => norm(declaration.fileName)).join(", ");
      return `Ambiguous star re-export: more than one \`export *\` source in ${from || "the re-exporting module"} provides "${binding.name}", so that module exports no declaration under this name`;
    }
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
      const ownerIndex = facts.symbols.map((s, index) => ({ s, index }))
        .filter(({ s }) => Number.isInteger(s.startIndex) && Number.isInteger(s.endIndex))
        .sort((a, b) => a.s.startIndex - b.s.startIndex || (a.s.endIndex - a.s.startIndex) - (b.s.endIndex - b.s.startIndex));
      const ownerAt = (start, end) => {
        let best = null;
        for (const item of ownerIndex) {
          if (item.s.startIndex > start) break;
          if (item.s.endIndex >= end) {
            const span = item.s.endIndex - item.s.startIndex;
            if (!best || span < best.span) best = { index: item.index, span };
          }
        }
        return best?.index ?? null;
      };
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
            const refusal = ts.isIdentifier(expression) ? bindingRefusal(expression) : null;
            if (refusal) relation.resolution = { kind: "unresolved", reason: refusal };
            else if (owner && (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression))) {
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
                    relation.resolution = { kind: "source", path, line: target.line, column: target.column, name: target.name, index: target.index, ...provenance("heritage-symbol") };
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
          const refusal = bindingRefusal(node.expression);
          let declaration = refusal ? null : checker.getResolvedSignature(node)?.declaration;
          if (!declaration && !refusal && ts.isNewExpression(node)) { let symbol = checker.getSymbolAtLocation(node.expression); if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol); declaration = symbol?.valueDeclaration; }
          const callable = declaration && (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration) || ts.isConstructorDeclaration(declaration) || ts.isArrowFunction(declaration) || ts.isFunctionExpression(declaration) || ts.isClassDeclaration(declaration));
          if (refusal) {
            const name = node.expression.getText(source), column = location.character;
            const existing = (byLine.get(line) || []).find(call => call.name === name && call.column === column && (!Number.isInteger(call.startIndex) || call.startIndex === start));
            if (existing) existing.resolution = { kind: "unresolved", reason: refusal };
          }
          if (callable) {
            const targetSource = declaration.getSourceFile(), path = norm(targetSource.fileName), other = fileMap.get(path)?.facts;
            if (other) {
              const target = declarationTarget(declaration, targetSource, other);
              if (target) {
                const name = node.expression.getText(source), column = location.character;
                const existing = (byLine.get(line) || []).find(call => call.name === name && call.column === column && (!Number.isInteger(call.startIndex) || call.startIndex === start));
                const call = existing || { name, column, owner: ownerAt(start, end), line, endLine: source.getLineAndCharacterOfPosition(end).line + 1, startIndex: start, endIndex: end };
                call.resolution = { kind: "source", path, line: target.line, column: target.column, nameLine: target.nameLine, nameColumn: target.nameColumn, index: target.index, name: target.name, ...provenance("call-signature-symbol") };
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
