import {
  safeCreaseEdgeStyle,
  safeCreaseFrontShadowStyle,
  safeCreaseFrontShadowStyles,
  safeCreaseShadowStyle,
} from '@/plugins/paged-reader-safe-curl-primitives'

function sheet() {
  return {
    pageBoundsReady: true,
    pageBounds: {top: 100, width: 500, height: 800},
    geometry: {
      seamTop: 85,
      seamBottom: 15,
      backPolygon: [
        {x: 85, y: 0},
        {x: 45, y: 0},
        {x: 10, y: 100},
        {x: 15, y: 100},
      ],
    },
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
    expect(parseFloat(style.width)).toBeCloseTo(40)
    expect(parseFloat(style.height)).toBeGreaterThan(800)
    expect(style.transform).toMatch(/^matrix\(/)
    expect(style.background).toContain('rgba(0, 0, 0, 0.34)')
  })

  it('keeps the crease highlight on the same bounded geometry', () => {
    const shadow = safeCreaseShadowStyle(sheet(), 0.5)
    const edge = safeCreaseEdgeStyle(sheet(), 0.5)

    expect(edge.transform).toBe(shadow.transform)
    expect(edge.height).toBe(shadow.height)
    expect(parseFloat(edge.width)).toBeCloseTo(2.25)
    expect(edge.opacity).toBe('1')
  })

  it('paints a softer bounded shadow outward from the folded free edge', () => {
    const under = safeCreaseShadowStyle(sheet(), 0.5)
    const front = safeCreaseFrontShadowStyle(sheet(), 0.5)
    const underMatrix = under.transform.match(/matrix\(([^)]+)\)/)![1].split(', ').map(Number)
    const frontMatrix = front.transform.match(/matrix\(([^)]+)\)/)![1].split(', ').map(Number)

    expect(frontMatrix[0]).toBeLessThan(0)
    expect(Math.abs(frontMatrix[4] - sheet().paperX(45))).toBeLessThan(parseFloat(front.width))
    expect(frontMatrix[4]).not.toBeCloseTo(underMatrix[4])
    expect(parseFloat(front.width)).toBeLessThan(parseFloat(under.width))
    expect(front.background).toContain('rgba(0, 0, 0, 0.22)')
  })

  it('wraps the front shadow around every exposed flap edge', () => {
    const styles = safeCreaseFrontShadowStyles(sheet(), 0.5)

    expect(styles).toHaveLength(3)
    styles.forEach(style => {
      expect(style.opacity).toBe('1')
      expect(style.transform).toMatch(/^matrix\(/)
      expect(style.borderRadius).not.toBe('0')
    })
  })

  it('does not create a drawable layer at curl endpoints', () => {
    expect(safeCreaseShadowStyle(sheet(), 0)).toEqual({opacity: '0'})
    expect(safeCreaseFrontShadowStyle(sheet(), 0)).toEqual({opacity: '0'})
    expect(safeCreaseEdgeStyle(sheet(), 1)).toEqual({opacity: '0'})
  })
})
