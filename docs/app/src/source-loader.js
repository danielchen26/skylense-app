/* Shared source acquisition. Browser reads stay local; URL requests use
   the caller's fetch implementation. Node supplies a public-network-only one. */
(function (root) {
  'use strict';
  const MAX_FILE = 256 * 1024, MAX_TOTAL = 10 * 1024 * 1024;
  const encoder = new TextEncoder();
  const check = signal => signal?.throwIfAborted();
  const modeOf = options => { const mode = options.mode || (options.maxFiles === undefined ? 'complete' : 'preview'); if (!['complete', 'preview'].includes(mode)) throw new Error('mode must be complete or preview'); return mode; };
  const maxFiles = options => { const n = options.maxFiles ?? (modeOf(options) === 'complete' ? 100000 : 300); if (!Number.isInteger(n) || n < 1 || n > 100000) throw new Error('文件上限须在 1–100000 之间。'); return n; };
  const resourceFailure = message => { throw error(message + ' 完整索引已停止；请缩小来源范围，或明确选择快速预览。', 'RESOURCE_LIMIT'); };
  /* The cache scope names the selected source so persistent syntax facts are
     grouped by project and can be inspected or cleared per project. A caller
     that already declared one wins; otherwise each transport names its own. */
  async function prepare(entries, options, report) {
    check(options.signal);
    if (root.SkylenseSyntax?.prepare) report.syntax = await root.SkylenseSyntax.prepare(entries, { ...options, mode: modeOf(options) });
    check(options.signal);
  }
  const withScope = (options, scope) => ({ ...options, cacheScope: options.cacheScope || scope });
  const error = (message, code) => Object.assign(new Error(message), { code });
  function publicURL(value) {
    let url; try { url = new URL(value); } catch { throw error('请输入完整的 HTTP 或 HTTPS 地址。', 'INVALID_URL'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || value.length > 4096) throw error('只支持不含账号密码的 HTTP(S) 地址。', 'INVALID_URL');
    if (url.port && !['80','443'].includes(url.port)) throw error('网页来源仅支持标准 HTTP/HTTPS 端口。', 'INVALID_URL');
    const host = url.hostname.toLowerCase();
    if (/^(localhost|.*\.localhost|.*\.local|127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)/.test(host)) throw error('公开网页读取不访问本机或内网地址。', 'PRIVATE_URL');
    url.hash = ''; return url;
  }
  async function readResponse(response, limit, signal) {
    check(signal);
    if (Number(response.headers?.get('content-length')) > limit) throw error('来源超过读取大小上限。', 'TOO_LARGE');
    if (!response.body?.getReader) { const text = await response.text(), bytes = encoder.encode(text); check(signal); if (bytes.length > limit) throw error('来源超过读取大小上限。', 'TOO_LARGE'); return { text, bytes }; }
    const reader = response.body.getReader(), chunks = []; let total = 0;
    try {
      for (;;) { check(signal); const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > limit) throw error('来源超过读取大小上限。', 'TOO_LARGE'); chunks.push(value); }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    check(signal);
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), bytes }; } catch { throw error('此来源不是 UTF-8 文本；可作为文件结构查看。', 'BINARY'); }
  }
  async function textResponse(response, limit, signal) { return (await readResponse(response, limit, signal)).text; }
  // Cache only public GitHub blobs. The fresh tree, not a cached branch name,
  // determines which bytes are valid. These limits bound storage, never analysis.
  const CACHE_FILE = 16 * 1024 * 1024, CACHE_TOTAL = 128 * 1024 * 1024, CACHE_ENTRIES = 4096;
  let database;
  function openCache() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = root.indexedDB.open('skylense-public-github-v1', 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('blobs'); request.result.createObjectStore('entries', { keyPath: 'key' }); };
      request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = null; }; resolve(request.result); };
      request.onerror = () => { database = null; reject(request.error); };
      request.onblocked = () => { database = null; reject(new Error('Source cache is blocked')); };
    });
    return database;
  }
  const browserSourceCache = {
    async get(key) {
      const db = await openCache();
      return new Promise((resolve, reject) => {
        const request = db.transaction('blobs', 'readonly').objectStore('blobs').get(key);
        request.onsuccess = () => resolve(request.result || null); request.onerror = () => reject(request.error);
      });
    },
    async set(key, bytes) {
      if (bytes.byteLength > CACHE_FILE) return;
      const db = await openCache();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(['blobs', 'entries'], 'readwrite'), blobs = tx.objectStore('blobs'), entries = tx.objectStore('entries');
        const request = entries.getAll();
        request.onsuccess = () => {
          const records = request.result.filter(item => item.key !== key).sort((a, b) => a.savedAt - b.savedAt || a.key.localeCompare(b.key));
          let total = records.reduce((sum, item) => sum + item.size, bytes.byteLength), count = records.length + 1;
          for (const item of records) { if (total <= CACHE_TOTAL && count <= CACHE_ENTRIES) break; blobs.delete(item.key); entries.delete(item.key); total -= item.size; count--; }
          blobs.put(bytes, key); entries.put({ key, size: bytes.byteLength, savedAt: Date.now() });
        };
        tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error || new Error('Source cache write failed'));
      });
    },
  };
  async function blobMatches(bytes, descriptor, cap) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > cap || (Number.isFinite(descriptor.size) && descriptor.size !== bytes.byteLength)) return false;
    const header = encoder.encode(`blob ${bytes.byteLength}\0`), input = new Uint8Array(header.length + bytes.byteLength);
    input.set(header); input.set(bytes, header.length);
    const digest = await root.crypto.subtle.digest('SHA-1', input);
    return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('') === descriptor.sha;
  }
  async function cacheOperation(operation, signal) {
    check(signal); let timer, abort;
    try {
      return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Source cache timeout')), 1500);
        abort = () => reject(signal.reason || error('读取已取消。', 'ABORTED'));
        signal?.addEventListener('abort', abort, { once: true });
      })]);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); check(signal); }
  }
  function baseReport(options = {}) {
    return { warnings: [], skipped: [], scanned: 0, fetched: 0, truncated: false,
      accounting: root.SkylenseSourceAccounting.create({ sourceKind: options.sourceKind || 'unknown', mode: options.mode }) };
  }
  function progress(options, detail) { options.onProgress?.(detail); }
  async function analyzeFiles(list, options = {}) {
    const mode = modeOf(options), complete = mode === 'complete', limit = maxFiles(options), fileCap = complete ? 64 * 1024 * 1024 : MAX_FILE, totalCap = complete ? 256 * 1024 * 1024 : MAX_TOTAL, report = baseReport({ sourceKind: 'browser-files', mode }), entries = []; let bytes = 0;
    const ACC = root.SkylenseSourceAccounting, ledger = report.accounting;
    const files = Array.from(list);
    const common = files[0]?.webkitRelativePath?.split('/')[0];
    const relativePath = file => { const original = file.webkitRelativePath || file.name; return common && original.startsWith(common + '/') ? original.slice(common.length + 1) : original; };
    files.sort((a, b) => root.SkylenseIngest.comparePaths(relativePath(a), relativePath(b)));
    const rules = [];
    const ignoreNames = new Set(['.gitignore', '.skylenseignore']);
    for (const file of files) {
      const ignorePath = relativePath(file);
      const name = ignorePath.split('/').pop();
      if (!ignoreNames.has(name)) continue;
      if (file.size > 64 * 1024) { if (complete) resourceFailure('忽略规则超过读取上限。'); ACC.partial(ledger, 'acquisition-partial', `ignore rules unread: ${ignorePath}`); report.warnings.push(`Could not read ${ignorePath}; ignore coverage is incomplete.`); continue; }
      check(options.signal);
      try {
        const buffer = await file.arrayBuffer(); check(options.signal);
        const dir = ignorePath.includes('/') ? ignorePath.slice(0, ignorePath.lastIndexOf('/')) : '';
        rules.push(...root.SkylenseIgnore.compile(new TextDecoder('utf-8', { fatal: true }).decode(buffer), { base: dir, source: ignorePath, report }));
      } catch (cause) { check(options.signal); if (complete) throw cause; ACC.partial(ledger, 'acquisition-partial', `ignore rules unread: ${ignorePath}`); report.warnings.push(`Could not read ${ignorePath}.`); }
    }
    report.ignoreFiles = [...new Set(rules.map(rule => rule.source).filter(Boolean))];
    for (let position = 0; position < files.length; position++) {
      check(options.signal); const file = files[position], original = file.webkitRelativePath || file.name;
      const path = common && original.startsWith(common + '/') ? original.slice(common.length + 1) : original;
      report.scanned++;
      const builtin = root.SkylenseIngest.isExcludedPath(path), detail = builtin ? null : root.SkylenseIgnore.matchDetail(rules, path);
      if (builtin || detail) {
        ACC.record(ledger, path, { ...ACC.reasonFor(builtin ? 'builtin-exclusion' : 'ignore-rule', detail), sourceKind: 'browser-file', bytes: file.size });
        if (report.skipped.length < 100) report.skipped.push({ path, reason: 'excluded', ...(detail || {}) });
        continue;
      }
      if (entries.length >= limit) {
        if (complete) resourceFailure('文件数量超过完整索引的安全上限。');
        // The remaining candidates are known by name, so each gets its own
        // pending state instead of vanishing behind a truncated flag.
        for (let rest = position; rest < files.length; rest++) ACC.record(ledger, relativePath(files[rest]), { reason: 'file-count-limit', sourceKind: 'browser-file', bytes: files[rest].size });
        report.truncated = true; break;
      }
      const entry = { path, size: file.size }, kind = root.SkylenseIngest.classifyPath(path);
      if (!kind.text && ['image', 'archive', 'binary', 'pdf'].includes(kind.kind)) entry.status = 'binary';
      else if (file.size > fileCap || bytes + file.size > totalCap) { if (complete) resourceFailure('来源文本超过完整索引的大小上限。'); entry.status = 'size-limit'; report.truncated = true; }
      else {
        const buffer = await file.arrayBuffer(); check(options.signal);
        if (buffer.byteLength > fileCap || bytes + buffer.byteLength > totalCap) { if (complete) resourceFailure('来源文本超过完整索引的大小上限。'); entry.status = 'size-limit'; report.truncated = true; }
        else { bytes += buffer.byteLength;
          // Hash the selected bytes, never a re-encoding of the decoded text.
          const raw = new Uint8Array(buffer);
          entry.rawHash = root.SkylenseAnalysisIR.sha256Bytes(raw);
          entry.byteLength = raw.byteLength;
          try { const text = new TextDecoder('utf-8', { fatal: true }).decode(raw); if (text.includes('\0')) entry.status = 'binary'; else { entry.text = text; entry.encoding = 'utf-8'; report.fetched++; } } catch { entry.status = 'binary'; }
        }
      }
      entries.push(entry); progress(options, { phase: 'files', completed: entries.length, total: Math.min(files.length, limit), path });
    }
    if (report.truncated) report.warnings.push('已达到文件数量或内容读取上限；地图只包含当前读取范围。');
    check(options.signal);
    await prepare(entries, withScope({ ...options, mode }, `browser-files:${common || options.title || entries[0]?.path || 'selection'}`), report);
    return root.SkylenseIngest.build(entries, { mode, title: common || options.title || (files.length === 1 ? files[0].name : 'Selected files'), source: 'browser-files', kind: !common && entries.length === 1 && /\.html?$/i.test(entries[0].path) ? 'webpage' : 'folder', report, maxFiles: limit });
  }
  async function analyzeURL(value, options = {}) {
    const url = publicURL(value), mode = modeOf(options), complete = mode === 'complete', limit = maxFiles(options), fileCap = complete ? 64 * 1024 * 1024 : MAX_FILE, totalCap = complete ? 256 * 1024 * 1024 : MAX_TOTAL, report = baseReport({ sourceKind: 'remote', mode });
    const ACC = root.SkylenseSourceAccounting, ledger = report.accounting;
    const fetcher = options.fetcher || root.fetch.bind(root);
    async function request(target, cap = fileCap) {
      check(options.signal);
      const controller = new AbortController();
      const timeoutMs = Number.isFinite(options.requestTimeoutMs) ? Math.max(1, Math.min(60000, options.requestTimeoutMs)) : 20000;
      let timer, onAbort;
      const stopped = new Promise((_, reject) => {
        onAbort = () => { controller.abort(options.signal.reason); reject(options.signal.reason || error('读取已取消。', 'ABORTED')); };
        options.signal?.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => { const cause = error('读取来源超时；请重试，或下载仓库后打开本地文件夹。', 'TIMEOUT'); controller.abort(cause); reject(cause); }, timeoutMs);
      });
      try {
        return await Promise.race([stopped, (async () => {
          let response;
          try { response = await fetcher(target, { signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'follow', headers: { Accept: 'application/json,text/html,text/plain,*/*' }, maxBytes: cap }); }
          catch (cause) { if (controller.signal.aborted) throw controller.signal.reason || cause; throw error('无法读取地址。网站可能限制跨域访问；可使用 skylense open <URL> 在本地读取，或上传已保存的页面。', 'FETCH_FAILED'); }
          if (!response.ok) throw error(response.status === 403 || response.status === 429 ? '来源访问受限或达到速率上限；请稍后重试，或下载到本地后打开文件夹。' : `来源返回 HTTP ${response.status}。`, 'HTTP_ERROR');
          return { response, ...await readResponse(response, cap, controller.signal) };
        })()]);
      } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', onAbort); }
    }
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.hostname === 'github.com' && parts.length >= 2 && (parts.length === 2 || ['tree','blob'].includes(parts[2]))) {
      const owner = parts[0], repo = parts[1].replace(/\.git$/, '');
      if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) throw error('GitHub 仓库地址无效。', 'INVALID_URL');
      const api = `https://api.github.com/repos/${owner}/${repo}`;
      progress(options, { phase: 'repository', completed: 0, total: 0, path: `${owner}/${repo}` });
      const metadata = JSON.parse((await request(api, 1024 * 1024)).text);
      let ref = metadata.default_branch, prefix = '', commit;
      if (parts.length > 3) {
        const tail = parts.slice(3).map(decodeURIComponent);
        for (let length = Math.min(tail.length, 6); length > 0; length--) {
          const attempt = tail.slice(0, length).join('/');
          try { commit = JSON.parse((await request(`${api}/commits/${encodeURIComponent(attempt)}`, 2 * 1024 * 1024)).text); ref = attempt; prefix = tail.slice(length).join('/'); break; }
          catch (cause) { if (cause.code !== 'HTTP_ERROR') throw cause; }
        }
        if (!commit) throw error('未找到指定的 GitHub 分支、提交或路径。', 'INVALID_REF');
      }
      if (!commit) commit = JSON.parse((await request(`${api}/commits/${encodeURIComponent(ref)}`, 2 * 1024 * 1024)).text);
      if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw error('GitHub 未返回可验证的源码版本。', 'INVALID_REF');
      Object.assign(ledger, { sourceKind: 'github-repository', revision: commit.sha, ref: String(ref) });
      // A truncated recursive tree is the provider saying "this list is not the
      // repository". Re-acquire it when the host supplies a tree reader; otherwise
      // record the gap so nothing downstream can call this a complete snapshot.
      let treeEntries, treeTruncated;
      if (options.treeReader) {
        const acquired = await options.treeReader(api, commit.sha, { fetcher: options.fetcher, signal: options.signal, accounting: ledger, mode, maxBytes: 10 * 1024 * 1024 });
        treeEntries = acquired.entries; treeTruncated = !acquired.complete;
      } else {
        const tree = JSON.parse((await request(`${api}/git/trees/${commit.sha}?recursive=1`, 10 * 1024 * 1024)).text);
        if (!Array.isArray(tree.tree)) throw error('GitHub 未返回文件清单。', 'INVALID_TREE');
        treeEntries = tree.tree; treeTruncated = !!tree.truncated;
        if (treeTruncated) ACC.unenumerated(ledger, 'tree-truncated', { detail: 'the provider returned a truncated recursive tree and no tree reader was available to re-acquire it' });
      }
      if (treeTruncated && complete) resourceFailure('GitHub 未返回完整文件树。');
      report.truncated = treeTruncated;
      for (const item of treeEntries) if (item.type === 'commit' && item.path) ACC.record(ledger, item.path, { reason: 'git-submodule-unfetched', sourceKind: 'git-submodule', detail: String(item.sha || '').slice(0, 40) });
      let sourceCache = options.cache === false || options.sourceCache === false || metadata.private !== false || !root.crypto?.subtle ? null : options.sourceCache || (root.indexedDB ? browserSourceCache : null), cacheWrites = true;
      const cacheReport = report.sourceCache = { kind: 'verified-public-git-blobs', enabled: !!sourceCache, hits: 0, misses: 0, invalid: 0, stored: 0, downloaded: 0, errors: 0, unverified: 0 };
      async function readBlob(file, cap = fileCap) {
        const key = /^[a-f0-9]{40}$/.test(file.sha || '') && file.size <= CACHE_FILE ? file.sha : null;
        if (sourceCache && key) {
          try {
            const bytes = await cacheOperation(() => sourceCache.get(key), options.signal);
            if (bytes && await blobMatches(bytes, file, cap)) { check(options.signal); const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); cacheReport.hits++; return text; }
            if (bytes) cacheReport.invalid++;
            cacheReport.misses++;
          } catch { check(options.signal); cacheReport.errors++; sourceCache = null; }
        }
        check(options.signal);
        const safePath = file.path.split('/').map(encodeURIComponent).join('/');
        const result = await request(`https://raw.githubusercontent.com/${owner}/${repo}/${commit.sha}/${safePath}`, cap);
        cacheReport.downloaded++;
        if (sourceCache && key && cacheWrites) {
          try {
            if (await blobMatches(result.bytes, file, cap)) { check(options.signal); await cacheOperation(() => sourceCache.set(key, result.bytes), options.signal); cacheReport.stored++; }
            else cacheReport.unverified++;
          } catch { check(options.signal); cacheReport.errors++; cacheWrites = false; }
        }
        check(options.signal); return result.text;
      }
      const rules = [], prefetched = new Map();
      const ignoreBlobs = treeEntries.filter(file => file.type === 'blob' && file.mode !== '120000' && /(?:^|\/)\.(?:gitignore|skylenseignore)$/.test(file.path));
      for (const descriptor of ignoreBlobs) {
        if (descriptor.size > 64 * 1024) { if (complete) resourceFailure('忽略规则超过读取上限。'); ACC.partial(ledger, 'acquisition-partial', `ignore rules unread: ${descriptor.path}`); report.warnings.push(`Could not read ${descriptor.path}; ignore coverage is incomplete.`); continue; }
        try {
          const text = await readBlob(descriptor, 64 * 1024);
          prefetched.set(descriptor.path, text);
          const dir = descriptor.path.includes('/') ? descriptor.path.slice(0, descriptor.path.lastIndexOf('/')) : '';
          rules.push(...root.SkylenseIgnore.compile(text, { base: dir, source: descriptor.path, report }));
        } catch (cause) { check(options.signal); if (complete) throw cause; ACC.partial(ledger, 'acquisition-partial', `ignore rules unread: ${descriptor.path}`); report.warnings.push(`Could not read ${descriptor.path}; ignore coverage is incomplete.`); }
      }
      report.ignoreFiles = [...new Set(rules.map(rule => rule.source).filter(Boolean))];
      const files = [];
      for (const file of treeEntries.filter(f => f.type === 'blob').sort(root.SkylenseIngest.comparePaths)) {
        if (prefix && file.path !== prefix && !file.path.startsWith(prefix + '/')) { ACC.record(ledger, file.path, { reason: 'outside-selected-subpath', sourceKind: 'remote-blob', bytes: file.size }); continue; }
        report.scanned++;
        // A 120000 blob's target is its content, which is never fetched, so the
        // link is refused outright rather than resolved.
        if (file.mode === '120000') { ACC.record(ledger, file.path, { reason: 'symlink-not-followed', sourceKind: 'git-symlink', bytes: file.size }); if (report.skipped.length < 100) report.skipped.push({ path: file.path, reason: 'symlink' }); continue; }
        const builtin = root.SkylenseIngest.isExcludedPath(file.path), detail = builtin ? null : root.SkylenseIgnore.matchDetail(rules, file.path);
        if (builtin || detail) { ACC.record(ledger, file.path, { ...ACC.reasonFor(builtin ? 'builtin-exclusion' : 'ignore-rule', detail), sourceKind: 'remote-blob', bytes: file.size }); if (report.skipped.length < 100) report.skipped.push({ path: file.path, reason: 'excluded', ...(detail || {}) }); continue; }
        if (files.length < limit) files.push(file);
        else { if (complete) resourceFailure('文件数量超过完整索引的安全上限。'); ACC.record(ledger, file.path, { reason: 'file-count-limit', sourceKind: 'remote-blob', bytes: file.size }); report.truncated = true; }
      }
      const entries = new Array(files.length); let cursor = 0, bytes = 0, finished = 0;
      await Promise.all(Array.from({ length: Math.min(5, files.length) }, async () => {
        while (cursor < files.length) {
          const index = cursor++, file = files[index]; check(options.signal);
          const safePath = file.path.split('/').map(encodeURIComponent).join('/');
          const entry = { path: file.path, size: file.size, url: `https://github.com/${owner}/${repo}/blob/${commit.sha}/${safePath}` };
          const kind = root.SkylenseIngest.classifyPath(file.path);
          if (!kind.text && ['image','archive','binary','pdf'].includes(kind.kind)) entry.status = 'binary';
          else if (file.size > fileCap || bytes + file.size > totalCap) { if (complete) resourceFailure('来源文本超过完整索引的大小上限。'); entry.status = 'size-limit'; report.truncated = true; }
          else {
            bytes += Number.isFinite(file.size) ? file.size : fileCap;
            try { entry.text = prefetched.has(file.path) ? prefetched.get(file.path) : await readBlob(file); report.fetched++; }
            catch (cause) {
              if (options.signal?.aborted || complete) throw cause;
              entry.status = cause.code || 'fetch-failed';
              ACC.record(ledger, file.path, { ...ACC.reasonFor(cause.code || 'fetch-failed'), sourceKind: 'remote-blob', bytes: file.size, detail: String(cause.message || '').slice(0, 200) });
              if (report.skipped.length < 100) report.skipped.push({ path: file.path, reason: entry.status });
            }
          }
          entries[index] = entry; finished++; progress(options, { phase: 'files', completed: finished, total: files.length, path: file.path });
        }
      }));
      if (report.truncated) report.warnings.push('仓库文件清单或读取范围达到上限；部分文件未纳入分析。');
      if (report.skipped.some(item => /FAILED|ERROR|failed/i.test(item.reason))) report.warnings.push('部分远程文件读取失败，保留文件结构并标记缺失内容。');
      check(options.signal);
      await prepare(entries, withScope({ ...options, mode }, `github:${owner}/${repo}${prefix ? '/' + prefix : ''}`), report);
      return root.SkylenseIngest.build(entries, { mode, title: `${owner}/${repo}${prefix ? ' / '+prefix : ''}`, source: url.href, url: `https://github.com/${owner}/${repo}`, revision: commit.sha, kind: 'repository', report, maxFiles: limit });
    }
    progress(options, { phase: 'webpage', completed: 0, total: 1, path: url.hostname });
    const { response, text: originalText } = await request(url.href, complete ? fileCap : 2 * 1024 * 1024);
    const rawBytes = encoder.encode(originalText);
    const text = !complete && rawBytes.length > MAX_FILE ? new TextDecoder().decode(rawBytes.subarray(0, MAX_FILE)) : originalText;
    if (!complete && rawBytes.length > MAX_FILE) { ACC.partial(ledger, 'size-limit', 'page text clipped to the preview budget'); report.truncated = true; report.warnings.push('页面较大，仅分析前 256 KiB 的文本；后续内容未纳入。'); }
    const finalURL = response.url || url.href, mime = response.headers?.get('content-type') || '';
    const html = /html/i.test(mime) || /^\s*<!doctype html|<html[\s>]/i.test(text);
    const pageTitle = html ? /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1]?.replace(/<[^>]+>/g, '').trim() : null;
    const name = decodeURIComponent(new URL(finalURL).pathname.split('/').filter(Boolean).at(-1) || 'index');
    const path = name.replace(/[\\\x00-\x1f]/g, '_') + (html && !/\.html?$/i.test(name) ? '.html' : !name.includes('.') ? '.txt' : '');
    report.scanned = 1; report.fetched = 1;
    Object.assign(ledger, { sourceKind: 'webpage', revision: null });
    ACC.record(ledger, path, { reason: 'analyzed', sourceKind: 'remote-page', bytes: encoder.encode(text).length });
    report.warnings.push('仅分析返回的页面文本与显式链接；不会登录、运行页面脚本或递归抓取整个网站。');
    check(options.signal);
    const entries = [{ path, text, size: encoder.encode(text).length, url: finalURL }];
    await prepare(entries, withScope({ ...options, mode }, `url:${new URL(finalURL).origin}${new URL(finalURL).pathname}`), report);
    return root.SkylenseIngest.build(entries, { mode, title: pageTitle || url.hostname, source: finalURL, url: finalURL, kind: 'webpage', report });
  }
  root.SkylenseSources = Object.freeze({ analyzeFiles, analyzeURL, publicURL, textResponse, modeOf, prepare, limits: { maxFileBytes: 64 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024, maxFiles: 100000, previewMaxFileBytes: MAX_FILE, previewMaxTotalBytes: MAX_TOTAL, previewMaxFiles: 300 } });
})(typeof window !== 'undefined' ? window : globalThis);
