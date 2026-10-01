import HeroBadge from "./HeroBadge";
import { ArrowRight } from "lucide-react";
import { Button } from "./ui/button";

/** Shared type, framing and actions introduce the public application. */
export default function Hero({
  onExplore,
  onDocs,
}: {
  onExplore: () => void;
  onDocs: () => void;
}) {
  return (
    <section className="home-hero">
      <div className="home-hero-copy">
        <HeroBadge />

        <h1 className="text-ink-primary">
          Give a name <span className="text-ink-action">more time</span>
        </h1>

        <p className="text-ink-secondary">
          Send USDC to an ENS name’s deposit address. Watch it turn into renewal
          time.
        </p>
        <div className="home-hero-actions">
          <Button className="primary-action" onClick={onExplore}>
            Get Started
            <ArrowRight size={16} aria-hidden="true" />
          </Button>
          <Button variant="outline" onClick={onDocs}>
            Read the docs
            <ArrowRight size={16} aria-hidden="true" />
          </Button>
        </div>
      </div>
    </section>
  );
}
