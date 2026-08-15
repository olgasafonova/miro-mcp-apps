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
    imageUrl?: string;
  };
  style?: {
    fillColor?: string;
    borderColor?: string;
  };
  position?: { x: number; y: number; relativeTo?: string };
  geometry?: { width?: number; height?: number };
  parent?: { id?: string };
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
// TypeScript rewrite of the Go server's miro/svg_read.go geometry, upgraded
// for fidelity: real shape kinds, real border/fill styles, and text that
// scales with the board — zoomed out it looks like Miro's own minimap,
// zoomed in the text becomes readable, exactly as the real canvas behaves.
//
// Deliberate deviations from the Go reference:
// - Named Miro colors normalize to hex ("light_yellow" is not valid SVG paint).
// - Labels are wrapped word-by-word into lines in board units (Miro-like
//   scaling) instead of one fixed-size line.
// - Image bits are NOT embedded: on the probe board every image item's
//   data.imageUrl pointed at resources/images/0, which the API rejects with
//   400 "resource_id: Has illegal integer number value" (probed 15-08-2026).
//   Image items render as a placeholder frame with a glyph instead.

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
  /** Miro shape kind (round_rectangle, cloud, triangle, …); "" for non-shapes. */
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Resolved SVG paint; "none" for frames and unfilled shapes. */
  fill: string;
  /** 0..1; Miro's fillOpacity, 1 when unset. */
  fillOpacity: number;
  /** Border paint; "none" for stickies. */
  stroke: string;
  /** Border width in board units. */
  strokeWidth: number;
  /** normal | dashed | dotted (Miro borderStyle). */
  strokeStyle: string;
}

export interface SvgEllipse {
  id: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeWidth: number;
}

