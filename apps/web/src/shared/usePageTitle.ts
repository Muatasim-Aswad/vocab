import { useEffect } from "react";

/** Keeps the document title in step with the page and interface language. */
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} – Vocab` : "Vocab";
  }, [title]);
}
