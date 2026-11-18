// Tip Sheet tap panels: the Clock In / Clock Out time wheel, and the bank
// count wheel (which sits beside the bank table, or in this panel as a bottom
// sheet on narrow screens). Screen only.
//
// The panel is portalled into .hub itself — never inside the sheet card and
// never inside .hub-main — and fixed-positioned from the tapped cell's rect.
// .hub-main is the blurred glass panel, and an element with backdrop-filter
// becomes the box that position:fixed children are placed against, so a panel
// drawn inside it landed one sidebar-width too far right (off the iPad's
// screen, iPad fixes 2026-11-18). .hub has no filter or transform, so here
// fixed means the screen, and the theme tokens .hub sets still apply.
// No ancestor's overflow can clip it, nothing under it moves, and the PDF
// capture (the card) and @media print (.screen-only) never see it.
//
// Three placements:
// - Narrow (sheetQuery; the wheels use under 900px — iPad portrait, phones):
//   a bottom sheet, centred and docked to the bottom of what's visible (above
//   the on-screen keyboard when it's up). If the sheet would cover the tapped
//   cell, the page scrolls up once so the row being entered stays in sight.
// - Wide, with `beside` (the clock wheel): next to that table, on whichever
//   side has room, with the wheel's centre band level with the tapped cell.
// - Wide, without: a popover under (or over) the tapped cell.
// Every placement is clamped to the visible screen, and the panel is never
// taller than it (it scrolls inside instead).
// Choices live in lib/tipPickers.js, which is tested against what the sheet pays.

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { formatTime, parsePickerTime } from "../lib/tipTimes.js";
import {
  cashCheck, parseCents, centsToStored,
  clockCaption, clockOpenIndex, clockRows, clockStoredIndex,
  wheelCaption, wheelIndexFor, wheelRows,
} from "../lib/tipPickers.js";

const GAP = 6;
const EDGE = 8;
const SHEET_QUERY = "(max-width: 1099px)";

// lo wins when the panel is bigger than the room (top/left edge stays visible).
const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
const matches = (q) => typeof window !== "undefined" && !!window.matchMedia?.(q).matches;

