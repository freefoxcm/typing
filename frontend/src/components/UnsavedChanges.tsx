import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react'
import { useBlocker } from 'react-router-dom'

const warning = '还有尚未确认保存的内容，离开后将丢失重试机会。确认离开？'
type Guard = { register: (check: () => boolean) => () => void; confirmLeave: () => boolean; resumeProtection: () => void; isProtected: () => boolean }
const Context = createContext<Guard | null>(null)

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const checks = useRef(new Set<() => boolean>())
  const leaving = useRef(false)
  const isProtected = useCallback(() => !leaving.current, [])
  const resumeProtection = useCallback(() => { leaving.current = false }, [])
  const dirty = useCallback(() => !leaving.current && [...checks.current].some((check) => check()), [])
  const register = useCallback((check: () => boolean) => {
    checks.current.add(check)
    return () => { checks.current.delete(check) }
  }, [])
  const confirmLeave = useCallback(() => {
    if (dirty() && !window.confirm(warning)) return false
    leaving.current = true
    return true
  }, [dirty])
  const blocker = useBlocker(dirty)
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (window.confirm(warning)) blocker.proceed()
    else blocker.reset()
  }, [blocker])
  return <Context.Provider value={{ register, confirmLeave, resumeProtection, isProtected }}>{children}</Context.Provider>
}

export function useConfirmLeave() {
  return useContext(Context) ?? { confirmLeave: () => true, resumeProtection: () => {} }
}

export function useUnsavedChanges(check: () => boolean) {
  const guard = useContext(Context)
  const latest = useRef(check)
  latest.current = check
  useEffect(() => {
    const unregister = guard?.register(() => latest.current())
    const warn = (event: BeforeUnloadEvent) => {
      if (!latest.current() || guard?.isProtected() === false) return
      event.preventDefault(); event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => { unregister?.(); window.removeEventListener('beforeunload', warn) }
  }, [guard?.register])
  // Standalone consumers without the application provider still protect their own back link.
  return () => !!guard || !latest.current() || window.confirm(warning)
}
