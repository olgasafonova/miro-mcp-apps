/**
 * Miro list-items UI. Receives ListItemsResult via app.ontoolresult and
 * renders a scrollable table with client-side type filtering. Click a row to
 * open the item in Miro (via host openLink).
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
import "./list-items.css";

interface ListItem {
  id: string;
  type: string;
  label: string;
  modifiedAt?: string;
  selfLink?: string;
}

interface ListItemsResult {
  boardId: string;
  boardName: string;
  viewLink: string;
  items: ListItem[];
}

const ALL = "__all__";

const appEl = document.getElementById("app")!;
const boardNameEl = document.getElementById("board-name")!;
const subtitleEl = document.getElementById("subtitle")!;
const filtersEl = document.getElementById("filters")!;
const tbodyEl = document.getElementById("items-tbody")!;
const countSummaryEl = document.getElementById("count-summary")!;
const openBoardBtn = document.getElementById(
  "open-board-btn",
) as HTMLButtonElement;

let currentData: ListItemsResult | null = null;
let activeType: string = ALL;

function extractData(result: CallToolResult): ListItemsResult | null {
  const sc = result.structuredContent as Partial<ListItemsResult> | undefined;
  if (!sc?.boardId || !sc.boardName || !Array.isArray(sc.items)) return null;
  return sc as ListItemsResult;
}

function formatDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderFilters() {
  if (!currentData) return;
  filtersEl.replaceChildren();
  const counts: Record<string, number> = { [ALL]: currentData.items.length };
  for (const item of currentData.items) {
    counts[item.type] = (counts[item.type] ?? 0) + 1;
  }
  const types = Object.keys(counts)
    .filter((k) => k !== ALL)
    .sort();
  const order = [ALL, ...types];
  for (const key of order) {
    const btn = document.createElement("button");
    btn.className = "chip";
    btn.type = "button";
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-pressed", String(key === activeType));
    const label = document.createElement("span");
    label.textContent = key === ALL ? "All" : key;
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = String(counts[key]);
    btn.append(label, count);
    btn.addEventListener("click", () => {
      activeType = key;
      renderFilters();
      renderTable();
    });
    filtersEl.appendChild(btn);
  }
}

function renderTable() {
  if (!currentData) return;
  tbodyEl.replaceChildren();
  const filtered =
    activeType === ALL
      ? currentData.items
      : currentData.items.filter((i) => i.type === activeType);

  if (filtered.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 3;
    td.className = "empty";
    td.textContent =
      activeType === ALL
        ? "No items on this board."
        : `No items of type "${activeType}".`;
    tr.appendChild(td);
    tbodyEl.appendChild(tr);
    countSummaryEl.textContent = "0 items shown";
    return;
  }

  for (const item of filtered) {
    const tr = document.createElement("tr");
    const target = item.selfLink ?? currentData.viewLink;
    if (target) {
      tr.classList.add("clickable");
      tr.addEventListener("click", async () => {
        try {
          await app.openLink({ url: target });
        } catch (e) {
          console.error("Open link failed:", e);
        }
      });
    }
    const tType = document.createElement("td");
    tType.className = "type";
    tType.textContent = item.type;
    const tLabel = document.createElement("td");
    tLabel.className = "label";
    tLabel.textContent = item.label;
    const tMod = document.createElement("td");
    tMod.className = "modified";
    tMod.textContent = formatDate(item.modifiedAt);
    tr.append(tType, tLabel, tMod);
    tbodyEl.appendChild(tr);
  }

  countSummaryEl.textContent = `${filtered.length} of ${currentData.items.length} items shown`;
}

function render(data: ListItemsResult) {
  currentData = data;
  activeType = ALL;
  boardNameEl.textContent = data.boardName;
  subtitleEl.textContent = `${data.items.length} item${data.items.length === 1 ? "" : "s"}`;
  openBoardBtn.disabled = !data.viewLink;
  renderFilters();
  renderTable();
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

const app = new App({ name: "Miro Board Items", version: "0.1.0" });

app.ontoolresult = (result) => {
  const data = extractData(result);
  if (!data) {
    renderError("Server returned no items data.");
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
