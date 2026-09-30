import { readFile, writeFile, mkdir } from "node:fs/promises";

const check = process.argv.includes("--check");
const origin = "https://beta.namepass.com";
const availability = "The public integration API is not available. These pages describe the planned API.";
const navigation = JSON.parse(
  await readFile("docs/content/navigation.json", "utf8"),
);
const spec = JSON.parse(await readFile("docs/api/openapi.json", "utf8"));
const skill = await readFile("skills/namepass-integration/SKILL.md", "utf8");
const pages = [];
const resolve = (schema) =>
  schema?.$ref
    ? spec.components.schemas[schema.$ref.split("/").at(-1)]
    : schema;
const cell = (text) =>
  String(text ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
function fields(schema) {
  const value = resolve(schema);
  if (!value?.properties) return "";
  return `| Field | Type | Required | Details |\n| --- | --- | --- | --- |\n${Object.entries(
    value.properties,
  )
    .map(([name, raw]) => {
      const property = resolve(raw);
      const type =
        property?.type ??
        (property?.allOf
          ? "object"
          : property?.oneOf || property?.anyOf
            ? "union"
            : "object");
      const details = [
        property?.description,
        property?.enum
          ? `Values: ${property.enum.map((v) => `\`${v}\``).join(", ")}.`
          : "",
        property?.format ? `Format: ${property.format}.` : "",
        property?.default !== undefined
          ? `Default: \`${JSON.stringify(property.default)}\`.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `| \`${name}\` | ${cell(Array.isArray(type) ? type.join(" or ") : type)} | ${value.required?.includes(name) ? "Yes" : "No"} | ${cell(details)} |`;
    })
    .join("\n")}\n`;
}
for (const page of navigation) {
  pages.push({
    ...page,
    source: `docs/content/${page.slug}.md`,
    markdown: await readFile(`docs/content/${page.slug}.md`, "utf8"),
  });
}
for (const [path, methods] of Object.entries(spec.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    if (!operation.operationId)
      throw new Error(`Missing operationId: ${method} ${path}`);
    const slug = `reference/${operation.operationId}`;
    const parameters = operation.parameters ?? [];
    const body = operation.requestBody?.content?.["application/json"]?.schema;
    const success = Object.entries(operation.responses).find(([status]) =>
      /^2/.test(status),
    );
    const successSchema = success?.[1].content?.["application/json"]?.schema;
    const markdown = [
      `${operation.description ?? operation.summary}\n`,
      ...(parameters.length
        ? [
            `## Parameters\n\n| Name | Location | Required | Description |\n| --- | --- | --- | --- |\n${parameters.map((p) => `| \`${p.name}\` | ${p.in} | ${p.required ? "Yes" : "No"} | ${(p.description ?? "").replaceAll("|", "\\|").replaceAll("\n", " ")} |`).join("\n")}\n`,
          ]
        : []),
      ...(body
        ? [
            `## Request body\n\n${fields(body)}\n\`\`\`json\n${JSON.stringify(operation.requestBody.content["application/json"].example, null, 2)}\n\`\`\`\n`,
          ]
        : []),
      `## Responses\n\n| Status | Description |\n| --- | --- |\n${Object.entries(
        operation.responses,
      )
        .map(
          ([status, r]) =>
            `| \`${status}\` | ${(r.description ?? "").replaceAll("|", "\\|").replaceAll("\n", " ")} |`,
        )
        .join("\n")}\n`,
      ...(fields(successSchema)
        ? [`## Response fields\n\n${fields(successSchema)}`]
        : []),
      `## Full contract\n\n[Download OpenAPI](/openapi.json) for referenced schemas and complete response fields.\n`,
    ].join("\n");
    pages.push({
      slug,
      title: operation.summary,
      description: `${method.toUpperCase()} /api/v1${path}`,
      group: "Endpoints",
      tab: "api",
      source: "scripts/integrations/openapi.mjs",
      method: method.toUpperCase(),
      path,
      operationId: operation.operationId,
      markdown,
    });
  }
}
const duplicates = pages.filter(
  (p, i) => pages.findIndex((x) => x.slug === p.slug) !== i,
);
if (duplicates.length) throw new Error("Duplicate documentation slugs");
const outputs = new Map();
outputs.set(
  "shared/docs/catalog.generated.json",
  JSON.stringify(
    { version: spec.info.version, origin, availability, pages, skill },
    null,
    2,
  ) + "\n",
);
for (const p of pages)
  outputs.set(
    `public/docs/${p.slug}.md`,
    `# ${p.title}\n\n> ${availability}\n\n${p.method ? `\`${p.method} /api/v1${p.path}\`\n\n` : ""}${p.markdown.replaceAll("{{DOCS_ORIGIN}}", origin)}`,
  );
outputs.set("public/docs/skills/namepass-integration/SKILL.md", skill);
outputs.set(
  "public/llms.txt",
  `# Namepass developer documentation\n\n> ${availability}\n\nAPI documentation for USDC-funded ENS renewals. API version ${spec.info.version}. Supported networks: testnets.\n\n## Guides and API operations\n\n${pages.map((p) => `- [${p.title}](${origin}/docs/${p.slug}.md): ${p.description}`).join("\n")}\n\n## Agent resources\n\n- [Full documentation](${origin}/llms-full.txt)\n- [OpenAPI 3.1](${origin}/openapi.json)\n- [Integration skill](${origin}/docs/skills/namepass-integration/SKILL.md)\n`,
);
outputs.set(
  "public/llms-full.txt",
  `# Namepass integration documentation\n\n${availability}\n\nAPI version ${spec.info.version}. Supported networks: testnets.\n\n${pages.map((p) => `# ${p.title}\n\n> ${availability}\n\nSource: ${origin}/docs/${p.slug}\n\n${p.method ? `\`${p.method} /api/v1${p.path}\`\n\n` : ""}${p.markdown.replaceAll("{{DOCS_ORIGIN}}", origin)}`).join("\n---\n\n")}`,
);
for (const [path, body] of outputs) {
  if (check) {
    if ((await readFile(path, "utf8").catch(() => null)) !== body)
      throw new Error(`Stale docs artifact: ${path}`);
  } else {
    await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await writeFile(path, body);
  }
}
// A broken internal docs link is a failed build, including Markdown and skill downloads.
for (const page of pages) {
  for (const match of page.markdown.matchAll(/\]\((\/[^)]+)\)/g)) {
    const href = match[1].split("#")[0];
    if (
      href.startsWith("/docs/") &&
      !pages.some((p) => `/docs/${p.slug}` === href) &&
      !outputs.has(`public${href}`)
    )
      throw new Error(`Broken docs link ${href} in ${page.slug}`);
  }
}
console.log(
  `${check ? "Verified" : "Generated"} ${pages.length} documentation pages, Markdown, LLM indexes and skill.`,
);
