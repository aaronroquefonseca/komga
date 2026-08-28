<template>
  <div
    :class="{'paged-reader-root': interactiveGestureEnabled}"
    :style="interactiveGestureEnabled ? {touchAction: vertical ? 'pan-x' : 'pan-y'} : undefined"
    v-touch="{
               left: () => {if(swipe && !interactiveGestureEnabled) {turnRight()}},
               right: () => {if(swipe && !interactiveGestureEnabled) {turnLeft()}},
               up: () => {if(swipe && !interactiveGestureEnabled) {verticalNext()}},
               down: () => {if(swipe && !interactiveGestureEnabled) {verticalPrev()}}
             }"
    @touchstart="followFingerStart"
    @touchmove="followFingerMove"
    @touchend="followFingerEnd"
    @touchcancel="followFingerCancel"
    @click.capture="onClickCapture"
  >
    <v-carousel v-model="carouselPage"
                :show-arrows="false"
                :continuous="false"
                :reverse="flipDirection"
                :vertical="vertical"
                :class="{'carousel-hidden': interactiveGestureEnabled}"
                hide-delimiters
                touchless
                height="100%"
    >
      <!--  Carousel: pages  -->
      <v-carousel-item v-for="(spread, i) in spreads"
                       :key="`spread${i}`"
                       :eager="eagerLoad(i)"
                       class="full-height"
                       :class="preRender(i) ? 'pre-render' : ''"
                       :transition="carouselAnimations ? undefined : false"
                       :reverse-transition="carouselAnimations ? undefined : false"
      >
        <div class="full-height d-flex flex-column justify-center">
          <div :class="`d-flex flex-row${flipDirection ? '-reverse' : ''} justify-center px-0 mx-0`">
            <img v-for="(page, j) in spread"
                 :alt="`Page ${page.number}`"
                 :key="`spread${i}-${j}`"
                 :src="page.url"
                 :class="imgClass(spread)"
                 class="img-fit-all"
            />
          </div>
        </div>
      </v-carousel-item>
    </v-carousel>

    <!-- Persistent renderer used only by Follow finger. Each spread keeps a stable key so
         committing a drag never swaps image src values between DOM nodes. -->
    <div v-if="interactiveGestureEnabled" class="drag-layer">
      <div v-for="spreadIndex in interactiveSpreadIndices"
           :key="`interactive-spread-${spreadIndex}`"
           class="drag-spread"
           :style="interactiveSpreadStyle(spreadIndex)"
      >
        <div class="full-height d-flex flex-column justify-center">
          <div :class="`d-flex flex-row${flipDirection ? '-reverse' : ''} justify-center px-0 mx-0`">
            <img v-for="(page, j) in spreads[spreadIndex]"
                 :alt="`Page ${page.number}`"
                 :key="`interactive-${spreadIndex}-${j}`"
                 :src="page.url"
                 :class="imgClass(spreads[spreadIndex])"
                 class="img-fit-all"
            />
          </div>
        </div>
      </div>
    </div>

    <!--  clickable zone: left  -->
    <div v-if="!vertical"
         @click="turnLeft()"
         class="left-quarter"
         style="z-index: 1;"
    />

    <!--  clickable zone: right  -->
    <div v-if="!vertical"
         @click="turnRight()"
         class="right-quarter"
         style="z-index: 1;"
    />

    <!--  clickable zone: top  -->
    <div v-if="vertical"
         @click="verticalPrev()"
         class="top-quarter"
         style="z-index: 1;"
    />

    <!--  clickable zone: bottom  -->
    <div v-if="vertical"
         @click="verticalNext()"
         class="bottom-quarter"
         style="z-index: 1;"
    />

    <!--  clickable zone: menu  -->
    <div @click="centerClick()"
         :class="`${vertical ? 'center-vertical' : 'center-horizontal'}`"
         style="z-index: 1;"
    />
  </div>
</template>

