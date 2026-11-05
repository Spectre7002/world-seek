"use client";

import { useEffect } from "react";

/**
 * Registers the PWA service worker (see `public/sw.js`). Mounted once from the
 * root layout. Registration is deferred to the load event so it never competes
 * with the first paint, and every failure is swallowed — a missing service
 * worker must never break the game.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
