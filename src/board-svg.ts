/**
 * Miro board-SVG UI. Receives BoardSvgResult — render primitives (rects,
 * ellipses, lines, labels) in Miro board coordinates plus a fitted viewBox —
 * and draws them as an inline SVG spatial map with drag-to-pan and
 * scroll-to-zoom. The geometry was computed server-side (TS port of the Go
 * server's svg_read.go); this file only turns primitives into DOM nodes.
 * Everything is created via createElementNS and textContent — no markup
 * injection.
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
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
  fill: string;
  dashed: boolean;
}

interface SvgEllipse {
  id: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  fill: string;
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
  text: string;
  fontSize: number;
  anchor: string;
  muted: boolean;
  maxWidth: number;
  onFill: boolean;
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
const MAX_ZOOM_IN = 20; // viewBox may shrink to 1/20 of the fitted width
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
let staticLayer: SVGGElement | null = null;
let dynamicLayer: SVGGElement | null = null;
let dynamicRedraw: number | null = null;

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

/** How many board units one CSS pixel covers at the current viewBox. */
function unitsPerPixel(): number {
  const box = svgEl.getBoundingClientRect();
  const pxW = box.width || 688;
  const pxH = box.height || 440;
  return Math.max(vb!.width / pxW, vb!.height / pxH, 0.0001);
}

/**
 * The canvas takes the board's own aspect ratio (clamped) instead of a fixed
 * height — a wide flat board in a fixed tall box letterboxes into two big
 * empty bands, which is most of what made the first Desktop render ugly.
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
  if (dynamicRedraw === null) {
    dynamicRedraw = requestAnimationFrame(() => {
      dynamicRedraw = null;
      renderDynamicLayer();
    });
  }
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

function appendRect(parent: SVGGElement, r: SvgRect) {
  const rect = document.createElementNS(SVG_NS, "rect");
  setAttrs(rect, {
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    fill: r.fill,
    class: r.dashed ? "item-frame" : "item-rect",
    "data-miro-id": r.id,
    "data-miro-type": r.itemType,
  });
  if (r.rx > 0) rect.setAttribute("rx", String(r.rx));
  parent.appendChild(rect);
}

function appendEllipse(parent: SVGGElement, e: SvgEllipse) {
  const ellipse = document.createElementNS(SVG_NS, "ellipse");
  setAttrs(ellipse, {
    cx: e.cx,
    cy: e.cy,
    rx: e.rx,
    ry: e.ry,
    fill: e.fill,
    class: "item-ellipse",
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
    "data-miro-id": l.id,
    "data-miro-type": "connector",
  });
  parent.appendChild(line);
}

/** Rough advance width of a glyph as a fraction of the font size. */
const GLYPH_WIDTH_FACTOR = 0.62;

/**
 * A label earns its place only when it fits its item at the current zoom.
 * Labels render at a fixed on-screen size, so on a dense board an
 * unconditional draw degenerates into overlapping noise. maxWidth is the
 * item's width in board units; 0 means always draw (frame titles, connector
 * captions). Zooming in makes more labels fit — the dynamic layer redraws on
 * every viewBox change.
 */
function labelFits(l: SvgLabel, upp: number): boolean {
  if (l.maxWidth <= 0) return true;
  return l.text.length * l.fontSize * GLYPH_WIDTH_FACTOR * upp <= l.maxWidth;
}

function appendLabel(parent: SVGGElement, l: SvgLabel, upp: number) {
  const text = document.createElementNS(SVG_NS, "text");
  setAttrs(text, {
    x: l.x,
    y: l.y,
    "text-anchor": l.anchor,
    "font-size": l.fontSize * upp,
    class:
      "item-label" + (l.muted ? " muted" : "") + (l.onFill ? " on-fill" : ""),
  });
  text.textContent = l.text;
  parent.appendChild(text);
}

/**
 * A standalone text item whose label is hidden at this zoom leaves a truly
 * blank region — unlike a box label, there is no shape underneath. Mark the
 * spot with a faint ghost so text-dense areas read as occupied.
 */
function appendTextGhost(parent: SVGGElement, l: SvgLabel) {
  const rect = document.createElementNS(SVG_NS, "rect");
  setAttrs(rect, {
    x: l.x - l.maxWidth / 2,
    y: l.y - 10,
    width: l.maxWidth,
    height: 20,
    class: "text-ghost",
  });
  parent.appendChild(rect);
}

function renderDynamicLayer() {
  if (!currentData || !dynamicLayer) return;
  while (dynamicLayer.firstChild)
    dynamicLayer.removeChild(dynamicLayer.firstChild);
  const upp = unitsPerPixel();
  for (const l of currentData.labels) {
    if (labelFits(l, upp)) {
      appendLabel(dynamicLayer, l, upp);
    } else if (!l.onFill && l.maxWidth > 0) {
      appendTextGhost(dynamicLayer, l);
    }
  }
}

function render(data: BoardSvgResult) {
  currentData = data;
  vb = { ...data.viewBox };
  updateHeader(data);

  while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
  sizeCanvas(data.viewBox);

  if (data.rendered === 0 && data.lines.length === 0) {
    applyViewBox();
    appendEmptyText(data.viewBox, "No renderable items on this board.");
    return;
  }

  staticLayer = document.createElementNS(SVG_NS, "g");
  dynamicLayer = document.createElementNS(SVG_NS, "g");
  svgEl.append(staticLayer, dynamicLayer);

  // Draw order: rects arrive frames-first from the builder, so frames sit
  // under everything; connectors go above shapes, labels on top.
  for (const r of data.rects) appendRect(staticLayer, r);
  for (const e of data.ellipses) appendEllipse(staticLayer, e);
  for (const l of data.lines) appendLine(staticLayer, l);
  applyViewBox();
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
