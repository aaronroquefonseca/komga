import {
  pageCurlRotation,
  pageCurlVariantForStart,
  paperCurlSegmentPhase,
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
})
