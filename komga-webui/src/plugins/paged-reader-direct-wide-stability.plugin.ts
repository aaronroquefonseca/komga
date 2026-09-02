import {CreateElement, VNode} from 'vue'
import PagedReaderPaperSheet from '@/components/readers/PagedReaderPaperSheet.vue'
import {PagedReaderLayout, PagedReaderTransition} from '@/types/enum-reader'
import {
  PhysicalPageFace,
  PhysicalSinglePageEdgePlan,
  physicalSinglePageEdgePlan,
} from '@/functions/paged-reader-physical'
import {
  paperCurlDynamicGeometry,
  paperCurlReflectionMatrix,
} from '@/functions/paged-reader-transition'
import {PageDtoWithUrl} from '@/types/komga-books'

const CURL_END = 0.90

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function smooth(value: number): number {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

function directIntoWidePlan(reader: any): PhysicalSinglePageEdgePlan | null {
  if (!reader ||
    reader.transition !== PagedReaderTransition.PHYSICAL_COMIC ||
    reader.pageLayout !== PagedReaderLayout.SINGLE_PAGE ||
    reader.vertical ||
    !reader.drag?.prepared ||
    reader.drag.targetIndex === null) return null

  const plan = physicalSinglePageEdgePlan(
    reader.spreads || [],
    reader.drag.currentIndex,
    reader.drag.targetIndex,
    !!reader.flipDirection,
  )

  if (!plan ||
    plan.kind !== 'curl' ||
    plan.currentWide ||
    !plan.targetWide ||
    plan.crossesSyntheticBlank) return null

  return plan
}

function rootWidth(sheet: any): number {
  if (sheet.$el instanceof HTMLElement) {
    const width = sheet.$el.getBoundingClientRect().width
    if (width > 0) return width
  }
  return Math.max(1, window.innerWidth)
}

function faceSide(face: PhysicalPageFace): 'left' | 'right' | null {
  if (face.crop === 'left') return 'left'
  if (face.crop === 'right') return 'right'
  return null
}

function isBlank(face: PhysicalPageFace): boolean {
  return face.page.number <= 0 || !face.page.url
}

function faceImageStyle(face: PhysicalPageFace): Record<string, string> {
  if (face.crop === 'full') {
    return {
      display: 'block',
      width: '100%',
      height: '100%',
      objectFit: 'contain',
      objectPosition: 'center center',
    }
  }

  return {
    position: 'absolute',
    display: 'block',
    top: '0',
    left: face.crop === 'left' ? '0' : '-100%',
    width: '200%',
    height: '100%',
    maxWidth: 'none',
    maxHeight: 'none',
    objectFit: 'fill',
  }
}

function renderFace(
  h: CreateElement,
  face: PhysicalPageFace,
  style: Record<string, string>,
  staticClass: string,
): VNode {
  return h('div', {
    staticClass,
    style: {
      ...style,
      background: '#fff',
    },
  }, isBlank(face) ? [] : [
    h('img', {
      attrs: {
        src: face.page.url,
        alt: `Page ${face.page.number}`,
      },
      style: faceImageStyle(face),
    }),
  ])
}

function sourceRect(sheet: any): Record<string, string> {
  const bounds = sheet.pageBounds
  if (sheet.pageBoundsReady && bounds) {
    return {
      position: 'absolute',
      display: 'block',
      overflow: 'hidden',
      left: `${bounds.left}px`,
      top: `${bounds.top}px`,
      width: `${bounds.width}px`,
      height: `${bounds.height}px`,
    }
  }

  return {
    position: 'absolute',
    display: 'block',
    overflow: 'hidden',
    left: '0',
    top: '0',
    width: `${rootWidth(sheet)}px`,
    height: '100%',
  }
}

function outerEdgeSlotRect(sheet: any, side: 'left' | 'right'): Record<string, string> {
  const bounds = sheet.pageBounds
  if (!sheet.pageBoundsReady || !bounds) {
    const width = rootWidth(sheet) / 2
    return {
      position: 'absolute',
      display: 'block',
      overflow: 'hidden',
      left: `${side === 'left' ? 0 : rootWidth(sheet) - width}px`,
      top: '0',
      width: `${width}px`,
      height: '100%',
    }
  }

  const width = Math.max(1, bounds.width)
  return {
    position: 'absolute',
    display: 'block',
    overflow: 'hidden',
    left: `${side === 'left' ? 0 : rootWidth(sheet) - width}px`,
    top: `${bounds.top}px`,
    width: `${width}px`,
    height: `${Math.max(1, bounds.height)}px`,
  }
}

function stationaryTargetFace(plan: PhysicalSinglePageEdgePlan): PhysicalPageFace | null {
  return plan.targetFaces.find(face => face.crop !== plan.back.crop) || null
}

/**
 * This is the exact backside transform used by the already-stable ordinary
 * Physical Comic composite. A virtual half of a wide scan must not go through
 * PagedReaderPaperSheet's generic reflection plus a second scaleX(-1): that old
 * combination becomes visually unstable at extreme curl angles.
 */
function alignedBackContentStyle(sheet: any): Record<string, string> {
  if (!sheet.pageBoundsReady || !sheet.pageBounds) return {opacity: '0'}

  const {left, top, width, height} = sheet.pageBounds
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return {opacity: '0'}
  }

  const {seamTop, seamBottom} = sheet.geometry
  const bottom = top + height
  const reflection = paperCurlReflectionMatrix(
    {x: sheet.paperX(seamTop), y: top},
    {x: sheet.paperX(seamBottom), y: bottom},
  )

  const centreX = left + width / 2
  return {
    transformOrigin: '0 0',
    transform: `matrix(${-reflection.a}, ${-reflection.b}, ${reflection.c}, ${reflection.d}, ${reflection.e + 2 * centreX * reflection.a}, ${reflection.f + 2 * centreX * reflection.b})`,
    opacity: '1',
    filter: 'none',
  }
}

