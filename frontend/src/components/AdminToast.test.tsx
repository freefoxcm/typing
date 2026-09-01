import { act, fireEvent, render, screen } from '@testing-library/react'
import { AdminToastViewport, useAdminToasts } from './AdminToast'

function Harness() {
  const toast = useAdminToasts()
  return <><button onClick={() => toast.notify('success', '保存成功')}>成功</button><button onClick={() => toast.notify('error', '保存失败')}>失败</button><button onClick={() => toast.notify('info', '处理中')}>提示</button><AdminToastViewport notifications={toast.notifications} onDismiss={toast.dismiss} /></>
}

describe('AdminToast', () => {
  afterEach(() => vi.useRealTimers())

  it('auto dismisses successes, pauses while hovered, and keeps errors until closed', () => {
    vi.useFakeTimers()
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '成功' }))
    const success = screen.getByRole('status')
    expect(success).toHaveTextContent('保存成功')
    act(() => vi.advanceTimersByTime(2000))
    fireEvent.mouseEnter(success)
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.getByText('保存成功')).toBeInTheDocument()
    fireEvent.mouseLeave(success)
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.queryByText('保存成功')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '失败' }))
    act(() => vi.advanceTimersByTime(10000))
    expect(screen.getByRole('alert')).toHaveTextContent('保存失败')
    fireEvent.click(screen.getByRole('button', { name: '关闭通知：保存失败' }))
    expect(screen.queryByText('保存失败')).not.toBeInTheDocument()
  })

  it('deduplicates messages and keeps at most three newest notifications', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '成功' }))
    fireEvent.click(screen.getByRole('button', { name: '成功' }))
    expect(screen.getAllByText('保存成功')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '失败' }))
    fireEvent.click(screen.getByRole('button', { name: '提示' }))
    fireEvent.click(screen.getByRole('button', { name: '成功' }))
    expect(screen.getByLabelText('操作通知').querySelectorAll('.admin-toast')).toHaveLength(3)
  })
})
