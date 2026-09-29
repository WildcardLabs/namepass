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
  ShieldCheck,
  Sparkles,
  Terminal,
  Wallet,
  Clock3,
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
function localText(text: string) {
  return text.split("{{DOCS_ORIGIN}}").join(window.location.origin);
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
function Journey() {
  return (
    <div
      className="docs-journey"
      aria-label="Funding moves from your application, through a Namepass deposit address, to a verified ENS renewal"
    >
      <div className="journey-label">
        <span className="journey-dot" />
        THE INTEGRATION AT A GLANCE<span>USDC → renewal time</span>
      </div>
      <div className="journey-steps">
        {[
          {
            icon: Wallet,
            label: "Your application",
            detail: "Send supported USDC",
          },
          {
            icon: Code2,
            label: "One deposit address",
            detail: "Universal across chains",
          },
          {
            icon: ShieldCheck,
            label: "Verified ENS renewal",
            detail: "Evidence you can reconcile",
          },
        ].map(({ icon: Icon, label, detail }, i) => (
          <div className="journey-step" key={label}>
            <div className="journey-icon">
              <Icon size={20} />
            </div>
            <strong>{label}</strong>
            <span>{detail}</span>
            {i < 2 && <ArrowRight className="journey-arrow" size={16} />}
          </div>
        ))}
      </div>
      <div className="journey-footer">
        <span>
          <Clock3 size={13} />
          Follow every stage
        </span>
        <span>Deposit → consumption → finalized settlement</span>
      </div>
    </div>
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
  const origin = window.location.origin;
  const prompt = page
    ? `Help me implement Namepass in my application. Read ${origin}/docs/${page.slug}.md and ${origin}/openapi.json first. Use the Namepass integration skill at ${origin}/docs/skills/namepass-integration/SKILL.md and docs MCP at ${origin}/api/docs/mcp. Inspect my existing payment and ledger code. Keep API keys on the backend, use exact amounts, and distinguish verified deposits from finalized settlements. Do not broadcast funds.\n\nMy question: `
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
      {[...new Set(peers.map((p) => p.group))].map((group) => (
        <div className="docs-nav-group" key={group}>
          <h3>{group}</h3>
          {peers
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
    <div className="docs-shell">
      <a href="#docs-content" className="docs-skip">
        Skip to content
      </a>
      <header className="docs-header">
        <div className="docs-header-inner">
          <a href="/" className="docs-brand" aria-label="Namepass home">
            <svg
              width="25"
              height="25"
              viewBox="0 0 28 28"
              fill="none"
              aria-hidden="true"
            >
              <rect width="28" height="28" rx="7" fill="#163d2b" />
              <path
                d="M8 20V8l12 12V8"
                stroke="white"
                strokeWidth="2.4"
                strokeLinejoin="round"
              />
              <path d="M14 8h6v6" stroke="#8dc6a5" strokeWidth="2.4" />
            </svg>
            <strong>Namepass</strong>
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
            <a href="/" className="docs-app-link">
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
          {tabs.map(({ id, label, icon: Icon, start }) =>
            link(
              `/docs/${start}`,
              <>
                <Icon size={14} />
                {label}
              </>,
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
                  <strong>Built for your agent</strong>
                  <p>Skills, MCP & Markdown</p>
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
          <main id="docs-content" className="docs-article">
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
                      {slug === "introduction"
                        ? "Build renewals into your app."
                        : page.title}
                    </h1>
                    <p>{page.description}</p>
                  </div>
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
                            `# ${page.title}\n\n${localText(page.markdown)}`,
                            "Page copied as Markdown",
                          )
                        }
                      >
                        <Copy size={16} />
                        <div>
                          <strong>Copy page</strong>
                          <span>Markdown for your agent</span>
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
                          <span>Take this page into your workflow</span>
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          void copy(
                            `${origin}/api/docs/mcp`,
                            "MCP server URL copied",
                          )
                        }
                      >
                        <Plug size={16} />
                        <div>
                          <strong>Copy MCP server URL</strong>
                          <span>Connect documentation tools</span>
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
                {slug === "introduction" && <Journey />}
                {["agents", "mcp", "skills"].includes(slug) && (
                  <div className="docs-agent-callout">
                    <Sparkles size={20} />
                    <div>
                      <strong>Context that travels with you.</strong>
                      <p>The same guides and API contract, in your editor.</p>
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
                    {localText(page.markdown)}
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
                {link(
                  "/docs/mcp",
                  <>
                    <Plug size={14} />
                    Connect docs MCP
                    <ArrowUpRight size={12} />
                  </>,
                )}
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
            placeholder="Search guides, endpoints, settlement..."
          />
          <CommandList>
            <CommandEmpty>
              No pages found. Try “settlement”, “webhook” or “activation”.
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
            Take Namepass into your workflow
          </DialogTitle>
          <DialogDescription>
            Copy this context into your coding agent, or open it in your
            assistant. No API credentials are included.
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
            {link("/docs/mcp", "Connect MCP")}
            <span>·</span>
            {link("/docs/skills", "Install the skill")}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
