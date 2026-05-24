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
import { buildBoardSummary, buildListItems } from "./miro-client.js";

// Works both from source (tsx server.ts) and compiled (node dist/server.js).
// When running from source, UIs live at <repo>/dist/; when compiled, they're
// at <dist>/ — same place.
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

const BOARD_SUMMARY_URI = "ui://miro-board-summary/mcp-app.html";
const LIST_ITEMS_URI = "ui://miro-list-items/mcp-app.html";

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

  return server;
}
