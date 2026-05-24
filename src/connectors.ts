/**
 * Miro connectors-graph UI. Receives ConnectorsGraphResult (nodes + edges
 * with Miro-space coordinates) and renders an SVG graph normalized to a
 * fixed viewport. Click a node to open the underlying item in Miro.
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
import "./connectors.css";

interface GraphNode {
  id: string;
  type: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
  caption?: string;
}

interface ConnectorsGraphResult {
  boardId: string;
  boardName: string;
  viewLink: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const SVG_NS = "http://www.w3.org/2000/svg";
const VIEW_W = 600;
const VIEW_H = 400;
const NODE_PADDING = 40;

const appEl = document.getElementById("app")!;
const boardNameEl = document.getElementById("board-name")!;
const subtitleEl = document.getElementById("subtitle")!;
const svgEl = document.getElementById("graph") as unknown as SVGSVGElement;
const countSummaryEl = document.getElementById("count-summary")!;
const openBoardBtn = document.getElementById(
  "open-board-btn",
) as HTMLButtonElement;

let currentData: ConnectorsGraphResult | null = null;

function extractData(result: CallToolResult): ConnectorsGraphResult | null {
  const sc = result.structuredContent as
    | Partial<ConnectorsGraphResult>
    | undefined;
  if (
    !sc?.boardId ||
    !sc.boardName ||
    !Array.isArray(sc.nodes) ||
    !Array.isArray(sc.edges)
  ) {
    return null;
  }
  return sc as ConnectorsGraphResult;
}

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function computeBounds(nodes: GraphNode[]): Bounds | null {
  if (nodes.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y);
  }
  return { minX, maxX, minY, maxY };
}

function normalize(value: number, min: number, max: number): number {
  if (max - min < 0.0001) return 0.5;
  return (value - min) / (max - min);
}

function setAttrs(el: Element, attrs: Record<string, string | number>) {
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
}

function render(data: ConnectorsGraphResult) {
  currentData = data;
  boardNameEl.textContent = data.boardName;
  subtitleEl.textContent = `${data.nodes.length} item${data.nodes.length === 1 ? "" : "s"} · ${data.edges.length} connector${data.edges.length === 1 ? "" : "s"}`;
  countSummaryEl.textContent =
    data.edges.length === 0
      ? "No connectors on this board."
      : `Showing ${data.edges.length} connector${data.edges.length === 1 ? "" : "s"} between ${data.nodes.length} item${data.nodes.length === 1 ? "" : "s"}`;
  openBoardBtn.disabled = !data.viewLink;

  while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
  svgEl.setAttribute("viewBox", `0 0 ${VIEW_W} ${VIEW_H}`);
  svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");

  const bounds = computeBounds(data.nodes);
  if (!bounds || data.nodes.length === 0) {
    const text = document.createElementNS(SVG_NS, "text");
    setAttrs(text, {
      x: VIEW_W / 2,
      y: VIEW_H / 2,
      "text-anchor": "middle",
      class: "empty-text",
    });
    text.textContent = "No connected items to display.";
    svgEl.appendChild(text);
    return;
  }

  const positions = new Map<string, { cx: number; cy: number }>();
  for (const node of data.nodes) {
    const cx =
      NODE_PADDING +
      normalize(node.x, bounds.minX, bounds.maxX) * (VIEW_W - 2 * NODE_PADDING);
    const cy =
      NODE_PADDING +
      normalize(node.y, bounds.minY, bounds.maxY) * (VIEW_H - 2 * NODE_PADDING);
    positions.set(node.id, { cx, cy });
  }

  // Arrowhead marker
  const defs = document.createElementNS(SVG_NS, "defs");
  const marker = document.createElementNS(SVG_NS, "marker");
  setAttrs(marker, {
    id: "arrow",
    viewBox: "0 0 10 10",
    refX: 8,
    refY: 5,
    markerWidth: 6,
    markerHeight: 6,
    orient: "auto-start-reverse",
  });
  const arrowPath = document.createElementNS(SVG_NS, "path");
  setAttrs(arrowPath, {
    d: "M 0 0 L 10 5 L 0 10 z",
    class: "arrowhead",
  });
  marker.appendChild(arrowPath);
  defs.appendChild(marker);
  svgEl.appendChild(defs);

  // Edges
  for (const edge of data.edges) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;
    const line = document.createElementNS(SVG_NS, "line");
    setAttrs(line, {
      x1: from.cx,
      y1: from.cy,
      x2: to.cx,
      y2: to.cy,
      class: "edge",
      "marker-end": "url(#arrow)",
    });
    svgEl.appendChild(line);
    if (edge.caption) {
      const midX = (from.cx + to.cx) / 2;
      const midY = (from.cy + to.cy) / 2;
      const txt = document.createElementNS(SVG_NS, "text");
      setAttrs(txt, {
        x: midX,
        y: midY - 4,
        "text-anchor": "middle",
        class: "edge-caption",
      });
      txt.textContent = edge.caption;
      svgEl.appendChild(txt);
    }
  }

  // Nodes
  for (const node of data.nodes) {
    const pos = positions.get(node.id);
    if (!pos) continue;
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("class", "node");
    g.setAttribute("tabindex", "0");
    g.setAttribute("role", "button");

    const r = 10;
    const circle = document.createElementNS(SVG_NS, "circle");
    setAttrs(circle, { cx: pos.cx, cy: pos.cy, r, class: "node-dot" });
    const label = document.createElementNS(SVG_NS, "text");
    setAttrs(label, {
      x: pos.cx,
      y: pos.cy + r + 14,
      "text-anchor": "middle",
      class: "node-label",
    });
    label.textContent =
      node.label.length > 24 ? node.label.slice(0, 22) + "…" : node.label;
    g.append(circle, label);

    if (data.viewLink) {
      const open = async () => {
        try {
          await app.openLink({ url: data.viewLink });
        } catch (e) {
          console.error("Open link failed:", e);
        }
      };
      g.addEventListener("click", open);
      g.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
    }

    svgEl.appendChild(g);
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

const app = new App({ name: "Miro Connectors Graph", version: "0.1.0" });

app.ontoolresult = (result) => {
  const data = extractData(result);
  if (!data) {
    renderError("Server returned no graph data.");
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
