<template>
  <div class="paper-sheet" aria-hidden="true">
    <!-- The destination page always stays flat underneath the physical sheet. -->
    <div class="paper-layer paper-target">
      <paged-reader-spread
        :spread="backSpread"
        :flip-direction="flipDirection"
        :scale="scale"
      />
    </div>

    <!-- The part of the current page that has not crossed the fold line yet. -->
    <div class="paper-layer paper-current" :style="currentStyle">
      <paged-reader-spread
        :spread="frontSpread"
        :flip-direction="flipDirection"
        :scale="scale"
      />
    </div>

    <!-- The free part of the paper is reflected across the curl line. Its back
         is intentionally plain white for now; the area it vacates reveals the
         destination page underneath. -->
    <div class="paper-layer paper-back" :style="backStyle" />

    <div class="paper-shadow" :style="shadowStyle" />
    <div class="paper-edge" :style="edgeStyle" />
  </div>
</template>

<script lang="ts">
import Vue from 'vue'
import PagedReaderSpread from '@/components/readers/PagedReaderSpread.vue'
import {PageDtoWithUrl} from '@/types/komga-books'
import {ScaleType} from '@/types/enum-reader'
import {
  PaperCurlDynamicGeometry,
  PaperCurlPoint,
  paperCurlDynamicGeometry,
} from '@/functions/paged-reader-transition'
import {pagedReaderTouchSnapshot} from '@/functions/paged-reader-touch'

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

type PaperBounds = {
  left: number
  top: number
  width: number
  height: number
}

type ViewportRect = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/**
 * getBoundingClientRect() reports the CSS box of an <img>. In SCREEN and some
 * other reader scales that box can be the whole viewport while object-fit:
 * contain letterboxes the actual comic page inside it. Curl geometry must use
 * the painted image rectangle, not that outer CSS box.
 */
function paintedImageRect(image: HTMLImageElement): ViewportRect | null {
  const rect = image.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null

  const naturalWidth = image.naturalWidth
  const naturalHeight = image.naturalHeight
  if (naturalWidth <= 0 || naturalHeight <= 0) {
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    }
  }

  // PagedReaderSpread applies object-fit: contain and object-position: center to
  // every page image. Reconstruct the actual painted content rectangle.
  const scale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight)
  const width = naturalWidth * scale
  const height = naturalHeight * scale
  const left = rect.left + (rect.width - width) / 2
  const top = rect.top + (rect.height - height) / 2

  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  }
}

