<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAppStore } from '../store/app'
import { useLibraryStore } from '../store/library'
import InkButton from '../ui/InkButton.vue'
import PageSubNav from '../ui/PageSubNav.vue'
import { inkConfirm } from '../ui/inkPrompt'
import { aiRun } from '../ai'
import { renderMarkdown } from '../ui/markdown'
import RefPicker, { type RefItem } from '../ui/RefPicker.vue'
import { CircleCheck, Play, Pause, RotateCcw } from 'lucide-vue-next'

const app = useAppStore()
const lib = useLibraryStore()

/** 工作流引用资料：每次生成时注入提示词（会话级，localStorage 持久化） */
const REFS_KEY = 'inkdesk.wfRefs'
const wfRefs = ref<RefItem[]>((() => {
  try {
    return JSON.parse(localStorage.getItem(REFS_KEY) || '[]') as RefItem[]
  } catch {
    return []
  }
})())
/** 引用内容缓存（逐章生文时避免每章重读同一批条目） */
const refCache = new Map<string, string>()

watch(wfRefs, (v) => {
  localStorage.setItem(REFS_KEY, JSON.stringify(v))
  refCache.clear() // 引用列表变化后缓存作废，保证下次注入最新内容
})

async function buildRefsBlock(): Promise<string> {
  if (!wfRefs.value.length) return ''
  const parts: string[] = []
  for (const r of wfRefs.value) {
    const key = `${r.kind}/${r.group}/${r.name}`
    let body = refCache.get(key) || ''
    if (!body) {
      const e = (await window.api.libRead(r.kind, r.group, r.name)) as { body?: string } | null
      body = e?.body || ''
      refCache.set(key, body)
    }
    if (body.trim()) parts.push(`--- ${r.name} ---\n${body.slice(0, 8000)}`)
  }
  if (!parts.length) return ''
  return '\n\n【作者指定引用的资料】生成内容必须遵循这些技能方法论 / 与这些素材保持一致：\n' + parts.join('\n\n')
}

/** 各模板把引用追加到哪个自由文本变量上 */
const REF_TARGET: Record<string, string> = {
  'wf-idea': 'input',
  'wf-outline': 'idea',
  'wf-characters': 'outline',
  'wf-settings': 'outline',
  'wf-beat': 'outline',
  'wf-chapter': 'beat'
}

const STEPS = ['灵感', '大纲', '角色', '设定', '建书', '逐章生文']

const stepInput = ref('') // 用户原始输入（灵感）
const genText = ref('') // AI 生成结果（可编辑）
/** 产出按 Markdown 渲染（表格/引用/分隔线不再露记号） */
const genHtml = computed(() => renderMarkdown(genText.value))
const refOutline = ref('') // 大纲文本（角色/设定步骤引用）
const running = ref(false)
const liveLabel = ref('')
const chapterTotal = ref(12)
// 按总字数估算章数：总字数（万）÷ 单章字数（千字），填了自动换算
const estWan = ref<number | null>(null)
const estK = ref(3)
watch([estWan, estK], () => {
  const wan = Number(estWan.value)
  const k = Number(estK.value)
  if (wan > 0 && k > 0) chapterTotal.value = Math.max(4, Math.min(2000, Math.round((wan * 10000) / (k * 1000))))
})
const liveChapter = ref(0)
const paused = ref(true)
const error = ref('')
let aborter: { abort: () => void } | null = null

const wf = computed(() => lib.current?.workflow || { step: 0, chapterCursor: 1, chapterTotal: 12, completed: [] })
const cur = computed(() => Math.min(wf.value.step, 5))

async function loadOutline() {
  if (!lib.current) return ''
  return window.api.fileRead(lib.current.title, '大纲/大纲.md')
}

// 切换步骤时初始化
watch(cur, async () => {
  genText.value = ''
  error.value = ''
  if (!lib.current) return
  chapterTotal.value = wf.value.chapterTotal || 12
  if (cur.value === 0) stepInput.value = lib.current.idea || ''
  if (cur.value >= 1) {
    refOutline.value = await window.api.fileRead(lib.current.title, '大纲/大纲.md')
    const map = ['大纲/灵感方案.md', '角色/角色设定.md', '设定/世界观.md']
    const f = map[cur.value - 1]
    if (f) genText.value = await window.api.fileRead(lib.current.title, f)
  }
}, { immediate: true })

