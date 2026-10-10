/**
 * Pure drawing helpers for the canvas freehand tools and shape renderer.
 * No DOM, no React — all testable in Node.
 */

export type Point = [number, number];

// ——— stroke helpers ———

/**
 * Bounding box of a set of points, plus the points shifted to be relative to the box origin.
 * Used to store a finished stroke: the node's {x, y, width, height} comes from here,
 * and `points` in the node are relative so resizing just scales the viewBox.
 */
export function strokeBox(
  points: Point[],
  width: number,
): { x: number; y: number; width: number; height: number; relative: Point[] } {
  if (points.length === 0) return { x: 0, y: 0, width: 1, height: 1, relative: [] };
  const half = width / 2;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.floor(Math.min(...xs) - half);
  const y = Math.floor(Math.min(...ys) - half);
  const right = Math.ceil(Math.max(...xs) + half);
  const bottom = Math.ceil(Math.max(...ys) + half);
  return {
    x,
    y,
    width: Math.max(right - x, 1),
    height: Math.max(bottom - y, 1),
    relative: points.map((p) => [p[0] - x, p[1] - y]),
  };
}

/**
 * Build an SVG `d` string from a point list using quadratic Bézier curves through midpoints.
 * Produces a smooth stroke with no extra dependencies.
 */
export function smoothPath(points: Point[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const [x, y] = points[0]!;
    return `M ${x} ${y} L ${x + 0.01} ${y}`;
  }
  if (points.length === 2) {
    const [x0, y0] = points[0]!;
    const [x1, y1] = points[1]!;
    return `M ${x0} ${y0} L ${x1} ${y1}`;
  }
  const parts: string[] = [`M ${points[0]![0]} ${points[0]![1]}`];
  for (let i = 1; i < points.length - 1; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[i + 1]!;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    parts.push(`Q ${x1} ${y1} ${mx} ${my}`);
    // Last segment: go to the last point
    if (i === points.length - 2) parts.push(`L ${x2} ${y2}`);
  }
  return parts.join(" ");
}

/**
 * Remove points that are closer than `tolerance` px to their predecessor.
 * Keeps the first and last points.
 */
export function simplify(points: Point[], tolerance = 1.5): Point[] {
  if (points.length <= 2) return points;
  const out: Point[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1]!;
    const cur = points[i]!;
    const dx = cur[0] - prev[0];
    const dy = cur[1] - prev[1];
    if (Math.sqrt(dx * dx + dy * dy) >= tolerance) out.push(cur);
  }
  out.push(points[points.length - 1]!);
  return out;
}

/**
 * Returns true if `point` is within `radius` of any segment in the stroke point list.
 * Used by the eraser to decide which strokes to delete.
 */
export function hitsStroke(strokePoints: Point[], point: Point, radius: number): boolean {
  const r2 = radius * radius;
  for (let i = 0; i < strokePoints.length; i++) {
    const [ax, ay] = strokePoints[i]!;
    // Point-to-point distance
    const dx = point[0] - ax;
    const dy = point[1] - ay;
    if (dx * dx + dy * dy <= r2) return true;
    // Point-to-segment distance (segment i → i+1)
    if (i < strokePoints.length - 1) {
      const [bx, by] = strokePoints[i + 1]!;
      const segDx = bx - ax;
      const segDy = by - ay;
      const len2 = segDx * segDx + segDy * segDy;
      if (len2 > 0) {
        const t = Math.max(0, Math.min(1, ((point[0] - ax) * segDx + (point[1] - ay) * segDy) / len2));
        const px = ax + t * segDx - point[0];
        const py = ay + t * segDy - point[1];
        if (px * px + py * py <= r2) return true;
      }
    }
  }
  return false;
}

// ——— shape path builders ———
// Each returns an SVG `d` string fitting a (0,0)→(w,h) bounding box.

export function rectPath(w: number, h: number): string {
  return `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`;
}

