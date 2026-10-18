<script setup lang="ts">
// 境界体系板：力量等级从低到高 + 越级规则 + 角色当前境界，防战力崩坏
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useLibraryStore } from '../../store/library'
import { useAppStore } from '../../store/app'
import { inkConfirm } from '../../ui/inkPrompt'
import InkSelect from '../../ui/InkSelect.vue'
import EmptyHint from '../../ui/EmptyHint.vue'
import { ArrowDown, ArrowUp, BarChart3, Plus, Trash2, WandSparkles } from 'lucide-vue-next'
import type { PowerChar, PowerData, PowerRealm } from '../../types'

const lib = useLibraryStore()
const app = useAppStore()

const book = computed(() => lib.current?.title || '')
const realms = ref<PowerRealm[]>([])
const rules = ref('')
const chars = ref<PowerChar[]>([])
const selectedId = ref('')
const busy = ref(false)

const shownChars = computed(() => chars.value)
const selected = computed(() => chars.value.find((c) => c.id === selectedId.value))
/** 境界下拉选项 + 「未定」 */
const realmOptions = computed(() => [
  ...realms.value.map((r) => ({ label: r.name, value: r.name })),
  { label: '未定', value: '' }
])

async function load() {
  if (!book.value) return
  const data = ((await window.api.powerRead(book.value)) as PowerData) || { realms: [], rules: '', chars: [] }
  realms.value = data.realms || []
  rules.value = data.rules || ''
  chars.value = data.chars || []
  if (!chars.value.find((c) => c.id === selectedId.value)) selectedId.value = chars.value[0]?.id || ''
}

async function persist() {
  if (!book.value || busy.value) return
  busy.value = true
  try {
    const data = await window.api.powerWrite(
      book.value,
      JSON.parse(JSON.stringify({ realms: realms.value, rules: rules.value, chars: chars.value }))
    )
    const d = (data as PowerData) || { realms: [], rules: '', chars: [] }
    realms.value = d.realms || []
    rules.value = d.rules || ''
    chars.value = d.chars || []
  } finally {
    busy.value = false
  }
}

// ============ 境界列表操作 ============

