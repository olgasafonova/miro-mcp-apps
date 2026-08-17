/**
 * Miro tag-map UI. Receives TagMapResult and renders one section per tag —
 * color-coded chip header, tagged items as clickable pills — sorted by
 * usage descending (the builder pre-sorts).
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
import "./tag-map.css";

interface TagItem {
  id: string;
  type: string;
  label: string;
  selfLink?: string;
}

interface TagEntry {
  id: string;
  title: string;
  color: string;
  count: number;
  items: TagItem[];
}

interface TagMapResult {
  boardId: string;
  boardName: string;
  viewLink: string;
  totalTags: number;
  tags: TagEntry[];
}

// Miro tag fillColor names → chip colors. Tags use a smaller palette than
// stickies (red, magenta, violet, blue, cyan, green, yellow, orange, gray).
// Unknown names fall back to a neutral chip.
const TAG_COLOR_MAP: Record<string, { bg: string; fg: string }> = {
  red: { bg: "#fecaca", fg: "#7f1d1d" },
  magenta: { bg: "#fbcfe8", fg: "#831843" },
  violet: { bg: "#ddd6fe", fg: "#4c1d95" },
  blue: { bg: "#bfdbfe", fg: "#1e3a8a" },
  cyan: { bg: "#a5f3fc", fg: "#155e75" },
  green: { bg: "#bbf7d0", fg: "#14532d" },
  yellow: { bg: "#fef08a", fg: "#713f12" },
  orange: { bg: "#fed7aa", fg: "#7c2d12" },
  gray: { bg: "#e5e7eb", fg: "#1f2937" },
};

function colorFor(name: string): { bg: string; fg: string } {
  return TAG_COLOR_MAP[name] ?? { bg: "#e5e7eb", fg: "#1f2937" };
}

// Item-type → short badge text. Falls back to the raw type.
const TYPE_BADGE: Record<string, string> = {
  sticky_note: "sticky",
  app_card: "app card",
  data_table_format: "table",
};

function typeBadge(type: string): string {
  return TYPE_BADGE[type] ?? type.replace(/_/g, " ");
}

const appEl = document.getElementById("app")!;
const boardNameEl = document.getElementById("board-name")!;
const subtitleEl = document.getElementById("subtitle")!;
const tagsEl = document.getElementById("tags")!;
const openBoardBtn = document.getElementById(
  "open-board-btn",
) as HTMLButtonElement;

let currentData: TagMapResult | null = null;

function extractData(result: CallToolResult): TagMapResult | null {
  const sc = result.structuredContent as Partial<TagMapResult> | undefined;
  if (!sc?.boardId || !sc.boardName || !Array.isArray(sc.tags)) return null;
  return sc as TagMapResult;
}

function makeClickable(el: HTMLElement, url: string) {
  el.classList.add("clickable");
  el.tabIndex = 0;
  el.setAttribute("role", "button");
  const open = async () => {
    try {
      await app.openLink({ url });
    } catch (e) {
      console.error("Open link failed:", e);
    }
  };
  el.addEventListener("click", open);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  });
}

function renderTags(tags: TagEntry[], viewLink: string) {
  tagsEl.replaceChildren();
  if (tags.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No tags on this board.";
    tagsEl.appendChild(empty);
    return;
  }
  for (const tag of tags) {
    const colDef = colorFor(tag.color);
    const section = document.createElement("section");
    section.className = "tag-group";

    const header = document.createElement("header");
    header.className = "tag-header";
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.style.background = colDef.bg;
    chip.style.color = colDef.fg;
    chip.textContent = tag.title;
    const count = document.createElement("span");
    count.className = "tag-count";
    count.textContent = tag.count === 1 ? "1 item" : `${tag.count} items`;
    header.append(chip, count);
    section.appendChild(header);

    const list = document.createElement("ul");
    list.className = "item-list";
    if (tag.items.length === 0) {
      const li = document.createElement("li");
      li.className = "item unused";
      li.textContent = "No items carry this tag.";
      list.appendChild(li);
    }
    for (const item of tag.items) {
      const li = document.createElement("li");
      li.className = "item";
      const badge = document.createElement("span");
      badge.className = "item-type";
      badge.textContent = typeBadge(item.type);
      const label = document.createElement("span");
      label.className = "item-label";
      label.textContent = item.label;
      li.append(badge, label);
      const target = item.selfLink ?? viewLink;
      if (target) makeClickable(li, target);
      list.appendChild(li);
    }
    section.appendChild(list);
    tagsEl.appendChild(section);
  }
}

function render(data: TagMapResult) {
  currentData = data;
  boardNameEl.textContent = data.boardName;
  const tagged = data.tags.reduce((n, t) => n + t.count, 0);
  subtitleEl.textContent = `${data.totalTags} tag${data.totalTags === 1 ? "" : "s"} · ${tagged} tagged item${tagged === 1 ? "" : "s"}`;
  openBoardBtn.disabled = !data.viewLink;
  renderTags(data.tags, data.viewLink);
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

const app = new App({ name: "Miro Tag Map", version: "0.1.0" });

app.ontoolresult = (result) => {
  const data = extractData(result);
  if (!data) {
    renderError("Server returned no tag data.");
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
