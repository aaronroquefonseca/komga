import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import type { Router } from 'vue-router'
import {
  getOfflineShellAssets,
  isPrecacheCompleteForBatch,
  KOMGA_OFFLINE_STATUS,
  mergeShellAssets,
  parseShellManifest,
  prepareOfflineShell,
  queryOfflineShellStatus,
  resetOfflineShellStateForTests,
  resolveShellAssetUrls,
  setServiceWorkerOfflineMode,
  setupOfflineShell,
  waitForPrecacheCompletion,
} from '@/services/offline-shell'

const { setShellReadinessMock } = vi.hoisted(() => ({ setShellReadinessMock: vi.fn() }))
vi.mock('@/offline/offline-store', () => ({
  useOfflineLibraryStore: () => ({ setShellReadiness: setShellReadinessMock }),
}))

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  setShellReadinessMock.mockClear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  resetOfflineShellStateForTests()
})

function stubRouter(): { router: Router; afterEach: Mock } {
  const afterEach = vi.fn()
  return { router: { afterEach } as unknown as Router, afterEach }
}

describe('getOfflineShellAssets', () => {
  test('collects scripts and matching link relations only', () => {
    const script = document.createElement('script')
    script.src = 'https://example.com/assets/app.js'
    document.body.appendChild(script)

    const stylesheet = document.createElement('link')
    stylesheet.rel = 'stylesheet'
    stylesheet.href = 'https://example.com/assets/app.css'
    document.head.appendChild(stylesheet)

    const icon = document.createElement('link')
    icon.rel = 'icon'
    icon.href = 'https://example.com/favicon-32x32.png'
    document.head.appendChild(icon)

    const preload = document.createElement('link')
    preload.rel = 'preload'
    preload.href = 'https://example.com/assets/ignored.woff2'
    document.head.appendChild(preload)

    expect(getOfflineShellAssets()).toEqual(
      expect.arrayContaining([
        'https://example.com/assets/app.js',
        'https://example.com/assets/app.css',
        'https://example.com/favicon-32x32.png',
      ]),
    )
    expect(getOfflineShellAssets()).not.toContain('https://example.com/assets/ignored.woff2')
  })

  test('deduplicates repeated assets', () => {
    for (let i = 0; i < 2; i++) {
      const script = document.createElement('script')
      script.src = 'https://example.com/assets/app.js'
      document.body.appendChild(script)
    }

    expect(getOfflineShellAssets()).toEqual(['https://example.com/assets/app.js'])
  })
})

describe('parseShellManifest', () => {
  test('accepts the emitted object shape', () => {
    expect(
      parseShellManifest({
        app: 'nextui',
        version: 1,
        files: [
          { url: 'assets/a.js', size: 1, sha256: 'x' },
          { url: '', size: 0, sha256: 'y' },
        ],
      }),
    ).toEqual(['assets/a.js'])
  })

  test('accepts plain string arrays and bare arrays', () => {
    expect(parseShellManifest({ files: ['a.js', 42, null] })).toEqual(['a.js'])
    expect(parseShellManifest([{ url: 'b.js' }, 'c.js'])).toEqual(['b.js', 'c.js'])
  })

  test('rejects garbage', () => {
    expect(parseShellManifest(null)).toEqual([])
    expect(parseShellManifest('nope')).toEqual([])
    expect(parseShellManifest({})).toEqual([])
    expect(parseShellManifest({ files: 'nope' })).toEqual([])
  })
})

describe('resolveShellAssetUrls', () => {
  const base = 'https://example.com/komga/'

  test('resolves dist-relative urls against the base and drops cross-origin entries', () => {
    expect(
      resolveShellAssetUrls(
        ['assets/a.js', '/komga/b.css', 'https://cdn.example.com/c.js', 'https://', ''],
        base,
      ),
    ).toEqual(['https://example.com/komga/assets/a.js', 'https://example.com/komga/b.css'])
  })
})

describe('mergeShellAssets', () => {
  test('dedupes while preserving first-seen order', () => {
    expect(mergeShellAssets(['a', 'b'], ['b', 'c'], [])).toEqual(['a', 'b', 'c'])
  })
})

describe('service worker messaging without a worker', () => {
  test('no-ops when service workers are unavailable', () => {
    expect('serviceWorker' in navigator).toBe(false)
    expect(() => prepareOfflineShell()).not.toThrow()
    expect(() => setServiceWorkerOfflineMode(true)).not.toThrow()
    expect(() => setupOfflineShell(stubRouter().router)).not.toThrow()
  })

  test('setupOfflineShell wires load, online, and routing triggers', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { ready: Promise.resolve(undefined) },
      configurable: true,
    })
    // Stub the manifest fetch so a triggered preparation cannot outlive this test.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    try {
      const addEventListener = vi.spyOn(window, 'addEventListener')
      const { router, afterEach: afterEachHook } = stubRouter()

      setupOfflineShell(router)

      if (document.readyState !== 'complete') {
        expect(addEventListener).toHaveBeenCalledWith('load', expect.any(Function), { once: true })
      }
      expect(addEventListener).toHaveBeenCalledWith('online', expect.any(Function))
      expect(afterEachHook).toHaveBeenCalledTimes(1)
      // Flush any shell preparation triggered above so it cannot leak into later tests.
      await new Promise((resolve) => setTimeout(resolve, 0))
    } finally {
      // @ts-expect-error happy-dom has no service workers; remove the stub
      delete navigator.serviceWorker
    }
  })
})