async function persistStep(step: number) {
  const w = { ...wf.value }
  w.step = step
  w.completed = [...(w.completed || [])]
  while (w.completed.length < step) w.completed.push(true)
  w.completed[step - 1] = true
  if (step === 5) w.chapterTotal = chapterTotal.value
  await lib.saveMeta({ workflow: w })
}

async function runPrompt(promptId: string, vars: Record<string, string>, task = 'workflow'): Promise<boolean> {
  running.value = true
  error.value = ''
  genText.value = ''
  // 作者引用的技能 / 素材 / 灵感随生成注入
  const finalVars = { ...vars }
  const target = REF_TARGET[promptId]
  if (target && finalVars[target] !== undefined) {
    finalVars[target] = finalVars[target] + (await buildRefsBlock())
  }
  // 流式看门狗：60 秒无 chunk 提示，150 秒无 chunk 自动中止（连接假死不再无限干等）
  // 推理模型的思考期会持续发 reason 信号，视为活动，不会误杀
  const labelBase = liveLabel.value
  let lastChunkAt = Date.now()
  let stalled = false
  let thinkingShown = false
  const watchdog = setInterval(() => {
    const idle = Date.now() - lastChunkAt
    if (idle > 150000) {
      stalled = true
      aborter?.abort()
    } else if (idle > 60000 && !stalled) {
      liveLabel.value = `${labelBase || '生成'} · 模型 ${Math.round(idle / 1000)} 秒无响应，仍在等待…`
    }
  }, 5000)
  const a = aiRun(task, promptId, finalVars, {
    onChunk: (c) => {
      lastChunkAt = Date.now()
      if (thinkingShown) {
        thinkingShown = false
        liveLabel.value = labelBase
      }
      genText.value += c
    },
    onReason: () => {
      // 模型在思考（推理模型的 reasoning 流）：重置看门狗并提示，正文一个字都还没开始出
      lastChunkAt = Date.now()
      if (!thinkingShown) {
        thinkingShown = true
        liveLabel.value = `${labelBase || '生成'} · 模型思考中…`
      }
    },
    onAborted: () => {
      if (stalled) error.value = '模型长时间无响应，已自动中止。可点「继续生成」重试本章。'
    }
  })
  aborter = a
  try {
    await a.promise
    return true
  } catch (e) {
    error.value = (e as Error).message
    return false
  } finally {
    clearInterval(watchdog)
    running.value = false
    aborter = null
    if (liveLabel.value.includes('秒无响应')) liveLabel.value = labelBase
  }
}

/** 步骤 1-3 的统一生成入口（设定集需要先读角色卡，不能复用编辑器里的旧文本） */
async function runStepGen() {
  if (!lib.current) return
  if (cur.value === 1) {
    await runPrompt('wf-outline', {
      title: lib.current.title,
      genre: lib.current.genre,
      idea: lib.current.idea || stepInput.value,
      chapterTotal: String(chapterTotal.value)
    }, 'structure')
  } else if (cur.value === 2) {
    await runPrompt('wf-characters', { outline: refOutline.value }, 'structure')
  } else if (cur.value === 3) {
    const chars = await window.api.fileRead(lib.current.title, '角色/角色设定.md')
    await runPrompt('wf-settings', { outline: refOutline.value, characters: chars }, 'structure')
  }
}

// 各步骤确认写入
async function confirmIdea() {
  if (!genText.value.trim()) return
  await lib.saveMeta({ idea: stepInput.value })
  await window.api.fileWrite(lib.current!.title, '大纲/灵感方案.md', genText.value)
  await persistStep(1)
}
async function confirmOutline() {
  if (!genText.value.trim()) return
  await window.api.fileWrite(lib.current!.title, '大纲/大纲.md', genText.value)
  await lib.refreshTree()
  await persistStep(2)
}
async function confirmCharacters() {
  if (!genText.value.trim()) return
  await window.api.fileWrite(lib.current!.title, '角色/角色设定.md', genText.value)
  await persistStep(3)
}
async function confirmSettings() {
  if (!genText.value.trim()) return
  await window.api.fileWrite(lib.current!.title, '设定/世界观.md', genText.value)
  await persistStep(4)
}
async function confirmCreate() {
  await lib.refreshTree()
  await persistStep(5)
  // 建书完成：后台自动把角色卡/世界观登记进词典、境界、地图、关系图（生成即同步，免事后补录）
  void registerStructure()
}

