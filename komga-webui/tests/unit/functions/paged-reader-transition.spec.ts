import {
  pageCurlRotation,
  pageCurlVariantForStart,
  paperCurlSegmentPhase,
  paperCurlTilePhase,
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

  test('paper curl fold front reaches outer strips before spine strips', () => {
    expect(paperCurlSegmentPhase(0, 0)).toBe(0)
    expect(paperCurlSegmentPhase(0.25, 0.05)).toBeGreaterThan(0.9)
    expect(paperCurlSegmentPhase(0.25, 0.8)).toBe(0)
    expect(paperCurlSegmentPhase(1, 0.95)).toBe(1)
  })

  test('middle paper curl propagates from free edge toward spine', () => {
    expect(paperCurlTilePhase(0.2, 0, 0.5, 'middle')).toBeGreaterThan(0)
    expect(paperCurlTilePhase(0.2, 0.8, 0.5, 'middle')).toBe(0)
    expect(paperCurlTilePhase(1, 1, 0.5, 'middle')).toBe(1)
  })

  test('top and bottom paper curl strongly favor the touched corner', () => {
    const progress = 0.35
    const topNear = paperCurlTilePhase(progress, 0, 0.05, 'top')
    const topFar = paperCurlTilePhase(progress, 0, 0.95, 'top')
    const bottomNear = paperCurlTilePhase(progress, 0, 0.95, 'bottom')
    const bottomFar = paperCurlTilePhase(progress, 0, 0.05, 'bottom')

    expect(topNear).toBeGreaterThan(0.3)
    expect(topFar).toBe(0)
    expect(bottomNear).toBeGreaterThan(0.3)
    expect(bottomFar).toBe(0)
  })
})
