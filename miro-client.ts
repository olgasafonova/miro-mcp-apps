/**
 * Thin Miro REST API wrapper. Reuses MIRO_ACCESS_TOKEN env var that the Go
 * miro-mcp-server uses (same OAuth token, no separate credential needed).
 */

const MIRO_API_BASE = "https://api.miro.com/v2";

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

async function miroFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${MIRO_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${getToken()}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Miro API ${res.status} ${res.statusText} for ${path}: ${body.slice(0, 200)}`,
    );
  }
  return (await res.json()) as T;
}

// ---- Types: minimal subset of Miro REST API responses ----

export interface Board {
  id: string;
  name: string;
  description: string;
  viewLink: string;
  modifiedAt?: string;
  createdAt?: string;
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

function cleanCaption(captions?: Array<{ content?: string }>): string | undefined {
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
