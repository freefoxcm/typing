import { Fragment, useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'

export type AdminItemAction = {
  key: string
  label: string
  icon: ReactNode
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
  description?: string
  separatorBefore?: boolean
}

export function AdminItemActionsMenu({ label, actions }: { label: string; actions: AdminItemAction[] }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const close = useCallback((restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) window.setTimeout(() => triggerRef.current?.focus(), 0)
  }, [])

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus()
    const pointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close()
    }
    const keyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(true) }
    }
    document.addEventListener('pointerdown', pointerDown)
    document.addEventListener('keydown', keyDown)
    return () => {
      document.removeEventListener('pointerdown', pointerDown)
      document.removeEventListener('keydown', keyDown)
    }
  }, [close, open])

  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])]
    if (!items.length) return
    event.preventDefault()
    const current = items.indexOf(document.activeElement as HTMLElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }

  return <div className="question-set-more admin-item-actions-menu" ref={rootRef}>
    <button
      ref={triggerRef}
      type="button"
      className="ghost icon-button question-set-more-trigger"
      aria-label={`更多操作 ${label}`}
      title="更多操作"
      aria-haspopup="menu"
      aria-expanded={open}
      onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true) } }}
      onClick={() => setOpen((current) => !current)}
    ><MoreHorizontal /></button>
    {open && <div className="question-set-menu admin-item-actions-popover" role="menu" aria-label={`${label}操作菜单`} ref={menuRef} onKeyDown={navigate}>
      {actions.map((action) => <Fragment key={action.key}>
        {action.separatorBefore && <div className="question-set-menu-separator" role="separator" />}
        <button
          type="button"
          role="menuitem"
          className={action.danger ? 'danger' : undefined}
          disabled={action.disabled}
          onClick={() => { close(true); action.onSelect() }}
        >{action.icon}<span>{action.label}{action.description && <small>{action.description}</small>}</span></button>
      </Fragment>)}
    </div>}
  </div>
}
