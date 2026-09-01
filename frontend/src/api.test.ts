import { ApiError, api, downloadApi } from './api'

describe('API network errors', () => {
  afterEach(() => vi.restoreAllMocks())

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
})
