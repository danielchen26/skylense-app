/* A dependency-free GIF89a encoder for the animated walkthrough export.
 *
 * One global palette for the whole animation: the theme's own colours are seeded exactly, the
 * remaining slots go to the most frequent colours of sampled frames (anti-aliased text and
 * translucent fills), bucketed at 5 bits per channel. Frames after the first carry only the
 * rectangle that changed, with unchanged pixels transparent, and an identical frame extends the
 * previous frame's delay instead of being written. Pixel data is LZW-coded with the variable
 * 9–12 bit codes of the GIF specification. The output loops (NETSCAPE2.0) unless told not to. */
(function (root) {
  "use strict";

  /** Palette entries available for colour; the last index of the 256-entry table is transparent. */
  const MAX_COLOURS = 255;
  const TRANSPARENT = 255;
  const MIN_CODE_SIZE = 8;

  function parseColour(value) {
    if (Array.isArray(value) && value.length >= 3) return [value[0] & 255, value[1] & 255, value[2] & 255];
    const match = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(String(value || "").trim());
    if (!match) return null;
    let hex = match[1];
    if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }

  /** Perceptually weighted squared distance; cheap and stable for flat interface colours. */
  function distance(r1, g1, b1, r2, g2, b2) {
    const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
    return 2 * dr * dr + 4 * dg * dg + 3 * db * db;
  }

  /**
   * A palette of at most 255 RGB colours (Uint8Array, 3 bytes each). `seeds` are kept exactly
   * and first; `samples` (RGBA pixel arrays) fill the rest by bucket frequency. Deterministic:
   * equal inputs give an equal palette.
   */
  function buildPalette({ seeds = [], samples = [], size = MAX_COLOURS, stride = 1 } = {}) {
    const limit = Math.max(2, Math.min(MAX_COLOURS, size | 0));
    const chosen = [];
    const seen = new Set();
    const push = (rgb) => {
      const key = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
      if (seen.has(key) || chosen.length >= limit) return;
      seen.add(key);
      chosen.push(rgb);
    };
    for (const seed of seeds) {
      const rgb = parseColour(seed);
      if (rgb) push(rgb);
    }
    const counts = new Uint32Array(32768), sums = new Float64Array(32768 * 3);
    const step = Math.max(1, stride | 0) * 4;
    for (const pixels of samples)
      for (let i = 0; i < pixels.length; i += step) {
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        const bucket = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        counts[bucket]++;
        sums[bucket * 3] += r; sums[bucket * 3 + 1] += g; sums[bucket * 3 + 2] += b;
      }
    const buckets = [];
    for (let bucket = 0; bucket < 32768; bucket++) if (counts[bucket]) buckets.push(bucket);
    buckets.sort((a, b) => counts[b] - counts[a] || a - b);
    const near = (rgb, threshold) => chosen.some((c) => distance(c[0], c[1], c[2], rgb[0], rgb[1], rgb[2]) < threshold);
    const skipped = [];
    for (const bucket of buckets) {
      if (chosen.length >= limit) break;
      const n = counts[bucket];
      const rgb = [Math.round(sums[bucket * 3] / n), Math.round(sums[bucket * 3 + 1] / n), Math.round(sums[bucket * 3 + 2] / n)];
      // A bucket already served by a seed or an earlier colour waits until the distinct ones are in.
      if (near(rgb, 54)) skipped.push(rgb);
      else push(rgb);
    }
    for (const rgb of skipped) if (chosen.length < limit) push(rgb);
    if (chosen.length < 2) push(chosen.length && chosen[0][0] === 0 && chosen[0][1] === 0 && chosen[0][2] === 0 ? [255, 255, 255] : [0, 0, 0]);
    const palette = new Uint8Array(chosen.length * 3);
    chosen.forEach((rgb, i) => palette.set(rgb, i * 3));
    return palette;
  }

  /** Nearest palette index for 24-bit colours, memoised per colour. */
  function createQuantizer(palette) {
    if (!(palette instanceof Uint8Array) || palette.length < 6 || palette.length % 3 || palette.length > MAX_COLOURS * 3)
      throw new TypeError("A GIF palette holds 2–255 RGB colours.");
    const count = palette.length / 3, cache = new Map();
    return function nearest(r, g, b) {
      const key = (r << 16) | (g << 8) | b;
      let index = cache.get(key);
      if (index !== undefined) return index;
      let best = Infinity;
      index = 0;
      for (let i = 0; i < count; i++) {
        const d = distance(r, g, b, palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2]);
        if (d < best) { best = d; index = i; if (!d) break; }
      }
      cache.set(key, index);
      return index;
    };
  }

  /** A growable byte buffer. */
  function createWriter(initial = 1 << 16) {
    let bytes = new Uint8Array(initial), length = 0;
    const ensure = (extra) => {
      if (length + extra <= bytes.length) return;
      let size = bytes.length * 2;
      while (size < length + extra) size *= 2;
      const next = new Uint8Array(size);
      next.set(bytes.subarray(0, length));
      bytes = next;
    };
    return {
      byte(value) { ensure(1); bytes[length++] = value & 255; },
      short(value) { ensure(2); bytes[length++] = value & 255; bytes[length++] = (value >> 8) & 255; },
      bytes(values) { ensure(values.length); bytes.set(values, length); length += values.length; },
      ascii(text) { for (let i = 0; i < text.length; i++) this.byte(text.charCodeAt(i)); },
      get length() { return length; },
      result() { return bytes.slice(0, length); },
    };
  }

  /* LZW dictionary: (prefix code, next index) → code, stamped per generation so a clear code
     resets it in constant time. 4096 prefixes × 256 indices. */
  const dictCode = new Int16Array(4096 * 256);
  const dictStamp = new Int32Array(4096 * 256);
  let generation = 0;

  /** GIF LZW of `indices` (values < 256) into data sub-blocks, minimum code size 8. */
  function writeLZW(out, indices) {
    const clear = 1 << MIN_CODE_SIZE, end = clear + 1;
    let codeSize = MIN_CODE_SIZE + 1, next = end + 1;
    let bitBuffer = 0, bitCount = 0;
    const block = new Uint8Array(255);
    let blockLength = 0;
    const flushBlock = () => {
      if (!blockLength) return;
      out.byte(blockLength);
      out.bytes(block.subarray(0, blockLength));
      blockLength = 0;
    };
    const emit = (code) => {
      bitBuffer |= code << bitCount;
      bitCount += codeSize;
      while (bitCount >= 8) {
        block[blockLength++] = bitBuffer & 255;
        if (blockLength === 255) flushBlock();
        bitBuffer >>>= 8;
        bitCount -= 8;
      }
    };
    out.byte(MIN_CODE_SIZE);
    generation = generation === 0x7fffffff ? 1 : generation + 1;
    if (generation === 1) dictStamp.fill(0);
    emit(clear);
    if (indices.length) {
      let prefix = indices[0];
      for (let i = 1; i < indices.length; i++) {
        const k = indices[i], key = (prefix << 8) | k;
        if (dictStamp[key] === generation) { prefix = dictCode[key]; continue; }
        emit(prefix);
        if (next === 4096) {
          emit(clear);
          codeSize = MIN_CODE_SIZE + 1;
          next = end + 1;
          generation = generation === 0x7fffffff ? 1 : generation + 1;
          if (generation === 1) dictStamp.fill(0);
        } else {
          if (next >= 1 << codeSize) codeSize++;
          dictStamp[key] = generation;
          dictCode[key] = next++;
        }
        prefix = k;
      }
      emit(prefix);
      // The decoder adds one more entry on reading that last code; the end code follows its width.
      if (next === 1 << codeSize && codeSize < 12) codeSize++;
    }
    emit(end);
    if (bitCount > 0) {
      block[blockLength++] = bitBuffer & 255;
      if (blockLength === 255) flushBlock();
    }
    flushBlock();
    out.byte(0);
  }

  /**
   * A streaming encoder. `addFrame(rgba, delayCs)` takes the full canvas (RGBA, width × height)
   * and a delay in hundredths of a second; `finish()` returns the GIF bytes.
   */
  function createEncoder({ width, height, palette, loop = 0 } = {}) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 65535 || height > 65535)
      throw new TypeError("GIF dimensions must be integers from 1 to 65535.");
    const nearest = createQuantizer(palette);
    const out = createWriter(Math.max(1 << 16, width * height));
    out.ascii("GIF89a");
    out.short(width);
    out.short(height);
    out.byte(0xf7); // global colour table, 8 bits of colour resolution, 256 entries
    out.byte(0);
    out.byte(0);
    const table = new Uint8Array(768);
    table.set(palette);
    out.bytes(table);
    if (loop !== null && loop !== false) {
      out.byte(0x21); out.byte(0xff); out.byte(11);
      out.ascii("NETSCAPE2.0");
      out.byte(3); out.byte(1); out.short(Math.max(0, Math.min(65535, loop | 0))); out.byte(0);
    }
    const pixels = width * height;
    const previous = new Uint32Array(pixels);
    let pending = null, frames = 0, finished = false;

    function flush() {
      if (!pending) return;
      let delay = pending.delay;
      // A delay beyond the 16-bit field continues as repeated empty frames.
      while (delay > 65535) {
        writeFrame({ ...pending, delay: 65535 });
        pending = { x: 0, y: 0, w: 1, h: 1, indices: Uint8Array.of(TRANSPARENT), transparent: true, delay: 0 };
        delay -= 65535;
      }
      writeFrame({ ...pending, delay });
      pending = null;
    }
    function writeFrame(frame) {
      out.byte(0x21); out.byte(0xf9); out.byte(4);
      out.byte((1 << 2) | (frame.transparent ? 1 : 0)); // disposal 1: leave the frame in place
      out.short(frame.delay);
      out.byte(frame.transparent ? TRANSPARENT : 0);
      out.byte(0);
      out.byte(0x2c);
      out.short(frame.x); out.short(frame.y); out.short(frame.w); out.short(frame.h);
      out.byte(0);
      writeLZW(out, frame.indices);
      frames++;
    }

    return Object.freeze({
      addFrame(rgba, delay) {
        if (finished) throw new Error("The GIF is already finished.");
        if (!rgba || rgba.length !== pixels * 4) throw new TypeError(`A frame must be ${width}×${height} RGBA pixels.`);
        const delayCs = Math.max(0, Math.round(Number(delay) || 0));
        const current = new Uint32Array(rgba.buffer, rgba.byteOffset, pixels);
        const first = frames === 0 && !pending;
        let x0 = 0, y0 = 0, x1 = width - 1, y1 = height - 1;
        if (!first) {
          x0 = width; y0 = height; x1 = -1; y1 = -1;
          for (let y = 0, i = 0; y < height; y++)
            for (let x = 0; x < width; x++, i++)
              if (current[i] !== previous[i]) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                y1 = y;
              }
          if (x1 < 0) { pending.delay += delayCs; return; }
        }
        const w = x1 - x0 + 1, h = y1 - y0 + 1, indices = new Uint8Array(w * h);
        let lastValue = -1, lastIndex = 0;
        for (let y = 0, o = 0; y < h; y++) {
          let i = (y0 + y) * width + x0;
          for (let x = 0; x < w; x++, i++, o++) {
            const value = current[i];
            if (!first && value === previous[i]) { indices[o] = TRANSPARENT; continue; }
            if (value !== lastValue) {
              const p = i * 4;
              lastValue = value;
              lastIndex = nearest(rgba[p], rgba[p + 1], rgba[p + 2]);
            }
            indices[o] = lastIndex;
            previous[i] = value;
          }
        }
        flush();
        pending = { x: x0, y: y0, w, h, indices, transparent: !first, delay: delayCs };
      },
      finish() {
        if (finished) throw new Error("The GIF is already finished.");
        if (!pending && !frames) throw new Error("A GIF needs at least one frame.");
        flush();
        finished = true;
        out.byte(0x3b);
        return out.result();
      },
      get frames() { return frames + (pending ? 1 : 0); },
    });
  }

  /** Encode a list of `{ rgba, delay }` frames in one call. */
  function encode({ width, height, palette, frames, loop = 0 }) {
    const encoder = createEncoder({ width, height, palette, loop });
    for (const frame of frames) encoder.addFrame(frame.rgba, frame.delay);
    return encoder.finish();
  }

  root.SkylenseGif = Object.freeze({ MAX_COLOURS, TRANSPARENT, parseColour, buildPalette, createQuantizer, createEncoder, encode });
})(typeof window !== "undefined" ? window : globalThis);
