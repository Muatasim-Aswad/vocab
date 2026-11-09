import { createContext, use } from "react";

export type ShowToast = (message: string, detail?: string) => void;
export const ToastContext = createContext<ShowToast | null>(null);

/** Over the top of the page, clear of the bottom bars. */
export const toastRegion =
  "pointer-events-none fixed inset-x-0 top-[max(--spacing(3),env(safe-area-inset-top))] z-20 flex justify-center px-gutter";
export const toastBox =
  "pointer-events-auto grid max-w-lg gap-1 rounded-r-md border-l-4 border-success bg-surface px-4 py-3 shadow-toast";

export function useToast(): ShowToast {
  const show = use(ToastContext);
  if (!show) throw new Error("useToast requires ToastProvider");
  return show;
}
