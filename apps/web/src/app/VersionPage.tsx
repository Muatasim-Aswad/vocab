import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import {
  buildLabel,
  fetchDeployedBuild,
  reloadToLatest,
  runningBuild,
  shortRevision,
  type BuildInfo,
} from "../infra/build-info.ts";
import { formatDateTime } from "../shared/format.ts";
import { BackIcon } from "../shared/icons.tsx";
import { Notice } from "../shared/Notice.tsx";
import { backButton, button, factRow, pageBar, pageSections, supporting } from "../shared/ui.ts";
import { usePageTitle } from "../shared/usePageTitle.ts";

type Deployed = { state: "checking" } | { state: "unknown" } | { state: "known"; build: BuildInfo };

/** The running build, and a reload when the server has another one. Reached from the footer menu. */
export function VersionPage() {
  const { t, i18n } = useTranslation();
  usePageTitle(t("version.title"));
  const [deployed, setDeployed] = useState<Deployed>({ state: "checking" });

  useEffect(() => {
    let current = true;
    void fetchDeployedBuild().then((build) => {
      if (current) setDeployed(build ? { state: "known", build } : { state: "unknown" });
    });
    return () => {
      current = false;
    };
  }, []);

  const time = (iso: string | null) => {
    const moment = iso ? new Date(iso) : null;
    if (!moment || Number.isNaN(moment.getTime())) return iso ?? "—";
    return formatDateTime(moment, i18n.language, { dateStyle: "medium", timeStyle: "short" });
  };
  const update =
    deployed.state === "known" && deployed.build.revision !== runningBuild.revision
      ? deployed.build
      : null;

  return (
    <div className={pageSections}>
      <div className={pageBar}>
        <Link
          to="/"
          className={backButton}
          aria-label={t("version.back")}
          title={t("version.back")}
        >
          <BackIcon />
        </Link>
      </div>
      <h1 tabIndex={-1}>{t("version.title")}</h1>
      <dl className="grid gap-2">
        {runningBuild.version === null ? null : (
          <Fact label={t("version.app")} value={runningBuild.version} />
        )}
        <Fact label={t("version.released")} value={time(runningBuild.committedAt)} />
        <Fact label={t("version.built")} value={time(runningBuild.builtAt)} />
        <Fact label={t("version.revision")} value={shortRevision(runningBuild.revision)} />
      </dl>
      {update ? (
        <Notice role="status">
          <p>{t("version.available", { label: buildLabel(update) })}</p>
          <button type="button" className={button.secondary} onClick={() => void reloadToLatest()}>
            {t("version.reload")}
          </button>
        </Notice>
      ) : (
        <p role="status" className={supporting}>
          {deployed.state === "checking"
            ? t("version.checking")
            : deployed.state === "unknown"
              ? t("version.unknown")
              : t("version.current")}
        </p>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className={factRow}>
      <dt className="text-supporting">{label}</dt>
      <dd className="wrap-anywhere tabular-nums">{value}</dd>
    </div>
  );
}
