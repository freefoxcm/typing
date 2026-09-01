import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

export type AdminToastKind = 'success' | 'error' | 'info'
export type AdminToastNotification = { id: number; kind: AdminToastKind; message: string }
export type AdminNotifier = (kind: AdminToastKind, message: string) => void

const durations: Record<AdminToastKind, number | null> = { success: 3000, error: null, info: 4000 }

export function useAdminToasts() {
  const [notifications, setNotifications] = useState<AdminToastNotification[]>([])
  const nextId = useRef(1)
  const dismiss = useCallback((id: number) => setNotifications((current) => current.filter((item) => item.id !== id)), [])
  const notify = useCallback((kind: AdminToastKind, message: string) => {
    const clean = message.trim()
    if (!clean) return
    setNotifications((current) => {
      const next = { id: nextId.current++, kind, message: clean }
      return [next, ...current.filter((item) => item.kind !== kind || item.message !== clean)].slice(0, 3)
    })
  }, [])
  return { notifications, notify, dismiss }
}

export function AdminToastViewport({ notifications, onDismiss }: {
  notifications: AdminToastNotification[]
  onDismiss: (id: number) => void
}) {
  return <div className="admin-toast-viewport" aria-label="操作通知">
    {notifications.map((notification) => <AdminToast key={notification.id} notification={notification} onDismiss={onDismiss} />)}
  </div>
}

function AdminToast({ notification, onDismiss }: {
  notification: AdminToastNotification
  onDismiss: (id: number) => void
}) {
  const remaining = useRef(durations[notification.kind])
  const startedAt = useRef(0)
  const timer = useRef<number | null>(null)
  const Icon = notification.kind === 'success' ? CheckCircle2 : notification.kind === 'error' ? AlertCircle : Info

  const pause = useCallback(() => {
    if (timer.current == null || remaining.current == null) return
    window.clearTimeout(timer.current)
    timer.current = null
    remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current))
  }, [])
  const resume = useCallback(() => {
    if (timer.current != null || remaining.current == null) return
    startedAt.current = Date.now()
    timer.current = window.setTimeout(() => onDismiss(notification.id), remaining.current)
  }, [notification.id, onDismiss])

  useEffect(() => {
    remaining.current = durations[notification.kind]
    resume()
    return () => {
      if (timer.current != null) window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [notification.kind, resume])

  return <section
    className={`admin-toast ${notification.kind}`}
    role={notification.kind === 'error' ? 'alert' : 'status'}
    aria-live={notification.kind === 'error' ? 'assertive' : 'polite'}
    onMouseEnter={pause}
    onMouseLeave={resume}
    onFocus={pause}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) resume() }}
  >
    <Icon aria-hidden="true" />
    <p>{notification.message}</p>
    <button type="button" aria-label={`关闭通知：${notification.message}`} onClick={() => onDismiss(notification.id)}><X /></button>
  </section>
}
