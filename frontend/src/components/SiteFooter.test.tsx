import { render, screen } from '@testing-library/react'
import { SiteFooter } from './SiteFooter'

describe('SiteFooter', () => {
  it('shows the copyright owner and repository link', () => {
    render(<SiteFooter />)

    expect(screen.getByText('© 2026 源乐科技')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'AGPL-3.0-or-later' })).toHaveAttribute(
      'href',
      'https://github.com/freefoxcm/typing/blob/main/LICENSE',
    )
    expect(screen.getByRole('link', { name: /freefoxcm\/typing/ })).toHaveAttribute(
      'href',
      'https://github.com/freefoxcm/typing',
    )
  })
})
