/**
 * Thin Miro REST API wrapper. Reuses MIRO_ACCESS_TOKEN env var that the Go
 * miro-mcp-server uses (same OAuth token, no separate credential needed).
 */

const MIRO_API_BASE = "https://api.miro.com/v2";

// Comments live only on v2-experimental. The endpoints are live but absent from
// Miro's OpenAPI spec — confirmed by live probe from the Go server on
// 13-08-2026 — so spec absence is not evidence they do not exist.
const MIRO_API_EXPERIMENTAL_BASE = "https://api.miro.com/v2-experimental";

function getToken(): string {
  const token = process.env.MIRO_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "MIRO_ACCESS_TOKEN env var not set. " +
        "Reuses the same token as the Go miro-mcp-server.",
    );
  }
  return token;
}

async function miroFetch<T>(
  path: string,
  base: string = MIRO_API_BASE,
): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    headers: {
      Authorization: `Bearer ${getToken()}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 403 and 404 are ambiguous on the experimental API: they mean either a
    // genuinely missing board or that the account/plan has no access to the
    // experimental surface at all. Say so, rather than leave the caller
    // hunting a board ID that was never the problem.
    const hint =
      base === MIRO_API_EXPERIMENTAL_BASE &&
      (res.status === 403 || res.status === 404)
        ? " (this is a v2-experimental endpoint and may be unavailable for your account or plan)"
        : "";
    throw new Error(
      `Miro API ${res.status} ${res.statusText} for ${path}${hint}: ${body.slice(0, 200)}`,
    );
  }
  return (await res.json()) as T;
}

// ---- Types: minimal subset of Miro REST API responses ----

/** A Miro user reference, as returned on a board's owner. */
export interface BoardUser {
  id: string;
  name?: string;
}

/** The team a board belongs to. */
export interface BoardTeam {
  id: string;
  name?: string;
}

export interface Board {
  id: string;
  name: string;
  description: string;
  viewLink: string;
  modifiedAt?: string;
  createdAt?: string;
  // GET /v2/boards returns these on every board in the page, so surfacing them
  // costs no extra request. They were simply absent from this projection.
  owner?: BoardUser;
  team?: BoardTeam;
}

export interface BoardItem {
  id: string;
  type: string;
  data?: {
    content?: string;
    title?: string;
    shape?: string;
  };
  style?: {
    fillColor?: string;
    borderColor?: string;
  };
  position?: { x: number; y: number };
  geometry?: { width?: number; height?: number };
  modifiedAt?: string;
  links?: { self?: string };
}

export interface BoardItemsResponse {
  data: BoardItem[];
  total: number;
  size: number;
  links?: { self?: string; next?: string };
}

export interface BoardsResponse {
  data: Board[];
  total: number;
  size: number;
  links?: { self?: string; next?: string };
}

export interface Connector {
  id: string;
  shape?: string;
  startItem?: { id: string };
  endItem?: { id: string };
  captions?: Array<{ content?: string }>;
  modifiedAt?: string;
}

export interface ConnectorsResponse {
  data: Connector[];
  total: number;
  size: number;
  links?: { self?: string; next?: string };
}

// ---- API methods ----

export async function getBoard(boardId: string): Promise<Board> {
  return miroFetch<Board>(`/boards/${encodeURIComponent(boardId)}`);
}

export async function listBoardItems(
  boardId: string,
  opts: { limit?: number; type?: string } = {},
): Promise<BoardItemsResponse> {
  const params = new URLSearchParams();
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.type) params.set("type", opts.type);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return miroFetch<BoardItemsResponse>(
    `/boards/${encodeURIComponent(boardId)}/items${qs}`,
  );
}

export async function listBoards(
  opts: { limit?: number; sort?: string } = {},
): Promise<BoardsResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(opts.limit ?? 20));
  if (opts.sort) params.set("sort", opts.sort);
  return miroFetch<BoardsResponse>(`/boards?${params.toString()}`);
}

export async function listConnectors(
  boardId: string,
  opts: { limit?: number } = {},
): Promise<ConnectorsResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(opts.limit ?? 50));
  return miroFetch<ConnectorsResponse>(
    `/boards/${encodeURIComponent(boardId)}/connectors?${params.toString()}`,
  );
}

// ---- Derived data shapes for the two UI tools ----

export interface BoardSummary {
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

export async function buildBoardSummary(
  boardId: string,
): Promise<BoardSummary> {
  const [board, items] = await Promise.all([
    getBoard(boardId),
    listBoardItems(boardId, { limit: 50 }),
  ]);

  const itemCounts: Record<string, number> = {};
  for (const item of items.data) {
    itemCounts[item.type] = (itemCounts[item.type] ?? 0) + 1;
  }

  const recentItems = items.data
    .slice()
    .sort((a, b) => (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? ""))
    .slice(0, 5)
    .map((item) => ({
      id: item.id,
      type: item.type,
      label: deriveLabel(item),
      modifiedAt: item.modifiedAt,
    }));

  return {
    id: board.id,
    name: board.name,
    description: board.description,
    viewLink: board.viewLink,
    totalItems: items.total,
    itemCounts,
    recentItems,
    modifiedAt: board.modifiedAt,
  };
}

export interface ListItemsResult {
  boardId: string;
  boardName: string;
  viewLink: string;
  items: Array<{
    id: string;
    type: string;
    label: string;
    modifiedAt?: string;
    selfLink?: string;
  }>;
}

export async function buildListItems(
  boardId: string,
  opts: { limit?: number; type?: string } = {},
): Promise<ListItemsResult> {
  const [board, items] = await Promise.all([
    getBoard(boardId),
    listBoardItems(boardId, { limit: opts.limit ?? 100, type: opts.type }),
  ]);

  return {
    boardId: board.id,
    boardName: board.name,
    viewLink: board.viewLink,
    items: items.data.map((item) => ({
      id: item.id,
      type: item.type,
      label: deriveLabel(item),
      modifiedAt: item.modifiedAt,
      selfLink: item.links?.self,
    })),
  };
}

function deriveLabel(item: BoardItem): string {
  const data = item.data ?? {};
  const raw = data.title ?? data.content ?? data.shape ?? "";
  const stripped = String(raw)
    .replace(/<[^>]+>/g, "")
    .trim();
  if (stripped)
    return stripped.length > 80 ? stripped.slice(0, 77) + "…" : stripped;
  return `${item.type} ${item.id.slice(0, 8)}`;
}

// ---- Tool 3: frame_overview ----

export interface FrameOverviewResult {
  boardId: string;
  boardName: string;
  viewLink: string;
  frames: Array<{
    id: string;
    title: string;
    width?: number;
    height?: number;
    modifiedAt?: string;
    selfLink?: string;
  }>;
}

export async function buildFrameOverview(
  boardId: string,
): Promise<FrameOverviewResult> {
  const [board, frames] = await Promise.all([
    getBoard(boardId),
    listBoardItems(boardId, { type: "frame", limit: 50 }),
  ]);
  return {
    boardId: board.id,
    boardName: board.name,
    viewLink: board.viewLink,
    frames: frames.data.map((f) => ({
      id: f.id,
      title: deriveLabel(f),
      width: f.geometry?.width,
      height: f.geometry?.height,
      modifiedAt: f.modifiedAt,
      selfLink: f.links?.self,
    })),
  };
}

// ---- Tool 4: sticky_clusters ----

export interface StickyClustersResult {
  boardId: string;
  boardName: string;
  viewLink: string;
  totalStickies: number;
  clusters: Array<{
    color: string;
    count: number;
    stickies: Array<{
      id: string;
      label: string;
      selfLink?: string;
    }>;
  }>;
}

export async function buildStickyClusters(
  boardId: string,
): Promise<StickyClustersResult> {
  const [board, items] = await Promise.all([
    getBoard(boardId),
    listBoardItems(boardId, { type: "sticky_note", limit: 50 }),
  ]);
  const groups = new Map<
    string,
    Array<{ id: string; label: string; selfLink?: string }>
  >();
  for (const item of items.data) {
    const color = item.style?.fillColor || "unknown";
    if (!groups.has(color)) groups.set(color, []);
    groups.get(color)!.push({
      id: item.id,
      label: deriveLabel(item),
      selfLink: item.links?.self,
    });
  }
  const clusters = Array.from(groups.entries())
    .map(([color, stickies]) => ({ color, count: stickies.length, stickies }))
    .sort((a, b) => b.count - a.count);
  return {
    boardId: board.id,
    boardName: board.name,
    viewLink: board.viewLink,
    totalStickies: items.data.length,
    clusters,
  };
}

// ---- Tool 5: recent_boards ----

export interface RecentBoardsResult {
  boards: Array<{
    id: string;
    name: string;
    description: string;
    viewLink: string;
    modifiedAt?: string;
    createdAt?: string;
    ownerName?: string;
    teamId?: string;
    teamName?: string;
  }>;
}

export async function buildRecentBoards(
  limit: number = 20,
): Promise<RecentBoardsResult> {
  const res = await listBoards({ limit, sort: "last_modified" });
  return {
    boards: res.data.map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
      viewLink: b.viewLink,
      modifiedAt: b.modifiedAt,
      createdAt: b.createdAt,
      // Flattened rather than nested: the view renders owner and team as
      // chips, and a nested object would make it walk two levels for one
      // string. Absent values stay undefined rather than becoming "", so the
      // view branches on presence instead of on emptiness.
      ownerName: b.owner?.name,
      teamId: b.team?.id,
      teamName: b.team?.name,
    })),
  };
}

// ---- Tool 6: connectors graph ----

export interface ConnectorsGraphResult {
  boardId: string;
  boardName: string;
  viewLink: string;
  nodes: Array<{
    id: string;
    type: string;
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  edges: Array<{
    id: string;
    from: string;
    to: string;
    caption?: string;
  }>;
}

function collectReferencedIds(connectors: Connector[]): Set<string> {
  const referencedIds = new Set<string>();
  for (const c of connectors) {
    if (c.startItem?.id) referencedIds.add(c.startItem.id);
    if (c.endItem?.id) referencedIds.add(c.endItem.id);
  }
  return referencedIds;
}

function toGraphNode(item: BoardItem): ConnectorsGraphResult["nodes"][number] {
  return {
    id: item.id,
    type: item.type,
    label: deriveLabel(item),
    x: item.position?.x ?? 0,
    y: item.position?.y ?? 0,
    width: item.geometry?.width ?? 100,
    height: item.geometry?.height ?? 100,
  };
}

function cleanCaption(
  captions?: Array<{ content?: string }>,
): string | undefined {
  return captions?.[0]?.content
    ?.replace(/<[^>]+>/g, "")
    .trim()
    .slice(0, 40);
}

function toGraphEdge(c: Connector): ConnectorsGraphResult["edges"][number] {
  return {
    id: c.id,
    from: c.startItem!.id,
    to: c.endItem!.id,
    caption: cleanCaption(c.captions),
  };
}

export async function buildConnectorsGraph(
  boardId: string,
): Promise<ConnectorsGraphResult> {
  const [board, items, connectors] = await Promise.all([
    getBoard(boardId),
    listBoardItems(boardId, { limit: 50 }),
    listConnectors(boardId, { limit: 50 }),
  ]);

  const referencedIds = collectReferencedIds(connectors.data);
  const nodes = items.data
    .filter((i) => referencedIds.has(i.id))
    .map(toGraphNode);
  const edges = connectors.data
    .filter((c) => c.startItem?.id && c.endItem?.id)
    .map(toGraphEdge);

  return {
    boardId: board.id,
    boardName: board.name,
    viewLink: board.viewLink,
    nodes,
    edges,
  };
}

// ---- Tool 7: comment threads ----

/**
 * Wire shape of a comment thread. A "comment" in this API is a THREAD, not a
 * single message: the text lives in messages[], and the first message is the
 * one that opened it.
 *
 * position.type is "attached" when the thread is anchored to an item, in which
 * case itemId names it. Threads created without an item land unanchored — the
 * API accepts x/y on create and then ignores them, per the Go server's live
 * probe, so an unanchored thread has no meaningful location to show.
 */
interface ApiCommentThread {
  id: string;
  resolved?: boolean;
  createdAt?: string;
  createdBy?: { id: string; name?: string };
  position?: { type?: string; itemId?: string };
  messages?: Array<{
    id: string;
    content?: string;
    createdAt?: string;
    createdBy?: { id: string; name?: string };
  }>;
}

interface CommentsResponse {
  data: ApiCommentThread[];
  total?: number;
  offset?: number;
  size?: number;
}

export interface CommentMessageView {
  id: string;
  content: string;
  authorName?: string;
  createdAt?: string;
}

export interface CommentThreadView {
  id: string;
  resolved: boolean;
  createdAt?: string;
  authorName?: string;
  /** Set only when the thread is anchored to a board item. */
  itemId?: string;
  messages: CommentMessageView[];
  replyCount: number;
}

export interface CommentThreadsResult {
  boardId: string;
  boardName: string;
  viewLink: string;
  threads: CommentThreadView[];
  openCount: number;
  resolvedCount: number;
  /** Total the API reports, which may exceed the threads fetched. */
  total: number;
}

export async function listComments(
  boardId: string,
  limit: number = 50,
): Promise<CommentsResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  return miroFetch<CommentsResponse>(
    `/boards/${encodeURIComponent(boardId)}/comments?${params.toString()}`,
    MIRO_API_EXPERIMENTAL_BASE,
  );
}

/**
 * Strips the HTML Miro returns in comment content down to plain text.
 *
 * The view sets every string via textContent, so this is not the security
 * boundary — it is here so a comment reads as prose rather than as markup.
 * Mirrors the same treatment connector captions already get above.
 */
function stripHtml(html: string | undefined): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function buildCommentThreads(
  boardId: string,
  limit: number = 50,
): Promise<CommentThreadsResult> {
  const [board, comments] = await Promise.all([
    getBoard(boardId),
    listComments(boardId, limit),
  ]);

  const threads: CommentThreadView[] = comments.data.map((t) => {
    const messages = (t.messages ?? []).map((m) => ({
      id: m.id,
      content: stripHtml(m.content),
      authorName: m.createdBy?.name,
      createdAt: m.createdAt,
    }));
    return {
      id: t.id,
      resolved: t.resolved === true,
      createdAt: t.createdAt,
      authorName: t.createdBy?.name,
      // Only an "attached" thread has an item; anything else is unanchored
      // and has no location worth showing.
      itemId: t.position?.type === "attached" ? t.position?.itemId : undefined,
      messages,
      // The opening message is not a reply, so a thread with one message has
      // zero replies rather than one.
      replyCount: Math.max(0, messages.length - 1),
    };
  });

  const resolvedCount = threads.filter((t) => t.resolved).length;

  return {
    boardId: board.id,
    boardName: board.name,
    viewLink: board.viewLink,
    threads,
    openCount: threads.length - resolvedCount,
    resolvedCount,
    total: comments.total ?? threads.length,
  };
}

// ---- Tool 8: board SVG ----
//
// TypeScript rewrite of the Go server's miro/svg_read.go geometry (bounds
// accumulation, per-type rendering, connectors between item centers). The
// mapping is deliberately flat: frames and cards become outlined rects,
// stickies and shapes become filled rects or ellipses, text becomes labels,
// connectors become lines between item centers. Items with no useful geometry
// are counted as skipped rather than guessed at.
//
// One deliberate deviation from the Go reference: Go passes style.fillColor
// into the SVG fill attribute raw, but Miro returns NAMED colors on sticky
// notes ("light_yellow"), which are not valid SVG paint. Named colors are
// normalized to hex here (same palette as the sticky-clusters view).

/** Item cap for a render when the caller does not specify one. */
const DEFAULT_SVG_ITEMS = 500;
/** Hard cap on the item fetch for a render. */
const MAX_SVG_ITEMS = 2000;
/** Miro's per-page maximum for the items endpoint. */
const ITEMS_PAGE_LIMIT = 50;

/** Miro named fill colors → hex. Sticky enums use the sticky-clusters view's
 * swatch palette; plain names cover the hex-only fields' common inputs. */
const NAMED_FILL: Record<string, string> = {
  yellow: "#fef08a",
  light_yellow: "#fef9c3",
  orange: "#fed7aa",
  light_orange: "#ffedd5",
  red: "#fecaca",
  light_red: "#fee2e2",
  pink: "#fbcfe8",
  light_pink: "#fce7f3",
  violet: "#ddd6fe",
  light_violet: "#ede9fe",
  blue: "#bfdbfe",
  light_blue: "#dbeafe",
  cyan: "#a5f3fc",
  light_cyan: "#cffafe",
  green: "#bbf7d0",
  light_green: "#dcfce7",
  gray: "#e5e7eb",
  light_gray: "#f3f4f6",
  dark_blue: "#93c5fd",
  dark_green: "#86efac",
  black: "#1f2937",
  white: "#ffffff",
};

export interface SvgRect {
  id: string;
  itemType: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Corner radius: 4 for sticky/card boxes, 0 for shapes and frames. */
  rx: number;
  /** Resolved SVG paint; "none" for frames. */
  fill: string;
  /** True for frames, which render as dashed outlines. */
  dashed: boolean;
}

export interface SvgEllipse {
  id: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  fill: string;
}

export interface SvgLine {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SvgLabel {
  x: number;
  y: number;
  text: string;
  fontSize: number;
  /** SVG text-anchor. Frame titles are "start", everything else "middle". */
  anchor: string;
  /** Secondary-color text: frame titles and connector captions. */
  muted: boolean;
  /**
   * Width budget in board units: the label is only worth drawing when it fits
   * this space at the current zoom. 0 means always draw (frame titles and
   * connector captions sit outside any box and stay sparse).
   */
  maxWidth: number;
  /**
   * True when the label sits on a filled item (shape or box) and needs dark
   * ink; false for labels on the canvas background (standalone text, frame
   * titles, captions), which take the host theme's text color.
   */
  onFill: boolean;
}

export interface BoardSvgResult {
  boardId: string;
  boardName: string;
  viewLink: string;
  /** Fitted to the rendered bounds with 20 units of padding. */
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

/** Follows links.next cursors until maxItems items are fetched or the pages
 * run out. Returns the API's own total alongside the fetched page union. */
async function listAllBoardItems(
  boardId: string,
  maxItems: number,
): Promise<{ items: BoardItem[]; total: number; truncated: boolean }> {
  const items: BoardItem[] = [];
  let total = 0;
  let cursor: string | undefined;

  for (;;) {
    const params = new URLSearchParams();
    params.set(
      "limit",
      String(Math.min(ITEMS_PAGE_LIMIT, maxItems - items.length)),
    );
    if (cursor) params.set("cursor", cursor);
    const page = await miroFetch<BoardItemsResponse>(
      `/boards/${encodeURIComponent(boardId)}/items?${params.toString()}`,
    );
    items.push(...page.data);
    total = page.total;
    const next = page.links?.next;
    if (!next || items.length >= maxItems) {
      return { items, total, truncated: Boolean(next) };
    }
    cursor = new URL(next).searchParams.get("cursor") ?? undefined;
    if (!cursor) return { items, total, truncated: true };
  }
}

function clampSvgMaxItems(n: number | undefined): number {
  if (n && n > 0 && n <= MAX_SVG_ITEMS) return n;
  return DEFAULT_SVG_ITEMS;
}

/** An item carries enough geometry to draw when it has an area, or is text
 * (which gets a width estimated from its label). */
function svgRenderable(item: BoardItem): boolean {
  const w = item.geometry?.width ?? 0;
  const h = item.geometry?.height ?? 0;
  return (w > 0 && h > 0) || item.type === "text";
}

function svgFill(item: BoardItem): string {
  const c = item.style?.fillColor ?? "";
  if (/^#[0-9a-fA-F]{3,8}$/.test(c)) return c;
  if (c && NAMED_FILL[c]) return NAMED_FILL[c];
  switch (item.type) {
    case "sticky_note":
      return "#fff9b1"; // Miro's default yellow
    case "frame":
      return "none";
    default:
      return "#e6e6e6";
  }
}

function svgLabelText(content: string | undefined): string {
  const s = stripHtml(content);
  return s.length > 60 ? s.slice(0, 57) + "..." : s;
}

class SvgBounds {
  minX = 0;
  minY = 0;
  maxX = 0;
  maxY = 0;
  private set = false;

  add(x: number, y: number, w: number, h: number): void {
    if (!this.set) {
      this.minX = x;
      this.minY = y;
      this.maxX = x + w;
      this.maxY = y + h;
      this.set = true;
      return;
    }
    this.minX = Math.min(this.minX, x);
    this.minY = Math.min(this.minY, y);
    this.maxX = Math.max(this.maxX, x + w);
    this.maxY = Math.max(this.maxY, y + h);
  }

  /** ViewBox fitted to the accumulated bounds, padded; a fallback box when
   * nothing rendered. */
  viewBox(pad: number): BoardSvgResult["viewBox"] {
    if (!this.set) return { x: 0, y: 0, width: 100, height: 100 };
    return {
      x: this.minX - pad,
      y: this.minY - pad,
      width: this.maxX - this.minX + 2 * pad,
      height: this.maxY - this.minY + 2 * pad,
    };
  }
}

interface SvgAccumulator {
  rects: SvgRect[];
  ellipses: SvgEllipse[];
  lines: SvgLine[];
  labels: SvgLabel[];
  bounds: SvgBounds;
}

function renderSvgItem(acc: SvgAccumulator, item: BoardItem): boolean {
  if (!svgRenderable(item)) return false;
  const label = svgLabelText(item.data?.title ?? item.data?.content);
  const cx = item.position?.x ?? 0;
  const cy = item.position?.y ?? 0;
  const w = item.geometry?.width ?? 0;
  const h = item.geometry?.height ?? 0;

  switch (item.type) {
    case "text": {
      const textW = w > 0 ? w : label.length * 8;
      acc.bounds.add(cx - textW / 2, cy - 10, textW, 20);
      acc.labels.push({
        x: cx,
        y: cy,
        text: label,
        fontSize: 14,
        anchor: "middle",
        muted: false,
        maxWidth: textW,
        onFill: false,
      });
      return true;
    }
    case "shape": {
      acc.bounds.add(cx - w / 2, cy - h / 2, w, h);
      if (item.data?.shape === "circle") {
        acc.ellipses.push({
          id: item.id,
          cx,
          cy,
          rx: w / 2,
          ry: h / 2,
          fill: svgFill(item),
        });
      } else {
        acc.rects.push({
          id: item.id,
          itemType: "shape",
          x: cx - w / 2,
          y: cy - h / 2,
          width: w,
          height: h,
          rx: 0,
          fill: svgFill(item),
          dashed: false,
        });
      }
      if (label) {
        acc.labels.push({
          x: cx,
          y: cy,
          text: label,
          fontSize: 12,
          anchor: "middle",
          muted: false,
          maxWidth: w,
          onFill: true,
        });
      }
      return true;
    }
    case "frame": {
      acc.bounds.add(cx - w / 2, cy - h / 2, w, h);
      acc.rects.push({
        id: item.id,
        itemType: "frame",
        x: cx - w / 2,
        y: cy - h / 2,
        width: w,
        height: h,
        rx: 0,
        fill: "none",
        dashed: true,
      });
      if (label) {
        acc.labels.push({
          x: cx - w / 2 + 4,
          y: cy - h / 2 - 6,
          text: label,
          fontSize: 12,
          anchor: "start",
          muted: true,
          maxWidth: 0,
          onFill: false,
        });
      }
      return true;
    }
    case "sticky_note":
    case "card":
    case "app_card":
    case "image":
    case "document": {
      acc.bounds.add(cx - w / 2, cy - h / 2, w, h);
      acc.rects.push({
        id: item.id,
        itemType: item.type,
        x: cx - w / 2,
        y: cy - h / 2,
        width: w,
        height: h,
        rx: 4,
        fill: svgFill(item),
        dashed: false,
      });
      if (label) {
        acc.labels.push({
          x: cx,
          y: cy,
          text: label,
          fontSize: 12,
          anchor: "middle",
          muted: false,
          maxWidth: w,
          onFill: true,
        });
      }
      return true;
    }
    default:
      return false;
  }
}

function renderSvgConnectors(
  acc: SvgAccumulator,
  connectors: Connector[],
  byId: Map<string, BoardItem>,
): void {
  for (const conn of connectors) {
    const from = conn.startItem?.id ? byId.get(conn.startItem.id) : undefined;
    const to = conn.endItem?.id ? byId.get(conn.endItem.id) : undefined;
    if (!from || !to) continue;
    const x1 = from.position?.x ?? 0;
    const y1 = from.position?.y ?? 0;
    const x2 = to.position?.x ?? 0;
    const y2 = to.position?.y ?? 0;
    acc.lines.push({ id: conn.id, x1, y1, x2, y2 });
    const caption = svgLabelText(conn.captions?.[0]?.content);
    if (caption) {
      acc.labels.push({
        x: (x1 + x2) / 2,
        y: (y1 + y2) / 2 - 4,
        text: caption,
        fontSize: 10,
        anchor: "middle",
        muted: true,
        maxWidth: 0,
        onFill: false,
      });
    }
  }
}

export async function buildBoardSvg(
  boardId: string,
  maxItems?: number,
): Promise<BoardSvgResult> {
  const [board, itemsPage] = await Promise.all([
    getBoard(boardId),
    listAllBoardItems(boardId, clampSvgMaxItems(maxItems)),
  ]);

  // Connectors are best-effort decoration; a failure there shouldn't sink
  // the render.
  let connectors: Connector[] = [];
  try {
    connectors = (await listConnectors(boardId, { limit: 50 })).data;
  } catch {
    // v2 connectors listing failed; render items without edges.
  }

  const byId = new Map(itemsPage.items.map((i) => [i.id, i]));
  const acc: SvgAccumulator = {
    rects: [],
    ellipses: [],
    lines: [],
    labels: [],
    bounds: new SvgBounds(),
  };

  // Two passes: frames first, so they sit under their children.
  let rendered = 0;
  let skipped = 0;
  for (const framesPass of [true, false]) {
    for (const item of itemsPage.items) {
      if ((item.type === "frame") !== framesPass) continue;
      if (renderSvgItem(acc, item)) rendered++;
      else skipped++;
    }
  }
  renderSvgConnectors(acc, connectors, byId);

  return {
    boardId: board.id,
    boardName: board.name,
    viewLink: board.viewLink,
    viewBox: acc.bounds.viewBox(20),
    rects: acc.rects,
    ellipses: acc.ellipses,
    lines: acc.lines,
    labels: acc.labels,
    rendered,
    skipped,
    totalItems: itemsPage.total,
    truncated: itemsPage.truncated,
  };
}
