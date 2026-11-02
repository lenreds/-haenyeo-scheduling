// Tip Sheet shortcut on the Rail — TRIAL (owner, 2026-11-02).
//
// Not a second copy of anything. Every value shown here is the Tip Sheet's own
// state, passed down from App, and every edit calls the Tip Sheet's own setter:
// one sheet in memory, saved by the Tip Sheet's autosave through the same
// field-by-field save (lib/tipSave.js, migration 0030) and refused by the same
// database guard (0029). The time and cash cells open the Tip Sheet's own tap
// panels, so the frozen parser and quarter-hour rounding are the same code.
//
// Rule for what belongs here: data capture on the Rail, pay decisions on the
// Tip Sheet. So no Expo-as-busser, bar tip-out, Custom Schedule, Lock or Send.
// Adding / removing people stays on the Tip Sheet for the trial.
//
// Stricter than the Tip Sheet: a SENT sheet is read-only here even when it has
// been unlocked — correcting a sheet that went out happens on the Tip Sheet.
//
// Warnings, never blocks: a missing TIME OUT mid-service is normal. The block
// that matters is Lock / Send on the Tip Sheet.
//
// Wrapped in PanelBoundary: if anything in here throws while drawing, only this
// panel is replaced by a notice — the Rail and the Tip Sheet carry on.
import React from "react";

export class PanelBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err) {
    console.error("Rail tip panel failed — the Tip Sheet is unaffected:", err);
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="rtp rtp-failed" role="alert">
          The tip sheet shortcut hit a problem and closed. Nothing was lost — use the Tip Sheet tab for tonight.
        </div>
      );
    }
    return this.props.children;
  }
}

