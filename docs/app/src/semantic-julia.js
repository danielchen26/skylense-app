/* Conservative Julia source-level method candidates. Never performs dispatch or executes code. */
(function (root) {
  "use strict";
  const IDENTIFIER = /^[\p{L}_][\p{L}\p{N}_!?′″]*$/u;
  const QUALIFIED = /^[\p{L}_][\p{L}\p{N}_!?′″]*(?:\.[\p{L}_][\p{L}\p{N}_!?′″]*)+$/u;
  const LIMITATIONS = Object.freeze([
    "Resolved targets are source method candidates; argument types, Julia multiple dispatch and execution order are not evaluated.",
    "Only unambiguous literal include contexts, lexical declarations, explicit module bindings and declared exports are followed.",
    "Computed includes/eval, conditional declarations, shadowed names, ambiguous module contexts and external packages abstain.",
    "Local let/loop/catch/do bindings conservatively restrict their enclosing declaration; this can omit valid candidates.",
  ]);
  function relative(from, target) {
    if (!target || /^(?:\/|[A-Za-z]:|[a-z]+:\/\/)/i.test(target)) return null;
    const parts = from.split("/"); parts.pop();
    for (const part of target.replace(/\\/g, "/").split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") { if (!parts.length) return null; parts.pop(); } else parts.push(part);
    }
    return parts.join("/");
  }
  const unique = list => [...new Set(list)];
  function enrich(entries) {
    const inputs = entries.filter(entry => entry.syntaxFacts?.parser?.language === "julia" && entry.syntaxFacts.julia);
    const files = new Map(inputs.map(entry => [entry.path, entry])), scopes = new Map(), moduleNames = new Map(), modules = new Map(), incoming = new Map(), contextCache = new Map(), groups = new Map();
    const rootKey = path => path + "\0root", scopeKey = (path, owner) => owner === null || owner === undefined ? rootKey(path) : path + "\0" + owner;
    function makeScope(entry, owner) {
      const symbol = owner === null ? null : entry.syntaxFacts.symbols[owner];
      const key = scopeKey(entry.path, owner), scope = { key, entry, owner, symbol, parent: symbol ? scopeKey(entry.path, symbol.parent) : null, bindings: new Set(), dynamic: false, methods: new Map(), imports: [], exports: new Set() };
      scopes.set(key, scope); return scope;
    }
    for (const entry of inputs) {
      makeScope(entry, null);
      for (const symbol of entry.syntaxFacts.symbols) makeScope(entry, symbol.index);
      for (const binding of entry.syntaxFacts.julia.bindings || []) scopes.get(scopeKey(entry.path, binding.owner))?.bindings.add(binding.name);
      for (const owner of entry.syntaxFacts.julia.dynamicScopes || []) { const scope = scopes.get(scopeKey(entry.path, owner)); if (scope) scope.dynamic = true; }
      for (const item of entry.syntaxFacts.julia.exports || []) if (!item.conditional) { const scope = scopes.get(scopeKey(entry.path, item.owner)); if (scope) for (const name of item.names) scope.exports.add(name); }
      for (const fact of entry.syntaxFacts.imports) if (fact.form === "julia-module") scopes.get(scopeKey(entry.path, fact.owner))?.imports.push(fact);
      for (const symbol of entry.syntaxFacts.symbols) {
        if (symbol.kind === "module" && !symbol.conditional && entry.syntaxFacts.status === "analyzed") {
          const parts = [symbol.name]; let parent = entry.syntaxFacts.symbols[symbol.parent], valid = true;
          while (parent) { if (parent.kind !== "module" || parent.conditional) { valid = false; break; } parts.unshift(parent.name); parent = entry.syntaxFacts.symbols[parent.parent]; }
          if (!valid || parts.some(part => !IDENTIFIER.test(part))) continue;
          const key = scopeKey(entry.path, symbol.index), name = parts.join("."); modules.set(key, { key, name, scope: scopes.get(key) });
          const found = moduleNames.get(name) || []; found.push(key); moduleNames.set(name, found);
        }
      }
    }
    function enclosingModuleScope(scope) {
      let current = scope;
      for (let depth = 0; current && depth < 128; depth++) {
        if (current.symbol?.kind === "module") return modules.has(current.key) ? current.key : null;
        if (current.symbol && current.symbol.kind !== "module") return null;
        if (!current.parent) return current.key;
        current = scopes.get(current.parent);
      }
      return null;
    }
    for (const entry of inputs) for (const fact of entry.syntaxFacts.imports) if (fact.form === "julia-include" && !fact.conditional) {
      const target = relative(entry.path, fact.specifier), source = enclosingModuleScope(scopes.get(scopeKey(entry.path, fact.owner)));
      if (!target || !files.has(target) || !source) continue;
      const key = rootKey(target), found = incoming.get(key) || []; found.push(source); incoming.set(key, found);
    }
    function context(key, visiting = new Set()) {
      if (modules.has(key)) return key;
      if (contextCache.has(key)) return contextCache.get(key);
      if (visiting.has(key) || visiting.size > 128) return null;
      visiting.add(key);
      const parents = incoming.get(key), resolved = parents?.length ? unique(parents.map(parent => context(parent, visiting))) : [key];
      visiting.delete(key); const value = resolved.length === 1 && resolved[0] !== null ? resolved[0] : null; contextCache.set(key, value); return value;
    }
    function groupForScope(scope) {
      if (!scope) return null;
      let current = scope;
      for (let depth = 0; current && depth < 128; depth++) {
        if (current.symbol?.kind === "module") return context(current.key);
        if (!current.parent) return context(current.key);
        current = scopes.get(current.parent);
      }
      return null;
    }
    function getGroup(key) {
      if (!key) return null;
      if (!groups.has(key)) groups.set(key, { key, methods: new Map(), bindings: new Set(), imports: [], exports: new Set(), dynamic: false });
      return groups.get(key);
    }
    for (const scope of scopes.values()) {
      // Only module/file scopes merge across includes. Function-local names and
      // declarations retain their exact lexical owner.
      if (scope.symbol && scope.symbol.kind !== "module") continue;
      const group = getGroup(groupForScope(scope)); if (!group) continue;
      for (const name of scope.bindings) group.bindings.add(name);
      for (const name of scope.exports) group.exports.add(name);
      group.dynamic ||= scope.dynamic;
      group.imports.push(...scope.imports.map(fact => ({ fact, scope })));
    }
    const qualifiedDefinitions = [];
    for (const entry of inputs) for (const symbol of entry.syntaxFacts.symbols) if (symbol.kind === "function" && entry.syntaxFacts.status === "analyzed") {
      const parent = scopes.get(scopeKey(entry.path, symbol.parent)); if (!parent) continue;
      const target = { path: entry.path, index: symbol.index, name: symbol.name, qualifiedName: symbol.qualifiedName, line: symbol.line, column: symbol.column || 0, conditional: Boolean(symbol.conditional) };
      if (QUALIFIED.test(symbol.name)) { qualifiedDefinitions.push({ parent, target }); continue; }
      if (!IDENTIFIER.test(symbol.name)) continue;
      const destination = !parent.symbol || parent.symbol.kind === "module" ? getGroup(groupForScope(parent)) : parent;
      if (!destination) continue;
      const found = destination.methods.get(symbol.name) || []; found.push(target); destination.methods.set(symbol.name, found);
    }
    function scopeChain(scope) {
      const result = []; let current = scope;
      for (let depth = 0; current && depth < 128; depth++) {
        if (!current.symbol || current.symbol.kind === "module") { const group = getGroup(groupForScope(current)); if (group) result.push(group); else return []; break; }
        result.push(current); current = scopes.get(current.parent);
      }
      return result;
    }
    function moduleTarget(specifier, sourceScope) {
      let name = specifier;
      if (name.startsWith(".")) {
        const dots = name.match(/^\.+/)[0].length, currentName = modules.get(groupForScope(sourceScope))?.name;
        if (!currentName) return null;
        const parts = currentName.split("."); if (dots - 1 > parts.length) return null;
        parts.length -= dots - 1; name = [...parts, name.slice(dots)].filter(Boolean).join(".");
      }
      const found = moduleNames.get(name) || []; return found.length === 1 ? found[0] : null;
    }
    function availableImports(scope) {
      return scopeChain(scope).flatMap(item => item.imports.map(record => record.fact ? record : { fact: record, scope: item }));
    }
    function moduleBinding(name, scope) {
      const chain = scopeChain(scope); if (!chain.length || chain.some(item => item.dynamic || item.bindings.has(name))) return null;
      const matches = [];
      const own = groupForScope(scope), ownModule = modules.get(own);
      if (ownModule && ownModule.name.split(".").at(-1) === name) matches.push(own);
      for (const { fact, scope: importedAt } of availableImports(scope)) {
        if (fact.conditional || fact.bindings?.length) continue;
        const key = moduleTarget(fact.specifier, importedAt), module = modules.get(key);
        if (module && (fact.moduleAlias || module.name.split(".").at(-1)) === name) matches.push(key);
      }
      const found = unique(matches); return found.length === 1 ? found[0] : null;
    }
    function validTargets(targets) { return targets?.length && !targets.some(target => target.conditional) ? targets : null; }
    function moduleMethods(moduleKey, name) {
      const group = getGroup(moduleKey); if (!group || group.dynamic || group.bindings.has(name)) return null;
      return validTargets(group.methods.get(name));
    }
    function importedMethods(name, scope) {
      const providers = [];
      for (const { fact, scope: importedAt } of availableImports(scope)) {
        if (fact.conditional) continue;
        const selected = fact.bindings?.find(binding => binding.alias === name), moduleKey = moduleTarget(fact.specifier, importedAt);
        if (selected) { if (!moduleKey) return { blocked: true, targets: [] }; providers.push({ key: moduleKey, name: selected.name }); }
        else if (!fact.bindings?.length && fact.mode === "using" && moduleKey && getGroup(moduleKey)?.exports.has(name)) providers.push({ key: moduleKey, name });
      }
      const keys = unique(providers.map(provider => provider.key + "\0" + provider.name));
      if (keys.length !== 1) return { blocked: keys.length > 1, targets: [] };
      const provider = providers[0]; return { blocked: false, targets: moduleMethods(provider.key, provider.name) || [] };
    }
    function resolveBare(name, scope) {
      const chain = scopeChain(scope); if (!chain.length) return [];
      for (const item of chain) {
        if (item.dynamic || item.bindings.has(name)) return [];
        const methods = item.methods.get(name);
        if (methods?.length) {
          const imported = importedMethods(name, scope);
          if (imported.blocked) return [];
          return validTargets(methods) ? [...methods, ...imported.targets] : [];
        }
      }
      const imported = importedMethods(name, scope); return imported.blocked ? [] : imported.targets;
    }
    function resolveQualified(name, scope) {
      const parts = name.split("."), first = parts.shift(), member = parts.pop(); let key = moduleBinding(first, scope);
      if (!key) return [];
      if (parts.length) {
        const full = [modules.get(key)?.name, ...parts].join("."), matches = moduleNames.get(full) || []; if (matches.length !== 1) return []; key = matches[0];
      }
      let targets = [...(moduleMethods(key, member) || [])];
      // Extensions in an unrelated example or test are not automatically in
      // scope. Only the calling file's explicit qualified definitions join.
      for (const definition of qualifiedDefinitions) if (definition.parent.entry.path === scope.entry.path) {
        const targetParts = definition.target.name.split("."), targetName = targetParts.pop(), targetModule = targetParts.join(".");
        if (targetName === member && targetParts.length === 1 && moduleBinding(targetModule, definition.parent) === key) targets.push(definition.target);
      }
      return validTargets(targets) || [];
    }
    // Qualified extensions inside files already included by that same module
    // belong to its source method set. Merely importing a module from a test or
    // example does not add that file's extensions to everybody else's scope.
    for (const definition of qualifiedDefinitions) {
      const parts = definition.target.name.split("."), name = parts.pop();
      if (parts.length !== 1) continue;
      const moduleKey = moduleBinding(parts[0], definition.parent), own = groupForScope(definition.parent);
      if (!moduleKey || moduleKey !== own) continue;
      const group = getGroup(moduleKey), methods = group.methods.get(name) || [];
      methods.push(definition.target); group.methods.set(name, methods);
    }
    let resolvedCalls = 0, candidateTargets = 0, unresolvedCalls = 0;
    for (const entry of inputs) for (const call of entry.syntaxFacts.structure?.calls || []) {
      const scope = scopes.get(scopeKey(entry.path, call.owner));
      // Re-running enrichment must not retain stale results from an earlier
      // collection or revision.
      if (call.resolution?.kind === "source-candidates") { call.resolution = { kind: "unresolved", reason: "Julia binding has not been established for this collection" }; call.evidenceStatus = "syntax-tree"; }
      let targets = [];
      if (scope && entry.syntaxFacts.status === "analyzed") {
        if (call.calleeKind === "identifier" && IDENTIFIER.test(call.name)) targets = resolveBare(call.name, scope);
        else if (call.calleeKind === "field_expression" && QUALIFIED.test(call.name)) targets = resolveQualified(call.name, scope);
      }
      const seen = new Set(); targets = targets.filter(target => { const key = `${target.path}\0${target.index}`; if (seen.has(key)) return false; seen.add(key); return true; });
      if (targets.length) {
        call.resolution = { kind: "source-candidates", targets: targets.map(({ conditional, ...target }) => target), reason: "Static Julia function binding identifies source method candidates; runtime multiple dispatch is not evaluated" };
        call.evidenceStatus = "dispatch-candidate"; resolvedCalls++; candidateTargets += targets.length;
      } else unresolvedCalls++;
    }
    const report = { engine: "julia-source-bindings", resolvedCalls, candidateTargets, unresolvedCalls, limitations: [...LIMITATIONS] };
    for (const entry of inputs) entry.syntaxFacts.semantic = { ...(entry.syntaxFacts.semantic || {}), julia: report };
    return report;
  }
  root.SkylenseJuliaSemantic = Object.freeze({ enrich, limitations: LIMITATIONS });
})(typeof window !== "undefined" ? window : globalThis);
