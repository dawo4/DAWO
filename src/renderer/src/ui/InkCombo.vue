<script setup lang="ts">
// 可输入 + 下拉二合一：替代原生 datalist（Chrome 原生弹层超高时滚轮失效、样式不可控）
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import { ChevronDown } from 'lucide-vue-next'

const props = defineProps<{
  modelValue: string
  options?: string[]
  placeholder?: string
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const open = ref(false)
const wrapRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)
const left = ref(0)
const top = ref(0)
const width = ref(0)
const active = ref(0)

/** 输入即过滤（不分大小写）；清空输入显示全部 */
const filtered = computed(() => {
  const all = props.options || []
  const q = String(props.modelValue || '').trim().toLowerCase()
  if (!q) return all
  return all.filter((m) => m.toLowerCase().includes(q))
})

function onInput(e: Event): void {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
  if (open.value) active.value = 0
}

/** 定位：默认下方弹出并钳制视口底部；下方放不下且上方放得下才向上 */
function place(): void {
  const el = wrapRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  width.value = r.width
  left.value = Math.min(r.left, window.innerWidth - Math.max(r.width, 320) - 8)
  const h = panelRef.value?.offsetHeight || 300
  const need = Math.min(h, 300) + 8
  if (window.innerHeight - r.bottom < need && r.top > need) {
    top.value = Math.max(8, r.top - h - 6)
  } else {
    top.value = Math.min(r.bottom + 6, Math.max(8, window.innerHeight - h - 8))
  }
}

function show(): void {
  if (!props.options?.length || open.value) return
  open.value = true
  const idx = filtered.value.indexOf(props.modelValue)
  active.value = idx >= 0 ? idx : 0
  nextTick(place)
  window.addEventListener('pointerdown', onOutside, true)
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', close)
}

function close(): void {
  if (!open.value) return
  open.value = false
  window.removeEventListener('pointerdown', onOutside, true)
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', close)
}

function onOutside(e: PointerEvent): void {
  const t = e.target as Node
  if (panelRef.value?.contains(t) || wrapRef.value?.contains(t)) return
  close()
}

/** 页面滚动时关闭面板；面板自身内部的滚动不算（否则滚轮一滑面板就消失） */
function onScroll(e: Event): void {
  if (panelRef.value?.contains(e.target as Node)) return
  close()
}

function pick(m: string): void {
  emit('update:modelValue', m)
  close()
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && open.value) {
    e.preventDefault()
    close()
    return
  }
  if (!open.value) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    active.value = Math.min(active.value + 1, filtered.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    active.value = Math.max(active.value - 1, 0)
  } else if (e.key === 'Enter') {
    const m = filtered.value[active.value]
    if (m) {
      e.preventDefault()
      pick(m)
    }
  }
}

// 输入过滤导致面板高度变化 → 重新定位
watch(filtered, () => {
  if (open.value) nextTick(place)
})

const panelStyle = computed(() => ({
  left: `${left.value}px`,
  top: `${top.value}px`,
  minWidth: `${Math.max(width.value, 320)}px`
}))

onBeforeUnmount(close)
</script>

<template>
  <div ref="wrapRef" class="ink-combo">
    <input
      ref="inputRef"
      :value="modelValue"
      :placeholder="placeholder"
      class="ink-input min-w-0 flex-1"
      autocomplete="off"
      spellcheck="false"
      role="combobox"
      :aria-expanded="open"
      @input="onInput"
      @focus="show"
      @keydown="onKeydown"
    />
    <button
      v-if="options?.length"
      type="button"
      class="ink-combo-btn"
      :class="{ 'is-open': open }"
      tabindex="-1"
      :aria-label="'选择模型'"
      @click.prevent="open ? close() : show()"
    >
      <ChevronDown :size="14" class="opacity-60 transition-transform duration-200" :class="open ? 'rotate-180' : ''" />
    </button>
    <Teleport to="body">
      <Transition name="ink-cmb">
        <div v-if="open" ref="panelRef" class="ink-combo-panel" :style="panelStyle" role="listbox">
          <button
            v-for="(m, i) in filtered"
            :key="m"
            type="button"
            class="ink-combo-item"
            :class="{ 'is-active': i === active, 'is-selected': m === modelValue }"
            role="option"
            :aria-selected="m === modelValue"
            @click="pick(m)"
            @mouseenter="active = i"
          >
            <span class="truncate">{{ m }}</span>
          </button>
          <div v-if="!filtered.length" class="px-2.5 py-2 text-[12px] text-[var(--text-faint)]">没有匹配的模型——可直接手动填写</div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.ink-combo {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  position: relative;
  min-width: 0;
}
.ink-combo-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: stretch;
  padding: 0 8px;
  border-radius: var(--r-md);
  border: 1px solid var(--border);
  background: var(--bg-soft);
  color: var(--text);
  cursor: pointer;
  transition: border-color 0.2s;
}
.ink-combo-btn:hover,
.ink-combo-btn.is-open {
  border-color: var(--accent);
}

.ink-combo-panel {
  position: fixed;
  z-index: var(--z-dropdown);
  max-height: 300px;
  overflow-y: auto;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  box-shadow: var(--sh-2);
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.ink-combo-item {
  display: flex;
  align-items: center;
  padding: 7px 10px;
  border-radius: var(--r-sm);
  font-size: var(--fs-label);
  color: var(--text);
  cursor: pointer;
  text-align: left;
  transition: background 0.12s, color 0.12s;
}
.ink-combo-item.is-active {
  background: var(--hover);
  color: var(--accent);
}
.ink-combo-item.is-selected {
  color: var(--accent);
}

.ink-cmb-enter-active {
  transition: opacity var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out);
}
.ink-cmb-leave-active {
  transition: opacity var(--dur-1) ease;
}
.ink-cmb-enter-from {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}
.ink-cmb-leave-to {
  opacity: 0;
}
</style>
