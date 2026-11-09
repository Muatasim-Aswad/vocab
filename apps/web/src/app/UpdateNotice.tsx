import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { buildLabel, updateNotice } from "../infra/build-info.ts";
import { toastBox, toastRegion } from "../shared/toast-context.ts";
import { cn } from "../shared/ui.ts";

const shownMs = 5000;

/** Once per new build on this device: a toast that leaves by itself; pressing it opens Version. */
export function UpdateNotice() {
  const { t } = useTranslation();
  const [build, setBuild] = useState(updateNotice);

  useEffect(() => {
    const timer = build ? window.setTimeout(() => setBuild(null), shownMs) : undefined;
    return () => window.clearTimeout(timer);
  }, [build]);

  return (
    <div className={toastRegion} aria-live="polite" aria-atomic="true">
      {build ? (
        <Link
          to="/version"
          className={cn(toastBox, "text-fg no-underline")}
          onClick={() => setBuild(null)}
        >
          <span className="font-semibold">{t("app.updated", { label: buildLabel(build) })}</span>
        </Link>
      ) : null}
    </div>
  );
}
