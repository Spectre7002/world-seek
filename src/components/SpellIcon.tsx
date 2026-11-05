"use client";

import type { SpellId } from "@/shared/spells";

export default function SpellIcon({ id }: { id: SpellId }) {
  if (id === "scry") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="8.5" r="5.5" />
        <path d="M9.4 6.4a3.4 3.4 0 0 1 2.2-1.2" />
        <path d="M9 13.4 8 16M15 13.4 16 16" />
        <path d="M7 16h10M8 16l-1.5 2.5h11L16 16" />
      </svg>
    );
  }

  if (id === "arrow") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="5.5" cy="18.5" r="1.8" />
        <path d="M8.5 15.5 19 5M10 5h9v9" />
      </svg>
    );
  }

  if (id === "echo") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 12a8 8 0 0 1 8-8M8 12a4 4 0 0 1 4-4M12 12h.01" />
      </svg>
    );
  }

  if (id === "compass") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M15.5 8.5 13.4 13.4 8.5 15.5 10.6 10.6z" />
      </svg>
    );
  }

  if (id === "heatmap") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
        <circle cx="12" cy="12" r="2.2" />
      </svg>
    );
  }

  if (id === "freeze") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2v20M3.5 7l17 10M20.5 7l-17 10" />
        <path d="M12 6 9.5 3.5M12 6l2.5-2.5M12 18l-2.5 2.5M12 18l2.5 2.5" />
      </svg>
    );
  }

  if (id === "reroll") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 12a8 8 0 1 1-2.6-5.9" />
        <path d="M20 4v5h-5" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
