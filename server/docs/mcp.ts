import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import {
  docs,
  docsOrigin,
  docsVersion,
  docUrl,
  integrationSkill,
  searchDocs,
} from "../../shared/docs/catalog";
import spec from "../../docs/api/openapi.json";

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const text = (value: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ],
});
const markdown = (value: string) =>
  value.split("{{DOCS_ORIGIN}}").join(docsOrigin);
function server() {
  const mcp = new McpServer(
    { name: "namepass-docs", version: docsVersion },
    {
      instructions:
        "Public Namepass integration documentation only. Search for the relevant guide, then read it in full and inspect the OpenAPI operation. Cite documentation URLs. This server has no partner, payment, database or chain access. Documentation availability does not imply mainnet or API availability.",
    },
  );
  mcp.registerTool(
    "search_docs",
    {
      description:
        "Search Namepass guides and API operations by keywords or a phrase. Returns ranked excerpts and page slugs; use read_doc for the complete page.",
      inputSchema: {
        query: z.string().trim().min(1).max(240),
        limit: z.number().int().min(1).max(20).default(8),
      },
      annotations,
    },
    async ({ query, limit }) =>
      text(
        searchDocs(query, limit).map(({ page, excerpt }) => ({
          slug: page.slug,
          title: page.title,
          url: docUrl(page),
          excerpt,
        })),
      ),
  );
  mcp.registerTool(
    "read_doc",
    {
      description:
        "Read a complete public Namepass Markdown page by slug, for example settlement, sync or reference/post_transfers.",
      inputSchema: { slug: z.string().min(1).max(160) },
      annotations,
    },
    async ({ slug }) => {
      const page = docs.find((p) => p.slug === slug);
      return page
        ? text(
            `# ${page.title}\n\nSource: ${docUrl(page)}\n\n${markdown(page.markdown)}`,
          )
        : {
            ...text(
              "Documentation page not found. Use search_docs to find its slug.",
            ),
            isError: true,
          };
    },
  );
  mcp.registerTool(
    "get_api_operation",
    {
      description:
        "Retrieve a Namepass API operation with all transitively referenced OpenAPI schemas. Path excludes the /api/v1 prefix.",
      inputSchema: {
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
        path: z.string().min(1).max(180),
      },
      annotations,
    },
    async ({ method, path }) => {
      const operation = (spec.paths as Record<string, Record<string, unknown>>)[
        path
      ]?.[method.toLowerCase()];
      if (!operation)
        return {
          ...text(
            "Operation not found. Search the docs or read the API overview.",
          ),
          isError: true,
        };
      const schemas: Record<string, unknown> = {};
      function refs(value: unknown) {
        if (!value || typeof value !== "object") return;
        for (const [key, item] of Object.entries(value)) {
          if (
            key === "$ref" &&
            typeof item === "string" &&
            item.startsWith("#/components/schemas/")
          ) {
            const name = item.slice("#/components/schemas/".length);
            if (!(name in schemas)) {
              schemas[name] = (
                spec.components.schemas as Record<string, unknown>
              )[name];
              refs(schemas[name]);
            }
          } else refs(item);
        }
      }
      refs(operation);
      return text({
        apiVersion: docsVersion,
        basePath: "/api/v1",
        method,
        path,
        operation,
        schemas,
        openapiUrl: `${docsOrigin}/openapi.json`,
      });
    },
  );
  for (const page of docs)
    mcp.registerResource(
      page.slug,
      `namepass://docs/${page.slug}`,
      {
        title: page.title,
        description: page.description,
        mimeType: "text/markdown",
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: `# ${page.title}\n\n${markdown(page.markdown)}`,
          },
        ],
      }),
    );
  mcp.registerResource(
    "integration-skill",
    "namepass://skills/namepass-integration",
    { title: "Namepass integration skill", mimeType: "text/markdown" },
    async (uri) => ({
      contents: [
        { uri: uri.href, mimeType: "text/markdown", text: integrationSkill },
      ],
    }),
  );
  mcp.registerResource(
    "openapi",
    "namepass://openapi",
    { title: "Namepass OpenAPI contract", mimeType: "application/json" },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(spec),
        },
      ],
    }),
  );
  mcp.registerPrompt(
    "integrate_namepass",
    {
      description:
        "Prepare a Namepass integration brief grounded in settlement, reconciliation and webhook rules.",
      argsSchema: { application: z.string().max(1000).optional() },
    },
    async ({ application }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Implement Namepass ENS renewal funding in ${application || "my existing application"}. Inspect the existing payment flow and ledger. Read the namepass integration skill resource, then the quickstart, settlement, sync and webhook guides. Inspect exact API schemas with get_api_operation. Keep credentials on the backend and preserve payment authorization. Do not broadcast funds. Return a concrete integration and tests covering duplicate events, replay and canonicality corrections.`,
          },
        },
      ],
    }),
  );
  return mcp;
}

export async function docsMcp(request: Request): Promise<Response> {
  if (request.method === "OPTIONS")
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, GET, OPTIONS",
        "access-control-allow-headers":
          "Content-Type, Accept, MCP-Protocol-Version",
        "access-control-max-age": "86400",
      },
    });
  // This endpoint has only immutable public content and never uses credentials.
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const url = new URL(origin);
      if (!["http:", "https:"].includes(url.protocol))
        return new Response("Invalid origin", { status: 403 });
    } catch {
      return new Response("Invalid origin", { status: 403 });
    }
  }
  const mcp = server();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: 16_384,
  });
  try {
    await mcp.connect(transport);
    const response = await transport.handleRequest(request);
    // JSON response mode has no open stream; release per-request SDK handlers.
    const body = await response.arrayBuffer();
    const headers = new Headers(response.headers);
    headers.set("access-control-allow-origin", "*");
    headers.set("cache-control", "no-store");
    headers.set("x-content-type-options", "nosniff");
    return new Response(body.byteLength ? body : null, {
      status: response.status,
      headers,
    });
  } finally {
    await mcp.close();
  }
}
