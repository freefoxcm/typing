import { ApiError, api, downloadApi } from './api'

describe('API network errors', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

  it.each([
    ['api', () => api('/api/test')],
    ['download', () => downloadApi('/api/export')],
  ])('converts Failed to fetch for %s requests', async (_label, request) => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(request()).rejects.toMatchObject({
      name: 'Error', status: 0, message: '无法连接服务器，请检查网络或稍后重试',
    } satisfies Partial<ApiError>)
  })

  it('uses a specific message while the browser is offline', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    await expect(api('/api/test')).rejects.toMatchObject({ status: 0, message: '网络连接已断开，请检查网络后重试' })
  })

  it('preserves intentional request cancellation', async () => {
    const abort = new DOMException('Aborted', 'AbortError')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(abort)
    await expect(api('/api/test')).rejects.toBe(abort)
  })

  it.each(['headers', 'body'])('times out a stalled response at %s without replaying the request', async (stage) => {
    vi.useFakeTimers()
    const pending = new Promise<Response>(() => {})
    const response = new Response('', { headers: { 'Content-Type': 'application/json' } })
    vi.spyOn(response, 'json').mockImplementation(() => new Promise(() => {}))
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => stage === 'headers' ? pending : Promise.resolve(response))
    const result = api('/api/test', { method: 'POST', body: '{}' })
    const assertion = expect(result).rejects.toMatchObject({ status: 0, message: expect.stringContaining('请求超时') })
    await vi.advanceTimersByTimeAsync(15000)
    await assertion
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
  })

  it('allows longer uploads but still enforces their deadline', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}))
    const result = api('/api/upload', { method: 'POST', body: new FormData() })
    const assertion = expect(result).rejects.toMatchObject({ status: 0 })
    await vi.advanceTimersByTimeAsync(15000)
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(105000)
    await assertion
  })

  it('forwards caller cancellation while consuming the body', async () => {
    const controller = new AbortController()
    const response = new Response('', { headers: { 'Content-Type': 'application/json' } })
    vi.spyOn(response, 'json').mockImplementation(() => new Promise(() => {}))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)
    const result = api('/api/test', { signal: controller.signal })
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    controller.abort()
    await assertion
  })

  it.each([
    ['text/html', '<html>tunnel unavailable</html>'],
    ['application/json', '{"ok":'],
  ])('rejects an invalid successful response (%s)', async (contentType, body) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200, headers: { 'Content-Type': contentType } }))
    await expect(api('/api/test', { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(ApiError)
  })

  it('does not save a proxy HTML page as an archive', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>unavailable</html>', { headers: { 'Content-Type': 'text/html' } }))
    await expect(downloadApi('/api/export')).rejects.toBeInstanceOf(ApiError)
  })
})
