import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Outlet, ScrollRestoration, useLocation } from "react-router-dom";

import { LoginPanel, useSession } from "../features/session/index.ts";
import {
  applyTheme,
  initialTheme,
  locales,
  saveLocale,
  saveTheme,
  themes,
} from "../infra/preferences.ts";
import { AddIcon, Logo, MoreIcon, SearchIcon } from "../shared/icons.tsx";
import { Notice } from "../shared/Notice.tsx";
import { finePointer } from "../shared/pointer.ts";
import { button, cn, control, iconButton, pageSections, supporting } from "../shared/ui.ts";
import { usePageTitle } from "../shared/usePageTitle.ts";
import { UpdateNotice } from "./UpdateNotice.tsx";

/**
 * Route changes focus the page's primary field on pointer devices, else its heading, so
 * touch keyboards stay closed. The first load only focuses a primary field.
 */
function useRouteFocus(ready: boolean) {
  const { pathname } = useLocation();
  const firstRoute = useRef<string | null>(null);
  useEffect(() => {
    const main = document.getElementById("main");
    if (!ready || !main || main.hidden) return;
    const field = finePointer() ? main.querySelector<HTMLElement>("[data-route-focus]") : null;
    const initial = firstRoute.current === null;
    firstRoute.current = pathname;
    const target = field ?? (initial ? null : main.querySelector<HTMLElement>("h1"));
    target?.focus({ preventScroll: true });
  }, [pathname, ready]);
}

/** One centered column, contents left-aligned. */
const column = "mx-auto max-w-3xl px-gutter";

/** Room for the fixed footer below the last content; long Dutch compounds wrap instead of widening grids. */
const mainColumn = cn(column, "pt-6 pb-28 wrap-anywhere");

const menuRow =
  "flex min-h-11 w-full items-center justify-between gap-4 rounded-md px-3 py-1 text-start font-medium text-fg no-underline hover:bg-canvas";
const menuButton = cn(control, menuRow);

/** Search offers Add; every other page offers Search. */
function SwitchLink() {
  const { t } = useTranslation();
  const onSearch = useLocation().pathname === "/";
  return (
    <Link
      to={onSearch ? "/add" : "/"}
      className={iconButton}
      aria-label={onSearch ? t("app.add") : t("app.search")}
    >
      {onSearch ? <AddIcon /> : <SearchIcon />}
    </Link>
  );
}

/** Opens upward from the footer; Escape or a press outside closes it. Settings rows cycle their value. */
function FooterMenu({ canSignOut }: { canSignOut: boolean }) {
  const { t, i18n } = useTranslation();
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState(initialTheme);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const listeners = new AbortController();
    if (open) {
      const { signal } = listeners;
      document.addEventListener(
        "pointerdown",
        (event) => {
          if (!(event.target instanceof Node && root.current?.contains(event.target)))
            setOpen(false);
        },
        { signal },
      );
      document.addEventListener(
        "keydown",
        (event) => {
          if (event.key !== "Escape") return;
          setOpen(false);
          toggle.current?.focus();
        },
        { signal },
      );
    }
    return () => listeners.abort();
  }, [open]);

  function cycleTheme() {
    const next = themes[(themes.indexOf(theme) + 1) % themes.length]!;
    setTheme(next);
    saveTheme(next);
    applyTheme(next);
  }

  function cycleLocale() {
    const current = locales.findIndex((locale) => locale === i18n.language);
    const next = locales[(current + 1) % locales.length]!;
    saveLocale(next);
    void i18n.changeLanguage(next);
  }

  return (
    <div className="relative" ref={root}>
      <button
        ref={toggle}
        type="button"
        className={iconButton}
        aria-label={t("app.menu")}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <MoreIcon />
      </button>
      <div
        id={panelId}
        className="absolute bottom-[calc(100%+--spacing(2))] left-0 grid min-w-64 rounded-md border border-boundary bg-surface p-2 shadow-menu"
        hidden={!open}
      >
        {canSignOut ? (
          <Link to="/captures" className={menuRow} onClick={() => setOpen(false)}>
            {t("app.captures")}
          </Link>
        ) : null}
        <button type="button" className={menuButton} onClick={cycleTheme}>
          <span>{t("app.theme")}</span>
          <span className="text-supporting">{t(`themes.${theme}`)}</span>
        </button>
        <button type="button" className={menuButton} onClick={cycleLocale}>
          <span>{t("app.language")}</span>
          <span className="text-supporting">{t(`languages.${i18n.language}`)}</span>
        </button>
        <Link to="/version" className={menuRow} onClick={() => setOpen(false)}>
          {t("app.version")}
        </Link>
        {canSignOut ? (
          <button
            type="button"
            className={menuButton}
            onClick={() => {
              setOpen(false);
              void session.logout();
            }}
          >
            {t("session.signOut")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function Shell() {
  const { t, i18n } = useTranslation();
  const session = useSession();
  useRouteFocus(session.everAuthenticated);

  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  const signedIn = session.everAuthenticated;
  const expired = signedIn && session.state === "required";

  return (
    <>
      <a
        href="#main"
        className="absolute -top-16 left-4 z-10 rounded-md bg-surface px-4 py-2 text-action focus:top-2"
      >
        {t("app.skip")}
      </a>
      {expired ? (
        <div className={cn(column, "pt-6")}>
          <LoginPanel expired />
        </div>
      ) : null}

      {signedIn ? (
        // Kept mounted while access is required, so results, drafts and pending saves survive.
        <main id="main" className={mainColumn} hidden={expired}>
          <Outlet />
        </main>
      ) : (
        <main id="main" className={mainColumn}>
          <Gate />
        </main>
      )}

      {/* Fixed, fading the page out beneath it; only the bar takes clicks, so the band above lets them through. */}
      <footer className="pointer-events-none fixed inset-x-0 bottom-0 z-5 bg-linear-to-b/srgb from-transparent to-canvas to-60% pt-8 pb-[max(--spacing(3),env(safe-area-inset-bottom))]">
        <div className={cn(column, "pointer-events-auto flex items-center gap-2")}>
          {signedIn && !expired ? <SwitchLink /> : null}
          <FooterMenu canSignOut={signedIn && !expired} />
          <Logo />
        </div>
      </footer>
      <UpdateNotice />
      <ScrollRestoration />
    </>
  );
}

function Gate() {
  const { t } = useTranslation();
  const session = useSession();
  usePageTitle("");
  if (session.state === "required") return <LoginPanel expired={false} />;
  if (session.state === "unreachable")
    return (
      <Notice tone="error" role="alert">
        <p>{t("app.unreachable")}</p>
        <button type="button" className={button.secondary} onClick={session.recheck}>
          {t("common.retry")}
        </button>
      </Notice>
    );
  return (
    <p role="status" className={supporting}>
      {t("app.checking")}
    </p>
  );
}

export function NotFoundPage() {
  const { t } = useTranslation();
  usePageTitle(t("app.notFoundTitle"));
  return (
    <div className={pageSections}>
      <h1 tabIndex={-1}>{t("app.notFoundTitle")}</h1>
      <p>{t("app.notFound")}</p>
      <Link to="/">{t("app.toSearch")}</Link>
    </div>
  );
}