/**
 * Direct portrait -> wide keeps an isolated scene, but the physical sheet itself
 * is now deliberately identical to the proven ordinary Physical Comic curl:
 * paper-current + paper-back/aligned reflection + paper-shadow + paper-edge.
 *
 * The only special piece left here is the stationary half of the target wide
 * scan, which must occupy its outer-edge slot while the other half is the BACK
 * of the turning sheet.
 */
export function installDirectWideStability(): void {
  const paperOptions = (PagedReaderPaperSheet as any).options
  if (!paperOptions || paperOptions.__directWideStabilityInstalled) return
  paperOptions.__directWideStabilityInstalled = true

  const originalGeometry = paperOptions.computed?.geometry
  if (typeof originalGeometry === 'function') {
    paperOptions.computed.geometry = function (this: any) {
      const plan = directIntoWidePlan(this.$parent as any)
      if (!plan) return originalGeometry.call(this)

      const curl = Math.min(clamp01(Number(this.progress) / CURL_END), 0.9998)
      return paperCurlDynamicGeometry(
        curl,
        this.touchCaptured ? this.touchStartY : 0.5,
        this.touchCaptured ? this.touchCurrentY : 0.5,
        this.direction,
        this.heightOverWidth,
      )
    }
  }

  const originalRender = paperOptions.render
  if (typeof originalRender !== 'function') return

  paperOptions.render = function (this: any, h: CreateElement): VNode {
    // Lower wrappers still perform topology/touch/bounds bookkeeping, but their
    // multi-mode visual tree is intentionally not reused for this direct edge.
    const fallback = originalRender.call(this, h) as VNode
    const reader = this.$parent as any
    const plan = directIntoWidePlan(reader)
    if (!plan || !this.pageBoundsReady || !this.pageBounds) return fallback

    const currentSpread = reader.spreads?.[reader.drag.currentIndex] as PageDtoWithUrl[] | undefined
    if (!currentSpread) return fallback

    const progress = clamp01(Number(this.progress))
    const curl = clamp01(progress / CURL_END)
    const stationary = stationaryTargetFace(plan)
    const leafRect = sourceRect(this)

    const spread = (value: PageDtoWithUrl[]) => h('paged-reader-spread', {
      props: {
        spread: value,
        flipDirection: this.flipDirection,
        scale: this.scale,
      },
    })

    // The immutable real-image measurement surface prevents image-load/layout
    // events from changing the physical rectangle during the gesture.
    const measurement = h('div', {
      key: 'direct-wide-measure',
      staticClass: 'paper-layer paper-current direct-wide-measure',
      style: {
        visibility: 'hidden',
        zIndex: '0',
        pointerEvents: 'none',
      },
    }, [spread(currentSpread)])

    const under = stationary
      ? renderFace(
        h,
        stationary,
        {
          ...outerEdgeSlotRect(this, faceSide(stationary) || 'right'),
          zIndex: '2',
          opacity: `${smooth(curl / 0.35)}`,
        },
        'direct-wide-under',
      )
      : h('div', {
        key: 'direct-wide-under',
        staticClass: 'direct-wide-under',
        style: {position: 'absolute', inset: '0', opacity: '0'},
      })
    if (under.data) under.data.key = 'direct-wide-under'

    const turning = h('div', {
      key: 'direct-wide-turning',
      staticClass: 'single-page-physical-turning-group direct-wide-turning',
      style: {
        position: 'absolute',
        inset: '0',
        zIndex: '8',
        transform: 'translate3d(0, 0, 0)',
        pointerEvents: 'none',
      },
    }, [
      h('div', {
        staticClass: 'paper-layer paper-current single-page-physical-current direct-wide-current',
        style: this.currentStyle,
      }, [
        renderFace(h, plan.front, leafRect, 'single-page-physical-front-face direct-wide-front'),
      ]),
      h('div', {
        staticClass: 'paper-layer paper-back physical-comic-paper-back single-page-physical-back direct-wide-back',
        style: this.backStyle,
      }, [
        h('div', {
          staticClass: 'paper-back-content',
          style: alignedBackContentStyle(this),
        }, [
          renderFace(h, plan.back, leafRect, 'single-page-physical-back-face direct-wide-back-face'),
        ]),
      ]),
      h('div', {staticClass: 'paper-shadow', style: this.shadowStyle}),
      h('div', {staticClass: 'paper-edge', style: this.edgeStyle}),
    ])

    // No late full-spread opacity handoff. At progress=1 the physical BACK is
    // already the second target half in its final leaf position, exactly like the
    // ordinary composite. resetDrag()/visualPage then swaps to the idle target.
    return h('div', {
      staticClass: 'paper-sheet direct-wide-stable',
      attrs: {'aria-hidden': 'true'},
      style: {
        overflow: 'visible',
        pointerEvents: 'none',
      },
    }, [measurement, under, turning])
  }
}