// ============ 自动登记结构化资料（阶段一：条目归工具） ============
const registering = ref('')

async function registerStructure() {
  if (!lib.current || registering.value) return
  registering.value = '正在把角色卡 / 世界观登记到词典、境界、地图、关系图…'
  try {
    const characters = await window.api.fileRead(lib.current.title, '角色/角色设定.md')
    const settings = await window.api.fileRead(lib.current.title, '设定/世界观.md')
    if (!characters.trim() && !settings.trim()) {
      registering.value = ''
      return
    }
    const src = `【角色卡】\n${characters.slice(0, 30000)}\n\n【设定集】\n${settings.slice(0, 30000)}`
    const aborter = aiRun('workflow', 'wf-structure-extract', { source: src })
    const full = await aborter.promise
    const m = full.match(/\{[\s\S]*\}/)
    if (!m) {
      registering.value = '自动登记跳过：AI 未返回结构化数据（可在对话里让设定智能体补录）'
      return
    }
    const payload = JSON.parse(m[0]) as Record<string, unknown>
    const r = await window.api.structureRegister(lib.current.title, payload)
    const parts: string[] = []
    if ((r.dict ?? -1) >= 0) parts.push(`词典 ${r.dict} 条`)
    if ((r.realms ?? -1) >= 0) parts.push(`境界 ${r.realms} 级`)
    if ((r.mapNodes ?? -1) >= 0) parts.push(`地图 ${r.mapNodes} 节点`)
    if ((r.graphNodes ?? -1) >= 0) parts.push(`关系图 ${r.graphNodes} 角色`)
    registering.value = parts.length ? `已自动登记：${parts.join(' · ')}` : ''
  } catch (e) {
    registering.value = `自动登记失败：${(e as Error).message}（可稍后在对话里让设定智能体补录）`
  } finally {
    setTimeout(() => (registering.value = ''), 12000)
  }
}

function back() {
  if (wf.value.step > 0) lib.saveMeta({ workflow: { ...wf.value, step: wf.value.step - 1 } })
}
function jumpStep(i: number) {
  if (wf.value.completed?.[i - 1] || i <= cur.value) lib.saveMeta({ workflow: { ...wf.value, step: i } })
}

