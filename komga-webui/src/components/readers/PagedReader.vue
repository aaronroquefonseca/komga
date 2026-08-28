<template>
  <div
    :class="{'paged-reader-root': customRendererEnabled}"
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
                :class="{'carousel-hidden': customRendererEnabled}"
                hide-delimiters
                touchless
                height="100%"
    >
      <!-- Carousel: preserve Komga/Vuetify's original renderer for Default and None. -->
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

    <!-- Persistent renderer for custom transitions and follow-finger Default. Stable spread
         keys keep the same image DOM nodes alive across consecutive transitions. -->
    <div v-if="customRendererEnabled" class="transition-layer">
      <div v-for="spreadIndex in interactiveSpreadIndices"
           :key="`transition-spread-${spreadIndex}`"
           class="transition-spread"
           :class="transitionSpreadClasses(spreadIndex)"
           :style="interactiveSpreadStyle(spreadIndex)"
      >
        <div class="full-height d-flex flex-column justify-center">
          <div :class="`d-flex flex-row${flipDirection ? '-reverse' : ''} justify-center px-0 mx-0`">
            <img v-for="(page, j) in spreads[spreadIndex]"
                 :alt="`Page ${page.number}`"
                 :key="`transition-${spreadIndex}-${j}`"
                 :src="page.url"
                 :class="imgClass(spreads[spreadIndex])"
                 class="img-fit-all"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- clickable zone: left -->
    <div v-if="!vertical"
         @click="turnLeft()"
         class="left-quarter"
         style="z-index: 1;"
    />

    <!-- clickable zone: right -->
    <div v-if="!vertical"
         @click="turnRight()"
         class="right-quarter"
         style="z-index: 1;"
    />

    <!-- clickable zone: top -->
    <div v-if="vertical"
         @click="verticalPrev()"
         class="top-quarter"
         style="z-index: 1;"
    />

    <!-- clickable zone: bottom -->
    <div v-if="vertical"
         @click="verticalNext()"
         class="bottom-quarter"
         style="z-index: 1;"
    />

    <!-- clickable zone: menu -->
    <div @click="centerClick()"
         :class="`${vertical ? 'center-vertical' : 'center-horizontal'}`"
         style="z-index: 1;"
    />
  </div>
</template>

