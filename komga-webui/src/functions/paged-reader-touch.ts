export type PagedReaderTouchSnapshot = {
  sequence: number
  active: boolean
  moved: boolean
  startX: number
  startY: number
  currentX: number
  currentY: number
  endedAt: number
}

const state: PagedReaderTouchSnapshot = {
  sequence: 0,
  active: false,
  moved: false,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  endedAt: 0,
}

function distanceFromStart(x: number, y: number): number {
  return Math.hypot(x - state.startX, y - state.startY)
}

if (typeof window !== 'undefined') {
  window.addEventListener('touchstart', event => {
    if (event.touches.length !== 1) return
    const touch = event.touches[0]
    state.sequence++
    state.active = true
    state.moved = false
    state.startX = touch.clientX
    state.startY = touch.clientY
    state.currentX = touch.clientX
    state.currentY = touch.clientY
    state.endedAt = 0
  }, {capture: true, passive: true})

  window.addEventListener('touchmove', event => {
    if (!state.active || event.touches.length !== 1) return
    const touch = event.touches[0]
    state.currentX = touch.clientX
    state.currentY = touch.clientY
    if (distanceFromStart(touch.clientX, touch.clientY) >= 4) state.moved = true
  }, {capture: true, passive: true})

  const finishTouch = (event: TouchEvent) => {
    if (!state.active) return
    const touch = event.changedTouches[0]
    if (touch) {
      state.currentX = touch.clientX
      state.currentY = touch.clientY
      if (distanceFromStart(touch.clientX, touch.clientY) >= 4) state.moved = true
    }
    state.active = false
    state.endedAt = performance.now()
  }

  window.addEventListener('touchend', finishTouch, {capture: true, passive: true})
  window.addEventListener('touchcancel', finishTouch, {capture: true, passive: true})
}

export function pagedReaderTouchSnapshot(): PagedReaderTouchSnapshot {
  return {...state}
}
