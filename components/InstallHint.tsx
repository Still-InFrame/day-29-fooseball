"use client";

import { useState, useSyncExternalStore } from "react";

// True fullscreen on iOS is only possible via "Add to Home Screen" (Apple blocks
// the JS Fullscreen API for web pages). This banner shows ONLY on iPhone/iPad
// Safari when NOT already installed, pointing users to that flow.
const noop = () => () => {};

function detectIosBrowser() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua);
  const standalone =
    ("standalone" in navigator && (navigator as unknown as { standalone?: boolean }).standalone) ||
    (typeof matchMedia !== "undefined" && matchMedia("(display-mode: standalone)").matches);
  return isIos && !standalone;
}

export default function InstallHint() {
  // false during SSR + first hydration render (no mismatch), real value after.
  const show = useSyncExternalStore(noop, detectIosBrowser, () => false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem("fooseball_install_dismissed") === "1";
    } catch {
      return false;
    }
  });

  if (!show || dismissed) return null;

  return (
    <div className="arcade border-[3px] border-amber/70 rounded-lg bg-black/40 p-3 mb-6 flex items-center gap-3">
      <span className="text-lg">📲</span>
      <p className="text-[0.5rem] leading-[1.7] opacity-85 flex-1">
        Play fullscreen: tap{" "}
        <svg viewBox="0 0 24 24" className="inline-block w-3 h-3 align-middle mx-0.5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 3v13M12 3l-4 4M12 3l4 4" />
          <path d="M5 12v7a1 1 0 001 1h12a1 1 0 001-1v-7" />
        </svg>{" "}
        Share, then <span className="text-amber">Add to Home Screen</span>
      </p>
      <button
        onClick={() => {
          setDismissed(true);
          try {
            localStorage.setItem("fooseball_install_dismissed", "1");
          } catch {}
        }}
        aria-label="Dismiss"
        className="text-[0.6rem] opacity-60 hover:text-amber px-1"
      >
        ✕
      </button>
    </div>
  );
}
