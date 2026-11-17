import { describe, it, expect } from 'vitest'
import { cleanCode, joinLink, joinStepCode } from './joinLink'

describe('join links', () => {
  it('keeps only four upper-case letters of what is typed', () => {
    expect(cleanCode('ab')).toBe('AB')
    expect(cleanCode(' a-b1cde ')).toBe('ABCD')
  })
  it('reads the step from the URL', () => {
    expect(joinStepCode(new URLSearchParams(''))).toBeNull()
    expect(joinStepCode(new URLSearchParams('join'))).toBe('')
    expect(joinStepCode(new URLSearchParams('code=wxyz'))).toBe('WXYZ')
  })
  it('builds the link a host shares', () => {
    expect(joinLink('https://x.test', 'ABCD')).toBe('https://x.test/?code=ABCD')
  })
})
