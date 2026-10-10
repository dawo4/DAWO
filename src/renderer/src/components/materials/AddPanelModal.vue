<script setup lang="ts">
/** 新建自定义面板向导（阶段二第 4 步）：面板名 + 字段自定义（空白列表默认 标题+内容） */
import { ref, watch } from 'vue'
import { useLibraryStore } from '../../store/library'
import InkModal from '../../ui/InkModal.vue'
import InkButton from '../../ui/InkButton.vue'
import InkSelect from '../../ui/InkSelect.vue'
import { Plus, Trash2 } from 'lucide-vue-next'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'created', name: string): void }>()

const lib = useLibraryStore()

interface FieldRow {
  label: string
  type: 'text' | 'longtext' | 'tags' | 'status'
}

const name = ref('')
const rows = ref<FieldRow[]>([
  { label: '标题', type: 'text' },
  { label: '内容', type: 'longtext' }
])
const err = ref('')
const creating = ref(false)

const TYPE_OPTS = [
  { label: '单行', value: 'text' },
  { label: '多行', value: 'longtext' },
  { label: '标签', value: 'tags' },
  { label: '状态', value: 'status' }
]

watch(
  () => props.open,
  (v) => {
    if (v) {
      name.value = ''
      err.value = ''
      rows.value = [
        { label: '标题', type: 'text' },
        { label: '内容', type: 'longtext' }
      ]
    }
  }
)

function addRow() {
  rows.value.push({ label: '', type: 'text' })
}

function removeRow(i: number) {
  rows.value.splice(i, 1)
}

async function create() {
  if (!lib.current || creating.value) return
  const n = name.value.trim()
  if (!n) {
    err.value = '请填写面板名称'
    return
  }
  const fields = rows.value
    .map((r) => ({ label: r.label.trim(), key: r.label.trim(), type: r.type }))
    .filter((f) => f.label)
  if (!fields.length) {
    err.value = '至少保留一个字段'
    return
  }
  creating.value = true
  err.value = ''
  try {
    await window.api.panelsAdd(lib.current.title, { name: n, fields })
    emit('created', n)
    emit('close')
  } catch (e) {
    // 剥掉 IPC 包装前缀，只留人话
    err.value = (e as Error).message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <InkModal :open="open" title="新建自定义面板" @close="emit('close')">
    <div class="space-y-4 text-sm">
      <div class="space-y-1.5">
        <div class="text-[12px] text-[var(--text-dim)]">面板名称</div>
        <input v-model="name" class="ink-input" placeholder="如：文风 / 科技树 / 桥段库 / 禁忌清单" @keydown.enter="create" />
      </div>

      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <div class="text-[12px] text-[var(--text-dim)]">字段（每条条目会按这些字段填写）</div>
          <InkButton variant="ghost" @click="addRow"><Plus :size="12" /> 加字段</InkButton>
        </div>
        <div v-for="(r, i) in rows" :key="i" class="flex items-center gap-2">
          <input v-model="r.label" class="ink-input flex-1" placeholder="字段名，如：要点 / 禁用词 / 示例" />
          <InkSelect v-model="r.type" class="w-24 shrink-0" :options="TYPE_OPTS" />
          <button
            class="text-[var(--text-faint)] hover:text-[#e08a7a] cursor-pointer shrink-0 disabled:opacity-30"
            :disabled="rows.length <= 1"
            title="删除此字段"
            @click="removeRow(i)"
          >
            <Trash2 :size="13" />
          </button>
        </div>
      </div>

      <div v-if="err" class="text-[12.5px] text-[#e08a7a]">{{ err }}</div>

      <div class="flex justify-end gap-2 pt-1">
        <InkButton variant="ghost" @click="emit('close')">取消</InkButton>
        <InkButton :disabled="creating" @click="create">创建面板</InkButton>
      </div>
    </div>
  </InkModal>
</template>
