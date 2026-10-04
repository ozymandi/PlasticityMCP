/**
 * Turns hidden-line projections from Plasticity into an SVG drawing in millimetres.
 *
 * Plasticity's own SVG writer needs its export dialog, so only its projection generator is
 * used. For each view it returns a flat number array plus segments that index into it. A
 * segment has a category such as "Edge-Visible-NotSmooth-Silhouette" or "Edge-Hidden-NotSmooth"
 * and one of three encodings (coordinates are pixels of the render target: origin top-left,
 * y grows downward — the same handedness as SVG):
 *
 *   3006 polyline        `count` points: x, y, x, y, …
 *   3005 ellipse         5 numbers: cx, cy, rx, ry, rotation (radians)
 *   3004 elliptical arc  11 numbers: cx, cy, rx, ry, rotation, startX, startY, endX, endY,
 *                        sweep flag, large-arc flag (the flags as in an SVG path "A" command)
 */

export interface ProjectedSegment {
  category: string;
  type: number;
  offset: number;
  count: number;
}

export interface ProjectedView {
  view: string;
  positions: number[];
  segments: ProjectedSegment[];
  mmPerPixel: number;
}

export interface DrawingViewInfo {
  view: string;
  sizeMm: [number, number];
  visibleLines: number;
  hiddenLines: number;
}

export interface Drawing {
  svg: string;
  widthMm: number;
  heightMm: number;
  views: DrawingViewInfo[];
}

const POLYLINE = 3006;
const ELLIPSE = 3005;
const ARC = 3004;

const MARGIN_MM = 5;
const GAP_MM = 10;
/** Sampling step used only to measure curved elements. */
const SAMPLE_STEP = Math.PI / 36;

type Point = [number, number];

interface Element {
  hidden: boolean;
  /** SVG element without its class attribute, in view-local millimetres. */
  markup: (className: string) => string;
  /** Points that bound the element. */
  extent: Point[];
}

const isHidden = (segment: ProjectedSegment): boolean => segment.category.includes("Hidden");
const fixed = (value: number): string => (Math.round(value * 1e4) / 1e4 + 0).toString();
const degrees = (radians: number): string => fixed((radians * 180) / Math.PI);

/** Point of an ellipse at parameter `t`. */
function onEllipse(cx: number, cy: number, rx: number, ry: number, rotation: number, t: number): Point {
  const x = rx * Math.cos(t);
  const y = ry * Math.sin(t);
  return [
    cx + x * Math.cos(rotation) - y * Math.sin(rotation),
    cy + x * Math.sin(rotation) + y * Math.cos(rotation),
  ];
}

/** Parameter of the ellipse point nearest to `p` (exact when `p` lies on the ellipse). */
function parameterOf(cx: number, cy: number, rx: number, ry: number, rotation: number, p: Point): number {
  const dx = p[0] - cx;
  const dy = p[1] - cy;
  const x = dx * Math.cos(rotation) + dy * Math.sin(rotation);
  const y = -dx * Math.sin(rotation) + dy * Math.cos(rotation);
  return Math.atan2(y / ry, x / rx);
}

