// Bottom-right toasts. Transient ones auto-dismiss (~3.2s); sticky ones (errors)
// stay until the user dismisses them via the × button. Ported from the
// prototype's app-shell toast stack.
import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';

interface ToastOpts {
  sticky?: boolean;
}
type ToastFn = (content: ReactNode, opts?: ToastOpts) => void;

const ToastContext = createContext<ToastFn>(() => {});

interface ToastItem {
  id: number;
  content: ReactNode;
  sticky?: boolean;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback<ToastFn>(
    (content, opts) => {
      // Monotonic id — Date.now()+counter avoids collisions within a tick.
      const id = Date.now() + Math.floor(performance.now() % 1000) + toastSeq++;
      setToasts((ts) => [...ts, { id, content, sticky: opts?.sticky }]);
      // Sticky toasts persist until dismissed; transient ones auto-clear.
      if (!opts?.sticky) setTimeout(() => dismiss(id), 3200);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toasts">
        {toasts.map((x) => (
          <div key={x.id} className={x.sticky ? 'toast sticky' : 'toast'}>
            {x.content}
            {x.sticky && (
              <button className="toast-close" onClick={() => dismiss(x.id)} aria-label="Dismiss">
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

let toastSeq = 0;

export function useToast(): ToastFn {
  return useContext(ToastContext);
}
