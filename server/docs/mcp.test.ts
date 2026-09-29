import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import route from "../../routes/api/docs/mcp";

test("public docs MCP supports a real client handshake, retrieval, schemas and agent context", async () => {
  const http = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const request = new Request(
        `http://127.0.0.1:${(http.address() as { port: number }).port}${req.url}`,
        {
          method: req.method,
          headers: req.headers as Record<string, string>,
          ...(req.method === "POST" ? { body: Buffer.concat(chunks) } : {}),
        },
      );
      const response = await route.fetch(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const endpoint = new URL(
    `http://127.0.0.1:${(http.address() as { port: number }).port}/api/docs/mcp`,
  );
  const client = new Client({
    name: "namepass-docs-regression",
    version: "1.0.0",
  });
  const text = (result: Awaited<ReturnType<typeof client.callTool>>) => {
    const content = result.content as Array<{ type: string; text?: string }>;
    return content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
  };
  try {
    await client.connect(new StreamableHTTPClientTransport(endpoint));
    const tools = await client.listTools();
    assert.ok(
      tools.tools.every((tool) => tool.annotations?.readOnlyHint === true),
    );
    const found = JSON.parse(
      text(
        await client.callTool({
          name: "search_docs",
          arguments: { query: "pooled deposits" },
        }),
      ),
    );
    assert.ok(
      found.some((page: { slug: string }) => page.slug === "settlement"),
    );
    const page = text(
      await client.callTool({
        name: "read_doc",
        arguments: { slug: "settlement" },
      }),
    );
    assert.match(page, /3 and 7 USDC/);
    assert.match(page, /every subsequent flow/);
    const operation = JSON.parse(
      text(
        await client.callTool({
          name: "get_api_operation",
          arguments: { method: "POST", path: "/transfers" },
        }),
      ),
    );
    assert.deepEqual(
      operation.operation.requestBody.content["application/json"].schema
        .required,
      ["name", "chainId", "txHash", "reference"],
    );
    const settlement = JSON.parse(
      text(
        await client.callTool({
          name: "get_api_operation",
          arguments: { method: "GET", path: "/settlements/{id}" },
        }),
      ),
    );
    assert.ok(settlement.schemas.Settlement);
    assert.ok(settlement.schemas.Evidence);
    assert.ok(settlement.schemas.Amounts);
    const watch = JSON.parse(
      text(
        await client.callTool({
          name: "get_api_operation",
          arguments: { method: "PUT", path: "/watches/{name}" },
        }),
      ),
    );
    assert.equal(watch.operation.operationId, "put_watches__name_");
    const resources = await client.listResources();
    assert.ok(
      resources.resources.some(
        (r) => r.uri === "namepass://skills/namepass-integration",
      ),
    );
    const skill = await client.readResource({
      uri: "namepass://skills/namepass-integration",
    });
    assert.match(
      String("text" in skill.contents[0] ? skill.contents[0].text : ""),
      /Commit resource updates and the returned cursor/,
    );
    const prompt = await client.getPrompt({
      name: "integrate_namepass",
      arguments: { application: "our USDC neobank" },
    });
    assert.match(
      String((prompt.messages[0].content as { text: string }).text),
      /our USDC neobank/,
    );
    assert.equal(
      (
        await client.callTool({
          name: "read_doc",
          arguments: { slug: "../../private" },
        })
      ).isError,
      true,
    );
    const oversized = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: "x".repeat(17000),
    });
    assert.equal(oversized.status, 413);
    const badOrigin = await route.fetch(
      new Request(endpoint, { method: "POST", headers: { origin: "null" } }),
    );
    assert.equal(badOrigin.status, 403);
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) =>
      http.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
