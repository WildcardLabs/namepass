import {
  Children,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  FileText,
  Github,
  Menu,
  Plug,
  Search,
  Sparkles,
  Terminal,
  List,
} from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandItem,
  CommandList,
  CommandEmpty,
} from "./ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  docs,
  docsVersion,
  docsOrigin,
  headingId,
  searchDocs,
} from "../../shared/docs/catalog";
import "./docs.css";

const tabs = [
  {
    id: "guides",
    label: "Integration guides",
    icon: BookOpen,
    start: "introduction",
  },
  { id: "api", label: "API reference", icon: Code2, start: "reference" },
  { id: "agents", label: "For agents", icon: Sparkles, start: "agents" },
];
const repo = "https://github.com/wildcardlabs/namepass";
function currentSlug() {
  try {
    return (
      decodeURIComponent(window.location.pathname.replace(/^\/docs\/?/, "")) ||
      "introduction"
    );
  } catch {
    return "not-found";
  }
}
function plain(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? plain(child.props.children)
        : String(child),
    )
    .join("");
}
function publishedText(text: string) {
  return text.split("{{DOCS_ORIGIN}}").join(docsOrigin);
}
function CopyButton({
  value,
  label = "Copy",
  className = "",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      className={`docs-copy ${className}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setState("copied");
        } catch {
          setState("failed");
        }
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setState("idle"), 2000);
      }}
      aria-label={label}
    >
      <span aria-live="polite">
        {state === "copied" ? <Check size={14} /> : <Copy size={14} />}
      </span>
      {state === "copied"
        ? "Copied"
        : state === "failed"
          ? "Copy failed"
          : label}
    </button>
  );
}
function CodeBlock({
  value,
  language = "text",
}: {
  value: string;
  language?: string;
}) {
  const tokens = value.split(
    /("(?:[^"\\]|\\.)*"|'[^']*'|#[^\n]*|\b(?:true|false|null)\b|\$[A-Z_]+)/g,
  );
  return (
    <div className="docs-code">
      <div className="docs-code-bar">
        <span>
          <Terminal size={13} />
          {language === "bash"
            ? "Terminal"
            : language === "json"
              ? "JSON"
              : language === "text"
                ? "Agent prompt"
                : language}
        </span>
        <CopyButton value={value} label="Copy code" />
      </div>
      <pre>
        <code>
          {tokens.map((token, i) => (
            <span
              key={i}
              className={
                token.startsWith("#")
                  ? "token-comment"
                  : /^["']/.test(token)
                    ? "token-string"
                    : token.startsWith("$")
                      ? "token-variable"
                      : ""
              }
            >
              {token}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
function RenewalIllustration() {
  return (
    <div
      className="docs-renewal-art"
      aria-label="USDC deposits fund an ENS renewal"
    >
      <svg
        className="art-routes"
        viewBox="0 0 440 244"
        fill="none"
        aria-hidden="true"
      >
        <path d="M40 63H135C154 63 164 73 164 92V119" />
        <path d="M38 178H138C155 178 164 169 164 151V120" />
        <path d="M164 120H275C294 120 307 131 307 150V190" />
        <path d="M164 120H361" />
        <circle cx="164" cy="120" r="4" />
        <circle cx="307" cy="190" r="3" />
      </svg>
      <div className="art-token">
        <img src="/logos/usdc.svg" alt="USDC" />
        <span>USDC deposit</span>
      </div>
      <div className="art-network">
        <img src="/logos/base.svg" alt="" />
        <img src="/logos/arbitrum.svg" alt="" />
        <img src="/logos/ethereum.svg" alt="" />
        <span>Supported networks</span>
      </div>
      <div className="art-address">
        <span className="art-overline">ENS NAME</span>
        <strong>example.eth</strong>
        <span>Universal deposit address</span>
        <div className="art-address-bars" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
      <div className="art-renewal">
        <img src="/logos/ens.svg" alt="ENS" />
        <div>
          <strong>ENS renewal</strong>
          <span>Verified settlement</span>
        </div>
      </div>
    </div>
  );
}
const examples = [
  {
    label: "Address",
    method: "POST",
    path: "/address",
    code: `curl -X POST '${docsOrigin}/api/v1/address' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"name":"example.eth"}'`,
  },
  {
    label: "Quote",
    method: "POST",
    path: "/quote",
    code: `curl -X POST '${docsOrigin}/api/v1/quote' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"name":"example.eth","chainId":"84532","amount":"1000000"}'`,
  },
  {
    label: "Status",
    method: "GET",
    path: "/status/{chainId}",
    code: `curl '${docsOrigin}/api/v1/status/84532?transactionHash={hash}'`,
  },
  {
    label: "History",
    method: "GET",
    path: "/names/{name}/renewals",
    code: `curl '${docsOrigin}/api/v1/names/example.eth/renewals?limit=20'`,
  },
];
function ApiExample() {
  const [selected, setSelected] = useState(0);
  const descriptions = [
    "Get a deposit address",
    "Estimate renewal time",
    "Track a transaction",
    "Retrieve name history",
  ];
  const slugs = [
    "post_address",
    "post_quote",
    "get_status",
    "get_name_renewals",
  ];
  return (
    <section className="docs-example-section" aria-label="API request examples">
      <h2>Explore the API</h2>
      <p>Request examples for each endpoint.</p>
      <div className="docs-example">
        <div
          className="docs-example-tabs"
          role="tablist"
          aria-label="Request endpoint"
          aria-orientation="vertical"
        >
          {examples.map((example, i) => (
            <button
              key={example.label}
              id={`example-tab-${i}`}
              role="tab"
              aria-selected={selected === i}
              aria-controls="example-panel"
              onClick={() => setSelected(i)}
              onKeyDown={(event) => {
                if (
                  !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? examples.length - 1
                      : (selected +
                          (event.key === "ArrowDown" ? 1 : -1) +
                          examples.length) %
                        examples.length;
                setSelected(next);
                document.getElementById(`example-tab-${next}`)?.focus();
              }}
              tabIndex={selected === i ? 0 : -1}
            >
              <span className={`docs-method ${example.method.toLowerCase()}`}>
                {example.method}
              </span>
              <span>{descriptions[i]}</span>
              <ChevronRight size={14} />
            </button>
          ))}
        </div>
        <div
          className="docs-example-panel"
          id="example-panel"
          role="tabpanel"
          aria-labelledby={`example-tab-${selected}`}
        >
          <div className="docs-example-header">
            <span>Command line</span>
            <CopyButton value={examples[selected].code} label="Copy request" />
          </div>
          <CodeBlock value={examples[selected].code} language="bash" />
          <div className="docs-example-footer">
            <code>/api/v1{examples[selected].path}</code>
            <a href={`/docs/reference/${slugs[selected]}`}>
              API reference <ArrowUpRight size={13} />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
export default function Docs() {
  const [slug, setSlug] = useState(currentSlug);
  const [search, setSearch] = useState(false),
    [query, setQuery] = useState("");
  const [mobile, setMobile] = useState(false),
    [agent, setAgent] = useState(false),
    [copyStatus, setCopyStatus] = useState("");
  const [activeHeading, setActiveHeading] = useState("");
  const page = docs.find((p) => p.slug === slug),
    tab = page?.tab ?? "guides";
  const peers = docs.filter((p) => p.tab === tab),
    index = peers.findIndex((p) => p.slug === slug);
  const headings = [...(page?.markdown ?? "").matchAll(/^## (.+)$/gm)].map(
    (m) => ({ title: m[1].replace(/`/g, ""), id: headingId(m[1]) }),
  );
  const prompt = page
    ? `Help me integrate Namepass.\nRead ${docsOrigin}/docs/${page.slug}.md and the integration skill:\n${docsOrigin}/docs/skills/namepass-integration/SKILL.md\n\nMy question: `
    : "";
  const navigate = (next: string, hash = "") => {
    window.history.pushState(
      {},
      "",
      `/docs/${next === "introduction" ? "" : next}${hash}`,
    );
    setSlug(next);
    setMobile(false);
    setSearch(false);
    setAgent(false);
    setQuery("");
    setCopyStatus("");
    setActiveHeading("");
    window.dispatchEvent(new PopStateEvent("popstate"));
    if (hash)
      requestAnimationFrame(() =>
        document.getElementById(hash.slice(1))?.scrollIntoView(),
      );
    else window.scrollTo({ top: 0, behavior: "instant" });
  };
  useEffect(() => {
    const previousTitle = document.title;
    const pop = () => setSlug(currentSlug());
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch((s) => !s);
      }
    };
    window.addEventListener("popstate", pop);
    window.addEventListener("keydown", key);
    return () => {
      document.title = previousTitle;
      window.removeEventListener("popstate", pop);
      window.removeEventListener("keydown", key);
    };
  }, []);
  useEffect(() => {
    document.title = `${page?.title ?? "Page not found"} · Namepass Docs`;
    const hash = window.location.hash.slice(1);
    if (hash)
      requestAnimationFrame(() =>
        document.getElementById(hash)?.scrollIntoView(),
      );
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) setActiveHeading(entry.target.id);
      },
      { rootMargin: "-120px 0px -65% 0px" },
    );
    document
      .querySelectorAll(".docs-prose h2")
      .forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [page]);
  const link = (href: string, children: ReactNode, className?: string) => (
    <a
      key={href}
      className={className}
      href={href}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
          return;
        if (href.startsWith("/docs") && !href.endsWith(".md")) {
          const [path, hash] = href.split("#");
          e.preventDefault();
          navigate(
            path.replace(/^\/docs\/?/, "") || "introduction",
            hash ? "#" + hash : "",
          );
        }
      }}
    >
      {children}
    </a>
  );
  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(label);
    } catch {
      setCopyStatus("Clipboard unavailable. Open Markdown to copy the text.");
    }
  };
  const navigation = (
    <nav aria-label="Documentation pages">
      {[...new Set(docs.map((p) => p.group))].map((group) => (
        <div className="docs-nav-group" key={group}>
          <h3>{group}</h3>
          {docs
            .filter((p) => p.group === group)
            .map((p) =>
              link(
                `/docs/${p.slug}`,
                <>
                  {p.method && (
                    <span className={`docs-method ${p.method.toLowerCase()}`}>
                      {p.method}
                    </span>
                  )}
                  <span className={p.method ? "docs-nav-endpoint" : undefined}>
                    {p.method ? p.path : p.title}
                  </span>
                  {p.slug === slug && <span className="nav-current-dot" />}
                </>,
                `docs-nav-item ${p.slug === slug ? "active" : ""}`,
              ),
            )}
        </div>
      ))}
    </nav>
  );
  const matches = query.trim()
    ? searchDocs(query, 12)
    : docs.slice(0, 4).map((page) => ({ page, excerpt: page.description }));
  return (
    <div className={`docs-shell ${slug === "introduction" ? "docs-home" : ""}`}>
      <a href="#docs-content" className="docs-skip">
        Skip to content
      </a>
      <header className="docs-header">
        <div className="docs-header-inner">
          <a href="/" className="docs-brand" aria-label="Namepass home">
            <img
              src="/namepass-logo.png"
              width="144"
              height="23"
              alt="Namepass"
              className="docs-wordmark"
            />
            <span className="brand-divider" />
            <span className="brand-docs">Docs</span>
          </a>
          <button
            className="docs-search-trigger"
            aria-label="Search documentation"
            onClick={() => setSearch(true)}
          >
            <Search size={15} />
            <span>Search documentation...</span>
            <kbd>⌘ K</kbd>
          </button>
          <div className="docs-header-actions">
            <button
              className="docs-agent-button"
              onClick={() => setAgent(true)}
            >
              <Sparkles size={15} />
              <span>Ask your agent</span>
            </button>
            <a
              href={repo}
              target="_blank"
              rel="noreferrer"
              aria-label="Namepass on GitHub"
            >
              <Github size={18} />
            </a>
            <a href="https://beta.namepass.com" className="docs-app-link">
              Open app
              <ArrowUpRight size={13} />
            </a>
          </div>
          <button
            className="docs-mobile-menu"
            aria-label="Open documentation menu"
            onClick={() => setMobile(true)}
          >
            <Menu size={20} />
          </button>
        </div>
        <div className="docs-tab-bar">
          {tabs.map(({ id, label, start }) =>
            link(
              `/docs/${start}`,
              label,
              `docs-tab ${tab === id ? "selected" : ""}`,
            ),
          )}
          <span className="docs-contract-version">API {docsVersion}</span>
        </div>
      </header>
      <div className="docs-layout">
        <aside className="docs-sidebar">
          {navigation}
          <div className="docs-sidebar-agent">
            {link(
              "/docs/agents",
              <>
                <span className="sidebar-agent-icon">
                  <Sparkles size={15} />
                </span>
                <div>
                  <strong>Agent resources</strong>
                  <p>Markdown & integration skill</p>
                </div>
                <ChevronRight size={14} />
              </>,
            )}
          </div>
          <div className="docs-sidebar-meta">
            <span className="testnet-dot" />
            Testnet integration<span>v1</span>
          </div>
        </aside>
        <div className="docs-reading-layout">
          <main
            id="docs-content"
            className={`docs-article ${slug === "introduction" ? "docs-introduction" : ""}`}
          >
            {page ? (
              <>
                <div className="docs-breadcrumb">
                  <span>{tabs.find((t) => t.id === tab)?.label}</span>
                  <ChevronRight size={12} />
                  <span>{page.group}</span>
                </div>
                <div className="docs-page-header">
                  <div>
                    <h1>
                      {slug === "introduction" ? "Documentation" : page.title}
                    </h1>
                    {!page.method && <p>{page.description}</p>}
                    {slug === "introduction" && (
                      <div className="docs-start-actions">
                        {link(
                          "/docs/quickstart",
                          <>
                            Start building <ArrowRight size={16} />
                          </>,
                          "docs-primary-link",
                        )}
                        {link(
                          "/docs/reference",
                          <>
                            API reference <ArrowRight size={14} />
                          </>,
                          "docs-secondary-link",
                        )}
                      </div>
                    )}
                  </div>
                  {slug === "introduction" && <RenewalIllustration />}
                  <DropdownMenu>
                    <DropdownMenuTrigger className="docs-page-actions">
                      <Copy size={14} />
                      <span>Copy page</span>
                      <ChevronDown size={13} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="docs-dropdown">
                      <DropdownMenuItem
                        onSelect={() =>
                          void copy(
                            `# ${page.title}\n\n${page.method ? `\`${page.method} /api/v1${page.path}\`\n\n` : ""}${publishedText(page.markdown)}`,
                            "Page copied as Markdown",
                          )
                        }
                      >
                        <Copy size={16} />
                        <div>
                          <strong>Copy page</strong>
                          <span>Copy as Markdown</span>
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <a
                          href={`/docs/${page.slug}.md`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <FileText size={16} />
                          <div>
                            <strong>View as Markdown</strong>
                            <span>Read the plain-text page</span>
                          </div>
                          <ArrowUpRight size={13} />
                        </a>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => setAgent(true)}>
                        <Sparkles size={16} />
                        <div>
                          <strong>Ask your agent</strong>
                          <span>Copy an integration prompt</span>
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <a
                          href="/docs/skills/namepass-integration/SKILL.md"
                          download
                        >
                          <ArrowRight size={16} />
                          <div>
                            <strong>Download integration skill</strong>
                            <span>A reusable workflow for your agent</span>
                          </div>
                        </a>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <p role="status" className="docs-copy-status">
                    {copyStatus}
                  </p>
                </div>
                {page.method && (
                  <div className="docs-endpoint">
                    <span
                      className={`docs-method ${page.method.toLowerCase()}`}
                    >
                      {page.method}
                    </span>
                    <code>/api/v1{page.path}</code>
                    <CopyButton
                      value={`/api/v1${page.path}`}
                      label="Copy path"
                    />
                  </div>
                )}
                {slug === "introduction" && (
                  <>
                    <section
                      className="docs-directory"
                      aria-label="Developer resources"
                    >
                      {[
                        {
                          title: "Integration",
                          links: [
                            { slug: "quickstart", title: "Renew an ENS name" },
                            {
                              slug: "addresses",
                              title: "Get a deposit address",
                            },
                            { slug: "quotes", title: "Estimate renewal time" },
                          ],
                        },
                        {
                          title: "Renewal data",
                          links: [
                            { slug: "status", title: "Track a transaction" },
                            { slug: "history", title: "Read renewal history" },
                            {
                              slug: "reference",
                              title: "Browse the API reference",
                            },
                          ],
                        },
                        {
                          title: "Agent resources",
                          links: [
                            { slug: "agents", title: "Build with an agent" },
                            {
                              slug: "skills",
                              title: "Install the integration skill",
                            },
                            {
                              slug: "quickstart.md",
                              title: "Read Markdown documentation",
                            },
                          ],
                        },
                      ].map((group) => (
                        <div key={group.title}>
                          <h2>{group.title}</h2>
                          {group.links.map((item) =>
                            link(
                              `/docs/${item.slug}`,
                              <>
                                {item.title}
                                <ArrowRight size={13} />
                              </>,
                            ),
                          )}
                        </div>
                      ))}
                    </section>
                    <ApiExample />
                  </>
                )}
                {["agents", "skills"].includes(slug) && (
                  <div className="docs-agent-callout">
                    <Sparkles size={20} />
                    <div>
                      <strong>Agent resources</strong>
                      <p>Markdown documentation and API instructions.</p>
                    </div>
                  </div>
                )}
                <div className="docs-prose">
                  <Markdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      h2: ({ children }) => (
                        <h2 id={headingId(plain(children))}>
                          <a href={`#${headingId(plain(children))}`}>
                            {children}
                            <span className="heading-anchor">#</span>
                          </a>
                        </h2>
                      ),
                      h3: ({ children }) => (
                        <h3 id={headingId(plain(children))}>{children}</h3>
                      ),
                      a: ({ href, children }) => link(href ?? "#", children),
                      pre: ({ children }) => {
                        const child = Children.toArray(children)[0];
                        const props = isValidElement<{
                          children?: ReactNode;
                          className?: string;
                        }>(child)
                          ? child.props
                          : {};
                        return (
                          <CodeBlock
                            value={plain(props.children).replace(/\n$/, "")}
                            language={props.className?.replace("language-", "")}
                          />
                        );
                      },
                      table: ({ children }) => (
                        <div className="docs-table-wrap">
                          <table>{children}</table>
                        </div>
                      ),
                    }}
                  >
                    {publishedText(page.markdown)}
                  </Markdown>
                </div>
                {slug === "reference" && (
                  <div className="docs-api-grid">
                    {docs
                      .filter((p) => p.method)
                      .map((p) =>
                        link(
                          `/docs/${p.slug}`,
                          <>
                            <span
                              className={`docs-method ${p.method!.toLowerCase()}`}
                            >
                              {p.method}
                            </span>
                            <div>
                              <strong>{p.title}</strong>
                              <code>{p.path}</code>
                            </div>
                            <ArrowRight size={14} />
                          </>,
                          "docs-api-row",
                        ),
                      )}
                  </div>
                )}
                <div className="docs-page-meta">
                  <a
                    href={`${repo}/edit/codex/integration-api-plan/${page.source}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Edit this page
                    <ArrowUpRight size={12} />
                  </a>
                  <span>Contract {docsVersion}</span>
                </div>
                <div className="docs-pagination">
                  {index > 0 ? (
                    link(
                      `/docs/${peers[index - 1].slug}`,
                      <>
                        <ChevronLeft size={15} />
                        <div>
                          <span>Previous</span>
                          <strong>{peers[index - 1].title}</strong>
                        </div>
                      </>,
                      "docs-page-neighbor",
                    )
                  ) : (
                    <span />
                  )}
                  {index < peers.length - 1 &&
                    link(
                      `/docs/${peers[index + 1].slug}`,
                      <>
                        <div>
                          <span>Next</span>
                          <strong>{peers[index + 1].title}</strong>
                        </div>
                        <ChevronRight size={15} />
                      </>,
                      "docs-page-neighbor next",
                    )}
                </div>
              </>
            ) : (
              <div className="docs-not-found">
                <FileText size={30} />
                <h1>Page not found</h1>
                <p>This documentation page does not exist.</p>
                {link(
                  "/docs/",
                  <>
                    Back to introduction <ArrowRight size={14} />
                  </>,
                )}
              </div>
            )}
          </main>
          <aside className="docs-toc">
            <div>
              <h3>
                <List size={13} />
                On this page
              </h3>
              {headings.map((h) => (
                <a
                  className={activeHeading === h.id ? "active" : ""}
                  href={`#${h.id}`}
                  key={h.id}
                >
                  {h.title}
                </a>
              ))}
              <div className="docs-toc-tools">
                <a href="/llms.txt" target="_blank" rel="noreferrer">
                  <FileText size={14} />
                  Documentation index
                  <ArrowUpRight size={12} />
                </a>
              </div>
            </div>
          </aside>
        </div>
      </div>
      <CommandDialog open={search} onOpenChange={setSearch}>
        <DialogTitle className="sr-only">
          Search Namepass documentation
        </DialogTitle>
        <DialogDescription className="sr-only">
          Find integration guides and API operations.
        </DialogDescription>
        <div className="docs-search-dialog">
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search address, status, endpoints..."
          />
          <CommandList>
            <CommandEmpty>
              No pages found. Try “address”, “poll” or “status”.
            </CommandEmpty>
            {matches.map(({ page: p, excerpt }) => (
              <CommandItem
                value={`${query} ${p.slug}`}
                key={p.slug}
                onSelect={() => navigate(p.slug)}
              >
                <span className="search-result-icon">
                  {p.method ? (
                    <Code2 size={17} />
                  ) : p.tab === "agents" ? (
                    <Sparkles size={17} />
                  ) : (
                    <BookOpen size={17} />
                  )}
                </span>
                <div>
                  <strong>{p.title}</strong>
                  <p>{excerpt}</p>
                </div>
                <ChevronRight size={14} />
              </CommandItem>
            ))}
          </CommandList>
          <div className="docs-search-footer">
            <span>Search the published documentation</span>
            <span>↑ ↓ to navigate · ↵ to open</span>
          </div>
        </div>
      </CommandDialog>
      <Dialog open={mobile} onOpenChange={setMobile}>
        <DialogContent className="docs-mobile-dialog">
          <DialogTitle>Documentation</DialogTitle>
          <DialogDescription>
            Explore the Namepass integration.
          </DialogDescription>
          <button
            className="docs-search-trigger"
            aria-label="Search documentation"
            onClick={() => {
              setMobile(false);
              setSearch(true);
            }}
          >
            <Search size={15} />
            Search documentation
          </button>
          {navigation}
        </DialogContent>
      </Dialog>
      <Dialog open={agent} onOpenChange={setAgent}>
        <DialogContent className="docs-agent-dialog">
          <DialogTitle>
            <Sparkles size={18} />
            Integrate with an agent
          </DialogTitle>
          <DialogDescription>
            Copy the prompt into your agent or open it in an assistant.
          </DialogDescription>
          <CodeBlock value={prompt} />
          <div className="agent-destinations">
            <a
              href={`https://chatgpt.com/?q=${encodeURIComponent(prompt)}`}
              target="_blank"
              rel="noreferrer"
            >
              Open in ChatGPT
              <ArrowUpRight size={14} />
            </a>
            <a
              href={`https://claude.ai/new?q=${encodeURIComponent(prompt)}`}
              target="_blank"
              rel="noreferrer"
            >
              Open in Claude
              <ArrowUpRight size={14} />
            </a>
          </div>
          <div className="agent-dialog-footer">
            <Plug size={14} />
            {link("/docs/skills", "Install the skill")}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
