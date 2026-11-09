import { useTranslation } from "react-i18next";

import { SuggestIcon } from "../../shared/icons.tsx";
import { button, cn } from "../../shared/ui.ts";

/** Asks AI for suggestions; the one button with both an icon and text. `term` names its word in a list. */
export function AiButton({
  term,
  disabled,
  onClick,
}: {
  term?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const label = t("vocab.ai.suggest");
  return (
    <button
      type="button"
      className={cn(button.secondary, "gap-2 [&_svg]:size-5")}
      aria-label={term ? `${label} ${term}` : label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <SuggestIcon />
      {t("vocab.ai.short")}
    </button>
  );
}
