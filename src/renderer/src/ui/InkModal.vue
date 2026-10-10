<script setup lang="ts">
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
      <div v-if="open" class="fixed inset-0 z-[80] flex items-center justify-center">
        <div class="absolute inset-0 bg-black/50" @click="emit('close')" />
        <div
          class="relative rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-[var(--shadow)] w-full flex flex-col"
          :class="wide ? 'max-w-3xl' : 'max-w-xl'"
          style="max-height: 82vh"
        >
          <div class="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
            <div class="font-serif-ink text-base">{{ title }}</div>
            <button class="text-[var(--text-dim)] hover:text-[var(--text)] cursor-pointer px-2" @click="emit('close')">✕</button>
          </div>
          <div class="p-5 overflow-y-auto">
            <slot />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
