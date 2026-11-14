import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { useRoom } from './useRoom'
import type { ReactNode } from 'react'

function at(route: string, path: string) {
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
  it('the room code is the URL parameter, upper-cased (a code typed in lower case still finds the room)', () => {
    const player = renderHook(() => useRoom(), { wrapper: at('/play/abCd', '/play/:room') })
    expect(player.result.current).toBe('ABCD')
    const host = renderHook(() => useRoom(), { wrapper: at('/host/wxyz', '/host/:room') })
    expect(host.result.current).toBe('WXYZ')
  })

  it('is empty where the route has no room', () => {
    const { result } = renderHook(() => useRoom(), { wrapper: at('/', '/') })
    expect(result.current).toBe('')
  })
})
