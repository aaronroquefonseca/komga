import {
  dragOffsetWithResistance,
  navigationDeltaForDrag,
  shouldCommitDrag,
} from '@/functions/paged-reader-drag'

describe('navigationDeltaForDrag', () => {
  test('maps horizontal drags for left-to-right reading', () => {
    expect(navigationDeltaForDrag(-100, false, false)).toEqual(1)
    expect(navigationDeltaForDrag(100, false, false)).toEqual(-1)
  })

  test('maps horizontal drags for right-to-left reading', () => {
    expect(navigationDeltaForDrag(-100, false, true)).toEqual(-1)
    expect(navigationDeltaForDrag(100, false, true)).toEqual(1)
  })

  test('maps vertical drags independent of horizontal reading direction', () => {
    expect(navigationDeltaForDrag(-100, true, false)).toEqual(1)
    expect(navigationDeltaForDrag(100, true, true)).toEqual(-1)
  })
})

describe('dragOffsetWithResistance', () => {
  test('tracks the finger directly when a target spread exists', () => {
    expect(dragOffsetWithResistance(-400, 1000, true)).toEqual(-400)
  })

  test('adds resistance at book boundaries', () => {
    expect(dragOffsetWithResistance(400, 1000, false)).toEqual(100)
  })

  test('clamps movement to the viewport size', () => {
    expect(dragOffsetWithResistance(-1500, 1000, true)).toEqual(-1000)
  })
})

describe('shouldCommitDrag', () => {
  test('commits after enough distance', () => {
    expect(shouldCommitDrag(400, 1000, 0)).toBe(true)
  })

  test('snaps back for a short slow drag', () => {
    expect(shouldCommitDrag(100, 1000, 0.1)).toBe(false)
  })

  test('commits a fast fling in the same direction', () => {
    expect(shouldCommitDrag(-80, 1000, -0.7)).toBe(true)
  })

  test('does not commit from velocity opposite to the current drag', () => {
    expect(shouldCommitDrag(-80, 1000, 0.7)).toBe(false)
  })
})
