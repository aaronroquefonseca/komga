import { afterEach, describe, expect, test, vi, type Mock } from 'vitest'
import type { Router } from 'vue-router'
import {
  getOfflineShellAssets,
  prepareOfflineShell,
  setServiceWorkerOfflineMode,
  setupOfflineShell,
} from '@/services/offline-shell'

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  vi.restoreAllMocks()
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

describe('service worker messaging without a worker', () => {
  test('no-ops when service workers are unavailable', () => {
    expect('serviceWorker' in navigator).toBe(false)
    expect(() => prepareOfflineShell()).not.toThrow()
    expect(() => setServiceWorkerOfflineMode(true)).not.toThrow()
    expect(() => setupOfflineShell(stubRouter().router)).not.toThrow()
  })

  test('setupOfflineShell wires load, online, and routing triggers', () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { ready: Promise.resolve(undefined) },
      configurable: true,
    })
    try {
      const addEventListener = vi.spyOn(window, 'addEventListener')
      const { router, afterEach: afterEachHook } = stubRouter()

      setupOfflineShell(router)

      if (document.readyState !== 'complete') {
        expect(addEventListener).toHaveBeenCalledWith('load', expect.any(Function), { once: true })
      }
      expect(addEventListener).toHaveBeenCalledWith('online', expect.any(Function))
      expect(afterEachHook).toHaveBeenCalledTimes(1)
    } finally {
      // @ts-expect-error happy-dom has no service workers; remove the stub
      delete navigator.serviceWorker
    }
  })
})
