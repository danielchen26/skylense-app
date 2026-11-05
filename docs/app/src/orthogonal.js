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

  /* Search frontier in typed arrays, one slot per heap position. Ordering by
   * (priority, heuristic, push sequence) is total, so the pop order does not
   * depend on the heap's internal layout. pop() leaves the minimum in
   * topState/topCost.
   *
   * A* mostly walks straight towards the target: a quarter of all pushes are
   * smaller than everything queued and are popped next. Such an entry is held
   * outside the heap instead of being sifted to the root and straight back.
   * A newer push never wins a full tie, so only priority and heuristic decide
   * whether it undercuts the held entry or the root.
   */
  class StateHeap {
    constructor() {
      this.priority = new Float64Array(1024);
      this.heuristic = new Float64Array(1024);
      this.sequence = new Int32Array(1024);
      this.state = new Int32Array(1024);
      this.cost = new Float64Array(1024);
      this.count = 0;
      this.length = 0;
      this.pushes = 0;
      this.held = false;
      this.heldPriority = 0;
      this.heldHeuristic = 0;
      this.heldSequence = 0;
      this.heldState = 0;
      this.heldCost = 0;
      this.topState = -1;
      this.topCost = 0;
    }
    reset() {
      this.count = 0;
      this.length = 0;
      this.pushes = 0;
      this.held = false;
    }
    push(state, cost, heuristic, priority) {
      const sequence = this.pushes++;
      this.length++;
      if (this.held) {
        if (
          priority < this.heldPriority ||
          (priority === this.heldPriority && heuristic < this.heldHeuristic)
        ) {
          this.insert(
            this.heldState,
            this.heldCost,
            this.heldHeuristic,
            this.heldPriority,
            this.heldSequence,
          );
          this.hold(state, cost, heuristic, priority, sequence);
        } else this.insert(state, cost, heuristic, priority, sequence);
      } else if (
        !this.count ||
        priority < this.priority[0] ||
        (priority === this.priority[0] && heuristic < this.heuristic[0])
      )
        this.hold(state, cost, heuristic, priority, sequence);
      else this.insert(state, cost, heuristic, priority, sequence);
    }
    hold(state, cost, heuristic, priority, sequence) {
      this.held = true;
      this.heldState = state;
      this.heldCost = cost;
      this.heldHeuristic = heuristic;
      this.heldPriority = priority;
      this.heldSequence = sequence;
    }
    grow() {
      for (const key of ["priority", "heuristic", "sequence", "state", "cost"]) {
        const larger = new this[key].constructor(this[key].length * 2);
        larger.set(this[key]);
        this[key] = larger;
      }
    }
    insert(state, cost, heuristic, priority, sequence) {
      if (this.count === this.state.length) this.grow();
      const priorities = this.priority,
        heuristics = this.heuristic,
        sequences = this.sequence,
        states = this.state,
        costs = this.cost;
      let index = this.count++;
      while (index > 0) {
        const parent = (index - 1) >> 1;
        const p = priorities[parent];
        if (
          !(
            priority < p ||
            (priority === p &&
              (heuristic < heuristics[parent] ||
                (heuristic === heuristics[parent] &&
                  sequence < sequences[parent])))
          )
        )
          break;
        priorities[index] = p;
        heuristics[index] = heuristics[parent];
        sequences[index] = sequences[parent];
        states[index] = states[parent];
        costs[index] = costs[parent];
        index = parent;
      }
      priorities[index] = priority;
      heuristics[index] = heuristic;
      sequences[index] = sequence;
      states[index] = state;
      costs[index] = cost;
    }
    pop() {
      this.length--;
      if (this.held) {
        this.held = false;
        this.topState = this.heldState;
        this.topCost = this.heldCost;
        return;
      }
      const priorities = this.priority,
        heuristics = this.heuristic,
        sequences = this.sequence,
        states = this.state,
        costs = this.cost;
      this.topState = states[0];
      this.topCost = costs[0];
      const length = --this.count;
      if (!length) return;
      const priority = priorities[length],
        heuristic = heuristics[length],
        sequence = sequences[length],
        state = states[length],
        cost = costs[length];
      let index = 0;
      while (index * 2 + 1 < length) {
        let child = index * 2 + 1;
        const right = child + 1;
        if (
          right < length &&
          (priorities[right] < priorities[child] ||
            (priorities[right] === priorities[child] &&
              (heuristics[right] < heuristics[child] ||
                (heuristics[right] === heuristics[child] &&
                  sequences[right] < sequences[child]))))
        )
          child = right;
        const p = priorities[child];
        if (
          !(
            p < priority ||
            (p === priority &&
              (heuristics[child] < heuristic ||
                (heuristics[child] === heuristic &&
                  sequences[child] < sequence)))
          )
        )
          break;
        priorities[index] = p;
        heuristics[index] = heuristics[child];
        sequences[index] = sequences[child];
        states[index] = states[child];
        costs[index] = costs[child];
        index = child;
      }
      priorities[index] = priority;
      heuristics[index] = heuristic;
      sequences[index] = sequence;
      states[index] = state;
      costs[index] = cost;
    }
  }

  /* Search buffers shared by every findRoute call. A grid of a few hundred
   * thousand states makes fresh per-route arrays cost more in allocation and
   * page faults than the search itself; routing is synchronous, so one set
   * of buffers, grown to the largest grid seen, serves every request.
   */
  const search = {
    heap: new StateHeap(),
    distances: new Float64Array(0),
    previous: new Int32Array(0),
  };
  function searchBuffers(states) {
    if (search.distances.length < states) {
      let length = 1024;
      while (length < states) length *= 2;
      search.distances = new Float64Array(length);
      search.previous = new Int32Array(length);
    } else search.distances.fill(0, 0, states);
    search.heap.reset();
    return search;
  }

  /** One grid axis: the distinct coordinates in ascending order, framed by
   * one margin line below the lowest and one above the highest. A frame line
   * that rounds onto an existing coordinate is that coordinate. */
  function sortedAxis(values, margin) {
    const sorted = Float64Array.from(values).sort(),
      low = sorted[0] - margin,
      high = sorted[sorted.length - 1] + margin;
    const first = low === sorted[0] ? 0 : 1,
      axis = new Float64Array(sorted.length + first + (high === sorted[sorted.length - 1] ? 0 : 1));
    if (first) axis[0] = low;
    axis.set(sorted, first);
    if (axis.length > sorted.length + first) axis[axis.length - 1] = high;
    return axis;
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
    const xs = sortedAxis(xSet, margin),
      ys = sortedAxis(ySet, margin);
    const width = xs.length,
      height = ys.length,
      size = width * height;
    // Sorted axes: finite ends mean every grid line is finite. A line that
    // overflowed to ±Infinity would make step and lane terms NaN, so such
    // inputs are refused rather than routed.
    if (
      !Number.isFinite(xs[0]) ||
      !Number.isFinite(xs[width - 1]) ||
      !Number.isFinite(ys[0]) ||
      !Number.isFinite(ys[height - 1])
    )
      throw new TypeError("Grid coordinates must stay finite.");
    if (size > (options.maxGridPoints ?? 200000)) return null;
    const xIndex = new Map(),
      yIndex = new Map();
    for (let i = 0; i < width; i++) xIndex.set(xs[i], i);
    for (let i = 0; i < height; i++) yIndex.set(ys[i], i);
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
    const grid = {
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
      // The lanes this grid was built from; findRoute reuses their edge
      // lengths when a request routes against the same usedSegments array.
      usedSegments: options.usedSegments,
    };
    grid.laneLengths = laneLengths(lanes, grid);
    return grid;
  }

  /* Occupied-lane length of every grid edge. For rows, lengths[offsets[y] + x]
   * is the edge from (xs[x], ys[y]) rightwards; for columns,
   * lengths[offsets[x] + y] the edge from (xs[x], ys[y]) downwards. An axis
   * no lane runs along has offset -1. Equals laneCost(a, b, lanes, 1) for
   * that edge. A span whose ends are grid coordinates covers whole edges, so
   * adding each covered edge's length in span order reproduces laneCost's
   * sum term for term (every other span contributes exactly 0). All axes
   * share one buffer: a few hundred small typed arrays per grid cost more to
   * allocate than filling them.
   */
  function laneLengths(lanes, { xs, ys, xIndex, yIndex }) {
    const along = (spansByAxis, axes, values, index, edge) => {
      const stride = values.length - 1,
        offsets = new Int32Array(axes.length).fill(-1);
      let used = 0;
      for (let i = 0; i < axes.length; i++)
        if (spansByAxis.has(axes[i])) offsets[i] = stride * used++;
      const lengths = new Float64Array(stride * used);
      for (let i = 0; i < axes.length; i++) {
        const base = offsets[i];
        if (base < 0) continue;
        const axis = axes[i],
          spans = spansByAxis.get(axis);
        if (spans.every(([from, to]) => index.has(from) && index.has(to))) {
          for (const [from, to] of spans)
            for (let k = index.get(from), last = index.get(to); k < last; k++)
              lengths[base + k] += values[k + 1] - values[k];
        } else {
          for (let k = 0; k < stride; k++)
            lengths[base + k] = laneCost(...edge(axis, values[k], values[k + 1]), lanes, 1);
        }
      }
      return { offsets, lengths };
    };
    return {
      rows: along(lanes.horizontal, ys, xs, xIndex, (y, a, b) => [{ x: a, y }, { x: b, y }]),
      columns: along(lanes.vertical, xs, ys, yIndex, (x, a, b) => [{ x, y: a }, { x, y: b }]),
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
    const { rows, columns } =
      options.usedSegments === grid.usedSegments
        ? grid.laneLengths
        : laneLengths(occupiedLanes(options.usedSegments), grid);
    const rowLanes = rows.lengths,
      columnLanes = columns.lengths;
    // Unreached states hold distance 0 instead of Infinity: grid coordinates
    // are distinct, so every step costs more than 0 and only the first state
    // is genuinely at 0. Only distances needs clearing; previous is only
    // read along reached states, each written in this search.
    const { distances, previous, heap } = searchBuffers(size * 3);
    // Per-axis terms, precomputed once. Each equals what the textbook form
    // computes per step: |xs[x±1] - xs[x]| is the gap stepX (IEEE subtraction
    // is exactly antisymmetric), and terms that are exactly 0 (the other
    // axis, no bend, no lane) leave a sum unchanged, so they are skipped.
    const stepX = new Float64Array(width),
      stepY = new Float64Array(height),
      toEndX = new Float64Array(width),
      toEndY = new Float64Array(height);
    for (let i = 0; i < width; i++) {
      if (i + 1 < width) stepX[i] = xs[i + 1] - xs[i];
      toEndX[i] = Math.abs(xs[i] - end.x);
    }
    for (let i = 0; i < height; i++) {
      if (i + 1 < height) stepY[i] = ys[i + 1] - ys[i];
      toEndY[i] = Math.abs(ys[i] - end.y);
    }
    const rowStride = width - 1;
    const firstState = source * 3;
    previous[firstState] = -1;
    heap.push(firstState, 0, 0, 0);
    let iterations = 0;
    const limit = options.maxIterations ?? size * 12;
    // One relaxation. The fixed neighbour order below (right, down, left, up)
    // resolves equivalent lanes consistently, because push order breaks ties.
    const relax = (currentState, cost, nextState, nx, ny) => {
      const known = distances[nextState];
      if (known && cost >= known) return;
      distances[nextState] = cost;
      previous[nextState] = currentState;
      const heuristic = toEndX[nx] + toEndY[ny];
      heap.push(nextState, cost, heuristic, cost + heuristic);
    };
    while (heap.length) {
      if (++iterations > limit) return blocked("search-limit");
      heap.pop();
      const currentState = heap.topState,
        currentCost = heap.topCost;
      if (currentCost !== distances[currentState]) continue;
      const index = (currentState / 3) | 0,
        orientation = currentState - index * 3;
      if (index === target) {
        const points = [];
        let state = currentState;
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
        y = (index - x) / width;
      const only = index === source ? startDirection : 0;
      // Orientation 1 is horizontal travel, 2 vertical, 0 the start.
      const turnX = orientation === 2 ? bendPenalty : 0,
        turnY = orientation === 1 ? bendPenalty : 0;
      const row = overlapPenalty ? rows.offsets[y] : -1,
        column = overlapPenalty ? columns.offsets[x] : -1;
      if ((!only || only === 2) && x + 1 < width && !horizontal[y * rowStride + x]) {
        const next = index + 1;
        if (!vertices[next] && (next !== target || !endDirection || endDirection === 2)) {
          let cost = currentCost + stepX[x];
          if (turnX) cost += turnX;
          const lane = row < 0 ? 0 : rowLanes[row + x];
          if (lane) cost += lane * overlapPenalty;
          relax(currentState, cost, next * 3 + 1, x + 1, y);
        }
      }
      if ((!only || only === 4) && y + 1 < height && !vertical[index]) {
        const next = index + width;
        if (!vertices[next] && (next !== target || !endDirection || endDirection === 4)) {
          let cost = currentCost + stepY[y];
          if (turnY) cost += turnY;
          const lane = column < 0 ? 0 : columnLanes[column + y];
          if (lane) cost += lane * overlapPenalty;
          relax(currentState, cost, next * 3 + 2, x, y + 1);
        }
      }
      if ((!only || only === 1) && x > 0 && !horizontal[y * rowStride + x - 1]) {
        const next = index - 1;
        if (!vertices[next] && (next !== target || !endDirection || endDirection === 1)) {
          let cost = currentCost + stepX[x - 1];
          if (turnX) cost += turnX;
          const lane = row < 0 ? 0 : rowLanes[row + x - 1];
          if (lane) cost += lane * overlapPenalty;
          relax(currentState, cost, next * 3 + 1, x - 1, y);
        }
      }
      if ((!only || only === 3) && y > 0 && !vertical[index - width]) {
        const next = index - width;
        if (!vertices[next] && (next !== target || !endDirection || endDirection === 3)) {
          let cost = currentCost + stepY[y - 1];
          if (turnY) cost += turnY;
          const lane = column < 0 ? 0 : columnLanes[column + y - 1];
          if (lane) cost += lane * overlapPenalty;
          relax(currentState, cost, next * 3 + 2, x, y - 1);
        }
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
