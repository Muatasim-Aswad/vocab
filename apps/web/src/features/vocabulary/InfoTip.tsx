import { useState } from "react";
import { useTranslation } from "react-i18next";

import { InfoIcon } from "../../shared/icons.tsx";
import { cn, control } from "../../shared/ui.ts";

/**
 * An explanation behind an info icon: a tooltip on hover, and shown below on tap until tapped
 * again. Fields name `id` in `aria-describedby`, so screen readers hear it while it is hidden.
 */
export function InfoTip({ id, text }: { id: string; text: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={cn(
          control,
          "size-8 min-h-0 rounded-full p-0 align-middle text-supporting hover:text-action aria-expanded:text-action [&_svg]:size-4.5",
        )}
        aria-label={t("common.moreInfo")}
        aria-expanded={open}
        aria-controls={id}
        title={text}
        onClick={() => setOpen(!open)}
      >
        <InfoIcon />
      </button>
      {/* Takes its own row after the row's other controls. */}
      <span
        id={id}
        className="order-1 my-1 block max-w-help basis-full text-sm font-normal text-supporting"
        hidden={!open}
      >
        {text}
      </span>
    </>
  );
}