describe('prepareOfflineShell precaching', () => {
  let statusReply: Record<string, unknown> = { shellReady: false }
  const prepareMessages = vi.fn()
  const postMessage = vi.fn((message: { type: string }, ports?: MessagePort[]) => {
    if (message.type === KOMGA_OFFLINE_STATUS) ports?.[0]?.postMessage(statusReply)
    else prepareMessages(message)
  })

  beforeEach(() => {
    postMessage.mockClear()
    prepareMessages.mockClear()
    statusReply = { shellReady: false }
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { ready: Promise.resolve({ active: { postMessage } }) },
      configurable: true,
    })
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            app: 'nextui',
            version: 1,
            files: [{ url: 'assets/manifest-chunk.js', size: 10, sha256: 'abc' }],
          }),
      }),
    )
  })

  afterEach(() => {
    // @ts-expect-error happy-dom has no service workers; remove the stub
    delete navigator.serviceWorker
  })

  test('posts merged DOM and manifest assets, then throttles and reuses the manifest', async () => {
    prepareOfflineShell()
    prepareOfflineShell()
    await vi.waitFor(() => expect(prepareMessages).toHaveBeenCalledTimes(1))

    const message = prepareMessages.mock.calls[0]?.[0] as { type: string; assets: string[] }
    expect(message.type).toBe('KOMGA_PREPARE_OFFLINE_SHELL')
    expect(message.assets).toContain(`${window.location.origin}/assets/manifest-chunk.js`)
    expect(fetch).toHaveBeenCalledTimes(2)

    // A later check revalidates both build identities.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000)
    prepareOfflineShell(true)
    await vi.waitFor(() => expect(prepareMessages).toHaveBeenCalledTimes(2))
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  test('falls back to DOM assets when the manifest fetch fails', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
    prepareOfflineShell()
    await vi.waitFor(() => expect(prepareMessages).toHaveBeenCalledTimes(1))

    const message = prepareMessages.mock.calls[0]?.[0] as { type: string; assets: string[] }
    expect(message.type).toBe('KOMGA_PREPARE_OFFLINE_SHELL')
    expect(message.assets).toEqual(getOfflineShellAssets())
  })

  test('tags the batch and publishes preparing state to the store', async () => {
    prepareOfflineShell()
    await vi.waitFor(() => expect(prepareMessages).toHaveBeenCalledTimes(1))

    const message = prepareMessages.mock.calls[0]?.[0] as { type: string; batchId: unknown }
    expect(typeof message.batchId).toBe('string')
    expect(message.batchId).not.toBe('')
    await vi.waitFor(() =>
      expect(setShellReadinessMock).toHaveBeenCalledWith(
        'preparing',
        expect.objectContaining({ done: 0 }),
      ),
    )
  })

  test('keeps an intact shell ready when both content hashes are unchanged', async () => {
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(Response.json({ revision: 'same', files: ['a.js'] })),
    )
    statusReply = { revision: '["same","same"]', shellReady: true }
    prepareOfflineShell()
    await vi.waitFor(() =>
      expect(setShellReadinessMock).toHaveBeenCalledWith('ready', expect.anything()),
    )
    expect(prepareMessages).not.toHaveBeenCalled()
    expect(setShellReadinessMock.mock.calls.some(([state]) => state === 'preparing')).toBe(false)
  })
})

describe('queryOfflineShellStatus', () => {
  afterEach(() => {
    // @ts-expect-error happy-dom has no service workers; remove the stub
    delete navigator.serviceWorker
  })

  test('resolves undefined without a service worker', async () => {
    expect('serviceWorker' in navigator).toBe(false)
    await expect(queryOfflineShellStatus(10)).resolves.toBeUndefined()
  })

  test('posts KOMGA_OFFLINE_STATUS and resolves with the worker reply', async () => {
    const postMessage = vi.fn((message: unknown, transfer: MessagePort[]) => {
      expect(message).toEqual({ type: KOMGA_OFFLINE_STATUS })
      transfer[0]?.postMessage({ shellReady: true, precache: null })
    })
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { ready: Promise.resolve({ active: { postMessage } }), controller: null },
      configurable: true,
    })

    await expect(queryOfflineShellStatus(1000)).resolves.toEqual({
      shellReady: true,
      precache: null,
    })
    expect(postMessage).toHaveBeenCalledTimes(1)
  })

  test('resolves undefined when the worker never replies', async () => {
    const postMessage = vi.fn()
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { ready: Promise.resolve({ active: { postMessage } }), controller: null },
      configurable: true,
    })

    await expect(queryOfflineShellStatus(20)).resolves.toBeUndefined()
  })
})

