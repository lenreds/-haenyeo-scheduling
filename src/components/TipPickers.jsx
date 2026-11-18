// Tip Sheet tap panels: TIME IN / TIME OUT, and the bank count wheel (which
// sits beside the bank table, or in this panel as a bottom sheet on narrow
// screens). Screen only.
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
// Two placements:
// - 1100px and wider: a popover under (or over) the tapped cell, clamped so
//   every edge stays on screen.
// - Under 1100px (iPad either way round, phones): a bottom sheet, centred and
//   docked to the bottom of what's visible (above the on-screen keyboard when
//   it's up). If the sheet would cover the tapped cell, the page scrolls up
//   once so the row being entered stays in sight.
// Choices live in lib/tipPickers.js, which is tested against what the sheet pays.

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatTime, parsePickerTime } from "../lib/tipTimes.js";
import {
  cashCheck, paidMinute, parseCents, centsToStored,
  scheduleDelta, timeChips, timeLadderCenter,
  wheelCaption, wheelIndexFor, wheelRows,
} from "../lib/tipPickers.js";

const GAP = 6;
const EDGE = 8;
const SHEET_QUERY = "(max-width: 1099px)";

// Desktop (a mouse) gets the type field focused straight away; a touch screen
// doesn't, so the iPad keyboard only comes up when the field is tapped.
const finePointer = () => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: fine)").matches;
const sheetWidth = () => typeof window !== "undefined" && !!window.matchMedia?.(SHEET_QUERY).matches;
// lo wins when the panel is bigger than the room (top/left edge stays visible).
const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

export function PickerPanel({ anchor, onClose, label, children }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [pos, setPos] = useState(null);
  const [sheet, setSheet] = useState(sheetWidth);
  const revealedFor = useRef(null); // the cell already scrolled clear of the sheet

  // Turning the iPad (or resizing a window) across 1100px switches placement.
  useEffect(() => {
    const mq = window.matchMedia?.(SHEET_QUERY);
    if (!mq) return undefined;
    const onChange = () => setSheet(mq.matches);
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange); // older iPad Safari
    window.addEventListener("resize", onChange); // belt and braces for rotation
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange); else mq.removeListener(onChange);
      window.removeEventListener("resize", onChange);
    };
  }, []);

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
      const w = el.offsetWidth;
      const h = el.offsetHeight;
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
          // Instant, not smooth: a smooth scroll is cancelled by the type
          // field's autofocus (mouse screens) and never finishes in a hidden tab.
          if (covered > 0) window.scrollBy(0, covered);
        }
      } else {
        left = clamp(r.left + r.width / 2 - w / 2, minX + EDGE, maxX - w - EDGE);
        top = r.bottom + GAP;
        if (top + h > maxY - EDGE && r.top - h - GAP >= minY + EDGE) top = r.top - h - GAP; // no room below: open above
        top = clamp(top, minY + EDGE, maxY - h - EDGE); // no room either way: stay on screen
      }
      setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
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
    };
  }, [anchor, sheet]);

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

  const panel = (
    <div
      ref={ref}
      className={`tip-picker screen-only${sheet ? " tp-sheet" : ""}`}
      role="dialog"
      aria-label={label}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
    >
      {children}
    </div>
  );
  const host = anchor?.closest?.(".hub") || document.body;
  return createPortal(panel, host);
}

function Arrows({ onPrev, onNext, prevDisabled, children, what }) {
  return (
    <div className="tp-row">
      <button type="button" className="tp-arrow" onClick={onPrev} disabled={prevDisabled} aria-label={`Earlier ${what}`}><ChevronLeft size={18} /></button>
      <div className="tp-chips">{children}</div>
      <button type="button" className="tp-arrow" onClick={onNext} aria-label={`Later ${what}`}><ChevronRight size={18} /></button>
    </div>
  );
}

// "5:00" for "Back to 5:00".
const clock = (mins) => formatTime(mins).replace(/ (AM|PM)$/, "");

