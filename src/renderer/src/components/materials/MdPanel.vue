<script setup lang="ts">
/** 资料板块的 Markdown 编辑面板：左文件列表 + 中编辑器 + 让智能体帮忙。
 *  设定板块（dir==='设定'）增强：模板新建 / 分组目录 / 设定体检 / 词典关联速览 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAppStore } from '../../store/app'
import { useLibraryStore } from '../../store/library'
import { useConversationStore } from '../../store/conversation'
import { aiRun } from '../../ai'
import { renderMarkdown } from '../../ui/markdown'
import InkEditor from '../../editor/InkEditor.vue'
import { inkPrompt, inkConfirm } from '../../ui/inkPrompt'
import { SETTING_TEMPLATES } from '../../lib/settingTemplates'
import { Plus, Search, Sparkles, Trash2, ShieldCheck, FilePlus2, FolderInput } from 'lucide-vue-next'

const props = defineProps<{ dir: string; agentId: string }>()

const app = useAppStore()
const lib = useLibraryStore()
const conv = useConversationStore()

interface FileItem {
  name: string
  path: string
  group: string // 设定板块：子目录名做分组；其他板块为空
}
const isSetting = computed(() => props.dir === '设定')

const files = ref<FileItem[]>([])
const current = ref('')
const content = ref('')
const query = ref('')
const busy = ref(false)
let saveTimer: ReturnType<typeof setTimeout> | null = null

const book = computed(() => lib.current?.title || '')

/** 递归收集：设定板块把子目录当分组（世界/体系/势力/地理/物品），其他板块保持平铺 */
function collect(nodes: { name: string; path: string; dir: boolean; children?: { name: string; path: string; dir: boolean; children?: unknown[] }[] }[], group: string, out: FileItem[]) {
  for (const n of nodes) {
    if (n.dir) {
      if (isSetting.value) collect(n.children || [], n.name.replace(/\/$/, ''), out)
      else if (n.children) collect(n.children as typeof nodes, group, out)
    } else {
      out.push({ name: n.name.replace(/\.md$/, ''), path: n.path, group })
    }
  }
}

async function refreshFiles() {
  if (!lib.current) return
  const node = lib.tree.find((n) => n.name === props.dir)
  const out: FileItem[] = []
  collect((node?.children || []) as never, '', out)
  files.value = out
  if (!current.value || !files.value.find((f) => f.path === current.value)) {
    current.value = files.value[0]?.path || ''
  }
}

/** 分组视图：按组聚合（组内保持磁盘顺序，未分组排最后），搜索时只显示命中文件 */
const groups = computed(() => {
  const q = query.value.trim().toLowerCase()
  const list = q ? files.value.filter((f) => f.name.toLowerCase().includes(q)) : files.value
  if (!isSetting.value) return [{ name: '', files: list }]
  const order = ['世界', '体系', '势力', '地理', '物品']
  const map = new Map<string, FileItem[]>()
  for (const f of list) {
    const g = f.group || '未分组'
    if (!map.has(g)) map.set(g, [])
    map.get(g)!.push(f)
  }
  return [...map.entries()]
    .sort((a, b) => {
      const ia = order.indexOf(a[0])
      const ib = order.indexOf(b[0])
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
      return a[0].localeCompare(b[0], 'zh')
    })
    .map(([name, fs]) => ({ name, files: fs }))
})

async function loadMd() {
  if (!lib.current || !current.value) {
    content.value = ''
    return
  }
  content.value = await window.api.fileRead(lib.current.title, current.value)
}

async function ensureFirst() {
  if (!files.value.length && lib.current) {
    const rel = `${props.dir}/${props.dir}.md`
    await window.api.fileWrite(lib.current.title, rel, `# ${props.dir}\n\n`)
    await lib.refreshTree()
    await refreshFiles()
    current.value = rel
    await loadMd()
  }
}

// ============ 新建：设定板块走模板选择（分组可自定义），其他板块保持原名 ============
const tplMenu = ref(false)

