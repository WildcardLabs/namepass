import { useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Menu,
  BookOpen,
  Layers3,
  Calculator,
  ChevronDown,
  Globe2,
  Trophy,
  Search,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./ui/dropdown-menu";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose,
} from "./ui/sheet";

interface Props {
  onProtocol: () => void;
  onSimulate: () => void;
  onSearch: () => void;
  onHome: () => void;
  onDocs?: () => void;
  onExplore?: () => void;
  onSupported?: () => void;
  onLeaderboard?: () => void;
  showMenu?: boolean;
}

export default function Navbar({
  onProtocol,
  onSimulate,
  onSearch,
  onHome,
  onDocs,
  onExplore,
  onSupported,
  onLeaderboard,
  showMenu = true,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const product = [
    {
      label: "Protocol",
      detail: "ENS renewals via USDC",
      action: onProtocol,
      icon: Layers3,
    },
    {
      label: "Rates",
      detail: "Check ENS renewal prices",
      action: onSimulate,
      icon: Calculator,
    },
    ...(onExplore
      ? [
          {
            label: "Explorer",
            detail: "ENS renewal activity",
            action: onExplore,
            icon: Search,
          },
        ]
      : []),
  ];
  const resources = [
    ...(onSupported
      ? [
          {
            label: "Supported networks",
            detail: "USDC contracts",
            action: onSupported,
            icon: Globe2,
          },
        ]
      : []),
    ...(onLeaderboard
      ? [
          {
            label: "Leaderboard",
            detail: "Renewals",
            action: onLeaderboard,
            icon: Trophy,
          },
        ]
      : []),
  ];
  const groups = [
    { label: "Product", items: product },
    ...(resources.length ? [{ label: "Resources", items: resources }] : []),
  ];
  const mobileItems = [
    ...product,
    ...(onDocs ? [{ label: "Docs", action: onDocs, icon: BookOpen }] : []),
    ...resources,
  ];
  return (
    <header className="site-header">
      <nav className="site-nav" aria-label="Main navigation">
        <a
          href={import.meta.env.BASE_URL}
          aria-label="Namepass home"
          onClick={(event) => {
            event.preventDefault();
            onHome();
          }}
          className="site-brand"
        >
          <img
            src={import.meta.env.BASE_URL + "namepass-logo.png"}
            alt="Namepass"
          />
        </a>
        {showMenu && (
          <div className="site-desktop-menu">
            {groups.map((group) => (
              <DropdownMenu key={group.label}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="site-nav-link">
                    {group.label}
                    <ChevronDown
                      size={14}
                      className="site-nav-chevron"
                      aria-hidden="true"
                    />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  sideOffset={14}
                  className="site-nav-dropdown"
                >
                  {group.items.map((item) => (
                    <DropdownMenuItem
                      key={item.label}
                      onSelect={item.action}
                      className="site-nav-dropdown-item"
                    >
                      <span className="site-nav-icon">
                        <item.icon size={18} aria-hidden="true" />
                      </span>
                      <span className="site-nav-item-copy">
                        <span>{item.label}</span>
                        <small>{item.detail}</small>
                      </span>
                      <ArrowUpRight
                        size={14}
                        className="site-nav-item-arrow"
                        aria-hidden="true"
                      />
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ))}
            {onDocs && (
              <Button
                variant="ghost"
                onClick={onDocs}
                className="site-nav-link"
              >
                Docs
                <ArrowUpRight size={14} aria-hidden="true" />
              </Button>
            )}
          </div>
        )}
        <div className="site-nav-actions">
          <Button
            onClick={onSearch}
            className="primary-action site-start-button"
          >
            Get Started
            <ArrowUpRight size={16} aria-hidden="true" />
          </Button>
          {showMenu && (
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="site-menu-trigger"
                  aria-label="Open navigation menu"
                >
                  <Menu size={20} />
                </Button>
              </SheetTrigger>
              <SheetContent
                className="site-mobile-menu"
                aria-describedby={undefined}
              >
                <SheetHeader>
                  <SheetTitle>Navigation</SheetTitle>
                </SheetHeader>
                <nav
                  aria-label="Mobile navigation"
                  className="site-mobile-links"
                >
                  {mobileItems.map((item) => (
                    <SheetClose key={item.label} asChild>
                      <Button variant="ghost" onClick={item.action}>
                        <item.icon size={18} aria-hidden="true" />
                        {item.label}
                        <ArrowRight
                          size={16}
                          className="ml-auto"
                          aria-hidden="true"
                        />
                      </Button>
                    </SheetClose>
                  ))}
                </nav>
                <SheetClose asChild>
                  <Button onClick={onSearch} className="primary-action w-full">
                    Get Started
                    <ArrowUpRight size={16} aria-hidden="true" />
                  </Button>
                </SheetClose>
              </SheetContent>
            </Sheet>
          )}
        </div>
      </nav>
    </header>
  );
}
