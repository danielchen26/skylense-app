/* Deterministic, dependency-free rectilinear routing for architecture diagrams.
 * Clearance is measured from obstacle interiors. Ports must be outside the
 * padded rectangles; padding: 0 is useful when the caller inflates its cards.
 * A blocked route deliberately has no SVG path rather than crossing a card.
 */
(function (root) {
  "use strict";

  const EPSILON = 1e-8;
  const DIRECTIONS = { left: 1, right: 2, up: 3, down: 4 };
  const validPoint = (point) =>
    point && Number.isFinite(point.x) && Number.isFinite(point.y);
  const blocked = (reason) => ({
    points: [],
    path: "",
    blocked: true,
    length: 0,
    bends: 0,
    reason,
  });

  function rectangle(input, padding = 0) {
    const left = input?.left ?? input?.x;
    const top = input?.top ?? input?.y;
    const right = input?.right ?? left + input?.width;
    const bottom = input?.bottom ?? top + input?.height;
    if (
      ![left, top, right, bottom].every(Number.isFinite) ||
      right < left ||
      bottom < top
    )
      throw new TypeError(
        "An obstacle needs finite x/y/width/height or left/top/right/bottom bounds.",
      );
    return {
      left: left - padding,
      top: top - padding,
      right: right + padding,
      bottom: bottom + padding,
    };
  }

  /** Whether an axis-aligned segment enters the open interior of a rectangle. */
  function intersectsInterior(a, b, input) {
    if (!validPoint(a) || !validPoint(b)) return false;
    const r = rectangle(input);
    if (Math.abs(a.y - b.y) < EPSILON)
      return (
        a.y > r.top + EPSILON &&
        a.y < r.bottom - EPSILON &&
        Math.max(a.x, b.x) > r.left + EPSILON &&
        Math.min(a.x, b.x) < r.right - EPSILON
      );
    if (Math.abs(a.x - b.x) < EPSILON)
      return (
        a.x > r.left + EPSILON &&
        a.x < r.right - EPSILON &&
        Math.max(a.y, b.y) > r.top + EPSILON &&
        Math.min(a.y, b.y) < r.bottom - EPSILON
      );
    throw new TypeError("Only horizontal or vertical segments can be tested.");
  }

  function pathFromPoints(points) {
    return points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
  }

  function simplify(points) {
    const result = [];
    for (const point of points) {
      const last = result[result.length - 1];
      if (last && point.x === last.x && point.y === last.y) continue;
      const prior = result[result.length - 2];
      // Only merge monotone collinear segments; preserve any reversal.
      if (
        prior &&
        ((prior.x === last.x &&
          last.x === point.x &&
          (last.y - prior.y) * (point.y - last.y) >= 0) ||
          (prior.y === last.y &&
            last.y === point.y &&
            (last.x - prior.x) * (point.x - last.x) >= 0))
      )
        result.pop();
      result.push({ x: point.x, y: point.y });
    }
    return result;
  }

  function resultFromPoints(points) {
    const compact = simplify(points);
    let length = 0;
    for (let i = 1; i < compact.length; i++)
      length +=
        Math.abs(compact[i].x - compact[i - 1].x) +
        Math.abs(compact[i].y - compact[i - 1].y);
    return {
      points: compact,
      path: pathFromPoints(compact),
      blocked: false,
      length,
      bends: Math.max(0, compact.length - 2),
    };
  }

  function occupiedLanes(segments = []) {
    const horizontal = new Map(),
      vertical = new Map(),
      valid = [];
    if (!Array.isArray(segments))
      throw new TypeError("Used segments must be an array.");
    for (const segment of segments) {
      const { a, b } = segment;
      if (!validPoint(a) || !validPoint(b)) continue;
      const isHorizontal = a.y === b.y,
        isVertical = a.x === b.x;
      if ((!isHorizontal && !isVertical) || (isHorizontal && isVertical))
        continue;
      const lanes = isHorizontal ? horizontal : vertical;
      const axis = isHorizontal ? a.y : a.x;
      const span = isHorizontal
        ? [Math.min(a.x, b.x), Math.max(a.x, b.x)]
        : [Math.min(a.y, b.y), Math.max(a.y, b.y)];
      if (!lanes.has(axis)) lanes.set(axis, []);
      lanes.get(axis).push(span);
      valid.push({ a, b, isHorizontal });
    }
    return { horizontal, vertical, valid };
  }

  function laneCost(a, b, lanes, penalty) {
    if (!penalty) return 0;
    const horizontal = a.y === b.y;
    const spans = (horizontal ? lanes.horizontal : lanes.vertical).get(
      horizontal ? a.y : a.x,
    );
    if (!spans) return 0;
    const low = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
    const high = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
    let length = 0;
    for (const [from, to] of spans)
      length += Math.max(0, Math.min(high, to) - Math.max(low, from));
    return length * penalty;
  }

  class MinHeap {
    constructor() {
      this.values = [];
      this.sequence = 0;
    }
    before(a, b) {
      return (
        a.priority < b.priority ||
        (a.priority === b.priority &&
          (a.heuristic < b.heuristic ||
            (a.heuristic === b.heuristic && a.sequence < b.sequence)))
      );
    }
    push(value) {
      value.sequence = this.sequence++;
      let index = this.values.length;
      this.values.push(value);
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (!this.before(value, this.values[parent])) break;
        this.values[index] = this.values[parent];
        index = parent;
      }
      this.values[index] = value;
    }
    pop() {
      const first = this.values[0],
        last = this.values.pop();
      if (this.values.length) {
        let index = 0;
        while (index * 2 + 1 < this.values.length) {
          let child = index * 2 + 1;
          if (
            child + 1 < this.values.length &&
            this.before(this.values[child + 1], this.values[child])
          )
            child++;
          if (!this.before(this.values[child], last)) break;
          this.values[index] = this.values[child];
          index = child;
        }
        this.values[index] = last;
      }
      return first;
    }
  }

  /* The Cartesian visibility grid includes every rectangle boundary and port.
   * We mark blocked vertices AND spans: a rectangle with no internal grid
   * vertex still obstructs the segment between its opposite boundary points.
   */
  function createGrid(points, obstacles, options) {
    if (!Array.isArray(obstacles))
      throw new TypeError("Obstacles must be an array.");
    const padding = options.padding ?? 12;
    if (!Number.isFinite(padding) || padding < 0)
      throw new TypeError("Padding must be finite and non-negative.");
    const rectangles = obstacles.map((obstacle) =>
      rectangle(obstacle, padding),
    );
    const lanes = occupiedLanes(options.usedSegments);
    const laneGap = options.laneGap ?? 7;
    if (!Number.isFinite(laneGap) || laneGap <= 0)
      throw new TypeError("Lane gap must be finite and positive.");
    const xSet = new Set(points.map((point) => point.x));
    const ySet = new Set(points.map((point) => point.y));
    // Port-facing routes need an intermediate row/column for a monotone Z.
    // Without one, two downward-facing ports can force an avoidable backtrack.
    for (let i = 0; i + 1 < points.length; i += 2) {
      xSet.add((points[i].x + points[i + 1].x) / 2);
      ySet.add((points[i].y + points[i + 1].y) / 2);
    }
    for (const r of rectangles) {
      xSet.add(r.left);
      xSet.add(r.right);
      ySet.add(r.top);
      ySet.add(r.bottom);
    }
    for (const { a, b, isHorizontal } of lanes.valid) {
      const parallel = isHorizontal ? ySet : xSet;
      const along = isHorizontal ? xSet : ySet;
      const axis = isHorizontal ? a.y : a.x;
      parallel.add(axis);
      parallel.add(axis - laneGap);
      parallel.add(axis + laneGap);
      // Short escape stubs let shared ports diverge into parallel lanes.
      for (const value of isHorizontal ? [a.x, b.x] : [a.y, b.y]) {
        along.add(value);
        along.add(value - laneGap);
        along.add(value + laneGap);
      }
    }
    const margin = options.margin ?? padding + 24;
    if (!Number.isFinite(margin) || margin <= 0)
      throw new TypeError("Margin must be finite and positive.");
    xSet.add(Math.min(...xSet) - margin);
    xSet.add(Math.max(...xSet) + margin);
    ySet.add(Math.min(...ySet) - margin);
    ySet.add(Math.max(...ySet) + margin);
    const xs = [...xSet].sort((a, b) => a - b),
      ys = [...ySet].sort((a, b) => a - b);
    const width = xs.length,
      height = ys.length,
      size = width * height;
    if (size > (options.maxGridPoints ?? 200000)) return null;
    const xIndex = new Map(xs.map((value, i) => [value, i]));
    const yIndex = new Map(ys.map((value, i) => [value, i]));
    const vertices = new Uint8Array(size);
    const horizontal = new Uint8Array(height * (width - 1));
    const vertical = new Uint8Array((height - 1) * width);
    for (const r of rectangles) {
      const left = xIndex.get(r.left),
        right = xIndex.get(r.right);
      const top = yIndex.get(r.top),
        bottom = yIndex.get(r.bottom);
      for (let y = top + 1; y < bottom; y++) {
        vertices.fill(1, y * width + left + 1, y * width + right);
        horizontal.fill(1, y * (width - 1) + left, y * (width - 1) + right);
      }
      for (let y = top; y < bottom; y++)
        vertical.fill(1, y * width + left + 1, y * width + right);
    }
    return {
      xs,
      ys,
      xIndex,
      yIndex,
      width,
      height,
      size,
      vertices,
      horizontal,
      vertical,
    };
  }

  function findRoute(start, end, grid, options) {
    if (!validPoint(start) || !validPoint(end))
      return blocked("invalid-endpoint");
    if (!grid) return blocked("grid-limit");
    const {
      xs,
      ys,
      xIndex,
      yIndex,
      width,
      height,
      size,
      vertices,
      horizontal,
      vertical,
    } = grid;
    const sx = xIndex.get(start.x),
      sy = yIndex.get(start.y);
    const ex = xIndex.get(end.x),
      ey = yIndex.get(end.y);
    const source = sy * width + sx,
      target = ey * width + ex;
    if (vertices[source] || vertices[target])
      return blocked("endpoint-inside-clearance");
    if (source === target) return resultFromPoints([start]);
    const startDirection = DIRECTIONS[options.startDirection] ?? 0;
    const endDirection = DIRECTIONS[options.endDirection] ?? 0;
    if (
      (options.startDirection && !startDirection) ||
      (options.endDirection && !endDirection)
    )
      return blocked("invalid-direction");
    const bendPenalty = options.bendPenalty ?? 24;
    if (!Number.isFinite(bendPenalty) || bendPenalty < 0)
      return blocked("invalid-bend-penalty");
    const overlapPenalty = options.overlapPenalty ?? 4;
    if (!Number.isFinite(overlapPenalty) || overlapPenalty < 0)
      return blocked("invalid-overlap-penalty");
    const lanes = occupiedLanes(options.usedSegments);
    const distances = new Float64Array(size * 3).fill(Infinity);
    const previous = new Int32Array(size * 3).fill(-1);
    const heap = new MinHeap();
    const firstState = source * 3;
    distances[firstState] = 0;
    heap.push({ state: firstState, cost: 0, priority: 0, heuristic: 0 });
    let iterations = 0;
    const limit = options.maxIterations ?? size * 12;
    while (heap.values.length) {
      if (++iterations > limit) return blocked("search-limit");
      const current = heap.pop();
      if (current.cost !== distances[current.state]) continue;
      const index = Math.floor(current.state / 3),
        orientation = current.state % 3;
      if (index === target) {
        const points = [];
        let state = current.state;
        while (state !== -1) {
          const point = Math.floor(state / 3);
          points.push({
            x: xs[point % width],
            y: ys[Math.floor(point / width)],
          });
          state = previous[state];
        }
        return resultFromPoints(points.reverse());
      }
      const x = index % width,
        y = Math.floor(index / width);
      // Fixed order resolves equivalent lanes consistently.
      const neighbors = [
        [x + 1, y, 2, x + 1 < width && !horizontal[y * (width - 1) + x]],
        [x, y + 1, 4, y + 1 < height && !vertical[y * width + x]],
        [x - 1, y, 1, x > 0 && !horizontal[y * (width - 1) + x - 1]],
        [x, y - 1, 3, y > 0 && !vertical[(y - 1) * width + x]],
      ];
      for (const [nx, ny, direction, available] of neighbors) {
        if (!available) continue;
        const next = ny * width + nx;
        if (vertices[next]) continue;
        if (index === source && startDirection && direction !== startDirection)
          continue;
        if (next === target && endDirection && direction !== endDirection)
          continue;
        const nextOrientation = direction <= 2 ? 1 : 2;
        const nextState = next * 3 + nextOrientation;
        const cost =
          current.cost +
          Math.abs(xs[nx] - xs[x]) +
          Math.abs(ys[ny] - ys[y]) +
          (orientation && orientation !== nextOrientation ? bendPenalty : 0) +
          laneCost(
            { x: xs[x], y: ys[y] },
            { x: xs[nx], y: ys[ny] },
            lanes,
            overlapPenalty,
          );
        if (cost >= distances[nextState]) continue;
        distances[nextState] = cost;
        previous[nextState] = current.state;
        const heuristic = Math.abs(xs[nx] - end.x) + Math.abs(ys[ny] - end.y);
        heap.push({
          state: nextState,
          cost,
          heuristic,
          priority: cost + heuristic,
        });
      }
    }
    return blocked("no-route");
  }

  function route(start, end, obstacles = [], options = {}) {
    if (!validPoint(start) || !validPoint(end))
      return blocked("invalid-endpoint");
    try {
      // Large source maps have many unrelated rectangles. Before constructing
      // their full visibility grid, try monotone routes with at most two bends.
      // Only an obstacle-free, unoccupied Manhattan route qualifies, so this
      // fast path cannot trade card clearance or lane separation for speed.
      if (obstacles.length > 64 && options.maxGridPoints === undefined &&
          options.maxIterations === undefined &&
          (options.bendPenalty === undefined || (Number.isFinite(options.bendPenalty) && options.bendPenalty >= 0)) &&
          (options.overlapPenalty === undefined || (Number.isFinite(options.overlapPenalty) && options.overlapPenalty >= 0)) &&
          (options.laneGap === undefined || (Number.isFinite(options.laneGap) && options.laneGap > 0)) &&
          (options.margin === undefined || (Number.isFinite(options.margin) && options.margin > 0))) {
        const padding = options.padding ?? 12;
        if (!Number.isFinite(padding) || padding < 0)
          throw new TypeError("Padding must be finite and non-negative.");
        const rectangles = obstacles.map((item) => rectangle(item, padding));
        const lanes = occupiedLanes(options.usedSegments);
        const direction = (a, b) => a.x === b.x
          ? (b.y > a.y ? "down" : "up") : (b.x > a.x ? "right" : "left");
        const candidates = [
          [start, { x: end.x, y: start.y }, end],
          [start, { x: start.x, y: end.y }, end],
        ];
        for (const fraction of [0.5, 0.25, 0.75]) {
          const x = start.x + (end.x - start.x) * fraction;
          const y = start.y + (end.y - start.y) * fraction;
          candidates.push([start, { x, y: start.y }, { x, y: end.y }, end]);
          candidates.push([start, { x: start.x, y }, { x: end.x, y }, end]);
        }
        for (const candidate of candidates) {
          const points = simplify(candidate);
          if (points.length < 2) continue;
          if (options.startDirection && direction(points[0], points[1]) !== options.startDirection) continue;
          if (options.endDirection && direction(points.at(-2), points.at(-1)) !== options.endDirection) continue;
          let clear = true;
          for (let i = 1; i < points.length && clear; i++)
            clear = laneCost(points[i - 1], points[i], lanes, 1) === 0 &&
              !rectangles.some((r) => intersectsInterior(points[i - 1], points[i], r));
          if (clear) return resultFromPoints(points);
        }
      }
      let sceneOptions = options,
        grid = createGrid([start, end], obstacles, sceneOptions);
      let laneFallback = false;
      // Independent lane offsets can exceed the visibility-grid budget in a
      // fully expanded graph. Preserve every obstacle and both port directions;
      // progressively retain only nearby occupied lanes. This relaxes visual
      // line separation, never card clearance, when the scene is very dense.
      if (!grid && options.usedSegments?.length) {
        const left = Math.min(start.x, end.x),
          right = Math.max(start.x, end.x);
        const top = Math.min(start.y, end.y),
          bottom = Math.max(start.y, end.y);
        const nearby = occupiedLanes(options.usedSegments)
          .valid.map((segment, index) => ({
            segment,
            index,
            distance:
              Math.max(
                0,
                left - Math.max(segment.a.x, segment.b.x),
                Math.min(segment.a.x, segment.b.x) - right,
              ) +
              Math.max(
                0,
                top - Math.max(segment.a.y, segment.b.y),
                Math.min(segment.a.y, segment.b.y) - bottom,
              ),
          }))
          .sort((a, b) => a.distance - b.distance || b.index - a.index);
        for (const count of [128, 64, 16, 0]) {
          if (count >= nearby.length) continue;
          sceneOptions = {
            ...options,
            usedSegments: nearby.slice(0, count).map((entry) => entry.segment),
          };
          grid = createGrid([start, end], obstacles, sceneOptions);
          laneFallback = true;
          if (grid) break;
        }
      }
      const result = findRoute(start, end, grid, sceneOptions);
      return laneFallback ? { ...result, laneFallback: true } : result;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      return blocked("invalid-obstacle-or-options");
    }
  }

  /** Batch routes share one grid. Per-request options may override direction,
   * bendPenalty, or maxIterations; padding and usedSegments are scene options.
   * End direction describes travel on arrival, e.g. right = arrives from left.
   */
  function routeAll(requests, obstacles = [], options = {}) {
    if (!Array.isArray(requests))
      throw new TypeError("Requests must be an array.");
    if (!requests.length) return [];
    const points = requests
      .flatMap((request) => [request.start, request.end])
      .filter(validPoint);
    if (!points.length) return requests.map(() => blocked("invalid-endpoint"));
    try {
      const grid = createGrid(points, obstacles, options);
      // A large union of unrelated endpoint coordinates must not make every
      // batch member fail when each individual route fits the same budget.
      if (!grid)
        return requests.map((request) =>
          route(request.start, request.end, obstacles, {
            ...options,
            ...request.options,
          }),
        );
      return requests.map((request) =>
        findRoute(request.start, request.end, grid, {
          ...options,
          ...request.options,
        }),
      );
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      return requests.map(() => blocked("invalid-obstacle-or-options"));
    }
  }

  root.CodeLoomOrthogonal = Object.freeze({
    route,
    routeAll,
    intersectsInterior,
    pathFromPoints,
  });
})(typeof window === "undefined" ? globalThis : window);
