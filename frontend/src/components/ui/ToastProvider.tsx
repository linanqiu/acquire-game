import { useState, useCallback, useRef, useEffect } from 'react'
import { Toast, ToastType } from './Toast'
import { ToastContext } from './ToastContext'
import styles from './Toast.module.css'

interface ToastData {
  id: string
  message: string
  type: ToastType
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Cleanup all timers on unmount
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()
    }
  }, [])

  const removeToast = useCallback((id: string) => {
    // Clear the timer if it exists
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (message: string, type: ToastType = 'info', duration = 5000) => {
      const id = Math.random().toString(36).slice(2)
      setToasts((prev) => [...prev, { id, message, type }])

      if (duration > 0) {
        const timer = setTimeout(() => {
          timersRef.current.delete(id)
          setToasts((prev) => prev.filter((t) => t.id !== id))
        }, duration)
        timersRef.current.set(id, timer)
      }
    },
    []
  )

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className={styles.container} aria-label="Notifications">
        {toasts.map((t) => (
          <Toast key={t.id} {...t} onDismiss={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}