/** 从细纲文本提取章节标题（首行「# 第N章 xxx」→「xxx」） */
function beatTitle(beat: string): string {
  const first = beat.split('\n').find((l) => l.trim()) || ''
  return first
    .replace(/^#+\s*/, '')
    .replace(/^第\s*\d+\s*章[:：、\s]*/, '')
    .trim()
    .slice(0, 60)
}

/** 细纲压成一段话（去掉标题行后的前 300 字） */
function beatBrief(beat: string): string {
  const lines = beat
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const body = lines.filter((l) => !/^#{1,3}\s|^第\s*\d+\s*章/.test(l))
  return (body.join(' ') || lines.join(' ')).slice(0, 300)
}

async function generateChapters() {
  if (!lib.current) return
  paused.value = false
  const total = wf.value.chapterTotal
  try {
    while (!paused.value && wf.value.chapterCursor <= total) {
    const no = wf.value.chapterCursor
    liveChapter.value = no
    // 0. 细纲板存档优先：该章已有全文细纲（beatFull，智能体提交或上次生成落盘的）直接采用，不重新构思
    let beat = ''
    const registered = ((await window.api.outlineRead(lib.current.title)) as { no: number; beatFull?: string }[]).find(
      (e) => e.no === no && typeof e.beatFull === 'string' && e.beatFull.trim()
    )
    if (registered) {
      beat = registered.beatFull!.trim()
      liveLabel.value = `第 ${no} 章 · 采用细纲板存档细纲`
    } else {
      // 1. 章节细纲：大纲可裁剪（按卷），角色卡/设定保持全量——策划阶段需要看全貌
      liveLabel.value = `第 ${no} 章 · 构思细纲`
      const beatCtx = await chapterContext('', no, total)
      const okBeat = await runPrompt('wf-beat', {
        chapterNo: String(no),
        outline: beatCtx.outline,
        settings: beatCtx.settings,
        characters: beatCtx.characters,
        prevSummary: no > 1 ? await chapterTail(no - 1) : '（这是第一章）',
        chapterTotal: String(total),
        memory: await memoryBlock()
      }, 'structure')
      // 生成失败/中止时断开：防止把半截细纲或半截正文当完整结果落盘
      if (paused.value || !okBeat || !genText.value.trim()) break
      beat = genText.value
      // 细纲落盘：存入细纲板对应章节（幂等覆盖），title 取细纲首行标题，全文一并存档供下次直接采用
      void window.api.outlineUpsert(lib.current.title, {
        no,
        title: beatTitle(beat),
        beat: beatBrief(beat),
        beatFull: beat,
        status: '待写'
      })
    }
    // 2. 正文：细纲定稿后按出场角色裁角色卡（词典匹配 + 主角强制保留），伏笔板全量注入
    liveLabel.value = `第 ${no} 章 · 撰写正文`
    const bodyCtx = await chapterContext(beat, no, total)
    const okBody = await runPrompt('wf-chapter', {
      chapterNo: String(no),
      beat,
      outline: bodyCtx.outline,
      settings: bodyCtx.settings,
      characters: bodyCtx.characters,
      foreshadow: bodyCtx.foreshadow,
      prevTail: no > 1 ? await chapterTail(no - 1) : '',
      memory: await memoryBlock()
    }, 'chapter')
    if (paused.value || !okBody || !genText.value.trim()) break
    // 3. 写盘并推进（已有内容的章节跳过不覆盖，保护手工润色稿）
    const rel = `正文/第${String(no).padStart(3, '0')}章.md`
    const existing = await window.api.fileRead(lib.current.title, rel)
    if (!existing.trim()) {
      await window.api.fileWrite(lib.current.title, rel, genText.value)
      await lib.refreshTree()
    } else {
      liveLabel.value = `第 ${no} 章 · 文件已存在，跳过写盘`
    }
    const w = { ...wf.value, chapterCursor: no + 1 }
    w.completed = [...(w.completed || [])]
    w.completed[no] = true
    await lib.saveMeta({ workflow: w, updatedAt: new Date().toISOString() })
    // 细纲板同步完成状态
    void window.api.outlineSetStatus(lib.current.title, no, '已写')
    }
  } catch (e) {
    // 任何一环出错都要显性报出来，不允许静默假死
    error.value = `逐章生文中断：${(e as Error).message}（进度已保存，可点「继续生成」从断点重试）`
  } finally {
    paused.value = true
    liveLabel.value = ''
  }
}

async function chapterTail(no: number): Promise<string> {
  const rel = `正文/第${String(no).padStart(3, '0')}章.md`
  const text = await window.api.fileRead(lib.current!.title, rel)
  return text.slice(-500)
}

/** 作者记忆块：全局 + 本书两层，注入 wf-beat / wf-chapter，让逐章生文遵守立过的规矩 */
async function memoryBlock(): Promise<string> {
  try {
    const fmt = (list: unknown): string =>
      ((list as { text?: string }[]) || [])
        .filter((e) => e && typeof e.text === 'string' && e.text.trim())
        .map((e) => `- ${e.text!.trim()}`)
        .join('\n')
    const g = fmt(await window.api.memoryReadGlobal())
    const b = lib.current ? fmt(await window.api.memoryReadBook(lib.current.title)) : ''
    const parts = [g && `【全局记忆】\n${g}`, b && `【本书记忆】\n${b}`].filter(Boolean)
    const out = parts.join('\n')
    return out ? out.slice(0, 3000) : '（暂无）'
  } catch {
    return '（暂无）'
  }
}

// ============ 保守版上下文裁剪（方案二）：大纲按卷切 + 角色卡按出场切，任何失败回退全量 ============
const TRIM_KEY = 'inkdesk.wf.trim'
const trimEnabled = ref(localStorage.getItem(TRIM_KEY) !== '0')
watch(trimEnabled, (v) => localStorage.setItem(TRIM_KEY, v ? '1' : '0'))

/** 大纲按卷切：取「总述部分 + 当前章所在卷」。卷边界按「第X卷」标题切，章节范围按标题里的数字区间认领；认不出就均匀估算；解析失败回退全文 */
function sliceOutlineByVolume(outline: string, chapterNo: number, total: number): string {
  try {
    const re = /^#{1,3}[^\n]*第[一二三四五六七八九十百千\d]+卷[^\n]*$/gm
    const heads: { start: number; end: number }[] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(outline))) heads.push({ start: m.index, end: re.lastIndex })
    if (!heads.length) return outline
    const head = outline.slice(0, heads[0].start) // 卷前总述（故事主线/全书结构）
    const sections = heads.map((h, i) => outline.slice(h.start, i + 1 < heads.length ? heads[i + 1].start : outline.length))
    const volCount = sections.length
    // 优先按标题里的章节区间认领（如「第1-50章」）
    let pick = -1
    for (let i = 0; i < sections.length; i++) {
      const r = sections[i].slice(0, 200).match(/(\d+)\s*[-–—~至到]\s*(\d+)\s*章/)
      if (r && chapterNo >= parseInt(r[1]) && chapterNo <= parseInt(r[2])) {
        pick = i
        break
      }
    }
    // 认不出就按总章数均匀估算
    if (pick === -1) pick = Math.min(volCount - 1, Math.floor(((chapterNo - 1) / Math.max(1, total)) * volCount))
    return `${head}\n${sections[pick].trim()}\n\n（其余卷内容已省略，只保留本卷大纲；跨卷情节以伏笔登记板为准）`
  } catch {
    return outline
  }
}