export function PickerPanel({ anchor, onClose, label, children, beside = null, sheetQuery = SHEET_QUERY }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [pos, setPos] = useState(null);
  const [sheet, setSheet] = useState(() => matches(sheetQuery));
  const revealedFor = useRef(null); // the cell already scrolled clear of the sheet
  const roomRef = useRef(null); // room added below the page for that, if any

  // Turning the iPad (or resizing a window) across the line switches placement.
  useEffect(() => {
    const mq = window.matchMedia?.(sheetQuery);
    if (!mq) return undefined;
    const onChange = () => setSheet(mq.matches);
    onChange();
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange); // older iPad Safari
    window.addEventListener("resize", onChange); // belt and braces for rotation
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange); else mq.removeListener(onChange);
      window.removeEventListener("resize", onChange);
    };
  }, [sheetQuery]);

  useLayoutEffect(() => {
    function place() {
      const el = ref.current;
      if (!el || !anchor?.isConnected) return;
      const r = anchor.getBoundingClientRect();
      // The visible part of the page, in the same coordinates as `r` and as
      // position:fixed (pinch-zoom and the iPad keyboard shrink it).
      const vv = window.visualViewport;
      const minX = vv ? vv.offsetLeft : 0;
      const minY = vv ? vv.offsetTop : 0;
      const maxX = minX + (vv ? vv.width : window.innerWidth);
      const maxY = minY + (vv ? vv.height : window.innerHeight);
      // Never taller than what's visible: the panel scrolls inside instead.
      const maxH = Math.max(120, Math.floor(maxY - minY - 2 * EDGE));
      const w = el.offsetWidth;
      const h = Math.min(el.offsetHeight, maxH);
      let left;
      let top;
      if (sheet) {
        // Home-indicator room on iPads without a home button (0 elsewhere);
        // CSS gives the sheet a margin-bottom of env(safe-area-inset-bottom).
        const safe = parseFloat(getComputedStyle(el).marginBottom) || 0;
        left = clamp(minX + (maxX - minX - w) / 2, minX + EDGE, maxX - w - EDGE);
        top = clamp(maxY - h - EDGE - safe, minY + EDGE, maxY - h - EDGE);
        if (revealedFor.current !== anchor) {
          revealedFor.current = anchor;
          const covered = r.bottom + GAP - top;
          if (covered > 0) {
            // A row near the end of the page can't scroll up far enough on
            // its own (the Tip Sheet's last rows in portrait): give the page
            // that much room below while the sheet is open, then scroll. The
            // room is a variable only an @media screen rule reads (App's
            // styles), so paper never sees it.
            const se = document.scrollingElement || document.documentElement;
            const room = se.scrollHeight - se.clientHeight - window.scrollY;
            if (room < covered) {
              roomRef.current = (roomRef.current || 0) + Math.ceil(covered - room);
              document.body.style.setProperty("--tp-room", `${roomRef.current}px`);
            }
            // Instant, not smooth: a smooth scroll is cancelled by a field's
            // focus and never finishes in a hidden tab.
            window.scrollBy(0, covered);
          }
        }
      } else if (beside?.isConnected) {
        // Beside the table: right of it if there's room, else left of it,
        // else as close to the cell as the screen allows.
        const t = beside.getBoundingClientRect();
        const tl = Math.max(t.left, minX);
        const tr = Math.min(t.right, maxX);
        if (maxX - EDGE - (tr + GAP) >= w) left = tr + GAP;
        else if (tl - GAP - (minX + EDGE) >= w) left = tl - GAP - w;
        else left = clamp(r.right + GAP, minX + EDGE, maxX - w - EDGE);
        // The wheel's centre band level with the tapped cell.
        const band = el.querySelector(".bw-band");
        const mid = band ? band.getBoundingClientRect().top - el.getBoundingClientRect().top + band.offsetHeight / 2 : h / 2;
        top = clamp(r.top + r.height / 2 - mid, minY + EDGE, maxY - h - EDGE);
      } else {
        left = clamp(r.left + r.width / 2 - w / 2, minX + EDGE, maxX - w - EDGE);
        top = r.bottom + GAP;
        if (top + h > maxY - EDGE && r.top - h - GAP >= minY + EDGE) top = r.top - h - GAP; // no room below: open above
        top = clamp(top, minY + EDGE, maxY - h - EDGE); // no room either way: stay on screen
      }
      setPos((p) => (p && p.left === left && p.top === top && p.maxH === maxH ? p : { left, top, maxH }));
    }
    place();
    const ro = new ResizeObserver(place);
    if (ref.current) ro.observe(ref.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
      // The room added below the page goes when the sheet does.
      if (roomRef.current) {
        document.body.style.removeProperty("--tp-room");
        roomRef.current = null;
        revealedFor.current = null;
      }
    };
  }, [anchor, sheet, beside]);

  // Tapping outside closes (tapping another cell closes this, then opens that
  // one — one panel at a time). Escape closes.
  useEffect(() => {
    function down(e) {
      if (ref.current?.contains(e.target) || anchor?.contains(e.target)) return;
      closeRef.current();
    }
    function key(e) { if (e.key === "Escape") closeRef.current(); }
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key);
    };
  }, [anchor]);

  const placement = sheet ? " tp-sheet" : beside ? " tp-side" : "";
  const panel = (
    <div
      ref={ref}
      className={`tip-picker screen-only${placement}`}
      role="dialog"
      aria-label={label}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, maxHeight: pos?.maxH, visibility: pos ? "visible" : "hidden" }}
    >
      {children}
    </div>
  );
  const host = anchor?.closest?.(".hub") || document.body;
  return createPortal(panel, host);
}

// ---- The wheel itself (shared by the bank count and the clock) ----------
//
// Native scrolling with scroll-snap, so it spins with momentum on iPad
// Safari; tapping a row jumps to it.
//
// Saving happens only when all of these hold: a person moved the wheel, it has
// stopped (no scroll for WHEEL_SETTLE_MS and no finger on it), and it stopped
// on a different row from the stored one. It goes through `onSet` — App
// points it at the cell's own setter, the same one its typed field uses, with
// the same stored text. Opening the wheel, or the stored value changing from
// elsewhere, re-centres it without saving. A stored value that isn't one of
// the rows has a row of its own and stays as it is unless the wheel is moved
// off it.
//
// baseIdx is the stored value's row, -1 when nothing is stored (so stopping
// anywhere, even on the row it opened on, sets it). openIdx is where it opens,
// which for an empty clock box isn't a stored row.
//
// flushRef: App calls it before the selection moves, the wheel closes or a PDF
// is drawn, so a spin that hasn't settled yet still counts. Unmounting any
// other way (tab or date change, lock) drops it: never written into another
// sheet.
const WHEEL_SETTLE_MS = 400;

