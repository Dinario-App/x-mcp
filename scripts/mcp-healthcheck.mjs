#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = new URL("..", import.meta.url).pathname;
const timeoutMs = Number(process.env.X_MCP_HEALTH_TIMEOUT_MS || "20000");

const timeout = new Promise((_, reject) => {
  setTimeout(() => reject(new Error(`x-mcp healthcheck timed out after ${timeoutMs}ms`)), timeoutMs);
});

async function run() {
  const client = new Client({ name: "x-mcp-healthcheck", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    cwd: root,
    stderr: "pipe",
  });

  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const toolNames = new Set((tools.tools || []).map((tool) => tool.name));
    for (const required of ["search_tweets", "get_user"]) {
      if (!toolNames.has(required)) {
        throw new Error(`missing required MCP tool: ${required}`);
      }
    }

    const result = await client.callTool({
      name: "search_tweets",
      arguments: {
        query: "from:DinarioApp",
        max_results: 10,
      },
    });

    if (result.isError) {
      const text = (result.content || []).map((part) => part.text || "").join("\n");
      throw new Error(text || "search_tweets returned MCP error");
    }

    const text = result.content?.[0]?.text || "{}";
    const parsed = JSON.parse(text);
    const resultCount = parsed?.data?.meta?.result_count ?? "unknown";
    console.log(JSON.stringify({
      ok: true,
      tools: toolNames.size,
      result_count: resultCount,
    }));
  } catch (error) {
    const suffix = stderr.trim() ? `\nstderr:\n${stderr.trim()}` : "";
    throw new Error(`${error.message}${suffix}`);
  } finally {
    await transport.close().catch(() => {});
  }
}

await Promise.race([run(), timeout]);