function toElement(projection: ProjectedView, segment: ProjectedSegment): Element {
  const k = projection.mmPerPixel;
  const d = projection.positions;
  const o = segment.offset;
  const hidden = isHidden(segment);

  if (segment.type === POLYLINE) {
    const points: Point[] = [];
    for (let i = 0; i < segment.count; i++) points.push([d[o + i * 2]! * k, d[o + i * 2 + 1]! * k]);
    return {
      hidden,
      extent: points,
      markup: (c) =>
        `<polyline class="${c}" points="${points.map(([x, y]) => `${fixed(x)},${fixed(y)}`).join(" ")}"/>`,
    };
  }

  const cx = d[o]! * k;
  const cy = d[o + 1]! * k;
  const rx = d[o + 2]! * k;
  const ry = d[o + 3]! * k;
  const rotation = d[o + 4]!;

  if (segment.type === ELLIPSE) {
    const extent: Point[] = [];
    for (let t = 0; t < 2 * Math.PI; t += SAMPLE_STEP) extent.push(onEllipse(cx, cy, rx, ry, rotation, t));
    const turn = Math.abs(rx - ry) < 1e-9 || Math.abs(rotation) < 1e-9
      ? ""
      : ` transform="rotate(${degrees(rotation)} ${fixed(cx)} ${fixed(cy)})"`;
    return {
      hidden,
      extent,
      markup: (c) =>
        `<ellipse class="${c}" cx="${fixed(cx)}" cy="${fixed(cy)}" rx="${fixed(rx)}" ry="${fixed(ry)}"${turn}/>`,
    };
  }

  if (segment.type === ARC) {
    const start: Point = [d[o + 5]! * k, d[o + 6]! * k];
    const end: Point = [d[o + 7]! * k, d[o + 8]! * k];
    const sweep = d[o + 9]! ? 1 : 0;
    const large = d[o + 10]! ? 1 : 0;
    const from = parameterOf(cx, cy, rx, ry, rotation, start);
    let span = parameterOf(cx, cy, rx, ry, rotation, end) - from;
    // With y pointing down, the SVG sweep flag means increasing parameter.
    if (sweep && span <= 0) span += 2 * Math.PI;
    if (!sweep && span >= 0) span -= 2 * Math.PI;
    const extent: Point[] = [start, end];
    const steps = Math.max(1, Math.ceil(Math.abs(span) / SAMPLE_STEP));
    for (let i = 1; i < steps; i++) {
      extent.push(onEllipse(cx, cy, rx, ry, rotation, from + (span * i) / steps));
    }
    return {
      hidden,
      extent,
      markup: (c) =>
        `<path class="${c}" d="M ${fixed(start[0])} ${fixed(start[1])} A ${fixed(rx)} ${fixed(ry)} ` +
        `${degrees(rotation)} ${large} ${sweep} ${fixed(end[0])} ${fixed(end[1])}"/>`,
    };
  }

  throw new Error(`Plasticity returned a projected geometry type this exporter does not know: ${segment.type}`);
}

/** Lay the views out left to right on a common baseline. */
export function buildDrawing(projections: ProjectedView[], hiddenLines: boolean): Drawing {
  const laidOut = projections.map((projection) => {
    const elements = projection.segments
      .filter((segment) => hiddenLines || !isHidden(segment))
      .map((segment) => toElement(projection, segment));
    const extent = elements.flatMap((element) => element.extent);
    if (extent.length === 0) throw new Error(`The ${projection.view} view has no lines to draw`);
    const minX = Math.min(...extent.map((p) => p[0]));
    const minY = Math.min(...extent.map((p) => p[1]));
    return {
      view: projection.view,
      elements,
      minX,
      minY,
      width: Math.max(...extent.map((p) => p[0])) - minX,
      height: Math.max(...extent.map((p) => p[1])) - minY,
    };
  });

  const heightMm = Math.max(...laidOut.map((v) => v.height)) + 2 * MARGIN_MM;
  let cursor = MARGIN_MM;
  const groups: string[] = [];
  const views: DrawingViewInfo[] = [];
  for (const view of laidOut) {
    const dx = cursor - view.minX;
    const dy = heightMm - MARGIN_MM - view.height - view.minY;
    const lines = view.elements.map((e) => `    ${e.markup(e.hidden ? "hidden" : "visible")}`);
    groups.push(
      `  <g id="view-${view.view}" transform="translate(${fixed(dx)} ${fixed(dy)})">\n` +
        `    <title>${view.view}</title>\n${lines.join("\n")}\n  </g>`,
    );
    views.push({
      view: view.view,
      sizeMm: [Number(fixed(view.width)), Number(fixed(view.height))],
      visibleLines: view.elements.filter((e) => !e.hidden).length,
      hiddenLines: view.elements.filter((e) => e.hidden).length,
    });
    cursor += view.width + GAP_MM;
  }
  const widthMm = cursor - GAP_MM + MARGIN_MM;

  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fixed(widthMm)}mm" height="${fixed(heightMm)}mm" viewBox="0 0 ${fixed(widthMm)} ${fixed(heightMm)}">`,
    `  <style>`,
    `    polyline, path, ellipse { fill: none; stroke-linecap: round; stroke-linejoin: round; }`,
    `    .visible { stroke: #000; stroke-width: 0.35; }`,
    `    .hidden { stroke: #555; stroke-width: 0.18; stroke-dasharray: 2 1; }`,
    `  </style>`,
    ...groups,
    `</svg>`,
    ``,
  ].join("\n");
  return { svg, widthMm: Number(fixed(widthMm)), heightMm: Number(fixed(heightMm)), views };
}
