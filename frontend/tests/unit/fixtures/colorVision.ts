/**
 * Colour maths for the palette tests: OKLab (perceived lightness and distance) and simulated
 * colour-vision deficiencies (Machado, Oliveira & Fernandes 2009, severity 1.0, applied in
 * linear sRGB). Test-only: the app never needs it.
 */
type Vec3 = [number, number, number]

const MACHADO: Record<'protan' | 'deutan' | 'tritan', Vec3[]> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
}

export type Vision = 'normal' | keyof typeof MACHADO
export const VISIONS: Vision[] = ['normal', 'protan', 'deutan', 'tritan']

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

export function hexToLinear(hex: string): Vec3 {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => toLinear(parseInt(h.slice(i, i + 2), 16) / 255)) as Vec3
}

export function simulate(rgb: Vec3, vision: Vision): Vec3 {
  if (vision === 'normal') return rgb
  const m = MACHADO[vision]
  return m.map((row) =>
    Math.min(1, Math.max(0, row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]))
  ) as Vec3
}

export function oklab([r, g, b]: Vec3): Vec3 {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** OKLab lightness (0..1) of a `#RRGGBB` colour. */
export const lightness = (hex: string) => oklab(hexToLinear(hex))[0]

/** Smallest OKLab distance between any two colours, as seen with `vision`. */
export function minDistance(hexes: string[], vision: Vision): number {
  const pts = hexes.map((h) => oklab(simulate(hexToLinear(h), vision)))
  let min = Infinity
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1], pts[i][2] - pts[j][2])
      min = Math.min(min, d)
    }
  return min
}
