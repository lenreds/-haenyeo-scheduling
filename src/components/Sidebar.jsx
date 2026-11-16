// Left sidebar navigation (redesign round, 2026-11-16). Presentation only:
// the tab itself is App's `tab` state, switched through the same setTab the
// old tab bar called, so nothing about routing or screens changes here.
//
// Expanded: logo + wordmark, one row per tab (icon, label, pending badge on
// Rail), and at the bottom the Light/Dark switch and the signed-in manager.
// Collapsed: an icon-only rail — labels hide, the badge becomes a dot, the
// theme switch becomes one button that flips to the other theme.
// Below ~900px the stylesheet lays the same markup out as a top bar.
import React from "react";
import {
  Inbox, CalendarDays, Receipt, Table2, Users, FileText, UtensilsCrossed,
  PanelLeft, Sun, Moon, LogOut,
} from "lucide-react";

// Same tabs, same order, same keys as the old tab bar.
export const NAV_ITEMS = [
  { key: "rail", label: "Rail", Icon: Inbox },
  { key: "calendar", label: "Calendar", Icon: CalendarDays },
  { key: "tips", label: "Tip Sheet", Icon: Receipt },
  { key: "template", label: "Set Schedule", Icon: Table2 },
  { key: "staff", label: "Staff", Icon: Users },
  { key: "invoices", label: "Invoices", Icon: FileText },
  { key: "menu", label: "Menu", Icon: UtensilsCrossed },
];

export default function Sidebar({
  tab, onTab, pendingCount = 0,
  collapsed, onToggleCollapsed,
  theme, onTheme,
  icon, email, onSignOut,
}) {
  const otherTheme = theme === "light" ? "dark" : "light";
  return (
    <aside className={`sidebar ${collapsed ? "sidebar-collapsed" : ""}`} aria-label="Main navigation">
      <div className="sb-brand">
        <img src={icon} alt="Haenyeo" className="sb-logo" />
        <span className="sb-word">HAENYEO</span>
        <button
          type="button"
          className="sb-collapse"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <PanelLeft size={18} />
        </button>
      </div>

      <nav className="sb-nav">
        {NAV_ITEMS.map(({ key, label, Icon }) => {
          const active = tab === key;
          const badge = key === "rail" ? pendingCount : 0;
          return (
            <button
              type="button"
              key={key}
              className={`sb-item ${active ? "sb-item-active" : ""}`}
              onClick={() => onTab(key)}
              aria-current={active ? "page" : undefined}
              title={badge > 0 ? `${label} — ${badge} pending` : label}
            >
              <span className="sb-icon">
                <Icon size={18} />
                {badge > 0 && <span className="sb-dot" aria-hidden="true" />}
              </span>
              <span className="sb-label">{label}</span>
              {badge > 0 && <span className="sb-badge" aria-label={`${badge} pending`}>{badge}</span>}
            </button>
          );
        })}
      </nav>

      <div className="sb-foot">
        {collapsed ? (
          <button
            type="button"
            className="sb-theme-one"
            onClick={() => onTheme(otherTheme)}
            title={`Switch to ${otherTheme} mode`}
            aria-label={`Switch to ${otherTheme} mode`}
          >
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
          </button>
        ) : (
          <div className="sb-theme" role="group" aria-label="Light or dark mode">
            <button
              type="button"
              className={`sb-theme-btn ${theme === "light" ? "on" : ""}`}
              onClick={() => onTheme("light")}
              aria-pressed={theme === "light"}
              title="Light mode"
            >
              <Sun size={15} /><span className="sb-label">Light</span>
            </button>
            <button
              type="button"
              className={`sb-theme-btn ${theme !== "light" ? "on" : ""}`}
              onClick={() => onTheme("dark")}
              aria-pressed={theme !== "light"}
              title="Dark mode"
            >
              <Moon size={15} /><span className="sb-label">Dark</span>
            </button>
          </div>
        )}
        {email && (
          <div className="sb-user" title={`Signed in as ${email}`}>
            <span className="sb-user-name">{email}</span>
            <button type="button" className="sb-signout" onClick={onSignOut} title="Sign out" aria-label="Sign out">
              <LogOut size={14} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
