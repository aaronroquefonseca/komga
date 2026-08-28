export type PageCurlVariant = 'top' | 'middle' | 'bottom'

export type PaperCurlFoldGeometry = {
  seamTop: number
  seamBottom: number
  foldTop: number
  foldBottom: number
  shadowTop: number
  shadowBottom: number
}

export type PaperCurlWarpGeometry = PaperCurlFoldGeometry & {
  rotationY: number
  cornerRotation: number
  verticalShift: number
  lift: number
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

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

/**
 * Geometry for one continuous MangaBox-style fold boundary.
 *
 * The sheet is never tessellated. `seamTop` and `seamBottom` describe one edge
 * separating the still-visible front page from the revealed target page. Corner
 * turns exaggerate that single edge into a diagonal line, while `fold*` and
 * `shadow*` describe continuous lighting bands around the seam.
 */
export function paperCurlFoldGeometry(
  progress: number,
  physicalDirection: number,
  variant: PageCurlVariant,
): PaperCurlFoldGeometry {
  const p = Math.max(0, Math.min(1, progress))
  const direction = Math.sign(physicalDirection || -1)
  const base = direction < 0 ? 100 * (1 - p) : 100 * p

  // Peak diagonal displacement occurs halfway through the turn and disappears
  // at both endpoints, so start/end geometry remains exactly the full page.
  const curve = Math.sin(p * Math.PI) * 30
  let topOffset = 0
  let bottomOffset = 0

  if (variant === 'top') {
    topOffset = direction < 0 ? -curve : curve
    bottomOffset = direction < 0 ? curve * 0.32 : -curve * 0.32
  } else if (variant === 'bottom') {
    topOffset = direction < 0 ? curve * 0.32 : -curve * 0.32
    bottomOffset = direction < 0 ? -curve : curve
  }

  const seamTop = clampPercent(base + topOffset)
  const seamBottom = clampPercent(base + bottomOffset)

  const foldWidth = Math.sin(p * Math.PI) * 20
  const shadowWidth = Math.sin(p * Math.PI) * 11

  return {
    seamTop,
    seamBottom,
    foldTop: clampPercent(seamTop - direction * foldWidth),
    foldBottom: clampPercent(seamBottom - direction * foldWidth),
    shadowTop: clampPercent(seamTop - direction * shadowWidth),
    shadowBottom: clampPercent(seamBottom - direction * shadowWidth),
  }
}

/**
 * Continuous 3D warp applied to the one-piece page flap.
 *
 * The fold boundary still tracks the finger linearly, but the material on the
 * free side of that boundary rotates as one physical sheet. At 90 degrees the
 * front becomes edge-on; after that the target-page back face becomes visible,
 * reaching a flat 180-degree turn at completion.
 *
 * The constants here are deliberate tuning knobs for the paper feel. Keeping
 * them in one function makes it straightforward to calibrate after touch tests.
 */
export function paperCurlWarpGeometry(
  progress: number,
  physicalDirection: number,
  variant: PageCurlVariant,
): PaperCurlWarpGeometry {
  const p = Math.max(0, Math.min(1, progress))
  const direction = Math.sign(physicalDirection || -1)
  const fold = paperCurlFoldGeometry(p, direction, variant)
  const arch = Math.sin(p * Math.PI)

  const maxCornerRotation = 16
  const maxCornerShift = 5
  const maxLift = 44

  const cornerRotation = variant === 'top'
    ? -direction * arch * maxCornerRotation
    : variant === 'bottom'
      ? direction * arch * maxCornerRotation
      : 0
  const verticalShift = variant === 'top'
    ? arch * maxCornerShift
    : variant === 'bottom'
      ? -arch * maxCornerShift
      : 0

  return {
    ...fold,
    rotationY: direction * p * 180,
    cornerRotation,
    verticalShift,
    lift: arch * maxLift,
  }
}
