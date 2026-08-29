export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false

  const standaloneDisplay = window.matchMedia?.('(display-mode: standalone)').matches === true
  const fullscreenDisplay = window.matchMedia?.('(display-mode: fullscreen)').matches === true
  const iosStandalone = (window.navigator as any).standalone === true

  return standaloneDisplay || fullscreenDisplay || iosStandalone
}
