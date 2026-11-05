/* Animated export of a flow or scenario walkthrough (GIF, WebM/MP4).
 *
 * The workbench describes the walkthrough once as a plain "board": the scene geometry it lays
 * out, and for every step the camera, the focus roles and the caption the reader sees. Frames
 * are drawn from that board onto a canvas with the 2D API — the same geometry, inks and focus
 * opacities the live canvas uses, the wire paths' own SVG path data, and the motion module's
 * marker travel — never by reading the DOM. Time is fixed: every step lasts STEP_SECONDS, the
 * camera eases for TRANSITION_SECONDS at its start, and a format renders at a fixed fps. */
(function (root) {
  "use strict";

  const STEP_SECONDS = 2.5;
  const TRANSITION_SECONDS = 0.6;
  const GIF_FPS = 10;
  const VIDEO_FPS = 30;
  const WIDTH = 880;
  const HEIGHT = 560;
  const CAPTION_HEIGHT = 180;
  const HEADER_HEIGHT = 34;
  /* The focus opacities of style.css (.focus-muted / .focus-related). */
  const OPACITY = Object.freeze({
    item: { normal: 1, selected: 1, related: 1, muted: 0.25 },
    bound: { normal: 1, selected: 1, related: 1, muted: 0.3 },
    wire: { normal: 1, selected: 1, related: 1, muted: 0.12 },
    hub: { normal: 1, selected: 1, related: 0.86, muted: 0.26 },
  });
  /* The marker colours of style.css: unproven, narrative and the interpretation grades. */
  const TONES = Object.freeze({
    light: { unproven: "#b4532a", candidate: "#b4532a", narrative: "#4f6d8f", verified: "#2f7d6b", "partly-verified": "#b07a12", unverified: "#8a6fb8", ungraded: "#7a5bc4" },
    dark: { unproven: "#e0875f", candidate: "#e0875f", narrative: "#9fb7d4", verified: "#6fd1b5", "partly-verified": "#e6b450", unverified: "#b9a2f0", ungraded: "#b9a2f0" },
  });

  const clamp01 = (value) => Math.max(0, Math.min(1, value));
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  /** Frames of a board at `fps`: a fixed number per step. */
  function timing(board, fps) {
    if (!board?.steps?.length) throw new TypeError("A walkthrough needs at least one step.");
    if (!Number.isFinite(fps) || fps <= 0) throw new TypeError("fps must be positive.");
    const stepFrames = Math.max(1, Math.round(STEP_SECONDS * fps));
    const transitionFrames = Math.min(stepFrames - 1, Math.round(TRANSITION_SECONDS * fps));
    return { fps, stepFrames, transitionFrames, frameCount: stepFrames * board.steps.length, durationSeconds: (stepFrames * board.steps.length) / fps };
  }

  /** What frame `frame` shows: its step, the eased camera and the marker clock. */
  function frameState(board, fps, frame) {
    const t = timing(board, fps);
    const index = Math.min(board.steps.length - 1, Math.floor(frame / t.stepFrames));
    const local = frame - index * t.stepFrames;
    const step = board.steps[index];
    let camera = step.camera;
    if (index > 0 && local < t.transitionFrames) {
      const from = board.steps[index - 1].camera, k = ease(clamp01((local + 1) / (t.transitionFrames + 1)));
      camera = { x: from.x + (camera.x - from.x) * k, y: from.y + (camera.y - from.y) * k, z: from.z + (camera.z - from.z) * k };
    }
    return { index, step, camera, elapsedMs: (frame / fps) * 1000 };
  }

  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }
  /** Mix `a` toward `b` by `amount` (0–1), both #rrggbb. */
  function mix(a, b, amount) {
    const pa = hex(a), pb = hex(b);
    if (!pa || !pb) return a;
    const channel = (i) => Math.round(pa[i] + (pb[i] - pa[i]) * amount).toString(16).padStart(2, "0");
    return `#${channel(0)}${channel(1)}${channel(2)}`;
  }
  function hex(value) {
    const match = /^#([0-9a-f]{3}|[0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(String(value || ""));
    if (!match) return null;
    const digits = match[1].length === 3 ? match[1].replace(/./g, (c) => c + c) : match[1];
    return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16));
  }
  /** `text` cut with an ellipsis to fit `width` in the current font. */
  function fit(ctx, text, width) {
    const value = String(text ?? "");
    if (ctx.measureText(value).width <= width) return value;
    let low = 0, high = value.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (ctx.measureText(value.slice(0, mid) + "…").width <= width) low = mid;
      else high = mid - 1;
    }
    return value.slice(0, low) + "…";
  }
  /** Greedy wrap that breaks between CJK characters and at spaces; at most `lines` lines. The
   *  last line ends in an ellipsis only when text was really left over. */
  function wrap(ctx, text, width, lines) {
    const tokens = String(text ?? "").match(/[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]|[^\s\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]+|\s+/g) || [];
    const result = [];
    let line = "", truncated = false;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i], next = line + token;
      if (!line || ctx.measureText(next).width <= width) { line = next; continue; }
      result.push(line.trimEnd());
      line = token.trimStart();
      if (result.length === lines) {
        truncated = Boolean(line) || tokens.slice(i + 1).some((rest) => rest.trim());
        line = "";
        break;
      }
    }
    if (result.length < lines && line.trim()) result.push(line.trimEnd());
    if (truncated) result[lines - 1] = fit(ctx, result[lines - 1] + "……", width);
    return result;
  }

  const fontOf = (board, size, weight = 400) => `${weight} ${size}px ${board.font || "sans-serif"}`;

  /** A pill badge at (x, baseline-centred y); returns its width. */
  function badge(ctx, board, x, y, text, tone, { filled = false, dashed = false, dotted = false } = {}) {
    ctx.font = fontOf(board, 10, 700);
    const w = ctx.measureText(text).width + 12, h = 16;
    roundRect(ctx, x, y - h / 2, w, h, h / 2);
    ctx.setLineDash(dotted ? [1.5, 2] : dashed ? [3, 2] : []);
    if (filled) { ctx.fillStyle = tone; ctx.fill(); }
    else { ctx.fillStyle = mix(board.colors.panel, tone, 0.1); ctx.fill(); ctx.strokeStyle = tone; ctx.lineWidth = 1; ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.fillStyle = filled ? "#ffffff" : tone;
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + 6, y + 0.5);
    return w;
  }
  function toneOf(board, key) {
    return (board.dark ? TONES.dark : TONES.light)[key] || board.colors.accent;
  }

  function drawScene(ctx, board, scene, step, camera, elapsedMs, mapHeight) {
    const c = board.colors;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, HEADER_HEIGHT, board.width, mapHeight);
    ctx.clip();
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, HEADER_HEIGHT, board.width, mapHeight);
    // The canvas dot grid of .canvas (screen-fixed, 19px).
    ctx.fillStyle = mix(c.bg, c.edge, 0.45);
    for (let y = HEADER_HEIGHT + 9; y < HEADER_HEIGHT + mapHeight; y += 19)
      for (let x = 9; x < board.width; x += 19) ctx.fillRect(x, y, 1, 1);
    ctx.translate(camera.x, HEADER_HEIGHT + camera.y);
    ctx.scale(camera.z, camera.z);
    scene.categories.forEach((b, i) => {
      ctx.globalAlpha = OPACITY.bound[step.categoryRoles[i]] ?? 1;
      roundRect(ctx, b.x, b.y, b.w, b.h, 14);
      ctx.fillStyle = mix(c.bg, b.ink, 0.035); ctx.fill();
      ctx.strokeStyle = mix(c.line, b.ink, 0.26); ctx.lineWidth = 1; ctx.stroke();
      ctx.font = fontOf(board, 11, 700); ctx.fillStyle = b.ink; ctx.textBaseline = "alphabetic";
      ctx.fillText(fit(ctx, b.label, b.w - 28), b.x + 14, b.y + 22);
    });
    scene.bounds.forEach((b, i) => {
      ctx.globalAlpha = OPACITY.bound[step.boundRoles[i]] ?? 1;
      roundRect(ctx, b.x, b.y, b.w, b.h, 13);
      ctx.fillStyle = mix(c.bg, c.panel, 0.4); ctx.fill();
      ctx.strokeStyle = mix(c.line, c.muted, 0.35); ctx.lineWidth = 1; ctx.stroke();
      ctx.font = fontOf(board, 12, 600); ctx.fillStyle = c.text; ctx.textBaseline = "alphabetic";
      const title = fit(ctx, b.label, b.w - 40 - (b.mark ? 60 : 0));
      ctx.fillText(title, b.x + 15, b.y + 24);
      if (b.mark) markChip(ctx, board, b.x + 21 + ctx.measureText(title).width, b.y + 20, b.mark);
    });
    scene.wires.forEach((w, i) => {
      const role = step.wireRoles[i], active = step.wireActive[i];
      // An unproven candidate keeps the amber dashed look the legend gives it, whatever its type.
      const ink = w.candidate ? toneOf(board, "candidate") : w.ink;
      const path = new root.Path2D(w.path);
      ctx.globalAlpha = OPACITY.wire[role] ?? 1;
      ctx.setLineDash([]);
      ctx.strokeStyle = c.bg; ctx.lineWidth = 6; ctx.lineJoin = "miter"; ctx.stroke(path);
      ctx.globalAlpha = (OPACITY.wire[role] ?? 1) * (active ? 1 : 0.6);
      ctx.setLineDash(w.candidate ? [5, 4] : w.dash ? w.dash.split(/[\s,]+/).map(Number).filter(Number.isFinite) : []);
      ctx.strokeStyle = ink; ctx.lineWidth = active ? 2.3 : 1.6; ctx.stroke(path);
      ctx.setLineDash([]);
      if (w.arrow && w.points.length > 1) {
        const end = w.points[w.points.length - 1], before = w.points[w.points.length - 2];
        const angle = Math.atan2(end.y - before.y, end.x - before.x);
        ctx.save(); ctx.translate(end.x, end.y); ctx.rotate(angle);
        ctx.beginPath(); ctx.moveTo(-7, -3.5); ctx.lineTo(0, 0); ctx.lineTo(-7, 3.5); ctx.closePath();
        ctx.fillStyle = ink; ctx.fill(); ctx.restore();
      }
      if (board.particles && w.measured) {
        const point = root.CodeLoomMotion.particleAt(w.measured, w.phase, elapsedMs, board.speed || 70);
        if (point) {
          ctx.save(); ctx.translate(point.x, point.y); ctx.rotate((point.angle * Math.PI) / 180);
          ctx.globalAlpha = (OPACITY.wire[role] ?? 1) * (active ? 1 : 0.76);
          ctx.fillStyle = ink;
          ctx.globalAlpha *= 0.15; ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = (OPACITY.wire[role] ?? 1) * (active ? 1 : 0.76) * 0.5;
          ctx.beginPath(); ctx.arc(-5, 0, 2, 0, Math.PI * 2); ctx.arc(-9, 0, 1.2, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = (OPACITY.wire[role] ?? 1) * (active ? 1 : 0.76);
          ctx.beginPath(); ctx.arc(0, 0, active ? 3.7 : 3.1, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = c.panel; ctx.lineWidth = 1; ctx.stroke();
          ctx.restore();
        }
      }
    });
    ctx.globalAlpha = 1;
    scene.items.forEach((p, i) => {
      const role = step.itemRoles[i], selected = step.itemSelected[i];
      ctx.globalAlpha = OPACITY.item[role] ?? 1;
      const radius = board.radius || 12;
      if (selected) {
        roundRect(ctx, p.x - 3, p.y - 3, p.w + 6, p.h + 6, radius + 3);
        ctx.fillStyle = mix(c.bg, p.ink, 0.18); ctx.fill();
      }
      roundRect(ctx, p.x, p.y, p.w, p.h, radius);
      ctx.fillStyle = p.container ? mix(c.panel, p.tone, 0.04) : c.node; ctx.fill();
      ctx.setLineDash(p.container ? [4, 3] : []);
      ctx.strokeStyle = selected ? p.ink : p.container ? mix(c.line, p.tone, 0.6) : c.line;
      ctx.lineWidth = p.container ? 1.5 : 1; ctx.stroke(); ctx.setLineDash([]);
      ctx.save(); roundRect(ctx, p.x, p.y, p.w, p.h, radius); ctx.clip();
      ctx.fillStyle = p.container ? p.tone : p.ink; ctx.fillRect(p.x, p.y, p.w, 3);
      ctx.textBaseline = "alphabetic";
      ctx.font = fontOf(board, 15, 600); ctx.fillStyle = c.text;
      ctx.fillText(fit(ctx, p.label, p.w - 26), p.x + 13, p.y + 30);
      ctx.font = fontOf(board, 10, 600); ctx.fillStyle = p.ink;
      const kind = fit(ctx, p.kind, p.w - 26 - (p.marks.length ? 70 : 0));
      ctx.fillText(kind, p.x + 13, p.y + 47);
      let markX = p.x + 19 + ctx.measureText(kind).width;
      for (const mark of p.marks) markX += markChip(ctx, board, markX, p.y + 43, mark) + 4;
      if (p.text) {
        ctx.font = fontOf(board, 11); ctx.fillStyle = c.muted;
        wrap(ctx, p.text, p.w - 26, p.h > 100 ? 2 : 1).forEach((line, n) => ctx.fillText(line, p.x + 13, p.y + 68 + n * 16));
      }
      ctx.restore();
    });
    scene.hubs.forEach((h, i) => {
      const ink = h.candidate ? toneOf(board, "candidate") : h.ink;
      ctx.globalAlpha = OPACITY.hub[step.hubRoles[i]] ?? 1;
      roundRect(ctx, h.x, h.y, h.w, h.h, Math.min(17, h.h / 2));
      ctx.fillStyle = c.panel; ctx.fill();
      ctx.setLineDash(h.candidate ? [3, 2] : []);
      ctx.strokeStyle = h.candidate ? ink : mix(c.line, ink, 0.5); ctx.lineWidth = 1; ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = fontOf(board, 10, 600); ctx.fillStyle = ink; ctx.textBaseline = "middle";
      ctx.fillText(fit(ctx, h.label, h.w - 14), h.x + 7, h.y + h.h / 2);
    });
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  /** The neutral name chip / interpretation mark; returns its width. */
  function markChip(ctx, board, x, y, mark) {
    ctx.save();
    ctx.font = fontOf(board, 9, 500);
    const w = ctx.measureText(mark.text).width + 10, h = 14;
    roundRect(ctx, x, y - h / 2, w, h, 4);
    const tone = mark.tone ? toneOf(board, mark.tone) : board.colors.muted;
    ctx.fillStyle = mark.tone ? mix(board.colors.panel, tone, 0.09) : board.colors.soft; ctx.fill();
    ctx.setLineDash(mark.tone && mark.tone !== "verified" ? [2.5, 2] : []);
    ctx.strokeStyle = mark.tone ? tone : board.colors.line; ctx.lineWidth = 1; ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = tone; ctx.textBaseline = "middle"; ctx.fillText(mark.text, x + 5, y + 0.5);
    ctx.restore();
    return w;
  }

  function drawHeader(ctx, board, index) {
    const c = board.colors;
    ctx.fillStyle = c.panel;
    ctx.fillRect(0, 0, board.width, HEADER_HEIGHT);
    ctx.fillStyle = c.line;
    ctx.fillRect(0, HEADER_HEIGHT - 1, board.width, 1);
    ctx.textBaseline = "middle";
    ctx.font = fontOf(board, 13, 700);
    ctx.fillStyle = c.text;
    const dotsWidth = board.steps.length * 14 + 8;
    const title = fit(ctx, `Skylense · ${board.title}`, board.width - dotsWidth - 40 - (board.nameMark ? 70 : 0));
    ctx.fillText(title, 16, HEADER_HEIGHT / 2);
    if (board.nameMark) markChip(ctx, board, 22 + ctx.measureText(title).width, HEADER_HEIGHT / 2, { text: board.nameMark });
    // The story strip's progress: one mark per step, filled up to the step being read.
    board.steps.forEach((step, i) => {
      const x = board.width - dotsWidth + i * 14 + 4, y = HEADER_HEIGHT / 2, kind = board.progress[i] || "";
      roundRect(ctx, x, y - 3, 10, 6, 3);
      const tone = kind ? toneOf(board, kind) : c.accent;
      ctx.fillStyle = i <= index ? (kind === "narrative" ? mix(c.panel, tone, 0.45) : c.accent) : c.line;
      ctx.fill();
      if (kind) { ctx.setLineDash(kind === "narrative" ? [1, 1.5] : [2, 1.5]); ctx.strokeStyle = tone; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]); }
    });
  }

  function drawCaption(ctx, board, step) {
    const c = board.colors, top = board.height - CAPTION_HEIGHT, caption = step.caption, left = 18, width = board.width - 36;
    ctx.fillStyle = c.panel;
    ctx.fillRect(0, top, board.width, CAPTION_HEIGHT);
    ctx.fillStyle = c.line;
    ctx.fillRect(0, top, board.width, 1);
    ctx.textBaseline = "alphabetic";
    ctx.font = fontOf(board, 14, 700);
    ctx.fillStyle = c.text;
    ctx.fillText(fit(ctx, caption.counter, width), left, top + 24);
    ctx.font = fontOf(board, 11);
    ctx.fillStyle = c.muted;
    ctx.fillText(fit(ctx, caption.subtitle, width), left, top + 42);
    // The step block: heading and badges, then the edge it follows, then its reason.
    let y = top + 64;
    ctx.font = fontOf(board, 11, 700);
    ctx.fillStyle = caption.kind === "narrative" ? toneOf(board, "narrative") : caption.unproven ? toneOf(board, "unproven") : c.accent;
    ctx.textBaseline = "middle";
    const heading = fit(ctx, caption.heading || "", width / 2);
    ctx.fillText(heading, left, y);
    let x = left + ctx.measureText(heading).width + 8;
    for (const item of caption.badges) {
      const tone = item.tone === "proven" ? c.accent : toneOf(board, item.tone);
      x += badge(ctx, board, x, y, item.text, tone, { filled: item.tone === "unproven", dotted: item.tone === "narrative", dashed: item.tone === "candidate" }) + 6;
      if (x > left + width - 40) break;
    }
    if (caption.kind === "narrative" || caption.unproven) {
      ctx.fillStyle = toneOf(board, caption.kind === "narrative" ? "narrative" : "unproven");
      ctx.fillRect(0, top + 54, 3, CAPTION_HEIGHT - 60);
    }
    ctx.textBaseline = "alphabetic";
    y += 22;
    if (caption.via) {
      ctx.font = fontOf(board, 11, 600); ctx.fillStyle = c.text;
      ctx.fillText(fit(ctx, caption.via, width), left, y);
      y += 18;
    }
    ctx.font = fontOf(board, caption.reasonMuted ? 11 : 12);
    ctx.fillStyle = caption.reasonMuted ? c.muted : c.text;
    const reasonLines = wrap(ctx, caption.reason || "", width, caption.via ? 2 : 3);
    reasonLines.forEach((line, n) => ctx.fillText(line, left, y + n * 17));
    y += reasonLines.length * 17;
    if (caption.reasonMark) badge(ctx, board, left, y - 4, caption.reasonMark.text, toneOf(board, caption.reasonMark.tone), { dashed: caption.reasonMark.tone !== "verified" });
    // At most two footnote lines, bottom-aligned: the candidate note, then the authored layer's.
    const footnotes = (board.footnotes || []).filter(Boolean).slice(0, 2);
    ctx.font = fontOf(board, 9); ctx.fillStyle = c.muted; ctx.textBaseline = "alphabetic";
    footnotes.forEach((line, k) => ctx.fillText(fit(ctx, line, width), left, board.height - 7 - (footnotes.length - 1 - k) * 12));
  }

  /** Measured wires, once per board: path lengths and marker phases. */
  function prepare(board) {
    if (board.prepared) return board;
    for (const scene of board.scenes)
      for (const wire of scene.wires) {
        if (wire.points?.length > 1) {
          wire.measured = root.CodeLoomMotion.measurePath(wire.points);
          wire.phase = root.CodeLoomMotion.keyPhase(wire.key || "");
        }
      }
    Object.defineProperty(board, "prepared", { value: true });
    return board;
  }

  /** Draw frame `frame` of the board at `fps` on a 2D context of board.width × board.height. */
  function drawFrame(ctx, board, fps, frame) {
    prepare(board);
    const { index, step, camera, elapsedMs } = frameState(board, fps, frame);
    const mapHeight = board.height - HEADER_HEIGHT - CAPTION_HEIGHT;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    drawScene(ctx, board, board.scenes[step.scene], step, camera, elapsedMs, mapHeight);
    drawHeader(ctx, board, index);
    drawCaption(ctx, board, step);
    ctx.restore();
    return index;
  }

  function createCanvas(board, documentRef = root.document) {
    const canvas = documentRef.createElement("canvas");
    canvas.width = board.width;
    canvas.height = board.height;
    return canvas;
  }
  const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
  const abortError = () => Object.assign(new Error("已取消导出。"), { name: "AbortError" });

  /** Every colour the board names, for the GIF palette seed. */
  function boardColours(board) {
    const colours = new Set([...Object.values(board.colors), ...Object.values(board.dark ? TONES.dark : TONES.light), "#ffffff"]);
    for (const scene of board.scenes) {
      for (const item of [...scene.items, ...scene.hubs, ...scene.wires, ...scene.categories]) if (item.ink) colours.add(item.ink);
      for (const item of scene.items) if (item.tone) colours.add(item.tone);
    }
    return [...colours].filter((value) => /^#[0-9a-f]{6}$/i.test(value));
  }

  /** The walkthrough as an animated GIF (Blob). */
  async function exportGIF(board, { onProgress = () => {}, signal, documentRef } = {}) {
    const gif = root.SkylenseGif, t = timing(board, GIF_FPS);
    const canvas = createCanvas(board, documentRef), ctx = canvas.getContext("2d", { willReadFrequently: true });
    const read = () => ctx.getImageData(0, 0, board.width, board.height).data;
    // Palette: theme and ink colours exactly, then what the drawn frames use most.
    const samples = [];
    for (let i = 0; i < board.steps.length; i++) {
      if (signal?.aborted) throw abortError();
      drawFrame(ctx, board, GIF_FPS, i * t.stepFrames + t.stepFrames - 1);
      samples.push(read());
      if (i > 0) { drawFrame(ctx, board, GIF_FPS, i * t.stepFrames + Math.floor(t.transitionFrames / 2)); samples.push(read()); }
      onProgress({ phase: "palette", done: i + 1, total: board.steps.length });
      await pause();
    }
    const palette = gif.buildPalette({ seeds: boardColours(board), samples, stride: 3 });
    const encoder = gif.createEncoder({ width: board.width, height: board.height, palette, loop: 0 });
    const delay = Math.round(100 / GIF_FPS);
    for (let frame = 0; frame < t.frameCount; frame++) {
      if (signal?.aborted) throw abortError();
      drawFrame(ctx, board, GIF_FPS, frame);
      encoder.addFrame(read(), delay);
      onProgress({ phase: "frames", done: frame + 1, total: t.frameCount });
      if (frame % 2 === 1) await pause();
    }
    const bytes = encoder.finish();
    return { blob: new Blob([bytes], { type: "image/gif" }), frames: encoder.frames, drawnFrames: t.frameCount, fps: GIF_FPS, durationSeconds: t.durationSeconds, width: board.width, height: board.height };
  }

  /** The recordable video type: WebM, or MP4 when asked for and the browser records it. */
  function videoType(kind, Recorder = root.MediaRecorder) {
    if (!Recorder?.isTypeSupported) return null;
    const candidates = kind === "mp4"
      ? ["video/mp4;codecs=avc1", "video/mp4"]
      : ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    return candidates.find((type) => Recorder.isTypeSupported(type)) || null;
  }

  /**
   * The walkthrough as a video (Blob) recorded from the canvas, one frame per 1/VIDEO_FPS s.
   * The recorder stamps frames by the wall clock, so the recording is only true to the fixed
   * timing while the page keeps that clock: it fails, with what it recorded, when the page goes
   * to the background, when a frame falls more than two intervals behind its schedule, or when
   * the recorder errors or stops on its own. Every captured stream is stopped on every path.
   * `Recorder`, `now` and `sleep` are injectable for tests.
   */
  async function exportVideo(board, { kind = "webm", onProgress = () => {}, signal, documentRef = root.document, Recorder = root.MediaRecorder, now = () => root.performance.now(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
    const type = videoType(kind, Recorder);
    if (!type) throw new Error(kind === "mp4" ? "此浏览器不能录制 MP4。" : "此浏览器不能录制 WebM。");
    const t = timing(board, VIDEO_FPS), frameMs = 1000 / VIDEO_FPS;
    const canvas = createCanvas(board, documentRef), ctx = canvas.getContext("2d");
    drawFrame(ctx, board, VIDEO_FPS, 0);
    const streams = [], chunks = [];
    const capture = (fps) => { const stream = canvas.captureStream(fps); streams.push(stream); return stream; };
    let recorder = null, failure = null, frame = 0, start = null, stoppedOnItsOwn = false, stopping = false;
    const hiddenError = () => new Error("页面在录制时转到了后台：浏览器会放慢后台页面的计时，视频的节奏会被打乱。请让此页保持在前台，再导出一次。");
    const onVisibility = () => { if (documentRef.hidden) failure ||= hiddenError(); };
    documentRef.addEventListener?.("visibilitychange", onVisibility);
    try {
      if (documentRef.hidden) throw hiddenError();
      const stream = capture(0), track = stream.getVideoTracks()[0];
      const manual = typeof track?.requestFrame === "function";
      recorder = new Recorder(manual ? stream : capture(VIDEO_FPS), { mimeType: type, videoBitsPerSecond: 2_000_000 });
      recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
      recorder.onerror = (event) => {
        const cause = event?.error;
        failure ||= new Error(`视频录制器出错：${cause?.message || cause?.name || "浏览器没有说明原因"}。`);
      };
      const stopped = new Promise((resolve) => {
        recorder.onstop = () => { if (!stopping) stoppedOnItsOwn = true; resolve(); };
      });
      recorder.start(500);
      start = now();
      for (frame = 0; frame < t.frameCount; frame++) {
        if (signal?.aborted) throw abortError();
        if (failure) throw failure;
        if (stoppedOnItsOwn || recorder.state === "inactive") throw new Error("视频录制器提前停止了。");
        const late = now() - (start + frame * frameMs);
        if (late > 2 * frameMs)
          throw new Error(`录制落后时间表 ${Math.round(late)} 毫秒：视频的节奏会被打乱。请让此页保持在前台、减少其他负载，再导出一次。`);
        drawFrame(ctx, board, VIDEO_FPS, frame);
        if (manual) track.requestFrame();
        onProgress({ phase: "frames", done: frame + 1, total: t.frameCount });
        await sleep(Math.max(0, start + (frame + 1) * frameMs - now()));
      }
      if (failure) throw failure;
      if (stoppedOnItsOwn || recorder.state === "inactive") throw new Error("视频录制器提前停止了。");
      stopping = true;
      recorder.stop();
      await stopped;
      if (failure) throw failure;
      const recordedSeconds = Math.round((now() - start) / 10) / 100;
      return { blob: new Blob(chunks, { type: type.split(";")[0] }), mimeType: type, frames: frame, fps: VIDEO_FPS, durationSeconds: t.durationSeconds, recordedSeconds, width: board.width, height: board.height };
    } catch (error) {
      // What was really recorded, for the message: never the planned timing.
      if (error && typeof error === "object" && error.name !== "AbortError")
        error.recorded = { frames: frame, seconds: start === null ? 0 : Math.round((now() - start) / 10) / 100, planned: t.frameCount };
      throw error;
    } finally {
      documentRef.removeEventListener?.("visibilitychange", onVisibility);
      stopping = true;
      if (recorder && recorder.state !== "inactive") { try { recorder.stop(); } catch { /* already failing */ } }
      for (const stream of streams) for (const track of stream.getTracks()) track.stop();
    }
  }

  root.SkylenseWalkthrough = Object.freeze({
    STEP_SECONDS, TRANSITION_SECONDS, GIF_FPS, VIDEO_FPS, WIDTH, HEIGHT, CAPTION_HEIGHT, HEADER_HEIGHT,
    timing, frameState, drawFrame, exportGIF, exportVideo, videoType, wrap,
  });
})(typeof window !== "undefined" ? window : globalThis);
