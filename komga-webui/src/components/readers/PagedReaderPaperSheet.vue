<template>
  <div class="paper-sheet" :style="sheetStyle" aria-hidden="true">
    <!-- The destination page stays flat underneath the sheet for the entire
         gesture. Areas uncovered by the bend therefore reveal real content. -->
    <div class="paper-layer paper-target">
      <paged-reader-spread
        :spread="backSpread"
        :flip-direction="flipDirection"
        :scale="scale"
      />
    </div>

    <!-- Stationary part of the current page. The remainder is duplicated into
         the warped flap below, so the image stays continuous at the fold seam. -->
    <div class="paper-layer paper-front" :style="frontStyle">
      <paged-reader-spread
        :spread="frontSpread"
        :flip-direction="flipDirection"
        :scale="scale"
      />
    </div>

    <!-- One continuous physical flap, never strips or tiles. Its front is the
         current page and its back is the destination page. The same clipped
         region is rotated through 180 degrees around the moving fold line. -->
    <div class="paper-flap" :style="flapStyle">
      <div class="paper-flap-face paper-flap-front" :style="flapFrontStyle">
        <paged-reader-spread
          :spread="frontSpread"
          :flip-direction="flipDirection"
          :scale="scale"
        />
        <div class="paper-flap-shade" :style="frontShadeStyle" />
      </div>

      <div class="paper-flap-face paper-flap-back" :style="flapBackStyle">
        <paged-reader-spread
          :spread="backSpread"
          :flip-direction="flipDirection"
          :scale="scale"
        />
        <div class="paper-flap-shade" :style="backShadeStyle" />
      </div>
    </div>

    <!-- These remain flat lighting cues around the moving crease. They do not
         carry page content; the warped flap above now does that job. -->
    <div class="paper-drop-shadow" :style="shadowStyle" />
    <div class="paper-crease-highlight" :style="highlightStyle" />
  </div>
</template>

<script lang="ts">
import Vue from 'vue'
import PagedReaderSpread from '@/components/readers/PagedReaderSpread.vue'
import {PageDtoWithUrl} from '@/types/komga-books'
import {ScaleType} from '@/types/enum-reader'
import {
  PageCurlVariant,
  PaperCurlWarpGeometry,
  paperCurlWarpGeometry,
} from '@/functions/paged-reader-transition'

