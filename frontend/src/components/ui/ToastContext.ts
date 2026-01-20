import { createContext } from 'react'
import type { ToastType } from './Toast'

export interface ToastContextValue {
  toast: (message: string, type?: ToastType, duration?: number) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)