/** 角色卡按出场切：细纲里出现的角色（词典精确匹配）+ 主角强制保留；切不出便宜（角色少或没匹配到）就回退全文 */
async function sliceCharactersByCast(characters: string, beat: string): Promise<string> {
  try {
    if (characters.length < 2500) return characters // 本来就短，不值得裁
    const dict = ((await window.api.dictRead(lib.current.title)) as { term: string; aliases: string[]; category: string }[]) || []
    const names = new Set<string>()
    for (const d of dict) {
      if (d.category !== '人物') continue
      for (const n of [d.term, ...(d.aliases || [])]) if (n && n.length >= 2 && beat.includes(n)) names.add(n)
    }
    // 按 # 标题拆角色小节
    const re = /^#{1,4}[^\n]*$/gm
    const heads: number[] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(characters))) heads.push(m.index)
    if (!heads.length) return characters
    const head = characters.slice(0, heads[0])
    const sections = heads.map((h, i) => characters.slice(h, i + 1 < heads.length ? heads[i + 1] : characters.length))
    const kept = sections.filter((s, i) => {
      if (i === 0) return true // 主角卡强制保留（角色卡约定主角排第一）
      const sample = s.slice(0, 400) // 标题+开头认领足够
      for (const n of names) if (sample.includes(n)) return true
      return false
    })
    // 一个都没匹配上（细纲用代称等），裁剪不可信 → 回退全量
    if (!names.size || kept.length >= sections.length) return characters
    return `${head}\n${kept.join('\n')}\n\n（仅保留本章出场角色的角色卡；其余角色以专名词典登记为准）`
  } catch {
    return characters
  }
}

/** 生成单章上下文：trim 开启时裁大纲+角色卡，全量设定不动；伏笔登记板全量注入补盲区 */
async function chapterContext(beat: string, chapterNo: number, total: number) {
  const outlineFull = await loadOutline()
  const settings = await window.api.fileRead(lib.current!.title, '设定/世界观.md')
  const charactersFull = await window.api.fileRead(lib.current!.title, '角色/角色设定.md')
  const out = { outline: outlineFull, settings, characters: charactersFull, foreshadow: '（伏笔登记板为空）' }
  if (trimEnabled.value) {
    try {
      out.outline = sliceOutlineByVolume(outlineFull, chapterNo, total)
      out.characters = await sliceCharactersByCast(charactersFull, beat)
    } catch {
      /* 裁剪失败保持全量 */
    }
  }
  try {
    const fs = ((await window.api.foreshadowRead(lib.current!.title)) as { content: string; plantChapter: string; planRecycle: string; status: string }[]) || []
    const lines = fs
      .filter((f) => f.content?.trim())
      .map((f) => `· [${f.status}] ${f.content}${f.plantChapter ? `（埋于${f.plantChapter}）` : ''}${f.planRecycle ? `→ 计划回收：${f.planRecycle}` : ''}`)
    if (lines.length) out.foreshadow = lines.join('\n').slice(0, 2500)
  } catch {
    /* 忽略 */
  }
  return out
}

function pauseChapters() {
  paused.value = true
  aborter?.abort()
}

async function resetWorkflow() {
  const ok = await inkConfirm('确定重置工作流进度？', { detail: '已生成的文件不会删除。', confirmText: '重置' })
  if (!ok) return
  lib.saveMeta({ workflow: { step: 0, chapterCursor: 1, chapterTotal: chapterTotal.value, completed: [] } })
}
</script>

