<template>
  <div class="paper-sheet" aria-hidden="true">
    <!-- The destination page is a single uninterrupted sheet underneath the
         page being turned. This is the same basic illusion MangaBox uses: page
         clipping and lighting, not a collection of independently rotating tiles. -->
    <div class="paper-layer paper-target">
      <paged-reader-spread
        :spread="backSpread"
        :flip-direction="flipDirection"
        :scale="scale"
      />
    </div>

    <!-- One continuous front page. Its only deformation is the single fold
         boundary described by clip-path. -->
    <div class="paper-layer paper-front" :style="frontStyle">
      <paged-reader-spread
        :spread="frontSpread"
        :flip-direction="flipDirection"
        :scale="scale"
      />
    </div>

    <!-- Back of the physical page. It deliberately contains the destination
         page, as requested, and is clipped to one continuous folded band. -->
    <div class="paper-layer paper-backface" :style="backfaceStyle">
      <paged-reader-spread
        :spread="backSpread"
        :flip-direction="flipDirection"
        :scale="scale"
      />
    </div>

    <div class="paper-fold-tone" :style="foldToneStyle" />
    <div class="paper-drop-shadow" :style="shadowStyle" />
    <div class="paper-highlight" :style="highlightStyle" />
    <div class="paper-fore-edge" :style="edgeStyle" />
  </div>
</template>

<script lang="ts">
import Vue from 'vue'
import PagedReaderSpread from '@/components/readers/PagedReaderSpread.vue'
import {PageDtoWithUrl} from '@/types/komga-books'
import {ScaleType} from '@/types/enum-reader'
import {
  PageCurlVariant,
  PaperCurlFoldGeometry,
  paperCurlFoldGeometry,
} from '@/functions/paged-reader-transition'

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
    variant: {
      type: String as () => PageCurlVariant,
      required: true,
    },
  },
  computed: {
    direction(): number {
      return Math.sign(this.physicalDirection || -1)
    },
    geometry(): PaperCurlFoldGeometry {
      return paperCurlFoldGeometry(this.progress, this.direction, this.variant)
    },
    frontClip(): string {
      const {seamTop, seamBottom} = this.geometry
      if (this.direction < 0) {
        return `polygon(0 0, ${seamTop}% 0, ${seamBottom}% 100%, 0 100%)`
      }
      return `polygon(${seamTop}% 0, 100% 0, 100% 100%, ${seamBottom}% 100%)`
    },
    foldClip(): string {
      const {seamTop, seamBottom, foldTop, foldBottom} = this.geometry
      return `polygon(${seamTop}% 0, ${foldTop}% 0, ${foldBottom}% 100%, ${seamBottom}% 100%)`
    },
    shadowClip(): string {
      const {seamTop, seamBottom, shadowTop, shadowBottom} = this.geometry
      return `polygon(${seamTop}% 0, ${shadowTop}% 0, ${shadowBottom}% 100%, ${seamBottom}% 100%)`
    },
    frontStyle(): Record<string, string> {
      return {
        clipPath: this.frontClip,
        WebkitClipPath: this.frontClip,
      }
    },
    backfaceStyle(): Record<string, string> {
      const arch = Math.sin(Math.max(0, Math.min(1, this.progress)) * Math.PI)
      return {
        clipPath: this.foldClip,
        WebkitClipPath: this.foldClip,
        filter: `brightness(${0.72 + arch * 0.10}) saturate(${0.82 + arch * 0.08})`,
      }
    },
    foldToneStyle(): Record<string, string> {
      const gradient = this.direction < 0
        ? 'linear-gradient(to right, rgba(255,255,255,0.34), rgba(255,255,255,0.05) 35%, rgba(0,0,0,0.24) 100%)'
        : 'linear-gradient(to left, rgba(255,255,255,0.34), rgba(255,255,255,0.05) 35%, rgba(0,0,0,0.24) 100%)'
      return {
        clipPath: this.foldClip,
        WebkitClipPath: this.foldClip,
        background: gradient,
        opacity: `${Math.sin(Math.max(0, Math.min(1, this.progress)) * Math.PI)}`,
      }
    },
    shadowStyle(): Record<string, string> {
      const gradient = this.direction < 0
        ? 'linear-gradient(to right, rgba(0,0,0,0.46), rgba(0,0,0,0.18) 42%, rgba(0,0,0,0) 100%)'
        : 'linear-gradient(to left, rgba(0,0,0,0.46), rgba(0,0,0,0.18) 42%, rgba(0,0,0,0) 100%)'
      return {
        clipPath: this.shadowClip,
        WebkitClipPath: this.shadowClip,
        background: gradient,
        opacity: `${Math.sin(Math.max(0, Math.min(1, this.progress)) * Math.PI)}`,
      }
    },
    highlightStyle(): Record<string, string> {
      const {seamTop, seamBottom} = this.geometry
      const width = Math.sin(Math.max(0, Math.min(1, this.progress)) * Math.PI) * 2.8
      const highlightTop = Math.max(0, Math.min(100, seamTop + this.direction * width))
      const highlightBottom = Math.max(0, Math.min(100, seamBottom + this.direction * width))
      const clip = `polygon(${seamTop}% 0, ${highlightTop}% 0, ${highlightBottom}% 100%, ${seamBottom}% 100%)`
      return {
        clipPath: clip,
        WebkitClipPath: clip,
        background: 'rgba(255,255,255,0.34)',
        opacity: `${Math.sin(Math.max(0, Math.min(1, this.progress)) * Math.PI)}`,
      }
    },
    edgeStyle(): Record<string, string> {
      const {seamTop, seamBottom} = this.geometry
      const width = Math.sin(Math.max(0, Math.min(1, this.progress)) * Math.PI) * 0.7
      const edgeTop = Math.max(0, Math.min(100, seamTop - this.direction * width))
      const edgeBottom = Math.max(0, Math.min(100, seamBottom - this.direction * width))
      const clip = `polygon(${seamTop}% 0, ${edgeTop}% 0, ${edgeBottom}% 100%, ${seamBottom}% 100%)`
      return {
        clipPath: clip,
        WebkitClipPath: clip,
        opacity: `${Math.sin(Math.max(0, Math.min(1, this.progress)) * Math.PI)}`,
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
.paper-fold-tone,
.paper-drop-shadow,
.paper-highlight,
.paper-fore-edge {
  position: absolute;
  inset: 0;
}

.paper-target {
  z-index: 1;
}

.paper-front {
  z-index: 4;
  will-change: clip-path;
}

.paper-backface {
  z-index: 5;
  will-change: clip-path, filter;
}

.paper-fold-tone {
  z-index: 6;
  will-change: clip-path, opacity;
}

.paper-drop-shadow {
  z-index: 3;
  will-change: clip-path, opacity;
}

.paper-highlight {
  z-index: 7;
  will-change: clip-path, opacity;
}

.paper-fore-edge {
  z-index: 8;
  background: rgba(245, 245, 245, 0.9);
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.38);
  will-change: clip-path, opacity;
}
</style>
