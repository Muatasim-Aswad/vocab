import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { AddIcon, RemoveIcon, SuggestIcon } from "../../shared/icons.tsx";
import { cn, iconButton, removeButton, supporting } from "../../shared/ui.ts";
import { InfoTip } from "./InfoTip.tsx";

const chipButton = cn(iconButton, "size-9 [&_svg]:size-4.5");
const chipAction = cn(chipButton, "text-action");

/**
 * Values as chips beside the label, each with a Remove icon. The Add icon after the last chip opens
 * an input that adds a chip on Enter and closes on blur or Escape. Suggested values follow as
 * outlined chips: they are kept unless removed.
 */
export function ChipField({
  id,
  label,
  help,
  addLabel,
  values,
  onChange,
  suggested,
  suggestion,
  lang,
  note,
}: {
  id: string;
  label: string;
  help?: string;
  addLabel: string;
  values: string[];
  onChange: (values: string[]) => void;
  /** The values came from the API rather than the user. */
  suggested?: boolean;
  /** Shown suggestions, and `onShow` while more wait behind the Suggest icon. */
  suggestion?: {
    values: string[];
    onDismiss: (value: string) => void;
    onShow?: () => void;
    showLabel: string;
  };
  lang?: string;
  /** Shown beneath the chips. */
  note?: ReactNode;
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const kept = values.filter((value) => value.trim());

  useEffect(() => {
    if (adding) input.current?.focus();
  }, [adding]);

  const commit = () => {
    const value = text.trim();
    if (value && !kept.includes(value)) onChange([...kept, value]);
    setText("");
  };
  const close = () => {
    setAdding(false);
    requestAnimationFrame(() => addButton.current?.focus());
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setText("");
      close();
    }
  };

  const chip = (value: string, onRemove: () => void, isSuggested = false) => (
    <li
      key={value}
      className={cn(
        "inline-flex max-w-full items-center rounded-full border border-transparent bg-surface ps-3 wrap-anywhere",
        isSuggested && "border-dashed border-control bg-transparent",
      )}
    >
      <span lang={lang}>{value}</span>
      {isSuggested ? <span className="sr-only"> {t("vocab.add.suggested")}</span> : null}
      <button
        type="button"
        className={cn(chipButton, removeButton)}
        aria-label={`${t("vocab.add.remove")} ${value}`}
        title={t("vocab.add.remove")}
        onClick={onRemove}
      >
        <RemoveIcon />
      </button>
    </li>
  );

  return (
    <div
      role="group"
      className="flex flex-wrap items-center gap-x-3 gap-y-1"
      id={id}
      tabIndex={-1}
      aria-labelledby={`${id}-label`}
    >
      <span className="font-semibold" id={`${id}-label`}>
        {label}
        {suggested ? <span className={supporting}> {t("vocab.add.suggested")}</span> : null}
      </span>
      {help ? <InfoTip id={`${id}-help`} text={help} /> : null}
      <ul className="flex min-w-0 flex-auto flex-wrap items-center gap-2">
        {kept.map((value) => chip(value, () => onChange(kept.filter((item) => item !== value))))}
        {suggestion?.values.map((value) => chip(value, () => suggestion.onDismiss(value), true))}
        <li className={cn("inline-flex items-center", adding && "flex-[1_1_12rem]")}>
          {suggestion?.onShow ? (
            <button
              type="button"
              className={chipAction}
              aria-label={suggestion.showLabel}
              title={suggestion.showLabel}
              onClick={suggestion.onShow}
            >
              <SuggestIcon />
            </button>
          ) : null}
          {adding ? (
            <input
              ref={input}
              id={`${id}-new`}
              aria-label={addLabel}
              aria-describedby={help ? `${id}-help` : undefined}
              placeholder={`${addLabel}…`}
              data-no-submit=""
              lang={lang}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDown}
              onBlur={() => {
                commit();
                setAdding(false);
              }}
            />
          ) : (
            <button
              ref={addButton}
              type="button"
              className={chipAction}
              aria-label={addLabel}
              title={addLabel}
              onClick={() => setAdding(true)}
            >
              <AddIcon />
            </button>
          )}
        </li>
      </ul>
      {note}
    </div>
  );
}
