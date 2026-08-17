# miro-mcp-apps

MCP Apps pilot for Miro. Eleven tools that return **interactive UI** instead of JSON (board-summary card, items table, frame card-grid, sticky-note color clusters, recent-boards table, connectors SVG graph, comment threads, board spatial map, tag-usage map, mindmap tree, member avatar grid) rendered inline in MCP Apps-compatible hosts (Claude Desktop, Claude.ai, ChatGPT, VS Code, Goose, Postman, MCPJam).

Host validation for the rendering path landed in Claude Desktop 24-05-2026 (board-summary card rendered cleanly for a 101-item demo board with bar chart, recent items, and Open-in-Miro CTA).

Sibling to the Go [`miro-mcp-server`](https://github.com/olgasafonova/miro-mcp-server) (92 CRUD tools, agent-driven) and to [`miro-cli`](https://github.com/olgasafonova/miro-cli) (shell-driven, with a local SQLite mirror for offline search). All three sit on the same Miro REST API surface, share the same `MIRO_ACCESS_TOKEN`, and can run side-by-side — pick the runtime that fits the moment. This repo is the **visual** one: tools render UI inline in the chat instead of streaming JSON.

This is the n4o pilot from `claude-code-config-n4o`. See bead for strategic context (Jeff Chow / Kosta Bolgov conversation, "thin use-case packaging + discoverability" gap).

## Why TypeScript

[MCP Apps](https://github.com/modelcontextprotocol/ext-apps) (SEP-1865) is a TypeScript-first extension. The official SDK (`@modelcontextprotocol/ext-apps`) and four Anthropic-shipped Agent Skills only target TS. The Go SDK (v1.6.1) has no MCP Apps helpers. Implementing the wire format manually in Go is mechanically possible but throws away the official tooling. This pilot uses TS where the standard is mature, and lets the Go server keep doing what it's good at.

## Tools

| Tool | What it returns | Inputs |
|---|---|---|
| `miro_board_summary_app` | Card UI: board name + description, total/types/last-modified stats, item-type bar chart, recent items list, "Open in Miro" action. | `board_id` |
| `miro_list_items_app` | Scrollable table of board items with type filter chips, click-row-to-open action. | `board_id`, optional `type`, `limit` |
| `miro_frame_overview_app` | Card-grid of frames (Miro's section abstraction) — one card per frame with title, dimensions, modified date. | `board_id` |
| `miro_sticky_clusters_app` | Sticky notes grouped by `fillColor` into columns of sticky-shaped tiles (yellow / green / red / blue / …); semantic Miro color names mapped to CSS swatches. | `board_id` |
| `miro_recent_boards_app` | Table of N most-recently-modified boards (no board ID needed); click row to open in Miro. | optional `limit` (default 20, max 50) |
| `miro_connectors_app` | SVG graph of items + connectors — nodes are items with at least one connector, edges carry caption text where present, normalized from Miro-space coordinates to a 600×400 viewport. | `board_id` |
| `miro_comment_threads_app` | Comment threads as filterable cards (open / resolved / all), each with its opening message and replies inline. Read-only. Uses the v2-experimental API. | `board_id`, optional `limit` (default 50) |
| `miro_board_svg_app` | The whole board rendered like Miro's own canvas: real shape kinds (cloud, round-rectangle, triangle, …), real fill/border styles, wrapped text that scales with zoom, connectors with arrowheads, image placeholders. Drag to pan, scroll to zoom, Fit to reset. TypeScript port of the Go server's `miro_read_board_svg` geometry, upgraded for fidelity. | `board_id`, optional `max_items` (default 500, max 2000) |
| `miro_tag_map_app` | Tag-usage map: every board tag as a color-coded chip with the items carrying it clustered underneath, sorted by usage. Read-only. | `board_id` |
| `miro_mindmap_tree_app` | Mindmaps as indented, collapsible trees — roots as colored pills, branches with guide lines, child counts. Read-only. Uses the v2-experimental API. | `board_id` |
| `miro_board_members_app` | Who has access: avatar grid (initials, deterministic colors) with role badges (owner / coowner / editor / commenter / viewer / guest) and a per-role breakdown. Read-only. | `board_id` |

## Prerequisites

- Node 18+ (tested on Node v26)
- A Miro OAuth access token in `MIRO_ACCESS_TOKEN` (same env var the Go server uses)

## Install + build

```bash
npm install
npm run build
```

Build emits one self-contained HTML per tool under `dist/` (`board-summary.html`, `list-items.html`, `frame-overview.html`, `sticky-clusters.html`, `recent-boards.html`, `connectors.html` — each ~350 KB / ~83 KB gzipped, bundled via `vite-plugin-singlefile`) plus the compiled server (`dist/main.js`, `dist/server.js`, `dist/miro-client.js`).

## Run

**Stdio mode** (for Claude Desktop and other stdio-based hosts):

```bash
MIRO_ACCESS_TOKEN=xxx npm run start:stdio
```

**HTTP mode** (for Claude.ai connector and Streamable-HTTP hosts):

```bash
MIRO_ACCESS_TOKEN=xxx PORT=3001 npm run start
# → Miro MCP Apps server listening on http://localhost:3001/mcp
```

**Dev mode** (tsx hot reload, stdio):

```bash
MIRO_ACCESS_TOKEN=xxx npm run dev:stdio
```

## Wire it into Claude Desktop

Add to your Claude Desktop MCP config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "miro-apps": {
      "command": "node",
      "args": ["/Users/olgasafonova/Projects/miro-mcp-apps/dist/main.js", "--stdio"],
      "env": {
        "MIRO_ACCESS_TOKEN": "your-token-here"
      }
    }
  }
}
```

Restart Claude Desktop. Try:

- *"Show me a summary of Miro board `<id>` as a card."*
- *"Group the sticky notes on board `<id>` by color."*
- *"Show my most recent Miro boards."*
- *"Render the connectors on board `<id>` as a graph."*

## Wire it into Claude.ai

Run in HTTP mode (above), expose via ngrok or similar, then add as a connector in Claude.ai pointing at `https://your-tunnel/mcp`.

## Architecture

```
.
├── server.ts             # Registers 11 tools + 11 ui:// resources via @modelcontextprotocol/ext-apps/server
├── main.ts               # Stdio + Streamable HTTP transport entry point
├── miro-client.ts        # Minimal fetch wrapper around Miro REST API v2 + per-tool builders
├── board-summary.html    # UI shell — bundles to dist/board-summary.html
├── list-items.html       # UI shell — bundles to dist/list-items.html
├── frame-overview.html   # UI shell — bundles to dist/frame-overview.html
├── sticky-clusters.html  # UI shell — bundles to dist/sticky-clusters.html
├── recent-boards.html    # UI shell — bundles to dist/recent-boards.html
├── connectors.html       # UI shell — bundles to dist/connectors.html
├── comments.html         # UI shell — bundles to dist/comments.html
├── dev-harness/          # Bridge-protocol host page for exercising built views outside a real host
└── src/
    ├── global.css        # Shared design tokens (Miro yellow accent #FFD02F, spacing scale, host-context fallbacks)
    ├── board-summary.{ts,css}
    ├── list-items.{ts,css}
    ├── frame-overview.{ts,css}
    ├── sticky-clusters.{ts,css}
    ├── recent-boards.{ts,css}
    ├── connectors.{ts,css}
    └── comments.{ts,css}
```

The `ext-apps` pattern: each tool registers with `_meta.ui.resourceUri` pointing at a `ui://` resource that returns bundled HTML. The host fetches the resource, renders it in a sandboxed iframe, and routes the tool result to the iframe via the App SDK's `ontoolresult` handler.

One transport-level patch: Claude Desktop rejects tools whose schemas declare JSON Schema draft-07, which is what MCP SDK 1.29/1.30 emits when converting zod schemas. `withDialectFix` in `main.ts` rewrites the declaration to draft 2020-12 on outgoing tool lists — exact here because these schemas use no draft-sensitive keywords. Remove once the SDK targets 2020-12 itself.

`dev-harness/harness.html` implements the host side of the bridge handshake (`ui/initialize` → `initialized` → `ui/notifications/tool-result`) so a built view can be driven in a plain browser — filters, empty states, `openLink`, dark theme, host style variables — without any MCP host in the loop. `dev-harness/make-fixtures.mjs` generates its fixture data through the same `miro-client.ts` builders the server uses.

## Known limitations (pilot scope)

- Rendering validated in Claude Desktop and MCPJam; not yet exercised in ChatGPT, Claude.ai, VS Code, Goose, or Postman
- Single-board scope per tool call (no multi-board comparisons)
- No state persistence; each tool invocation is independent
- Per-board item fetches capped at Miro's 50–100 max page size (no pagination loop). Boards with 1000+ items will surface only the first page
- `miro_connectors_app` renders only items that have at least one connector — isolated items are hidden by design
- `miro_sticky_clusters_app` maps Miro's named fillColors (`yellow`, `light_blue`, …) to a CSS swatch table; unmapped colors fall back to a neutral gray swatch labeled "Other"
- `miro_comment_threads_app` uses Miro's **v2-experimental** API, which is live but absent from the OpenAPI spec and may be unavailable on some accounts or plans; a 403 or 404 from it says so rather than blaming the board ID. It is read-only — posting and resolving live in the Go `miro-mcp-server`
- `miro_comment_threads_app` fetches one page (default 50 threads) and reports the board's total when it is larger, rather than paginating
- HTTP mode binds to `0.0.0.0` without DNS-rebinding protection (SDK warns at startup) — fine for local pilot; add `allowedHosts` config for any non-local deployment

## Next

Per beads `miro-mcp-server-n4o` (host validation) and `miro-mcp-server-8c3` (4-tool expansion, closed):

1. Exercise the other 5 supported hosts (Claude.ai HTTP, VS Code, Goose, Postman, MCPJam) — see how rendering degrades or differs
2. Screenshot artifacts for Kosta / Jeff Chow conversation prop
3. Document the pattern + lessons learned in `rules/mcp-server-patterns.md`
4. Optional: pagination for large-board tools, more sophisticated graph layout for `connectors` (force-directed beats raw coordinate-normalization once node count grows)

## Related projects

| Repo | What it does | Runtime |
|---|---|---|
| [`miro-cli`](https://github.com/olgasafonova/miro-cli) | Wraps the Miro REST API as shell commands; local SQLite mirror for offline search; bulk-migration verbs | Shell / CI / Makefile |
| [`miro-mcp-server`](https://github.com/olgasafonova/miro-mcp-server) | 108 CRUD tools for working with Miro programmatically from any MCP client | Go MCP server, stdio/HTTP |
| **`miro-mcp-apps`** (this repo) | 11 tools that return interactive UI rendered inline in the chat | TypeScript MCP Apps server, stdio/HTTP |

All three sit on the Miro REST API and share `MIRO_ACCESS_TOKEN`.

## References

- MCP Apps spec: https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
- ext-apps SDK: https://github.com/modelcontextprotocol/ext-apps
- Example this is adapted from: `modelcontextprotocol/ext-apps/examples/basic-server-vanillajs`
- Anthropic post: https://claude.com/blog/building-agents-that-reach-production-systems-with-mcp