// Paper-curl visual tuning knobs. Geometry that changes the actual path of the
// sheet lives in paperCurlWarpGeometry(); lighting/perspective stays here so we
// can calibrate both independently after real touch tests.
const PAPER_CURL_TUNING = {
  perspectivePx: 1450,
  seamOverlapPercent: 0.18,
  frontDarken: 0.12,
  backBaseBrightness: 0.76,
  backArchBrightness: 0.10,
  maxShadeOpacity: 0.46,
  maxShadowOpacity: 0.48,
  shadowWidthPercent: 12,
  highlightWidthPercent: 1.4,
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
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
    variant: {
      type: String as () => PageCurlVariant,
      required: true,
    },
  },
  computed: {
    direction(): number {
      return Math.sign(this.physicalDirection || -1)
    },
    clampedProgress(): number {
      return Math.max(0, Math.min(1, this.progress))
    },
    arch(): number {
      return Math.sin(this.clampedProgress * Math.PI)
    },
    geometry(): PaperCurlWarpGeometry {
      return paperCurlWarpGeometry(this.clampedProgress, this.direction, this.variant)
    },
    sheetStyle(): Record<string, string> {
      return {
        perspective: `${PAPER_CURL_TUNING.perspectivePx}px`,
      }
    },
    frontClip(): string {
      const {seamTop, seamBottom} = this.geometry
      if (this.direction < 0) {
        return `polygon(0 0, ${seamTop}% 0, ${seamBottom}% 100%, 0 100%)`
      }
      return `polygon(${seamTop}% 0, 100% 0, 100% 100%, ${seamBottom}% 100%)`
    },
    flapClip(): string {
      const overlap = this.direction * PAPER_CURL_TUNING.seamOverlapPercent
      const seamTop = clampPercent(this.geometry.seamTop + overlap)
      const seamBottom = clampPercent(this.geometry.seamBottom + overlap)

      if (this.direction < 0) {
        return `polygon(${seamTop}% 0, 100% 0, 100% 100%, ${seamBottom}% 100%)`
      }
      return `polygon(0 0, ${seamTop}% 0, ${seamBottom}% 100%, 0 100%)`
    },
    frontStyle(): Record<string, string> {
      return {
        clipPath: this.frontClip,
        WebkitClipPath: this.frontClip,
      }
    },
    flapStyle(): Record<string, string> {
      const {seamTop, seamBottom, rotationY, cornerRotation, verticalShift, lift} = this.geometry
      const originX = this.variant === 'top'
        ? seamTop
        : this.variant === 'bottom'
          ? seamBottom
          : (seamTop + seamBottom) / 2
      const originY = this.variant === 'top'
        ? 0
        : this.variant === 'bottom'
          ? 100
          : 50

      return {
        transformOrigin: `${originX}% ${originY}%`,
        transform: `translate3d(0, ${verticalShift}%, ${lift}px) rotateZ(${cornerRotation}deg) rotateY(${rotationY}deg)`,
      }
    },
    flapFrontStyle(): Record<string, string> {
      const brightness = 1 - this.arch * PAPER_CURL_TUNING.frontDarken
      return {
        clipPath: this.flapClip,
        WebkitClipPath: this.flapClip,
        filter: `brightness(${brightness})`,
      }
    },
    flapBackStyle(): Record<string, string> {
      const brightness = PAPER_CURL_TUNING.backBaseBrightness +
        this.arch * PAPER_CURL_TUNING.backArchBrightness
      return {
        clipPath: this.flapClip,
        WebkitClipPath: this.flapClip,
        filter: `brightness(${brightness}) saturate(${0.86 + this.arch * 0.08})`,
      }
    },
    frontShadeStyle(): Record<string, string> {
      const gradient = this.direction < 0
        ? 'linear-gradient(to left, rgba(255,255,255,0.08), rgba(0,0,0,0.08) 58%, rgba(0,0,0,0.42) 100%)'
        : 'linear-gradient(to right, rgba(255,255,255,0.08), rgba(0,0,0,0.08) 58%, rgba(0,0,0,0.42) 100%)'
      return {
        background: gradient,
        opacity: `${this.arch * PAPER_CURL_TUNING.maxShadeOpacity}`,
      }
    },
    backShadeStyle(): Record<string, string> {
      const gradient = this.direction < 0
        ? 'linear-gradient(to right, rgba(255,255,255,0.24), rgba(0,0,0,0.08) 45%, rgba(0,0,0,0.36) 100%)'
        : 'linear-gradient(to left, rgba(255,255,255,0.24), rgba(0,0,0,0.08) 45%, rgba(0,0,0,0.36) 100%)'
      return {
        background: gradient,
        opacity: `${this.arch * PAPER_CURL_TUNING.maxShadeOpacity}`,
      }
    },
    shadowStyle(): Record<string, string> {
      const {seamTop, seamBottom} = this.geometry
      const width = this.arch * PAPER_CURL_TUNING.shadowWidthPercent
      const shadowTop = clampPercent(seamTop - this.direction * width)
      const shadowBottom = clampPercent(seamBottom - this.direction * width)
      const clip = `polygon(${seamTop}% 0, ${shadowTop}% 0, ${shadowBottom}% 100%, ${seamBottom}% 100%)`
      const gradient = this.direction < 0
        ? 'linear-gradient(to right, rgba(0,0,0,0.52), rgba(0,0,0,0.16) 48%, rgba(0,0,0,0) 100%)'
        : 'linear-gradient(to left, rgba(0,0,0,0.52), rgba(0,0,0,0.16) 48%, rgba(0,0,0,0) 100%)'

      return {
        clipPath: clip,
        WebkitClipPath: clip,
        background: gradient,
        opacity: `${this.arch * PAPER_CURL_TUNING.maxShadowOpacity}`,
      }
    },
    highlightStyle(): Record<string, string> {
      const {seamTop, seamBottom} = this.geometry
      const width = this.arch * PAPER_CURL_TUNING.highlightWidthPercent
      const highlightTop = clampPercent(seamTop + this.direction * width)
      const highlightBottom = clampPercent(seamBottom + this.direction * width)
      const clip = `polygon(${seamTop}% 0, ${highlightTop}% 0, ${highlightBottom}% 100%, ${seamBottom}% 100%)`

      return {
        clipPath: clip,
        WebkitClipPath: clip,
        background: 'rgba(255,255,255,0.5)',
        opacity: `${this.arch * 0.9}`,
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
  transform-style: preserve-3d;
}

.paper-layer,
.paper-flap,
.paper-flap-face,
.paper-flap-shade,
.paper-drop-shadow,
.paper-crease-highlight {
  position: absolute;
  inset: 0;
}

.paper-target {
  z-index: 1;
}

.paper-front {
  z-index: 3;
  will-change: clip-path;
}

.paper-flap {
  z-index: 5;
  transform-style: preserve-3d;
  will-change: transform;
}

.paper-flap-face {
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  transform-style: preserve-3d;
  will-change: clip-path, filter;
}

.paper-flap-front {
  transform: rotateY(0deg);
}

.paper-flap-back {
  transform: rotateY(180deg);
}

.paper-flap-shade {
  z-index: 2;
}

.paper-drop-shadow {
  z-index: 2;
  will-change: clip-path, opacity;
}

.paper-crease-highlight {
  z-index: 6;
  will-change: clip-path, opacity;
}
</style>
