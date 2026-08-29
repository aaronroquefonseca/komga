import {CreateElement, VNode} from 'vue'
import PagedReader from '@/components/readers/PagedReader.vue'
import PagedReaderPaperSheet from '@/components/readers/PagedReaderPaperSheet.vue'
import {PagedReaderTransition} from '@/types/enum-reader'
import {
  physicalComicTransitionKind,
  physicalComicUnderSpreadIndex,
} from '@/functions/paged-reader-physical'
import {PageDtoWithUrl} from '@/types/komga-books'

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/**
 * Fork-local augmentation for the physical-comic transition.
 *
 * PagedReader is still the authoritative gesture/compositor implementation. We
 * only select which existing compositor effect applies to an adjacent edge and
 * change the two surfaces rendered by PagedReaderPaperSheet during a physical
 * curl. Keeping this here avoids duplicating the large reader component while
 * the animation is still experimental.
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

  readerOptions.computed.physicalComicUnderSpread = function (this: any): PageDtoWithUrl[] {
    if (this.transition !== PagedReaderTransition.PHYSICAL_COMIC) return []
    const index = physicalComicUnderSpreadIndex(
      this.drag.targetIndex,
      this.drag.navigationDelta,
      this.spreads.length,
    )
    if (index !== null && this.spreads[index]) return this.spreads[index]
    if (this.drag.targetIndex !== null && this.spreads[this.drag.targetIndex]) {
      return this.spreads[this.drag.targetIndex]
    }
    return this.spreads[this.visualPage] || []
  }

  // The normal paper curl reflects the current artwork and keeps the requested
  // destination flat underneath. Physical Comic instead treats the destination
  // as the back face of the sheet being turned, while the following spread sits
  // flat underneath. During the final third of the curl that following spread
  // slides away, revealing the requested destination already mounted below it.
  // This overlaps both phases and avoids a visual snap when the drag settles.
  paperOptions.render = function (this: any, h: CreateElement): VNode {
    const parent = this.$parent as any
    const physical = parent &&
      parent.transition === PagedReaderTransition.PHYSICAL_COMIC &&
      typeof parent.effectiveTransition === 'function' &&
      parent.effectiveTransition() === PagedReaderTransition.PAPER_CURL

    const targetSpread = physical && parent.physicalComicUnderSpread?.length
      ? parent.physicalComicUnderSpread
      : this.backSpread
    const reflectedSpread = physical ? this.backSpread : this.frontSpread

    const slideRaw = physical ? clamp01((this.progress - 0.66) / 0.34) : 0
    const slideProgress = 1 - Math.pow(1 - slideRaw, 3)
    const axisSize = Math.max(1, parent?.drag?.axisSize || window.innerWidth)
    const direction = Math.sign(this.physicalDirection || -1)
    const targetStyle = physical ? {
      transform: `translate3d(${direction * axisSize * slideProgress}px, 0, 0)`,
      willChange: 'transform',
      filter: slideProgress > 0
        ? `drop-shadow(${-direction * 10}px 0 12px rgba(0, 0, 0, ${0.12 + slideProgress * 0.12}))`
        : 'none',
    } : undefined

    const spread = (value: PageDtoWithUrl[]) => h('paged-reader-spread', {
      props: {
        spread: value,
        flipDirection: this.flipDirection,
        scale: this.scale,
      },
    })

    return h('div', {
      staticClass: 'paper-sheet',
      attrs: {'aria-hidden': 'true'},
    }, [
      h('div', {
        staticClass: 'paper-layer paper-target',
        style: targetStyle,
      }, [spread(targetSpread)]),
      h('div', {
        staticClass: 'paper-layer paper-current',
        style: this.currentStyle,
      }, [spread(this.frontSpread)]),
      h('div', {
        staticClass: 'paper-layer paper-back',
        style: this.backStyle,
      }, [
        h('div', {
          staticClass: 'paper-back-content',
          style: this.backContentStyle,
        }, [spread(reflectedSpread)]),
      ]),
      h('div', {staticClass: 'paper-shadow', style: this.shadowStyle}),
      h('div', {staticClass: 'paper-edge', style: this.edgeStyle}),
    ])
  }
}
