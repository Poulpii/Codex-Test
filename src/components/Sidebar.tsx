import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { ViewName } from "../types";

interface SidebarProps {
  view: ViewName;
}

const NAV_ITEMS: Array<{ view: ViewName; href: string; label: string; icon: string }> = [
  { view: "incidents", href: "#gestion-incidents", label: "Gestion d'Incidents", icon: "nav-incidents" },
  { view: "directory", href: "#annuaire", label: "Annuaire", icon: "nav-directory" },
  { view: "contract", href: "#contrat", label: "Contrats", icon: "nav-contracts" }
];

export function Sidebar({ view }: SidebarProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const closeSidebar = () => setOpen(false);

  return (
    <>
      {open ? <button className="sidebar-backdrop" type="button" aria-label="Fermer la navigation" onClick={closeSidebar} /> : null}
      <aside className={`app-side-nav ${open ? "is-open" : ""}`} aria-label="Navigation principale">
        <button className="sidebar-toggle" type="button" aria-expanded={open} aria-label={open ? "Replier la navigation" : "Ouvrir la navigation"} onClick={() => setOpen((current) => !current)}>
          <span className="sidebar-toggle-bars" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </button>
        <div className="side-nav-heading">
          <div className="side-nav-brand">
            <img className="side-nav-logo" src="/assets/svg/Logo-Copropro.svg" alt="" aria-hidden="true" />
            <span>Copropro</span>
          </div>
          <div className="side-nav-access">Accès Conseil Syndical</div>
        </div>
        <nav className="side-nav-links">
          {NAV_ITEMS.map((item) => (
            <a className={view === item.view ? "active" : ""} href={item.href} aria-current={view === item.view ? "page" : undefined} onClick={closeSidebar} key={item.view}>
              <span className="side-nav-link-icon" style={{ "--icon": `url("/assets/svg/${item.icon}.svg")` } as CSSProperties} aria-hidden="true" />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
      </aside>
    </>
  );
}
