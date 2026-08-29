export type PageCurlVariant = 'top' | 'middle' | 'bottom'

export type PaperCurlPoint = {
  x: number
  y: number
}

export type PaperCurlAffineMatrix = {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
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
 * CSS-compatible affine reflection across an arbitrary line.
 *
 * `e` and `f` use the same coordinate units as the supplied points, so callers
 * can pass page-local pixels and feed the result directly to CSS matrix().
 */
export function paperCurlReflectionMatrix(
  lineA: PaperCurlPoint,
  lineB: PaperCurlPoint,
): PaperCurlAffineMatrix {
  const dx = lineB.x - lineA.x
  const dy = lineB.y - lineA.y
  const length = Math.hypot(dx, dy)
  if (length <= 1e-8) {
    return {a: 1, b: 0, c: 0, d: 1, e: 0, f: 0}
  }

  const ux = dx / length
  const uy = dy / length
  const a = 2 * ux * ux - 1
  const b = 2 * ux * uy
  const c = b
  const d = 2 * uy * uy - 1

  return {
    a,
    b,
    c,
    d,
    e: lineA.x - a * lineA.x - c * lineA.y,
    f: lineA.y - b * lineA.x - d * lineA.y,
  }
}

function rawCurlEdgeIntersections(
  progress: number,
  startYPx: number,
  currentYPx: number,
  aspect: number,
): {top: number; bottom: number} {
  const currentX = 1 - progress
  const verticalDelta = currentYPx - startYPx
  const lineY = Math.max(1e-8, progress)

  return {
    top: currentX - verticalDelta * currentYPx / lineY,
    bottom: currentX + verticalDelta * (aspect - currentYPx) / lineY,
  }
}

/**
 * A physical crease may reach either bound/spine corner, but it cannot continue
 * rotating through that edge of the sheet. The old implementation clamped a
 * negative top/bottom intersection to zero after computing the line, which made
 * the rendered crease differ from the line used to derive the drag and could
 * reflect part of the flap through the crease at extreme angles.
 *
 * Saturate only the vertical component of the drag at the first point where the
 * intended crease touches the spine. Horizontal progress remains untouched, so
 * the turn still follows the finger while the topology stays physically valid.
 */
function constrainCurlYToSpine(
  progress: number,
  startYPx: number,
  requestedYPx: number,
  aspect: number,
): number {
  const requested = Math.max(0, Math.min(aspect, requestedYPx))
  const requestedEdges = rawCurlEdgeIntersections(progress, startYPx, requested, aspect)
  if (requestedEdges.top >= 0 && requestedEdges.bottom >= 0) return requested

  // At the gesture's start Y the crease is always valid. Binary-search along
  // the requested vertical movement until one edge lands exactly on the spine.
  let validT = 0
  let invalidT = 1
  for (let i = 0; i < 28; i++) {
    const t = (validT + invalidT) / 2
    const candidate = startYPx + (requested - startYPx) * t
    const edges = rawCurlEdgeIntersections(progress, startYPx, candidate, aspect)
    if (edges.top >= 0 && edges.bottom >= 0) validT = t
    else invalidT = t
  }

  return startYPx + (requested - startYPx) * validT
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
  const requestedYPx = clamp01(currentY) * aspect
  const currentYPx = constrainCurlYToSpine(p, startYPx, requestedYPx, aspect)
  const currentPoint = {x: 1 - p, y: currentYPx}

  const vectorX = 1 - currentPoint.x
  const vectorY = startYPx - currentPoint.y
  const lineDirection = {x: -vectorY, y: vectorX}

  // Intersections of the infinite fold line with the top and bottom page edges.
  // constrainCurlYToSpine guarantees neither can pass through the bound edge;
  // Math.max only absorbs tiny floating-point error at the exact corner.
  const rawEdges = rawCurlEdgeIntersections(p, startYPx, currentYPx, aspect)
  const topCurl = {x: Math.max(0, rawEdges.top), y: 0}
  const bottomCurl = {x: Math.max(0, rawEdges.bottom), y: aspect}

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