<script lang="ts">
import Vue from 'vue'
import {ReadingDirection} from '@/types/enum-books'
import {PagedReaderLayout, ScaleType} from '@/types/enum-reader'
import {shortcutsLTR, shortcutsRTL, shortcutsVertical} from '@/functions/shortcuts/paged-reader'
import {PageDtoWithUrl} from '@/types/komga-books'
import {buildSpreads} from '@/functions/book-spreads'
import {
  dragOffsetWithResistance,
  navigationDeltaForDrag,
  shouldCommitDrag,
} from '@/functions/paged-reader-drag'

export default Vue.extend({
  name: 'PagedReader',
  data: function () {
    return {
      logger: 'PagedReader',
      carouselPage: 0,
      spreads: [] as PageDtoWithUrl[][],
      suppressClickUntil: 0,
      dragSettleTimer: undefined as number | undefined,
      drag: {
        tracking: false,
        prepared: false,
        active: false,
        settling: false,
        settleCommit: false,
        settleJump: '' as '' | 'previous' | 'next',
        startX: 0,
        startY: 0,
        lastTime: 0,
        rawOffset: 0,
        offset: 0,
        velocity: 0,
        axisSize: 1,
        physicalDirection: 0,
        navigationDelta: 0,
        currentIndex: 0,
        targetIndex: null as number | null,
      },
    }
  },
  props: {
    pages: {
      type: Array as () => PageDtoWithUrl[],
      required: true,
    },
    page: {
      type: Number,
      required: true,
    },
    pageLayout: {
      type: String as () => PagedReaderLayout,
      required: true,
    },
    animations: {
      type: Boolean,
      required: true,
    },
    swipe: {
      type: Boolean,
      required: true,
    },
    followFinger: {
      type: Boolean,
      default: false,
    },
    readingDirection: {
      type: String as () => ReadingDirection,
      required: true,
    },
    scale: {
      type: String as () => ScaleType,
      required: true,
    },
  },
  watch: {
    pages: {
      handler(val) {
        this.spreads = buildSpreads(val, this.pageLayout)
      },
      immediate: true,
    },
    carouselPage(val, old) {
      this.$debug('[watch:carouselPage', `old:${old}`, `new:${val}`)
      if (this.carouselPage >= 0 && this.carouselPage < this.spreads.length && this.spreads.length > 0) {
        const currentSpread = this.spreads[this.carouselPage]
        const currentPage = currentSpread.length == 2 && currentSpread[1].mediaType ? currentSpread[1] : currentSpread[0]
        this.$emit('update:page', currentPage.number)
      } else {
        this.$emit('update:page', 1)
      }
    },
    page(val, old) {
      this.$debug('[watch:page]', `old:${old}`, `new:${val}`)
      const spreadIndex = this.toSpreadIndex(val)
      this.$debug('[watch:page]', `toSpreadIndex:${spreadIndex}`)
      this.carouselPage = spreadIndex
    },
    pageLayout: {
      handler(val) {
        const current = this.page
        this.spreads = buildSpreads(this.pages, val)
        this.carouselPage = this.toSpreadIndex(current)
      },
      immediate: true,
    },
  },
  created() {
    window.addEventListener('keydown', this.keyPressed)
  },
  destroyed() {
    window.removeEventListener('keydown', this.keyPressed)
    if (this.dragSettleTimer !== undefined) window.clearTimeout(this.dragSettleTimer)
  },
  computed: {
    shortcuts(): any {
      const shortcuts = []
      switch (this.readingDirection) {
        case ReadingDirection.LEFT_TO_RIGHT:
          shortcuts.push(...shortcutsLTR)
          break
        case ReadingDirection.RIGHT_TO_LEFT:
          shortcuts.push(...shortcutsRTL)
          break
        case ReadingDirection.VERTICAL:
          shortcuts.push(...shortcutsVertical)
          break
      }
      return this.$_.keyBy(shortcuts, x => x.key)
    },
    flipDirection(): boolean {
      return this.readingDirection === ReadingDirection.RIGHT_TO_LEFT
    },
    vertical(): boolean {
      return this.readingDirection === ReadingDirection.VERTICAL
    },
    currentSlide(): number {
      return this.carouselPage + 1
    },
    slidesCount(): number {
      return this.spreads.length
    },
    canPrev(): boolean {
      return this.currentSlide > 1
    },
    canNext(): boolean {
      return this.currentSlide < this.slidesCount
    },
    isDoublePages(): boolean {
      return this.pageLayout === PagedReaderLayout.DOUBLE_PAGES || this.pageLayout === PagedReaderLayout.DOUBLE_NO_COVER
    },
    interactiveGestureEnabled(): boolean {
      return this.swipe && this.animations && this.followFinger
    },
    carouselAnimations(): boolean {
      return this.animations && !this.interactiveGestureEnabled
    },
    interactiveBaseIndex(): number {
      return this.drag.prepared ? this.drag.currentIndex : this.carouselPage
    },
    interactiveSpreadIndices(): number[] {
      const result: number[] = []
      for (let i = this.interactiveBaseIndex - 2; i <= this.interactiveBaseIndex + 2; i++) {
        if (i >= 0 && i < this.spreads.length) result.push(i)
      }
      return result
    },
    physicalIndexDirection(): number {
      if (this.vertical) return 1
      return this.flipDirection ? -1 : 1
    },
  },
  methods: {
    keyPressed(e: KeyboardEvent) {
      this.shortcuts[e.key]?.execute(this)
    },
    imgClass(spread: PageDtoWithUrl[]): string {
      const double = spread.length > 1
      switch (this.scale) {
        case ScaleType.WIDTH:
          return double ? 'img-double-fit-width' : 'img-fit-width'
        case ScaleType.WIDTH_SHRINK_ONLY:
          return double ? 'img-double-fit-width-shrink-only' : 'img-fit-width-shrink-only'
        case ScaleType.HEIGHT:
          return 'img-fit-height'
        case ScaleType.SCREEN:
          return double ? 'img-double-fit-screen' : 'img-fit-screen'
        default:
          return 'img-fit-original'
      }
    },
    eagerLoad(spreadIndex: number): boolean {
      return Math.abs(this.carouselPage - spreadIndex) <= 2
    },
    preRender(spreadIndex: number): boolean {
      return Math.abs(this.carouselPage - spreadIndex) > (this.animations ? 1 : 0)
    },
    centerClick() {
      this.$emit('menu')
    },
    turnRight() {
      if (!this.vertical)
        this.flipDirection ? this.prev() : this.next()
    },
    turnLeft() {
      if (!this.vertical)
        this.flipDirection ? this.next() : this.prev()
    },
    verticalPrev() {
      if (this.vertical) this.prev()
    },
    verticalNext() {
      if (this.vertical) this.next()
    },
    prev() {
      if (this.interactiveGestureEnabled) {
        this.navigateInteractive(-1)
      } else if (this.canPrev) {
        this.carouselPage--
        window.scrollTo(0, 0)
      } else {
        this.$emit('jump-previous')
      }
    },
    next() {
      if (this.interactiveGestureEnabled) {
        this.navigateInteractive(1)
      } else if (this.canNext) {
        this.carouselPage++
        window.scrollTo(0, 0)
      } else {
        this.$emit('jump-next')
      }
    },
    navigateInteractive(delta: number) {
      if (this.drag.settling) this.finishDragSettlement()
      if (this.drag.tracking) return

      const targetIndex = this.carouselPage + delta
      if (targetIndex < 0 || targetIndex >= this.spreads.length) {
        this.$emit(delta < 0 ? 'jump-previous' : 'jump-next')
        return
      }

      const root = this.$el as HTMLElement
      this.drag.prepared = true
      this.drag.active = true
      this.drag.currentIndex = this.carouselPage
      this.drag.targetIndex = targetIndex
      this.drag.navigationDelta = delta
      this.drag.axisSize = Math.max(1, this.vertical ? root.clientHeight : root.clientWidth)
      this.drag.physicalDirection = -Math.sign(delta * this.physicalIndexDirection)
      this.drag.offset = 0

      window.requestAnimationFrame(() => this.settleDrag(true))
    },
    followFingerStart(event: TouchEvent) {
      if (!this.interactiveGestureEnabled || event.touches.length !== 1) return
      if (this.drag.settling) this.finishDragSettlement()

      const touch = event.touches[0]
      const root = this.$el as HTMLElement
      this.drag.tracking = true
      this.drag.prepared = true
      this.drag.active = false
      this.drag.startX = touch.clientX
      this.drag.startY = touch.clientY
      this.drag.lastTime = performance.now()
      this.drag.rawOffset = 0
      this.drag.offset = 0
      this.drag.velocity = 0
      this.drag.axisSize = Math.max(1, this.vertical ? root.clientHeight : root.clientWidth)
      this.drag.physicalDirection = 0
      this.drag.navigationDelta = 0
      this.drag.currentIndex = this.carouselPage
      this.drag.targetIndex = null
    },
    followFingerMove(event: TouchEvent) {
      if (!this.drag.tracking || event.touches.length !== 1) return

      const touch = event.touches[0]
      const deltaX = touch.clientX - this.drag.startX
      const deltaY = touch.clientY - this.drag.startY
      const primary = this.vertical ? deltaY : deltaX
      const cross = this.vertical ? deltaX : deltaY

      if (!this.drag.active) {
        if (Math.abs(primary) < 4) return
        if (Math.abs(primary) <= Math.abs(cross)) {
          this.resetDrag()
          return
        }
        this.drag.active = true
        this.suppressClickUntil = Date.now() + 350
      }

      event.preventDefault()

      const now = performance.now()
      const elapsed = Math.max(1, now - this.drag.lastTime)
      this.drag.velocity = (primary - this.drag.rawOffset) / elapsed
      this.drag.lastTime = now
      this.drag.rawOffset = primary
      this.drag.physicalDirection = Math.sign(primary)
      this.drag.navigationDelta = navigationDeltaForDrag(primary, this.vertical, this.flipDirection)

      const targetIndex = this.drag.currentIndex + this.drag.navigationDelta
      const hasTarget = targetIndex >= 0 && targetIndex < this.spreads.length
      this.drag.targetIndex = hasTarget ? targetIndex : null
      this.drag.offset = dragOffsetWithResistance(primary, this.drag.axisSize, hasTarget)
    },
    followFingerEnd() {
      if (!this.drag.tracking) return
      this.drag.tracking = false
      if (!this.drag.active) {
        this.resetDrag()
        return
      }

      const commit = shouldCommitDrag(
        this.drag.rawOffset,
        this.drag.axisSize,
        this.drag.velocity,
      )

      if (commit && this.drag.targetIndex !== null) {
        this.settleDrag(true)
      } else if (commit && this.drag.navigationDelta !== 0) {
        this.settleDrag(false, this.drag.navigationDelta < 0 ? 'previous' : 'next')
      } else {
        this.settleDrag(false)
      }
    },
    followFingerCancel() {
      if (!this.drag.tracking && !this.drag.prepared) return
      this.drag.tracking = false
      if (this.drag.active) this.settleDrag(false)
      else this.resetDrag()
    },
    settleDrag(commitTarget: boolean, jump?: 'previous' | 'next') {
      this.drag.settling = true
      this.drag.settleCommit = commitTarget && this.drag.targetIndex !== null
      this.drag.settleJump = jump || ''
      this.suppressClickUntil = Date.now() + 350

      if (this.drag.settleCommit) {
        this.drag.offset = this.drag.physicalDirection * this.drag.axisSize
      } else {
        this.drag.offset = 0
      }

      if (this.dragSettleTimer !== undefined) window.clearTimeout(this.dragSettleTimer)
      this.dragSettleTimer = window.setTimeout(() => this.finishDragSettlement(), 180)
    },
    finishDragSettlement() {
      if (this.dragSettleTimer !== undefined) window.clearTimeout(this.dragSettleTimer)

      const commitTarget = this.drag.settleCommit
      const targetIndex = this.drag.targetIndex
      const jump = this.drag.settleJump

      if (commitTarget && targetIndex !== null) {
        this.carouselPage = targetIndex
        window.scrollTo(0, 0)
      }

      this.resetDrag()

      if (jump === 'previous') this.$emit('jump-previous')
      if (jump === 'next') this.$emit('jump-next')
    },
    resetDrag() {
      this.drag.tracking = false
      this.drag.prepared = false
      this.drag.active = false
      this.drag.settling = false
      this.drag.settleCommit = false
      this.drag.settleJump = ''
      this.drag.rawOffset = 0
      this.drag.offset = 0
      this.drag.velocity = 0
      this.drag.physicalDirection = 0
      this.drag.navigationDelta = 0
      this.drag.currentIndex = this.carouselPage
      this.drag.targetIndex = null
      this.dragSettleTimer = undefined
    },
    interactiveSpreadStyle(spreadIndex: number): Record<string, string> {
      const baseIndex = this.interactiveBaseIndex
      const pageOffset = (spreadIndex - baseIndex) * this.physicalIndexDirection * 100
      const fingerOffset = this.drag.prepared ? this.drag.offset : 0
      const coordinate = `calc(${pageOffset}% + ${fingerOffset}px)`
      const transform = this.vertical
        ? `translate3d(0, ${coordinate}, 0)`
        : `translate3d(${coordinate}, 0, 0)`
      return {
        transform,
        transition: this.drag.settling ? 'transform 180ms cubic-bezier(0.22, 0.61, 0.36, 1)' : 'none',
      }
    },
    onClickCapture(event: MouseEvent) {
      if (Date.now() < this.suppressClickUntil) {
        event.preventDefault()
        event.stopPropagation()
      }
    },
    toSpreadIndex(i: number): number {
      this.$debug('[toSpreadIndex]', `i:${i}`, `isDoublePages:${this.isDoublePages}`)
      if (this.spreads.length > 0) {
        if (this.isDoublePages) {
          for (let j = 0; j < this.spreads.length; j++) {
            for (let k = 0; k < this.spreads[j].length; k++) {
              if (this.spreads[j][k].number === i) {
                return j
              }
            }
          }
        } else {
          return i - 1
        }
      }
      return i - 1
    },
  },
})
</script>
<style scoped>
.paged-reader-root {
  position: relative;
}

