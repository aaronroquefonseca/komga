import { afterEach, describe, expect, it, vi } from 'vitest'
import { catalogDelta, fetchCatalogEntries, fetchCatalogManifest } from './catalog-sync'

afterEach(() => vi.unstubAllGlobals())

describe('catalog delta', () => {
  it('fetches only new, changed, or locally missing entries and removes deleted entries', () => {
    expect(
      catalogDelta(
        { a: '1', b: '1', missing: '1', removed: '1' },
        { a: '1', b: '2', missing: '1', added: '1' },
        ['a', 'b', 'removed'],
      ),
    ).toEqual({ changed: ['b', 'missing', 'added'], deleted: ['removed'] })
    expect(catalogDelta({ a: '1' }, { a: '1' }, ['a'])).toEqual({ changed: [], deleted: [] })
  })

  it('reuses a persisted index after HTTP 304', async () => {
    const previous = { etag: '"revision"', books: { a: '1' }, series: {} }
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 304 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchCatalogManifest(previous)).toEqual(previous)
    expect(fetchMock.mock.calls[0]?.[1].headers['If-None-Match']).toBe(previous.etag)
  })

  it('fetches changed entries in bounded batches', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `${i}`)
    const fetchMock = vi.fn((_url, init: RequestInit) =>
      Promise.resolve(
        Response.json((JSON.parse(init.body as string) as string[]).map((id) => ({ id }))),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const save = vi.fn(() => Promise.resolve())
    const progress = vi.fn()
    await fetchCatalogEntries('books', ids, save, progress)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(save.mock.calls.map((call) => (call as unknown[][])[0]?.length)).toEqual([200, 1])
    expect(progress).toHaveBeenLastCalledWith(201, 201)
  })

  it('rejects an incomplete batch without saving it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([{ id: 'a' }])))
    const save = vi.fn(() => Promise.resolve())
    await expect(fetchCatalogEntries('books', ['a', 'b'], save, () => {})).rejects.toThrow(
      'changed during sync',
    )
    expect(save).not.toHaveBeenCalled()
  })
})
