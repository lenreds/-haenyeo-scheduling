// Tip Sheet tap panels: TIME IN / TIME OUT and the cash rows. Screen only.
//
// The panel is rendered at the top level of the hub (like the app's modals),
// never inside the sheet card, and fixed-positioned from the tapped cell's
// rect. So no ancestor's overflow can clip it, nothing under it moves, and the
// PDF capture (the card) and @media print (.screen-only) never see it.
// Choices live in lib/tipPickers.js, which is tested against what the sheet pays.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatTime, parsePickerTime } from "../lib/tipTimes.js";
import {
  cashCheck, cashChips, cashPageFor, paidMinute, parseCents, centsToStored,
  scheduleDelta, timeChips, timeLadderCenter,
} from "../lib/tipPickers.js";

const GAP = 6;
const EDGE = 8;

// Desktop (a mouse) gets the type field focused straight away; a touch screen
// doesn't, so the iPad keyboard only comes up when the field is tapped.
const finePointer = () => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: fine)").matches;

export function PickerPanel({ anchor, onClose, label, children }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    function place() {
      const el = ref.current;
      if (!el || !anchor?.isConnected) return;
      const r = anchor.getBoundingClientRect();
      const vv = window.visualViewport;
      const vw = vv ? vv.width + vv.offsetLeft : window.innerWidth;
      const vh = vv ? vv.height + vv.offsetTop : window.innerHeight;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const left = Math.max(EDGE, Math.min(r.left + r.width / 2 - w / 2, vw - w - EDGE));
      let top = r.bottom + GAP;
      if (top + h > vh - EDGE && r.top - h - GAP >= EDGE) top = r.top - h - GAP; // no room below: open above
      setPos({ left, top });
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
  }, [anchor]);

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

  return (
    <div
      ref={ref}
      className="tip-picker screen-only"
      role="dialog"
      aria-label={label}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
    >
      {children}
    </div>
  );
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

export function CashPickerBody({ denom, denomLabel, columnLabel, value, onSet }) {
  const [page, setPage] = useState(() => cashPageFor(denom, value));
  const [typed, setTyped] = useState("");
  const current = parseCents(value);
  // Says so, never blocks or corrects: what's being typed, else what's stored.
  const check = cashCheck(denom, typed.trim() ? typed : value, denomLabel);

  // A non-multiple is set as typed (only named above); text that isn't an
  // amount at all can't be set — the old number cell never allowed it either.
  const typedCents = parseCents(typed);
  function applyTyped() {
    if (typedCents != null) onSet(centsToStored(typedCents));
  }

  return (
    <>
      <div className="tp-head">
        <span className="tp-title">{denomLabel} · {columnLabel}</span>
        {value !== "" && value != null && <span className="tp-delta">now ${current != null ? (current / 100).toFixed(2) : value}</span>}
      </div>
      <Arrows what="amounts" prevDisabled={page === 0} onPrev={() => setPage((p) => Math.max(0, p - 1))} onNext={() => setPage((p) => p + 1)}>
        {cashChips(denom, page).map((c) => (
          <button
            key={c.cents}
            type="button"
            className={`tp-chip${c.cents === current ? " on" : ""}`}
            aria-pressed={c.cents === current}
            onClick={() => onSet(c.value)}
          >{c.label}</button>
        ))}
      </Arrows>
      <div className="tp-row tp-type">
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          autoFocus={finePointer()}
          placeholder="Type an amount, e.g. 420"
          aria-label={`Type the ${denomLabel} ${columnLabel.toLowerCase()} amount`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") applyTyped(); }}
        />
        <button type="button" className="tp-btn tp-btn-main" disabled={typedCents == null} onClick={applyTyped}>Set</button>
      </div>
      {check && <div className="tp-note tp-warn" role="status">{check.message}</div>}
      <div className="tp-row tp-foot">
        <button type="button" className="tp-btn tp-btn-quiet" disabled={!value} onClick={() => onSet("")}>Clear</button>
      </div>
    </>
  );
}
