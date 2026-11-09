import type { ComponentProps } from "react";

import { cn } from "./ui.ts";

/** A message set apart by a rule at its start; an error's first line is bold. */
export function Notice({
  tone,
  className,
  ...props
}: ComponentProps<"div"> & { tone?: "error" | "success" }) {
  return (
    <div
      className={cn(
        "grid gap-3 rounded-r-md border-l-4 border-boundary bg-surface px-4 py-3",
        tone === "error" && "border-error [&>p:first-child]:font-semibold",
        tone === "success" && "border-success",
        className,
      )}
      {...props}
    />
  );
}
