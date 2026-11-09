import type { ReactNode } from "react";

import { termPrefix as termPrefixStyle } from "../../shared/ui.ts";
import { termPrefix, type Headword } from "./display-model.ts";

/**
 * Canonical display: small article or `zich` before the lemma; phrases stay as stored.
 * A separable verb's particle is marked by a CSS-drawn bar, so copying and the accessible name
 * still yield the lemma.
 */
export function Term({ entry, separablePart }: { entry: Headword; separablePart?: string }) {
  const prefix = termPrefix(entry);
  return (
    <>
      {prefix ? (
        <>
          <span className={termPrefixStyle}>{prefix}</span>{" "}
        </>
      ) : null}
      {separablePart && entry.lemma.toLowerCase().startsWith(separablePart.toLowerCase()) ? (
        <>
          {entry.lemma.slice(0, separablePart.length)}
          <span className="before:mx-[0.03em] before:font-normal before:text-supporting before:content-['|'_/_'']" />
          {entry.lemma.slice(separablePart.length)}
        </>
      ) : (
        entry.lemma
      )}
    </>
  );
}

/** Marks visible query matches with text nodes only; `*` is the search wildcard. */
export function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  const needle = query.replaceAll("*", "").trim().toLocaleLowerCase();
  if (!needle) return text;
  const haystack = text.toLocaleLowerCase();
  const parts: ReactNode[] = [];
  let start = 0;
  for (let index = haystack.indexOf(needle); index !== -1;) {
    if (index > start) parts.push(text.slice(start, index));
    parts.push(<mark key={index}>{text.slice(index, index + needle.length)}</mark>);
    start = index + needle.length;
    index = haystack.indexOf(needle, start);
  }
  if (start === 0) return text;
  if (start < text.length) parts.push(text.slice(start));
  return parts;
}
