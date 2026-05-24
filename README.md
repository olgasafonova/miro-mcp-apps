# miro-mcp-apps

MCP Apps pilot for Miro. Six tools that return **interactive UI** instead of JSON (board-summary card, items table, frame card-grid, sticky-note color clusters, recent-boards table, connectors SVG graph) rendered inline in MCP Apps-compatible hosts (Claude Desktop, Claude.ai, ChatGPT, VS Code, Goose, Postman, MCPJam).

Host validation for the rendering path landed in Claude Desktop 24-05-2026 (board-summary card rendered cleanly for a 101-item demo board with bar chart, recent items, and Open-in-Miro CTA).

Companion to the Go [`miro-mcp-server`](https://github.com/olgasafonova/miro-mcp-server) — that one provides 89 CRUD tools for working with Miro programmatically; this one demonstrates the visual pattern. Both can run side-by-side, both reuse the same `MIRO_ACCESS_TOKEN`.

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
├── server.ts             # Registers 6 tools + 6 ui:// resources via @modelcontextprotocol/ext-apps/server
├── main.ts               # Stdio + Streamable HTTP transport entry point
├── miro-client.ts        # Minimal fetch wrapper around Miro REST API v2 + per-tool builders
├── board-summary.html    # UI shell — bundles to dist/board-summary.html
├── list-items.html       # UI shell — bundles to dist/list-items.html
├── frame-overview.html   # UI shell — bundles to dist/frame-overview.html
├── sticky-clusters.html  # UI shell — bundles to dist/sticky-clusters.html
├── recent-boards.html    # UI shell — bundles to dist/recent-boards.html
├── connectors.html       # UI shell — bundles to dist/connectors.html
└── src/
    ├── global.css        # Shared design tokens (Miro yellow accent #FFD02F, spacing scale, host-context fallbacks)
    ├── board-summary.{ts,css}
    ├── list-items.{ts,css}
    ├── frame-overview.{ts,css}
    ├── sticky-clusters.{ts,css}
    ├── recent-boards.{ts,css}
    └── connectors.{ts,css}
```

The `ext-apps` pattern: each tool registers with `_meta.ui.resourceUri` pointing at a `ui://` resource that returns bundled HTML. The host fetches the resource, renders it in a sandboxed iframe, and routes the tool result to the iframe via the App SDK's `ontoolresult` handler.

## Known limitations (pilot scope)

- Rendering validated in Claude Desktop only; not yet exercised in the other 5 supported MCP Apps clients (ChatGPT, Claude.ai, VS Code, Goose, Postman, MCPJam)
- Single-board scope per tool call (no multi-board comparisons)
- No state persistence; each tool invocation is independent
- Per-board item fetches capped at Miro's 50–100 max page size (no pagination loop). Boards with 1000+ items will surface only the first page
- `miro_connectors_app` renders only items that have at least one connector — isolated items are hidden by design
- `miro_sticky_clusters_app` maps Miro's named fillColors (`yellow`, `light_blue`, …) to a CSS swatch table; unmapped colors fall back to a neutral gray swatch labeled "Other"
- HTTP mode binds to `0.0.0.0` without DNS-rebinding protection (SDK warns at startup) — fine for local pilot; add `allowedHosts` config for any non-local deployment

## Next

Per beads `miro-mcp-server-n4o` (host validation) and `miro-mcp-server-8c3` (4-tool expansion, closed):

1. Exercise the other 5 supported hosts (Claude.ai HTTP, VS Code, Goose, Postman, MCPJam) — see how rendering degrades or differs
2. Screenshot artifacts for Kosta / Jeff Chow conversation prop
3. Document the pattern + lessons learned in `rules/mcp-server-patterns.md`
4. Optional: pagination for large-board tools, more sophisticated graph layout for `connectors` (force-directed beats raw coordinate-normalization once node count grows)

## References

- MCP Apps spec: https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
- ext-apps SDK: https://github.com/modelcontextprotocol/ext-apps
- Example this is adapted from: `modelcontextprotocol/ext-apps/examples/basic-server-vanillajs`
- Anthropic post: https://claude.com/blog/building-agents-that-reach-production-systems-with-mcp
- Companion Go server: https://github.com/olgasafonova/miro-mcp-server
