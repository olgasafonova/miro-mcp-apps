/**
 * Miro board-SVG UI. Receives BoardSvgResult — render primitives (rects,
 * ellipses, lines, labels) in Miro board coordinates plus a fitted viewBox —
 * and draws them as an inline SVG replica of the canvas with drag-to-pan and
 * scroll-to-zoom. Text and borders are in board units, so the render scales
 * exactly like the real Miro canvas: a minimap when fitted, readable when
 * zoomed. Everything is created via createElementNS and textContent — no
 * markup injection.
 */
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import "./global.css";
import "./board-svg.css";

interface SvgRect {
  id: string;
  itemType: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeWidth: number;
  strokeStyle: string;
}

interface SvgEllipse {
  id: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeWidth: number;
}

interface SvgLine {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface SvgLabel {
  x: number;
  y: number;
  lines: string[];
  fontSize: number;
  lineHeight: number;
  anchor: string;
  color: string;
}

interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BoardSvgResult {
  boardId: string;
  boardName: string;
  viewLink: string;
  viewBox: ViewBox;
  rects: SvgRect[];
  ellipses: SvgEllipse[];
  lines: SvgLine[];
  labels: SvgLabel[];
  rendered: number;
  skipped: number;
  totalItems: number;
  truncated: boolean;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const MIN_CANVAS_PX = 280;
const MAX_CANVAS_PX = 620;
const ZOOM_STEP = 1.15;
const MAX_ZOOM_IN = 40; // viewBox may shrink to 1/40 of the fitted width
const MAX_ZOOM_OUT = 3; // and grow to 3x of it

const appEl = document.getElementById("app")!;
const boardNameEl = document.getElementById("board-name")!;
const subtitleEl = document.getElementById("subtitle")!;
const svgEl = document.getElementById("canvas") as unknown as SVGSVGElement;
const countSummaryEl = document.getElementById("count-summary")!;
const fitBtn = document.getElementById("fit-btn") as HTMLButtonElement;
const openBoardBtn = document.getElementById(
  "open-board-btn",
) as HTMLButtonElement;

let currentData: BoardSvgResult | null = null;
let vb: ViewBox | null = null;

function isBoardSvgResult(
  sc: Partial<BoardSvgResult> | undefined,
): sc is BoardSvgResult {
  return Boolean(
    sc?.boardId &&
    sc.viewBox &&
    Array.isArray(sc.rects) &&
    Array.isArray(sc.ellipses) &&
    Array.isArray(sc.lines) &&
    Array.isArray(sc.labels),
  );
}

function extractData(result: CallToolResult): BoardSvgResult | null {
  const sc = result.structuredContent as Partial<BoardSvgResult> | undefined;
  return isBoardSvgResult(sc) ? sc : null;
}

function setAttrs(el: Element, attrs: Record<string, string | number>) {
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
}

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

function updateHeader(data: BoardSvgResult) {
  boardNameEl.textContent = data.boardName;
  subtitleEl.textContent =
    `${data.rendered} item${plural(data.rendered)} rendered` +
    (data.skipped > 0 ? ` · ${data.skipped} skipped (no geometry)` : "") +
    (data.lines.length > 0
      ? ` · ${data.lines.length} connector${plural(data.lines.length)}`
      : "") +
    " · drag to pan, scroll to zoom";
  countSummaryEl.textContent = data.truncated
    ? `Showing the first ${data.rendered} of ${data.totalItems} items.`
    : data.totalItems === 0
      ? "Board has no items."
      : `All ${data.totalItems} board item${plural(data.totalItems)} fetched.`;
  openBoardBtn.disabled = !data.viewLink;
  fitBtn.disabled = false;
}

/**
 * The canvas takes the board's own aspect ratio (clamped) instead of a fixed
 * height — a wide flat board in a fixed tall box letterboxes into two big
 * empty bands.
 */
function sizeCanvas(dataVb: ViewBox) {
  const width = svgEl.getBoundingClientRect().width || 688;
  const height = Math.min(
    MAX_CANVAS_PX,
    Math.max(MIN_CANVAS_PX, (width * dataVb.height) / dataVb.width),
  );
  svgEl.style.height = `${Math.round(height)}px`;
}

function applyViewBox() {
  svgEl.setAttribute("viewBox", `${vb!.x} ${vb!.y} ${vb!.width} ${vb!.height}`);
  svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
}

function appendEmptyText(box: ViewBox, message: string) {
  const text = document.createElementNS(SVG_NS, "text");
  setAttrs(text, {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    "text-anchor": "middle",
    class: "empty-text",
  });
  text.textContent = message;
  svgEl.appendChild(text);
}

// ---- Shape geometry ----
//
// Miro shape kinds mapped to polygon points in the item's own box. Kinds not
// listed fall back to a plain rectangle. Points are (fraction-of-w,
// fraction-of-h) pairs.
const SHAPE_POLYGONS: Record<string, Array<[number, number]>> = {
  triangle: [
    [0.5, 0],
    [1, 1],
    [0, 1],
  ],
  rhombus: [
    [0.5, 0],
    [1, 0.5],
    [0.5, 1],
    [0, 0.5],
  ],
  parallelogram: [
    [0.25, 0],
    [1, 0],
    [0.75, 1],
    [0, 1],
  ],
  trapezoid: [
    [0.2, 0],
    [0.8, 0],
    [1, 1],
    [0, 1],
  ],
  pentagon: [
    [0.5, 0],
    [1, 0.38],
    [0.81, 1],
    [0.19, 1],
    [0, 0.38],
  ],
  hexagon: [
    [0.25, 0],
    [0.75, 0],
    [1, 0.5],
    [0.75, 1],
    [0.25, 1],
    [0, 0.5],
  ],
  star: [
    [0.5, 0],
    [0.62, 0.35],
    [1, 0.38],
    [0.72, 0.62],
    [0.81, 1],
    [0.5, 0.78],
    [0.19, 1],
    [0.28, 0.62],
    [0, 0.38],
    [0.38, 0.35],
  ],
  right_arrow: [
    [0, 0.25],
    [0.6, 0.25],
    [0.6, 0],
    [1, 0.5],
    [0.6, 1],
    [0.6, 0.75],
    [0, 0.75],
  ],
  left_arrow: [
    [1, 0.25],
    [0.4, 0.25],
    [0.4, 0],
    [0, 0.5],
    [0.4, 1],
    [0.4, 0.75],
    [1, 0.75],
  ],
};

/** Cloud outline as a path in a unit box, scaled per shape. */
const CLOUD_PATH =
  "M 0.25 0.9 C 0.08 0.9 0 0.78 0 0.65 C 0 0.52 0.09 0.44 0.18 0.42 " +
  "C 0.18 0.26 0.3 0.12 0.48 0.12 C 0.62 0.12 0.72 0.2 0.77 0.32 " +
  "C 0.9 0.3 1 0.42 1 0.55 C 1 0.72 0.9 0.9 0.72 0.9 Z";

function strokeDash(style: string, width: number): string {
  if (style === "dashed") return `${width * 3} ${width * 2}`;
  if (style === "dotted") return `${width} ${width * 1.5}`;
  return "";
}

function paintAttrs(r: {
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeWidth: number;
}): Record<string, string | number> {
  const attrs: Record<string, string | number> = {
    fill: r.fill,
    stroke: r.stroke,
    "stroke-width": r.strokeWidth,
  };
  if (r.fillOpacity < 1) attrs["fill-opacity"] = r.fillOpacity;
  return attrs;
}

function appendRect(parent: SVGGElement, r: SvgRect) {
  const isFrame = r.itemType === "frame";
  let el: SVGElement;

  const polygon = SHAPE_POLYGONS[r.kind];
  if (polygon) {
    el = document.createElementNS(SVG_NS, "polygon");
    el.setAttribute(
      "points",
      polygon
        .map(([fx, fy]) => `${r.x + fx * r.width},${r.y + fy * r.height}`)
        .join(" "),
    );
  } else if (r.kind === "cloud") {
    el = document.createElementNS(SVG_NS, "path");
    el.setAttribute("d", CLOUD_PATH);
    el.setAttribute(
      "transform",
      `translate(${r.x} ${r.y}) scale(${r.width} ${r.height})`,
    );
    // The unit path is scaled non-uniformly; keep the stroke sane by
    // scaling it down inside the transformed space.
    el.setAttribute(
      "stroke-width",
      String(r.strokeWidth / Math.max(r.width, r.height)),
    );
  } else {
    el = document.createElementNS(SVG_NS, "rect");
    setAttrs(el, { x: r.x, y: r.y, width: r.width, height: r.height });
    if (r.kind === "round_rectangle" || r.itemType === "sticky_note") {
      el.setAttribute(
        "rx",
        String(Math.min(r.width, r.height) * (r.kind ? 0.12 : 0.04)),
      );
    } else if (r.itemType === "card" || r.itemType === "app_card") {
      el.setAttribute("rx", "8");
    }
  }

  const attrs = paintAttrs(r);
  if (r.kind === "cloud") delete attrs["stroke-width"];
  setAttrs(el, attrs);
  const dash = strokeDash(r.strokeStyle, r.strokeWidth);
  if (dash) el.setAttribute("stroke-dasharray", dash);
  if (isFrame) {
    el.setAttribute("class", "item-frame");
    // Frames keep a hairline outline at any zoom — like Miro's frame border.
    el.setAttribute("vector-effect", "non-scaling-stroke");
    el.setAttribute("stroke-width", "1");
  }
  el.setAttribute("data-miro-id", r.id);
  el.setAttribute("data-miro-type", r.itemType);
  parent.appendChild(el);

  if (r.itemType === "image") appendImageGlyph(parent, r);
}

/** Small mountains-and-sun glyph centered in an image placeholder. */
function appendImageGlyph(parent: SVGGElement, r: SvgRect) {
  const s = Math.min(r.width, r.height) * 0.4;
  const gx = r.x + r.width / 2 - s / 2;
  const gy = r.y + r.height / 2 - s / 2;
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "image-glyph");

  const sun = document.createElementNS(SVG_NS, "circle");
  setAttrs(sun, { cx: gx + s * 0.7, cy: gy + s * 0.28, r: s * 0.12 });

  const mountains = document.createElementNS(SVG_NS, "path");
  mountains.setAttribute(
    "d",
    `M ${gx} ${gy + s} L ${gx + s * 0.35} ${gy + s * 0.45} ` +
      `L ${gx + s * 0.55} ${gy + s * 0.72} L ${gx + s * 0.75} ${gy + s * 0.5} ` +
      `L ${gx + s} ${gy + s} Z`,
  );

  g.append(sun, mountains);
  parent.appendChild(g);
}

function appendEllipse(parent: SVGGElement, e: SvgEllipse) {
  const ellipse = document.createElementNS(SVG_NS, "ellipse");
  setAttrs(ellipse, {
    cx: e.cx,
    cy: e.cy,
    rx: e.rx,
    ry: e.ry,
    ...paintAttrs(e),
    "data-miro-id": e.id,
    "data-miro-type": "shape",
  });
  parent.appendChild(ellipse);
}

function appendLine(parent: SVGGElement, l: SvgLine) {
  const line = document.createElementNS(SVG_NS, "line");
  setAttrs(line, {
    x1: l.x1,
    y1: l.y1,
    x2: l.x2,
    y2: l.y2,
    class: "connector-line",
    "marker-end": "url(#arrow)",
    "data-miro-id": l.id,
    "data-miro-type": "connector",
  });
  parent.appendChild(line);
}

/** Arrowhead marker sized in board units so it scales with the canvas. */
function appendArrowMarker(parent: SVGGElement, boardWidth: number) {
  const size = Math.max(8, boardWidth * 0.004);
  const defs = document.createElementNS(SVG_NS, "defs");
  const marker = document.createElementNS(SVG_NS, "marker");
  setAttrs(marker, {
    id: "arrow",
    viewBox: "0 0 10 10",
    refX: 9,
    refY: 5,
    markerWidth: size,
    markerHeight: size,
    markerUnits: "userSpaceOnUse",
    orient: "auto-start-reverse",
  });
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
  path.setAttribute("class", "arrowhead");
  marker.appendChild(path);
  defs.appendChild(marker);
  parent.appendChild(defs);
}

function appendLabel(parent: SVGGElement, l: SvgLabel) {
  const text = document.createElementNS(SVG_NS, "text");
  setAttrs(text, {
    "text-anchor": l.anchor,
    "font-size": l.fontSize,
    fill: l.color,
    class: "item-label",
  });
  const n = l.lines.length;
  const firstY = l.y - ((n - 1) / 2) * l.lineHeight + l.fontSize * 0.35;
  l.lines.forEach((lineText, i) => {
    const tspan = document.createElementNS(SVG_NS, "tspan");
    setAttrs(tspan, { x: l.x, y: firstY + i * l.lineHeight });
    tspan.textContent = lineText;
    text.appendChild(tspan);
  });
  parent.appendChild(text);
}

function render(data: BoardSvgResult) {
  currentData = data;
  vb = { ...data.viewBox };
  updateHeader(data);

  while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
  sizeCanvas(data.viewBox);
  applyViewBox();

  if (data.rendered === 0 && data.lines.length === 0) {
    appendEmptyText(data.viewBox, "No renderable items on this board.");
    return;
  }

  const layer = document.createElementNS(SVG_NS, "g");
  svgEl.appendChild(layer);
  appendArrowMarker(layer, data.viewBox.width);

  // Draw order: rects arrive frames-first from the builder, so frames sit
  // under everything; connectors go above shapes, labels on top.
  for (const r of data.rects) appendRect(layer, r);
  for (const e of data.ellipses) appendEllipse(layer, e);
  for (const l of data.lines) appendLine(layer, l);
  for (const l of data.labels) appendLabel(layer, l);
}

// ---- Pan and zoom ----

function pointerToBoard(evt: { clientX: number; clientY: number }): {
  bx: number;
  by: number;
} {
  const box = svgEl.getBoundingClientRect();
  return {
    bx: vb!.x + ((evt.clientX - box.left) / box.width) * vb!.width,
    by: vb!.y + ((evt.clientY - box.top) / box.height) * vb!.height,
  };
}

svgEl.addEventListener(
  "wheel",
  (e: WheelEvent) => {
    if (!vb || !currentData) return;
    e.preventDefault();
    const factor = e.deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    const fitted = currentData.viewBox;
    const newW = vb.width * factor;
    if (newW < fitted.width / MAX_ZOOM_IN || newW > fitted.width * MAX_ZOOM_OUT)
      return;
    const { bx, by } = pointerToBoard(e);
    // Keep the board point under the cursor fixed while scaling.
    vb.x = bx - (bx - vb.x) * factor;
    vb.y = by - (by - vb.y) * factor;
    vb.width *= factor;
    vb.height *= factor;
    applyViewBox();
  },
  { passive: false },
);

let panning = false;
let lastPx = { x: 0, y: 0 };

svgEl.addEventListener("pointerdown", (e: PointerEvent) => {
  if (!vb) return;
  panning = true;
  lastPx = { x: e.clientX, y: e.clientY };
  svgEl.setPointerCapture(e.pointerId);
  svgEl.classList.add("panning");
});

svgEl.addEventListener("pointermove", (e: PointerEvent) => {
  if (!panning || !vb) return;
  const box = svgEl.getBoundingClientRect();
  vb.x -= ((e.clientX - lastPx.x) / box.width) * vb.width;
  vb.y -= ((e.clientY - lastPx.y) / box.height) * vb.height;
  lastPx = { x: e.clientX, y: e.clientY };
  applyViewBox();
});

svgEl.addEventListener("pointerup", (e: PointerEvent) => {
  panning = false;
  svgEl.releasePointerCapture(e.pointerId);
  svgEl.classList.remove("panning");
});

fitBtn.addEventListener("click", () => {
  if (!currentData) return;
  vb = { ...currentData.viewBox };
  applyViewBox();
});

// ---- Errors, host context, wiring ----

function renderError(message: string) {
  appEl.replaceChildren();
  const errEl = document.createElement("div");
  errEl.className = "error";
  errEl.textContent = message;
  appEl.appendChild(errEl);
}

function handleHostContextChanged(ctx: McpUiHostContext) {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  if (ctx.safeAreaInsets) {
    appEl.style.paddingTop = `${ctx.safeAreaInsets.top}px`;
    appEl.style.paddingRight = `${ctx.safeAreaInsets.right}px`;
    appEl.style.paddingBottom = `${ctx.safeAreaInsets.bottom}px`;
    appEl.style.paddingLeft = `${ctx.safeAreaInsets.left}px`;
  }
}

const app = new App({ name: "Miro Board SVG", version: "0.1.0" });

app.ontoolresult = (result) => {
  const data = extractData(result);
  if (!data) {
    renderError("Server returned no board render data.");
    return;
  }
  render(data);
};

app.onerror = (e) => {
  console.error(e);
  renderError(`Error: ${String(e)}`);
};

app.onhostcontextchanged = handleHostContextChanged;

openBoardBtn.addEventListener("click", async () => {
  if (!currentData?.viewLink) return;
  try {
    await app.openLink({ url: currentData.viewLink });
  } catch (e) {
    console.error("Open link failed:", e);
  }
});

app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) handleHostContextChanged(ctx);
});
