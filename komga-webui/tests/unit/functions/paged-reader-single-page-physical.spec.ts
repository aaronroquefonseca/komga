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

  test('an already aligned first wide source does not add an inside-cover blank', () => {
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

  test('a misaligned first wide source moves its correction to the inside of the cover', () => {
    const book = spreads(portrait(1), portrait(2), wide(3), portrait(4))

    const openCover = physicalSinglePageEdgePlan(book, 0, 1, false)
    expect(openCover?.kind).toBe('curl')
    expect(openCover?.crossesSyntheticBlank).toBe(true)
    expect(openCover?.front.page.number).toBe(1)
    expect(openCover?.back.page.number).toBe(0)
    expect(openCover?.baseFaces[1]?.page.number).toBe(2)

    const closeCover = physicalSinglePageEdgePlan(book, 1, 0, false)
    expect(closeCover?.kind).toBe('curl')
    expect(closeCover?.crossesSyntheticBlank).toBe(true)
    expect(closeCover?.front.page.number).toBe(0)
    expect(closeCover?.back.page.number).toBe(1)
    expect(closeCover?.baseFaces[1]?.page.number).toBe(2)

    // Once the inside-cover blank has shifted the book, the first wide source is
    // directly aligned and does not need another blank immediately before it.
    const intoWide = physicalSinglePageEdgePlan(book, 1, 2, false)
    expect(intoWide?.kind).toBe('curl')
    expect(intoWide?.crossesSyntheticBlank).toBe(false)
    expect(intoWide?.front.page.number).toBe(2)
    expect(intoWide?.back.page.number).toBe(3)
    expect(intoWide?.back.crop).toBe('left')
    expect(intoWide?.baseFaces[0]?.page.number).toBe(0)
    expect(intoWide?.baseFaces[1]?.crop).toBe('right')
  })

  test('a later misaligned wide source gets one leading blank in both directions', () => {
    const book = spreads(
      portrait(1),
      wide(2),
      portrait(3),
      wide(4),
      portrait(5),
      portrait(6),
    )

    const intoWide = physicalSinglePageEdgePlan(book, 2, 3, false)
    expect(intoWide?.kind).toBe('curl')
    expect(intoWide?.crossesSyntheticBlank).toBe(true)
    expect(intoWide?.front.page.number).toBe(0)
    expect(intoWide?.back.page.number).toBe(4)
    expect(intoWide?.back.crop).toBe('left')
    expect(intoWide?.baseFaces[0]?.page.number).toBe(3)
    expect(intoWide?.baseFaces[1]?.crop).toBe('right')

    const outBackward = physicalSinglePageEdgePlan(book, 3, 2, false)
    expect(outBackward?.kind).toBe('curl')
    expect(outBackward?.crossesSyntheticBlank).toBe(true)
    expect(outBackward?.front.page.number).toBe(4)
    expect(outBackward?.front.crop).toBe('left')
    expect(outBackward?.back.page.number).toBe(0)
    expect(outBackward?.baseFaces[0]?.page.number).toBe(3)
    expect(outBackward?.baseFaces[1]?.crop).toBe('right')
  })

  test('a corrective blank is not followed by a parity-restoring blank', () => {
    const book = spreads(
      portrait(1),
      wide(2),
      portrait(3),
      wide(4),
      portrait(5),
      portrait(6),
    )

    const afterWide = physicalSinglePageEdgePlan(book, 3, 4, false)
    expect(afterWide?.kind).toBe('curl')
    expect(afterWide?.crossesSyntheticBlank).toBe(false)
    expect(afterWide?.front.page.number).toBe(4)
    expect(afterWide?.front.crop).toBe('right')
    expect(afterWide?.back.page.number).toBe(5)
    expect(afterWide?.baseFaces[0]?.crop).toBe('left')
    expect(afterWide?.baseFaces[1]?.page.number).toBe(6)

    // The single blank before wide(4) permanently changed parity. With the old
    // before+after pair this edge was a curl; now it correctly remains a slide.
    expect(physicalSinglePageEdgePlan(book, 4, 5, false)?.kind).toBe('slide')
    expect(physicalSinglePageEdgePlan(book, 5, 4, false)?.kind).toBe('slide')
  })

  test('later wide sources use the accumulated parity after previous corrections', () => {
    const book = spreads(
      portrait(1),
      wide(2),
      portrait(3),
      wide(4),
      portrait(5),
      wide(6),
      portrait(7),
    )

    // wide(4) required a leading blank, permanently shifting the sequence. One
    // portrait later wide(6) is misaligned again, so it receives one new leading
    // blank based on the accumulated physical parity.
    const intoSecondCorrectedWide = physicalSinglePageEdgePlan(book, 4, 5, false)
    expect(intoSecondCorrectedWide?.crossesSyntheticBlank).toBe(true)
    expect(intoSecondCorrectedWide?.front.page.number).toBe(0)
    expect(intoSecondCorrectedWide?.back.page.number).toBe(6)
    expect(intoSecondCorrectedWide?.back.crop).toBe('left')
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

  test('large books reuse compiled edge plans across hot-path lookups', () => {
    const book: PageDtoWithUrl[][] = Array.from({length: 320}, (_, index) => [portrait(index + 1)])

    const forward = physicalSinglePageEdgePlan(book, 150, 151, false)
    expect(physicalSinglePageEdgePlan(book, 150, 151, false)).toBe(forward)

    const backward = physicalSinglePageEdgePlan(book, 151, 150, false)
    expect(physicalSinglePageEdgePlan(book, 151, 150, false)).toBe(backward)
    expect(backward).not.toBe(forward)
  })
})