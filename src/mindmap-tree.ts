/**
 * Miro mindmap-tree UI. Receives MindmapTreeResult — a pre-order flat node
 * list with depths — and rebuilds it into nested lists, one tree per root.
 * Branch nodes collapse on click of their toggle.
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
import "./mindmap-tree.css";

interface TreeNode {
  id: string;
  parentId?: string;
  content: string;
  depth: number;
  isRoot: boolean;
  color?: string;
  childCount: number;
  selfLink?: string;
}

interface MindmapTreeResult {
  boardId: string;
  boardName: string;
  viewLink: string;
  totalNodes: number;
  rootCount: number;
  truncated: boolean;
  nodes: TreeNode[];
}

const appEl = document.getElementById("app")!;
const boardNameEl = document.getElementById("board-name")!;
const subtitleEl = document.getElementById("subtitle")!;
const treesEl = document.getElementById("trees")!;
const openBoardBtn = document.getElementById(
  "open-board-btn",
) as HTMLButtonElement;

let currentData: MindmapTreeResult | null = null;

function extractData(result: CallToolResult): MindmapTreeResult | null {
  const sc = result.structuredContent as Partial<MindmapTreeResult> | undefined;
  if (!sc?.boardId || !sc.boardName || !Array.isArray(sc.nodes)) return null;
  return sc as MindmapTreeResult;
}

function openInMiro(url: string) {
  app.openLink({ url }).catch((e) => console.error("Open link failed:", e));
}

/** One node row: optional collapse toggle, label pill, child count. */
function nodeRow(node: TreeNode, li: HTMLLIElement): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "node-row";

  if (node.childCount > 0) {
    const toggle = document.createElement("button");
    toggle.className = "toggle";
    toggle.type = "button";
    toggle.textContent = "−";
    toggle.setAttribute("aria-label", "Collapse branch");
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const collapsed = li.classList.toggle("collapsed");
      toggle.textContent = collapsed ? "+" : "−";
      toggle.setAttribute(
        "aria-label",
        collapsed ? "Expand branch" : "Collapse branch",
      );
    });
    row.appendChild(toggle);
  } else {
    const dot = document.createElement("span");
    dot.className = "leaf-dot";
    row.appendChild(dot);
  }

  const label = document.createElement("span");
  label.className = node.isRoot ? "node-label root" : "node-label";
  if (node.isRoot && node.color) {
    label.style.background = node.color;
    label.style.color = "#ffffff";
  }
  label.textContent = node.content;
  if (node.selfLink) {
    label.classList.add("clickable");
    label.tabIndex = 0;
    label.setAttribute("role", "button");
    label.addEventListener("click", () => openInMiro(node.selfLink!));
    label.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openInMiro(node.selfLink!);
      }
    });
  }
  row.appendChild(label);

  if (node.childCount > 0) {
    const count = document.createElement("span");
    count.className = "child-count";
    count.textContent = String(node.childCount);
    row.appendChild(count);
  }

  return row;
}

/** Rebuilds the pre-order flat list into nested <ul>s. The depth field is
 * the nesting authority: a node stacks onto the list whose depth matches. */
function renderTrees(nodes: TreeNode[]) {
  treesEl.replaceChildren();
  if (nodes.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No mindmaps on this board.";
    treesEl.appendChild(empty);
    return;
  }

  const rootList = document.createElement("ul");
  rootList.className = "tree";
  treesEl.appendChild(rootList);

  // Stack of the most recent li per depth; a node at depth d nests under
  // liStack[d-1], creating that li's branch <ul> on first use so a later
  // sibling subtree never lands in an earlier one's list.
  const liStack: HTMLLIElement[] = [];

  for (const node of nodes) {
    const depth = Math.max(0, Math.min(node.depth, liStack.length));
    liStack.length = depth;
    let list: HTMLUListElement;
    if (depth === 0) {
      list = rootList;
    } else {
      const parentLi = liStack[depth - 1];
      let branch = parentLi.querySelector<HTMLUListElement>(":scope > ul");
      if (!branch) {
        branch = document.createElement("ul");
        branch.className = "branch";
        parentLi.appendChild(branch);
      }
      list = branch;
    }
    const li = document.createElement("li");
    li.appendChild(nodeRow(node, li));
    list.appendChild(li);
    liStack[depth] = li;
  }
}

function render(data: MindmapTreeResult) {
  currentData = data;
  boardNameEl.textContent = data.boardName;
  const parts = [
    `${data.totalNodes} node${data.totalNodes === 1 ? "" : "s"}`,
    `${data.rootCount} mindmap${data.rootCount === 1 ? "" : "s"}`,
  ];
  if (data.truncated) parts.push("truncated");
  subtitleEl.textContent = parts.join(" · ");
  openBoardBtn.disabled = !data.viewLink;
  renderTrees(data.nodes);
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

const app = new App({ name: "Miro Mindmap Tree", version: "0.1.0" });

app.ontoolresult = (result) => {
  const data = extractData(result);
  if (!data) {
    renderError("Server returned no mindmap data.");
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
