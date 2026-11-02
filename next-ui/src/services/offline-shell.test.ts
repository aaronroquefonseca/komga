import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import type { Router } from 'vue-router'
import {
  getOfflineShellAssets,
  mergeShellAssets,
  parseShellManifest,
  prepareOfflineShell,
  resetOfflineShellStateForTests,
  resolveShellAssetUrls,
  setServiceWorkerOfflineMode,
  setupOfflineShell,
} from '@/services/offline-shell'

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
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
  const postMessage = vi.fn()

  beforeEach(() => {
    postMessage.mockClear()
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
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1))

    const message = postMessage.mock.calls[0]?.[0] as { type: string; assets: string[] }
    expect(message.type).toBe('KOMGA_PREPARE_OFFLINE_SHELL')
    expect(message.assets).toContain(`${window.location.origin}/assets/manifest-chunk.js`)
    expect(fetch).toHaveBeenCalledTimes(1)

    // A second prepare after the throttle window reuses the cached manifest.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000)
    prepareOfflineShell()
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2))
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test('falls back to DOM assets when the manifest fetch fails', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
    prepareOfflineShell()
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1))

    const message = postMessage.mock.calls[0]?.[0] as { type: string; assets: string[] }
    expect(message.type).toBe('KOMGA_PREPARE_OFFLINE_SHELL')
    expect(message.assets).toEqual(getOfflineShellAssets())
  })
})