export function TimePickerBody({ field, value, scheduled, personName, onSet }) {
  const current = paidMinute(value);
  const [center] = useState(() => timeLadderCenter({ field, current, scheduled }));
  const [offset, setOffset] = useState(0);
  const [typed, setTyped] = useState("");
  const [typeError, setTypeError] = useState(null);
  const sched = field === "in" ? scheduled : null;
  const delta = field === "in" ? scheduleDelta(value, scheduled) : null;

  function applyTyped() {
    const mins = parsePickerTime(typed, field);
    if (mins == null) {
      setTypeError(`"${typed.trim()}" isn't a time — try 5:45, 545 or 5 45.`);
      return;
    }
    onSet(formatTime(mins));
  }

  return (
    <>
      <div className="tp-head">
        <span className="tp-title">{personName} · {field === "in" ? "Time In" : "Time Out"}</span>
        {delta && <span className="tp-delta">{delta}</span>}
      </div>
      <Arrows what="times" onPrev={() => setOffset((o) => o - 1)} onNext={() => setOffset((o) => o + 1)}>
        {timeChips(center, offset).map((c) => (
          <button
            key={c.mins}
            type="button"
            className={`tp-chip${c.mins === current ? " on" : ""}${c.mins === sched ? " sched" : ""}`}
            aria-pressed={c.mins === current}
            title={c.mins === sched ? "Scheduled start" : undefined}
            onClick={() => onSet(c.value)}
          >{c.label}</button>
        ))}
      </Arrows>
      <div className="tp-row tp-type">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          autoFocus={finePointer()}
          placeholder={field === "out" ? "e.g. 10:30 or 1230" : "e.g. 5:45 or 545"}
          aria-label={`Type a ${field === "in" ? "time in" : "time out"}`}
          value={typed}
          onChange={(e) => { setTyped(e.target.value); setTypeError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") applyTyped(); }}
        />
        <button type="button" className="tp-btn tp-btn-main" disabled={!typed.trim()} onClick={applyTyped}>Set</button>
      </div>
      {typeError && <div className="tp-note tp-warn">{typeError}</div>}
      {field === "out" && <div className="tp-note">12:00–3:59 typed here means after midnight.</div>}
      <div className="tp-row tp-foot">
        {sched != null && (
          <button type="button" className="tp-btn" onClick={() => onSet(formatTime(sched))}>Back to {clock(sched)}</button>
        )}
        <button type="button" className="tp-btn tp-btn-quiet" disabled={!value} onClick={() => onSet("")}>Clear</button>
      </div>
    </>
  );
}

// ---- Bank count wheel (replaced the cash chips popover, 2026-11-18) -----
//
// Screen only. Tapping a bank cell selects it (App's bankSel); this wheel
// steps through that denomination, 0 to 100 of the bill or coin (rows from
// lib wheelRows). Native scrolling with scroll-snap, so it spins with
// momentum on iPad Safari; tapping a row jumps to it.
//
// Saving happens only when all of these hold: a person moved the wheel, it has
// stopped (no scroll for WHEEL_SETTLE_MS and no finger on it), and it stopped
// on a different row from the stored one. It goes through `onSet`, which App
// points at setCount: the same handler the old popover's Set button called,
// with the same stored text. Opening the wheel, or the stored value changing
// from elsewhere, re-centres it without saving. A stored amount that isn't a
// whole multiple has a row of its own and stays as it is unless the wheel is
// moved off it.
//
// flushRef: App calls it before the selection moves, the wheel closes or a PDF
// is drawn, so a spin that hasn't settled yet still counts. Unmounting any
// other way (tab or date change, lock) drops it: never written into another
// sheet.
const WHEEL_SETTLE_MS = 400;

export function BankWheel({ denom, denomLabel, columnLabel, value, onSet, flushRef, onDone, reveal = false }) {
  const uid = useId();
  const rootRef = useRef(null);
  const stored = value == null ? "" : String(value);
  const rows = useMemo(() => wheelRows(denom, stored), [denom, stored]);
  const baseIdx = wheelIndexFor(rows, stored);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const onSetRef = useRef(onSet);
  onSetRef.current = onSet;
  // touched: a person moved it since the last centring; holding: a finger is
  // on it; idx: the row under the band; base: the stored value's row.
  const s = useRef({ touched: false, holding: false, timer: 0, idx: baseIdx, base: baseIdx, rowH: 44, rows });
  s.current.rows = rows;
  const [center, setCenter] = useState(baseIdx);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");

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

  // Centre the stored row — on open, and when the stored value changes from
  // elsewhere (a save, the typed amount, another device). Never mid-spin.
  useLayoutEffect(() => {
    const st = s.current;
    if (st.timer || st.holding) return;
    const el = scrollRef.current;
    if (!el) return;
    st.rowH = rowHeight(el);
    st.base = baseIdx;
    st.idx = baseIdx;
    st.touched = false;
    el.scrollTop = baseIdx * st.rowH;
    setCenter(baseIdx);
  }, [rows, baseIdx]);

  useEffect(() => () => clearTimeout(s.current.timer), []);

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
      <div className="bw-wheel">
        <div className="bw-band" aria-hidden="true" />
        <div
          ref={scrollRef}
          className="bw-scroll"
          tabIndex={0}
          role="listbox"
          aria-label={`${denomLabel} ${columnLabel.toLowerCase()} amount`}
          aria-activedescendant={`${uid}-${center}`}
          onScroll={onScroll}
          onTouchStart={grab}
          onTouchEnd={release}
          onTouchCancel={release}
          onWheel={() => { s.current.touched = true; }}
          onKeyDown={onKeyDown}
        >
          <div className="bw-pad" aria-hidden="true" />
          {rows.map((r, i) => (
            <div
              key={r.asIs ? "as-is" : r.cents}
              id={`${uid}-${i}`}
              role="option"
              aria-selected={i === center}
              className={`bw-item${i === center ? " on" : ""}${r.asIs ? " bw-asis" : ""}`}
              onClick={() => jump(i)}
            >{r.label}</div>
          ))}
          <div className="bw-pad" aria-hidden="true" />
        </div>
      </div>
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
