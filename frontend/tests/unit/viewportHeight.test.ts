import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

// On an iPhone, 100vh is the screen height with the browser bars hidden. A page at least 100vh
// tall is taller than what the player sees, so it scrolls past the game (seen on the live site).
// Every 100vh must be followed at once by the same property in dvh, the visible height (100vh
// stays as the fallback for browsers without dvh). No browser in CI collapses its bars, so this
// reads the stylesheets instead.
function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return cssFiles(path)
    return path.endsWith('.css') ? [path] : []
  })
}

describe('page heights use the visible viewport (dvh), not 100vh alone', () => {
  it('every 100vh declaration is followed by its dvh override', () => {
    const bad: string[] = []
    for (const file of cssFiles(join(__dirname, '../../src'))) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        const m = /^\s*([\w-]+)\s*:\s*100vh\s*;/.exec(line)
        if (!m) return
        const next = lines[i + 1] ?? ''
        if (!new RegExp(`^\\s*${m[1]}\\s*:\\s*100dvh\\s*;`).test(next)) {
          bad.push(`${file.replace(/.*\/src\//, 'src/')}:${i + 1} ${line.trim()}`)
        }
      })
    }
    expect(bad).toEqual([])
  })
})
