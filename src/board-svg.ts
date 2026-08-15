/**
 * Miro board-SVG UI. Receives BoardSvgResult — render primitives (rects,
 * ellipses, lines, labels) in Miro board coordinates plus a fitted viewBox —
 * and draws them as an inline SVG spatial map. The geometry was computed
 * server-side (TS port of the Go server's svg_read.go); this file only turns
 * primitives into DOM nodes. Everything is created via createElementNS and
 * textContent — no markup injection.
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

interface BoardSvgResult {
  boardId: string;
  boardName: string;
  viewLink: string;
  viewBox: { x: number; y: number; width: number; height: number };
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

const appEl = document.getElementById("app")!;
const boardNameEl = document.getElementById("board-name")!;
const subtitleEl = document.getElementById("subtitle")!;
const svgEl = document.getElementById("canvas") as unknown as SVGSVGElement;
const countSummaryEl = document.getElementById("count-summary")!;
const openBoardBtn = document.getElementById(
  "open-board-btn",
) as HTMLButtonElement;

let currentData: BoardSvgResult | null = null;

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
      : "");
  countSummaryEl.textContent = data.truncated
    ? `Showing the first ${data.rendered} of ${data.totalItems} items.`
    : data.totalItems === 0
      ? "Board has no items."
      : `All ${data.totalItems} board item${plural(data.totalItems)} fetched.`;
  openBoardBtn.disabled = !data.viewLink;
}

function resetSvg(viewBox: BoardSvgResult["viewBox"]) {
  while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
  svgEl.setAttribute(
    "viewBox",
    `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`,
  );
  svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
}

function appendEmptyText(viewBox: BoardSvgResult["viewBox"], message: string) {
  const text = document.createElementNS(SVG_NS, "text");
  setAttrs(text, {
    x: viewBox.x + viewBox.width / 2,
    y: viewBox.y + viewBox.height / 2,
    "text-anchor": "middle",
    class: "empty-text",
  });
  text.textContent = message;
  svgEl.appendChild(text);
}

/**
 * Board coordinates span thousands of units, so a label's fontSize (meant as
 * an on-screen pixel size) must be scaled into board units or it renders
 * microscopic. unitsPerPixel is how many board units one CSS pixel covers
 * once the viewBox is fitted into the on-screen box.
 */
function computeUnitsPerPixel(viewBox: BoardSvgResult["viewBox"]): number {
  const box = svgEl.getBoundingClientRect();
  const pxW = box.width || 688;
  const pxH = box.height || 440;
  // preserveAspectRatio "meet" scales by the tighter dimension.
  return Math.max(viewBox.width / pxW, viewBox.height / pxH, 0.0001);
}

function appendRect(r: SvgRect) {
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
  svgEl.appendChild(rect);
}

function appendEllipse(e: SvgEllipse) {
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
  svgEl.appendChild(ellipse);
}

function appendLine(l: SvgLine) {
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
  svgEl.appendChild(line);
}

/** Rough advance width of a glyph as a fraction of the font size. */
const GLYPH_WIDTH_FACTOR = 0.62;

/**
 * A label earns its place only when it fits its item at the current zoom.
 * Labels render at a fixed on-screen size (fontSize is meant in pixels), so
 * on a dense board an unconditional draw degenerates into overlapping noise —
 * the first harness pass proved it. maxWidth is the item's width in board
 * units; 0 means always draw (frame titles, connector captions).
 */
function labelFits(l: SvgLabel, unitsPerPixel: number): boolean {
  if (l.maxWidth <= 0) return true;
  const labelUnits =
    l.text.length * l.fontSize * GLYPH_WIDTH_FACTOR * unitsPerPixel;
  return labelUnits <= l.maxWidth;
}

function appendLabel(l: SvgLabel, unitsPerPixel: number) {
  const text = document.createElementNS(SVG_NS, "text");
  setAttrs(text, {
    x: l.x,
    y: l.y,
    "text-anchor": l.anchor,
    "font-size": l.fontSize * unitsPerPixel,
    class:
      "item-label" + (l.muted ? " muted" : "") + (l.onFill ? " on-fill" : ""),
  });
  text.textContent = l.text;
  svgEl.appendChild(text);
}

function render(data: BoardSvgResult) {
  currentData = data;
  updateHeader(data);
  resetSvg(data.viewBox);

  if (data.rendered === 0 && data.lines.length === 0) {
    appendEmptyText(data.viewBox, "No renderable items on this board.");
    return;
  }

  const unitsPerPixel = computeUnitsPerPixel(data.viewBox);

  // Draw order: rects arrive frames-first from the builder, so frames sit
  // under everything; connectors go above shapes, labels on top.
  for (const r of data.rects) appendRect(r);
  for (const e of data.ellipses) appendEllipse(e);
  for (const l of data.lines) appendLine(l);
  for (const l of data.labels) {
    if (labelFits(l, unitsPerPixel)) appendLabel(l, unitsPerPixel);
  }
}

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

const openBoard = async () => {
  if (!currentData?.viewLink) return;
  try {
    await app.openLink({ url: currentData.viewLink });
  } catch (e) {
    console.error("Open link failed:", e);
  }
};

openBoardBtn.addEventListener("click", openBoard);
svgEl.addEventListener("click", openBoard);

app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) handleHostContextChanged(ctx);
});
