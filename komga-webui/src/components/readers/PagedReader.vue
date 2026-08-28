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
    <!-- Preserve Komga's original carousel exactly for Slide (Default) without
         Follow finger, and for None. -->
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
      <v-carousel-item v-for="(spread, i) in spreads"
                       :key="`spread${i}`"
                       :eager="eagerLoad(i)"
                       class="full-height"
                       :class="preRender(i) ? 'pre-render' : ''"
                       :transition="carouselAnimations ? undefined : false"
                       :reverse-transition="carouselAnimations ? undefined : false"
      >
        <paged-reader-spread
          :spread="spread"
          :flip-direction="flipDirection"
          :scale="scale"
        />
      </v-carousel-item>
    </v-carousel>

    <!-- Custom renderer. All spread wrappers stay mounted with stable keys. -->
    <div v-if="customRendererEnabled"
         class="transition-layer"
         :class="{'transition-layer-active': drag.prepared}"
    >
      <div v-for="(spread, spreadIndex) in spreads"
           :key="`transition-spread-${spreadIndex}`"
           class="transition-spread"
           :class="transitionSpreadClasses(spreadIndex)"
           :style="customSpreadStyle(spreadIndex)"
      >
        <template v-if="shouldRenderCustomSpread(spreadIndex)">
          <template v-if="isPaperCurlCurrent(spreadIndex)">
            <div v-for="segment in paperSegments"
                 :key="`paper-segment-${spreadIndex}-${segment}`"
                 class="paper-segment"
                 :style="paperSegmentStyle(segment)"
            >
              <div class="paper-segment-content"
                   :style="paperSegmentContentStyle(segment)"
              >
                <paged-reader-spread
                  :spread="spread"
                  :flip-direction="flipDirection"
                  :scale="scale"
                />
              </div>
            </div>
          </template>

          <paged-reader-spread
            v-else
            :spread="spread"
            :flip-direction="flipDirection"
            :scale="scale"
          />
        </template>
      </div>
    </div>

    <div v-if="!vertical"
         @click="turnLeft()"
         class="left-quarter"
         style="z-index: 1;"
    />

    <div v-if="!vertical"
         @click="turnRight()"
         class="right-quarter"
         style="z-index: 1;"
    />

    <div v-if="vertical"
         @click="verticalPrev()"
         class="top-quarter"
         style="z-index: 1;"
    />

    <div v-if="vertical"
         @click="verticalNext()"
         class="bottom-quarter"
         style="z-index: 1;"
    />

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
import PagedReaderSpread from '@/components/readers/PagedReaderSpread.vue'
import {
  dragOffsetWithResistance,
  navigationDeltaForDrag,
  shouldCommitDrag,
} from '@/functions/paged-reader-drag'
import {
  PageCurlVariant,
  pageCurlRotation,
  pageCurlVariantForStart,
  paperCurlSegmentPhase,
  transitionProgress,
} from '@/functions/paged-reader-transition'

