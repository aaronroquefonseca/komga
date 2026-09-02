import {
  physicalSinglePageEdgePlan,
  physicalSinglePageFacesForSpread,
} from '@/functions/paged-reader-physical'
import {PageDtoWithUrl} from '@/types/komga-books'

function portrait(number: number): PageDtoWithUrl {
  return {
    number,
    url: `page-${number}`,
    width: 1000,
    height: 1500,
  } as PageDtoWithUrl
}

function wide(number: number): PageDtoWithUrl {
  return {
    number,
    url: `page-${number}`,
    width: 2000,
    height: 1500,
  } as PageDtoWithUrl
}

const spreads = (...pages: PageDtoWithUrl[]): PageDtoWithUrl[][] => pages.map(page => [page])

describe('single-page Physical Comic topology', () => {
  test('a wide source exposes two physical faces with RTL-aware order', () => {
    expect(physicalSinglePageFacesForSpread([wide(2)], false)?.map(face => face.crop))
      .toEqual(['left', 'right'])
    expect(physicalSinglePageFacesForSpread([wide(2)], true)?.map(face => face.crop))
      .toEqual(['right', 'left'])
  })

  test('ordinary portrait pages retain symmetric curl and slide edges', () => {
    const book = spreads(portrait(1), portrait(2), portrait(3), portrait(4))
    expect(physicalSinglePageEdgePlan(book, 0, 1, false)?.kind).toBe('curl')
    expect(physicalSinglePageEdgePlan(book, 1, 0, false)?.kind).toBe('curl')
    expect(physicalSinglePageEdgePlan(book, 1, 2, false)?.kind).toBe('slide')
    expect(physicalSinglePageEdgePlan(book, 2, 1, false)?.kind).toBe('slide')
    expect(physicalSinglePageEdgePlan(book, 2, 3, false)?.kind).toBe('curl')
    expect(physicalSinglePageEdgePlan(book, 3, 2, false)?.kind).toBe('curl')
  })

  test('aligned portrait-wide edges are direct curls from either side and direction', () => {
    const book = spreads(portrait(1), wide(2), portrait(3))

    const leftInto = physicalSinglePageEdgePlan(book, 0, 1, false)
    expect(leftInto?.kind).toBe('curl')
    expect(leftInto?.crossesSyntheticBlank).toBe(false)
    expect(leftInto?.front.page.number).toBe(1)
    expect(leftInto?.back.page.number).toBe(2)
    expect(leftInto?.back.crop).toBe('left')
    expect(leftInto?.baseFaces[1]?.crop).toBe('right')

    const leftOut = physicalSinglePageEdgePlan(book, 1, 0, false)
    expect(leftOut?.kind).toBe('curl')
    expect(leftOut?.crossesSyntheticBlank).toBe(false)
    expect(leftOut?.front.crop).toBe('left')
    expect(leftOut?.back.page.number).toBe(1)
    expect(leftOut?.baseFaces[1]?.crop).toBe('right')

    const rightOut = physicalSinglePageEdgePlan(book, 1, 2, false)
    expect(rightOut?.kind).toBe('curl')
    expect(rightOut?.crossesSyntheticBlank).toBe(false)
    expect(rightOut?.front.crop).toBe('right')
    expect(rightOut?.back.page.number).toBe(3)
    expect(rightOut?.baseFaces[0]?.crop).toBe('left')

    const rightInto = physicalSinglePageEdgePlan(book, 2, 1, false)
    expect(rightInto?.kind).toBe('curl')
    expect(rightInto?.crossesSyntheticBlank).toBe(false)
    expect(rightInto?.front.page.number).toBe(3)
    expect(rightInto?.back.crop).toBe('right')
    expect(rightInto?.baseFaces[0]?.crop).toBe('left')
  })

  test('a misaligned wide source gets a synthetic blank before it', () => {
    const book = spreads(portrait(1), portrait(2), wide(3), portrait(4))
    const plan = physicalSinglePageEdgePlan(book, 1, 2, false)

    expect(plan?.kind).toBe('curl')
    expect(plan?.crossesSyntheticBlank).toBe(true)
    expect(plan?.front.page.number).toBe(0)
    expect(plan?.back.page.number).toBe(3)
    expect(plan?.back.crop).toBe('left')
    expect(plan?.baseFaces[0]?.page.number).toBe(2)
    expect(plan?.baseFaces[1]?.crop).toBe('right')
  })

  test('the curl into the portrait before a compensated wide keeps the first blank underneath', () => {
    const book = spreads(portrait(1), portrait(2), wide(3), portrait(4))
    const plan = physicalSinglePageEdgePlan(book, 0, 1, false)

    expect(plan?.kind).toBe('curl')
    expect(plan?.front.page.number).toBe(1)
    expect(plan?.back.page.number).toBe(2)
    expect(plan?.baseFaces[1]?.page.number).toBe(0)
  })

  test('the blank-before compensated edge is symmetric backwards', () => {
    const book = spreads(portrait(1), portrait(2), wide(3), portrait(4))
    const plan = physicalSinglePageEdgePlan(book, 2, 1, false)

    expect(plan?.kind).toBe('curl')
    expect(plan?.crossesSyntheticBlank).toBe(true)
    expect(plan?.front.page.number).toBe(3)
    expect(plan?.front.crop).toBe('left')
    expect(plan?.back.page.number).toBe(0)
    expect(plan?.baseFaces[0]?.page.number).toBe(2)
    expect(plan?.baseFaces[1]?.crop).toBe('right')
  })

  test('a compensated wide curls into its trailing blank before sliding to the next portrait', () => {
    const book = spreads(portrait(1), portrait(2), wide(3), portrait(4))

    const afterWide = physicalSinglePageEdgePlan(book, 2, 3, false)
    const backIntoWideFromAfter = physicalSinglePageEdgePlan(book, 3, 2, false)

    expect(afterWide?.kind).toBe('curl')
    expect(afterWide?.crossesSyntheticBlank).toBe(true)
    expect(afterWide?.front.page.number).toBe(3)
    expect(afterWide?.front.crop).toBe('right')
    expect(afterWide?.back.page.number).toBe(0)
    expect(afterWide?.baseFaces[0]?.page.number).toBe(3)
    expect(afterWide?.baseFaces[0]?.crop).toBe('left')
    expect(afterWide?.baseFaces[1]?.page.number).toBe(4)

    expect(backIntoWideFromAfter?.kind).toBe('curl')
    expect(backIntoWideFromAfter?.crossesSyntheticBlank).toBe(true)
    expect(backIntoWideFromAfter?.front.page.number).toBe(0)
    expect(backIntoWideFromAfter?.back.page.number).toBe(3)
    expect(backIntoWideFromAfter?.back.crop).toBe('right')
    expect(backIntoWideFromAfter?.baseFaces[0]?.crop).toBe('left')
    expect(backIntoWideFromAfter?.baseFaces[1]?.page.number).toBe(4)
  })

  test('the blank after a compensated wide restores the later page parity', () => {
    const book = spreads(portrait(1), portrait(2), wide(3), portrait(4), portrait(5))

    expect(physicalSinglePageEdgePlan(book, 3, 4, false)?.kind).toBe('curl')
    expect(physicalSinglePageEdgePlan(book, 4, 3, false)?.kind).toBe('curl')
  })

  test('wide-wide transitions keep both stationary and turning virtual halves', () => {
    const book = spreads(portrait(1), wide(2), wide(3), portrait(4))
    const forward = physicalSinglePageEdgePlan(book, 1, 2, false)
    const backward = physicalSinglePageEdgePlan(book, 2, 1, false)

    expect(forward?.kind).toBe('curl')
    expect(forward?.currentWide).toBe(true)
    expect(forward?.targetWide).toBe(true)
    expect(forward?.front.crop).toBe('right')
    expect(forward?.back.crop).toBe('left')
    expect(forward?.baseFaces[0]?.crop).toBe('left')
    expect(forward?.baseFaces[1]?.crop).toBe('right')

    expect(backward?.kind).toBe('curl')
    expect(backward?.currentWide).toBe(true)
    expect(backward?.targetWide).toBe(true)
    expect(backward?.front.crop).toBe('left')
    expect(backward?.back.crop).toBe('right')
    expect(backward?.baseFaces[0]?.crop).toBe('left')
    expect(backward?.baseFaces[1]?.crop).toBe('right')
  })

  test('RTL uses the right half as the first wide face without changing leaf parity', () => {
    const book = spreads(portrait(1), wide(2), portrait(3))
    const forward = physicalSinglePageEdgePlan(book, 0, 1, true)
    const backward = physicalSinglePageEdgePlan(book, 1, 0, true)

    expect(forward?.kind).toBe('curl')
    expect(forward?.crossesSyntheticBlank).toBe(false)
    expect(forward?.back.crop).toBe('right')
    expect(backward?.front.crop).toBe('right')
    expect(backward?.back.page.number).toBe(1)
  })
})