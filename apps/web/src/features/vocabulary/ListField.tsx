import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { AddIcon, RemoveIcon } from "../../shared/icons.tsx";
import {
  addRowButton,
  cn,
  fieldIconButton,
  listField,
  listLegend,
  removeButton,
} from "../../shared/ui.ts";
import { InfoTip } from "./InfoTip.tsx";

/** One value per row; an Add icon beside the label appears once every row is filled, and each filled row has a Remove icon. */
export function ListField({
  id,
  label,
  help,
  itemLabel,
  addLabel,
  values,
  onChange,
  lang,
}: {
  id: string;
  label: string;
  help?: string;
  /** Accessible name of one row, given its 1-based position. */
  itemLabel: (position: number) => string;
  addLabel: string;
  values: string[];
  onChange: (values: string[]) => void;
  lang?: string;
}) {
  const { t } = useTranslation();
  const rows = useRef<(HTMLInputElement | null)[]>([]);
  // Rows render after the store update; focus the added or preceding row on the next frame.
  const focusRow = (index: number) =>
    requestAnimationFrame(() => rows.current[Math.max(0, index)]?.focus());

  return (
    <fieldset className={listField} id={id} tabIndex={-1} aria-labelledby={`${id}-label`}>
      <legend className={listLegend}>
        <span id={`${id}-label`}>{label}</span>
        {help ? <InfoTip id={`${id}-help`} text={help} /> : null}
        {/* A new row is offered only once every existing row has text. */}
        {values.every((value) => value.trim()) ? (
          <button
            type="button"
            className={addRowButton}
            aria-label={addLabel}
            title={addLabel}
            onClick={() => {
              onChange([...values, ""]);
              focusRow(values.length);
            }}
          >
            <AddIcon />
          </button>
        ) : null}
      </legend>
      {values.length ? (
        <ol className="grid w-full gap-2">
          {values.map((value, index) => (
            <li key={index} className="relative flex items-center gap-3">
              <input
                ref={(element) => {
                  rows.current[index] = element;
                }}
                className="min-w-0 pe-12"
                aria-label={itemLabel(index + 1)}
                aria-describedby={help ? `${id}-help` : undefined}
                data-no-submit=""
                lang={lang}
                value={value}
                onChange={(event) =>
                  onChange(values.map((item, at) => (at === index ? event.target.value : item)))
                }
              />
              {value.trim() ? (
                <button
                  type="button"
                  className={cn(fieldIconButton, removeButton, "[&_svg]:size-4.5")}
                  aria-label={`${t("vocab.add.remove")} ${itemLabel(index + 1)}`}
                  onClick={() => {
                    onChange(values.filter((_, at) => at !== index));
                    focusRow(index - 1);
                  }}
                >
                  <RemoveIcon />
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </fieldset>
  );
}
