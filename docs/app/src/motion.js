/* Decorative direction markers on canonical paths, never runtime evidence. */
(function (root) {
  "use strict";

  function measurePath(points) {
    if (!Array.isArray(points))
      throw new TypeError("Path points must be an array.");
    const clean = [];
    for (const point of points) {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))
        throw new TypeError("Path coordinates must be finite numbers.");
      const previous = clean[clean.length - 1];
      if (!previous || previous.x !== point.x || previous.y !== point.y)
        clean.push({ x: point.x, y: point.y });
    }
    const segments = [];
    let length = 0;
    for (let i = 1; i < clean.length; i++) {
      const a = clean[i - 1],
        b = clean[i];
      const size = Math.hypot(b.x - a.x, b.y - a.y);
      segments.push({
        a,
        b,
        start: length,
        end: length + size,
        length: size,
        angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
      });
      length += size;
    }
    return {
      points: clean,
      segments,
      length,
      bounds: clean.length
        ? {
            left: Math.min(...clean.map((point) => point.x)),
            right: Math.max(...clean.map((point) => point.x)),
            top: Math.min(...clean.map((point) => point.y)),
            bottom: Math.max(...clean.map((point) => point.y)),
          }
        : null,
    };
  }

  /** Distance is clamped. Increasing distance always follows supplied points. */
  function samplePath(path, distance) {
    if (!path?.points?.length) return null;
    const d = Number.isFinite(distance)
      ? Math.min(path.length, Math.max(0, distance))
      : 0;
    if (!path.segments.length)
      return { ...path.points[0], angle: 0, distance: 0, segmentIndex: -1 };
    let low = 0,
      high = path.segments.length - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (path.segments[middle].end <= d) low = middle + 1;
      else high = middle;
    }
    const segment = path.segments[low],
      fraction = (d - segment.start) / segment.length;
    return {
      x: segment.a.x + (segment.b.x - segment.a.x) * fraction,
      y: segment.a.y + (segment.b.y - segment.a.y) * fraction,
      angle: segment.angle,
      distance: d,
      segmentIndex: low,
    };
  }

  function keyPhase(key) {
    let hash = 2166136261;
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967296;
  }

  function createController(options = {}) {
    const requestFrame =
      options.requestFrame || root.requestAnimationFrame?.bind(root);
    const cancelFrame =
      options.cancelFrame || root.cancelAnimationFrame?.bind(root);
    const now = options.now || (() => root.performance?.now?.() ?? Date.now());
    const speed = options.speed === undefined ? 70 : options.speed;
    if (
      typeof requestFrame !== "function" ||
      typeof cancelFrame !== "function" ||
      typeof now !== "function"
    )
      throw new TypeError(
        "Motion controller needs frame scheduling and a clock.",
      );
    if (!Number.isFinite(speed) || speed <= 0)
      throw new TypeError("Motion speed must be positive.");

    let entries = [],
      viewport = null,
      enabled = false,
      destroyed = false;
    let handle = null,
      lastTime = null,
      elapsed = 0,
      frameCount = 0,
      updateCount = 0,
      skippedEntries = 0;
    const visibleCount = () => entries.filter((entry) => entry.visible).length;
    function advance() {
      const time = now();
      if (lastTime !== null && Number.isFinite(time))
        elapsed += Math.max(0, time - lastTime);
      lastTime = Number.isFinite(time) ? time : lastTime;
    }
    function stop() {
      if (handle !== null) cancelFrame(handle);
      handle = null;
      lastTime = null;
    }
    function visible(path) {
      if (!path.bounds) return false;
      if (!viewport) return true;
      if (!viewport.width || !viewport.height) return false;
      const left = -viewport.x / viewport.z,
        right = (viewport.width - viewport.x) / viewport.z;
      const top = -viewport.y / viewport.z,
        bottom = (viewport.height - viewport.y) / viewport.z;
      return (
        path.bounds.right >= left &&
        path.bounds.left <= right &&
        path.bounds.bottom >= top &&
        path.bounds.top <= bottom
      );
    }
    function draw(entry) {
      const distance = entry.path.length
        ? (entry.phase * entry.path.length + (elapsed * speed) / 1000) %
          entry.path.length
        : 0;
      const point = samplePath(entry.path, distance);
      if (!point) return;
      // A root-owned trail drawn to the left of the core rotates behind travel.
      entry.element.setAttribute(
        "transform",
        `translate(${point.x.toFixed(3)} ${point.y.toFixed(3)}) rotate(${point.angle.toFixed(3)})`,
      );
      updateCount++;
    }
    function refreshVisibility() {
      for (const entry of entries) {
        const next = visible(entry.path);
        if (entry.visible !== next) {
          entry.visible = next;
          entry.element.setAttribute("visibility", next ? "visible" : "hidden");
        }
        if (next) draw(entry);
      }
    }
    function schedule() {
      if (destroyed || !enabled || !visibleCount()) {
        stop();
        return;
      }
      if (handle !== null) return;
      if (lastTime === null) lastTime = now();
      handle = requestFrame(tick);
    }
    function tick() {
      handle = null;
      if (destroyed || !enabled || !visibleCount()) {
        stop();
        return;
      }
      advance();
      frameCount++;
      for (const entry of entries) if (entry.visible) draw(entry);
      schedule();
    }

    return Object.freeze({
      bind(values) {
        if (destroyed) return;
        if (!Array.isArray(values))
          throw new TypeError("Motion entries must be an array.");
        if (lastTime !== null) advance();
        const seen = new Set();
        skippedEntries = 0;
        entries = values.flatMap((value) => {
          if (
            !value ||
            typeof value.key !== "string" ||
            !value.key ||
            seen.has(value.key) ||
            typeof value.element?.setAttribute !== "function"
          ) {
            skippedEntries++;
            return [];
          }
          try {
            const path = measurePath(value.points);
            if (!path.points.length) {
              skippedEntries++;
              return [];
            }
            seen.add(value.key);
            return [
              {
                key: value.key,
                path,
                element: value.element,
                phase: keyPhase(value.key),
                visible: null,
              },
            ];
          } catch {
            skippedEntries++;
            return [];
          }
        });
        refreshVisibility();
        schedule();
      },
      setEnabled(value) {
        if (destroyed || enabled === Boolean(value)) return;
        if (lastTime !== null) advance();
        enabled = Boolean(value);
        if (!enabled) {
          for (const entry of entries) if (entry.visible) draw(entry);
          stop();
        } else schedule();
      },
      setViewport(value) {
        if (destroyed) return;
        if (
          value !== null &&
          (!value ||
            ![value.x, value.y, value.z, value.width, value.height].every(
              Number.isFinite,
            ) ||
            value.z <= 0 ||
            value.width < 0 ||
            value.height < 0)
        )
          throw new TypeError(
            "Viewport requires a finite camera and nonnegative dimensions.",
          );
        if (lastTime !== null) advance();
        viewport =
          value === null
            ? null
            : {
                x: value.x,
                y: value.y,
                z: value.z,
                width: value.width,
                height: value.height,
              };
        refreshVisibility();
        schedule();
      },
      destroy() {
        if (destroyed) return;
        stop();
        destroyed = true;
        enabled = false;
        entries = [];
      },
      stats() {
        return Object.freeze({
          enabled,
          destroyed,
          entries: entries.length,
          visible: visibleCount(),
          scheduled: handle !== null,
          elapsedMs: elapsed,
          frames: frameCount,
          updates: updateCount,
          skippedEntries,
          speed,
        });
      },
    });
  }

  root.CodeLoomMotion = Object.freeze({
    measurePath,
    samplePath,
    createController,
  });
})(typeof window !== "undefined" ? window : globalThis);
