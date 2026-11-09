import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { partOfSpeechLabel } from "./display-model.ts";
import type { Draft, PreviousField } from "./draft.ts";
import { useDraft } from "./vocabulary-context.ts";

function shown(t: TFunction, field: PreviousField, previous: Draft["previous"]): string {
  switch (field) {
    case "partOfSpeech":
      return partOfSpeechLabel(t, previous.partOfSpeech) ?? "";
    case "isCountable":
      return previous.isCountable === "yes"
        ? t("vocab.grammar.countable")
        : t("vocab.grammar.uncountable");
    case "number":
      return t(`vocab.grammar.numberValue.${previous.number}`);
    case "constructionType":
      return t(`vocab.construction.${previous.constructionType}`);
    case "forms":
      return previous.forms?.join(", ") ?? "";
    default:
      return previous[field] ?? "";
  }
}

/** What the edited entry held in this field before an AI suggestion replaced it, on its own row. */
export function PreviousNote({ field, id }: { field: PreviousField; id?: string }) {
  const { t } = useTranslation();
  const previous = useDraft((state) => state.draft.previous);
  if (previous[field] === undefined) return null;
  return (
    <p id={id} className="order-2 basis-full text-sm font-semibold text-supporting">
      {t("vocab.add.previous", { value: shown(t, field, previous) })}
    </p>
  );
}
