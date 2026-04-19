import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Icons } from '@/runmesh/components/Icons';
import { translate } from '@/runmesh/i18n';

export type TipStatus = 'success' | 'info' | 'warning' | 'error';

export interface EnterpriseTipConfig {
  title?: string;
  description: string;
  status?: TipStatus;
  duration?: number;
  closable?: boolean;
  key?: string;
}

interface TipItem extends Required<Omit<EnterpriseTipConfig, 'key'>> {
  id: string;
  createdAt: number;
}

interface EnterpriseTipContextValue {
  show: (config: EnterpriseTipConfig) => string;
  success: (description: string, title?: string, duration?: number) => string;
  error: (description: string, title?: string, duration?: number) => string;
  warning: (description: string, title?: string, duration?: number) => string;
  info: (description: string, title?: string, duration?: number) => string;
  close: (id: string) => void;
  clearAll: () => void;
}

const EnterpriseTipContext = createContext<EnterpriseTipContextValue | null>(null);

const STATUS_STYLES: Record<
  TipStatus,
  { icon: React.ReactNode; badge: string; ring: string; text: string; tone: string }
> = {
  success: {
    icon: <Icons.CheckCircle className="w-5 h-5 text-green-600" />,
    badge: 'bg-green-50 text-green-700',
    ring: 'ring-green-100',
    text: 'text-green-800',
    tone: 'from-green-50/80 to-green-100/60',
  },
  info: {
    icon: <Icons.AlertCircle className="w-5 h-5 text-blue-600" />,
    badge: 'bg-blue-50 text-blue-700',
    ring: 'ring-blue-100',
    text: 'text-blue-800',
    tone: 'from-blue-50/80 to-blue-100/60',
  },
  warning: {
    icon: <Icons.AlertTriangle className="w-5 h-5 text-amber-600" />,
    badge: 'bg-amber-50 text-amber-700',
    ring: 'ring-amber-100',
    text: 'text-amber-800',
    tone: 'from-amber-50/80 to-amber-100/60',
  },
  error: {
    icon: <Icons.AlertOctagon className="w-5 h-5 text-red-600" />,
    badge: 'bg-red-50 text-red-700',
    ring: 'ring-red-100',
    text: 'text-red-800',
    tone: 'from-red-50/80 to-red-100/60',
  },
};

const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const useEnterpriseTip = () => {
  const context = useContext(EnterpriseTipContext);
  if (!context) {
    throw new Error(translate('enterpriseTip.error.providerMissing'));
  }
  return context;
};

export const EnterpriseTipProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tips, setTips] = useState<TipItem[]>([]);
  const timers = useRef<Record<string, number>>({});

  const remove = useCallback((id: string) => {
    const timer = timers.current[id];
    if (timer) {
      window.clearTimeout(timer);
      delete timers.current[id];
    }
    setTips((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const scheduleRemoval = useCallback(
    (id: string, duration: number) => {
      if (duration === 0) return;
      timers.current[id] = window.setTimeout(() => remove(id), duration);
    },
    [remove],
  );

  const show = useCallback(
    (config: EnterpriseTipConfig) => {
      const id = config.key || createId();
      const duration = config.duration ?? 3200;
      const tipItem: TipItem = {
        id,
        title: config.title ?? '',
        description: config.description,
        status: config.status ?? 'info',
        duration,
        closable: config.closable ?? true,
        createdAt: Date.now(),
      };

      setTips((prev) => {
        const next = config.key ? prev.filter((item) => item.id !== config.key) : prev;
        return [...next, tipItem].sort((a, b) => a.createdAt - b.createdAt);
      });

      scheduleRemoval(id, duration);
      return id;
    },
    [scheduleRemoval],
  );

  const value = useMemo<EnterpriseTipContextValue>(
    () => ({
      show,
      success: (description, title, duration) =>
        show({ description, title, duration, status: 'success' }),
      error: (description, title, duration) =>
        show({ description, title, duration, status: 'error' }),
      warning: (description, title, duration) =>
        show({ description, title, duration, status: 'warning' }),
      info: (description, title, duration) =>
        show({ description, title, duration, status: 'info' }),
      close: remove,
      clearAll: () => {
        Object.values(timers.current).forEach((timer) => window.clearTimeout(timer));
        timers.current = {};
        setTips([]);
      },
    }),
    [remove, show],
  );

  return (
    <EnterpriseTipContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed top-5 right-5 z-[2000] flex w-[380px] max-w-[90vw] flex-col gap-3">
        {tips.map((tip) => {
          const style = STATUS_STYLES[tip.status];
          return (
            <div
              key={tip.id}
              className={`pointer-events-auto overflow-hidden rounded-xl border border-white/60 bg-gradient-to-br shadow-[0_10px_30px_rgba(15,23,42,0.12)] backdrop-blur-sm ring-1 ${style.ring} ${style.tone}`}
            >
              <div className="flex items-start gap-3 px-4 py-3">
                <div className="mt-0.5 inline-flex items-center justify-center rounded-full bg-white/80 p-2 shadow-sm ring-1 ring-black/5">
                  {style.icon}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  {tip.title && (
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.badge}`}
                      >
                        TIPS
                      </span>
                      <span className="truncate">{tip.title}</span>
                    </div>
                  )}
                  <p className={`text-sm leading-6 ${style.text}`}>{tip.description}</p>
                </div>
                {tip.closable && (
                  <button
                    aria-label={translate('enterpriseTip.action.close')}
                    className="mt-1 text-slate-400 transition-colors hover:text-slate-600"
                    onClick={() => remove(tip.id)}
                  >
                    <Icons.X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </EnterpriseTipContext.Provider>
  );
};
