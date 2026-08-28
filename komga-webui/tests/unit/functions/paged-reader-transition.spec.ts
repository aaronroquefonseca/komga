import {
  pageCurlRotation,
  pageCurlVariantForStart,
  paperCurlFoldGeometry,
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

  test('middle paper curl is one continuous vertical fold', () => {
    const fold = paperCurlFoldGeometry(0.5, -1, 'middle')

    expect(fold.seamTop).toBeCloseTo(50)
    expect(fold.seamBottom).toBeCloseTo(50)
    expect(fold.foldTop).toBeCloseTo(70)
    expect(fold.foldBottom).toBeCloseTo(70)
    expect(fold.shadowTop).toBeCloseTo(61)
    expect(fold.shadowBottom).toBeCloseTo(61)
  })

  test('top and bottom turns exaggerate one continuous diagonal edge', () => {
    const top = paperCurlFoldGeometry(0.5, -1, 'top')
    const bottom = paperCurlFoldGeometry(0.5, -1, 'bottom')

    expect(top.seamTop).toBeLessThan(top.seamBottom - 30)
    expect(bottom.seamBottom).toBeLessThan(bottom.seamTop - 30)
  })

  test('paper fold reverses cleanly with physical direction', () => {
    const left = paperCurlFoldGeometry(0.5, -1, 'top')
    const right = paperCurlFoldGeometry(0.5, 1, 'top')

    expect(left.seamTop).toBeCloseTo(100 - right.seamTop)
    expect(left.seamBottom).toBeCloseTo(100 - right.seamBottom)
    expect(left.foldTop).toBeGreaterThan(left.seamTop)
    expect(right.foldTop).toBeLessThan(right.seamTop)
  })

  test('paper fold collapses exactly at both settled endpoints', () => {
    const start = paperCurlFoldGeometry(0, -1, 'top')
    const end = paperCurlFoldGeometry(1, -1, 'top')

    expect(start).toEqual({
      seamTop: 100,
      seamBottom: 100,
      foldTop: 100,
      foldBottom: 100,
      shadowTop: 100,
      shadowBottom: 100,
    })
    expect(end).toEqual({
      seamTop: 0,
      seamBottom: 0,
      foldTop: 0,
      foldBottom: 0,
      shadowTop: 0,
      shadowBottom: 0,
    })
  })
})
