# miro-mcp-apps

MCP Apps pilot for Miro. Two tools that return **interactive UI** instead of JSON: a board-summary card and a board-items table that render inline in MCP Apps-compatible hosts (Claude Desktop, Claude.ai, ChatGPT, VS Code, Goose, Postman, MCPJam).

Companion to the Go [`miro-mcp-server`](https://github.com/olgasafonova/miro-mcp-server) — that one provides 89 CRUD tools for working with Miro programmatically; this one demonstrates the visual pattern. Both can run side-by-side, both reuse the same `MIRO_ACCESS_TOKEN`.

This is the n4o pilot from `claude-code-config-n4o`. See bead for strategic context (Jeff Chow / Kosta Bolgov conversation, "thin use-case packaging + discoverability" gap).

## Why TypeScript

[MCP Apps](https://github.com/modelcontextprotocol/ext-apps) (SEP-1865) is a TypeScript-first extension. The official SDK (`@modelcontextprotocol/ext-apps`) and four Anthropic-shipped Agent Skills only target TS. The Go SDK (v1.6.1) has no MCP Apps helpers. Implementing the wire format manually in Go is mechanically possible but throws away the official tooling. This pilot uses TS where the standard is mature, and lets the Go server keep doing what it's good at.

## Tools

| Tool | What it returns |
|---|---|
| `miro_board_summary_app` | A card UI: board name + description, total/types/last-modified stats, item-type bar chart, recent items list, "Open in Miro" action. |
| `miro_list_items_app` | A scrollable table of board items with type filter chips, click-row-to-open-in-Miro action. |

Both tools accept `board_id` (required). `miro_list_items_app` also accepts optional `type` and `limit`.

## Prerequisites

- Node 18+ (tested on Node v26)
- A Miro OAuth access token in `MIRO_ACCESS_TOKEN` (same env var the Go server uses)

## Install + build

```bash
npm install
npm run build
```

Build emits `dist/board-summary.html`, `dist/list-items.html` (self-contained UIs via `vite-plugin-singlefile`), `dist/main.js`, `dist/server.js`, `dist/miro-client.js`.

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

Restart Claude Desktop. Try: *"Show me a summary of Miro board `<board-id>` as a card."*

## Wire it into Claude.ai

Run in HTTP mode (above), expose via ngrok or similar, then add as a connector in Claude.ai pointing at `https://your-tunnel/mcp`.

## Architecture

```
.
├── server.ts          # Registers 2 tools + 2 ui:// resources via @modelcontextprotocol/ext-apps/server
├── main.ts            # Stdio + Streamable HTTP transport entry point
├── miro-client.ts     # Minimal fetch wrapper around Miro REST API v2
├── board-summary.html # Tool 1 UI shell — bundles to dist/board-summary.html
├── list-items.html    # Tool 2 UI shell — bundles to dist/list-items.html
└── src/
    ├── global.css
    ├── board-summary.css
    ├── list-items.css
    ├── board-summary.ts   # App SDK wiring for tool 1
    └── list-items.ts      # App SDK wiring for tool 2
```

The `ext-apps` pattern: each tool registers with `_meta.ui.resourceUri` pointing at a `ui://` resource that returns bundled HTML. The host fetches the resource, renders it in a sandboxed iframe, and routes the tool result to the iframe via the App SDK's `ontoolresult` handler.

## Known limitations (pilot scope)

- Tested in development only; not yet validated against all 6 supported MCP Apps clients (ChatGPT, Claude, VS Code, Goose, Postman, MCPJam)
- Single-board scope per tool call (no multi-board comparisons)
- No state persistence; each tool invocation is independent
- Client-side type filter in `list_items` only filters returned items (max 100 per Miro API page); for larger boards you'd need pagination
- HTTP mode binds to `0.0.0.0` without DNS-rebinding protection (SDK warns at startup) — fine for local pilot; add `allowedHosts` config for any non-local deployment

## Next

Per bead `claude-code-config-n4o`:

1. Validate rendering in Claude Desktop (stdio)
2. Validate rendering in Claude.ai (HTTP)
3. Optional: validate in 4 other supported hosts (VS Code, Goose, Postman, MCPJam)
4. Screenshot artifacts for Kosta/Jeff Chow conversation prop
5. Document the pattern + lessons learned in `rules/mcp-server-patterns.md`

## References

- MCP Apps spec: https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
- ext-apps SDK: https://github.com/modelcontextprotocol/ext-apps
- Example this is adapted from: `modelcontextprotocol/ext-apps/examples/basic-server-vanillajs`
- Anthropic post: https://claude.com/blog/building-agents-that-reach-production-systems-with-mcp
- Companion Go server: https://github.com/olgasafonova/miro-mcp-server
