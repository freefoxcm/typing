export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

function errorMessage(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((item) => typeof item === 'object' && item && 'msg' in item ? String(item.msg) : JSON.stringify(item))
      .filter(Boolean)
      .join('；')
  }
  if (typeof detail === 'object' && detail) {
    const value = detail as { message?: unknown; errors?: unknown }
    const message = typeof value.message === 'string' ? value.message : ''
    const errors = Array.isArray(value.errors) ? value.errors.map(String).filter(Boolean) : []
    if (message && errors.length) return `${message}：${errors.join('；')}`
    if (message) return message
    return JSON.stringify(detail)
  }
  return detail == null ? '' : String(detail)
}

export type ApiRequestInit = RequestInit & { timeoutMs?: number }

// The deadline includes reading the response body. Never automatically replay writes.
async function request<T>(path: string, init: ApiRequestInit, read: (response: Response) => Promise<T>): Promise<T> {
  const { timeoutMs = init.body instanceof FormData ? 120000 : 15000, signal, ...options } = init
  const controller = new AbortController()
  let rejectAbort!: (reason: unknown) => void
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject })
  const cancel = () => {
    controller.abort()
    rejectAbort(new DOMException('Aborted', 'AbortError'))
  }
  signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => {
    rejectAbort(new ApiError('请求超时，请检查网络后重试；写入结果尚未确认', 0))
    controller.abort()
  }, timeoutMs)
  const headers = new Headers(options.headers)
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  try {
    if (signal?.aborted) cancel()
    return await Promise.race([
      aborted,
      (async () => {
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')
        const response = await fetch(path, { ...options, headers, credentials: 'same-origin', signal: controller.signal })
        return read(response)
      })(),
    ])
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (typeof error === 'object' && error && 'name' in error && error.name === 'AbortError') throw error
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false
    throw new ApiError(offline ? '网络连接已断开，请检查网络后重试' : '无法连接服务器，请检查网络或稍后重试', 0)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}

async function jsonResponse(response: Response): Promise<unknown> {
  if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('json')) {
    throw new ApiError('服务器响应格式异常，请稍后重试；操作结果尚未确认', response.ok ? 0 : response.status)
  }
  let body
  try { body = await response.json() }
  catch (error) {
    if (error instanceof SyntaxError) throw new ApiError('服务器响应不完整，请稍后重试；操作结果尚未确认', 0)
    throw error
  }
  if (!response.ok) throw new ApiError(errorMessage(body?.detail) || '请求失败', response.status)
  return body
}

export async function api<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  return request(path, init, async (response) => {
    if (response.status === 204) return undefined as T
    return await jsonResponse(response) as T
  })
}

export const jsonBody = (value: unknown): RequestInit => ({ body: JSON.stringify(value) })

export async function downloadApi(path: string, init: ApiRequestInit = {}): Promise<{ blob: Blob; filename: string }> {
  return request(path, { timeoutMs: 120000, ...init }, async (response) => {
    if (!response.ok) await jsonResponse(response)
    if ((response.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) throw new ApiError('服务器返回了网页，下载未完成，请重试', 0)
    const disposition = response.headers.get('content-disposition') ?? ''
    const match = /filename="?([^";]+)"?/i.exec(disposition)
    return { blob: await response.blob(), filename: match?.[1] || 'question-sets.zip' }
  })
}

export function saveDownload({ blob, filename }: { blob: Blob; filename: string }) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