export default Vue.extend({
  name: 'PagedReader',
  components: {PagedReaderSpread},
  data: function () {
    return {
      logger: 'PagedReader',
      carouselPage: 0,
      spreads: [] as PageDtoWithUrl[][],
      suppressClickUntil: 0,
      dragAnimationFrame: undefined as number | undefined,
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
      if (this.drag.settling) this.finishDragSettlement(true)
      else if (this.drag.prepared) this.resetDrag()
    },
  },
  created() {
    window.addEventListener('keydown', this.keyPressed)
  },
  destroyed() {
    window.removeEventListener('keydown', this.keyPressed)
    this.cancelDragAnimation()
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
      return this.pageLayout === PagedReaderLayout.DOUBLE_PAGES ||
        this.pageLayout === PagedReaderLayout.DOUBLE_NO_COVER
    },
    transitionEnabled(): boolean {
      return this.transition !== PagedReaderTransition.NONE
    },
    interactiveGestureEnabled(): boolean {
      return this.swipe && this.followFinger && this.transitionEnabled
    },
    customRendererEnabled(): boolean {
      return this.interactiveGestureEnabled ||
        (this.transition !== PagedReaderTransition.DEFAULT &&
          this.transition !== PagedReaderTransition.NONE)
    },
    carouselAnimations(): boolean {
      return this.transition === PagedReaderTransition.DEFAULT && !this.customRendererEnabled
    },
    transitionBaseIndex(): number {
      return this.drag.prepared ? this.drag.currentIndex : this.carouselPage
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
        case PagedReaderTransition.PAPER_CURL:
          return 300
        case PagedReaderTransition.FADE:
        case PagedReaderTransition.SOFT_WIPE:
          return 190
        default:
          return 220
      }
    },
    paperSegments(): number[] {
      return Array.from({length: 18}, (_, i) => i)
    },
  },
  methods: {
    keyPressed(e: KeyboardEvent) {
      this.shortcuts[e.key]?.execute(this)
    },
    eagerLoad(spreadIndex: number): boolean {
      return Math.abs(this.carouselPage - spreadIndex) <= 2
    },
    preRender(spreadIndex: number): boolean {
      return Math.abs(this.carouselPage - spreadIndex) > (this.transitionEnabled ? 1 : 0)
    },
    shouldRenderCustomSpread(spreadIndex: number): boolean {
      if (!this.customRendererEnabled) return false
      if (Math.abs(this.carouselPage - spreadIndex) <= 3) return true
      if (this.drag.prepared && Math.abs(this.drag.currentIndex - spreadIndex) <= 3) return true
      return this.drag.targetIndex === spreadIndex
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
        this.navigateCustom(-1)
      } else if (this.canPrev) {
        this.carouselPage--
        window.scrollTo(0, 0)
      } else {
        this.$emit('jump-previous')
      }
    },
    next() {
      if (this.customRendererEnabled) {
        this.navigateCustom(1)
      } else if (this.canNext) {
        this.carouselPage++
        window.scrollTo(0, 0)
      } else {
        this.$emit('jump-next')
      }
    },
    navigateCustom(delta: number) {
      if (this.drag.settling) this.finishDragSettlement(true)
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
      this.drag.rawOffset = 0
      this.drag.offset = 0
      this.drag.velocity = 0
      this.drag.curlVariant = 'middle'

      this.$nextTick(() => {
        window.requestAnimationFrame(() => this.settleDrag(true))
      })
    },
    followFingerStart(event: TouchEvent) {
      if (!this.interactiveGestureEnabled || event.touches.length !== 1) return
      if (this.drag.settling) this.finishDragSettlement(true)

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
      this.drag.curlVariant = this.vertical
        ? 'middle'
        : pageCurlVariantForStart(touch.clientY, root.clientHeight)
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
      this.cancelDragAnimation()
      this.drag.settling = true
      this.drag.settleCommit = commitTarget && this.drag.targetIndex !== null
      this.drag.settleJump = jump || ''
      this.suppressClickUntil = Date.now() + 350

      const from = this.drag.offset
      const to = this.drag.settleCommit
        ? this.drag.physicalDirection * this.drag.axisSize
        : 0
      const remaining = Math.min(1, Math.abs(to - from) / Math.max(1, this.drag.axisSize))
      const duration = Math.max(80, this.transitionDuration * Math.max(0.35, remaining))
      const startedAt = performance.now()

      const tick = (now: number) => {
        if (!this.drag.settling) return
        const linear = Math.min(1, Math.max(0, (now - startedAt) / duration))
        const eased = 1 - Math.pow(1 - linear, 3)
        this.drag.offset = from + (to - from) * eased

        if (linear < 1) {
          this.dragAnimationFrame = window.requestAnimationFrame(tick)
          return
        }

        this.drag.offset = to
        this.finishDragSettlement(false)
      }

      this.dragAnimationFrame = window.requestAnimationFrame(tick)
    },
    cancelDragAnimation() {
      if (this.dragAnimationFrame !== undefined) {
        window.cancelAnimationFrame(this.dragAnimationFrame)
        this.dragAnimationFrame = undefined
      }
    },
    finishDragSettlement(immediate = false) {
      this.cancelDragAnimation()

      const commitTarget = this.drag.settleCommit
      const targetIndex = this.drag.targetIndex
      const jump = this.drag.settleJump

      if (immediate && commitTarget && targetIndex !== null) {
        this.drag.offset = this.drag.physicalDirection * this.drag.axisSize
      }

      /*
       * Commit and reset synchronously. Vue batches these mutations into one DOM
       * patch, so the target spread's final animated geometry and its idle
       * geometry are identical in the first painted committed frame.
       *
       * Do not call window.scrollTo here: changing the document scroll position
       * while the transition layer is visible caused the persistent
       * "same page at a different position" flash.
       */
      if (commitTarget && targetIndex !== null) {
        this.carouselPage = targetIndex
      }

      this.resetDrag()

      if (jump === 'previous') this.$emit('jump-previous')
      if (jump === 'next') this.$emit('jump-next')
    },
    resetDrag() {
      this.cancelDragAnimation()
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
    },
    effectiveTransition(): PagedReaderTransition {
      if (this.drag.navigationDelta < 0) {
        if (this.transition === PagedReaderTransition.COVER) return PagedReaderTransition.REVEAL
        if (this.transition === PagedReaderTransition.REVEAL) return PagedReaderTransition.COVER
      }
      return this.transition
    },
    transitionSpreadClasses(spreadIndex: number): Record<string, boolean> {
      const current = spreadIndex === this.transitionBaseIndex
      const effect = this.effectiveTransition()
      return {
        'transition-current': current,
        'transition-target': this.drag.prepared && spreadIndex === this.drag.targetIndex,
        'page-flip-sheet': effect === PagedReaderTransition.PAGE_TURN && this.drag.prepared && current,
        'soft-wipe-target': effect === PagedReaderTransition.SOFT_WIPE &&
          this.drag.prepared && spreadIndex === this.drag.targetIndex,
      }
    },
    idleSpreadStyle(spreadIndex: number): Record<string, string> {
      if (spreadIndex === this.carouselPage) {
        return {
          transform: 'translate3d(0, 0, 0)',
          opacity: '1',
          zIndex: '2',
          visibility: 'visible',
        }
      }
      return {
        transform: 'translate3d(0, 0, 0)',
        opacity: '0',
        zIndex: '0',
        visibility: 'hidden',
      }
    },
    customSpreadStyle(spreadIndex: number): Record<string, string> {
      if (!this.drag.prepared) return this.idleSpreadStyle(spreadIndex)

      const baseIndex = this.transitionBaseIndex
      const isCurrent = spreadIndex === baseIndex
      const isTarget = spreadIndex === this.drag.targetIndex
      const progress = this.transitionProgressValue
      const offset = this.drag.offset
      const direction = this.activePhysicalDirection
      const effect = this.effectiveTransition()

      if (!isCurrent && !isTarget &&
        effect !== PagedReaderTransition.DEFAULT &&
        effect !== PagedReaderTransition.PUSH) {
        return {
          transform: 'translate3d(0, 0, 0)',
          opacity: '0',
          zIndex: '0',
          visibility: 'hidden',
        }
      }

      switch (effect) {
        case PagedReaderTransition.COVER: {
          if (isCurrent) {
            return {
              transform: 'translate3d(0, 0, 0)',
              opacity: '1',
              zIndex: '1',
              visibility: 'visible',
            }
          }
          if (isTarget) {
            const start = -direction * this.drag.axisSize
            const coordinate = start + offset
            return {
              transform: this.axisTranslate(coordinate),
              opacity: '1',
              zIndex: '3',
              visibility: 'visible',
              filter: `drop-shadow(${direction * 10}px 0 12px rgba(0, 0, 0, 0.28))`,
            }
          }
          break
        }
        case PagedReaderTransition.REVEAL: {
          if (isCurrent) {
            return {
              transform: this.axisTranslate(offset),
              opacity: '1',
              zIndex: '3',
              visibility: 'visible',
              filter: `drop-shadow(${-direction * 10}px 0 12px rgba(0, 0, 0, 0.24))`,
            }
          }
          if (isTarget) {
            const scale = 0.985 + progress * 0.015
            return {
              transform: `translate3d(0, 0, 0) scale(${scale})`,
              opacity: '1',
              zIndex: '1',
              visibility: 'visible',
            }
          }
          break
        }
        case PagedReaderTransition.PARALLAX: {
          if (isCurrent) {
            return {
              transform: this.axisTranslate(offset),
              opacity: '1',
              zIndex: '3',
              visibility: 'visible',
            }
          }
          if (isTarget) {
            const start = -direction * this.drag.axisSize * 0.35
            const coordinate = start + offset * 0.35
            const scale = 0.985 + progress * 0.015
            return {
              transform: `${this.axisTranslate(coordinate)} scale(${scale})`,
              opacity: '1',
              zIndex: '1',
              visibility: 'visible',
            }
          }
          break
        }
        case PagedReaderTransition.FADE: {
          if (isCurrent) {
            return {
              transform: 'translate3d(0, 0, 0)',
              opacity: `${1 - progress}`,
              zIndex: '3',
              visibility: 'visible',
            }
          }
          if (isTarget) {
            return {
              transform: 'translate3d(0, 0, 0)',
              opacity: `${progress}`,
              zIndex: '2',
              visibility: 'visible',
            }
          }
          break
        }
        case PagedReaderTransition.SOFT_WIPE: {
          if (isCurrent) {
            return {
              transform: 'translate3d(0, 0, 0)',
              opacity: '1',
              zIndex: '2',
              visibility: 'visible',
            }
          }
          if (isTarget) {
            const mask = this.softWipeMask(progress, direction)
            return {
              transform: 'translate3d(0, 0, 0)',
              opacity: '1',
              zIndex: '3',
              visibility: 'visible',
              WebkitMaskImage: mask,
              maskImage: mask,
            }
          }
          break
        }
        case PagedReaderTransition.PAGE_TURN: {
          if (isCurrent) {
            const rotation = pageCurlRotation(progress, direction)
            const edge = direction < 0 ? 'left' : 'right'
            const verticalOrigin = this.drag.curlVariant === 'top'
              ? 'top'
              : this.drag.curlVariant === 'bottom'
                ? 'bottom'
                : 'center'
            const cornerTilt = this.drag.curlVariant === 'top'
              ? -direction * progress * 12
              : this.drag.curlVariant === 'bottom'
                ? direction * progress * 12
                : 0
            const verticalShift = this.drag.curlVariant === 'top'
              ? -progress * 5
              : this.drag.curlVariant === 'bottom'
                ? progress * 5
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
              visibility: 'visible',
              filter: `drop-shadow(${direction * 14}px 2px ${8 + progress * 16}px rgba(0, 0, 0, ${0.18 + progress * 0.28}))`,
            }
          }
          if (isTarget) {
            const scale = 0.975 + progress * 0.025
            return {
              transform: `translate3d(0, 0, 0) scale(${scale})`,
              opacity: `${0.8 + progress * 0.2}`,
              zIndex: '1',
              visibility: 'visible',
            }
          }
          break
        }
        case PagedReaderTransition.PAPER_CURL: {
          if (isCurrent) {
            return {
              transform: 'translate3d(0, 0, 0)',
              opacity: '1',
              zIndex: '4',
              visibility: 'visible',
            }
          }
          if (isTarget) {
            const scale = 0.99 + progress * 0.01
            return {
              transform: `translate3d(0, 0, 0) scale(${scale})`,
              opacity: '1',
              zIndex: '1',
              visibility: 'visible',
            }
          }
          break
        }
        case PagedReaderTransition.PUSH:
        case PagedReaderTransition.DEFAULT:
        default: {
          const pageOffset = (spreadIndex - baseIndex) *
            this.physicalIndexDirection * this.drag.axisSize
          const coordinate = pageOffset + offset
          const currentScale = effect === PagedReaderTransition.PUSH && isCurrent
            ? 1 - progress * 0.018
            : 1
          const targetScale = effect === PagedReaderTransition.PUSH && isTarget
            ? 0.982 + progress * 0.018
            : 1
          const scale = isCurrent ? currentScale : isTarget ? targetScale : 1
          return {
            transform: `${this.axisTranslate(coordinate)} scale(${scale})`,
            opacity: '1',
            zIndex: isTarget ? '3' : isCurrent ? '2' : '1',
            visibility: Math.abs(spreadIndex - baseIndex) <= 2 ? 'visible' : 'hidden',
            filter: effect === PagedReaderTransition.PUSH && (isCurrent || isTarget)
              ? `drop-shadow(${direction * 8}px 0 10px rgba(0, 0, 0, ${0.08 + progress * 0.14}))`
              : 'none',
          }
        }
      }

      return {
        opacity: '0',
        zIndex: '0',
        visibility: 'hidden',
      }
    },
    axisTranslate(position: number): string {
      return this.vertical
        ? `translate3d(0, ${position}px, 0)`
        : `translate3d(${position}px, 0, 0)`
    },
    softWipeMask(progress: number, direction: number): string {
      if (progress <= 0) return 'linear-gradient(#0000, #0000)'
      if (progress >= 1) return 'linear-gradient(#000, #000)'

      const seam = direction < 0 ? 100 - progress * 100 : progress * 100
      const feather = 4
      const low = Math.max(0, seam - feather)
      const high = Math.min(100, seam + feather)

      if (this.vertical) {
        if (direction < 0) {
          return `linear-gradient(to bottom, transparent 0%, transparent ${low}%, black ${high}%, black 100%)`
        }
        return `linear-gradient(to bottom, black 0%, black ${low}%, transparent ${high}%, transparent 100%)`
      }

      if (direction < 0) {
        return `linear-gradient(to right, transparent 0%, transparent ${low}%, black ${high}%, black 100%)`
      }
      return `linear-gradient(to right, black 0%, black ${low}%, transparent ${high}%, transparent 100%)`
    },
    isPaperCurlCurrent(spreadIndex: number): boolean {
      return this.drag.prepared &&
        this.effectiveTransition() === PagedReaderTransition.PAPER_CURL &&
        spreadIndex === this.transitionBaseIndex
    },
    paperSegmentStyle(segment: number): Record<string, string> {
      const count = this.paperSegments.length
      const width = 100 / count
      const center = (segment + 0.5) / count
      const direction = this.activePhysicalDirection || -1
      const fromOuter = direction < 0 ? 1 - center : center
      const progress = this.transitionProgressValue
      const phase = paperCurlSegmentPhase(progress, fromOuter)
      const rotation = direction * phase * 155
      const lift = Math.sin(phase * Math.PI) * 42
      const outerWeight = 1 - fromOuter
      const cornerTilt = this.drag.curlVariant === 'top'
        ? -direction * phase * outerWeight * 11
        : this.drag.curlVariant === 'bottom'
          ? direction * phase * outerWeight * 11
          : 0
      const verticalShift = this.drag.curlVariant === 'top'
        ? -phase * outerWeight * 22
        : this.drag.curlVariant === 'bottom'
          ? phase * outerWeight * 22
          : 0
      const originEdge = direction < 0 ? 'left' : 'right'
      const originY = this.drag.curlVariant === 'top'
        ? 'top'
        : this.drag.curlVariant === 'bottom'
          ? 'bottom'
          : 'center'

      return {
        left: `${segment * width}%`,
        width: `${width + 0.08}%`,
        transformOrigin: `${originEdge} ${originY}`,
        transform: `translate3d(0, ${verticalShift}px, ${lift}px) rotateZ(${cornerTilt}deg) rotateY(${rotation}deg)`,
        boxShadow: phase > 0
          ? `${direction * -4}px 0 ${4 + phase * 12}px rgba(0, 0, 0, ${phase * 0.22})`
          : 'none',
      }
    },
    paperSegmentContentStyle(segment: number): Record<string, string> {
      const count = this.paperSegments.length
      return {
        width: `${count * 100}%`,
        left: `${-segment * 100}%`,
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

.transition-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 1;
  perspective: 1800px;
  transform-style: preserve-3d;
  isolation: isolate;
  contain: paint;
}

.transition-spread {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  backface-visibility: hidden;
  transform-style: preserve-3d;
  contain: paint;
}

.transition-layer-active .transition-spread {
  will-change: transform, opacity, filter;
}

.paper-segment {
  position: absolute;
  top: 0;
  bottom: 0;
  overflow: hidden;
  backface-visibility: hidden;
  transform-style: preserve-3d;
  will-change: transform;
}

.paper-segment-content {
  position: absolute;
  top: 0;
  height: 100%;
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

.pre-render {
  display: block !important;
  position: fixed;
  right: -1000vw;
  top: -1000vh;
}
</style>
