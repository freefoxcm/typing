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

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' })
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

