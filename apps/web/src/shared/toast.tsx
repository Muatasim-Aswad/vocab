import { useCallback, useEffect, useState, type ReactNode } from "react";

import { ToastContext, toastBox, toastRegion, type ShowToast } from "./toast-context.ts";

const shownMs = 5000;

interface Toast {
  id: number;
  message: string;
  detail?: string;
}

/** One short confirmation at a time, announced politely and hidden after a few seconds. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const show = useCallback<ShowToast>(
    (message, detail) => setToast((current) => ({ id: (current?.id ?? 0) + 1, message, detail })),
    [],
  );

  useEffect(() => {
    const timer = toast ? window.setTimeout(() => setToast(null), shownMs) : undefined;
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext value={show}>
      {children}
      <div className={toastRegion} aria-live="polite" aria-atomic="true">
        {toast ? (
          <div key={toast.id} className={toastBox}>
            <p className="font-semibold">{toast.message}</p>
            {toast.detail ? <p>{toast.detail}</p> : null}
          </div>
        ) : null}
      </div>
    </ToastContext>
  );
}
