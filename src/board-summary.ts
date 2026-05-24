/**
 * Miro board-summary UI. Receives BoardSummary data via app.ontoolresult and
 * renders a card with: header, item stats, type bar chart, recent items,
 * "Open in Miro" action.
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
import "./board-summary.css";

interface BoardSummary {
  id: string;
  name: string;
  description: string;
  viewLink: string;
  totalItems: number;
  itemCounts: Record<string, number>;
  recentItems: Array<{
    id: string;
    type: string;
    label: string;
    modifiedAt?: string;
  }>;
  modifiedAt?: string;
}

const appEl = document.getElementById("app")!;
const boardNameEl = document.getElementById("board-name")!;
const boardDescEl = document.getElementById("board-description")!;
const statTotalEl = document.getElementById("stat-total")!;
const statTypesEl = document.getElementById("stat-types")!;
const statModifiedEl = document.getElementById("stat-modified")!;
const chartEl = document.getElementById("chart")!;
const recentListEl = document.getElementById("recent-list")!;
const openBoardBtn = document.getElementById(
  "open-board-btn",
) as HTMLButtonElement;

let currentViewLink: string | null = null;

function extractSummary(result: CallToolResult): BoardSummary | null {
  const sc = result.structuredContent as Partial<BoardSummary> | undefined;
  if (!sc?.id || !sc.name) return null;
  return sc as BoardSummary;
}

function formatDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function renderChart(counts: Record<string, number>) {
  chartEl.replaceChildren();
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No items on this board.";
    chartEl.appendChild(empty);
    return;
  }
  const max = entries[0][1];
  for (const [type, count] of entries) {
    const row = document.createElement("div");
    row.className = "chart-row";
    const typeEl = document.createElement("span");
    typeEl.className = "type";
    typeEl.textContent = type;
    typeEl.title = type;
    const bar = document.createElement("span");
    bar.className = "bar";
    const fill = document.createElement("span");
    fill.className = "bar-fill";
    fill.style.width = `${(count / max) * 100}%`;
    bar.appendChild(fill);
    const countEl = document.createElement("span");
    countEl.className = "count";
    countEl.textContent = String(count);
    row.append(typeEl, bar, countEl);
    chartEl.appendChild(row);
  }
}

function renderRecent(items: BoardSummary["recentItems"]) {
  recentListEl.replaceChildren();
  if (items.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No recent items.";
    recentListEl.appendChild(empty);
    return;
  }
  for (const item of items) {
    const li = document.createElement("li");
    const typeEl = document.createElement("span");
    typeEl.className = "item-type";
    typeEl.textContent = item.type;
    const labelEl = document.createElement("span");
    labelEl.className = "item-label";
    labelEl.textContent = item.label;
    li.append(typeEl, labelEl);
    recentListEl.appendChild(li);
  }
}

function render(summary: BoardSummary) {
  boardNameEl.textContent = summary.name;
  boardDescEl.textContent = summary.description || "";
  statTotalEl.textContent = String(summary.totalItems);
  statTypesEl.textContent = String(Object.keys(summary.itemCounts).length);
  statModifiedEl.textContent = formatDate(summary.modifiedAt);
  renderChart(summary.itemCounts);
  renderRecent(summary.recentItems);
  currentViewLink = summary.viewLink;
  openBoardBtn.disabled = !currentViewLink;
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

const app = new App({ name: "Miro Board Summary", version: "0.1.0" });

app.ontoolresult = (result) => {
  const summary = extractSummary(result);
  if (!summary) {
    renderError("Server returned no board summary data.");
    return;
  }
  render(summary);
};

app.onerror = (e) => {
  console.error(e);
  renderError(`Error: ${String(e)}`);
};

app.onhostcontextchanged = handleHostContextChanged;

openBoardBtn.addEventListener("click", async () => {
  if (!currentViewLink) return;
  try {
    await app.openLink({ url: currentViewLink });
  } catch (e) {
    console.error("Open link failed:", e);
  }
});

app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) handleHostContextChanged(ctx);
});
