// Pop-up dialogs over the whole screen (dialog-fixes, 2026-11-18).
//
// Every dialog's dimmed backdrop (.day-popup-backdrop) is drawn through this
// instead of a plain <div>. It is the same div with the same props, but it is
// placed in .hub rather than where it is written. The glass panel, .hub-main,
// has a backdrop-filter, and that makes it the box position:fixed is measured
// from. So a backdrop inside it covered only the panel, not the sidebar, and
// the dialog was centred on the panel rather than the screen. On iPad, with
// the page scrolled down, that put a dialog partly off screen. In .hub it
// covers the screen. React still treats the dialog as a child of the place it
// is written, so its handlers and state are exactly the same as before.
//
// Two layout-only extras:
// - The backdrop follows the visible part of the screen (visualViewport), so
//   the iPad keyboard or pinch-zoom can't leave a dialog under the keyboard
//   or off the edge.
// - When a dialog is taller than the screen it scrolls inside itself, and the
//   dialog gets the class dlg-scrolls. CSS then pins its header (close button)
//   and its button row so they stay in view. A dialog that fits gets no class
//   and looks exactly as before.
import React, { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

export default function DialogLayer({ children, ...props }) {
  const ref = useRef(null);

  // Fit the backdrop to the visible screen, and keep it fitted. Normally the
  // CSS (position: fixed; inset: 0) already covers the screen, through a
  // rotation too, so nothing is set here. Only while the visible part is
  // smaller than the page's screen (the iPad keyboard is up, or the page is
  // pinch-zoomed) is the backdrop given that smaller box.
  const fitRef = useRef(() => {});
  useLayoutEffect(() => {
    const el = ref.current;
    const vv = window.visualViewport;
    if (!el || !vv) return undefined;
    const fit = () => {
      const root = document.documentElement;
      const whole = vv.offsetTop === 0 && vv.offsetLeft === 0 &&
        Math.abs(vv.width - root.clientWidth) < 1 && Math.abs(vv.height - root.clientHeight) < 1;
      if (whole) {
        for (const p of ["inset", "top", "left", "width", "height"]) el.style.removeProperty(p);
        return;
      }
      el.style.inset = "auto";
      el.style.top = `${vv.offsetTop}px`;
      el.style.left = `${vv.offsetLeft}px`;
      el.style.width = `${vv.width}px`;
      el.style.height = `${vv.height}px`;
    };
    fitRef.current = fit;
    fit();
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    window.addEventListener("resize", fit);
    return () => {
      vv.removeEventListener("resize", fit);
      vv.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
    };
  }, []);

  // Does the dialog have to scroll? Checked after every render (the dialog's
  // content changes as people type and pick) and whenever its size changes.
  // The dialog's own padding is copied into CSS variables so the pinned
  // header and button row can reach its edges. Its children are watched too,
  // because a dialog already at full height doesn't change size when its
  // content grows (an opened <details>, say); only the content does.
  const roRef = useRef(null);
  const measure = () => {
    fitRef.current();
    const dlg = ref.current?.firstElementChild;
    if (!dlg) return;
    const cs = getComputedStyle(dlg);
    dlg.style.setProperty("--dlg-pt", cs.paddingTop);
    dlg.style.setProperty("--dlg-pr", cs.paddingRight);
    dlg.style.setProperty("--dlg-pb", cs.paddingBottom);
    dlg.style.setProperty("--dlg-pl", cs.paddingLeft);
    dlg.classList.toggle("dlg-scrolls", dlg.scrollHeight > dlg.clientHeight + 1);
    if (roRef.current) {
      roRef.current.observe(dlg);
      for (const c of dlg.children) roRef.current.observe(c);
    }
  };
  useLayoutEffect(measure);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return undefined;
    roRef.current = new ResizeObserver(() => measure());
    measure();
    return () => { roRef.current.disconnect(); roRef.current = null; };
  }, []);

  const layer = <div ref={ref} {...props}>{children}</div>;
  const host = typeof document !== "undefined" ? document.querySelector(".hub") : null;
  return host ? createPortal(layer, host) : layer;
}