export interface SvgLine {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SvgLabel {
  /** Anchor x: block center for "middle", left edge for "start". */
  x: number;
  /** Vertical center of the text block. */
  y: number;
  /** Pre-wrapped lines, in board units of the fontSize below. */
  lines: string[];
  /** Font size in board units — text scales with zoom, like Miro's canvas. */
  fontSize: number;
  lineHeight: number;
  anchor: string;
  /** Text paint (style.color when set, sensible default otherwise). */
  color: string;
}

export interface SvgImage {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** data: URI with the image preview bits, fetched server-side. */
  href: string;
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
  images: SvgImage[];
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
 * (which gets a width estimated from its content). */
function svgRenderable(item: BoardItem): boolean {
  const w = item.geometry?.width ?? 0;
  const h = item.geometry?.height ?? 0;
  return (w > 0 && h > 0) || item.type === "text";
}

function resolvePaint(c: string | undefined): string | undefined {
  if (!c) return undefined;
  if (/^#[0-9a-fA-F]{3,8}$/.test(c)) return c;
  return NAMED_FILL[c];
}

function svgFill(item: BoardItem): string {
  const explicit = resolvePaint(item.style?.fillColor);
  if (explicit) return explicit;
  switch (item.type) {
    case "sticky_note":
      return "#fff9b1"; // Miro's default yellow
    case "shape":
      return "none"; // Miro's default shape is border-only
    case "frame":
      return "none";
    case "image":
      return "#f1f5f9";
    default:
      return "#ffffff";
  }
}

interface ItemStyle {
  fillColor?: string;
  borderColor?: string;
  borderWidth?: number | string;
  borderStyle?: string;
  borderOpacity?: number | string;
  fillOpacity?: number | string;
  color?: string;
  fontSize?: number | string;
}

function asNumber(v: number | string | undefined, fallback: number): number {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return n !== undefined && Number.isFinite(n) ? n : fallback;
}

/**
 * Greedy word wrap into at most maxLines lines of roughly maxChars each.
 * Board-unit fonts make the budget deterministic: it depends only on the
 * item's width, never on zoom.
 */
function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  if (!text || maxLines < 1) return [];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? line + " " + word : word;
    if (candidate.length <= maxChars || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && line && lines[maxLines - 1] !== line) {
    lines[maxLines - 1] =
      lines[maxLines - 1].slice(0, Math.max(1, maxChars - 1)) + "…";
  }
  return lines;
}

/** Rough advance width of a glyph as a fraction of the font size. */
const SVG_GLYPH_FACTOR = 0.6;

/** Builds a wrapped, board-scaled label block centered on the item. */
function itemLabel(
  item: BoardItem,
  cx: number,
  cy: number,
  w: number,
  h: number,
): SvgLabel | null {
  const text = stripHtml(item.data?.title ?? item.data?.content).slice(0, 300);
  if (!text) return null;
  const style = (item.style ?? {}) as ItemStyle;
  // Stickies auto-size their text in Miro; approximate from the sticky's
  // height. Everything else honors style.fontSize.
  const fontSize =
    item.type === "sticky_note"
      ? Math.min(40, Math.max(10, h * 0.09))
      : asNumber(style.fontSize, 14);
  const lineHeight = fontSize * 1.25;
  const maxChars = Math.max(3, Math.floor((w * 0.9) / (fontSize * SVG_GLYPH_FACTOR)));
  const maxLines = Math.max(1, Math.floor((h * 0.85) / lineHeight));
  const lines = wrapText(text, maxChars, maxLines);
  if (lines.length === 0) return null;
  return {
    x: cx,
    y: cy,
    lines,
    fontSize,
    lineHeight,
    anchor: "middle",
    color: resolvePaint(style.color) ?? style.color ?? "#1c1917",
  };
}

// Image embedding: structuredContent reaches the model's context as well as
// the view, so image bits get a hard budget — preview format only, capped
// per image and in total. Anything over budget (or unfetchable, like the
// template-cloned items whose imageUrl carries resource id 0) falls back to
// the placeholder glyph.
const MAX_EMBED_IMAGES = 20;
const MAX_IMAGE_BYTES = 200_000;
const MAX_TOTAL_IMAGE_BYTES = 1_500_000;
const IMAGE_FETCH_BATCH = 6;

async function fetchImageDataUri(imageUrl: string): Promise<string | null> {
  try {
    // Known-broken: template-cloned images carry resource id 0, which the
    // API rejects with 400 (probed 15-08-2026).
    if (imageUrl.includes("/resources/images/0?")) return null;
    const res = await fetch(imageUrl, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    let bytes: ArrayBuffer;
    let mime = ct;
    if (ct.includes("application/json")) {
      // redirect=false form: a JSON doc with a signed, time-limited CDN URL.
      const doc = (await res.json()) as { url?: string };
      if (!doc.url) return null;
      const cdn = await fetch(doc.url);
      if (!cdn.ok) return null;
      mime = cdn.headers.get("content-type") ?? "image/png";
      bytes = await cdn.arrayBuffer();
    } else {
      bytes = await res.arrayBuffer();
    }
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES)
      return null;
    return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
}

/** Fetches previews for up to MAX_EMBED_IMAGES image items, in small
 * batches, stopping when the total budget is spent. */
async function fetchImageHrefs(
  items: BoardItem[],
): Promise<Map<string, string>> {
  const candidates = items
    .filter((it) => it.type === "image" && it.data?.imageUrl)
    .slice(0, MAX_EMBED_IMAGES);
  const hrefs = new Map<string, string>();
  let spent = 0;
  for (let i = 0; i < candidates.length; i += IMAGE_FETCH_BATCH) {
    if (spent >= MAX_TOTAL_IMAGE_BYTES) break;
    const batch = candidates.slice(i, i + IMAGE_FETCH_BATCH);
    const results = await Promise.all(
      batch.map((it) => fetchImageDataUri(it.data!.imageUrl!)),
    );
    for (let j = 0; j < batch.length; j++) {
      const uri = results[j];
      if (!uri) continue;
      if (spent + uri.length > MAX_TOTAL_IMAGE_BYTES) continue;
      spent += uri.length;
      hrefs.set(batch[j].id, uri);
    }
  }
  return hrefs;
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
  images: SvgImage[];
  imageHrefs: Map<string, string>;
  bounds: SvgBounds;
}

function pushShapeRect(
  acc: SvgAccumulator,
  item: BoardItem,
  cx: number,
  cy: number,
  w: number,
  h: number,
): void {
  const style = (item.style ?? {}) as ItemStyle;
  const isSticky = item.type === "sticky_note";
  const isFrame = item.type === "frame";
  acc.rects.push({
    id: item.id,
    itemType: item.type,
    kind: item.type === "shape" ? (item.data?.shape ?? "rectangle") : "",
    x: cx - w / 2,
    y: cy - h / 2,
    width: w,
    height: h,
    fill: svgFill(item),
    fillOpacity: asNumber(style.fillOpacity, 1),
    stroke: isSticky
      ? "none"
      : (resolvePaint(style.borderColor) ?? (isFrame ? "#c8c8c8" : "#1a1a1a")),
    strokeWidth: asNumber(style.borderWidth, isFrame ? 1 : 2),
    strokeStyle: isFrame ? "normal" : (style.borderStyle ?? "normal"),
  });
}

function renderSvgItem(acc: SvgAccumulator, item: BoardItem): boolean {
  if (!svgRenderable(item)) return false;
  const cx = item.position?.x ?? 0;
  const cy = item.position?.y ?? 0;
  let w = item.geometry?.width ?? 0;
  let h = item.geometry?.height ?? 0;
  const style = (item.style ?? {}) as ItemStyle;

  switch (item.type) {
    case "text": {
      const text = stripHtml(item.data?.content).slice(0, 300);
      if (!text) return false;
      const fontSize = asNumber(style.fontSize, 14);
      if (w <= 0) w = text.length * fontSize * SVG_GLYPH_FACTOR;
      if (h <= 0) h = fontSize * 1.4;
      acc.bounds.add(cx - w / 2, cy - h / 2, w, h);
      const label = itemLabel(item, cx, cy, w, Math.max(h, fontSize * 5));
      if (label) acc.labels.push(label);
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
          fillOpacity: asNumber(style.fillOpacity, 1),
          stroke: resolvePaint(style.borderColor) ?? "#1a1a1a",
          strokeWidth: asNumber(style.borderWidth, 2),
        });
      } else {
        pushShapeRect(acc, item, cx, cy, w, h);
      }
      const label = itemLabel(item, cx, cy, w, h);
      if (label) acc.labels.push(label);
      return true;
    }
    case "frame": {
      acc.bounds.add(cx - w / 2, cy - h / 2, w, h);
      pushShapeRect(acc, item, cx, cy, w, h);
      const title = stripHtml(item.data?.title).slice(0, 120);
      if (title) {
        const fontSize = Math.min(32, Math.max(12, w * 0.02));
        acc.labels.push({
          x: cx - w / 2 + 4,
          y: cy - h / 2 - fontSize,
          lines: [title],
          fontSize,
          lineHeight: fontSize * 1.25,
          anchor: "start",
          color: "#8c8c8c",
        });
      }
      return true;
    }
    case "image": {
      acc.bounds.add(cx - w / 2, cy - h / 2, w, h);
      const href = acc.imageHrefs.get(item.id);
      if (href) {
        acc.images.push({
          id: item.id,
          x: cx - w / 2,
          y: cy - h / 2,
          width: w,
          height: h,
          href,
        });
      } else {
        pushShapeRect(acc, item, cx, cy, w, h);
      }
      return true;
    }
    case "sticky_note":
    case "card":
    case "app_card":
    case "document": {
      acc.bounds.add(cx - w / 2, cy - h / 2, w, h);
      pushShapeRect(acc, item, cx, cy, w, h);
      const label = itemLabel(item, cx, cy, w, h);
      if (label) acc.labels.push(label);
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
    const caption = stripHtml(conn.captions?.[0]?.content).slice(0, 80);
    if (caption) {
      acc.labels.push({
        x: (x1 + x2) / 2,
        y: (y1 + y2) / 2 - 8,
        lines: [caption],
        fontSize: 12,
        lineHeight: 15,
        anchor: "middle",
        color: "#6b7280",
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

  // Items inside a frame carry positions relative to the frame's TOP-LEFT
  // (position.relativeTo == "parent_top_left"), not to the canvas center.
  // Resolve everything to canvas-absolute before rendering, or frame
  // children cluster near the canvas origin while their frames sit empty —
  // the exact defect the first side-by-side with the real board showed.
  const frameTopLeft = new Map<string, { x: number; y: number }>();
  for (const it of itemsPage.items) {
    if (it.type !== "frame") continue;
    frameTopLeft.set(it.id, {
      x: (it.position?.x ?? 0) - (it.geometry?.width ?? 0) / 2,
      y: (it.position?.y ?? 0) - (it.geometry?.height ?? 0) / 2,
    });
  }
  const absItems = itemsPage.items.map((it) => {
    const tl = it.parent?.id ? frameTopLeft.get(it.parent.id) : undefined;
    if (!tl || it.position?.relativeTo !== "parent_top_left") return it;
    return {
      ...it,
      position: {
        ...it.position,
        x: tl.x + (it.position?.x ?? 0),
        y: tl.y + (it.position?.y ?? 0),
      },
    };
  });

  const byId = new Map(absItems.map((i) => [i.id, i]));
  const acc: SvgAccumulator = {
    rects: [],
    ellipses: [],
    lines: [],
    labels: [],
    images: [],
    imageHrefs: await fetchImageHrefs(absItems),
    bounds: new SvgBounds(),
  };

  // Two passes: frames first, so they sit under their children.
  let rendered = 0;
  let skipped = 0;
  for (const framesPass of [true, false]) {
    for (const item of absItems) {
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
    images: acc.images,
    rendered,
    skipped,
    totalItems: itemsPage.total,
    truncated: itemsPage.truncated,
  };
}
