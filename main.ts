/**
 * Entry point. Run via:
 *   npm run dev:stdio          (tsx, hot, stdio transport for Claude Desktop)
 *   npm run build && npm run start:stdio   (compiled, stdio transport)
 *   npm run build && npm run start         (compiled, HTTP transport on $PORT or 3001)
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import cors from "cors";
import type { Request, Response } from "express";
import { createServer } from "./server.js";

const DRAFT_07 = "http://json-schema.org/draft-07/schema#";
const DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";

/**
 * The MCP spec requires tool schemas in JSON Schema draft 2020-12, and Claude
 * Desktop rejects tools declaring anything else — but SDK 1.29/1.30 converts
 * zod schemas with its compat shim's draft-7 default and no way to override
 * (zod-json-schema-compat.js calls toJSONSchema without a target). Our
 * schemas use no draft-sensitive keywords ($ref/$defs/tuples), so the two
 * dialects are byte-identical apart from the declaration; rewriting it on the
 * way out is exact. Remove once the SDK targets 2020-12 itself.
 */
function withDialectFix(transport: Transport): Transport {
  const send = transport.send.bind(transport);
  transport.send = (message, options) => {
    const tools = (message as { result?: { tools?: unknown } }).result?.tools;
    if (Array.isArray(tools)) {
      for (const tool of tools) {
        for (const schema of [tool.inputSchema, tool.outputSchema]) {
          if (schema?.$schema === DRAFT_07) schema.$schema = DRAFT_2020_12;
        }
      }
    }
    return send(message, options);
  };
  return transport;
}

async function startStreamableHTTPServer(
  factory: () => McpServer,
): Promise<void> {
  const port = parseInt(process.env.PORT ?? "3001", 10);

  const app = createMcpExpressApp({ host: "0.0.0.0" });
  app.use(cors());

  app.all("/mcp", async (req: Request, res: Response) => {
    const server = factory();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(withDialectFix(transport));
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const httpServer = app.listen(port, (err) => {
    if (err) {
      console.error("Failed to start server:", err);
      process.exit(1);
    }
    console.log(
      `Miro MCP Apps server listening on http://localhost:${port}/mcp`,
    );
  });

  const shutdown = () => {
    console.log("\nShutting down...");
    httpServer.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function startStdioServer(factory: () => McpServer): Promise<void> {
  await factory().connect(withDialectFix(new StdioServerTransport()));
}

async function main() {
  if (process.argv.includes("--stdio")) {
    await startStdioServer(createServer);
  } else {
    await startStreamableHTTPServer(createServer);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
