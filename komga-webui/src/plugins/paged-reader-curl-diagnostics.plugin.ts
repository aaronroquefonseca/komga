type CurlDebugMode = 'nofx' | 'nounder' | 'noback'

function debugMode(): CurlDebugMode | null {
  if (typeof window === 'undefined') return null
  const value = new URLSearchParams(window.location.search).get('curlDebug')
  return value === 'nofx' || value === 'nounder' || value === 'noback'
    ? value
    : null
}

function addStyle(css: string): void {
  const style = document.createElement('style')
  style.setAttribute('data-curl-debug', 'true')
  style.textContent = css
  document.head.appendChild(style)
}

function addBadge(mode: CurlDebugMode): void {
  const badge = document.createElement('div')
  badge.textContent = `curlDebug=${mode}`
  badge.setAttribute('data-curl-debug-badge', 'true')
  Object.assign(badge.style, {
    position: 'fixed',
    top: '6px',
    left: '6px',
    zIndex: '2147483647',
    padding: '4px 7px',
    fontFamily: 'monospace',
    fontSize: '11px',
    lineHeight: '1.2',
    color: '#fff',
    background: 'rgba(0,0,0,.78)',
    pointerEvents: 'none',
  })
  document.body.appendChild(badge)
}

/**
 * Opt-in visual isolation modes for curl debugging. These deliberately do not
 * alter normal reader behavior unless ?curlDebug=<mode> is present.
 */
export function installCurlDiagnostics(): void {
  if (typeof document === 'undefined') return
  const mode = debugMode()
  if (!mode) return

  document.documentElement.setAttribute('data-curl-debug-mode', mode)

  if (mode === 'nofx') {
    addStyle(`
      [data-curl-debug-mode="nofx"] .paper-shadow,
      [data-curl-debug-mode="nofx"] .paper-edge,
      [data-curl-debug-mode="nofx"] .safe-curl-shadow,
      [data-curl-debug-mode="nofx"] .safe-curl-edge {
        display: none !important;
      }
      [data-curl-debug-mode="nofx"] .paper-back,
      [data-curl-debug-mode="nofx"] .paper-back-content,
      [data-curl-debug-mode="nofx"] .paper-current,
      [data-curl-debug-mode="nofx"] .single-page-wide-v2-turning-group,
      [data-curl-debug-mode="nofx"] .double-page-curl-face {
        filter: none !important;
        will-change: auto !important;
      }
      [data-curl-debug-mode="nofx"] .paper-sheet,
      [data-curl-debug-mode="nofx"] .safe-curl-shadow,
      [data-curl-debug-mode="nofx"] .safe-curl-edge {
        contain: none !important;
        isolation: auto !important;
      }
    `)
  }

  if (mode === 'nounder') {
    addStyle(`
      [data-curl-debug-mode="nounder"] .paper-target,
      [data-curl-debug-mode="nounder"] .single-page-wide-v2-under-current,
      [data-curl-debug-mode="nounder"] .single-page-wide-v2-under-target-wide,
      [data-curl-debug-mode="nounder"] .single-page-wide-v2-under-target-single,
      [data-curl-debug-mode="nounder"] .double-page-curl-base {
        visibility: hidden !important;
      }
    `)
  }

  if (mode === 'noback') {
    addStyle(`
      [data-curl-debug-mode="noback"] .paper-back,
      [data-curl-debug-mode="noback"] .single-page-wide-v2-back {
        visibility: hidden !important;
      }
    `)
  }

  if (document.body) addBadge(mode)
  else window.addEventListener('DOMContentLoaded', () => addBadge(mode), {once: true})
}
