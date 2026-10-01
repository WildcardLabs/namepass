import { Activity, ChevronRight } from "lucide-react";

/** Existing Explorer actions, presented as a regular panel over the landscape. */
export default function BottomRightCorner({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="hero-explorer-panel">
      <button
        onClick={onOpen}
        aria-label="Open Explorer"
        className="hero-explorer-icon transition-colors"
      >
        <Activity className="w-5 h-5" />
      </button>
      <div className="flex flex-col">
        <span className="hero-explorer-title">Explorer</span>
        <button
          onClick={onOpen}
          className="hero-explorer-link transition-colors"
        >
          <span>Testnet renewals</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