/** 问分组：可输入任意新组名（即输即建），留空=未分组；取消返回 null */
async function promptGroup(defaultGroup: string): Promise<string | null> {
  const g = await inkPrompt('分组（可输入任意新组名，留空=不分组）', defaultGroup)
  if (g === null) return null
  return g.trim().replace(/[\\/:*?"<>|]/g, '')
}

async function newFile() {
  if (!lib.current) return
  if (isSetting.value) {
    tplMenu.value = !tplMenu.value
    return
  }
  const name = await inkPrompt('新建文件名（不含 .md）', '')
  if (!name) return
  const rel = `${props.dir}/${name}.md`
  await window.api.fileWrite(lib.current.title, rel, `# ${name}\n\n`)
  await lib.refreshTree()
  await refreshFiles()
  current.value = rel
  await loadMd()
}

async function newFromTemplate(t: { label: string; group: string; body: string } | null) {
  tplMenu.value = false
  if (!lib.current) return
  const name = (await inkPrompt('文件名（不含 .md）', t ? t.label : ''))?.trim()
  if (!name) return
  const group = await promptGroup(t ? t.group : '')
  if (group === null) return
  const rel = group ? `${props.dir}/${group}/${name}.md` : `${props.dir}/${name}.md`
  if (files.value.some((f) => f.path === rel)) {
    const ok = await inkConfirm(`「${name}」已存在，覆盖它？`, { confirmText: '覆盖', danger: true })
    if (!ok) return
  }
  await window.api.fileWrite(lib.current.title, rel, t ? t.body : `# ${name}\n\n`)
  await lib.refreshTree()
  await refreshFiles()
  current.value = rel
  await loadMd()
}

/** 把当前设定文件移动到任意分组（新组名即建），不动内容 */
async function moveFile() {
  if (!lib.current || !current.value || !isSetting.value) return
  const from = files.value.find((f) => f.path === current.value)?.group || ''
  const group = await promptGroup(from)
  if (group === null) return
  const name = current.value.split('/').pop()!
  const rel = group ? `${props.dir}/${group}/${name}` : `${props.dir}/${name}`
  if (rel === current.value) return
  if (files.value.some((f) => f.path === rel)) {
    const ok = await inkConfirm(`目标位置已有「${name}」，覆盖它？`, { confirmText: '覆盖', danger: true })
    if (!ok) return
  }
  // 直接取编辑器当前内容，取消挂起快照（避免它稍后把内容写回旧路径）
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  pendingSave = null
  const body = content.value
  await window.api.fileWrite(lib.current.title, rel, body)
  await window.api.fileDelete(lib.current.title, current.value)
  await lib.refreshTree()
  await refreshFiles()
  current.value = rel
  await loadMd()
}

async function deleteFile() {
  if (!lib.current || !current.value) return
  flushPendingSave()
  const ok = await inkConfirm(`确定删除「${current.value}」？`, { confirmText: '删除', danger: true })
  if (!ok) return
  await window.api.fileDelete(lib.current.title, current.value)
  await lib.refreshTree()
  current.value = ''
  await refreshFiles()
  await loadMd()
}

/** 把当前文件交给对应智能体处理 */
const AI_TASKS: Record<string, string> = {
  大纲: '请审阅并优化当前大纲文件：检查分卷结构是否清晰、章节目标是否可执行、前三章是否符合黄金三章、伏笔是否有回收位置。先 read_document 读它，再用 propose_edit 提交修改后的完整内容。',
  角色: '请审阅并优化当前角色文件：检查每个角色是否有欲望/需要/缺点/弧光，是否有工具人，人物关系是否自洽。先 read_document 读它，再用 propose_edit 提交修改后的完整内容。',
  设定: '请审阅并优化当前设定文件：检查力量体系是否分级明确且有代价、命名是否统一、是否与大纲和角色冲突、有无无用设定。先 read_document 读它，再用 propose_edit 提交修改后的完整内容。'
}

async function askAgent() {
  if (busy.value || !book.value) return
  busy.value = true
  try {
    app.goAskAgent()
    await conv.askWith(props.agentId, AI_TASKS[props.dir] || AI_TASKS['设定'], current.value || undefined)
  } finally {
    busy.value = false
  }
}

// ============ 设定体检：对照词典/境界/地图现状做一致性检查（① ） ============
interface DictLite {
  term: string
  category: string
  aliases: string[]
  desc: string
}
const checkup = ref({ running: false, visible: false, report: '', error: '' })
let checkupAborter: { abort: () => void } | null = null

/** 关联速览：正文里出现的专名，直接显示词典里的现有定义（③ 联动·人侧） */
const dictList = ref<DictLite[]>([])
const matchedTerms = computed(() => {
  if (!isSetting.value || !content.value) return []
  const text = content.value
  const hits: { term: string; desc: string }[] = []
  for (const d of dictList.value) {
    const names = [d.term, ...(d.aliases || [])]
    if (names.some((n) => n && n.length >= 2 && text.includes(n))) hits.push({ term: d.term, desc: d.desc })
    if (hits.length >= 12) break
  }
  return hits
})

async function loadDict() {
  if (!isSetting.value || !lib.current) return
  try {
    dictList.value = ((await window.api.dictRead(lib.current.title)) as DictLite[]) || []
  } catch {
    dictList.value = []
  }
}

async function runCheckup() {
  if (checkup.running || !lib.current) return
  checkup.value = { running: true, visible: true, report: '', error: '' }
  try {
    // 汇总设定文本：当前文件放最前，全部设定文件参与（总 capped）
    let setting = ''
    if (current.value) setting += `--- ${current.value.replace(/^设定\//, '')} ---\n${content.value.slice(0, 20000)}\n\n`
    let total = setting.length
    for (const f of files.value) {
      if (total >= 50000) break
      if (f.path === current.value) continue
      const t = await window.api.fileRead(lib.current.title, f.path)
      if (!t.trim()) continue
      const slice = t.slice(0, 20000)
      setting += `--- ${f.name} ---\n${slice}\n\n`
      total += slice.length
    }
    // 结构化现状
    let dictText = '（词典为空，未登记专名）'
    if (dictList.value.length)
      dictText = dictList.value.map((d) => `${d.term}（${d.category}）：${d.desc}`).join('\n').slice(0, 4000)
    let powerText = '（境界体系未建立）'
    try {
      const p = (await window.api.powerRead(lib.current.title)) as { realms?: { name: string }[]; rules?: string }
      if (p.realms?.length) powerText = `境界从低到高：${p.realms.map((r) => r.name).join(' ≥ ')}${p.rules ? `\n战力规则：${p.rules}` : ''}`
    } catch {
      /* 忽略 */
    }
    let mapText = '（地图未绘制）'
    try {
      const ms = ((await window.api.mapRead(lib.current.title)) as { maps?: { name: string; nodes?: { label: string }[] }[] })?.maps || []
      const lines = ms.map((m) => `${m.name}：${(m.nodes || []).map((n) => n.label).join('、')}`).filter((l) => !l.endsWith('：'))
      if (lines.length) mapText = lines.join('\n').slice(0, 2000)
    } catch {
      /* 忽略 */
    }
    let outlineText = '（大纲未生成）'
    try {
      outlineText = (await window.api.fileRead(lib.current.title, '大纲/大纲.md')).slice(0, 3000) || outlineText
    } catch {
      /* 忽略 */
    }
    checkupAborter = aiRun(
      'workflow',
      'setting-checkup',
      { setting: setting.slice(0, 60000), dictionary: dictText, power: powerText, maps: mapText, outline: outlineText },
      { onChunk: (c) => (checkup.value.report += c) }
    )
    await checkupAborter.promise
  } catch (e) {
    checkup.value.error = (e as Error).message
  } finally {
    checkup.value.running = false
    checkupAborter = null
  }
}

function stopCheckup() {
  checkupAborter?.abort()
}

function closeCheckup() {
  if (checkup.value.running) return
  checkup.value.visible = false
}

const checkupHtml = computed(() => renderMarkdown(checkup.value.report))

/**
 * 快照式防抖保存：调度时就把「书名+路径+内容」固化成快照，
 * 无论之后切文件/换书，到点都把这份快照写回它原来的位置，杜绝写穿。
 */
let pendingSave: { book: string; path: string; body: string } | null = null

function flushPendingSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!pendingSave) return
  const p = pendingSave
  pendingSave = null
  void (async () => {
    app.setSaveState(true, '保存中…')
    await window.api.fileWrite(p.book, p.path, p.body)
    app.setSaveState(false, `已保存 · ${p.body.length} 字`)
  })()
}

