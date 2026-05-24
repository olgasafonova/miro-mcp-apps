/**
 * Miro sticky-clusters UI. Receives StickyClustersResult and renders one column
 * per fillColor with sticky-shaped tiles inside, sorted by cluster size desc.
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
import "./sticky-clusters.css";

interface Sticky {
  id: string;
  label: string;
  selfLink?: string;
}

interface Cluster {
  color: string;
  count: number;
  stickies: Sticky[];
}

interface StickyClustersResult {
  boardId: string;
  boardName: string;
  viewLink: string;
  totalStickies: number;
  clusters: Cluster[];
}

// Miro sticky-note fillColor strings → CSS colors. Miro uses semantic
// color names (e.g. "yellow", "light_yellow", "blue"); map the common
// ones to swatch colors that look right against the host background.
// Unknown colors fall back to a neutral swatch.
const COLOR_MAP: Record<string, { bg: string; fg: string }> = {
  yellow: { bg: "#fef08a", fg: "#1c1917" },
  light_yellow: { bg: "#fef9c3", fg: "#1c1917" },
  orange: { bg: "#fed7aa", fg: "#1c1917" },
  light_orange: { bg: "#ffedd5", fg: "#1c1917" },
  red: { bg: "#fecaca", fg: "#1c1917" },
  light_red: { bg: "#fee2e2", fg: "#1c1917" },
  pink: { bg: "#fbcfe8", fg: "#1c1917" },
  light_pink: { bg: "#fce7f3", fg: "#1c1917" },
  violet: { bg: "#ddd6fe", fg: "#1c1917" },
  light_violet: { bg: "#ede9fe", fg: "#1c1917" },
  blue: { bg: "#bfdbfe", fg: "#1c1917" },
  light_blue: { bg: "#dbeafe", fg: "#1c1917" },
  cyan: { bg: "#a5f3fc", fg: "#1c1917" },
  light_cyan: { bg: "#cffafe", fg: "#1c1917" },
  green: { bg: "#bbf7d0", fg: "#1c1917" },
  light_green: { bg: "#dcfce7", fg: "#1c1917" },
  gray: { bg: "#e5e7eb", fg: "#1c1917" },
  light_gray: { bg: "#f3f4f6", fg: "#1c1917" },
  black: { bg: "#1f2937", fg: "#f9fafb" },
  white: { bg: "#ffffff", fg: "#1c1917" },
};

function colorFor(name: string): { bg: string; fg: string } {
  return COLOR_MAP[name] ?? { bg: "#e5e7eb", fg: "#1c1917" };
}

function displayColorName(name: string): string {
  if (name === "unknown") return "Other";
  return name
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

const appEl = document.getElementById("app")!;
const boardNameEl = document.getElementById("board-name")!;
const subtitleEl = document.getElementById("subtitle")!;
const clustersEl = document.getElementById("clusters")!;
const openBoardBtn = document.getElementById(
  "open-board-btn",
) as HTMLButtonElement;

let currentData: StickyClustersResult | null = null;

function extractData(result: CallToolResult): StickyClustersResult | null {
  const sc = result.structuredContent as
    | Partial<StickyClustersResult>
    | undefined;
  if (!sc?.boardId || !sc.boardName || !Array.isArray(sc.clusters)) return null;
  return sc as StickyClustersResult;
}

function renderClusters(clusters: Cluster[], viewLink: string) {
  clustersEl.replaceChildren();
  if (clusters.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No sticky notes on this board.";
    clustersEl.appendChild(empty);
    return;
  }
  for (const cluster of clusters) {
    const colDef = colorFor(cluster.color);
    const col = document.createElement("section");
    col.className = "cluster";
    const header = document.createElement("header");
    header.className = "cluster-header";
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = colDef.bg;
    const name = document.createElement("span");
    name.className = "cluster-name";
    name.textContent = displayColorName(cluster.color);
    const count = document.createElement("span");
    count.className = "cluster-count";
    count.textContent = String(cluster.count);
    header.append(swatch, name, count);
    col.appendChild(header);

    const list = document.createElement("ul");
    list.className = "sticky-list";
    for (const sticky of cluster.stickies) {
      const li = document.createElement("li");
      li.className = "sticky";
      li.style.background = colDef.bg;
      li.style.color = colDef.fg;
      const target = sticky.selfLink ?? viewLink;
      if (target) {
        li.classList.add("clickable");
        li.tabIndex = 0;
        li.setAttribute("role", "button");
        const open = async () => {
          try {
            await app.openLink({ url: target });
          } catch (e) {
            console.error("Open link failed:", e);
          }
        };
        li.addEventListener("click", open);
        li.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        });
      }
      li.textContent = sticky.label;
      list.appendChild(li);
    }
    col.appendChild(list);
    clustersEl.appendChild(col);
  }
}

function render(data: StickyClustersResult) {
  currentData = data;
  boardNameEl.textContent = data.boardName;
  subtitleEl.textContent = `${data.totalStickies} sticky note${data.totalStickies === 1 ? "" : "s"} · ${data.clusters.length} color${data.clusters.length === 1 ? "" : "s"}`;
  openBoardBtn.disabled = !data.viewLink;
  renderClusters(data.clusters, data.viewLink);
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

const app = new App({ name: "Miro Sticky Clusters", version: "0.1.0" });

app.ontoolresult = (result) => {
  const data = extractData(result);
  if (!data) {
    renderError("Server returned no cluster data.");
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
