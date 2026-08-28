export function navigationDeltaForDrag(
  offset: number,
  vertical: boolean,
  rightToLeft: boolean,
): number {
  if (offset === 0) return 0
  if (vertical) return offset < 0 ? 1 : -1
  if (offset < 0) return rightToLeft ? -1 : 1
  return rightToLeft ? 1 : -1
}

export function dragOffsetWithResistance(
  rawOffset: number,
  axisSize: number,
  hasTarget: boolean,
): number {
  const resisted = hasTarget ? rawOffset : rawOffset * 0.25
  return Math.max(-axisSize, Math.min(axisSize, resisted))
}

export function shouldCommitDrag(
  rawOffset: number,
  axisSize: number,
  velocity: number,
  distanceThreshold = 0.2,
  velocityThreshold = 0.5,
): boolean {
  if (axisSize <= 0 || rawOffset === 0) return false

  const distanceReached = Math.abs(rawOffset) / axisSize >= distanceThreshold
  const flingReached =
    Math.abs(velocity) >= velocityThreshold &&
    Math.sign(velocity) === Math.sign(rawOffset)

  return distanceReached || flingReached
}
