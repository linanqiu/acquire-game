import { afterEach, describe, expect, it, vi } from 'vitest'
import { recallName, rememberName } from './playerName'

describe('the name last used on the home page (BL-015)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('is offered again after it was used', () => {
    expect(recallName()).toBe('')
    rememberName('Ada')
    expect(recallName()).toBe('Ada')
  })

  it('without storage (private window, blocked site data) the name is simply asked again', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => rememberName('Ada')).not.toThrow()
    expect(recallName()).toBe('')
  })
})
