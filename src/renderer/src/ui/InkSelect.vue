<script setup lang="ts">
// 自绘下拉选择：替代原生 <select>（Windows 下原生弹窗的悬停高亮是系统蓝，无法用 CSS 覆盖）
import { ref, computed, useAttrs, onBeforeUnmount, nextTick } from 'vue'
import { ChevronDown, Check } from 'lucide-vue-next'

interface InkOpt {
  label: string
  value: string | number
}

const props = defineProps<{
  modelValue: string | number
  options: InkOpt[]
  disabled?: boolean
  placeholder?: string
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string | number): void; (e: 'change'): void }>()

defineOptions({ inheritAttrs: false })
const attrs = useAttrs()

const open = ref(false)
const triggerRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const left = ref(0)
const top = ref(0)
const width = ref(0)
const up = ref(false)
const active = ref(0)

const label = computed(() => {
  const hit = props.options.find((o) => String(o.value) === String(props.modelValue))
  return hit ? hit.label : props.placeholder || String(props.modelValue ?? '')
})

function toggle(): void {
  if (props.disabled) return
  open.value ? close() : show()
}

/** 定位弹层：show 与滚动时共用（滚动跟随重定位而不是关闭，页面滚多久下拉都不散） */
function updatePosition(): void {
  const el = triggerRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  // 触发器滚出视口 → 弹层失去锚点，收起
  if (r.bottom < 0 || r.top > window.innerHeight) {
    close()
    return
  }
  width.value = r.width
  const w = Math.max(r.width, 160)
  left.value = Math.min(r.left, window.innerWidth - w - 8)
  const est = Math.min(props.options.length * 34 + 8, 300)
  if (window.innerHeight - r.bottom < est + 8 && r.top > est + 8) {
    up.value = true
    top.value = Math.max(8, r.top - (panelRef.value?.offsetHeight || Math.min(props.options.length * 34 + 8, window.innerHeight - 16)) - 6)
  } else {
    up.value = false
    top.value = r.bottom + 6
  }
}

function show(): void {
  const el = triggerRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  width.value = r.width
  const w = Math.max(r.width, 160)
  left.value = Math.min(r.left, window.innerWidth - w - 8)
  const est = Math.min(props.options.length * 34 + 8, 300)
  if (window.innerHeight - r.bottom < est + 8 && r.top > est + 8) {
    up.value = true
    top.value = Math.max(8, r.top - Math.min(props.options.length * 34 + 8, window.innerHeight - 16) - 6)
  } else {
    up.value = false
    top.value = r.bottom + 6
  }
  const idx = props.options.findIndex((o) => String(o.value) === String(props.modelValue))
  active.value = idx >= 0 ? idx : 0
  open.value = true
  nextTick(() => {
    // 打开后重新按真实面板高度校正向上弹出的位置
    updatePosition()
  })
  window.addEventListener('pointerdown', onOutside, true)
  window.addEventListener('scroll', updatePosition, true)
  window.addEventListener('resize', close)
}

function close(): void {
  if (!open.value) return
  open.value = false
  window.removeEventListener('pointerdown', onOutside, true)
  // 必须与注册时同一个函数引用，否则移除不掉（此前用 close 移除 updatePosition，滚动监听每次泄漏）
  window.removeEventListener('scroll', updatePosition, true)
  window.removeEventListener('resize', close)
}

function onOutside(e: PointerEvent): void {
  const t = e.target as Node
  if (panelRef.value?.contains(t) || triggerRef.value?.contains(t)) return
  close()
}

function pick(o: InkOpt): void {
  emit('update:modelValue', o.value)
  emit('change')
  close()
  triggerRef.value?.focus()
}

function onKeydown(e: KeyboardEvent): void {
  if (props.disabled) return
  if (!open.value) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault()
      show()
    }
    return
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    active.value = Math.min(active.value + 1, props.options.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    active.value = Math.max(active.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const o = props.options[active.value]
    if (o) pick(o)
  } else if (e.key === 'Tab') {
    close()
  }
}

const panelStyle = computed(() => ({
  left: `${left.value}px`,
  top: `${top.value}px`,
  minWidth: `${Math.max(width.value, 160)}px`
}))

onBeforeUnmount(close)
</script>

<template>
  <button
    ref="triggerRef"
    type="button"
    class="ink-select-trigger"
    :class="[{ 'is-open': open, 'is-disabled': disabled }, String(attrs.class || '')]"
    :style="typeof attrs.style === 'object' ? attrs.style : undefined"
    :disabled="disabled"
    role="combobox"
    :aria-expanded="open"
    @click="toggle"
    @keydown="onKeydown"
  >
    <span class="truncate" :class="{ 'is-placeholder': !options.some((o) => String(o.value) === String(modelValue)) }">{{ label }}</span>
    <ChevronDown :size="14" class="shrink-0 opacity-60 transition-transform duration-200" :class="open ? 'rotate-180' : ''" />
  </button>
  <Teleport to="body">
    <Transition name="ink-sel">
      <div v-if="open" ref="panelRef" class="ink-select-panel" :style="panelStyle" role="listbox">
        <button
          v-for="(o, i) in options"
          :key="String(o.value)"
          type="button"
          class="ink-select-item"
          :class="{ 'is-active': i === active, 'is-selected': String(o.value) === String(modelValue) }"
          role="option"
          :aria-selected="String(o.value) === String(modelValue)"
          @click="pick(o)"
          @mouseenter="active = i"
        >
          <span class="truncate">{{ o.label }}</span>
          <Check v-if="String(o.value) === String(modelValue)" :size="13" class="shrink-0" />
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ink-select-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: var(--bg-soft);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: var(--radius);
  padding: 8px 12px;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  outline: none;
  transition: border-color 0.2s;
}
.ink-select-trigger:hover,
.ink-select-trigger.is-open {
  border-color: var(--accent);
}
.ink-select-trigger.is-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ink-select-trigger .is-placeholder {
  color: var(--text-faint);
}

.ink-select-panel {
  position: fixed;
  z-index: 96;
  max-height: 300px;
  overflow-y: auto;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow);
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.ink-select-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 10px;
  border-radius: 7px;
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
  text-align: left;
  transition: background 0.12s, color 0.12s;
}
.ink-select-item.is-active {
  background: var(--hover);
  color: var(--accent);
}
.ink-select-item.is-selected {
  color: var(--accent);
}

.ink-sel-enter-active {
  transition: opacity 0.15s var(--ease-out-quart), transform 0.15s var(--ease-out-quart);
}
.ink-sel-leave-active {
  transition: opacity 0.1s ease;
}
.ink-sel-enter-from {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}
.ink-sel-leave-to {
  opacity: 0;
}
</style>
