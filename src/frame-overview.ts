/**
 * Miro frame-overview UI. Receives FrameOverviewResult and renders a card grid:
 * one card per frame with title, dimensions, modified date. Click to open in Miro.
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
import "./frame-overview.css";

interface Frame {
  id: string;
  title: string;
  width?: number;
  height?: number;
  modifiedAt?: string;
  selfLink?: string;
}

interface FrameOverviewResult {
  boardId: string;
  boardName: string;
  viewLink: string;
  frames: Frame[];
}

const appEl = document.getElementById("app")!;
const boardNameEl = document.getElementById("board-name")!;
const subtitleEl = document.getElementById("subtitle")!;
const gridEl = document.getElementById("grid")!;
const countSummaryEl = document.getElementById("count-summary")!;
const openBoardBtn = document.getElementById(
  "open-board-btn",
) as HTMLButtonElement;

let currentData: FrameOverviewResult | null = null;

function extractData(result: CallToolResult): FrameOverviewResult | null {
  const sc = result.structuredContent as
    | Partial<FrameOverviewResult>
    | undefined;
  if (!sc?.boardId || !sc.boardName || !Array.isArray(sc.frames)) return null;
  return sc as FrameOverviewResult;
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

function formatDimensions(w?: number, h?: number): string {
  if (!w || !h) return "";
  return `${Math.round(w)} × ${Math.round(h)}`;
}

function renderGrid(frames: Frame[], viewLink: string) {
  gridEl.replaceChildren();
  if (frames.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No frames on this board.";
    gridEl.appendChild(empty);
    return;
  }
  for (const frame of frames) {
    const card = document.createElement("article");
    card.className = "frame-card";
    const target = frame.selfLink ?? viewLink;
    if (target) {
      card.classList.add("clickable");
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      const open = async () => {
        try {
          await app.openLink({ url: target });
        } catch (e) {
          console.error("Open link failed:", e);
        }
      };
      card.addEventListener("click", open);
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
    }
    const title = document.createElement("h3");
    title.className = "frame-title";
    title.textContent = frame.title;
    const meta = document.createElement("p");
    meta.className = "frame-meta";
    const dims = formatDimensions(frame.width, frame.height);
    meta.textContent = [dims, formatDate(frame.modifiedAt)]
      .filter(Boolean)
      .join(" · ");
    card.append(title, meta);
    gridEl.appendChild(card);
  }
}

function render(data: FrameOverviewResult) {
  currentData = data;
  boardNameEl.textContent = data.boardName;
  subtitleEl.textContent = `${data.frames.length} frame${data.frames.length === 1 ? "" : "s"}`;
  countSummaryEl.textContent = `${data.frames.length} frame${data.frames.length === 1 ? "" : "s"} shown`;
  openBoardBtn.disabled = !data.viewLink;
  renderGrid(data.frames, data.viewLink);
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

const app = new App({ name: "Miro Frame Overview", version: "0.1.0" });

app.ontoolresult = (result) => {
  const data = extractData(result);
  if (!data) {
    renderError("Server returned no frame data.");
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
