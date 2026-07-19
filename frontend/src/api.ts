export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
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
    const message = typeof detail === 'string' ? detail : detail?.message ?? JSON.stringify(detail)
    throw new ApiError(message || '请求失败', response.status)
  }
  return body as T
}

export const jsonBody = (value: unknown): RequestInit => ({ body: JSON.stringify(value) })