export default function RailTipPanel(p) {
  const {
    open, onToggle, dateLabel, readOnly, readOnlyWhy, saveLabel, conflictMsg, onDismissConflict,
    slots, getTimes, onTimeTap, denoms, denomLabel, openingCounts, closingCounts, onCashTap,
    openingTotal, closingTotal, money,
    fields, payouts, onAddPayout, onPayout, onRemovePayout,
    warnings, onOpenTipSheet,
  } = p;
  // Dev-only switch for testing PanelBoundary (import.meta.env.DEV is
  // compile-time false in production builds, so this is gone there).
  if (import.meta.env.DEV && typeof window !== "undefined" && window.__railTipPanelFail) throw new Error("test failure");
  const people = slots.filter((s) => s.name);
  const clockedOut = people.filter((s) => getTimes(s.id).out).length;

  if (!open) {
    return (
      <button type="button" className="rtp-bar" onClick={onToggle} aria-expanded="false">
        <span className="rtp-bar-title">Tip sheet — {dateLabel}</span>
        <span className="rtp-bar-sub">
          {!p.summaryKnown ? "Tap to open" : readOnly ? readOnlyWhy : `${clockedOut} of ${people.length} clocked out · ${saveLabel}`}
        </span>
        <span className="rtp-bar-open">Open</span>
      </button>
    );
  }

  const key = (e, fn) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(e); } };
  return (
    <section className="rtp" aria-label={`Tip sheet entry for ${dateLabel}`}>
      <div className="rtp-head">
        <div>
          <div className="rtp-title">Tip sheet — {dateLabel}</div>
          <div className="rtp-sub">Trial · same sheet as the Tip Sheet tab · {saveLabel}</div>
        </div>
        <button type="button" className="rtp-btn" onClick={onToggle}>Close</button>
      </div>

      {readOnly && <div className="rtp-ro">{readOnlyWhy} — read-only here. Open the Tip Sheet to see or correct it.</div>}
      {conflictMsg && (
        <div className="rtp-warn" role="alert">
          {conflictMsg}
          <button type="button" className="rtp-btn rtp-btn-small" onClick={onDismissConflict}>OK</button>
        </div>
      )}

      <div className="rtp-section">Clock in / out</div>
      {people.length === 0 && <div className="rtp-empty">Nobody is on the sheet for this date.</div>}
      <div className="rtp-times">
        {people.map((s) => {
          const t = getTimes(s.id);
          return (
            <div className="rtp-person" key={s.id}>
              <div className="rtp-name">{s.name}<span className="rtp-pos">{s.label}</span></div>
              {["in", "out"].map((f) => (
                <div
                  key={f}
                  role="button"
                  tabIndex={readOnly ? -1 : 0}
                  aria-disabled={readOnly}
                  className={`rtp-cell ${t[f] ? "" : "rtp-cell-empty"}`}
                  onClick={(e) => !readOnly && onTimeTap(e, s, f)}
                  onKeyDown={(e) => !readOnly && key(e, (ev) => onTimeTap(ev, s, f))}
                >
                  <span className="rtp-cell-label">{f === "in" ? "In" : "Out"}</span>
                  <span className="rtp-cell-val">{t[f] || "—"}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="rtp-section">Tips, sales & covers</div>
      <div className="rtp-fields">
        {fields.map((f) => (
          <label className="rtp-field" key={f.label}>
            <span>{f.label}</span>
            <input
              type="number"
              inputMode="decimal"
              value={f.value}
              placeholder={f.placeholder || "0.00"}
              disabled={readOnly || f.disabled}
              onChange={(e) => f.onChange(e.target.value)}
            />
            {f.note && <em className="rtp-note">{f.note}</em>}
          </label>
        ))}
      </div>

      <div className="rtp-section">
        Payouts
        {!readOnly && <button type="button" className="rtp-btn rtp-btn-small" onClick={onAddPayout}>+ Add</button>}
      </div>
      {payouts.length === 0 && <div className="rtp-empty">None</div>}
      {payouts.map((it) => (
        <div className="rtp-payout" key={it.id}>
          <input type="text" placeholder="What was it" value={it.desc} disabled={readOnly} onChange={(e) => onPayout(it.id, "desc", e.target.value)} />
          <input type="number" inputMode="decimal" placeholder="0.00" value={it.amount} disabled={readOnly} onChange={(e) => onPayout(it.id, "amount", e.target.value)} />
          {!readOnly && <button type="button" className="rtp-btn rtp-btn-small" aria-label="Remove payout" onClick={() => onRemovePayout(it.id)}>×</button>}
        </div>
      ))}

      <div className="rtp-section">Opening bank / closing count <span className="rtp-hint">dollar amounts, not bill counts</span></div>
      <div className="rtp-cash">
        <div className="rtp-cash-row rtp-cash-head"><span /> <span>Opening</span><span>Closing</span></div>
        {denoms.map((d) => (
          <div className="rtp-cash-row" key={d}>
            <span className="rtp-denom">{denomLabel(d)}</span>
            {["open", "close"].map((which) => {
              const v = (which === "open" ? openingCounts : closingCounts)[d];
              return (
                <div
                  key={which}
                  role="button"
                  tabIndex={readOnly ? -1 : 0}
                  aria-disabled={readOnly}
                  className={`rtp-cell ${v ? "" : "rtp-cell-empty"}`}
                  onClick={(e) => !readOnly && onCashTap(e, which, d)}
                  onKeyDown={(e) => !readOnly && key(e, (ev) => onCashTap(ev, which, d))}
                >
                  <span className="rtp-cell-val">{v ? `$${v}` : "—"}</span>
                </div>
              );
            })}
          </div>
        ))}
        <div className="rtp-cash-row rtp-cash-total"><span>Total</span><span>${money(openingTotal)}</span><span>${money(closingTotal)}</span></div>
      </div>

      {warnings.length > 0 && (
        <>
          <div className="rtp-section">Not finished yet</div>
          <div className="rtp-warnlist">
            {warnings.map((w) => <div key={w.slotId}>{w.message}</div>)}
          </div>
        </>
      )}

      <button type="button" className="rtp-btn rtp-open-sheet" onClick={onOpenTipSheet}>Open the full Tip Sheet</button>
    </section>
  );
}
