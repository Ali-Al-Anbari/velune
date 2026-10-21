import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('landing screen', () => {
  it('introduces Velune without invented shift or earnings data', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /make room for what matters/i })).toBeInTheDocument()
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
