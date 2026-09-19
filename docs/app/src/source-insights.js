/* Source-backed reading guides shared by browser, CLI and MCP. Never infer execution. */
(function (root) {
  "use strict";
  const supported = new Set(["python", "javascript", "typescript", "julia", "markdown", "html"]);
  function enrich(model) {
    const report = model.meta?.ingestion;
    if (!report) return model;
    const nodes = new Map(model.nodes.map(n => [n.id, n]));
    const files = model.nodes.filter(n => n.sourceRole === "file");
    const byPath = new Map(files.map(n => [n.path, n]));
    const adjacent = new Map(), incident = new Map(), connectedFiles = new Set();
    for (const edge of model.edges) {
      if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
      for (const id of [edge.source, edge.target]) {
        if (!incident.has(id)) incident.set(id, []);
        incident.get(id).push(edge);
        const path = nodes.get(id).path;
        if (byPath.has(path)) connectedFiles.add(path);
      }
      if (!adjacent.has(edge.source)) adjacent.set(edge.source, []);
      adjacent.get(edge.source).push(edge);
    }
    const unresolved = new Map();
    for (const item of report.unresolved || []) unresolved.set(item.file, (unresolved.get(item.file) || 0) + 1);
    const languages = new Map();
    for (const n of files) {
      const language = n.language || n.fileKind || "unknown";
      if (!languages.has(language)) languages.set(language, { language, files: 0, parsedFiles: 0, symbols: 0, connectedFiles: 0, unresolved: 0 });
      const row = languages.get(language); row.files++;
      const text = n.evidenceStatus === "source-text";
      if (text && (n.analysis?.parser?.engine === "tree-sitter" || supported.has(language))) row.parsedFiles++;
      row.symbols += n.functions?.length || 0;
      row.connectedFiles += Number(connectedFiles.has(n.path));
      row.unresolved += unresolved.get(n.path) || 0;
      n.analysis = {
        ...n.analysis,
        status: n.analysis?.status || (!text ? "metadata-only" : supported.has(language) ? "static-source" : "preview-only"),
        language, symbols: n.functions?.length || 0,
        directRelationships: incident.get(n.id)?.length || 0,
        unresolved: unresolved.get(n.path) || 0,
      };
    }
    report.languages = [...languages.values()].sort((a, b) => b.files - a.files || a.language.localeCompare(b.language));
    report.connectedFiles = connectedFiles.size;
    report.unconnectedFiles = files.length - connectedFiles.size;
    report.relationshipTypes = Object.fromEntries([...new Set(model.edges.map(e => e.type))].sort().map(type => [type, model.edges.filter(e => e.type === type).length]));

    // A guide is a bounded dependency neighborhood, not a topological ordering or a
    // promised directed path. Explicit edge IDs preserve branching, direction and evidence.
    const used = new Set(), flows = [];
    const seeds = [...adjacent.keys()].sort((a, b) => {
      const weight = id => (adjacent.get(id) || []).reduce((sum, e) => sum + (e.type === "links" ? 1 : 4), 0);
      return weight(b) - weight(a) || (nodes.get(a).path || a).localeCompare(nodes.get(b).path || b) || a.localeCompare(b);
    });
    for (const seed of seeds) {
      if (flows.length >= 12) break;
      if (!(adjacent.get(seed) || []).some(e => !used.has(e.id))) continue;
      const visited = new Set([seed]), queue = [seed];
      for (let at = 0; at < queue.length && visited.size < 16; at++) {
        for (const e of adjacent.get(queue[at]) || []) {
          if (visited.size >= 16) break;
          if (!visited.has(e.target)) { visited.add(e.target); queue.push(e.target); }
        }
      }
      const edges = model.edges.filter(e => visited.has(e.source) && visited.has(e.target));
      if (!edges.length) continue;
      edges.forEach(e => used.add(e.id));
      const n = nodes.get(seed);
      flows.push({ id: "source_guide_" + seed, label: (n.qualifiedName || n.path || n.label) + " · dependencies", kind: "dependency-neighborhood", nodes: [...visited], edgeIds: edges.map(e => e.id), description: "Source-backed static dependency neighborhood. Reading order is for navigation only, not an execution trace. Every displayed relationship retains its original direction and source evidence.", evidenceStatus: "lexical-candidate" });
    }
    model.flows = flows;
    report.readingGuides = flows.length;
    report.guideEdgeCoverage = { included: used.size, total: model.edges.length, limit: 12, maxNodesPerGuide: 16 };
    report.capabilities.readingGuides = "Bounded static dependency neighborhoods, including branches; never inferred execution order. All original relationships remain available through hierarchy, upstream/downstream and path search.";
    return model;
  }
  root.SkylenseSourceInsights = { enrich };
})(typeof window !== "undefined" ? window : globalThis);
