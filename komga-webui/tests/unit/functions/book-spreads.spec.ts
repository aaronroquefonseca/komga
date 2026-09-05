import {buildSpreads} from '@/functions/book-spreads'
import {PagedReaderLayout} from '@/types/enum-reader'
import {PageDtoWithUrl} from '@/types/komga-books'

const portrait = (number: number) => ({number, width: 700, height: 1000} as PageDtoWithUrl)
const wide = (number: number) => ({number, width: 1400, height: 1000} as PageDtoWithUrl)
const numbers = (spreads: PageDtoWithUrl[][]) => spreads.map(spread => spread.map(page => page.number))

describe('Single Page', () => {
  const pageLayout = PagedReaderLayout.SINGLE_PAGE

  test('given no pages then it should return no spreads', () => {
    const pages = [] as PageDtoWithUrl[]

    const spreads = buildSpreads(pages, pageLayout)

    expect(spreads.length).toEqual(0)
  })

  test('given single page then it should return single spread with single page', () => {
    const pages = [
      {
        number: 1,
      } as PageDtoWithUrl,
    ] as PageDtoWithUrl[]

    const spreads = buildSpreads(pages, pageLayout)

    expect(spreads.length).toEqual(1)
    expect(spreads[0].length).toEqual(1)
    expect(spreads[0][0].number).toEqual(1)
  })
})

describe('Double Pages', () => {
  const pageLayout = PagedReaderLayout.DOUBLE_PAGES

  test('given no pages then it should return no spreads', () => {
    const pages = [] as PageDtoWithUrl[]

    const spreads = buildSpreads(pages, pageLayout)

    expect(spreads.length).toEqual(0)
  })

  test('given single page then it should return single spread with single page', () => {
    const pages = [
      {
        number: 1,
      } as PageDtoWithUrl,
    ] as PageDtoWithUrl[]

    const spreads = buildSpreads(pages, pageLayout)

    expect(spreads.length).toEqual(1)
    expect(spreads[0].length).toEqual(2)
    expect(spreads[0][1].number).toEqual(1)
    expect(spreads[0][0].number).toEqual(0) // empty page
  })

  test('given even pages then it should return correct spreads', () => {
    const pages = [
      {number: 1} as PageDtoWithUrl,
      {number: 2} as PageDtoWithUrl,
      {number: 3} as PageDtoWithUrl,
      {number: 4} as PageDtoWithUrl,
      {number: 5} as PageDtoWithUrl,
      {number: 6} as PageDtoWithUrl,
    ] as PageDtoWithUrl[]

    const spreads = buildSpreads(pages, pageLayout)

    expect(spreads.length).toEqual(4)

    expect(spreads[0].length).toEqual(2)
    expect(spreads[0][1].number).toEqual(1)
    expect(spreads[0][0].number).toEqual(0)  // empty page

    expect(spreads[1].length).toEqual(2)
    expect(spreads[1][0].number).toEqual(2)
    expect(spreads[1][1].number).toEqual(3)

    expect(spreads[2].length).toEqual(2)
    expect(spreads[2][0].number).toEqual(4)
    expect(spreads[2][1].number).toEqual(5)

    expect(spreads[3].length).toEqual(2)
    expect(spreads[3][0].number).toEqual(6)
    expect(spreads[3][1].number).toEqual(0) // empty page
  })

  test('given odd pages then it should return correct spreads', () => {
    const pages = [
      {number: 1} as PageDtoWithUrl,
      {number: 2} as PageDtoWithUrl,
      {number: 3} as PageDtoWithUrl,
      {number: 4} as PageDtoWithUrl,
      {number: 5} as PageDtoWithUrl,
    ] as PageDtoWithUrl[]

    const spreads = buildSpreads(pages, pageLayout)

    expect(spreads.length).toEqual(4)

    expect(spreads[0].length).toEqual(2)
    expect(spreads[0][1].number).toEqual(1)
    expect(spreads[0][0].number).toEqual(0) // empty page

    expect(spreads[1].length).toEqual(2)
    expect(spreads[1][0].number).toEqual(2)
    expect(spreads[1][1].number).toEqual(3)

    expect(spreads[2].length).toEqual(2)
    expect(spreads[2][0].number).toEqual(4)

    expect(spreads[3].length).toEqual(2)
    expect(spreads[3][0].number).toEqual(5)
    expect(spreads[3][1].number).toEqual(0) // empty page
  })

  test('keeps an aligned first wide page free of synthetic blanks', () => {
    const spreads = buildSpreads([
      portrait(1), wide(2), portrait(3), portrait(4), portrait(5),
    ], pageLayout)

    expect(numbers(spreads)).toEqual([[0, 1], [2], [3, 4], [5, 0]])
  })

  test('moves a misaligned first wide correction inside the cover', () => {
    const spreads = buildSpreads([
      portrait(1), portrait(2), wide(3), portrait(4), portrait(5), portrait(6),
    ], pageLayout)

    expect(numbers(spreads)).toEqual([[0, 1], [0, 2], [3], [4, 5], [6, 0]])
  })

  test('adds only one leading blank for a later misaligned wide page', () => {
    const spreads = buildSpreads([
      portrait(1), wide(2), portrait(3), wide(4), portrait(5), portrait(6), portrait(7),
    ], pageLayout)

    expect(numbers(spreads)).toEqual([[0, 1], [2], [3, 0], [4], [5, 6], [7, 0]])
  })
})

describe('Double Pages No Cover', () => {
  const pageLayout = PagedReaderLayout.DOUBLE_NO_COVER

  test('given no pages then it should return no spreads', () => {
    const pages = [] as PageDtoWithUrl[]

    const spreads = buildSpreads(pages, pageLayout)

    expect(spreads.length).toEqual(0)
  })

  test('given single page then it should return single spread with single page', () => {
    const pages = [
      {
        number: 1,
      } as PageDtoWithUrl,
    ] as PageDtoWithUrl[]

    const spreads = buildSpreads(pages, pageLayout)

    expect(spreads.length).toEqual(1)
    expect(spreads[0].length).toEqual(2)
    expect(spreads[0][0].number).toEqual(1)
    expect(spreads[0][1].number).toEqual(0) // empty page
  })

  test('places the first wide correction after page one without a cover', () => {
    const spreads = buildSpreads([
      portrait(1), wide(2), portrait(3),
    ], pageLayout)

    expect(numbers(spreads)).toEqual([[1, 0], [2], [3, 0]])
  })
})