describe('isPrecacheCompleteForBatch', () => {
  test('matches only the tracked batch at full progress', () => {
    expect(
      isPrecacheCompleteForBatch(
        {
          shellReady: true,
          precache: { batchId: 'b1', expected: 3, done: 3, complete: true, settled: true },
        },
        'b1',
      ),
    ).toBe(true)
    expect(
      isPrecacheCompleteForBatch({ precache: { batchId: 'b1', expected: 3, done: 2 } }, 'b1'),
    ).toBe(false)
    expect(
      isPrecacheCompleteForBatch({ precache: { batchId: 'b2', expected: 3, done: 3 } }, 'b1'),
    ).toBe(false)
    expect(isPrecacheCompleteForBatch({ precache: null }, 'b1')).toBe(false)
    expect(isPrecacheCompleteForBatch(undefined, 'b1')).toBe(false)
    // An empty attempt cannot establish a complete offline shell.
    expect(
      isPrecacheCompleteForBatch({ precache: { batchId: 'b1', expected: 0, done: 0 } }, 'b1'),
    ).toBe(false)
  })
})

test('never accepts failed assets or missing HTML despite settled progress', () => {
  for (const status of [
    {
      shellReady: false,
      precache: { batchId: 'x', expected: 2, done: 2, complete: true, settled: true },
    },
    {
      shellReady: true,
      precache: { batchId: 'x', expected: 2, done: 2, failed: 1, complete: false },
    },
  ])
    expect(isPrecacheCompleteForBatch(status, 'x')).toBe(false)
})

test('status budget includes a worker registration that never becomes ready', async () => {
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { ready: new Promise(() => {}) },
    configurable: true,
  })
  await expect(queryOfflineShellStatus(20)).resolves.toBeUndefined()
  // @ts-expect-error happy-dom does not implement service workers
  delete navigator.serviceWorker
})

describe('waitForPrecacheCompletion', () => {
  const immediate = () => Promise.resolve()

  test('resolves complete once the tracked batch is fully cached', async () => {
    const replies = [
      { precache: { batchId: 'b1', expected: 2, done: 1 } },
      {
        shellReady: true,
        precache: { batchId: 'b1', expected: 2, done: 2, complete: true, settled: true },
      },
    ]
    const onProgress = vi.fn()
    const result = await waitForPrecacheCompletion('b1', 2, {
      queryStatus: () => Promise.resolve(replies.shift()),
      delay: immediate,
      timeoutMs: 1000,
      intervalMs: 0,
      onProgress,
    })
    expect(result).toEqual({ complete: true, precache: { expected: 2, done: 2 } })
    expect(onProgress).toHaveBeenNthCalledWith(1, { expected: 2, done: 1 })
    expect(onProgress).toHaveBeenNthCalledWith(2, { expected: 2, done: 2 })
  })

  test('keeps tracking while a slow manifest has not established the asset count', async () => {
    const replies = [
      {
        shellReady: false,
        precache: { batchId: 'slow', expected: 0, done: 0, complete: false, settled: false },
      },
      {
        shellReady: true,
        precache: { batchId: 'slow', expected: 2, done: 2, complete: true, settled: true },
      },
    ]
    const result = await waitForPrecacheCompletion('slow', 0, {
      queryStatus: () => Promise.resolve(replies.shift()),
      delay: immediate,
      intervalMs: 0,
    })
    expect(result.complete).toBe(true)
  })

  test('ignores other batches, failures, and empty replies until the timeout', async () => {
    const onProgress = vi.fn()
    let calls = 0
    const result = await waitForPrecacheCompletion('b1', 2, {
      queryStatus: () => {
        calls += 1
        if (calls === 1)
          return Promise.resolve({ precache: { batchId: 'b0', expected: 2, done: 2 } })
        if (calls === 2) return Promise.reject(new Error('gone'))
        return Promise.resolve({ precache: null })
      },
      delay: immediate,
      timeoutMs: 30,
      intervalMs: 0,
      onProgress,
    })
    expect(result.complete).toBe(false)
    expect(result.precache).toEqual({ expected: 2, done: 0 })
    expect(onProgress).not.toHaveBeenCalled()
    expect(calls).toBeGreaterThan(2)
  })

  test('stops immediately when cancelled', async () => {
    const queryStatus = vi.fn(() =>
      Promise.resolve({ precache: { batchId: 'b1', expected: 1, done: 1 } }),
    )
    const result = await waitForPrecacheCompletion('b1', 1, {
      queryStatus,
      delay: immediate,
      timeoutMs: 1000,
      intervalMs: 0,
      isCancelled: () => true,
    })
    expect(result).toEqual({ complete: false, precache: { expected: 1, done: 0 } })
    expect(queryStatus).not.toHaveBeenCalled()
  })
})
