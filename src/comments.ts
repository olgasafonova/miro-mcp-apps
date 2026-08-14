/**
 * Miro comment-threads UI. Receives CommentThreadsResult via app.ontoolresult
 * and renders each thread as a card: the opening message, its replies, and
 * whether it is resolved. Filter by status; click a thread to open the board.
 *
 * A "comment" in Miro's API is a THREAD, not a message — the text lives in
 * messages[] and the first one opened the thread. The view is built around
 * that, which is why replies are nested rather than listed flat.
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
import "./comments.css";

interface CommentMessage {
  id: string;
  content: string;
  authorName?: string;
  createdAt?: string;
}

interface CommentThread {
  id: string;
  resolved: boolean;
  createdAt?: string;
  authorName?: string;
  itemId?: string;
  messages: CommentMessage[];
  replyCount: number;
}

interface CommentThreadsResult {
  boardId: string;
  boardName: string;
  viewLink: string;
  threads: CommentThread[];
  openCount: number;
  resolvedCount: number;
  total: number;
}

type Filter = "open" | "resolved" | "all";

const appEl = document.getElementById("app")!;
const boardNameEl = document.getElementById("board-name")!;
const subtitleEl = document.getElementById("subtitle")!;
const filtersEl = document.getElementById("filters")!;
const threadsEl = document.getElementById("threads")!;
const countSummaryEl = document.getElementById("count-summary")!;
const openBoardBtn = document.getElementById(
  "open-board-btn",
) as HTMLButtonElement;

let currentData: CommentThreadsResult | null = null;

// Open threads are the ones needing action, so that is where the view starts.
// Resolved threads stay one click away rather than padding the default list.
let activeFilter: Filter = "open";

function extractData(result: CallToolResult): CommentThreadsResult | null {
  const sc = result.structuredContent as
    Partial<CommentThreadsResult> | undefined;
  if (!sc?.boardId || !sc.boardName || !Array.isArray(sc.threads)) return null;
  return sc as CommentThreadsResult;
}

function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function visibleThreads(): CommentThread[] {
  if (!currentData) return [];
  switch (activeFilter) {
    case "open":
      return currentData.threads.filter((t) => !t.resolved);
    case "resolved":
      return currentData.threads.filter((t) => t.resolved);
    default:
      return currentData.threads;
  }
}

function renderFilters() {
  if (!currentData) return;
  filtersEl.replaceChildren();

  const options: Array<{ key: Filter; label: string; count: number }> = [
    { key: "open", label: "Open", count: currentData.openCount },
    { key: "resolved", label: "Resolved", count: currentData.resolvedCount },
    { key: "all", label: "All", count: currentData.threads.length },
  ];

  for (const opt of options) {
    const btn = document.createElement("button");
    btn.className = "chip";
    btn.type = "button";
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-pressed", String(opt.key === activeFilter));
    const label = document.createElement("span");
    label.textContent = opt.label;
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = String(opt.count);
    btn.append(label, count);
    btn.addEventListener("click", () => {
      activeFilter = opt.key;
      renderFilters();
      renderThreads();
    });
    filtersEl.appendChild(btn);
  }
}

/** Renders one message: author, timestamp, body. */
function renderMessage(msg: CommentMessage, isReply: boolean): HTMLElement {
  const el = document.createElement("div");
  el.className = isReply ? "message reply" : "message";

  const meta = document.createElement("p");
  meta.className = "message-meta";
  const author = document.createElement("span");
  author.className = "author";
  // An author can be absent — a deleted user, or an integration. Say so
  // rather than rendering a blank where a name belongs.
  author.textContent = msg.authorName || "Unknown author";
  meta.appendChild(author);
  const when = formatDate(msg.createdAt);
  if (when) {
    const time = document.createElement("span");
    time.className = "when";
    time.textContent = when;
    meta.appendChild(time);
  }

  const body = document.createElement("p");
  body.className = "message-body";
  // Content arrives as HTML from the API and is stripped to plain text
  // server-side; textContent keeps it text regardless.
  body.textContent = msg.content || "(no text)";

  el.append(meta, body);
  return el;
}

function renderThreadCard(thread: CommentThread): HTMLElement {
  const card = document.createElement("article");
  card.className = thread.resolved ? "thread resolved" : "thread";

  const head = document.createElement("div");
  head.className = "thread-head";

  const status = document.createElement("span");
  status.className = thread.resolved ? "status resolved" : "status open";
  status.textContent = thread.resolved ? "Resolved" : "Open";
  head.appendChild(status);

  // Only anchored threads have an item. An unanchored one has no location to
  // show: the API accepts x/y on create and then ignores them.
  if (thread.itemId) {
    const anchor = document.createElement("span");
    anchor.className = "anchor";
    anchor.textContent = `on item ${thread.itemId}`;
    head.appendChild(anchor);
  }

  if (thread.replyCount > 0) {
    const replies = document.createElement("span");
    replies.className = "reply-count";
    replies.textContent = `${thread.replyCount} ${thread.replyCount === 1 ? "reply" : "replies"}`;
    head.appendChild(replies);
  }

  card.appendChild(head);

  if (thread.messages.length === 0) {
    const empty = document.createElement("p");
    empty.className = "message-body empty";
    empty.textContent = "(thread has no messages)";
    card.appendChild(empty);
  } else {
    thread.messages.forEach((msg, i) => {
      card.appendChild(renderMessage(msg, i > 0));
    });
  }

  if (currentData?.viewLink) {
    card.classList.add("clickable");
    card.addEventListener("click", async () => {
      try {
        await app.openLink({ url: currentData!.viewLink });
      } catch (e) {
        console.error("Open link failed:", e);
      }
    });
  }

  return card;
}

function renderThreads() {
  if (!currentData) return;
  threadsEl.replaceChildren();

  const threads = visibleThreads();
  if (threads.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    // Distinguish "this board has no comments" from "none match the filter" —
    // otherwise an empty Open tab reads as a broken fetch.
    empty.textContent =
      currentData.threads.length === 0
        ? "No comment threads on this board."
        : activeFilter === "open"
          ? "No open threads. Every comment here is resolved."
          : "No resolved threads yet.";
    threadsEl.appendChild(empty);
    countSummaryEl.textContent = "0 threads shown";
    return;
  }

  for (const thread of threads) {
    threadsEl.appendChild(renderThreadCard(thread));
  }

  const shown = `${threads.length} of ${currentData.threads.length} threads shown`;
  // The API reports a total that can exceed what was fetched; saying so beats
  // letting the reader assume they are seeing everything.
  countSummaryEl.textContent =
    currentData.total > currentData.threads.length
      ? `${shown} (${currentData.total} on the board)`
      : shown;
}

function render(data: CommentThreadsResult) {
  currentData = data;
  activeFilter = "open";
  boardNameEl.textContent = data.boardName;
  subtitleEl.textContent = `${data.openCount} open, ${data.resolvedCount} resolved`;
  openBoardBtn.disabled = !data.viewLink;
  renderFilters();
  renderThreads();
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

const app = new App({ name: "Miro Comment Threads", version: "0.1.0" });

app.ontoolresult = (result) => {
  const data = extractData(result);
  if (!data) {
    renderError("Server returned no comment data.");
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
