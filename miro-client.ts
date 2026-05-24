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
  position?: { x: number; y: number };
  modifiedAt?: string;
  links?: { self?: string };
}

export interface BoardItemsResponse {
  data: BoardItem[];
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