export default Vue.extend({
  name: 'PagedReaderPaperSheet',
  components: {PagedReaderSpread},
  props: {
    frontSpread: {
      type: Array as () => PageDtoWithUrl[],
      required: true,
    },
    backSpread: {
      type: Array as () => PageDtoWithUrl[],
      required: true,
    },
    flipDirection: {
      type: Boolean,
      required: true,
    },
    scale: {
      type: String as () => ScaleType,
      required: true,
    },
    progress: {
      type: Number,
      required: true,
    },
    physicalDirection: {
      type: Number,
      required: true,
    },
    // Retained for compatibility with the reader API. Live page curl now uses
    // continuous touch geometry; non-interactive turns are always centered.
    variant: {
      type: String,
      required: true,
    },
  },
  data: () => ({
    touchSequence: -1,
    touchCaptured: false,
    touchStartY: 0.5,
    touchCurrentY: 0.5,
    heightOverWidth: 1,
    pageBoundsReady: false,
    pageBounds: {
      left: 0,
      top: 0,
      width: 1,
      height: 1,
    } as PaperBounds,
    boundsAnimationFrame: undefined as number | undefined,
  }),
  watch: {
    progress: {
      handler() {
        this.syncTouchGeometry()
      },
      immediate: true,
    },
    frontSpread() {
      this.pageBoundsReady = false
      this.schedulePageBoundsMeasurement()
    },
    scale() {
      this.pageBoundsReady = false
      this.schedulePageBoundsMeasurement()
    },
    flipDirection() {
      this.pageBoundsReady = false
      this.schedulePageBoundsMeasurement()
    },
  },
  mounted() {
    // Native image load does not bubble, so capture it from the component root.
    // This catches the moment naturalWidth/naturalHeight become available.
    ;(this.$el as HTMLElement).addEventListener('load', this.onDescendantLoad, true)
    window.addEventListener('resize', this.schedulePageBoundsMeasurement)
    this.schedulePageBoundsMeasurement()
    this.syncTouchGeometry()
  },
  beforeDestroy() {
    if (this.$el instanceof HTMLElement) {
      this.$el.removeEventListener('load', this.onDescendantLoad, true)
    }
    window.removeEventListener('resize', this.schedulePageBoundsMeasurement)
    if (this.boundsAnimationFrame !== undefined) {
      window.cancelAnimationFrame(this.boundsAnimationFrame)
      this.boundsAnimationFrame = undefined
    }
  },
  computed: {
    direction(): number {
      return Math.sign(this.physicalDirection || -1)
    },
    geometry(): PaperCurlDynamicGeometry {
      return paperCurlDynamicGeometry(
        this.progress,
        this.touchCaptured ? this.touchStartY : 0.5,
        this.touchCaptured ? this.touchCurrentY : 0.5,
        this.direction,
        this.heightOverWidth,
      )
    },
    currentClip(): string {
      const {seamTop, seamBottom} = this.geometry
      const left = this.pageBounds.left
      const right = left + this.pageBounds.width
      const top = this.pageBounds.top
      const bottom = top + this.pageBounds.height
      const seamTopX = this.paperX(seamTop)
      const seamBottomX = this.paperX(seamBottom)

      if (this.direction < 0) {
        return `polygon(${left}px ${top}px, ${seamTopX}px ${top}px, ${seamBottomX}px ${bottom}px, ${left}px ${bottom}px)`
      }
      return `polygon(${seamTopX}px ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ${seamBottomX}px ${bottom}px)`
    },
    backClip(): string {
      return `polygon(${this.geometry.backPolygon.map(point => this.paperPoint(point)).join(', ')})`
    },
    shadowClip(): string {
      const {seamTop, seamBottom, shadowTop, shadowBottom} = this.geometry
      const top = this.pageBounds.top
      const bottom = top + this.pageBounds.height
      return `polygon(${this.paperX(seamTop)}px ${top}px, ${this.paperX(shadowTop)}px ${top}px, ${this.paperX(shadowBottom)}px ${bottom}px, ${this.paperX(seamBottom)}px ${bottom}px)`
    },
    currentStyle(): Record<string, string> {
      if (!this.pageBoundsReady) return {}
      return {
        clipPath: this.currentClip,
        WebkitClipPath: this.currentClip,
      }
    },
    backStyle(): Record<string, string> {
      if (!this.pageBoundsReady) return {opacity: '0'}
      return {
        clipPath: this.backClip,
        WebkitClipPath: this.backClip,
        opacity: '1',
      }
    },
    shadowStyle(): Record<string, string> {
      if (!this.pageBoundsReady) return {opacity: '0'}
      const arch = Math.sin(clamp01(this.progress) * Math.PI)
      const gradient = this.direction < 0
        ? 'linear-gradient(to right, rgba(0,0,0,0.34), rgba(0,0,0,0))'
        : 'linear-gradient(to left, rgba(0,0,0,0.34), rgba(0,0,0,0))'
      return {
        clipPath: this.shadowClip,
        WebkitClipPath: this.shadowClip,
        background: gradient,
        opacity: `${arch}`,
      }
    },
    edgeStyle(): Record<string, string> {
      if (!this.pageBoundsReady) return {opacity: '0'}
      const {seamTop, seamBottom} = this.geometry
      const width = 0.45
      const edgeTop = seamTop + this.direction * width
      const edgeBottom = seamBottom + this.direction * width
      const top = this.pageBounds.top
      const bottom = top + this.pageBounds.height
      const clip = `polygon(${this.paperX(seamTop)}px ${top}px, ${this.paperX(edgeTop)}px ${top}px, ${this.paperX(edgeBottom)}px ${bottom}px, ${this.paperX(seamBottom)}px ${bottom}px)`
      return {
        clipPath: clip,
        WebkitClipPath: clip,
        opacity: `${Math.sin(clamp01(this.progress) * Math.PI)}`,
      }
    },
  },
  methods: {
    paperX(percent: number): number {
      return this.pageBounds.left + this.pageBounds.width * percent / 100
    },
    paperY(percent: number): number {
      return this.pageBounds.top + this.pageBounds.height * percent / 100
    },
    paperPoint(point: PaperCurlPoint): string {
      return `${this.paperX(point.x)}px ${this.paperY(point.y)}px`
    },
    onDescendantLoad(event: Event) {
      if (event.target instanceof HTMLImageElement) {
        this.schedulePageBoundsMeasurement()
      }
    },
    schedulePageBoundsMeasurement() {
      if (this.boundsAnimationFrame !== undefined) {
        window.cancelAnimationFrame(this.boundsAnimationFrame)
      }
      this.boundsAnimationFrame = window.requestAnimationFrame(() => {
        this.boundsAnimationFrame = undefined
        this.measurePageBounds()
      })
    },
    measurePageBounds() {
      if (!(this.$el instanceof HTMLElement)) return
      const root = this.$el as HTMLElement
      const rootRect = root.getBoundingClientRect()
      const images = Array.from(root.querySelectorAll('.paper-current img')) as HTMLImageElement[]
      const rects = images
        .map(paintedImageRect)
        .filter((rect): rect is ViewportRect => rect !== null && rect.width > 0 && rect.height > 0)

      if (rects.length === 0) {
        this.pageBoundsReady = false
        return
      }

      // A double-page spread is treated as one physical sheet for the curl. The
      // union also naturally handles asymmetric page dimensions and centering.
      const left = Math.min(...rects.map(rect => rect.left))
      const top = Math.min(...rects.map(rect => rect.top))
      const right = Math.max(...rects.map(rect => rect.right))
      const bottom = Math.max(...rects.map(rect => rect.bottom))
      const width = Math.max(1, right - left)
      const height = Math.max(1, bottom - top)

      this.pageBounds = {
        left: left - rootRect.left,
        top: top - rootRect.top,
        width,
        height,
      }
      this.pageBoundsReady = true
      this.heightOverWidth = height / width
      this.syncTouchGeometry()
    },
    syncTouchGeometry() {
      if (!(this.$el instanceof HTMLElement)) return
      if (!this.pageBoundsReady) {
        this.schedulePageBoundsMeasurement()
        return
      }

      const rootRect = (this.$el as HTMLElement).getBoundingClientRect()
      const pageTop = rootRect.top + this.pageBounds.top
      const height = Math.max(1, this.pageBounds.height)
      const touch = pagedReaderTouchSnapshot()

      // Only adopt a gesture while it is actually active. A click/keyboard turn
      // therefore cannot inherit a stale touch, while a captured gesture keeps
      // its final Y coordinates throughout completion/snap-back settlement.
      if (touch.active) {
        if (touch.sequence !== this.touchSequence) {
          this.touchSequence = touch.sequence
          this.touchCaptured = true
        }

        if (touch.sequence === this.touchSequence) {
          this.touchStartY = clamp01((touch.startY - pageTop) / height)
          this.touchCurrentY = clamp01((touch.currentY - pageTop) / height)
        }
      } else if (this.touchCaptured && touch.sequence === this.touchSequence) {
        this.touchCurrentY = clamp01((touch.currentY - pageTop) / height)
      }
    },
  },
})
</script>

<style scoped>
.paper-sheet {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  isolation: isolate;
  contain: paint;
}

.paper-layer,
.paper-shadow,
.paper-edge {
  position: absolute;
  inset: 0;
}

.paper-target {
  z-index: 1;
}

.paper-current {
  z-index: 4;
  will-change: clip-path;
}

.paper-back {
  z-index: 5;
  background: #fff;
  will-change: clip-path;
  filter: drop-shadow(0 0 8px rgba(0, 0, 0, 0.22));
}

.paper-shadow {
  z-index: 3;
  will-change: clip-path, opacity;
}

.paper-edge {
  z-index: 6;
  background: rgba(250, 250, 250, 0.98);
  box-shadow: 0 0 8px rgba(0, 0, 0, 0.28);
  will-change: clip-path, opacity;
}
</style>
