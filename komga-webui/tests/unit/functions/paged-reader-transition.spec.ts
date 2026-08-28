import {
  pageCurlRotation,
  pageCurlVariantForStart,
  paperCurlDynamicGeometry,
  transitionProgress,
} from '@/functions/paged-reader-transition'

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
