"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Accessibility behaviour for a modal dialog: role/aria props, Escape to
 * close, a focus trap that keeps Tab inside the dialog, focus moved to the
 * first control on open, and focus restored to the opener on close.
 *
 * Returns the ref to attach to the dialog container element.
 */
export function useDialog<T extends HTMLElement = HTMLDivElement>(
  onClose: () => void,
  enabled = true,
) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const node = ref.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus into the dialog so keyboard users are not left behind it.
    const focusFirst = () => {
      const focusable = node?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusable && focusable.length > 0) focusable[0].focus();
      else node?.focus();
    };
    focusFirst();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !node) return;
      const focusable = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, [onClose, enabled]);

  return ref;
}
