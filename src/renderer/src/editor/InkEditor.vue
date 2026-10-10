<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Editor, BubbleMenu, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'

const props = defineProps<{ modelValue: string; placeholder?: string; /** 幽灵续写建议；不再使用自动触发，保留以兼容 */ ghost?: string }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'selection-action', p: { action: string; text: string }): void
  (e: 'accept-ghost'): void
  (e: 'dismiss-ghost'): void
  (e: 'typing'): void
}>()

const editor = shallowRef<Editor>()
const ghostBox = ref<{ x: number; y: number } | null>(null)

/** Markdown → HTML（小说场景：标题 + 段落） */
function mdToHtml(md: string): string {
  if (!md.trim()) return '<p></p>'
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const out: string[] = []
  for (const line of lines) {
    const t = line.trimEnd()
    if (!t.trim()) continue
    if (t.startsWith('### ')) out.push(`<h3>${esc(t.slice(4))}</h3>`)
    else if (t.startsWith('## ')) out.push(`<h2>${esc(t.slice(3))}</h2>`)
    else if (t.startsWith('# ')) out.push(`<h1>${esc(t.slice(2))}</h1>`)
    else out.push(`<p>${esc(t)}</p>`)
  }
  return out.join('') || '<p></p>'
}

/** HTML → Markdown */
function htmlToMd(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const blocks: string[] = []
  doc.body.querySelectorAll('h1, h2, h3, p').forEach((node) => {
    const text = (node.textContent || '').replace(/\u00a0/g, ' ')
    if (!text.trim()) return
    const prefix = node.tagName === 'H1' ? '# ' : node.tagName === 'H2' ? '## ' : node.tagName === 'H3' ? '### ' : ''
    blocks.push(prefix + text)
  })
  if (blocks.length === 0 && doc.body.textContent?.trim()) blocks.push(doc.body.textContent.trim())
  return blocks.join('\n\n')
}

function updateCaret() {
  const ed = editor.value
  if (!ed) return
  try {
    const coords = ed.view.coordsAtPos(ed.state.selection.to)
    window.dispatchEvent(new CustomEvent('inkdesk:caret', { detail: { x: coords.left, y: coords.top } }))
    // 幽灵字定位
    if (props.ghost) ghostBox.value = { x: coords.left, y: coords.bottom + 6 }
    else ghostBox.value = null
  } catch {
    ghostBox.value = null
  }
}

onMounted(() => {
  editor.value = new Editor({
    content: mdToHtml(props.modelValue),
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder: props.placeholder || '开始写作…' }),
      CharacterCount
    ],
    editorProps: {
      handleKeyDown: (view, event) => {
        if (props.ghost) {
          if (event.key === 'Tab') {
            event.preventDefault()
            emit('accept-ghost')
            return true
          }
          if (event.key === 'Escape') {
            emit('dismiss-ghost')
            return false
          }
          if (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Enter') {
            emit('typing')
          }
        }
        return false
      }
    },
    onUpdate: () => {
      const ed = editor.value
      if (!ed) return
      emit('update:modelValue', htmlToMd(ed.getHTML()))
      updateCaret()
    },
    onSelectionUpdate: updateCaret
  })
})

onBeforeUnmount(() => editor.value?.destroy())

watch(
  () => props.modelValue,
  (v) => {
    const ed = editor.value
    if (!ed) return
    const current = htmlToMd(ed.getHTML())
    if (v !== current) ed.commands.setContent(mdToHtml(v), false)
  }
)
watch(
  () => props.ghost,
  () => updateCaret()
)

/** 供父组件调用：在光标处插入文本（按段落拆分） */
function insertAtCursor(text: string) {
  const ed = editor.value
  if (!ed) return
  const paras = text.replace(/\r\n/g, '\n').split(/\n+/).map((s) => s.trim()).filter(Boolean)
  let chain = ed.chain().focus()
  paras.forEach((p) => {
    if (/^# /.test(p)) chain = chain.setHeading({ level: 1 }).insertContent(p.slice(2))
    else chain = chain.setParagraph().insertContent(p)
    chain = chain.splitBlock()
  })
  chain.run()
}

/** 用新文本替换当前选区 */
function replaceSelection(text: string) {
  const ed = editor.value
  if (!ed) return
  const paras = text.replace(/\r\n/g, '\n').split(/\n+/).map((s) => s.trim()).filter(Boolean)
  let chain = ed.chain().focus().deleteSelection()
  paras.forEach((p, i) => {
    chain = chain.setParagraph().insertContent(p)
    if (i < paras.length - 1) chain = chain.splitBlock()
  })
  chain.run()
}

function getSelectionText(): string {
  const ed = editor.value
  if (!ed) return ''
  const { from, to } = ed.state.selection
  return ed.state.doc.textBetween(from, to, '\n')
}

/** 撤销 / 重做（StarterKit 自带历史栈，Ctrl+Z 与按钮共用同一条） */
function undo() {
  editor.value?.commands.undo()
}
function redo() {
  editor.value?.commands.redo()
}

defineExpose({ insertAtCursor, replaceSelection, getSelectionText, undo, redo })

const bubbleActions = [
  { key: 'polish', label: '润色' },
  { key: 'expand', label: '扩写' },
  { key: 'fix', label: '纠错' },
  { key: 'deai', label: '去味' },
  { key: 'custom', label: '自定义…' }
]
</script>

<template>
  <div v-if="editor" class="ink-editor relative h-full">
    <BubbleMenu :editor="editor" :tippy-options="{ duration: 120 }">
      <div class="bubble-menu">
        <button v-for="a in bubbleActions" :key="a.key" @click="emit('selection-action', { action: a.key, text: getSelectionText() })">
          {{ a.label }}
        </button>
      </div>
    </BubbleMenu>
    <EditorContent :editor="editor" class="h-full overflow-y-auto" />

    <!-- 幽灵字预览 -->
    <Teleport to="body">
      <template v-if="props.ghost && ghostBox">
        <div class="ghost-hint" :style="{ left: ghostBox.x + 'px', top: ghostBox.y + 'px' }">Tab 采纳 · Esc 取消</div>
        <div
          class="ghost-text"
          style="position: fixed; z-index: 39"
          :style="{ left: ghostBox.x + 'px', top: ghostBox.y + 'px' }"
        >{{ props.ghost }}</div>
      </template>
    </Teleport>
  </div>
</template>
