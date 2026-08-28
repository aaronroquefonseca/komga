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

export function pageCurlRotation(progress: number, physicalDirection: number): number {
  const clamped = Math.max(0, Math.min(1, progress))
  return clamped * 168 * Math.sign(physicalDirection || 1)
}
