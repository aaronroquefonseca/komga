import { describe, expect, it, vi } from 'vitest'
import { CATALOG_PAGE_SIZE, syncCatalogPages } from './catalog-sync'

describe('catalog synchronization', () => {
  it('saves every page using bounded requests, including a server-capped page size', async () => {
    const fetchPage = vi.fn((page: number, size: number) => {
      expect(size).toBe(CATALOG_PAGE_SIZE)
      return Promise.resolve({
        content: [page * 2, page * 2 + 1],
        totalElements: 6,
        last: page === 2,
      })
    })
    const save = vi.fn(() => Promise.resolve())
    const progress = vi.fn()
    expect(await syncCatalogPages(fetchPage, save, progress)).toEqual([0, 1, 2, 3, 4, 5])
    expect(fetchPage).toHaveBeenCalledTimes(3)
    expect(progress).toHaveBeenLastCalledWith(6, 6)
  })
  it('propagates a later-page failure while retaining previously saved pages', async () => {
    const save = vi.fn(() => Promise.resolve())
    await expect(
      syncCatalogPages(
        (page) => {
          if (page === 1) return Promise.reject(new Error('Server interrupted'))
          return Promise.resolve({ content: ['saved'], last: false })
        },
        save,
        () => {},
      ),
    ).rejects.toThrow('Server interrupted')
    expect(save).toHaveBeenCalledExactlyOnceWith(['saved'])
  })
  it('does not mark an empty, nonterminal response as a complete catalog', async () => {
    await expect(
      syncCatalogPages(
        () => Promise.resolve({ content: [], last: false }),
        () => Promise.resolve(),
        () => {},
      ),
    ).rejects.toThrow('incomplete')
  })
})
