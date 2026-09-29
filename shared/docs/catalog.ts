import catalog from "./catalog.generated.json";

export type DocPage = {
  slug: string;
  title: string;
  description: string;
  group: string;
  tab: string;
  source: string;
  markdown: string;
  method?: string;
  path?: string;
  operationId?: string;
};
export const docs = catalog.pages as DocPage[];
export const docsVersion = catalog.version;
export const docsOrigin = catalog.origin;
export const integrationSkill = catalog.skill;
export const docUrl = (page: DocPage) => `${docsOrigin}/docs/${page.slug}`;
export const headingId = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

export function searchDocs(query: string, limit = 8) {
  const terms = query
    .toLowerCase()
    .trim()
    .split(/[^a-z0-9:]+/)
    .filter(Boolean)
    .slice(0, 12);
  if (!terms.length) return [];
  return docs
    .map((page) => {
      const title = `${page.title} ${page.description}`.toLowerCase();
      const body = page.markdown.toLowerCase();
      const matched = terms.filter(
        (term) => title.includes(term) || body.includes(term),
      );
      const score =
        matched.length === terms.length
          ? terms.reduce(
              (n, term) =>
                n +
                (title.includes(term) ? 8 : 1) +
                (page.title.toLowerCase().includes(term) ? 8 : 0),
              0,
            )
          : 0;
      const first = body.indexOf(
        terms.find((term) => body.includes(term)) ?? "",
      );
      const start = Math.max(0, first - 70);
      const excerpt =
        (start ? "… " : "") +
        page.markdown
          .slice(start, start + 240)
          .replace(start ? /^\S*\s/ : /^$/, "")
          .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
          .replace(/[#`*\n|]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      return { page, score, excerpt };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.page.slug.localeCompare(b.page.slug))
    .slice(0, limit);
}
