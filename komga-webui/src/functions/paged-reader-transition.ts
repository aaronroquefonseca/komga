export type PageCurlVariant = 'top' | 'middle' | 'bottom'

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

/**
 * Legacy one-dimensional paper fold phase. Kept while the reader migrates from
 * vertical strips to the two-dimensional paper mesh.
 */
export function paperCurlSegmentPhase(progress: number, distanceFromOuterEdge: number): number {
  const p = Math.max(0, Math.min(1, progress))
  const distance = Math.max(0, Math.min(1, distanceFromOuterEdge))
  const foldFront = p * 1.3
  const bendWidth = 0.28
  return Math.max(0, Math.min(1, (foldFront - distance) / bendWidth))
}

/**
 * Phase for one tile of the flexible paper mesh.
 *
 * Middle turns travel almost uniformly from the free edge to the spine. Corner
 * turns are deliberately diagonal: the touched corner starts immediately while
 * the opposite corner is held back, producing the large triangular fold of a
 * real page grabbed by its corner. Every tile still reaches 1 at progress=1 so
 * the sheet can settle cleanly onto the next page.
 */
export function paperCurlTilePhase(
  progress: number,
  distanceFromFreeEdge: number,
  rowPosition: number,
  variant: PageCurlVariant,
): number {
  const p = Math.max(0, Math.min(1, progress))
  const edge = Math.max(0, Math.min(1, distanceFromFreeEdge))
  const y = Math.max(0, Math.min(1, rowPosition))

  const oppositeCornerDistance = variant === 'top'
    ? y
    : variant === 'bottom'
      ? 1 - y
      : 0

  const edgeDelay = edge * (variant === 'middle' ? 0.38 : 0.22)
  const cornerDelay = oppositeCornerDistance * (variant === 'middle' ? 0 : 0.52)
  const start = Math.min(0.94, edgeDelay + cornerDelay)

  if (p >= 1) return 1
  if (p <= start) return 0
  return Math.max(0, Math.min(1, (p - start) / (1 - start)))
}
