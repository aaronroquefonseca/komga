export type PageCurlVariant = 'top' | 'middle' | 'bottom'

export type PaperCurlPoint = {
  x: number
  y: number
}

export type PaperCurlDynamicGeometry = {
  seamTop: number
  seamBottom: number
  shadowTop: number
  shadowBottom: number
  backPolygon: PaperCurlPoint[]
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

function actualXPercent(canonicalX: number, physicalDirection: number): number {
  return physicalDirection < 0 ? canonicalX * 100 : (1 - canonicalX) * 100
}

function reflectPoint(point: PaperCurlPoint, lineA: PaperCurlPoint, lineB: PaperCurlPoint): PaperCurlPoint {
  const dx = lineB.x - lineA.x
  const dy = lineB.y - lineA.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= 1e-8) return {...point}

  const t = ((point.x - lineA.x) * dx + (point.y - lineA.y) * dy) / lengthSquared
  const projectionX = lineA.x + t * dx
  const projectionY = lineA.y + t * dy

  return {
    x: projectionX * 2 - point.x,
    y: projectionY * 2 - point.y,
  }
}

/**
 * Dynamic page-curl geometry adapted from the classic two-point fold model.
 *
 * The fold line passes through the virtual drag point and is perpendicular to
 * the vector from the grabbed free edge to that point. The current page is
 * clipped on the bound side of this line. The free-edge polygon is then
 * reflected across the same line to become the physical backside of the page;
 * this reflection is what vacates space for the next page underneath.
 *
 * Komga permits a swipe to begin anywhere, so horizontal travel comes from the
 * existing normalized Follow-finger progress while the actual live start/current
 * finger Y positions control the fold angle. `heightOverWidth` keeps the maths
 * in real screen proportions instead of treating the viewport as a square.
 */
export function paperCurlDynamicGeometry(
  progress: number,
  startY: number,
  currentY: number,
  physicalDirection: number,
  heightOverWidth = 1,
): PaperCurlDynamicGeometry {
  const p = clamp01(progress)
  const direction = Math.sign(physicalDirection || -1)
  const aspect = Math.max(0.05, heightOverWidth)

  const endpointGeometry = (canonicalEdge: number): PaperCurlDynamicGeometry => {
    const edge = actualXPercent(canonicalEdge, direction)
    return {
      seamTop: edge,
      seamBottom: edge,
      shadowTop: edge,
      shadowBottom: edge,
      backPolygon: [
        {x: edge, y: 0},
        {x: edge, y: 0},
        {x: edge, y: 100},
        {x: edge, y: 100},
      ],
    }
  }

  if (p <= 0.0001) return endpointGeometry(1)
  if (p >= 0.9999) return endpointGeometry(0)

  const startYPx = clamp01(startY) * aspect
  const currentYPx = clamp01(currentY) * aspect
  const currentPoint = {x: 1 - p, y: currentYPx}

  const vectorX = 1 - currentPoint.x
  const vectorY = startYPx - currentPoint.y
  const lineDirection = {x: -vectorY, y: vectorX}

  // Intersections of the infinite fold line with the top and bottom page edges.
  const topT = -currentPoint.y / lineDirection.y
  const bottomT = (aspect - currentPoint.y) / lineDirection.y
  const rawTop = currentPoint.x + lineDirection.x * topT
  const rawBottom = currentPoint.x + lineDirection.x * bottomT

  // Match the reference implementation: never let the curl detach past the
  // spine, but permit intersections beyond the free edge so corner curls can
  // naturally collapse against that side.
  const topCurl = {x: Math.max(0, rawTop), y: 0}
  const bottomCurl = {x: Math.max(0, rawBottom), y: aspect}

  let sideY = currentPoint.y
  if (Math.abs(lineDirection.x) > 1e-8) {
    sideY = currentPoint.y + lineDirection.y * (1 - currentPoint.x) / lineDirection.x
  }
  const sideIntersection = {x: 1, y: sideY}

  const sourcePolygon: PaperCurlPoint[] = []
  if (topCurl.x < 1) {
    sourcePolygon.push(topCurl, {x: 1, y: 0})
  } else {
    sourcePolygon.push(sideIntersection, sideIntersection)
  }

  if (bottomCurl.x < 1) {
    sourcePolygon.push({x: 1, y: aspect}, bottomCurl)
  } else {
    sourcePolygon.push(sideIntersection, sideIntersection)
  }

  const reflected = sourcePolygon.map(point => reflectPoint(point, topCurl, bottomCurl))
  const toPercentPoint = (point: PaperCurlPoint): PaperCurlPoint => ({
    x: actualXPercent(point.x, direction),
    y: point.y / aspect * 100,
  })

  const seamTop = actualXPercent(topCurl.x, direction)
  const seamBottom = actualXPercent(bottomCurl.x, direction)

  const shadowWidth = Math.sin(p * Math.PI) * 8
  const shadowSign = direction < 0 ? 1 : -1

  return {
    seamTop,
    seamBottom,
    shadowTop: seamTop + shadowSign * shadowWidth,
    shadowBottom: seamBottom + shadowSign * shadowWidth,
    backPolygon: reflected.map(toPercentPoint),
  }
}
