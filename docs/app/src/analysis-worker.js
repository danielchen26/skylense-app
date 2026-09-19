/* Keep acquisition and source indexing away from the rendering thread. */
(function (root) {
  "use strict";
  const modules = ["graph", "python-structure", "julia-structure", "source-insights", "source-resolver", "syntax-facts", "semantic-typescript", "semantic-julia", "syntax-version", "syntax", "ingest", "ignore", "source-loader"];
  function boot() {
    self.onmessage = async event => {
      const { kind, input, options, baseURL, assets } = event.data;
      if (assets) self.SKYLENSE_PARSER_ASSETS = assets;
      self.SkylenseSyntax.configure({ baseURL });
      try {
        const onProgress = progress => self.postMessage({ type: "progress", progress });
        const files = kind === "url" ? null : input.map(f => ({ name: f.name, webkitRelativePath: f.path, size: f.size, arrayBuffer: () => f.blob.arrayBuffer() }));
        const model = kind === "url" ? await self.SkylenseSources.analyzeURL(input, { ...options, onProgress }) : await self.SkylenseSources.analyzeFiles(files, { ...options, onProgress });
        self.postMessage({ type: "model", model });
      } catch (error) { self.postMessage({ type: "error", error: { message: error.message, code: error.code, name: error.name } }); }
    };
  }
  function analyze(kind, input, options = {}) {
    if (!root.Worker) return Promise.reject(new Error("This browser does not support background analysis. Use the local Skylense CLI."));
    let source = "";
    for (const name of modules) {
      const script = document.querySelector(`script[data-skylense-module="${name}"]`);
      if (!script) return Promise.reject(new Error(`Missing analysis module: ${name}. Refresh the app.`));
      source += script.src ? `importScripts(${JSON.stringify(script.src)});\n` : script.textContent + "\n";
    }
    source += "(" + boot.toString() + ")();";
    const blobURL = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    return new Promise((resolve, reject) => {
      const worker = new Worker(blobURL);
      URL.revokeObjectURL(blobURL);
      const cleanup = () => { worker.terminate(); options.signal?.removeEventListener("abort", abort); };
      const abort = () => { cleanup(); reject(new DOMException("Analysis cancelled", "AbortError")); };
      if (options.signal?.aborted) { abort(); return; }
      options.signal?.addEventListener("abort", abort, { once: true });
      worker.onerror = error => { cleanup(); reject(new Error(error.message || "Background analysis failed.")); };
      worker.onmessage = ({ data }) => {
        if (data.type === "progress") options.onProgress?.(data.progress);
        else if (data.type === "model") { cleanup(); resolve(data.model); }
        else if (data.type === "error") { cleanup(); reject(Object.assign(new Error(data.error.message), data.error)); }
      };
      worker.postMessage({ kind, input: kind === "url" ? input : Array.from(input, f => ({ name: f.name, path: f.webkitRelativePath || f.name, size: f.size, blob: f })), options: { ...(options.maxFiles ? { maxFiles: options.maxFiles } : {}), cache: options.cache }, baseURL: new URL("parsers/", document.baseURI).href, assets: root.SKYLENSE_PARSER_ASSETS });
    });
  }
  root.SkylenseAnalysisWorker = { analyze };
})(window);
