import { ref, onBeforeUnmount } from 'vue'

/**
 * 可拖拽调宽的面板：宽度持久化到 localStorage，拖动范围限制在 [min, max]，
 * 防止把相邻区域挤没。配合 style.css 的 .panel-resizer 分割线使用。
 * @param dir 1 = 面板在左侧（向右拖变宽）；-1 = 面板在右侧（向左拖变宽）
 */
export function usePanelDrag(key: string, init: number, min: number, max: number) {
  const storageKey = `inkdesk.panel.${key}`
  const width = ref(init)
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw) {
      const n = Number(raw)
      if (Number.isFinite(n)) width.value = Math.min(Math.max(n, min), max)
    }
  } catch {
    /* localStorage 不可用时用默认值 */
  }
  const dragging = ref(false)

  let startX = 0
  let startW = 0
  let moveHandler: ((e: MouseEvent) => void) | null = null
  let upHandler: (() => void) | null = null

  function cleanup(): void {
    dragging.value = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    if (moveHandler) window.removeEventListener('mousemove', moveHandler)
    if (upHandler) window.removeEventListener('mouseup', upHandler)
    moveHandler = upHandler = null
  }

  function onDown(e: MouseEvent, dir: 1 | -1 = 1): void {
    e.preventDefault()
    dragging.value = true
    startX = e.clientX
    startW = width.value
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    moveHandler = (ev: MouseEvent) => {
      width.value = Math.min(Math.max(startW + dir * (ev.clientX - startX), min), max)
    }
    upHandler = () => {
      cleanup()
      try {
        localStorage.setItem(storageKey, String(width.value))
      } catch {
        /* 忽略 */
      }
    }
    window.addEventListener('mousemove', moveHandler)
    window.addEventListener('mouseup', upHandler)
  }

  onBeforeUnmount(cleanup)

  return { width, dragging, onDown }
}
