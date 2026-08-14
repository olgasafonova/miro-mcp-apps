/**
 * Miro recent-boards UI. Receives RecentBoardsResult and renders a scrollable
 * table of boards (name + modified date). Click row to open in Miro.
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
import "./recent-boards.css";

interface RecentBoard {
  id: string;
  name: string;
  description: string;
  viewLink: string;
  modifiedAt?: string;
  createdAt?: string;
  ownerName?: string;
  teamId?: string;
  teamName?: string;
}

interface RecentBoardsResult {
  boards: RecentBoard[];
}

const appEl = document.getElementById("app")!;
const subtitleEl = document.getElementById("subtitle")!;
const tbodyEl = document.getElementById("boards-tbody")!;

function extractData(result: CallToolResult): RecentBoardsResult | null {
  const sc = result.structuredContent as
    Partial<RecentBoardsResult> | undefined;
  if (!sc || !Array.isArray(sc.boards)) return null;
  return sc as RecentBoardsResult;
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

/**
 * Builds the owner/team chip row shown under a board's name, or null when the
 * board carries neither.
 *
 * Absent values are omitted rather than rendered as a placeholder: a personal
 * board genuinely has no team, and an "—" chip would read as missing data
 * instead of as "not applicable". The date column already uses "—" because a
 * board always HAS a modified date, so a blank there really would be a gap.
 */
function buildMetaChips(board: RecentBoard): HTMLElement | null {
  const labels: string[] = [];
  if (board.ownerName) labels.push(board.ownerName);
  // Fall back to the team ID only when the name is missing but the board does
  // belong to a team — better a raw ID than silently dropping the association.
  if (board.teamName) labels.push(board.teamName);
  else if (board.teamId) labels.push(`Team ${board.teamId}`);

  if (labels.length === 0) return null;

  const row = document.createElement("p");
  row.className = "board-meta";
  for (const label of labels) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = label;
    row.appendChild(chip);
  }
  return row;
}

function renderTable(boards: RecentBoard[]) {
  tbodyEl.replaceChildren();
  if (boards.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 2;
    td.className = "empty";
    td.textContent = "No boards found.";
    tr.appendChild(td);
    tbodyEl.appendChild(tr);
    return;
  }
  for (const board of boards) {
    const tr = document.createElement("tr");
    if (board.viewLink) {
      tr.classList.add("clickable");
      tr.addEventListener("click", async () => {
        try {
          await app.openLink({ url: board.viewLink });
        } catch (e) {
          console.error("Open link failed:", e);
        }
      });
    }
    const tName = document.createElement("td");
    tName.className = "name";
    const nameStrong = document.createElement("strong");
    nameStrong.textContent = board.name || "(unnamed)";
    tName.appendChild(nameStrong);
    if (board.description) {
      const desc = document.createElement("p");
      desc.className = "description";
      desc.textContent = board.description;
      tName.appendChild(desc);
    }
    const meta = buildMetaChips(board);
    if (meta) tName.appendChild(meta);
    const tMod = document.createElement("td");
    tMod.className = "modified";
    tMod.textContent = formatDate(board.modifiedAt);
    tr.append(tName, tMod);
    tbodyEl.appendChild(tr);
  }
}

function render(data: RecentBoardsResult) {
  subtitleEl.textContent = `${data.boards.length} board${data.boards.length === 1 ? "" : "s"}, sorted by last modified`;
  renderTable(data.boards);
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

const app = new App({ name: "Miro Recent Boards", version: "0.1.0" });

app.ontoolresult = (result) => {
  const data = extractData(result);
  if (!data) {
    renderError("Server returned no boards data.");
    return;
  }
  render(data);
};

app.onerror = (e) => {
  console.error(e);
  renderError(`Error: ${String(e)}`);
};

app.onhostcontextchanged = handleHostContextChanged;

app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) handleHostContextChanged(ctx);
});
