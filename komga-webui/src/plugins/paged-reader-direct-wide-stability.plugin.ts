import {CreateElement, VNode} from 'vue'
import PagedReaderPaperSheet from '@/components/readers/PagedReaderPaperSheet.vue'
import {PagedReaderLayout, PagedReaderTransition} from '@/types/enum-reader'
import {
  PhysicalPageFace,
  PhysicalSinglePageEdgePlan,
  physicalSinglePageEdgePlan,
} from '@/functions/paged-reader-physical'
import {paperCurlDynamicGeometry} from '@/functions/paged-reader-transition'
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
  readableBack = false,
): VNode {
  const content = isBlank(face) ? [] : [
    h('img', {
      attrs: {
        src: face.page.url,
        alt: `Page ${face.page.number}`,
      },
      style: faceImageStyle(face),
    }),
  ]

  return h('div', {
    staticClass,
    style: {
      ...style,
      background: '#fff',
    },
  }, readableBack ? [
    h('div', {
      staticClass: 'direct-wide-readable-back-artwork',
      style: {
        position: 'absolute',
        inset: '0',
        transform: 'scaleX(-1)',
        transformOrigin: 'center center',
      },
    }, content),
  ] : content)
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
 * Direct portrait -> wide transitions are intentionally isolated from the
 * multi-mode wide state machine. Persistent physical parity makes this path much
 * more common than before, and reusing the unified VNode tree exposed a severe
 * frame-level compositor flash.
 *
 * Keep one deterministic scene for the whole turn:
 *  - immutable hidden portrait measurement surface
 *  - stationary far half of the target wide scan
 *  - one FRONT/BACK turning sheet
 *  - final complete target only during committed post-release settlement
 *
 * There are no shadow/filter/effect nodes in this path.
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
    // Lower wrappers still run for touch/image-load/bounds bookkeeping; their
    // visual tree is deliberately discarded for this one transition.
    const fallback = originalRender.call(this, h) as VNode
    const reader = this.$parent as any
    const plan = directIntoWidePlan(reader)
    if (!plan || !this.pageBoundsReady || !this.pageBounds) return fallback

    const currentSpread = reader.spreads?.[reader.drag.currentIndex] as PageDtoWithUrl[] | undefined
    const targetSpread = reader.spreads?.[reader.drag.targetIndex] as PageDtoWithUrl[] | undefined
    if (!currentSpread || !targetSpread) return fallback

    const progress = clamp01(Number(this.progress))
    const curl = clamp01(progress / CURL_END)
    const settling = !!(reader.drag?.settling && reader.drag?.settleCommit)
    const settle = settling
      ? smooth((progress - CURL_END) / (1 - CURL_END))
      : 0
    const physicalOpacity = 1 - settle
    const stationary = stationaryTargetFace(plan)
    const leafRect = sourceRect(this)

    const spread = (value: PageDtoWithUrl[]) => h('paged-reader-spread', {
      props: {
        spread: value,
        flipDirection: this.flipDirection,
        scale: this.scale,
      },
    })

    const measurement = h('div', {
      key: 'direct-wide-measure',
      staticClass: 'paper-layer paper-current single-page-wide-v2-measure direct-wide-measure',
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
          opacity: `${physicalOpacity * smooth(curl / 0.45)}`,
        },
        'single-page-wide-v2-under-target-wide direct-wide-under',
      )
      : h('div', {
        key: 'direct-wide-under',
        staticClass: 'single-page-wide-v2-under-target-wide direct-wide-under',
        style: {position: 'absolute', inset: '0', opacity: '0'},
      })
    if (under.data) under.data.key = 'direct-wide-under'

    const turning = h('div', {
      key: 'direct-wide-turning',
      staticClass: 'single-page-wide-v2-turning-group direct-wide-turning',
      style: {
        position: 'absolute',
        inset: '0',
        zIndex: '8',
        opacity: `${physicalOpacity}`,
        pointerEvents: 'none',
        filter: 'none',
        willChange: 'auto',
      },
    }, [
      h('div', {
        staticClass: 'paper-layer direct-wide-current',
        style: {
          position: 'absolute',
          inset: '0',
          zIndex: '4',
          ...(this.currentStyle as Record<string, string>),
        },
      }, [renderFace(h, plan.front, leafRect, 'direct-wide-front')]),
      h('div', {
        staticClass: 'paper-layer paper-back physical-comic-paper-back direct-wide-back',
        style: {
          ...(this.backStyle as Record<string, string>),
          filter: 'none',
          willChange: 'auto',
        },
      }, [
        h('div', {
          staticClass: 'paper-back-content',
          style: {
            ...(this.backContentStyle as Record<string, string>),
            filter: 'none',
            willChange: 'auto',
          },
        }, [renderFace(h, plan.back, leafRect, 'direct-wide-back-face', true)]),
      ]),
    ])

    const finalTarget = h('div', {
      key: 'direct-wide-final',
      staticClass: 'paper-layer single-page-wide-v2-final-target direct-wide-final',
      style: {
        zIndex: '14',
        opacity: `${settle}`,
        pointerEvents: 'none',
        filter: 'none',
      },
    }, [spread(targetSpread)])

    return h('div', {
      staticClass: 'paper-sheet single-page-wide-v2 direct-wide-stable',
      attrs: {'aria-hidden': 'true'},
      style: {
        overflow: 'visible',
        pointerEvents: 'none',
        contain: 'none',
        isolation: 'auto',
      },
    }, [measurement, under, turning, finalTarget])
  }
}
