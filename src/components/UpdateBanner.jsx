import React, { useEffect, useState } from "react";

// "A newer version is live — reload." The app is one built bundle
// (/assets/index-<hash>.js); a deploy changes the hash. Every few minutes, and
// whenever the tab comes back into view, fetch the live index.html and compare
// its bundle with the one this tab is running. A tab left open for days (the
// iPad) then says so instead of quietly running old code — which matters most
// for the Tip Sheet, where old code may not know a sheet's calculation method.
//
// Dev server: there's no hashed bundle in the page, so this never shows.
const CHECK_EVERY_MS = 5 * 60 * 1000;
const BUNDLE_RE = /\/assets\/index-[\w-]+\.js/;

function runningBundle() {
  const el = [...document.querySelectorAll("script[src]")].find((s) => BUNDLE_RE.test(s.getAttribute("src") || ""));
  return el ? el.getAttribute("src").match(BUNDLE_RE)[0] : null;
}

export default function UpdateBanner() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const mine = runningBundle();
    if (!mine) return undefined;
    let stopped = false;
    async function check() {
      try {
        const res = await fetch("/", { cache: "no-store" });
        if (!res.ok) return;
        const live = (await res.text()).match(BUNDLE_RE)?.[0];
        if (!stopped && live && live !== mine) setStale(true);
      } catch {
        /* offline or a blip — try again next time */
      }
    }
    const timer = setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    check();
    return () => { stopped = true; clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  if (!stale) return null;
  return (
    <div className="update-banner" role="status">
      <span><b>A newer version of the app is live.</b> Reload to update — the Tip Sheet saves itself, so wait for it to say Saved first.</span>
      <button className="publish-btn" onClick={() => window.location.reload()}>Reload</button>
    </div>
  );
}
