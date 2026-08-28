export type PageCurlVariant = 'top' | 'middle' | 'bottom'

export type PaperCurlDynamicGeometry = {
  seamTop: number
  seamBottom: number
  shadowTop: number
  shadowBottom: number
}

export function transitionProgress(offset: number, axisSize: number): number {
  if (axisSize <= 0) return 0
  return Math.max(0, Math.min(1, Math.abs(offset) / axisSize))
}

export function pageCurlVariantForStart(startY: number, height: number): PageCurlVariant {
  if (height <= 0) return 'middle'
  const ratio = Math.max(0, Math.min(1, startY / height))
  if (ratio < 0.25) return 'top'
  if (ratio > 0.75) return 'bottom'
  return 'middle'
}

/**
 * Rotate a rigid page around its spine while keeping the projected free edge
 * aligned with the finger's horizontal travel: cos(theta) = 1 - progress.
 */
export function pageCurlRotation(progress: number, physicalDirection: number): number {
  const clamped = Math.max(0, Math.min(1, progress))
  const degrees = Math.acos(1 - clamped) * 180 / Math.PI
  return degrees * Math.sign(physicalDirection || 1)
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function actualPercent(canonicalX: number, physicalDirection: number): number {
  const x = clamp01(canonicalX)
  return physicalDirection < 0 ? x * 100 : (1 - x) * 100
}

/**
 * Dynamic page-curl edge based on the same geometric idea used by Android
 * page-curl readers: the fold line passes through the current drag point and is
 * perpendicular to the vector from the grabbed free edge to that point.
 *
 * Komga permits a swipe to start anywhere, so horizontal travel is normalized
 * to page progress (the virtual free edge starts at x=1). The real start/current
 * finger Y coordinates are retained, which makes diagonal/corner turns fully
 * continuous instead of selecting one of a few canned shapes.
 *
 * Coordinates returned here are percentages in the reader's actual LTR/RTL
 * coordinate system. A completed turn always collapses exactly to the opposite
 * page edge so settlement remains compatible with the flash-free renderer.
 */
export function paperCurlDynamicGeometry(
  progress: number,
  startY: number,
  currentY: number,
  physicalDirection: number,
): PaperCurlDynamicGeometry {
  const p = clamp01(progress)
  const direction = Math.sign(physicalDirection || -1)

  if (p <= 0.0001) {
    const edge = direction < 0 ? 100 : 0
    return {seamTop: edge, seamBottom: edge, shadowTop: edge, shadowBottom: edge}
  }

  if (p >= 0.9999) {
    const edge = direction < 0 ? 0 : 100
    return {seamTop: edge, seamBottom: edge, shadowTop: edge, shadowBottom: edge}
  }

  const sy = clamp01(startY)
  const cy = clamp01(currentY)

  // Canonical space always turns from the right edge toward the left. The
  // virtual finger/fold point moves horizontally with progress while retaining
  // the real vertical finger position.
  const currentX = 1 - p
  const anchorDeltaY = sy - cy

  // The fold line direction is the free-edge vector rotated by 90 degrees.
  // Solving that line at y=0 and y=1 gives its intersections with the page.
  const topCanonical = currentX + anchorDeltaY * cy / p
  const bottomCanonical = currentX - anchorDeltaY * (1 - cy) / p

  const seamTop = actualPercent(topCanonical, direction)
  const seamBottom = actualPercent(bottomCanonical, direction)

  // Cast the paper shadow onto the newly revealed page, on the free-edge side
  // of the fold. It grows around the middle of the turn and vanishes cleanly at
  // both endpoints.
  const shadowWidth = Math.sin(p * Math.PI) * 8
  const shadowSign = direction < 0 ? 1 : -1

  return {
    seamTop,
    seamBottom,
    shadowTop: Math.max(0, Math.min(100, seamTop + shadowSign * shadowWidth)),
    shadowBottom: Math.max(0, Math.min(100, seamBottom + shadowSign * shadowWidth)),
  }
}
