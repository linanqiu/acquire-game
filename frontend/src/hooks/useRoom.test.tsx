import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { useRoom } from './useRoom'
import type { ReactNode } from 'react'

function createWrapper(route: string, path: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={path} element={children} />
        </Routes>
      </MemoryRouter>
    )
  }
}

describe('useRoom', () => {
  it('returns room code from URL', () => {
    const { result } = renderHook(() => useRoom(), {
      wrapper: createWrapper('/play/ABCD', '/play/:room'),
    })
    expect(result.current).toBe('ABCD')
  })

  it('returns uppercase room code for lowercase input', () => {
    const { result } = renderHook(() => useRoom(), {
      wrapper: createWrapper('/play/abcd', '/play/:room'),
    })
    expect(result.current).toBe('ABCD')
  })

  it('returns uppercase room code for mixed case input', () => {
    const { result } = renderHook(() => useRoom(), {
      wrapper: createWrapper('/play/AbCd', '/play/:room'),
    })
    expect(result.current).toBe('ABCD')
  })

  it('returns empty string when no room param', () => {
    const { result } = renderHook(() => useRoom(), {
      wrapper: createWrapper('/', '/'),
    })
    expect(result.current).toBe('')
  })

  it('works with host route', () => {
    const { result } = renderHook(() => useRoom(), {
      wrapper: createWrapper('/host/WXYZ', '/host/:room'),
    })
    expect(result.current).toBe('WXYZ')
  })
})
