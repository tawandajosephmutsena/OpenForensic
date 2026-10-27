"use client";

import { useEffect, useState } from "react";
import { DownloadSimple, X } from "@phosphor-icons/react";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function InstallAppButton({ className = "" }: { className?: string }) {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    if ("openForensicAgent" in window) { setInstalled(true); return; }
    setInstalled(window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
    const onPrompt = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPromptEvent); };
    const onInstalled = () => { setInstalled(true); setShowHelp(false); setPrompt(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  const install = async () => {
    if (!prompt) { setShowHelp(true); return; }
    await prompt.prompt();
    const choice = await prompt.userChoice;
    setPrompt(null);
    if (choice.outcome === "accepted") setInstalled(true);
  };

  const isSafari = typeof navigator !== "undefined" && /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

  return (
    <div className="relative">
      <button type="button" onClick={install} className={className || "inline-flex items-center gap-2 rounded-lg border border-teal-200 bg-white px-3 py-2 text-xs font-semibold text-teal-800 hover:bg-teal-50"}>
        <DownloadSimple size={16} /> Install app
      </button>
      {showHelp && (
        <div role="dialog" aria-label="Install Open Forensic" className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-teal-100 bg-white p-4 text-left shadow-xl">
          <button type="button" aria-label="Close install help" onClick={() => setShowHelp(false)} className="absolute right-3 top-3 text-slate-500 hover:text-slate-900"><X size={16} /></button>
          <strong className="block pr-5 text-sm text-slate-900">Install Open Forensic</strong>
          <p className="mt-2 text-xs leading-5 text-slate-600">{isSafari ? "In Safari, choose File → Add to Dock (macOS) or Share → Add to Home Screen (iPhone/iPad)." : "Use your browser’s Install app option in the address bar or browser menu. Installation is available when the app is served over HTTPS in a supported browser."}</p>
        </div>
      )}
    </div>
  );
}
