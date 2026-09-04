import { useRef, useState } from 'react'

// A failed read after a confirmed write must never cause the write to be repeated.
export function useRefreshRecovery() {
  const failedRefresh = useRef<(() => Promise<unknown>) | null>(null)
  const retryingRef = useRef(false)
  const [message, setMessage] = useState('')
  const [retrying, setRetrying] = useState(false)
  const refreshAfterSave = async (reload: () => Promise<unknown>) => {
    try {
      await reload()
      failedRefresh.current = null
      setMessage('')
    } catch (error) {
      failedRefresh.current = reload
      setMessage(`操作已完成，但列表刷新失败：${error instanceof Error ? error.message : '请检查网络'}。请重试刷新，无需重复提交。`)
    }
  }
  const retry = async () => {
    if (!failedRefresh.current || retryingRef.current) return
    retryingRef.current = true; setRetrying(true)
    try { await refreshAfterSave(failedRefresh.current) }
    finally { retryingRef.current = false; setRetrying(false) }
  }
  const refreshNotice = message && <div className="notice error" role="alert"><span>{message}</span> <button className="ghost" disabled={retrying} onClick={() => void retry()}>{retrying ? '正在刷新…' : '重试刷新'}</button></div>
  return { refreshAfterSave, refreshNotice }
}
