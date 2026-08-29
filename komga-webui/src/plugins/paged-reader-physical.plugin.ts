import {CreateElement, VNode} from 'vue'
import PagedReader from '@/components/readers/PagedReader.vue'
import PagedReaderPaperSheet from '@/components/readers/PagedReaderPaperSheet.vue'
import {PagedReaderLayout, PagedReaderTransition, ScaleType} from '@/types/enum-reader'
import {
  canUseDoublePageLeaf,
  doublePageLeafPlan,
  physicalComicTransitionKind,
  physicalComicUnderSpreadIndex,
} from '@/functions/paged-reader-physical'
import {PageDtoWithUrl} from '@/types/komga-books'

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function physicalLeafImageStyle(scale: ScaleType): Record<string, string> {
  const common = {
    objectFit: 'contain',
    objectPosition: 'center',
    display: 'block',
    margin: 'auto',
  }

  switch (scale) {
    case ScaleType.ORIGINAL:
      return {...common, maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto'}
    case ScaleType.WIDTH_SHRINK_ONLY:
      return {...common, maxWidth: '100%', maxHeight: '100%', width: '100%', height: 'auto'}
    case ScaleType.WIDTH:
      return {...common, width: '100%', minHeight: '100%', height: 'auto'}
    case ScaleType.HEIGHT:
      return {...common, width: 'auto', height: '100%', maxWidth: '100%'}
    case ScaleType.SCREEN:
    default:
      return {...common, width: '100%', height: '100%'}
  }
}

/**
 * Fork-local augmentation for physical-comic and double-page transitions.
 *
 * Spread-style effects continue to animate an open spread as one coherent unit.
 * Sheet-style effects (3D Page Flip and Paper Curl) use a dedicated half-sheet
 * compositor whenever both adjacent spreads really contain two pages. This
 * keeps the spine stationary and turns only the outer leaf.
 */
export function installPhysicalPagedReader(): void {
  const readerOptions = (PagedReader as any).options
  const paperOptions = (PagedReaderPaperSheet as any).options

  if (!readerOptions || !paperOptions || readerOptions.__physicalComicInstalled) return
  readerOptions.__physicalComicInstalled = true

  const originalEffectiveTransition = readerOptions.methods.effectiveTransition
  readerOptions.methods.effectiveTransition = function (this: any): PagedReaderTransition {
    if (this.transition !== PagedReaderTransition.PHYSICAL_COMIC) {
      return originalEffectiveTransition.call(this)
    }

    if (!this.drag.prepared || this.drag.targetIndex === null) {
      return PagedReaderTransition.DEFAULT
    }

    const kind = physicalComicTransitionKind(
      this.pageLayout,
      this.spreads[this.drag.currentIndex],
      this.spreads[this.drag.targetIndex],
      this.vertical,
    )
    return kind === 'curl' ? PagedReaderTransition.PAPER_CURL : PagedReaderTransition.DEFAULT
  }

  const originalTransitionDuration = readerOptions.computed.transitionDuration
  readerOptions.computed.transitionDuration = function (this: any): number {
    if (this.transition !== PagedReaderTransition.PHYSICAL_COMIC) {
      return originalTransitionDuration.call(this)
    }
    return this.effectiveTransition() === PagedReaderTransition.PAPER_CURL ? 340 : 220
  }

  readerOptions.computed.physicalComicUnderSpread = function (this: any): PageDtoWithUrl[] | null {
    if (this.transition !== PagedReaderTransition.PHYSICAL_COMIC) return null
    const index = physicalComicUnderSpreadIndex(
      this.drag.targetIndex,
      this.drag.navigationDelta,
      this.spreads.length,
    )
    return index !== null && this.spreads[index] ? this.spreads[index] : null
  }

  readerOptions.computed.doublePageLeafTransition = function (this: any): boolean {
    if (!this.drag.prepared || this.drag.targetIndex === null) return false
    const effect = this.effectiveTransition()
    if (effect !== PagedReaderTransition.PAGE_TURN &&
      effect !== PagedReaderTransition.PAPER_CURL) return false

    return canUseDoublePageLeaf(
      this.pageLayout,
      this.spreads[this.drag.currentIndex],
      this.spreads[this.drag.targetIndex],
      this.vertical,
    )
  }

  // Route 3D Page Flip through the paper-sheet component in double-page mode as
  // well. That component is the only transition child capable of painting an
  // intermediate A|D base plus an independent B/C leaf.
  const originalIsPaperCurlCurrent = readerOptions.methods.isPaperCurlCurrent
  readerOptions.methods.isPaperCurlCurrent = function (this: any, spreadIndex: number): boolean {
    if (this.doublePageLeafTransition &&
      spreadIndex === this.transitionBaseIndex) return true
    return originalIsPaperCurlCurrent.call(this, spreadIndex)
  }

  const originalCustomSpreadStyle = readerOptions.methods.customSpreadStyle
  readerOptions.methods.customSpreadStyle = function (this: any, spreadIndex: number): Record<string, string> {
    const style = originalCustomSpreadStyle.call(this, spreadIndex)

    if (this.doublePageLeafTransition) {
      if (spreadIndex === this.transitionBaseIndex) {
        return {
          transform: 'translate3d(0, 0, 0)',
          opacity: '1',
          zIndex: '4',
          pointerEvents: 'none',
        }
      }
      if (spreadIndex === this.drag.targetIndex) {
        return {
          transform: 'translate3d(0, 0, 0)',
          opacity: '0',
          zIndex: '0',
          pointerEvents: 'none',
        }
      }
      return style
    }

    if (this.transition !== PagedReaderTransition.PHYSICAL_COMIC ||
      !this.drag.prepared ||
      this.effectiveTransition() !== PagedReaderTransition.PAPER_CURL) {
      return style
    }

    const isTarget = spreadIndex === this.drag.targetIndex
    if (!isTarget) return style

    // At book boundaries there is no physical sheet behind the curl. Hide the
    // destination initially so returning to the cover exposes the reader's real
    // background, then bring the requested page in quickly during the tail end.
    if (!this.physicalComicUnderSpread) {
      const raw = clamp01((this.transitionProgressValue - 0.66) / 0.34)
      const eased = 1 - Math.pow(1 - raw, 3)
      const direction = this.activePhysicalDirection || 1
      const start = -direction * this.drag.axisSize * 0.22
      return {
        ...style,
        transform: this.axisTranslate(start * (1 - eased)),
        opacity: `${eased}`,
        zIndex: '1',
      }
    }

    return style
  }

  paperOptions.render = function (this: any, h: CreateElement): VNode {
    const parent = this.$parent as any
    const effect = parent && typeof parent.effectiveTransition === 'function'
      ? parent.effectiveTransition()
      : PagedReaderTransition.PAPER_CURL
    const physical = parent &&
      parent.transition === PagedReaderTransition.PHYSICAL_COMIC &&
      effect === PagedReaderTransition.PAPER_CURL

    const spread = (value: PageDtoWithUrl[]) => h('paged-reader-spread', {
      props: {
        spread: value,
        flipDirection: this.flipDirection,
        scale: this.scale,
      },
    })

    if (parent?.doublePageLeafTransition) {
      const current = parent.spreads[parent.drag.currentIndex] as PageDtoWithUrl[]
      const target = parent.spreads[parent.drag.targetIndex] as PageDtoWithUrl[]
      const plan = doublePageLeafPlan(current, target, parent.drag.navigationDelta)

      if (plan) {
        const progress = clamp01(this.progress)
        const direction = Math.sign(this.physicalDirection || -1)
        const arch = Math.sin(progress * Math.PI)
        const verticalDelta = this.touchCaptured ? this.touchCurrentY - this.touchStartY : 0
        const paperLike = effect === PagedReaderTransition.PAPER_CURL
        const angleProgress = paperLike
          ? 1 - Math.pow(1 - progress, 1.35)
          : progress
        const angle = direction * angleProgress * 180
        const cornerTilt = verticalDelta * (paperLike ? 14 : 8) * arch
        const curlScaleX = paperLike ? 1 - arch * 0.075 : 1
        const lift = paperLike ? arch * 14 : arch * 8
        const startsRight = direction < 0
        const leafStyle: Record<string, string> = {
          position: 'absolute',
          top: '0',
          bottom: '0',
          width: '50%',
          height: '100%',
          left: startsRight ? '50%' : '0',
          transformOrigin: startsRight ? 'left center' : 'right center',
          transform: `perspective(1800px) translateZ(${lift}px) rotateY(${angle}deg) rotateZ(${cornerTilt}deg) scaleX(${curlScaleX})`,
          transformStyle: 'preserve-3d',
          willChange: 'transform',
          zIndex: '6',
        }
        const faceStyle: Record<string, string> = {
          position: 'absolute',
          inset: '0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backfaceVisibility: 'hidden',
          WebkitBackfaceVisibility: 'hidden',
          overflow: 'hidden',
          background: 'transparent',
        }
        const frontStyle = {
          ...faceStyle,
          filter: `drop-shadow(${direction * 9}px 0 ${8 + arch * 12}px rgba(0,0,0,${0.14 + arch * 0.18}))`,
        }
        const paperTint = physical || !paperLike
          ? 'none'
          : `brightness(${0.86 + progress * 0.14}) saturate(${0.78 + progress * 0.22})`
        const backStyle = {
          ...faceStyle,
          transform: 'rotateY(180deg)',
          filter: paperTint === 'none'
            ? `drop-shadow(${-direction * 7}px 0 ${6 + arch * 10}px rgba(0,0,0,${0.10 + arch * 0.14}))`
            : `${paperTint} drop-shadow(${-direction * 7}px 0 ${6 + arch * 10}px rgba(0,0,0,${0.10 + arch * 0.14}))`,
        }
        const imageStyle = physicalLeafImageStyle(this.scale)
        const pageImage = (page: PageDtoWithUrl) => h('img', {
          attrs: {
            src: page.url,
            alt: `Page ${page.number}`,
          },
          style: imageStyle,
        })

        return h('div', {
          staticClass: `paper-sheet double-page-leaf-sheet double-page-leaf-${effect}`,
          attrs: {'aria-hidden': 'true'},
          style: {overflow: 'visible'},
        }, [
          h('div', {
            staticClass: 'paper-layer double-page-leaf-base',
            style: {zIndex: '1'},
          }, [spread(plan.baseSpread)]),
          h('div', {staticClass: 'double-page-leaf', style: leafStyle}, [
            h('div', {staticClass: 'double-page-leaf-front', style: frontStyle}, [pageImage(plan.front)]),
            h('div', {staticClass: 'double-page-leaf-back', style: backStyle}, [pageImage(plan.back)]),
          ]),
        ])
      }
    }

    // Single-page physical curl: destination is the actual back face, while the
    // following unread page sits underneath. At the beginning/end of the book
    // that under-spread is intentionally absent, exposing the reader background.
    const targetSpread = physical
      ? (parent.physicalComicUnderSpread || [])
      : this.backSpread
    const reflectedSpread = physical ? this.backSpread : this.frontSpread

    const slideRaw = physical && parent.physicalComicUnderSpread
      ? clamp01((this.progress - 0.66) / 0.34)
      : 0
    const slideProgress = 1 - Math.pow(1 - slideRaw, 3)
    const axisSize = Math.max(1, parent?.drag?.axisSize || window.innerWidth)
    const direction = Math.sign(this.physicalDirection || -1)
    const targetStyle = physical && parent.physicalComicUnderSpread ? {
      transform: `translate3d(${direction * axisSize * slideProgress}px, 0, 0)`,
      willChange: 'transform',
      filter: slideProgress > 0
        ? `drop-shadow(${-direction * 10}px 0 12px rgba(0, 0, 0, ${0.12 + slideProgress * 0.12}))`
        : 'none',
    } : undefined

    const backContentStyle = physical
      ? {...this.backContentStyle, filter: 'none'}
      : this.backContentStyle

    return h('div', {
      staticClass: 'paper-sheet',
      attrs: {'aria-hidden': 'true'},
    }, [
      h('div', {
        staticClass: 'paper-layer paper-target',
        style: targetStyle,
      }, targetSpread.length ? [spread(targetSpread)] : []),
      h('div', {
        staticClass: 'paper-layer paper-current',
        style: this.currentStyle,
      }, [spread(this.frontSpread)]),
      h('div', {
        staticClass: physical
          ? 'paper-layer paper-back physical-comic-paper-back'
          : 'paper-layer paper-back',
        style: this.backStyle,
      }, [
        h('div', {
          staticClass: 'paper-back-content',
          style: backContentStyle,
        }, [spread(reflectedSpread)]),
      ]),
      h('div', {staticClass: 'paper-shadow', style: this.shadowStyle}),
      h('div', {staticClass: 'paper-edge', style: this.edgeStyle}),
    ])
  }
}
