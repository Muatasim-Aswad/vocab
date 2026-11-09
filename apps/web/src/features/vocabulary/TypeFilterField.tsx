import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { fieldStack } from "../../shared/ui.ts";
import { isBuiltIn, typeFilters } from "./typeFilters.ts";

const customDelayMs = 250;

/** A built-in type, or a tag typed in, which applies after a short pause. */
export function TypeFilterField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const custom = value && !isBuiltIn(value) ? value : "";
  const [customText, setCustomText] = useState(custom);
  const [customMode, setCustomMode] = useState(custom !== "");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function apply(next: string) {
    window.clearTimeout(timer.current);
    onChange(next);
  }

  return (
    <>
      <div className={fieldStack}>
        <select
          aria-label={t("vocab.search.type")}
          value={customMode ? "custom" : value}
          onChange={(event) => {
            const next = event.target.value;
            setCustomMode(next === "custom");
            apply(next === "custom" ? customText.trim() : next);
          }}
        >
          <option value="">{t("vocab.filter.any")}</option>
          {typeFilters.map((filter) => (
            <option key={filter} value={filter}>
              {t(`vocab.filter.${filter}`)}
            </option>
          ))}
          <option value="custom">{t("vocab.filter.custom")}</option>
        </select>
      </div>
      {customMode ? (
        <div className={fieldStack}>
          <label htmlFor={`${id}-custom`}>{t("vocab.search.customType")}</label>
          <input
            id={`${id}-custom`}
            value={customText}
            autoCapitalize="none"
            onChange={(event) => {
              const next = event.target.value;
              setCustomText(next);
              window.clearTimeout(timer.current);
              timer.current = window.setTimeout(() => onChange(next.trim()), customDelayMs);
            }}
          />
        </div>
      ) : null}
    </>
  );
}
