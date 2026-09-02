import {
  safeCreaseEdgeStyle,
  safeCreaseShadowStyle,
} from '@/plugins/paged-reader-safe-curl-primitives'

function sheet() {
  return {
    pageBoundsReady: true,
    pageBounds: {top: 100, width: 500, height: 800},
    geometry: {seamTop: 85, seamBottom: 15},
    direction: -1,
    paperX: (percent: number) => 250 + 500 * percent / 100,
  }
}

describe('safe curl primitives', () => {
  it('paints the shadow as a bounded transformed strip without clipping', () => {
    const style = safeCreaseShadowStyle(sheet(), 0.5)

    expect(style.clipPath).toBe('none')
    expect(style.WebkitClipPath).toBe('none')
    expect(style.opacity).toBe('1')
    expect(parseFloat(style.width)).toBeLessThanOrEqual(16)
    expect(parseFloat(style.height)).toBeGreaterThan(800)
    expect(style.transform).toMatch(/^matrix\(/)
  })

  it('keeps the crease highlight on the same bounded geometry', () => {
    const shadow = safeCreaseShadowStyle(sheet(), 0.5)
    const edge = safeCreaseEdgeStyle(sheet(), 0.5)

    expect(edge.transform).toBe(shadow.transform)
    expect(edge.height).toBe(shadow.height)
    expect(parseFloat(edge.width)).toBeLessThan(parseFloat(shadow.width))
    expect(edge.opacity).toBe('1')
  })

  it('does not create a drawable layer at curl endpoints', () => {
    expect(safeCreaseShadowStyle(sheet(), 0)).toEqual({opacity: '0'})
    expect(safeCreaseEdgeStyle(sheet(), 1)).toEqual({opacity: '0'})
  })
})
