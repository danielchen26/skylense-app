/* Source-backed reading guides shared by browser, CLI and MCP. Never infer execution. */
(function (root) {
  "use strict";
  const supported = new Set(["python", "javascript", "typescript", "julia", "markdown", "html"]);
  const categoryOrder = ["source", "examples", "tests", "docs", "tooling", "other"];
  const basename = path => String(path || "").split("/").pop();
  const dirname = path => String(path || "").split("/").slice(0, -1).join("/");
  function categoryFor(node, file) {
    const path = String(node.path || "").toLowerCase(), name = basename(path);
    // These are navigational groupings of explicit paths, not inferred responsibilities.
    if (/(^|\/)(test|tests|__tests__|spec|specs|fixtures)(\/|$)/.test(path) || /(^tests?[_\.-]|^runtests\.|[_-]test\.|\.(test|spec)\.)/.test(name)) return "tests";
    if (/(^|\/)(example|examples|demo|demos|samples|tutorials)(\/|$)/.test(path)) return "examples";
    if (/(^|\/)(docs?|documentation)(\/|$)/.test(path) || file?.fileKind === "document" || /\.(md|mdx|rst|adoc)$/.test(name)) return "docs";
    if (/(^|\/)(scripts?|tools?|bin|\.github|\.claude|\.vscode)(\/|$)/.test(path)) return "tooling";
    if (file?.fileKind === "source" || node.sourceRole === "symbol" || /(^|\/)(src|lib|app|apps|packages|crates|include)(\/|$)/.test(path)) return "source";
    return "other";
  }
  function entryPriority(node, category, outgoing) {
    if (category !== "source" || node.sourceRole !== "file") return 0;
    const path = String(node.path || ""), name = basename(path);
    if (!outgoing.some(e => e.type === "imports")) return 0;
    if (/^(index|main|mod|lib|__init__)\.[^.]+$/i.test(name)) return 2;
    return /^(src|lib|app)\/[^/]+$/.test(path) ? 2 : 1;
  }
  function guideIntent(counts) {
    const types = Object.keys(counts);
    if (types.every(type => type === "imports")) return "imports";
    if (types.every(type => ["calls", "call-candidate", "constructs"].includes(type))) return "calls";
    if (types.every(type => type === "links")) return "links";
    return "relationships";
  }
  function compactContexts(flows) {
    const parts = flows.map(guide => (guide.anchorRole === "file" ? dirname(guide.sourcePath) : guide.sourcePath).split("/").filter(Boolean));
    for (let i = 0; i < flows.length; i++) {
      let depth = Math.min(2, parts[i].length);
      // Expand only ambiguous suffixes. Full paths remain available separately.
      while (depth < parts[i].length && flows.some((other, at) => at !== i && other.title === flows[i].title && parts[at].slice(-depth).join("/") === parts[i].slice(-depth).join("/"))) depth++;
      flows[i].contextPath = (depth < parts[i].length ? "…/" : "") + (parts[i].slice(-depth).join("/") || ".") + (flows[i].anchorLine ? ":" + flows[i].anchorLine : "");
    }
    const duplicates = new Map();
    for (const guide of flows) {
      const key = guide.title + "\0" + guide.contextPath;
      if (!duplicates.has(key)) duplicates.set(key, []);
      duplicates.get(key).push(guide);
    }
    // Same-name declarations can even share a source line. Use their existing
    // identities rather than inventing a column or a declaration order.
    for (const group of duplicates.values()) if (group.length > 1) for (const guide of group) guide.contextPath += " · " + guide.anchorId;
  }
  function enrich(model) {
    const report = model.meta?.ingestion;
    if (!report) return model;
    const nodes = new Map(model.nodes.map(n => [n.id, n]));
    const containers = new Map((model.hierarchy || []).map(n => [n.id, n]));
    const files = model.nodes.filter(n => n.sourceRole === "file");
    const byPath = new Map(files.map(n => [n.path, n]));
    const adjacent = new Map(), incident = new Map(), connectedFiles = new Set(), weights = new Map(), relationCounts = new Map();
    for (const edge of model.edges) {
      relationCounts.set(edge.type, (relationCounts.get(edge.type) || 0) + 1);
      if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
      for (const id of [edge.source, edge.target]) {
        incident.set(id, (incident.get(id) || 0) + 1);
        const path = nodes.get(id).path;
        if (byPath.has(path)) connectedFiles.add(path);
      }
      if (!adjacent.has(edge.source)) adjacent.set(edge.source, []);
      adjacent.get(edge.source).push(edge);
      weights.set(edge.source, (weights.get(edge.source) || 0) + (edge.type === "links" ? 1 : 4));
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
        directRelationships: incident.get(n.id) || 0,
        unresolved: unresolved.get(n.path) || 0,
      };
    }
    report.languages = [...languages.values()].sort((a, b) => b.files - a.files || a.language.localeCompare(b.language));
    report.connectedFiles = connectedFiles.size;
    report.unconnectedFiles = files.length - connectedFiles.size;
    report.relationshipTypes = Object.fromEntries([...relationCounts.keys()].sort().map(type => [type, relationCounts.get(type)]));

    // A guide is a bounded dependency neighborhood, not a topological ordering or a
    // promised directed path. Explicit edge IDs preserve branching, direction and evidence.
    const used = new Set(), flows = [], chosen = new Set(), usedPaths = new Set(), usedModules = new Set();
    const candidates = [...adjacent.keys()].map(id => {
      const node = nodes.get(id), category = categoryFor(node, byPath.get(node.path));
      return { id, node, category, module: category + ":" + dirname(node.path).split("/").slice(0, 2).join("/"), priority: entryPriority(node, category, adjacent.get(id)) };
    }).sort((a, b) => categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category) || b.priority - a.priority || weights.get(b.id) - weights.get(a.id) || (a.node.path || a.id).localeCompare(b.node.path || b.id) || a.id.localeCompare(b.id));
    function addGuide(candidate) {
      const seed = candidate.id;
      if (flows.length >= 12 || chosen.has(seed) || !(adjacent.get(seed) || []).some(e => !used.has(e.id))) return false;
      const visited = new Set([seed]), queue = [seed];
      for (let at = 0; at < queue.length && visited.size < 16; at++) {
        const outgoing = adjacent.get(queue[at]) || [];
        // Prefer uncovered edges before the neighborhood fills up. Otherwise a
        // high-degree seed can produce a redundant guide containing only edges
        // already displayed, with its new edges just beyond the 16-node boundary.
        for (const covered of [false, true]) for (const e of outgoing) {
          if (visited.size >= 16) break;
          if (used.has(e.id) === covered && !visited.has(e.target)) { visited.add(e.target); queue.push(e.target); }
        }
      }
      const edges = model.edges.filter(e => visited.has(e.source) && visited.has(e.target));
      if (!edges.length) return false;
      edges.forEach(e => used.add(e.id));
      const n = nodes.get(seed);
      const relationshipCounts = {};
      for (const e of edges) relationshipCounts[e.type] = (relationshipCounts[e.type] || 0) + 1;
      const intent = guideIntent(relationshipCounts), title = n.sourceRole === "file" ? basename(n.path) || n.label : n.qualifiedName || n.label || basename(n.path);
      const intentLabel = { imports: "Module dependencies", calls: "Callable relationships", links: "Linked resources", relationships: "Related source" }[intent];
      flows.push({ id: "source_guide_" + seed, label: title + " · " + intentLabel, title, intent, category: candidate.category, anchorId: seed, anchorRole: n.sourceRole || "component", anchorLine: n.sourceRole === "symbol" ? n.sourceSpan?.lineStart || n.evidence?.[0]?.lineStart || null : null, containerId: containers.has(n.parentId) ? n.parentId : null, sourcePath: n.path || "", nodeCount: visited.size, edgeCount: edges.length, relationshipCounts, summary: visited.size + " source objects · " + edges.length + " static relationships", kind: "dependency-neighborhood", nodes: [...visited], edgeIds: edges.map(e => e.id), description: "Source-backed static dependency neighborhood. Reading order is for navigation only, not an execution trace. Every displayed relationship retains its original direction and source evidence.", evidenceStatus: "lexical-candidate" });
      chosen.add(seed); usedPaths.add(n.path || seed); usedModules.add(candidate.module);
      return true;
    }
    // Give source modules the first positions, rather than letting a large test file's
    // degree dominate. Reserve one slot per other available category, then fill by
    // module and file diversity. This chooses guides only; the graph is never pruned.
    const otherCategories = categoryOrder.slice(1).filter(category => candidates.some(c => c.category === category));
    const sourceTarget = Math.min(8, 12 - otherCategories.length);
    for (const candidate of candidates) if (candidate.category === "source" && flows.length < sourceTarget && !usedModules.has(candidate.module)) addGuide(candidate);
    for (const category of otherCategories) {
      for (const candidate of candidates) if (candidate.category === category && addGuide(candidate)) break;
    }
    for (const candidate of candidates) if (!usedModules.has(candidate.module)) addGuide(candidate);
    for (const candidate of candidates) if (!usedPaths.has(candidate.node.path || candidate.id)) addGuide(candidate);
    for (const candidate of candidates) addGuide(candidate);
    flows.sort((a, b) => categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category));
    compactContexts(flows);
    model.flows = flows;
    report.readingGuides = flows.length;
    report.guideEdgeCoverage = { included: used.size, total: model.edges.length, limit: 12, maxNodesPerGuide: 16 };
    report.capabilities.readingGuides = "Bounded static dependency neighborhoods, including branches; never inferred execution order. All original relationships remain available through hierarchy, upstream/downstream and path search.";
    return model;
  }
  root.SkylenseSourceInsights = { enrich };
})(typeof window !== "undefined" ? window : globalThis);
