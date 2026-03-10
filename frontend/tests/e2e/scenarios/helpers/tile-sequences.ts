import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const TILE_SEQUENCES_DIR = path.resolve(__dirname, '../../fixtures/tile-sequences')

/**
 * Parse a tile order CSV file into a flat array of tile strings.
 * Skips comment lines (starting with #) and empty lines.
 *
 * @param csvFilename - Name of the CSV file in fixtures/tile-sequences/
 * @returns Array of tile strings like ["1A", "2A", "3B", ...]
 */
export function parseTileOrderCsv(csvFilename: string): string[] {
  const csvPath = path.resolve(TILE_SEQUENCES_DIR, csvFilename)
  const content = fs.readFileSync(csvPath, 'utf-8')
  const tiles: string[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    for (const tile of trimmed.split(',')) {
      const t = tile.trim()
      if (t) tiles.push(t)
    }
  }
  return tiles
}
