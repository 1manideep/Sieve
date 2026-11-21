// Toasts (40 section 7.5). Toasts never carry content: at most an AI name, a step name and the person's own question.
import { create } from 'zustand';
import { announce } from './announcer';

export type ToastTone = 'success' | 'info' | 'warning' | 'error';
export interface Toast { id: string; tone: ToastTone; title: string; body?: string; action?: { label: string; run: () => void }; timeoutMs: number }
export interface ToastState {
  toasts: Toast[];                                   // newest last; at most 3 shown, older ones dropped
  push(t: Omit<Toast, 'id' | 'timeoutMs'> & { timeoutMs?: number }): string;   // default 6000 ms; errors 10000 ms; Infinity stays until dismissed
  dismiss(id: string): void;
}

export const MAX_TOASTS = 3;
export const DEFAULT_TOAST_MS = 6000;
export const ERROR_TOAST_MS = 10000;

let counter = 0;

export const useToasts = create<ToastState>()((set) => ({
  toasts: [],
  push(t) {
    counter += 1;
    const id = `toast-${counter}`;
    const timeoutMs = t.timeoutMs ?? (t.tone === 'error' ? ERROR_TOAST_MS : DEFAULT_TOAST_MS);
    const toast: Toast = { ...t, id, timeoutMs };
    set((s) => ({ toasts: [...s.toasts, toast].slice(-MAX_TOASTS) }));
    const spoken = t.body ? `${t.title} ${t.body}` : t.title;
    announce(spoken, t.tone === 'warning' || t.tone === 'error' ? 'assertive' : 'polite');
    return id;
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
  },
}));
