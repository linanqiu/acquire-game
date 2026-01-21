/**
 * Barrel file export test
 *
 * This test ensures all game components are properly exported from the index file.
 * If a component is added but not exported, this test will fail.
 *
 * WHY THIS EXISTS:
 * Component tests import directly from component files (e.g., './Portfolio'),
 * but consumers import from the barrel file (e.g., '../game'). Without this test,
 * a component could work in tests but fail for consumers if not exported.
 */
import { describe, it, expect } from 'vitest'
import * as GameComponents from './index'

describe('game components barrel exports', () => {
  it('exports all game components', () => {
    // Board components
    expect(GameComponents.Tile).toBeDefined()
    expect(GameComponents.Board).toBeDefined()
    expect(GameComponents.TileRack).toBeDefined()
    expect(GameComponents.ChainMarker).toBeDefined()

    // Player components
    expect(GameComponents.PlayerCard).toBeDefined()
    expect(GameComponents.Portfolio).toBeDefined()

    // Action components
    expect(GameComponents.StockStepper).toBeDefined()
    expect(GameComponents.ChainSelector).toBeDefined()
    expect(GameComponents.MergerDisposition).toBeDefined()
  })
})
