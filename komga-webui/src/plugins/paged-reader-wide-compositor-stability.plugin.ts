/**
 * The complex portrait <-> wide state machine is already structurally stable,
 * but Android/Chromium was proven to flash when extra clipped decoration layers
 * participate in the same frame. Keep this special compositor on the no-FX
 * baseline while ordinary curls retain the rebuilt safe effects.
 */
export function installWideCompositorStability(): void {
  if (typeof document === 'undefined' || document.querySelector('style[data-wide-curl-stability]')) return

  const style = document.createElement('style')
  style.setAttribute('data-wide-curl-stability', 'true')
  style.textContent = `
    .single-page-wide-v2 .paper-shadow,
    .single-page-wide-v2 .paper-edge,
    .single-page-wide-v2 .safe-curl-shadow,
    .single-page-wide-v2 .safe-curl-edge {
      display: none !important;
    }
  `
  document.head.appendChild(style)
}