function useSpinWheel({ rows, baseIdx, openIdx = baseIdx, onSet, flushRef }) {
  const scrollRef = useRef(null);
  const onSetRef = useRef(onSet);
  onSetRef.current = onSet;
  // touched: a person moved it since the last centring; holding: a finger is
  // on it; idx: the row under the band; base: the stored value's row.
  const s = useRef({ touched: false, holding: false, timer: 0, idx: openIdx, base: baseIdx, rowH: 44, rows });
  s.current.rows = rows;
  const [center, setCenter] = useState(openIdx);

  function rowHeight(el) {
    return el.querySelector(".bw-item")?.offsetHeight || s.current.rowH;
  }
  function cancelSpin() {
    const st = s.current;
    clearTimeout(st.timer);
    st.timer = 0;
    st.touched = false;
  }
  function commitNow() {
    const st = s.current;
    clearTimeout(st.timer);
    st.timer = 0;
    if (!st.touched) return;
    st.touched = false;
    const row = st.rows[st.idx];
    if (!row || st.idx === st.base) return;
    st.base = st.idx;
    onSetRef.current(row.value);
  }
  function settleLater() {
    const st = s.current;
    clearTimeout(st.timer);
    st.timer = setTimeout(() => {
      st.timer = 0;
      if (!st.holding) commitNow(); // finger still down: touchend asks again
    }, WHEEL_SETTLE_MS);
  }

  // Centre the opening row — on open, and when the stored value changes from
  // elsewhere (a save, the typed field, another device). Never mid-spin.
  useLayoutEffect(() => {
    const st = s.current;
    if (st.timer || st.holding) return;
    const el = scrollRef.current;
    if (!el) return;
    st.rowH = rowHeight(el);
    st.base = baseIdx;
    st.idx = openIdx;
    st.touched = false;
    el.scrollTop = openIdx * st.rowH;
    setCenter(openIdx);
  }, [rows, baseIdx, openIdx]);

  useEffect(() => () => clearTimeout(s.current.timer), []);

  useEffect(() => {
    if (!flushRef) return undefined;
    const flush = () => commitNow();
    flushRef.current = flush;
    return () => { if (flushRef.current === flush) flushRef.current = null; };
  });

  function onScroll(e) {
    const st = s.current;
    const el = e.currentTarget;
    st.rowH = rowHeight(el);
    const i = Math.max(0, Math.min(st.rows.length - 1, Math.round(el.scrollTop / st.rowH)));
    st.idx = i;
    setCenter(i);
    if (st.touched) settleLater();
  }
  function grab() {
    const st = s.current;
    st.touched = true;
    st.holding = true;
    clearTimeout(st.timer);
    st.timer = 0;
  }
  function release() {
    const st = s.current;
    if (!st.holding) return;
    st.holding = false;
    settleLater(); // momentum keeps scrolling, and each scroll waits again
  }
  function jump(i) {
    const st = s.current;
    const el = scrollRef.current;
    if (!el || i < 0 || i >= st.rows.length) return;
    st.touched = true;
    st.idx = i;
    setCenter(i);
    el.scrollTop = i * st.rowH;
    settleLater();
  }
  function onKeyDown(e) {
    const last = s.current.rows.length - 1;
    const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 }[e.key];
    let to = null;
    if (step) to = Math.max(0, Math.min(last, s.current.idx + step));
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = last;
    if (to == null) return;
    e.preventDefault();
    jump(to);
  }

  const scrollProps = {
    ref: scrollRef,
    onScroll,
    onTouchStart: grab,
    onTouchEnd: release,
    onTouchCancel: release,
    onWheel: () => { s.current.touched = true; },
    onKeyDown,
  };
  return { center, jump, cancelSpin, scrollProps };
}

// The wheel's drum: the copper band, the rows, the padding above and below.
function Drum({ uid, rows, center, jump, scrollProps, label, rowClass }) {
  return (
    <div className="bw-wheel">
      <div className="bw-band" aria-hidden="true" />
      <div
        {...scrollProps}
        className="bw-scroll"
        tabIndex={0}
        role="listbox"
        aria-label={label}
        aria-activedescendant={`${uid}-${center}`}
      >
        <div className="bw-pad" aria-hidden="true" />
        {rows.map((r, i) => (
          <div
            key={r.key}
            id={`${uid}-${i}`}
            role="option"
            aria-selected={i === center}
            className={`bw-item${i === center ? " on" : ""}${r.asIs ? " bw-asis" : ""}${rowClass ? rowClass(r) : ""}`}
            onClick={() => jump(i)}
          >{r.label}</div>
        ))}
        <div className="bw-pad" aria-hidden="true" />
      </div>
    </div>
  );
}

