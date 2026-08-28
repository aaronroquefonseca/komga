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

    <!-- For this first faithful curl implementation the physical backside is
         intentionally plain white. A later MangaBox-style pass can add page
         pairing/back-page artwork without changing the fold geometry. -->
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
  paperCurlDynamicGeometry,
} from '@/functions/paged-reader-transition'
import {pagedReaderTouchSnapshot} from '@/functions/paged-reader-touch'

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
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
    // Retained for compatibility with the reader API. The new curl no longer
    // chooses one of three canned shapes: a live gesture supplies continuous Y
    // geometry, while non-interactive turns use the middle automatically.
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
  }),
  watch: {
    progress: {
      handler() {
        this.syncTouchGeometry()
      },
      immediate: true,
    },
  },
  mounted() {
    this.syncTouchGeometry()
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
      )
    },
    currentClip(): string {
      const {seamTop, seamBottom} = this.geometry
      if (this.direction < 0) {
        return `polygon(0 0, ${seamTop}% 0, ${seamBottom}% 100%, 0 100%)`
      }
      return `polygon(${seamTop}% 0, 100% 0, 100% 100%, ${seamBottom}% 100%)`
    },
    backClip(): string {
      const {seamTop, seamBottom} = this.geometry
      if (this.direction < 0) {
        return `polygon(${seamTop}% 0, 100% 0, 100% 100%, ${seamBottom}% 100%)`
      }
      return `polygon(0 0, ${seamTop}% 0, ${seamBottom}% 100%, 0 100%)`
    },
    shadowClip(): string {
      const {seamTop, seamBottom, shadowTop, shadowBottom} = this.geometry
      return `polygon(${seamTop}% 0, ${shadowTop}% 0, ${shadowBottom}% 100%, ${seamBottom}% 100%)`
    },
    currentStyle(): Record<string, string> {
      return {
        clipPath: this.currentClip,
        WebkitClipPath: this.currentClip,
      }
    },
    backStyle(): Record<string, string> {
      return {
        clipPath: this.backClip,
        WebkitClipPath: this.backClip,
      }
    },
    shadowStyle(): Record<string, string> {
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
      const {seamTop, seamBottom} = this.geometry
      const width = 0.45
      const edgeTop = clamp01((seamTop + this.direction * width) / 100) * 100
      const edgeBottom = clamp01((seamBottom + this.direction * width) / 100) * 100
      const clip = `polygon(${seamTop}% 0, ${edgeTop}% 0, ${edgeBottom}% 100%, ${seamBottom}% 100%)`
      return {
        clipPath: clip,
        WebkitClipPath: clip,
        opacity: `${Math.sin(clamp01(this.progress) * Math.PI)}`,
      }
    },
  },
  methods: {
    syncTouchGeometry() {
      if (!(this.$el instanceof HTMLElement)) return
      const touch = pagedReaderTouchSnapshot()

      // Only adopt a gesture while it is actually active. This means a normal
      // tap/keyboard page turn cannot accidentally reuse a stale drag from some
      // other part of the UI. Once captured, the final coordinates are retained
      // while Komga animates the curl to completion or back to rest.
      if (touch.active) {
        if (touch.sequence !== this.touchSequence) {
          this.touchSequence = touch.sequence
          this.touchCaptured = true
        }

        if (touch.sequence === this.touchSequence) {
          const rect = (this.$el as HTMLElement).getBoundingClientRect()
          const height = Math.max(1, rect.height)
          this.touchStartY = clamp01((touch.startY - rect.top) / height)
          this.touchCurrentY = clamp01((touch.currentY - rect.top) / height)
        }
      } else if (this.touchCaptured && touch.sequence === this.touchSequence) {
        const rect = (this.$el as HTMLElement).getBoundingClientRect()
        const height = Math.max(1, rect.height)
        this.touchCurrentY = clamp01((touch.currentY - rect.top) / height)
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
  filter: drop-shadow(0 0 8px rgba(0, 0, 0, 0.18));
}

.paper-shadow {
  z-index: 3;
  will-change: clip-path, opacity;
}

.paper-edge {
  z-index: 6;
  background: rgba(250, 250, 250, 0.96);
  box-shadow: 0 0 8px rgba(0, 0, 0, 0.28);
  will-change: clip-path, opacity;
}
</style>