watch(content, () => {
  if (!current.value || !book.value) return
  pendingSave = { book: book.value, path: current.value, body: content.value }
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(flushPendingSave, 900)
})

watch(
  () => current.value,
  async () => {
    flushPendingSave() // 切文件前把旧文件的挂起快照落盘
    tplMenu.value = false
    await loadMd()
  }
)
watch(
  () => props.dir,
  async () => {
    flushPendingSave()
    query.value = ''
    tplMenu.value = false
    await refreshFiles()
    await ensureFirst()
    await loadMd()
    await loadDict()
  }
)
watch(
  () => lib.current?.title,
  async () => {
    flushPendingSave() // 换书前把旧书挂起快照按原书名落盘
    await refreshFiles()
    await ensureFirst()
    await loadMd()
    await loadDict()
  }
)

onMounted(async () => {
  await refreshFiles()
  await ensureFirst()
  await loadMd()
  await loadDict()
})

function onFileChanged(e: Event) {
  const p = (e as CustomEvent<{ path?: string }>).detail?.path
  if (p && p === current.value) void loadMd()
}
onMounted(() => window.addEventListener('inkdesk:file-changed', onFileChanged))
onUnmounted(() => window.removeEventListener('inkdesk:file-changed', onFileChanged))
</script>

<template>
  <div class="h-full flex">
    <!-- 左：文件列表 -->
    <aside class="w-56 shrink-0 border-r border-[var(--border)] flex flex-col relative">
      <div class="px-3 py-2.5 border-b border-[var(--border)] space-y-2">
        <div class="flex items-center gap-1.5 h-7 px-2 rounded-full bg-[var(--bg-soft)]">
          <Search :size="12" class="text-[var(--text-faint)] shrink-0" />
          <input v-model="query" class="flex-1 min-w-0 bg-transparent outline-none text-[12px]" :placeholder="`搜索${props.dir}…`" />
        </div>
        <div class="flex items-center gap-2">
          <span class="text-[11px] text-[var(--text-faint)] flex-1">{{ props.dir }}文件 · {{ files.length }}</span>
          <button
            class="text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer"
            :title="isSetting ? '按模板新建' : '新建文件'"
            @click="newFile"
          >
            <FilePlus2 v-if="isSetting" :size="14" />
            <Plus v-else :size="14" />
          </button>
        </div>
      </div>
      <!-- 模板选择浮层（设定板块） -->
      <div
        v-if="tplMenu && isSetting"
        class="absolute z-20 left-2 right-2 top-[86px] rounded-lg border border-[var(--border)] bg-[var(--panel)] shadow-lg p-2 space-y-0.5"
      >
        <div class="text-[10.5px] text-[var(--text-faint)] px-1.5 pt-0.5 pb-1">选一个模板（分组可自定义，也能自己写组名）</div>
        <button
          v-for="t in SETTING_TEMPLATES"
          :key="t.label"
          class="w-full text-left px-2.5 py-1.5 rounded-md text-[12.5px] text-[var(--text-dim)] hover:bg-[var(--hover)] hover:text-[var(--text)] cursor-pointer flex items-center justify-between gap-2"
          @click="newFromTemplate(t)"
        >
          <span>{{ t.label }}</span>
          <span class="text-[10.5px] text-[var(--text-faint)]">{{ t.group }}</span>
        </button>
        <button
          class="w-full text-left px-2.5 py-1.5 rounded-md text-[12.5px] text-[var(--text-faint)] hover:bg-[var(--hover)] cursor-pointer border-t border-[var(--border)] mt-1 pt-2"
          @click="newFromTemplate(null)"
        >
          空白文档
        </button>
        <div class="px-1.5 pt-2 pb-0.5 text-[10.5px] text-[var(--text-faint)] leading-5">
          条目型设定（势力 / 地点 / 物品 / 境界）直接登记到工具面板更防吃书：
          <button class="underline cursor-pointer hover:text-[var(--accent)]" @click="app.goMaterials('词典')">词典</button> ·
          <button class="underline cursor-pointer hover:text-[var(--accent)]" @click="app.goMaterials('境界')">境界</button> ·
          <button class="underline cursor-pointer hover:text-[var(--accent)]" @click="app.goMaterials('地图')">地图</button> ·
          <button class="underline cursor-pointer hover:text-[var(--accent)]" @click="app.goMaterials('关系图')">关系图</button>
        </div>
      </div>
      <div class="flex-1 overflow-y-auto py-1">
        <div v-for="g in groups" :key="g.name || '_all'">
          <div v-if="isSetting && g.name" class="px-3.5 pt-2.5 pb-1 text-[10.5px] tracking-widest text-[var(--text-faint)]">
            {{ g.name }}
          </div>
          <div
            v-for="f in g.files"
            :key="f.path"
            class="px-3.5 py-1.5 text-[12.5px] cursor-pointer truncate"
            :class="current === f.path ? 'bg-[var(--panel-2)] font-medium' : 'text-[var(--text-dim)] hover:bg-[var(--hover)]'"
            :style="current === f.path ? { color: 'var(--accent)' } : {}"
            :title="isSetting && f.group ? `${f.group} / ${f.name}` : f.name"
            @click="current = f.path"
          >
            {{ f.name }}
          </div>
        </div>
        <div v-if="!groups.some((g) => g.files.length)" class="px-3.5 py-6 text-center text-[11.5px] text-[var(--text-faint)]">
          {{ query ? '没有匹配的文件' : '还没有文件' }}
        </div>
      </div>
    </aside>

    <!-- 中：编辑器 -->
    <section class="flex-1 min-w-0 flex flex-col">
      <div class="h-11 shrink-0 flex items-center gap-2 px-5 border-b border-[var(--border)]">
        <span class="font-serif-ink text-[13.5px] truncate">{{ current || '未选择文件' }}</span>
        <span class="text-[11px] text-[var(--text-faint)]">{{ content.length }} 字</span>
        <div class="flex-1" />
        <!-- 词典关联速览（设定板块）：当前文件里提到的专名 → 词典现状 -->
        <div v-if="isSetting && matchedTerms.length" class="flex items-center gap-1 min-w-0 max-w-[45%] overflow-hidden">
          <span class="text-[10.5px] text-[var(--text-faint)] shrink-0">关联</span>
          <span
            v-for="m in matchedTerms"
            :key="m.term"
            class="px-2 py-0.5 rounded-full bg-[var(--bg-soft)] text-[10.5px] text-[var(--text-dim)] cursor-default shrink-0 truncate max-w-[120px]"
            :title="`${m.term}：${m.desc}`"
          >
            {{ m.term }}
          </span>
        </div>
        <button
          v-if="isSetting && current"
          class="text-[12px] flex items-center gap-1 px-2.5 py-1 rounded-full cursor-pointer hover:bg-[var(--hover)] text-[var(--text-dim)] shrink-0"
          title="把当前文件移动到其他分组（可输入新组名）"
          @click="moveFile"
        >
          <FolderInput :size="13" /> 移动
        </button>
        <button
          v-if="isSetting"
          class="text-[12px] flex items-center gap-1 px-2.5 py-1 rounded-full cursor-pointer hover:bg-[var(--hover)] shrink-0"
          :style="{ color: 'var(--accent)' }"
          :disabled="checkup.running || !current"
          title="对照词典 / 境界 / 地图现状，全面检查设定一致性"
          @click="runCheckup"
        >
          <ShieldCheck :size="13" /> 设定体检
        </button>
        <button
          class="text-[12px] flex items-center gap-1 px-2.5 py-1 rounded-full cursor-pointer hover:bg-[var(--hover)]"
          :style="{ color: 'var(--accent)' }"
          :disabled="busy"
          title="让智能体审阅并优化这个文件"
          @click="askAgent"
        >
          <Sparkles :size="13" /> 让智能体帮忙
        </button>
        <button v-if="current" class="text-[11.5px] flex items-center gap-1 text-[var(--text-faint)] hover:text-[#e08a7a] cursor-pointer" @click="deleteFile">
          <Trash2 :size="12" /> 删除
        </button>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <!-- 体检报告卡 -->
        <div v-if="checkup.visible" class="p-5">
          <div class="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
            <div class="flex items-center gap-2 mb-3">
              <ShieldCheck :size="15" :style="{ color: 'var(--accent)' }" />
              <span class="text-sm font-medium">设定体检报告</span>
              <span v-if="checkup.running" class="text-[11px] text-[var(--text-faint)]">对照词典 / 境界 / 地图检查中…</span>
              <div class="flex-1" />
              <button v-if="checkup.running" class="text-[11.5px] text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer" @click="stopCheckup">停止</button>
              <button v-else class="text-[11.5px] text-[var(--text-faint)] hover:text-[var(--text)] cursor-pointer" @click="closeCheckup">关闭</button>
            </div>
            <div v-if="checkup.error" class="text-[12.5px] text-[#e08a7a] mb-2">{{ checkup.error }}</div>
            <div v-if="checkup.report" class="markdown-body text-[13px] leading-7 select-text" v-html="checkupHtml" />
            <div v-else-if="checkup.running" class="ink-dots py-3"><span /><span /><span /></div>
          </div>
        </div>
        <div v-else class="prose-ink">
          <InkEditor v-if="current" :key="current" v-model="content" :ghost="''" :placeholder="`编辑${props.dir}…`" />
          <div v-else class="text-[13px] text-[var(--text-faint)] text-center pt-20">选择或新建一个文件</div>
        </div>
      </div>
    </section>
  </div>
</template>