// ---- Bank count wheel (replaced the cash chips popover, 2026-11-18) -----
//
// Screen only. Tapping a bank cell selects it (App's bankSel); this wheel
// steps through that denomination, 0 to 100 of the bill or coin (rows from
// lib wheelRows). Saves through setCount, the old popover's Set handler.
export function BankWheel({ denom, denomLabel, columnLabel, value, onSet, flushRef, onDone, reveal = false }) {
  const uid = useId();
  const rootRef = useRef(null);
  const stored = value == null ? "" : String(value);
  const rows = useMemo(() => wheelRows(denom, stored).map((r) => ({ ...r, key: r.asIs ? "as-is" : r.cents })), [denom, stored]);
  const baseIdx = wheelIndexFor(rows, stored);
  const { center, jump, cancelSpin, scrollProps } = useSpinWheel({ rows, baseIdx, onSet, flushRef });
  const onSetRef = useRef(onSet);
  onSetRef.current = onSet;
  const inputRef = useRef(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");

  // Beside the table (reveal): a cell low in the table can be tapped with the
  // table's top — where the wheel sits — scrolled off screen. Bring the whole
  // wheel into view once, as little as needed. (The bottom sheet is placed by
  // PickerPanel instead.)
  useEffect(() => {
    const el = rootRef.current;
    if (!reveal || !el) return;
    const r = el.getBoundingClientRect();
    const vv = window.visualViewport;
    const top = vv ? vv.offsetTop : 0;
    const bottom = top + (vv ? vv.height : window.innerHeight);
    if (r.top < top || r.bottom > bottom) el.scrollIntoView({ block: "nearest" });
  }, [reveal]);

  // Type amount: the old popover's typed field, same rules. A non-multiple is
  // set as typed (only named); text that isn't an amount can't be set.
  const typedCents = parseCents(typed);
  const check = typing ? cashCheck(denom, typed.trim() ? typed : stored, denomLabel) : null;
  function openTyping() {
    // flushSync so the field exists inside this tap: iPad Safari only brings
    // the keyboard up for a focus() made during the tap itself.
    flushSync(() => setTyping(true));
    inputRef.current?.focus();
  }
  function closeTyping() {
    setTyping(false);
    setTyped("");
  }
  function applyTyped() {
    if (typedCents == null) return;
    cancelSpin(); // the typed figure wins over a spin that hasn't settled
    onSetRef.current(centsToStored(typedCents));
    closeTyping();
  }
  function clearValue() {
    cancelSpin();
    onSetRef.current("");
    closeTyping();
  }

  const caption = stored.trim() === "" && center === baseIdx
    ? "Not entered yet"
    : wheelCaption(denom, rows[center], denomLabel);

  return (
    <div ref={rootRef} className="bw" role="group" aria-label={`${denomLabel} ${columnLabel} count`}>
      <div className="bw-head">
        <span className="bw-title">{denomLabel} · {columnLabel}</span>
        {onDone && <button type="button" className="bw-done" onClick={onDone}>Done</button>}
      </div>
      <Drum
        uid={uid}
        rows={rows}
        center={center}
        jump={jump}
        scrollProps={scrollProps}
        label={`${denomLabel} ${columnLabel.toLowerCase()} amount`}
      />
      <div className="bw-count">{caption}</div>
      {!typing ? (
        <button type="button" className="bw-link" onClick={openTyping}>Type amount</button>
      ) : (
        <>
          <div className="bw-type">
            <input
              ref={inputRef}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="e.g. 420"
              aria-label={`Type the ${denomLabel} ${columnLabel.toLowerCase()} amount`}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") applyTyped(); if (e.key === "Escape") { e.stopPropagation(); closeTyping(); } }}
            />
            <button type="button" className="bw-set" disabled={typedCents == null} onClick={applyTyped}>Set</button>
            <button type="button" className="bw-clear" disabled={!stored} onClick={clearValue}>Clear</button>
          </div>
          {check && <div className="bw-note" role="status">{check.message}</div>}
        </>
      )}
    </div>
  );
}

// Beside the table before any cell is chosen, so the table never jumps
// sideways when the first cell is tapped.
export function BankWheelIdle() {
  return (
    <div className="bw bw-idle">
      <div className="bw-head"><span className="bw-title">Count</span></div>
      <div className="bw-idle-text">Tap a bank cell to count it with the wheel.</div>
    </div>
  );
}

// ---- Clock In / Clock Out wheel (replaced the time chips popover) -------
//
// Screen only. One column, 3:00 PM to 2:00 AM in 15-minute steps (rows from
// lib clockRows). Each row stores formatTime's text, the same text the typed
// field stores for that time, through the same setter (App's setSlotTime), so
// hours and tips can't tell a wheel time from a typed one — after midnight
// included. Opens on the box's own time; an empty box opens on the scheduled
// start (TIME IN) or now to the nearest 15 minutes (TIME OUT), else 3:00 PM —
// without saving. "Custom time" is the typed field, for anything the list
// doesn't have; Clear empties the box.
export function ClockWheel({ field, personName, value, scheduled = null, inText = "", onSet, flushRef, onDone }) {
  const uid = useId();
  const stored = value == null ? "" : String(value);
  // "Now" is read once, when the wheel opens, so it can't jump while open.
  const [nowMins] = useState(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); });
  const rows = useMemo(() => clockRows(stored).map((r) => ({ ...r, key: r.asIs ? "as-is" : r.pos })), [stored]);
  const baseIdx = clockStoredIndex(rows, stored);
  const openIdx = clockOpenIndex(rows, stored, { field, scheduled, nowMins });
  const { center, jump, cancelSpin, scrollProps } = useSpinWheel({ rows, baseIdx, openIdx, onSet, flushRef });
  const onSetRef = useRef(onSet);
  onSetRef.current = onSet;
  const inputRef = useRef(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [typeError, setTypeError] = useState(null);
  const what = field === "in" ? "Time In" : "Time Out";
  const sched = field === "in" ? scheduled : null;

  function openTyping() {
    // flushSync so the field exists inside this tap: iPad Safari only brings
    // the keyboard up for a focus() made during the tap itself.
    flushSync(() => setTyping(true));
    inputRef.current?.focus();
  }
  function closeTyping() {
    setTyping(false);
    setTyped("");
    setTypeError(null);
  }
  // The old popover's typed field, same parser, same stored form.
  function applyTyped() {
    const mins = parsePickerTime(typed, field);
    if (mins == null) {
      setTypeError(`"${typed.trim()}" isn't a time — try 5:45, 545 or 5 45.`);
      return;
    }
    cancelSpin(); // the typed time wins over a spin that hasn't settled
    onSetRef.current(formatTime(mins));
    closeTyping();
  }
  function clearValue() {
    cancelSpin();
    onSetRef.current("");
    closeTyping();
  }

  const caption = stored.trim() === "" && center === openIdx
    ? "Not set yet — tap or spin to set it"
    : clockCaption({ field, row: rows[center], scheduled: sched, inText });

  return (
    <div className="bw bw-clock" role="group" aria-label={`${personName} ${what.toLowerCase()}`}>
      <div className="bw-head">
        <span className="bw-title">{personName} · {what}</span>
        {onDone && <button type="button" className="bw-done" onClick={onDone}>Done</button>}
      </div>
      <Drum
        uid={uid}
        rows={rows}
        center={center}
        jump={jump}
        scrollProps={scrollProps}
        label={`${personName} ${what.toLowerCase()}`}
        rowClass={(r) => (sched != null && !r.asIs && r.mins === sched ? " bw-sched" : "")}
      />
      <div className="bw-count">{caption}</div>
      {typing && (
        <>
          <div className="bw-type">
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder={field === "out" ? "e.g. 10:30 or 1230" : "e.g. 5:45 or 545"}
              aria-label={`Type a ${field === "in" ? "time in" : "time out"}`}
              value={typed}
              onChange={(e) => { setTyped(e.target.value); setTypeError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") applyTyped(); if (e.key === "Escape") { e.stopPropagation(); closeTyping(); } }}
            />
            <button type="button" className="bw-set" disabled={!typed.trim()} onClick={applyTyped}>Set</button>
            <button type="button" className="bw-clear" onClick={closeTyping}>Cancel</button>
          </div>
          {typeError && <div className="bw-note" role="status">{typeError}</div>}
          {field === "out" && <div className="bw-hint">12:00–3:59 typed here means after midnight.</div>}
        </>
      )}
      <div className="bw-links">
        {!typing && <button type="button" className="bw-link" onClick={openTyping}>Custom time</button>}
        <button type="button" className="bw-link bw-link-quiet" disabled={!stored.trim()} onClick={clearValue}>Clear</button>
      </div>
    </div>
  );
}
