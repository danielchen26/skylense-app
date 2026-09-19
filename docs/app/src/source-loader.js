/* Shared bounded source acquisition. Browser reads stay local; URL requests use
   the caller's fetch implementation. Node supplies a public-network-only one. */
(function (root) {
  'use strict';
  const MAX_FILE = 256 * 1024, MAX_TOTAL = 10 * 1024 * 1024;
  const encoder = new TextEncoder();
  const check = signal => signal?.throwIfAborted();
  const maxFiles = options => { const n = options.maxFiles ?? 300; if (!Number.isInteger(n) || n < 1 || n > 1000) throw new Error('文件上限须在 1–1000 之间。'); return n; };
  const error = (message, code) => Object.assign(new Error(message), { code });
  function publicURL(value) {
    let url; try { url = new URL(value); } catch { throw error('请输入完整的 HTTP 或 HTTPS 地址。', 'INVALID_URL'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || value.length > 4096) throw error('只支持不含账号密码的 HTTP(S) 地址。', 'INVALID_URL');
    if (url.port && !['80','443'].includes(url.port)) throw error('网页来源仅支持标准 HTTP/HTTPS 端口。', 'INVALID_URL');
    const host = url.hostname.toLowerCase();
    if (/^(localhost|.*\.localhost|.*\.local|127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)/.test(host)) throw error('公开网页读取不访问本机或内网地址。', 'PRIVATE_URL');
    url.hash = ''; return url;
  }
  async function textResponse(response, limit, signal) {
    check(signal);
    if (Number(response.headers?.get('content-length')) > limit) throw error('来源超过读取大小上限。', 'TOO_LARGE');
    if (!response.body?.getReader) { const value = await response.text(); if (encoder.encode(value).length > limit) throw error('来源超过读取大小上限。', 'TOO_LARGE'); return value; }
    const reader = response.body.getReader(), chunks = []; let total = 0;
    try {
      for (;;) { check(signal); const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > limit) throw error('来源超过读取大小上限。', 'TOO_LARGE'); chunks.push(value); }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw error('此来源不是 UTF-8 文本；可作为文件结构查看。', 'BINARY'); }
  }
  function baseReport() { return { warnings: [], skipped: [], scanned: 0, fetched: 0, truncated: false }; }
  function progress(options, detail) { options.onProgress?.(detail); }
  async function analyzeFiles(list, options = {}) {
    const limit = maxFiles(options), report = baseReport(), entries = []; let bytes = 0;
    const files = Array.from(list).sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name));
    const common = files[0]?.webkitRelativePath?.split('/')[0];
    const relativePath = file => { const original = file.webkitRelativePath || file.name; return common && original.startsWith(common + '/') ? original.slice(common.length + 1) : original; };
    const rules = [];
    for (const name of ['.gitignore', '.skylenseignore']) {
      const file = files.find(item => relativePath(item) === name);
      if (!file || file.size > 64 * 1024) continue;
      check(options.signal);
      try { const buffer = await file.arrayBuffer(); check(options.signal); rules.push(...root.SkylenseIgnore.compile(new TextDecoder('utf-8', { fatal: true }).decode(buffer))); }
      catch (cause) { check(options.signal); report.warnings.push(`Could not read ${name}.`); }
    }
    if (rules.length) report.warnings.push('Root .gitignore and .skylenseignore patterns applied; nested ignore files are not interpreted.');
    for (const file of files) {
      check(options.signal); const original = file.webkitRelativePath || file.name;
      const path = common && original.startsWith(common + '/') ? original.slice(common.length + 1) : original;
      report.scanned++;
      if (root.SkylenseIngest.isExcludedPath(path) || root.SkylenseIgnore.matches(rules, path)) { if (report.skipped.length < 100) report.skipped.push({ path, reason: 'excluded' }); continue; }
      if (entries.length >= limit) { report.truncated = true; break; }
      const entry = { path, size: file.size };
      if (file.size > MAX_FILE || bytes + file.size > MAX_TOTAL) { entry.status = 'size-limit'; report.truncated = true; }
      else {
        const kind = root.SkylenseIngest.classifyPath(path);
        if (kind.text || !['image', 'archive', 'binary'].includes(kind.kind)) {
          const buffer = await file.arrayBuffer(); check(options.signal); bytes += buffer.byteLength;
          try { const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); if (text.includes('\0')) entry.status = 'binary'; else { entry.text = text; report.fetched++; } } catch { entry.status = 'binary'; }
        } else entry.status = 'binary';
      }
      entries.push(entry); progress(options, { phase: 'files', completed: entries.length, total: Math.min(files.length, limit), path });
    }
    if (report.truncated) report.warnings.push('已达到文件数量或内容读取上限；地图只包含当前读取范围。');
    check(options.signal);
    return root.SkylenseIngest.build(entries, { title: common || options.title || (files.length === 1 ? files[0].name : 'Selected files'), source: 'browser-files', kind: !common && entries.length === 1 && /\.html?$/i.test(entries[0].path) ? 'webpage' : 'folder', report, maxFiles: limit });
  }
  async function analyzeURL(value, options = {}) {
    const url = publicURL(value), limit = maxFiles(options), report = baseReport();
    const fetcher = options.fetcher || root.fetch.bind(root);
    async function request(target, cap = MAX_FILE) {
      check(options.signal);
      let response;
      try { response = await fetcher(target, { signal: options.signal, credentials: 'omit', redirect: 'follow', headers: { Accept: 'application/json,text/html,text/plain,*/*' }, maxBytes: cap }); }
      catch (cause) { if (options.signal?.aborted) throw cause; throw error('无法读取地址。网站可能限制跨域访问；可使用 skylense open <URL> 在本地读取，或上传已保存的页面。', 'FETCH_FAILED'); }
      if (!response.ok) throw error(response.status === 403 || response.status === 429 ? '来源访问受限或达到速率上限；请稍后重试，或下载到本地后打开文件夹。' : `来源返回 HTTP ${response.status}。`, 'HTTP_ERROR');
      return { response, text: await textResponse(response, cap, options.signal) };
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
      const tree = JSON.parse((await request(`${api}/git/trees/${commit.sha}?recursive=1`, 10 * 1024 * 1024)).text);
      if (!Array.isArray(tree.tree)) throw error('GitHub 未返回文件清单。', 'INVALID_TREE');
      report.truncated = !!tree.truncated;
      const files = [];
      for (const file of tree.tree.filter(f => f.type === 'blob').sort((a,b) => a.path.localeCompare(b.path))) {
        if (prefix && file.path !== prefix && !file.path.startsWith(prefix + '/')) continue;
        report.scanned++;
        if (file.mode === '120000' || root.SkylenseIngest.isExcludedPath(file.path)) { if (report.skipped.length < 100) report.skipped.push({ path: file.path, reason: file.mode === '120000' ? 'symlink' : 'excluded' }); continue; }
        if (files.length < limit) files.push(file); else report.truncated = true;
      }
      const entries = new Array(files.length); let cursor = 0, bytes = 0, finished = 0;
      await Promise.all(Array.from({ length: Math.min(5, files.length) }, async () => {
        while (cursor < files.length) {
          const index = cursor++, file = files[index]; check(options.signal);
          const safePath = file.path.split('/').map(encodeURIComponent).join('/');
          const entry = { path: file.path, size: file.size, url: `https://github.com/${owner}/${repo}/blob/${commit.sha}/${safePath}` };
          const kind = root.SkylenseIngest.classifyPath(file.path);
          if (file.size > MAX_FILE || bytes + file.size > MAX_TOTAL) { entry.status = 'size-limit'; report.truncated = true; }
          else if (!kind.text && ['image','archive','binary'].includes(kind.kind)) entry.status = 'binary';
          else {
            bytes += file.size || MAX_FILE;
            try { entry.text = (await request(`https://raw.githubusercontent.com/${owner}/${repo}/${commit.sha}/${safePath}`)).text; report.fetched++; }
            catch (cause) { if (options.signal?.aborted) throw cause; entry.status = cause.code || 'fetch-failed'; if (report.skipped.length < 100) report.skipped.push({ path: file.path, reason: entry.status }); }
          }
          entries[index] = entry; finished++; progress(options, { phase: 'files', completed: finished, total: files.length, path: file.path });
        }
      }));
      if (report.truncated) report.warnings.push('仓库文件清单或读取范围达到上限；部分文件未纳入分析。');
      if (report.skipped.some(item => /FAILED|ERROR|failed/i.test(item.reason))) report.warnings.push('部分远程文件读取失败，保留文件结构并标记缺失内容。');
      check(options.signal);
      return root.SkylenseIngest.build(entries, { title: `${owner}/${repo}${prefix ? ' / '+prefix : ''}`, source: url.href, url: `https://github.com/${owner}/${repo}`, revision: commit.sha, kind: 'repository', report, maxFiles: limit });
    }
    progress(options, { phase: 'webpage', completed: 0, total: 1, path: url.hostname });
    const { response, text: originalText } = await request(url.href, 2 * 1024 * 1024);
    const rawBytes = encoder.encode(originalText);
    const text = rawBytes.length > MAX_FILE ? new TextDecoder().decode(rawBytes.subarray(0, MAX_FILE)) : originalText;
    if (rawBytes.length > MAX_FILE) { report.truncated = true; report.warnings.push('页面较大，仅分析前 256 KiB 的文本；后续内容未纳入。'); }
    const finalURL = response.url || url.href, mime = response.headers?.get('content-type') || '';
    const html = /html/i.test(mime) || /^\s*<!doctype html|<html[\s>]/i.test(text);
    const pageTitle = html ? /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1]?.replace(/<[^>]+>/g, '').trim() : null;
    const name = decodeURIComponent(new URL(finalURL).pathname.split('/').filter(Boolean).at(-1) || 'index');
    const path = name.replace(/[\\\x00-\x1f]/g, '_') + (html && !/\.html?$/i.test(name) ? '.html' : !name.includes('.') ? '.txt' : '');
    report.scanned = 1; report.fetched = 1;
    report.warnings.push('仅分析返回的页面文本与显式链接；不会登录、运行页面脚本或递归抓取整个网站。');
    check(options.signal);
    return root.SkylenseIngest.build([{ path, text, size: encoder.encode(text).length, url: finalURL }], { title: pageTitle || url.hostname, source: finalURL, url: finalURL, kind: 'webpage', report });
  }
  root.SkylenseSources = Object.freeze({ analyzeFiles, analyzeURL, publicURL, textResponse, limits: { maxFileBytes: MAX_FILE, maxTotalBytes: MAX_TOTAL, maxFiles: 1000 } });
})(typeof window !== 'undefined' ? window : globalThis);
