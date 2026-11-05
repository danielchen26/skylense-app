/* Keep acquisition and source indexing away from the rendering thread. */
(function (root) {
  "use strict";
  const modules = ["source-contracts", "analysis-ir", "source-accounting", "graph", "python-structure", "julia-structure", "source-insights", "source-resolver", "project-manifests", "project-swift", "project-native", "project-jvm", "project-julia", "project-python", "project-ruby", "project-php", "project-lua", "semantic-calls", "syntax-facts", "semantic-typescript", "semantic-julia", "syntax-version", "syntax", "model-migrations", "language-adapters", "semantic-project", "semantic-dwave", "claims", "claim-validation", "analysis-runtime", "analysis-capabilities", "hypergraph", "query-index", "view-state", "index-store-browser", "ingest", "ignore", "source-loader"];
  function boot() {
    /**
     * Liveness. This thread holds one exclusive Web Lock for as long as it exists, and the
     * browser releases a lock only when its holder is destroyed. That makes "the analysis
     * thread died" an event the page can observe — terminated from outside, killed for
     * memory, or gone with the renderer — instead of a spinner that never ends. Nothing is
     * polled and nothing is inferred from silence, so a long parse can never be mistaken
     * for a death. Where `navigator.locks` is unavailable the thread says so, and the page
     * records that it cannot detect a death rather than claiming that it can.
     */
    const liveness = self.SKYLENSE_ANALYSIS_LIVENESS;
    let releaseLiveness = null;
    if (liveness && self.navigator && self.navigator.locks)
      self.navigator.locks
        .request(liveness, { mode: "exclusive" }, () => new Promise(release => {
          releaseLiveness = release;
          self.postMessage({ type: "live", holding: true });
        }))
        .catch(error => self.postMessage({ type: "live", holding: false, reason: String((error && error.message) || error) }));
    else self.postMessage({ type: "live", holding: false, reason: "navigator.locks is unavailable in this worker" });
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
      finally { if (releaseLiveness) { const release = releaseLiveness; releaseLiveness = null; release(); } }
    };
  }
  /** A failure the reader can act on: what died, in which phase, after how long. */
  function failure(code, message, detail) {
    return Object.assign(new Error(message), { code, name: "SkylenseAnalysisWorkerError" }, detail);
  }
  function analyze(kind, input, options = {}) {
    if (!root.Worker) return Promise.reject(new Error("This browser does not support background analysis. Use the local Skylense CLI."));
    let source = "";
    for (const name of modules) {
      const script = document.querySelector(`script[data-skylense-module="${name}"]`);
      if (!script) return Promise.reject(new Error(`Missing analysis module: ${name}. Refresh the app.`));
      source += script.src ? `importScripts(${JSON.stringify(script.src)});\n` : script.textContent + "\n";
    }
    const liveness = `skylense-analysis-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    source += `self.SKYLENSE_ANALYSIS_LIVENESS = ${JSON.stringify(liveness)};\n`;
    source += "(" + boot.toString() + ")();";
    const blobURL = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    return new Promise((resolve, reject) => {
      const worker = new Worker(blobURL);
      URL.revokeObjectURL(blobURL);
      const clock = root.performance && root.performance.now ? () => root.performance.now() : () => Date.now();
      const started = clock();
      let settled = false, progress = null, detectable = false;
      const cleanup = () => { worker.terminate(); options.signal?.removeEventListener("abort", abort); };
      // One settlement per job: a death reported after the model arrived, or a late message
      // after a cancel, can never publish a second outcome for the same analysis.
      const once = act => value => { if (settled) return; settled = true; cleanup(); act(value); };
      const deliver = once(resolve), reportFailure = once(reject);
      const abort = () => reportFailure(new DOMException("Analysis cancelled", "AbortError"));
      const phase = () => {
        if (!progress) return "尚未收到进度";
        if (typeof progress === "string") return progress;
        return [progress.phase, progress.path].filter(Boolean).join(" · ") || progress.message || "分析进行中";
      };
      const elapsed = () => Math.round(clock() - started);
      if (options.signal?.aborted) { abort(); return; }
      options.signal?.addEventListener("abort", abort, { once: true });
      worker.onerror = error => reportFailure(failure("WORKER_ERROR",
        `后台分析线程崩溃：${error.message || "浏览器未报告原因"}（${error.filename || "analysis worker"}:${error.lineno || 0}）。在「${phase()}」阶段运行 ${(elapsed() / 1000).toFixed(1)} 秒后中断。当前画布和已有模型未改变。`,
        { lastPhase: phase(), elapsedMs: elapsed() }));
      worker.onmessageerror = () => reportFailure(failure("WORKER_MESSAGE_ERROR",
        `后台分析线程的结果无法传回页面（结构化克隆失败）。在「${phase()}」阶段运行 ${(elapsed() / 1000).toFixed(1)} 秒后中断。当前画布和已有模型未改变。`,
        { lastPhase: phase(), elapsedMs: elapsed() }));
      worker.onmessage = ({ data }) => {
        if (data.type === "live") {
          detectable = Boolean(data.holding) && Boolean(root.navigator && root.navigator.locks);
          if (detectable) watchLiveness();
        }
        else if (data.type === "progress") { progress = data.progress; options.onProgress?.(data.progress); }
        else if (data.type === "model") deliver(data.model);
        else if (data.type === "error") reportFailure(Object.assign(new Error(data.error.message), data.error));
      };
      /** Granted only once the analysis thread's own lock is gone: it finished, or it died. */
      function watchLiveness() {
        root.navigator.locks.request(liveness, { mode: "exclusive" }, () => {})
          .then(() => {
            if (settled) return;
            reportFailure(failure("WORKER_DEATH",
              `后台分析线程已消失：在「${phase()}」阶段运行 ${(elapsed() / 1000).toFixed(1)} 秒后没有返回模型。浏览器只在线程被销毁时释放它持有的锁，所以这是终止或崩溃（例如内存不足），不是变慢。当前画布和已有模型未改变。`,
              { lastPhase: phase(), elapsedMs: elapsed() }));
          })
          .catch(() => { detectable = false; });
      }
      worker.postMessage({ kind, input: kind === "url" ? input : Array.from(input, f => ({ name: f.name, path: f.webkitRelativePath || f.name, size: f.size, blob: f })), options: { ...(options.maxFiles ? { maxFiles: options.maxFiles } : {}), ...(options.sourceCache === false ? { sourceCache: false } : {}), cache: options.cache }, baseURL: new URL("parsers/", document.baseURI).href, assets: root.SKYLENSE_PARSER_ASSETS });
    });
  }
  root.SkylenseAnalysisWorker = { analyze };
})(window);
