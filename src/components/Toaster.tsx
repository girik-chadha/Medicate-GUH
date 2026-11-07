import { useEffect, useState } from 'react';

/** Minimal toast — a tiny module-level pub/sub (no state library) plus one
 *  fixed-position renderer mounted once in App. Used for non-blocking
 *  notices such as the n8n relay succeeding or failing. */

export type ToastKind = 'info' | 'success' | 'error';

interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
}

const TOAST_MS = 4500;
let nextId = 1;
const listeners = new Set<(items: ToastItem[]) => void>();
let items: ToastItem[] = [];

function emit() {
  for (const fn of listeners) fn(items);
}

export function toast(text: string, kind: ToastKind = 'info') {
  const id = nextId++;
  items = [...items, { id, text, kind }];
  emit();
  window.setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, TOAST_MS);
}

const BG: Record<ToastKind, string> = {
  info: 'var(--cream)',
  success: 'var(--mint)',
  error: 'var(--rose)',
};

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>(items);
  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);

  if (list.length === 0) return null;
  return (
    <div
      aria-live="polite"
      style={{
        position: 'fixed',
        left: 18,
        bottom: 18,
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 'min(360px, calc(100vw - 36px))',
        pointerEvents: 'none',
      }}
    >
      {list.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className={`popin toast toast--${t.kind}`}
          style={{
            background: BG[t.kind],
            border: '3px solid var(--line)',
            borderRadius: 14,
            boxShadow: 'var(--plush-tiny)',
            padding: '8px 14px',
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--ink)',
          }}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
