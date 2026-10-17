<script setup lang="ts">
/**
 * 通用弹窗。
 * - 遮罩改为「纸感」：主题底色压暗 + 轻微模糊，不再是纯黑，长时间使用不刺眼
 * - 面板入场用 scale + opacity（只动 transform/opacity，不触发布局）
 * - 标题走衬线；可选 footer 插槽用于统一操作区
 * props / emits 与旧版完全一致，调用方无需改动。
 */
import { onMounted, onUnmounted } from 'vue'

const props = defineProps<{ open: boolean; title: string; wide?: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.open) emit('close')
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-6">
        <!-- 遮罩：主题底色 70% + 2px 模糊 -->
        <div
          class="absolute inset-0"
          :style="{
            background: 'color-mix(in srgb, var(--bg) 72%, transparent)',
            backdropFilter: 'blur(2px)'
          }"
          @click="emit('close')"
        />
        <Transition name="pop" appear>
          <div
            class="relative rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--panel)] w-full flex flex-col overflow-hidden"
            :class="wide ? 'max-w-3xl' : 'max-w-xl'"
            :style="{ maxHeight: '82vh', boxShadow: 'var(--sh-3)' }"
          >
            <div class="flex items-center justify-between px-5 h-12 border-b border-[var(--border)] shrink-0">
              <div class="font-serif-ink text-heading">{{ title }}</div>
              <button
                class="w-7 h-7 rounded-[var(--r-sm)] flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--text)] hover:bg-[var(--hover)] cursor-pointer transition-colors"
                title="关闭"
                @click="emit('close')"
              >
                ✕
              </button>
            </div>
            <div class="p-5 overflow-y-auto min-h-0">
              <slot />
            </div>
            <div v-if="$slots.footer" class="px-5 py-3 border-t border-[var(--border)] flex items-center justify-end gap-2 shrink-0">
              <slot name="footer" />
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
