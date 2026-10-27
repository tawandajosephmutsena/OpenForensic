"use client";

import { useEffect } from "react";

export default function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || "openForensicAgent" in window) return;
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          if (registration.active?.scriptURL.endsWith("/sw.js")) void registration.unregister();
        }
      });
      return;
    }
    if (location.protocol !== "https:" && location.hostname !== "localhost") return;
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // The app remains usable when the browser disallows installation/offline caching.
    });
  }, []);

  return null;
}
