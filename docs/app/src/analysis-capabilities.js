/* Honest capability matrix and depth-obligation ledger. Grammar ≠ semantic. */
(function (root) {
  "use strict";

  function adapters() { return root.SkylenseLanguageAdapters; }

  function matrix() {
    return (adapters()?.matrix?.() || []).map(item => ({
      ...item,
      semanticCompleteness: item.semantic?.length ? "project-local-or-engine" : "syntax-only",
      grammarIsNotSemantic: true,
    }));
  }

  /** One row per language present in this snapshot: the itemized capability the
   *  adapter claims, its version, and every feature it does not provide. The
   *  claim travels with the model, so a reader never has to infer capability
   *  from an edge count or a grammar name. */
  function languageRows(model) {
    const declared = model.analysis?.languageCapabilities || {};
    const present = new Set(Object.keys(declared));
    for (const node of model.nodes || []) if (node.language) present.add(node.language);
    return [...present].sort().map(language => {
      const capability = declared[language] || adapters()?.capability?.(language) || null;
      return {
        language,
        adapter: capability?.adapter ?? null,
        version: capability?.version ?? null,
        items: capability?.items ?? null,
        unsupportedFeatures: capability?.unsupportedFeatures ?? [],
        projectContext: capability?.projectContext ?? null,
        engines: capability?.engines ?? [],
      };
    });
  }

  function obligations(model) {
    const files = (model.nodes || []).filter(node => node.sourceRole === "file" || node.kind === "document");
    const modules = (model.nodes || []).filter(node => ["module", "class", "function", "interface"].includes(node.kind));
    const entrypoints = (model.nodes || []).filter(node => /^(main|index|__init__|cli|app)\b/i.test(String(node.path || node.label || "").split("/").pop() || ""));
    return {
      modules: modules.map(node => node.id),
      entrypoints: entrypoints.map(node => node.id),
      publicInterfaces: modules.filter(node => /export|pub |public /i.test(node.summary || "")).map(node => node.id),
      files: files.map(node => node.id),
      leafMinimum: modules.slice(0, 50).map(node => node.id),
      note: "Denominators come from the current snapshot inventory, not from successful claims.",
    };
  }

  function report(model) {
    const analysis = model.analysis || {};
    const registry = adapters();
    return {
      snapshotId: analysis.snapshotId || null,
      matrix: analysis.capabilities || matrix(),
      projectAdapters: analysis.projectAdapters || registry?.detectProject?.(model.nodes) || [],
      languageCapabilities: analysis.languageCapabilities || {},
      // The nine capabilities are answered separately for every language, so a
      // grammar count can never stand in for a resolver.
      capabilityItems: registry?.CAPABILITY_ITEMS || [],
      capabilityStates: registry?.STATES || [],
      resolutionStates: registry?.RESOLUTION_STATES || [],
      languages: languageRows(model),
      registryAudit: registry?.audit?.() || { complete: false, missing: ["language adapter registry is not loaded"] },
      // Browser and local runs answer with the same IR. Enhancements that no
      // profile has are listed as unavailable instead of promised locally.
      execution: registry?.profiles?.() || null,
      obligations: obligations(model),
      readiness: analysis.readiness || { sourceMapReady: false, deepMapReady: false, generalCapabilityAccepted: false },
      note: "Unsupported is not a substitute for a promised recall feature.",
    };
  }

  root.SkylenseAnalysisCapabilities = Object.freeze({ matrix, languageRows, obligations, report });
})(typeof window !== "undefined" ? window : globalThis);