<template>
  <div v-if="!lib.current" class="h-full flex flex-col items-center justify-center text-[var(--text-faint)] gap-4">
    <p>先在书架新建或打开一部作品，再使用工作流一键建书</p>
    <InkButton @click="app.go('bookshelf')">去书架</InkButton>
  </div>

  <div v-else class="h-full flex flex-col">
    <!-- 统一二级导航：六步进度 -->
    <PageSubNav dense>
      <template #left>
        <div class="flex items-center gap-1">
          <template v-for="(s, i) in STEPS" :key="s">
            <button
              class="flex items-center gap-1.5 px-3 py-1 rounded-full text-[12.5px] cursor-pointer transition-colors"
              :class="i === cur ? 'font-medium bg-[var(--panel-2)]' : 'text-[var(--text-faint)] hover:text-[var(--text-dim)]'"
              :style="i === cur ? { color: 'var(--accent)' } : {}"
              @click="jumpStep(i)"
            >
              <CircleCheck v-if="wf.completed?.[i] || i < cur" :size="13" style="color: var(--accent)" />
              <span>{{ i + 1 }}. {{ s }}</span>
            </button>
            <div v-if="i < STEPS.length - 1" class="w-3 h-px bg-[var(--border)]" />
          </template>
        </div>
      </template>
      <template #right>
        <button class="text-[12px] flex items-center gap-1 text-[var(--text-faint)] hover:text-[#e08a7a] cursor-pointer" @click="resetWorkflow">
          <RotateCcw :size="12" /> 重置进度
        </button>
      </template>
    </PageSubNav>

    <!-- 步骤内容 -->
    <div class="flex-1 min-h-0 overflow-y-auto px-8 py-6">
      <!-- 引用资料：技能 / 素材 / 灵感，注入每一步生成 -->
      <div class="max-w-3xl mx-auto mb-4">
        <RefPicker v-model="wfRefs" />
      </div>
      <!-- Step 0 灵感 -->
      <div v-if="cur === 0" class="max-w-3xl mx-auto space-y-4">
        <div>
          <div class="text-sm mb-1.5 text-[var(--text-dim)]">写下你的灵感（一句话、一段话都可以）</div>
          <textarea v-model="stepInput" class="ink-textarea h-24" placeholder="例如：一个失忆的灯塔守护人，每晚梦到不属于自己的记忆…" />
        </div>
        <InkButton :disabled="running || !stepInput.trim()" @click="runPrompt('wf-idea', { input: stepInput }, 'draft')">
          {{ running ? '生成中…' : 'AI 扩展灵感方案' }}
        </InkButton>
        <div v-if="genText">
          <div class="text-sm mb-1.5 text-[var(--text-dim)]">灵感方案（可修改）</div>
          <textarea v-model="genText" class="ink-textarea h-72 text-[15px] leading-8" />
          <div class="flex justify-end mt-3"><InkButton @click="confirmIdea">确认，进入大纲</InkButton></div>
        </div>
      </div>

      <!-- Step 1-3 生成类 -->
      <div v-else-if="cur >= 1 && cur <= 3" class="max-w-3xl mx-auto space-y-4">
        <div class="flex items-center gap-3">
          <InkButton
            :disabled="running"
            @click="runStepGen"
          >
            {{ genText ? '重新生成' : 'AI 生成' }}{{ ['', '大纲', '角色卡', '设定集'][cur] }}
          </InkButton>
          <div v-if="cur === 1" class="flex items-center gap-2 flex-wrap text-sm text-[var(--text-dim)]">
            <span class="inline-flex items-center gap-1">
              全书约 <input v-model.number="chapterTotal" type="number" min="4" max="2000" class="ink-input w-20 text-center py-1" /> 章
            </span>
            <span class="text-[11px] text-[var(--text-faint)]">或按字数估算：</span>
            <span class="inline-flex items-center gap-1 text-[12px]">
              <input v-model.number="estWan" type="number" min="0" step="10" placeholder="300" class="ink-input w-16 text-center py-1" /> 万字
              <span class="text-[var(--text-faint)]">÷</span>
              单章 <input v-model.number="estK" type="number" min="0.5" step="0.5" class="ink-input w-14 text-center py-1" /> 千字
            </span>
          </div>
        </div>
        <div v-if="running" class="ink-dots py-2"><span /><span /><span /></div>
        <div v-if="error" class="text-sm text-[#e08a7a]">{{ error }}</div>
        <div v-if="genText">
          <div class="text-sm mb-1.5 text-[var(--text-dim)]">{{ ['', '大纲', '角色卡', '设定集'][cur] }}（可修改）</div>
          <textarea v-model="genText" class="ink-textarea h-[420px] text-[15px] leading-8" />
          <div class="flex justify-end mt-3">
            <InkButton @click="[confirmOutline, confirmCharacters, confirmSettings][cur - 1]()">确认保存</InkButton>
          </div>
        </div>
      </div>

      <!-- Step 4 建书确认 -->
      <div v-else-if="cur === 4" class="max-w-3xl mx-auto space-y-5">
        <div class="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6" style="box-shadow: var(--shadow)">
          <div class="font-serif-ink text-lg mb-3">《{{ lib.current.title }}》书籍结构已就绪</div>
          <ul class="text-sm text-[var(--text-dim)] space-y-1.5">
            <li>· 大纲 / 大纲.md（{{ (wf.completed?.[1] && '已生成') || '未生成' }}）</li>
            <li>· 角色 / 角色设定.md（{{ (wf.completed?.[2] && '已生成') || '未生成' }}）</li>
            <li>· 设定 / 世界观.md（{{ (wf.completed?.[3] && '已生成') || '未生成' }}）</li>
            <li>· 全书 {{ wf.chapterTotal }} 章，将从第 {{ wf.chapterCursor }} 章开始生文</li>
          </ul>
          <p class="text-xs text-[var(--text-faint)] mt-3">前三章已按「黄金三章」规则设计：第一章抛出核心冲突与金手指，第二章放大危机，第三章给出第一次小高潮。</p>
        </div>
        <InkButton @click="confirmCreate">完成建书，进入逐章生文</InkButton>
      </div>

      <!-- Step 5 逐章生文 -->
      <div v-else class="max-w-3xl mx-auto space-y-4">
        <div class="flex items-center gap-3 flex-wrap">
          <InkButton v-if="paused" :disabled="running" @click="generateChapters">
            <Play :size="14" /> {{ wf.chapterCursor > 1 ? `继续生成（第 ${wf.chapterCursor} 章起）` : '开始逐章生文' }}
          </InkButton>
          <InkButton v-else variant="ghost" @click="pauseChapters"><Pause :size="14" /> 暂停</InkButton>
          <span class="text-sm text-[var(--text-dim)]">进度：{{ wf.chapterCursor - 1 }} / {{ wf.chapterTotal }} 章</span>
          <button
            class="px-3 py-1 text-[11.5px] rounded-full cursor-pointer transition-colors border"
            :class="trimEnabled ? 'font-medium' : 'text-[var(--text-faint)]'"
            :style="trimEnabled ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : { borderColor: 'var(--border)' }"
            title="开启后按卷裁大纲、按出场裁角色卡（词典匹配+主角强制保留，失败自动回退全量）；设定集始终全量，伏笔板全量注入"
            @click="trimEnabled = !trimEnabled"
          >
            {{ trimEnabled ? '✓' : '' }} 裁剪注入
          </button>
          <span v-if="liveLabel" class="text-sm" style="color: var(--accent)">{{ liveLabel }}</span>
        </div>
        <div class="w-full h-2 rounded-full bg-[var(--bg-soft)] overflow-hidden">
          <div class="h-full rounded-full transition-all" :style="{ width: ((wf.chapterCursor - 1) / wf.chapterTotal) * 100 + '%', background: 'var(--accent)' }" />
        </div>
        <div v-if="registering" class="text-[12px] flex items-center gap-2" :style="{ color: 'var(--accent)' }">
          <span v-if="registering.includes('…')" class="ink-dots"><span /><span /><span /></span>
          {{ registering }}
        </div>
        <div v-if="error" class="text-sm text-[#e08a7a]">{{ error }}</div>
        <div v-if="genText" class="markdown-body rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 text-[15px] leading-8 max-h-[440px] overflow-y-auto" v-html="genHtml" />
        <p class="text-xs text-[var(--text-faint)]">生成完成的章节自动写入「正文」目录，可在写作台继续修改。随时暂停，下次从断点继续。</p>
      </div>
    </div>
  </div>
</template>
