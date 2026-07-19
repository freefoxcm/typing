import { render, screen } from '@testing-library/react'
import { FingerGuide } from './FingerGuide'

function finger(container: HTMLElement, name: string) {
  const element = container.querySelector('[data-finger="' + name + '"]')
  expect(element).not.toBeNull()
  return element!
}

describe('FingerGuide', () => {
  it('highlights the left index finger for f', () => {
    const { container } = render(<FingerGuide expected="f" />)

    expect(finger(container, 'l2')).toHaveClass('is-primary')
    expect(container.querySelectorAll('.is-modifier')).toHaveLength(0)
  })

  it('highlights the right middle finger for i', () => {
    const { container } = render(<FingerGuide expected="i" />)

    expect(finger(container, 'r3')).toHaveClass('is-primary')
  })

  it('uses the opposite little finger as the Shift modifier', () => {
    const { container, rerender } = render(<FingerGuide expected="A" />)

    expect(finger(container, 'l5')).toHaveClass('is-primary')
    expect(finger(container, 'r5')).toHaveClass('is-modifier')

    rerender(<FingerGuide expected="?" />)
    expect(finger(container, 'r5')).toHaveClass('is-primary')
    expect(finger(container, 'l5')).toHaveClass('is-modifier')
  })

  it('highlights both thumbs for space', () => {
    const { container } = render(<FingerGuide expected=" " />)

    expect(finger(container, 'l1')).toHaveClass('is-primary')
    expect(finger(container, 'r1')).toHaveClass('is-primary')
  })

  it('keeps the illustration without a glow for an unknown character', () => {
    const { container } = render(<FingerGuide expected="你" />)

    expect(container.querySelectorAll('.is-primary, .is-modifier')).toHaveLength(0)
    expect(screen.getByText(/暂无对应指法/)).toBeInTheDocument()
  })
})