.full-height {
  height: 100%;
}

.carousel-hidden {
  visibility: hidden;
}

.drag-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 1;
}

.drag-spread {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  will-change: transform;
  backface-visibility: hidden;
}

.left-quarter {
  top: 0;
  left: 0;
  width: 25%;
  height: 100%;
  position: absolute;
}

.right-quarter {
  top: 0;
  right: 0;
  width: 25%;
  height: 100%;
  position: absolute;
}

.top-quarter {
  top: 0;
  height: 25%;
  width: 100%;
  position: absolute;
}

.bottom-quarter {
  bottom: 0;
  height: 25%;
  width: 100%;
  position: absolute;
}

.center-horizontal {
  top: 0;
  left: 25%;
  width: 50%;
  height: 100%;
  position: absolute;
}

.center-vertical {
  top: 25%;
  height: 50%;
  width: 100%;
  position: absolute;
}

.img-fit-all {
  object-fit: contain;
  object-position: center;
}

.img-fit-width {
  width: 100vw;
  min-height: 100vh;
  align-self: flex-start;
}

.img-double-fit-width {
  width: 50vw;
  min-height: 100vh;
  align-self: flex-start;
}

.img-fit-width-shrink-only {
  max-width: 100vw;
  align-self: flex-start;
}

.img-double-fit-width-shrink-only {
  max-width: 50vw;
  align-self: flex-start;
}

.img-fit-original {
  width: auto;
  height: auto;
}

.img-fit-height {
  min-height: 100vh;
  height: 100vh;
}

.img-fit-screen {
  width: 100vw;
  height: 100vh;
}

.img-double-fit-screen {
  max-width: 50vw;
  height: 100vh;
}

.pre-render {
  display: block !important;
  position: fixed;
  right: -1000vw;
  top: -1000vh;
}
</style>
