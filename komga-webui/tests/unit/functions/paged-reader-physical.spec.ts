import {
  canUseDoublePageLeaf,
  doublePageLeafPlan,
  physicalComicTransitionKind,
  physicalComicUnderSpreadIndex,
} from '@/functions/paged-reader-physical'
import {PagedReaderLayout} from '@/types/enum-reader'
import {PageDtoWithUrl} from '@/types/komga-books'

const spread = (...numbers: number[]): PageDtoWithUrl[] => numbers.map(number => ({
  number,
  url: `page-${number}`,
} as PageDtoWithUrl))

describe('physical comic reader transitions', () => {
  test('single-page mode opens the cover with a curl', () => {
    expect(physicalComicTransitionKind(
      PagedReaderLayout.SINGLE_PAGE,
      spread(1),
      spread(2),
      false,
    )).toBe('curl')
  })

  test('single-page mode alternates slide and curl across physical sheets', () => {
    expect(physicalComicTransitionKind(
      PagedReaderLayout.SINGLE_PAGE,
      spread(2),
      spread(3),
      false,
    )).toBe('slide')
    expect(physicalComicTransitionKind(
      PagedReaderLayout.SINGLE_PAGE,
      spread(3),
      spread(4),
      false,
    )).toBe('curl')
    expect(physicalComicTransitionKind(
      PagedReaderLayout.SINGLE_PAGE,
      spread(4),
      spread(5),
      false,
    )).toBe('slide')
  })

  test('single-page classification is symmetric when reading backwards', () => {
    expect(physicalComicTransitionKind(
      PagedReaderLayout.SINGLE_PAGE,
      spread(4),
      spread(3),
      false,
    )).toBe('curl')
    expect(physicalComicTransitionKind(
      PagedReaderLayout.SINGLE_PAGE,
      spread(3),
      spread(2),
      false,
    )).toBe('slide')
  })

  test('both double-page layouts turn physical sheets between spreads', () => {
    expect(physicalComicTransitionKind(
      PagedReaderLayout.DOUBLE_PAGES,
      spread(2, 3),
      spread(4, 5),
      false,
    )).toBe('curl')
    expect(physicalComicTransitionKind(
      PagedReaderLayout.DOUBLE_NO_COVER,
      spread(1, 2),
      spread(3, 4),
      false,
    )).toBe('curl')
  })

  test('vertical mode falls back to slide', () => {
    expect(physicalComicTransitionKind(
      PagedReaderLayout.SINGLE_PAGE,
      spread(1),
      spread(2),
      true,
    )).toBe('slide')
  })

  test('underlying spread follows one physical step beyond the back face', () => {
    expect(physicalComicUnderSpreadIndex(1, 1, 5)).toBe(2)
    expect(physicalComicUnderSpreadIndex(3, -1, 5)).toBe(2)
    expect(physicalComicUnderSpreadIndex(4, 1, 5)).toBeNull()
    expect(physicalComicUnderSpreadIndex(0, -1, 5)).toBeNull()
  })
})

describe('double-page leaf transitions', () => {
  test('accepts real two-page spreads in both double-page layouts', () => {
    expect(canUseDoublePageLeaf(
      PagedReaderLayout.DOUBLE_PAGES,
      spread(2, 3),
      spread(4, 5),
      false,
    )).toBe(true)
    expect(canUseDoublePageLeaf(
      PagedReaderLayout.DOUBLE_NO_COVER,
      spread(1, 2),
      spread(3, 4),
      false,
    )).toBe(true)
  })

  test('does not force the half-leaf compositor onto landscape or vertical spreads', () => {
    expect(canUseDoublePageLeaf(
      PagedReaderLayout.DOUBLE_PAGES,
      spread(2),
      spread(3, 4),
      false,
    )).toBe(false)
    expect(canUseDoublePageLeaf(
      PagedReaderLayout.DOUBLE_PAGES,
      spread(2, 3),
      spread(4, 5),
      true,
    )).toBe(false)
  })

  test('forward navigation keeps outer stationary pages and turns B into C', () => {
    const plan = doublePageLeafPlan(spread(1, 2), spread(3, 4), 1)
    expect(plan?.front.number).toBe(2)
    expect(plan?.back.number).toBe(3)
    expect(plan?.baseSpread.map(page => page.number)).toEqual([1, 4])
  })

  test('backward navigation reverses the same physical leaf', () => {
    const plan = doublePageLeafPlan(spread(3, 4), spread(1, 2), -1)
    expect(plan?.front.number).toBe(3)
    expect(plan?.back.number).toBe(2)
    expect(plan?.baseSpread.map(page => page.number)).toEqual([1, 4])
  })

  test('cover placeholders remain stationary background while the cover leaf opens', () => {
    const plan = doublePageLeafPlan(spread(0, 1), spread(2, 3), 1)
    expect(plan?.front.number).toBe(1)
    expect(plan?.back.number).toBe(2)
    expect(plan?.baseSpread.map(page => page.number)).toEqual([0, 3])
  })
})
