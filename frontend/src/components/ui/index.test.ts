/**
 * Barrel file export test
 *
 * This test ensures all UI components are properly exported from the index file.
 * If a component is added but not exported, this test will fail.
 *
 * WHY THIS EXISTS:
 * Component tests import directly from component files (e.g., './Button'),
 * but consumers import from the barrel file (e.g., '../ui'). Without this test,
 * a component could work in tests but fail for consumers if not exported.
 */
import { describe, it, expect } from 'vitest'
import * as UIComponents from './index'

describe('UI components barrel exports', () => {
  it('exports all UI components', () => {
    // Core components
    expect(UIComponents.Badge).toBeDefined()
    expect(UIComponents.Button).toBeDefined()
    expect(UIComponents.Spinner).toBeDefined()
    expect(UIComponents.Header).toBeDefined()
    expect(UIComponents.PageShell).toBeDefined()
    expect(UIComponents.Card).toBeDefined()
    expect(UIComponents.Panel).toBeDefined()

    // Form components
    expect(UIComponents.TextInput).toBeDefined()
    expect(UIComponents.Select).toBeDefined()
    expect(UIComponents.RadioGroup).toBeDefined()
    expect(UIComponents.Slider).toBeDefined()

    // Overlay components
    expect(UIComponents.Modal).toBeDefined()
    expect(UIComponents.Toast).toBeDefined()
    expect(UIComponents.ToastProvider).toBeDefined()
    expect(UIComponents.useToast).toBeDefined()
  })
})