export function ellipsePath(w: number, h: number): string {
  const rx = w / 2;
  const ry = h / 2;
  const cx = w / 2;
  const cy = h / 2;
  // Approximate a full ellipse with 4 cubic Bézier arcs
  const kx = rx * 0.5523;
  const ky = ry * 0.5523;
  return (
    `M ${cx} ${cy - ry}` +
    ` C ${cx + kx} ${cy - ry} ${cx + rx} ${cy - ky} ${cx + rx} ${cy}` +
    ` C ${cx + rx} ${cy + ky} ${cx + kx} ${cy + ry} ${cx} ${cy + ry}` +
    ` C ${cx - kx} ${cy + ry} ${cx - rx} ${cy + ky} ${cx - rx} ${cy}` +
    ` C ${cx - rx} ${cy - ky} ${cx - kx} ${cy - ry} ${cx} ${cy - ry} Z`
  );
}

export function diamondPath(w: number, h: number): string {
  const mx = w / 2;
  const my = h / 2;
  return `M ${mx} 0 L ${w} ${my} L ${mx} ${h} L 0 ${my} Z`;
}

export function trianglePath(w: number, h: number): string {
  return `M ${w / 2} 0 L ${w} ${h} L 0 ${h} Z`;
}

export function triangleDownPath(w: number, h: number): string {
  return `M 0 0 L ${w} 0 L ${w / 2} ${h} Z`;
}

export function pillPath(w: number, h: number): string {
  const r = Math.min(w, h) / 2;
  return `M ${r} 0 L ${w - r} 0 Q ${w} 0 ${w} ${r} L ${w} ${h - r} Q ${w} ${h} ${w - r} ${h} L ${r} ${h} Q 0 ${h} 0 ${h - r} L 0 ${r} Q 0 0 ${r} 0 Z`;
}

export function cylinderPath(w: number, h: number): string {
  const ry = h * 0.12;
  const rx = w / 2;
  const kx = rx * 0.5523;
  const ky = ry * 0.5523;
  const cx = w / 2;
  // Top ellipse
  const top =
    `M ${cx} ${ry}` +
    ` C ${cx + kx} ${ry} ${w} ${ry - ky} ${w} ${ry}` +
    ` C ${w} ${ry + ky} ${cx + kx} ${2 * ry} ${cx} ${2 * ry}` +
    ` C ${cx - kx} ${2 * ry} 0 ${ry + ky} 0 ${ry}` +
    ` C 0 ${ry - ky} ${cx - kx} 0 ${cx} 0 Z`;
  // Body + bottom ellipse
  const body =
    `M 0 ${ry} L 0 ${h - ry}` +
    ` C 0 ${h - ry + ky} ${cx - kx} ${h} ${cx} ${h}` +
    ` C ${cx + kx} ${h} ${w} ${h - ry + ky} ${w} ${h - ry}` +
    ` L ${w} ${ry}`;
  return top + " " + body;
}

// "More shapes" Basic set
export function pentagonPath(w: number, h: number): string {
  const pts = Array.from({ length: 5 }, (_, i) => {
    const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    return [(w / 2) * (1 + Math.cos(a)), (h / 2) * (1 + Math.sin(a))];
  });
  return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ") + " Z";
}

export function octagonPath(w: number, h: number): string {
  const s = Math.min(w, h) * 0.29;
  const pts = [
    [s, 0], [w - s, 0], [w, s], [w, h - s],
    [w - s, h], [s, h], [0, h - s], [0, s],
  ];
  return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ") + " Z";
}

export function crossPath(w: number, h: number): string {
  const t = w / 3;
  const u = h / 3;
  return `M ${t} 0 L ${2 * t} 0 L ${2 * t} ${u} L ${w} ${u} L ${w} ${2 * u} L ${2 * t} ${2 * u} L ${2 * t} ${h} L ${t} ${h} L ${t} ${2 * u} L 0 ${2 * u} L 0 ${u} L ${t} ${u} Z`;
}

