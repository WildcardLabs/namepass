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
  const networks = [
    { logo: "base", y: 52 },
    { logo: "arbitrum", y: 104 },
    { logo: "ethereum", y: 156 },
    { logo: "arc", y: 208 },
  ];
  return (
    <figure
      className="docs-renewal-art"
      aria-label="Illustrative flow: USDC on Base, Arbitrum, Ethereum or Arc funds alice.namepass.eth and renews alice.eth"
    >
      <svg
        viewBox="0 0 480 280"
        role="img"
        aria-label="Funding networks connect to a deposit subname, then an ENS renewal"
      >
        <defs>
          <linearGradient
            id="renewal-wallet-fill"
            x1="178"
            y1="72"
            x2="380"
            y2="194"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#ffffff" />
            <stop offset="1" stopColor="#f5faf7" />
          </linearGradient>
          <linearGradient
            id="renewal-edge"
            x1="70"
            y1="130"
            x2="188"
            y2="130"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#cdded5" />
            <stop offset="1" stopColor="#82b397" />
          </linearGradient>
          <filter
            id="renewal-card-shadow"
            x="-20%"
            y="-20%"
            width="140%"
            height="160%"
          >
            <feDropShadow
              dx="0"
              dy="5"
              stdDeviation="7"
              floodColor="#264535"
              floodOpacity=".07"
            />
          </filter>
          <radialGradient id="renewal-halo">
            <stop stopColor="#e8f4eb" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse
          cx="283"
          cy="134"
          rx="180"
          ry="117"
          fill="url(#renewal-halo)"
        />
        <text x="15" y="15" className="art-svg-overline">
          FUND WITH USDC
        </text>
        {networks.map((network, i) => (
          <g key={network.logo}>
            <path
              id={`renewal-route-${i}`}
              d={`M68 ${network.y}H104C139 ${network.y} 128 130 183 130`}
              className="art-svg-route"
            />
            <circle r="2.5" className="art-svg-packet">
              <animateMotion
                dur={`${4 + i * 0.35}s`}
                begin={`-${i * 0.8}s`}
                repeatCount="indefinite"
                path={`M68 ${network.y}H104C139 ${network.y} 128 130 183 130`}
              />
            </circle>
            <circle
              cx="49"
              cy={network.y}
              r="19"
              fill="#fff"
              stroke="#e1eae4"
            />
            <image
              href={`/logos/${network.logo}.svg`}
              x="38"
              y={network.y - 11}
              width="22"
              height="22"
            />
          </g>
        ))}
        <circle
          cx="175"
          cy="130"
          r="4"
          fill="#9cc7ac"
          stroke="#fff"
          strokeWidth="2"
        />
        <g filter="url(#renewal-card-shadow)">
          <rect
            x="183"
            y="80"
            width="225"
            height="111"
            rx="10"
            fill="url(#renewal-wallet-fill)"
            stroke="#d7e5dc"
          />
          <text x="200" y="103" className="art-svg-overline">
            DEPOSIT SUBNAME
          </text>
          <text x="200" y="130" className="art-svg-alias">
            alice.namepass.eth
          </text>
          <line x1="200" y1="143" x2="391" y2="143" stroke="#e4ece6" />
          <image
            href="/logos/usdc.svg"
            x="200"
            y="156"
            width="15"
            height="15"
          />
          <text x="222" y="168" className="art-svg-caption">
            USDC funding address
          </text>
        </g>
        <path
          d="M296 191V216Q296 226 308 226H332"
          className="art-svg-settlement"
        />
        <circle r="3" className="art-svg-packet">
          <animateMotion
            dur="3.5s"
            begin="-1.6s"
            repeatCount="indefinite"
            path="M296 191V216Q296 226 308 226H332"
          />
        </circle>
        <g filter="url(#renewal-card-shadow)">
          <rect
            x="331"
            y="204"
            width="137"
            height="61"
            rx="9"
            fill="#f7fbf8"
            stroke="#d4e5d9"
          />
          <image href="/logos/ens.svg" x="346" y="222" width="25" height="25" />
          <text x="381" y="224" className="art-svg-overline">
            RENEW
          </text>
          <text x="381" y="245" className="art-svg-target">
            alice.eth
          </text>
        </g>
        <text x="184" y="259" className="art-svg-example">
          Illustrative example
        </text>
      </svg>
    </figure>
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
export default function Docs({ onHome }: { onHome: () => void }) {
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
  const pageMarkdown = page
    ? `# ${page.title}\n\n${page.method ? `\`${page.method} /api/v1${page.path}\`\n\n` : ""}${publishedText(page.markdown)}`
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
  const pageTools = page ? (
    <div className="docs-page-tools">
      <CopyButton
        key={page.slug}
        value={pageMarkdown}
        label="Copy page"
        className="docs-copy-page"
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          className="docs-page-actions"
          aria-label="Page options"
        >
          <ChevronDown size={14} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="docs-dropdown">
          <DropdownMenuItem
            onSelect={() => void copy(pageMarkdown, "Page copied as Markdown")}
          >
            <Copy size={16} />
            <div>
              <strong>Copy page</strong>
              <span>Copy as Markdown</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={`/docs/${page.slug}.md`} target="_blank" rel="noreferrer">
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
            <a href="/docs/skills/namepass-integration/SKILL.md" download>
              <ArrowRight size={16} />
              <div>
                <strong>Download integration skill</strong>
                <span>A reusable workflow for your agent</span>
              </div>
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ) : null;
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
          <a
            href={import.meta.env.BASE_URL}
            className="docs-brand"
            aria-label="Namepass home"
            onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
                return;
              event.preventDefault();
              onHome();
            }}
          >
            <img
              src="/namepass-logo.png"
              width="96"
              height="14"
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
                            Start building <ArrowRight size={14} />
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
                        {pageTools}
                      </div>
                    )}
                    {slug !== "introduction" && pageTools}
                  </div>
                  {slug === "introduction" && <RenewalIllustration />}
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
                    href={`${repo}/edit/main/${page.source}`}
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
