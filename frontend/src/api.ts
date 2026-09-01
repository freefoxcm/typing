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

async function fetchApi(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(path, init)
  } catch (error) {
    if (typeof error === 'object' && error && 'name' in error && error.name === 'AbortError') throw error
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false
    throw new ApiError(offline ? '网络连接已断开，请检查网络后重试' : '无法连接服务器，请检查网络或稍后重试', 0)
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetchApi(path, { ...init, headers, credentials: 'same-origin' })
  if (response.status === 204) return undefined as T
  const contentType = response.headers.get('content-type') ?? ''
  const body = contentType.includes('json') ? await response.json() : await response.text()
  if (!response.ok) {
    const detail = typeof body === 'object' ? body.detail : body
    const message = errorMessage(detail)
    throw new ApiError(message || '请求失败', response.status)
  }
  return body as T
}

export const jsonBody = (value: unknown): RequestInit => ({ body: JSON.stringify(value) })

export async function downloadApi(path: string, init: RequestInit = {}): Promise<{ blob: Blob; filename: string }> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetchApi(path, { ...init, headers, credentials: 'same-origin' })
  if (!response.ok) {
    const contentType = response.headers.get('content-type') ?? ''
    const body = contentType.includes('json') ? await response.json() : await response.text()
    const detail = typeof body === 'object' && body && 'detail' in body ? body.detail : body
    throw new ApiError(errorMessage(detail) || '下载失败', response.status)
  }
  const disposition = response.headers.get('content-disposition') ?? ''
  const match = /filename="?([^";]+)"?/i.exec(disposition)
  return { blob: await response.blob(), filename: match?.[1] || 'question-sets.zip' }
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