export function arrowRightPath(w: number, h: number): string {
  const sh = h / 3;
  const py = h / 2;
  return `M 0 ${py - sh / 2} L ${w * 0.65} ${py - sh / 2} L ${w * 0.65} ${py - sh} L ${w} ${py} L ${w * 0.65} ${py + sh} L ${w * 0.65} ${py + sh / 2} L 0 ${py + sh / 2} Z`;
}

export function arrowLeftPath(w: number, h: number): string {
  const sh = h / 3;
  const py = h / 2;
  return `M ${w} ${py - sh / 2} L ${w * 0.35} ${py - sh / 2} L ${w * 0.35} ${py - sh} L 0 ${py} L ${w * 0.35} ${py + sh} L ${w * 0.35} ${py + sh / 2} L ${w} ${py + sh / 2} Z`;
}

export function chevronPath(w: number, h: number): string {
  const t = w / 5;
  return `M 0 0 L ${w - t} 0 L ${w} ${h / 2} L ${w - t} ${h} L 0 ${h} L ${t} ${h / 2} Z`;
}

export function starPath(w: number, h: number): string {
  const cx = w / 2;
  const cy = h / 2;
  const outer = Math.min(w, h) / 2;
  const inner = outer * 0.4;
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = (Math.PI * 2 * i) / 10 - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
  return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ") + " Z";
}

export function speechBubblePath(w: number, h: number): string {
  const r = 12;
  const tail = h * 0.22;
  const bh = h - tail;
  return (
    `M ${r} 0 L ${w - r} 0 Q ${w} 0 ${w} ${r}` +
    ` L ${w} ${bh - r} Q ${w} ${bh} ${w - r} ${bh}` +
    ` L ${w * 0.45} ${bh} L ${w * 0.25} ${h} L ${w * 0.35} ${bh}` +
    ` L ${r} ${bh} Q 0 ${bh} 0 ${bh - r}` +
    ` L 0 ${r} Q 0 0 ${r} 0 Z`
  );
}

/** All shape IDs in the drawer set (order matters: matches the UI). */
export const DRAWER_SHAPES = ["rect", "ellipse", "diamond", "triangle", "triangle-down", "pill", "cylinder"] as const;
/** All shape IDs in the More shapes Basic panel. */
export const MORE_SHAPES = ["pentagon", "octagon", "cross", "arrow-left", "arrow-right", "chevron", "star", "speech-bubble"] as const;

export type ShapeId = (typeof DRAWER_SHAPES)[number] | (typeof MORE_SHAPES)[number];

/** Human-readable names for tooltips and the More shapes search. */
export const SHAPE_NAMES: Record<ShapeId, string> = {
  rect: "Square",
  ellipse: "Ellipse",
  diamond: "Diamond",
  triangle: "Triangle",
  "triangle-down": "Triangle Down",
  pill: "Pill",
  cylinder: "Cylinder",
  pentagon: "Pentagon",
  octagon: "Octagon",
  cross: "Cross",
  "arrow-left": "Arrow Left",
  "arrow-right": "Arrow Right",
  chevron: "Chevron",
  star: "Star",
  "speech-bubble": "Speech Bubble",
};

/** Get the SVG `d` path for a named shape at the given size. */
export function shapePath(id: ShapeId, w: number, h: number): string {
  switch (id) {
    case "rect": return rectPath(w, h);
    case "ellipse": return ellipsePath(w, h);
    case "diamond": return diamondPath(w, h);
    case "triangle": return trianglePath(w, h);
    case "triangle-down": return triangleDownPath(w, h);
    case "pill": return pillPath(w, h);
    case "cylinder": return cylinderPath(w, h);
    case "pentagon": return pentagonPath(w, h);
    case "octagon": return octagonPath(w, h);
    case "cross": return crossPath(w, h);
    case "arrow-left": return arrowLeftPath(w, h);
    case "arrow-right": return arrowRightPath(w, h);
    case "chevron": return chevronPath(w, h);
    case "star": return starPath(w, h);
    case "speech-bubble": return speechBubblePath(w, h);
  }
}
