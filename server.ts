import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  buildBoardSummary,
  buildConnectorsGraph,
  buildFrameOverview,
  buildListItems,
  buildRecentBoards,
  buildStickyClusters,
} from "./miro-client.js";

// Works both from source (tsx server.ts) and compiled (node dist/server.js).
// When running from source, UIs live at <repo>/dist/; when compiled, they're
// at <dist>/ — same place.
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

const BOARD_SUMMARY_URI = "ui://miro-board-summary/mcp-app.html";
const LIST_ITEMS_URI = "ui://miro-list-items/mcp-app.html";
const FRAME_OVERVIEW_URI = "ui://miro-frame-overview/mcp-app.html";
const STICKY_CLUSTERS_URI = "ui://miro-sticky-clusters/mcp-app.html";
const RECENT_BOARDS_URI = "ui://miro-recent-boards/mcp-app.html";
const CONNECTORS_URI = "ui://miro-connectors/mcp-app.html";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "Miro MCP Apps",
    version: "0.1.0",
  });

  // ---- Tool 1: board_summary (card UI) ----

  registerAppTool(
    server,
    "miro_board_summary_app",
    {
      title: "Miro Board Summary (UI)",
      description:
        "USE WHEN the user wants a visual at-a-glance card for a Miro board: " +
        "name, item-type counts, recent items, and a link to open the board. " +
        "Returns a rendered card instead of JSON. Companion to the Go " +
        "miro-mcp-server's miro_get_board_summary tool.",
      inputSchema: { board_id: z.string().describe("Miro board ID") },
      outputSchema: z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        viewLink: z.string(),
        totalItems: z.number(),
        itemCounts: z.record(z.string(), z.number()),
        recentItems: z.array(
          z.object({
            id: z.string(),
            type: z.string(),
            label: z.string(),
            modifiedAt: z.string().optional(),
          }),
        ),
        modifiedAt: z.string().optional(),
      }),
      _meta: { ui: { resourceUri: BOARD_SUMMARY_URI } },
    },
    async ({ board_id }): Promise<CallToolResult> => {
      const summary = await buildBoardSummary(board_id);
      return {
        content: [
          {
            type: "text",
            text:
              `Board '${summary.name}' — ${summary.totalItems} items, ` +
              `${Object.keys(summary.itemCounts).length} types.`,
          },
        ],
        structuredContent: { ...summary },
      };
    },
  );

  registerAppResource(
    server,
    BOARD_SUMMARY_URI,
    BOARD_SUMMARY_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "board-summary.html"),
        "utf-8",
      );
      return {
        contents: [
          { uri: BOARD_SUMMARY_URI, mimeType: RESOURCE_MIME_TYPE, text: html },
        ],
      };
    },
  );

  // ---- Tool 2: list_items (table UI) ----

  registerAppTool(
    server,
    "miro_list_items_app",
    {
      title: "Miro Board Items (UI)",
      description:
        "USE WHEN the user wants to browse items on a Miro board interactively: " +
        "scrollable table with type filter, click-to-open in Miro. Returns a " +
        "rendered table instead of JSON. Companion to the Go miro-mcp-server's " +
        "miro_list_items tool.",
      inputSchema: {
        board_id: z.string().describe("Miro board ID"),
        type: z
          .string()
          .optional()
          .describe("Optional item type filter (e.g. 'sticky_note', 'frame')"),
        limit: z
          .number()
          .optional()
          .describe("Max items (default 100, max 100 per Miro API)"),
      },
      outputSchema: z.object({
        boardId: z.string(),
        boardName: z.string(),
        viewLink: z.string(),
        items: z.array(
          z.object({
            id: z.string(),
            type: z.string(),
            label: z.string(),
            modifiedAt: z.string().optional(),
            selfLink: z.string().optional(),
          }),
        ),
      }),
      _meta: { ui: { resourceUri: LIST_ITEMS_URI } },
    },
    async ({ board_id, type, limit }): Promise<CallToolResult> => {
      const result = await buildListItems(board_id, { type, limit });
      return {
        content: [
          {
            type: "text",
            text:
              `Board '${result.boardName}' — ${result.items.length} items` +
              (type ? ` of type ${type}` : "") +
              ".",
          },
        ],
        structuredContent: { ...result },
      };
    },
  );

  registerAppResource(
    server,
    LIST_ITEMS_URI,
    LIST_ITEMS_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "list-items.html"),
        "utf-8",
      );
      return {
        contents: [
          { uri: LIST_ITEMS_URI, mimeType: RESOURCE_MIME_TYPE, text: html },
        ],
      };
    },
  );

  // ---- Tool 3: frame_overview (card-grid UI) ----

  registerAppTool(
    server,
    "miro_frame_overview_app",
    {
      title: "Miro Frame Overview (UI)",
      description:
        "USE WHEN the user wants a visual overview of the frames (sections) " +
        "on a Miro board: card-grid with frame titles, dimensions, modified " +
        "dates. Frames are Miro's canonical 'section' abstraction. Returns a " +
        "rendered card grid instead of JSON.",
      inputSchema: { board_id: z.string().describe("Miro board ID") },
      outputSchema: z.object({
        boardId: z.string(),
        boardName: z.string(),
        viewLink: z.string(),
        frames: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            width: z.number().optional(),
            height: z.number().optional(),
            modifiedAt: z.string().optional(),
            selfLink: z.string().optional(),
          }),
        ),
      }),
      _meta: { ui: { resourceUri: FRAME_OVERVIEW_URI } },
    },
    async ({ board_id }): Promise<CallToolResult> => {
      const result = await buildFrameOverview(board_id);
      return {
        content: [
          {
            type: "text",
            text: `Board '${result.boardName}' — ${result.frames.length} frames.`,
          },
        ],
        structuredContent: { ...result },
      };
    },
  );

  registerAppResource(
    server,
    FRAME_OVERVIEW_URI,
    FRAME_OVERVIEW_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "frame-overview.html"),
        "utf-8",
      );
      return {
        contents: [
          { uri: FRAME_OVERVIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: html },
        ],
      };
    },
  );

  // ---- Tool 4: sticky_clusters (color-grouped sticky-note UI) ----

  registerAppTool(
    server,
    "miro_sticky_clusters_app",
    {
      title: "Miro Sticky Clusters (UI)",
      description:
        "USE WHEN the user wants to see sticky notes grouped by color " +
        "(retrospective-board feel: yellow/green/red clusters). Renders each " +
        "color as a column with sticky-shaped tiles inside. Returns a " +
        "rendered cluster view instead of JSON.",
      inputSchema: { board_id: z.string().describe("Miro board ID") },
      outputSchema: z.object({
        boardId: z.string(),
        boardName: z.string(),
        viewLink: z.string(),
        totalStickies: z.number(),
        clusters: z.array(
          z.object({
            color: z.string(),
            count: z.number(),
            stickies: z.array(
              z.object({
                id: z.string(),
                label: z.string(),
                selfLink: z.string().optional(),
              }),
            ),
          }),
        ),
      }),
      _meta: { ui: { resourceUri: STICKY_CLUSTERS_URI } },
    },
    async ({ board_id }): Promise<CallToolResult> => {
      const result = await buildStickyClusters(board_id);
      return {
        content: [
          {
            type: "text",
            text:
              `Board '${result.boardName}' — ${result.totalStickies} sticky ` +
              `notes in ${result.clusters.length} color clusters.`,
          },
        ],
        structuredContent: { ...result },
      };
    },
  );

  registerAppResource(
    server,
    STICKY_CLUSTERS_URI,
    STICKY_CLUSTERS_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "sticky-clusters.html"),
        "utf-8",
      );
      return {
        contents: [
          {
            uri: STICKY_CLUSTERS_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
          },
        ],
      };
    },
  );

  // ---- Tool 5: recent_boards (table UI, no board_id needed) ----

  registerAppTool(
    server,
    "miro_recent_boards_app",
    {
      title: "Miro Recent Boards (UI)",
      description:
        "USE WHEN the user wants to browse their most-recently-modified Miro " +
        "boards interactively (no board ID needed). Renders a clickable table " +
        "of boards sorted by last-modified. Returns the rendered table " +
        "instead of JSON.",
      inputSchema: {
        limit: z
          .number()
          .optional()
          .describe("Max boards to show (default 20, max 50)"),
      },
      outputSchema: z.object({
        boards: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            description: z.string(),
            viewLink: z.string(),
            modifiedAt: z.string().optional(),
            createdAt: z.string().optional(),
          }),
        ),
      }),
      _meta: { ui: { resourceUri: RECENT_BOARDS_URI } },
    },
    async ({ limit }): Promise<CallToolResult> => {
      const cappedLimit = Math.min(limit ?? 20, 50);
      const result = await buildRecentBoards(cappedLimit);
      return {
        content: [
          {
            type: "text",
            text: `${result.boards.length} recent boards (sorted by last_modified).`,
          },
        ],
        structuredContent: { ...result },
      };
    },
  );

  registerAppResource(
    server,
    RECENT_BOARDS_URI,
    RECENT_BOARDS_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "recent-boards.html"),
        "utf-8",
      );
      return {
        contents: [
          { uri: RECENT_BOARDS_URI, mimeType: RESOURCE_MIME_TYPE, text: html },
        ],
      };
    },
  );

  // ---- Tool 6: connectors (SVG graph UI) ----

  registerAppTool(
    server,
    "miro_connectors_app",
    {
      title: "Miro Connectors Graph (UI)",
      description:
        "USE WHEN the user wants to see how items on a Miro board are " +
        "connected: SVG graph view with nodes (items with at least one " +
        "connector) and edges (connectors, with caption text where present). " +
        "Returns a rendered graph instead of JSON.",
      inputSchema: { board_id: z.string().describe("Miro board ID") },
      outputSchema: z.object({
        boardId: z.string(),
        boardName: z.string(),
        viewLink: z.string(),
        nodes: z.array(
          z.object({
            id: z.string(),
            type: z.string(),
            label: z.string(),
            x: z.number(),
            y: z.number(),
            width: z.number(),
            height: z.number(),
          }),
        ),
        edges: z.array(
          z.object({
            id: z.string(),
            from: z.string(),
            to: z.string(),
            caption: z.string().optional(),
          }),
        ),
      }),
      _meta: { ui: { resourceUri: CONNECTORS_URI } },
    },
    async ({ board_id }): Promise<CallToolResult> => {
      const result = await buildConnectorsGraph(board_id);
      return {
        content: [
          {
            type: "text",
            text:
              `Board '${result.boardName}' — ${result.nodes.length} ` +
              `connected items, ${result.edges.length} connectors.`,
          },
        ],
        structuredContent: { ...result },
      };
    },
  );

  registerAppResource(
    server,
    CONNECTORS_URI,
    CONNECTORS_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "connectors.html"),
        "utf-8",
      );
      return {
        contents: [
          { uri: CONNECTORS_URI, mimeType: RESOURCE_MIME_TYPE, text: html },
        ],
      };
    },
  );

  return server;
}
