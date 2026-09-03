import {
  pageCurlRotation,
  pageCurlVariantForStart,
  paperCurlDynamicGeometry,
  paperCurlReflectionMatrix,
  transitionProgress,
} from '@/functions/paged-reader-transition'

function applyMatrix(
  matrix: ReturnType<typeof paperCurlReflectionMatrix>,
  x: number,
  y: number,
): {x: number; y: number} {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  }
}

describe('paged reader transitions', () => {
  test('transition progress follows finger distance and clamps', () => {
    expect(transitionProgress(0, 1000)).toBe(0)
    expect(transitionProgress(400, 1000)).toBe(0.4)
    expect(transitionProgress(-400, 1000)).toBe(0.4)
    expect(transitionProgress(1400, 1000)).toBe(1)
  })

  test('page curl selects top, middle, and bottom screen bands', () => {
    expect(pageCurlVariantForStart(100, 1000)).toBe('top')
    expect(pageCurlVariantForStart(250, 1000)).toBe('middle')
    expect(pageCurlVariantForStart(500, 1000)).toBe('middle')
    expect(pageCurlVariantForStart(750, 1000)).toBe('middle')
    expect(pageCurlVariantForStart(900, 1000)).toBe('bottom')
  })

  test('rigid page flip keeps the projected free edge aligned with travel', () => {
    expect(pageCurlRotation(0.5, -1)).toBeCloseTo(-60)
    expect(pageCurlRotation(0.5, 1)).toBeCloseTo(60)
    expect(pageCurlRotation(2, 1)).toBeCloseTo(90)
  })

  test('reflection matrix mirrors content across a vertical fold', () => {
    const matrix = paperCurlReflectionMatrix({x: 50, y: 0}, {x: 50, y: 100})

    expect(applyMatrix(matrix, 75, 20)).toEqual({x: 25, y: 20})
    expect(applyMatrix(matrix, 50, 60)).toEqual({x: 50, y: 60})
  })

  test('reflection matrix mirrors content across a diagonal fold', () => {
    const matrix = paperCurlReflectionMatrix({x: 0, y: 0}, {x: 100, y: 100})
    const reflected = applyMatrix(matrix, 80, 20)

    expect(reflected.x).toBeCloseTo(20)
    expect(reflected.y).toBeCloseTo(80)
  })

  test('degenerate reflection line leaves content unchanged', () => {
    const matrix = paperCurlReflectionMatrix({x: 10, y: 20}, {x: 10, y: 20})

    expect(applyMatrix(matrix, 70, 30)).toEqual({x: 70, y: 30})
  })

  test('middle automated paper curl keeps a vertical fold line', () => {
    const fold = paperCurlDynamicGeometry(0.5, 0.5, 0.5, -1)

    expect(fold.seamTop).toBeCloseTo(50)
    expect(fold.seamBottom).toBeCloseTo(50)
    expect(fold.shadowTop).toBeCloseTo(58)
    expect(fold.shadowBottom).toBeCloseTo(58)
  })

  test('middle curl reflects the free half across the crease', () => {
    const fold = paperCurlDynamicGeometry(0.5, 0.5, 0.5, -1)

    expect(fold.backPolygon).toEqual([
      {x: 50, y: 0},
      {x: 0, y: 0},
      {x: 0, y: 100},
      {x: 50, y: 100},
    ])
  })

  test('live vertical finger movement continuously tilts the fold line', () => {
    const fold = paperCurlDynamicGeometry(0.5, 0.1, 0.35, -1)

    expect(fold.seamTop).toBeCloseTo(32.5)
    expect(fold.seamBottom).toBeCloseTo(82.5)
    expect(fold.seamBottom - fold.seamTop).toBeCloseTo(50)
  })

  test('viewport aspect ratio participates in physical curl angle', () => {
    const square = paperCurlDynamicGeometry(0.5, 0.1, 0.35, -1, 1)
    const portrait = paperCurlDynamicGeometry(0.5, 0.1, 0.35, -1, 2)

    expect(square.seamTop).not.toBeCloseTo(portrait.seamTop)
    expect(square.seamBottom).not.toBeCloseTo(portrait.seamBottom)
  })

  test('opposite vertical movement mirrors the corner direction', () => {
    const down = paperCurlDynamicGeometry(0.5, 0.1, 0.35, -1)
    const up = paperCurlDynamicGeometry(0.5, 0.9, 0.65, -1)

    expect(down.seamTop).toBeLessThan(down.seamBottom)
    expect(up.seamTop).toBeGreaterThan(up.seamBottom)
  })

  test('paper curl geometry mirrors cleanly with physical direction', () => {
    const left = paperCurlDynamicGeometry(0.5, 0.1, 0.35, -1)
    const right = paperCurlDynamicGeometry(0.5, 0.1, 0.35, 1)

    expect(left.seamTop).toBeCloseTo(100 - right.seamTop)
    expect(left.seamBottom).toBeCloseTo(100 - right.seamBottom)
    expect(left.shadowTop).toBeGreaterThan(left.seamTop)
    expect(right.shadowTop).toBeLessThan(right.seamTop)
  })

  test('extreme corner drag saturates when the crease reaches the spine', () => {
    const extreme = paperCurlDynamicGeometry(0.5, 0.1, 0.95, -1)
    const farther = paperCurlDynamicGeometry(0.5, 0.1, 1, -1)

    expect(extreme.seamTop).toBeCloseTo(0, 5)
    expect(farther.seamTop).toBeCloseTo(0, 5)
    expect(farther.seamBottom).toBeCloseTo(extreme.seamBottom, 4)

    // Once the top crease endpoint has reached the bound corner, pushing the
    // finger farther vertically cannot rotate the fold through the spine.
    extreme.backPolygon.forEach(point => {
      expect(Number.isFinite(point.x)).toBe(true)
      expect(Number.isFinite(point.y)).toBe(true)
    })
  })

  test('constrained reflected flap remains on the folded side of the crease', () => {
    const fold = paperCurlDynamicGeometry(0.5, 0.1, 1, -1)
    const dx = fold.seamBottom - fold.seamTop

    fold.backPolygon.forEach(point => {
      // Cross product against the top->bottom crease vector. For a leftward
      // turn the reflected flap must stay on the non-negative/folded side.
      const side = dx * point.y - 100 * (point.x - fold.seamTop)
      expect(side).toBeGreaterThanOrEqual(-0.001)
    })
  })

  test('near-complete curl extends one full page through the spine', () => {
    const leftward = paperCurlDynamicGeometry(0.9998, 0.5, 0.5, -1)
    const rightward = paperCurlDynamicGeometry(0.9998, 0.5, 0.5, 1)

    expect(Math.min(...leftward.backPolygon.map(point => point.x))).toBeLessThan(-99.9)
    expect(Math.max(...rightward.backPolygon.map(point => point.x))).toBeGreaterThan(199.9)
  })

  test('dynamic fold collapses exactly at both settled endpoints', () => {
    const start = paperCurlDynamicGeometry(0, 0.1, 0.9, -1)
    const end = paperCurlDynamicGeometry(1, 0.1, 0.9, -1)

    expect(start).toEqual({
      seamTop: 100,
      seamBottom: 100,
      shadowTop: 100,
      shadowBottom: 100,
      backPolygon: [
        {x: 100, y: 0},
        {x: 100, y: 0},
        {x: 100, y: 100},
        {x: 100, y: 100},
      ],
    })
    expect(end).toEqual({
      seamTop: 0,
      seamBottom: 0,
      shadowTop: 0,
      shadowBottom: 0,
      backPolygon: [
        {x: 0, y: 0},
        {x: 0, y: 0},
        {x: 0, y: 100},
        {x: 0, y: 100},
      ],
    })
  })
})