<script lang="ts">
import Vue from 'vue'
import {ReadingDirection} from '@/types/enum-books'
import {PagedReaderLayout, PagedReaderTransition, ScaleType} from '@/types/enum-reader'
import {shortcutsLTR, shortcutsRTL, shortcutsVertical} from '@/functions/shortcuts/paged-reader'
import {PageDtoWithUrl} from '@/types/komga-books'
import {buildSpreads} from '@/functions/book-spreads'
import {
  dragOffsetWithResistance,
  navigationDeltaForDrag,
  shouldCommitDrag,
} from '@/functions/paged-reader-drag'
import {
  PageCurlVariant,
  pageCurlRotation,
  pageCurlVariantForStart,
  transitionProgress,
} from '@/functions/paged-reader-transition'

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
        curlVariant: 'middle' as PageCurlVariant,
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
    transition: {
      type: String as () => PagedReaderTransition,
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
    transition() {
      if (this.drag.settling) this.finishDragSettlement()
      else if (this.drag.prepared) this.resetDrag()
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
    transitionEnabled(): boolean {
      return this.transition !== PagedReaderTransition.NONE
    },
    interactiveGestureEnabled(): boolean {
      return this.swipe && this.followFinger && this.transitionEnabled
    },
    customRendererEnabled(): boolean {
      return this.interactiveGestureEnabled ||
        (this.transition !== PagedReaderTransition.DEFAULT && this.transition !== PagedReaderTransition.NONE)
    },
    carouselAnimations(): boolean {
      return this.transition === PagedReaderTransition.DEFAULT && !this.customRendererEnabled
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
    activePhysicalDirection(): number {
      if (this.drag.physicalDirection !== 0) return this.drag.physicalDirection
      if (this.drag.navigationDelta !== 0)
        return -Math.sign(this.drag.navigationDelta * this.physicalIndexDirection)
      return 0
    },
    transitionProgressValue(): number {
      return this.drag.prepared ? transitionProgress(this.drag.offset, this.drag.axisSize) : 0
    },
    transitionDuration(): number {
      switch (this.transition) {
        case PagedReaderTransition.PAGE_TURN:
          return 300
        case PagedReaderTransition.FADE:
          return 180
        default:
          return 220
      }
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
      return Math.abs(this.carouselPage - spreadIndex) > (this.transitionEnabled ? 1 : 0)
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
      if (this.customRendererEnabled) {
        this.navigateInteractive(-1)
      } else if (this.canPrev) {
        this.carouselPage--
        window.scrollTo(0, 0)
      } else {
        this.$emit('jump-previous')
      }
    },
    next() {
      if (this.customRendererEnabled) {
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
      this.drag.curlVariant = 'middle'

      this.$nextTick(() => {
        window.requestAnimationFrame(() => this.settleDrag(true))
      })
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
      this.drag.curlVariant = this.vertical ? 'middle' : pageCurlVariantForStart(touch.clientY, root.clientHeight)
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
      this.dragSettleTimer = window.setTimeout(() => this.finishDragSettlement(), this.transitionDuration)
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
      this.drag.curlVariant = 'middle'
      this.dragSettleTimer = undefined
    },
    transitionSpreadClasses(spreadIndex: number): Record<string, boolean> {
      const current = spreadIndex === this.interactiveBaseIndex
      return {
        'transition-current': current,
        'transition-target': this.drag.prepared && spreadIndex === this.drag.targetIndex,
        'page-turn-sheet': this.transition === PagedReaderTransition.PAGE_TURN && this.drag.prepared && current,
        'curl-to-left': this.activePhysicalDirection < 0,
        'curl-to-right': this.activePhysicalDirection > 0,
        'curl-top': this.drag.curlVariant === 'top',
        'curl-bottom': this.drag.curlVariant === 'bottom',
      }
    },
    idleSpreadStyle(spreadIndex: number): Record<string, string> {
      if (spreadIndex === this.carouselPage) {
        return {
          transform: 'translate3d(0, 0, 0)',
          opacity: '1',
          zIndex: '2',
        }
      }
      return {
        transform: 'translate3d(0, 0, 0)',
        opacity: '0',
        zIndex: '0',
      }
    },
    interactiveSpreadStyle(spreadIndex: number): Record<string, string> {
      if (!this.drag.prepared) return this.idleSpreadStyle(spreadIndex)

      const baseIndex = this.interactiveBaseIndex
      const isCurrent = spreadIndex === baseIndex
      const isTarget = spreadIndex === this.drag.targetIndex
      const progress = this.transitionProgressValue
      const offset = this.drag.offset
      const direction = this.activePhysicalDirection
      const transitionCss = this.drag.settling
        ? `transform ${this.transitionDuration}ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity ${this.transitionDuration}ms ease, filter ${this.transitionDuration}ms ease`
        : 'none'

      if (!isCurrent && !isTarget && this.transition !== PagedReaderTransition.DEFAULT && this.transition !== PagedReaderTransition.PUSH) {
        return {
          transform: 'translate3d(0, 0, 0)',
          opacity: '0',
          zIndex: '0',
          transition: transitionCss,
        }
      }

      switch (this.transition) {
        case PagedReaderTransition.COVER: {
          if (isCurrent) {
            return {transform: 'translate3d(0, 0, 0)', opacity: '1', zIndex: '1', transition: transitionCss}
          }
          if (isTarget) {
            const start = -direction * 100
            const coordinate = this.vertical
              ? `calc(${start}% + ${offset}px)`
              : `calc(${start}% + ${offset}px)`
            return {
              transform: this.vertical ? `translate3d(0, ${coordinate}, 0)` : `translate3d(${coordinate}, 0, 0)`,
              opacity: '1',
              zIndex: '3',
              filter: `drop-shadow(${direction * 10}px 0 12px rgba(0, 0, 0, 0.28))`,
              transition: transitionCss,
            }
          }
          break
        }
        case PagedReaderTransition.REVEAL: {
          if (isCurrent) {
            return {
              transform: this.vertical ? `translate3d(0, ${offset}px, 0)` : `translate3d(${offset}px, 0, 0)`,
              opacity: '1',
              zIndex: '3',
              filter: `drop-shadow(${-direction * 10}px 0 12px rgba(0, 0, 0, 0.24))`,
              transition: transitionCss,
            }
          }
          if (isTarget) {
            const scale = 0.985 + progress * 0.015
            return {transform: `translate3d(0, 0, 0) scale(${scale})`, opacity: '1', zIndex: '1', transition: transitionCss}
          }
          break
        }
        case PagedReaderTransition.PARALLAX: {
          if (isCurrent) {
            return {
              transform: this.vertical ? `translate3d(0, ${offset}px, 0)` : `translate3d(${offset}px, 0, 0)`,
              opacity: '1',
              zIndex: '3',
              transition: transitionCss,
            }
          }
          if (isTarget) {
            const start = -direction * 35
            const parallaxOffset = offset * 0.35
            const coordinate = `calc(${start}% + ${parallaxOffset}px)`
            const scale = 0.985 + progress * 0.015
            return {
              transform: this.vertical
                ? `translate3d(0, ${coordinate}, 0) scale(${scale})`
                : `translate3d(${coordinate}, 0, 0) scale(${scale})`,
              opacity: '1',
              zIndex: '1',
              transition: transitionCss,
            }
          }
          break
        }
        case PagedReaderTransition.FADE: {
          if (isCurrent) {
            return {transform: 'translate3d(0, 0, 0)', opacity: `${1 - progress}`, zIndex: '3', transition: transitionCss}
          }
          if (isTarget) {
            return {transform: 'translate3d(0, 0, 0)', opacity: `${progress}`, zIndex: '2', transition: transitionCss}
          }
          break
        }
        case PagedReaderTransition.PAGE_TURN: {
          if (isCurrent) {
            const rotation = pageCurlRotation(progress, direction)
            const edge = direction < 0 ? 'left' : 'right'
            const verticalOrigin = this.drag.curlVariant === 'top' ? 'top' : this.drag.curlVariant === 'bottom' ? 'bottom' : 'center'
            const cornerTilt = this.drag.curlVariant === 'top'
              ? -direction * progress * 3.5
              : this.drag.curlVariant === 'bottom'
                ? direction * progress * 3.5
                : 0
            const verticalShift = this.drag.curlVariant === 'top'
              ? -progress * 1.5
              : this.drag.curlVariant === 'bottom'
                ? progress * 1.5
                : 0
            const transform = this.vertical
              ? `rotateX(${-rotation}deg)`
              : `translate3d(0, ${verticalShift}%, 0) rotateY(${rotation}deg) rotateZ(${cornerTilt}deg)`
            const transformOrigin = this.vertical
              ? `${direction < 0 ? 'top' : 'bottom'} center`
              : `${edge} ${verticalOrigin}`
            return {
              transform,
              transformOrigin,
              opacity: '1',
              zIndex: '4',
              filter: `drop-shadow(${direction * 14}px 2px ${8 + progress * 16}px rgba(0, 0, 0, ${0.18 + progress * 0.28}))`,
              '--curl-shadow-opacity': `${Math.min(0.55, progress * 0.55)}`,
              transition: transitionCss,
            }
          }
          if (isTarget) {
            const scale = 0.975 + progress * 0.025
            return {
              transform: `translate3d(0, 0, 0) scale(${scale})`,
              opacity: `${0.8 + progress * 0.2}`,
              zIndex: '1',
              transition: transitionCss,
            }
          }
          break
        }
        case PagedReaderTransition.PUSH:
        case PagedReaderTransition.DEFAULT:
        default: {
          const pageOffset = (spreadIndex - baseIndex) * this.physicalIndexDirection * 100
          const coordinate = `calc(${pageOffset}% + ${offset}px)`
          const currentScale = this.transition === PagedReaderTransition.PUSH && isCurrent ? 1 - progress * 0.018 : 1
          const targetScale = this.transition === PagedReaderTransition.PUSH && isTarget ? 0.982 + progress * 0.018 : 1
          const scale = isCurrent ? currentScale : isTarget ? targetScale : 1
          return {
            transform: this.vertical
              ? `translate3d(0, ${coordinate}, 0) scale(${scale})`
              : `translate3d(${coordinate}, 0, 0) scale(${scale})`,
            opacity: '1',
            zIndex: isTarget ? '3' : isCurrent ? '2' : '1',
            filter: this.transition === PagedReaderTransition.PUSH && (isCurrent || isTarget)
              ? `drop-shadow(${direction * 8}px 0 10px rgba(0, 0, 0, ${0.08 + progress * 0.14}))`
              : 'none',
            transition: transitionCss,
          }
        }
      }

      return {opacity: '0', zIndex: '0', transition: transitionCss}
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

.transition-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 1;
  perspective: 1800px;
  transform-style: preserve-3d;
}

.transition-spread {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  will-change: transform, opacity, filter;
  backface-visibility: hidden;
  transform-style: preserve-3d;
}

.page-turn-sheet::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: var(--curl-shadow-opacity, 0);
}

.page-turn-sheet.curl-to-left::after {
  background: linear-gradient(to left, rgba(255, 255, 255, 0.08), rgba(0, 0, 0, 0.28));
}

.page-turn-sheet.curl-to-right::after {
  background: linear-gradient(to right, rgba(255, 255, 255, 0.08), rgba(0, 0, 0, 0.28));
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