function addRealm() {
  realms.value.push({ id: `pr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name: '新境界', sortKey: realms.value.length })
  void persist()
}

function moveRealm(i: number, dir: -1 | 1) {
  const j = i + dir
  if (j < 0 || j >= realms.value.length) return
  const list = [...realms.value]
  ;[list[i], list[j]] = [list[j], list[i]]
  realms.value = list.map((r, k) => ({ ...r, sortKey: k }))
  void persist()
}

async function removeRealm(id: string) {
  const r = realms.value.find((x) => x.id === id)
  if (!r) return
  const ok = await inkConfirm(`删除境界「${r.name}」？`, { confirmText: '删除', danger: true })
  if (!ok) return
  realms.value = realms.value.filter((x) => x.id !== id).map((x, k) => ({ ...x, sortKey: k }))
  // 引用该境界的角色置为未定，防悬空值落盘
  for (const c of chars.value) {
    if (c.realm === r.name) c.realm = ''
  }
  void persist()
}

// ============ 角色境界操作 ============

function addChar() {
  const c: PowerChar = { id: `pc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name: '新角色', realm: '', note: '' }
  chars.value.push(c)
  selectedId.value = c.id
  void persist()
}

async function removeChar(id: string) {
  const c = chars.value.find((x) => x.id === id)
  if (!c) return
  const ok = await inkConfirm(`移除角色「${c.name}」的境界登记？`, { confirmText: '移除', danger: true })
  if (!ok) return
  chars.value = chars.value.filter((x) => x.id !== id)
  if (selectedId.value === id) selectedId.value = chars.value[0]?.id || ''
  await persist()
}

/** 交给智能体：从设定/正文中梳理境界体系（走写入提案） */
async function askAgent() {
  if (!lib.current) return
  app.goAskAgent() // 切到妙笔页，用户能直接看到流式生成
  const { useConversationStore } = await import('../../store/conversation')
  const conv = useConversationStore()
  await conv.askWith(
    'power',
    '请阅读本书大纲、设定与已写章节（用 list_documents / read_document），梳理本书的力量等级体系——境界名称从低到高排序、越级/战力规则、主要角色当前所处的境界——用 write_power 提交境界体系提案。已有数据不要改动，只补充遗漏或更新角色境界。'
  )
}

/** AI 提案接受落盘后重载，防止本地旧状态把新数据覆盖回去 */
function onFileChanged(e: Event) {
  const p = (e as CustomEvent<{ path?: string }>).detail?.path
  if (p === '境界体系.json') void load()
}
onMounted(() => window.addEventListener('inkdesk:file-changed', onFileChanged))
onUnmounted(() => window.removeEventListener('inkdesk:file-changed', onFileChanged))

watch(book, () => void load())
onMounted(() => void load())
</script>

<template>
  <div class="h-full flex flex-col min-h-0">
    <div class="panel-head">
      <span class="panel-head-title">境界体系板</span>
      <span class="panel-head-meta">力量等级从低到高排清楚，角色境界对号入座，防战力崩坏</span>
      <div class="flex-1" />
      <button class="text-label flex items-center gap-1 text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer" @click="askAgent">
        <WandSparkles :size="12" /> 让智能体梳理体系
      </button>
    </div>

    <div class="flex-1 min-h-0 flex">
      <!-- 左：角色境界列表 -->
      <div class="panel-list w-80 py-2">
        <div class="px-4 pb-2 flex items-center">
          <span class="section-title">角色当前境界（{{ chars.length }}）</span>
          <div class="flex-1" />
          <button class="text-label flex items-center gap-1 text-[var(--accent)] cursor-pointer" @click="addChar"><Plus :size="12" /> 添加</button>
        </div>
        <div v-for="c in shownChars" :key="c.id" class="panel-item group" :class="selectedId === c.id ? 'is-on' : ''" @click="selectedId = c.id">
          <div class="flex-1 min-w-0">
            <div class="text-label truncate">{{ c.name }}</div>
            <div v-if="c.note" class="text-micro text-[var(--text-faint)] truncate">{{ c.note }}</div>
          </div>
          <span class="ink-chip ink-chip-accent shrink-0">{{ c.realm || '未定' }}</span>
          <button class="opacity-0 group-hover:opacity-100 text-[var(--text-faint)] hover:text-[var(--danger)] cursor-pointer" @click.stop="removeChar(c.id)">
            <Trash2 :size="12" />
          </button>
        </div>
        <div v-if="!chars.length" class="px-4 py-8 text-center text-label text-[var(--text-faint)] leading-6">
          还没有登记角色境界<br />手动添加，或让智能体梳理
        </div>
      </div>

      <!-- 右：境界阶梯 + 规则 + 选中角色编辑 -->
      <div class="panel-body px-6 py-5 space-y-6">
        <!-- 境界阶梯 -->
        <div class="max-w-xl">
          <div class="flex items-center mb-2">
            <span class="section-title">境界阶梯（低 → 高）</span>
            <div class="flex-1" />
            <button class="text-label flex items-center gap-1 text-[var(--accent)] cursor-pointer" @click="addRealm"><Plus :size="12" /> 新增境界</button>
          </div>
          <div class="space-y-1">
            <div v-for="(r, i) in realms" :key="r.id" class="flex items-center gap-2">
              <span class="text-meta text-[var(--text-faint)] w-5 text-right tnum">{{ i + 1 }}</span>
              <input v-model="r.name" class="ink-input flex-1" placeholder="境界名" @change="persist" />
              <div class="flex items-center">
                <button class="ink-icon-btn" title="上移" @click="moveRealm(i, -1)"><ArrowUp :size="13" /></button>
                <button class="ink-icon-btn" title="下移" @click="moveRealm(i, 1)"><ArrowDown :size="13" /></button>
                <button class="ink-icon-btn is-danger" title="删除" @click="removeRealm(r.id)"><Trash2 :size="13" /></button>
              </div>
            </div>
            <div v-if="!realms.length" class="text-label text-[var(--text-faint)] py-2">还没有境界，点「新增境界」从低阶开始搭</div>
          </div>
        </div>

        <!-- 越级规则 -->
        <div class="max-w-xl">
          <div class="form-label">越级 / 战力规则</div>
          <textarea v-model="rules" rows="4" class="ink-textarea" placeholder="能否越级挑战？越几级是极限？晋级的代价与条件是什么？" @change="persist" />
        </div>

        <!-- 选中角色编辑 -->
        <div v-if="selected" class="max-w-xl space-y-4 border-t border-[var(--border)] pt-4">
          <div class="flex gap-3">
            <div class="flex-1">
              <div class="form-label">角色名</div>
              <input v-model="selected.name" class="ink-input" placeholder="角色名" @change="persist" />
            </div>
            <div class="w-44 shrink-0">
              <div class="form-label">当前境界</div>
              <InkSelect v-model="selected.realm" class="w-full" :options="realmOptions" @change="persist" />
            </div>
          </div>
          <div>
            <div class="form-label">备注</div>
            <textarea v-model="selected.note" rows="3" class="ink-textarea" placeholder="功法特点、晋级进度、战力特长" @change="persist" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
