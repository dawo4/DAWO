<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useAppStore } from '../../store/app'
import { useConversationStore } from '../../store/conversation'
import { useLibrariesStore } from '../../store/libraries'
import { useLibraryStore } from '../../store/library'
import type { LibEntry, LibKind } from '../../types'
import InkSegmented from '../../ui/InkSegmented.vue'
import { CREATIVE_LEVELS, THINKING_LEVELS, levelToTemp, tempToLevel } from '../../ui/writingScale'
import { ArrowUp, Square, Paperclip, Sparkles, BookOpen, Settings2, X, Search, Lightbulb, Users, Image as ImageIcon } from 'lucide-vue-next'

const app = useAppStore()
const conv = useConversationStore()
const libs = useLibrariesStore()
const lib = useLibraryStore()

const text = ref('')
const area = ref<HTMLTextAreaElement>()
const fileInput = ref<HTMLInputElement>()
const pickMode = ref<'' | 'skill' | 'material' | 'note' | 'chapter'>('')
const pickQuery = ref('')
const paramsOpen = ref(false)
const ctxOpen = ref(false)
const chapterOpen = ref(false)
const teamOpen = ref(false)

/** 圆桌模式成员（按发言顺序） */
const teamAgents = computed(() => conv.teamAgents)
const teamActive = computed(() => teamAgents.value.length >= 2)

const hasImages = computed(() => conv.attachments.some((a) => a.image))
/** 有文字或附了图片即可发送（纯图片也可以直接问） */
const canSend = computed(() => (!!text.value.trim() || hasImages.value) && !conv.running)

/** 已引用章节带来的上下文总字数（含附件） */
const refChars = computed(() => conv.attachments.reduce((a, x) => a + x.text.length, 0))

const chapters = computed(() => {
  const q = pickQuery.value.trim().toLowerCase()
  const list = lib.chapterList().map((c) => ({ path: c.path, name: c.name.replace(/\.md$/, '') }))
  return q ? list.filter((c) => c.name.toLowerCase().includes(q)) : list
})

function chapterRefed(path: string): boolean {
  return conv.attachments.some((a) => a.name === `章节·${path.split('/').pop()?.replace(/\.md$/, '')}`)
}

/** 把整章内容作为上下文引用进来 */
async function citeChapter(path: string) {
  if (!lib.current || chapterRefed(path)) {
    pickMode.value = ''
    return
  }
  const text = await window.api.fileRead(lib.current.title, path)
  if (!text.trim()) return
  const name = path.split('/').pop()?.replace(/\.md$/, '') || path
  conv.addAttachment(`章节·${name}`, text.slice(0, 60000))
  pickMode.value = ''
  chapterOpen.value = false
}

const thinkingLevel = ref<'off' | 'low' | 'medium' | 'high'>('medium')
const creativeLevel = ref('balanced')
const temperature = ref(0.7)

watch(
  () => app.config?.agentParams,
  (v) => {
    if (v) {
      thinkingLevel.value = v.thinkingLevel
      temperature.value = v.temperature
      creativeLevel.value = tempToLevel(v.temperature)
    }
  },
  { immediate: true }
)

watch(creativeLevel, (v) => (temperature.value = levelToTemp(v)))

const modelName = computed(() => app.config?.tasks?.agent?.model || '未配置')
const providerName = computed(() => {
  const id = app.config?.tasks?.agent?.providerId
  return app.config?.providers.find((p) => p.id === id)?.name || '未选择'
})

const pickKind = computed<LibKind>(() => (pickMode.value === 'skill' ? 'skills' : pickMode.value === 'note' ? 'notes' : 'materials'))

const pickItems = computed<{ entry: LibEntry }[]>(() => {
  if (!pickMode.value) return []
  const q = pickQuery.value.trim().toLowerCase()
  const out: { entry: LibEntry }[] = []
  for (const g of libs.groups(pickKind.value)) {
    for (const e of g.entries) {
      if (q && !`${e.name}${e.summary}${e.tags.join('')}`.toLowerCase().includes(q)) continue
      out.push({ entry: e })
    }
  }
  return out.slice(0, 60)
})

/** 上下文体积估算：中文按 1 字 ≈ 1 token 的粗略口径 */
const contextChars = computed(() => {
  let n = refChars.value
  for (const m of conv.messages) n += m.content.length + (m.thinking?.length || 0)
  return n
})
const contextTokens = computed(() => Math.round(contextChars.value / 1.4))

/** 窗口占用百分比（未知窗口为 null） */
const usagePercent = computed(() => conv.contextUsage?.percent ?? null)

function resize() {
  const el = area.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 220)}px`
}

onMounted(() => void libs.refresh())

async function send() {
  if (!canSend.value) return
  const t = text.value
  text.value = ''
  pickMode.value = ''
  await nextTick()
  resize()
  await conv.send(t)
}

function onInput() {
  resize()
  const el = area.value
  if (!el) return
  const caret = el.selectionStart
  const prev = text.value.slice(0, caret)
  const ch = prev.slice(-1)
  if (ch === '/') {
    pickMode.value = 'skill'
    pickQuery.value = ''
  } else if (ch === '@') {
    pickMode.value = 'material'
    pickQuery.value = ''
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    pickMode.value = ''
    paramsOpen.value = false
    teamOpen.value = false
    return
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    void send()
  }
}

function choosePick(entry: LibEntry) {
  pickMode.value = ''
  if (entry.kind === 'skills') conv.addSkillRef({ group: entry.group, name: entry.name })
  else if (entry.kind === 'notes') conv.addNoteRef({ group: entry.group, name: entry.name })
  else conv.addMaterialRef({ group: entry.group, name: entry.name })
  text.value = text.value.replace(/[/@]$/, '')
  void nextTick(() => area.value?.focus())
}

async function onFiles(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (!files) return
  for (const f of Array.from(files)) {
    if (f.type.startsWith('image/')) {
      // 图片：转 data URL 附给多模态模型（单图 ≤4MB，最多 3 张）
      if (f.size > 4 * 1024 * 1024) {
        alert(`图片「${f.name}」超过 4MB，未附加`)
        continue
      }
      if (conv.attachments.filter((a) => a.image).length >= 3) {
        alert('最多附加 3 张图片')
        break
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.onerror = () => reject(r.error)
        r.readAsDataURL(f)
      })
      conv.addImageAttachment(f.name, dataUrl)
    } else {
      const content = await f.text()
      conv.addAttachment(f.name, content.slice(0, 40000))
    }
  }
  if (fileInput.value) fileInput.value.value = ''
}

/** 当前服务商是否开启了图片理解 */
const providerVision = computed(() => {
  const id = app.config?.tasks?.agent?.providerId
  return !!app.config?.providers.find((p) => p.id === id)?.vision
})

async function saveParams() {
  await app.updateConfig({
    agentParams: { thinkingLevel: thinkingLevel.value, temperature: temperature.value }
  })
}

async function toggleApproval() {
  await conv.setApprovalMode(conv.approvalMode === 'manual' ? 'auto-approve' : 'manual')
}

</script>

<template>
  <div class="relative">
    <!-- 引用与附件 chips -->
    <div class="flex flex-wrap gap-1.5 mb-2">
      <span v-for="(s, i) in conv.skillRefs" :key="'s' + i" class="ink-chip-btn">
        <Sparkles :size="11" class="text-[var(--accent)]" />{{ s.name }}
        <button class="text-[var(--text-faint)] hover:text-[var(--danger)] cursor-pointer" @click="conv.removeSkillRef(i)"><X :size="11" /></button>
      </span>
      <!-- 圆桌模式 -->
      <button
        class="ink-chip-btn"
        :class="{ 'is-on': teamOpen || teamActive }"
        :title="teamActive ? `圆桌：${teamAgents.length} 位成员按顺序发言` : '圆桌模式：多位智能体按顺序接力讨论'"
        @click="teamOpen = !teamOpen"
      >
        <Users :size="11" />
        圆桌
        <span v-if="teamActive" class="text-micro opacity-70">{{ teamAgents.length }} 位</span>
      </button>
      <!-- @关联章节 -->
      <button
        class="ink-chip-btn"
        :class="{ 'is-on': chapterOpen || refChars }"
        @click="chapterOpen = !chapterOpen; pickMode = ''"
      >
        @关联章节
        <span class="text-micro opacity-70">共 {{ refChars }} 字</span>
      </button>
      <span v-for="(m, i) in conv.materialRefs" :key="'m' + i" class="ink-chip-btn">
        <BookOpen :size="11" class="text-[var(--accent)]" />{{ m.name }}
        <button class="text-[var(--text-faint)] hover:text-[var(--danger)] cursor-pointer" @click="conv.removeMaterialRef(i)"><X :size="11" /></button>
      </span>
      <span v-for="(n, i) in conv.noteRefs" :key="'n' + i" class="ink-chip-btn">
        <Lightbulb :size="11" class="text-[var(--accent)]" />{{ n.name }}
        <button class="text-[var(--text-faint)] hover:text-[var(--danger)] cursor-pointer" @click="conv.removeNoteRef(i)"><X :size="11" /></button>
      </span>
      <span v-for="(a, i) in conv.attachments" :key="'a' + i" class="ink-chip-btn">
        <template v-if="a.image">
          <ImageIcon :size="11" class="text-[var(--accent)]" />{{ a.name }}
        </template>
        <template v-else>
          <Paperclip :size="11" />{{ a.name }} · {{ a.text.length }} 字
        </template>
        <button class="text-[var(--text-faint)] hover:text-[var(--danger)] cursor-pointer" @click="conv.removeAttachment(i)"><X :size="11" /></button>
      </span>
      <span
        v-if="hasImages && !providerVision"
        class="ink-chip ink-soft-danger ink-text-danger"
        style="cursor: default"
        title="当前服务商未开启「支持图片理解」，请到 设置 → AI 服务 开启"
      >
        ⚠ 当前模型未开启识图
      </span>
    </div>

    <!-- 章节引用选择器 -->
    <div v-if="chapterOpen" class="pop absolute bottom-full left-0 w-[420px] max-w-[90vw] mb-2 overflow-hidden z-40">
      <div class="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
        <Search :size="13" class="text-[var(--text-faint)]" />
        <input v-model="pickQuery" class="flex-1 bg-transparent outline-none text-label" placeholder="搜索章节…" autofocus />
        <button class="text-meta text-[var(--text-faint)] hover:text-[var(--accent)] cursor-pointer" @click="chapterOpen = false">关闭</button>
      </div>
      <div class="max-h-72 overflow-y-auto">
        <div v-for="c in chapters" :key="c.path" class="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] last:border-b-0">
          <span class="text-label flex-1 truncate">{{ c.name }}</span>
          <button
            class="text-meta px-2.5 py-0.5 rounded-full cursor-pointer"
            :class="chapterRefed(c.path) ? 'text-[var(--text-faint)] cursor-default' : 'hover:bg-[var(--hover)]'"
            :style="chapterRefed(c.path) ? {} : { color: 'var(--accent)' }"
            :disabled="chapterRefed(c.path)"
            @click="citeChapter(c.path)"
          >
            {{ chapterRefed(c.path) ? '已引用' : '引用' }}
          </button>
        </div>
        <div v-if="!chapters.length" class="px-3 py-6 text-center text-label text-[var(--text-faint)]">
          {{ lib.current ? '这部作品还没有章节' : '尚未打开作品' }}
        </div>
      </div>
      <div class="px-3 py-1.5 border-t border-[var(--border)] text-micro text-[var(--text-faint)]">
        引用的章节会随每次提问一并交给智能体，便于它对照原文
      </div>
    </div>

    <!-- 圆桌成员选择器 -->
    <div v-if="teamOpen" class="pop absolute bottom-full left-0 w-[420px] max-w-[90vw] mb-2 overflow-hidden z-40">
      <div class="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
        <span class="text-label font-medium">圆桌模式</span>
        <button class="text-meta text-[var(--text-faint)] hover:text-[var(--accent)] cursor-pointer" @click="teamOpen = false">关闭</button>
      </div>
      <div class="max-h-64 overflow-y-auto">
        <button
          v-for="a in conv.allAgents.filter((x) => x.id !== 'general' && !x.panel)"
          :key="a.id"
          class="w-full text-left px-3.5 py-2.5 hover:bg-[var(--hover)] cursor-pointer border-b border-[var(--border)] last:border-b-0 flex items-center gap-2"
          @click="conv.toggleTeamAgent(a.id)"
        >
          <span
            v-if="teamAgents.includes(a.id)"
            class="w-5 h-5 rounded-full text-micro flex items-center justify-center shrink-0 text-[var(--accent-ink)] font-medium"
            :style="{ background: 'var(--accent)' }"
          >
            {{ teamAgents.indexOf(a.id) + 1 }}
          </span>
          <span v-else class="w-5 h-5 rounded-full border border-[var(--border)] shrink-0" />
          <span class="flex-1 min-w-0">
            <span class="text-label" :style="teamAgents.includes(a.id) ? { color: 'var(--accent)' } : {}">{{ a.name }}</span>
            <span class="text-meta text-[var(--text-faint)] ml-2">{{ a.desc }}</span>
          </span>
        </button>
      </div>
      <div class="px-3 py-2 border-t border-[var(--border)] flex items-center justify-between gap-2">
        <span class="text-micro text-[var(--text-faint)] leading-4">
          {{ teamActive ? '发送后成员按编号顺序接力发言，后者能看到前面的发言' : '至少选择 2 位成员；点击顺序即发言顺序' }}
        </span>
        <button
          v-if="teamAgents.length"
          class="text-meta text-[var(--text-dim)] hover:text-[var(--danger)] cursor-pointer shrink-0"
          @click="conv.clearTeam()"
        >
          散团
        </button>
      </div>
    </div>

    <!-- 选择器 -->
    <div v-if="pickMode" class="pop absolute bottom-full left-0 right-0 mb-2 overflow-hidden z-40">
      <div class="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
        <Search :size="13" class="text-[var(--text-faint)]" />
        <input
          v-model="pickQuery"
          class="flex-1 bg-transparent outline-none text-label"
          :placeholder="pickMode === 'skill' ? '搜索技能（黄金三章 / 去 AI 味 / 弧光…）' : pickMode === 'note' ? '搜索灵感便签' : '搜索素材'"
          autofocus
        />
        <button class="text-meta text-[var(--text-faint)] hover:text-[var(--accent)] cursor-pointer" @click="pickMode = ''">关闭</button>
      </div>
      <div class="max-h-60 overflow-y-auto">
        <button
          v-for="it in pickItems"
          :key="it.entry.kind + it.entry.group + it.entry.name"
          class="w-full text-left px-3 py-2 hover:bg-[var(--hover)] cursor-pointer border-b border-[var(--border)] last:border-b-0"
          @click="choosePick(it.entry)"
        >
          <div class="text-label">{{ it.entry.name }}</div>
          <div class="text-meta text-[var(--text-faint)] truncate">{{ it.entry.group }} · {{ it.entry.summary || '无摘要' }}</div>
        </button>
        <div v-if="!pickItems.length" class="px-3 py-6 text-center text-label text-[var(--text-faint)]">
          暂无条目，可到「资源库」新建
        </div>
      </div>
    </div>

    <!-- 模型参数浮层 -->
    <div v-if="paramsOpen" class="pop absolute bottom-full right-0 mb-2 w-80 p-3.5 space-y-3.5 z-40">
      <div class="text-meta text-[var(--text-faint)]">
        当前模型：<span style="color: var(--accent)">{{ providerName }} · {{ modelName }}</span>
      </div>
      <div>
        <div class="text-meta text-[var(--text-dim)] mb-1.5">思考程度</div>
        <InkSegmented v-model="thinkingLevel" :options="THINKING_LEVELS" />
      </div>
      <div>
        <div class="text-meta text-[var(--text-dim)] mb-1.5">创意程度</div>
        <InkSegmented v-model="creativeLevel" :options="CREATIVE_LEVELS" />
      </div>
      <div class="flex justify-between items-center pt-1">
        <button class="text-meta underline text-[var(--text-faint)] cursor-pointer hover:text-[var(--accent)]" @click="app.go('settings')">去设置任务模型</button>
        <button class="ink-chip-btn is-on" @click="saveParams(); paramsOpen = false">保存</button>
      </div>
    </div>

    <!-- 输入区 -->
    <div class="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--panel)] focus-within:border-[var(--accent)] transition-colors">
      <textarea
        ref="area"
        v-model="text"
        rows="1"
        class="w-full bg-transparent outline-none resize-none px-3.5 pt-3 text-body leading-[1.8] max-h-[220px]"
        :placeholder="
          teamActive
            ? `圆桌就绪：${teamAgents.length} 位成员将按顺序发言…`
            : `向${conv.agent?.name || '助手'}提问… 输入 / 引用技能，@ 引用素材，Enter 发送`
        "
        @input="onInput"
        @keydown="onKeydown"
      />
      <div class="flex items-center gap-1 px-2.5 pb-2 pt-1.5">
        <button class="ink-icon-btn" title="附加文本文件或图片（多模态模型可识图）" @click="fileInput?.click()">
          <Paperclip :size="15" />
        </button>
        <button class="ink-icon-btn" title="引用技能" @click="pickMode = pickMode === 'skill' ? '' : 'skill'; pickQuery = ''">
          <Sparkles :size="15" />
        </button>
        <button class="ink-icon-btn" title="引用素材" @click="pickMode = pickMode === 'material' ? '' : 'material'; pickQuery = ''">
          <BookOpen :size="15" />
        </button>
        <button class="ink-icon-btn" title="引用灵感便签" @click="pickMode = pickMode === 'note' ? '' : 'note'; pickQuery = ''">
          <Lightbulb :size="15" />
        </button>
        <button class="ink-icon-btn" title="模型参数" @click="paramsOpen = !paramsOpen">
          <Settings2 :size="15" />
        </button>

        <button
          class="ink-chip-btn ml-1"
          :class="{ 'is-on': conv.approvalMode === 'auto-approve' }"
          :title="conv.approvalMode === 'auto-approve' ? '智能体的改动静默写入文稿' : '智能体只给差异，你点接受才写入'"
          @click="toggleApproval"
        >
          {{ conv.approvalMode === 'auto-approve' ? '替我审批' : '我来审阅' }}
        </button>

        <div class="flex-1" />

        <button
          class="ink-chip-btn mr-2 tnum"
          :class="{ 'is-on': usagePercent !== null && usagePercent < 80 }"
          :style="
            usagePercent >= 80
              ? {
                  color: 'var(--danger)',
                  borderColor: 'color-mix(in srgb, var(--danger) 55%, transparent)',
                  background: 'color-mix(in srgb, var(--danger) 9%, transparent)'
                }
              : {}
          "
          :title="
            usagePercent !== null
              ? `本会话估算占用模型上下文窗口 ${usagePercent}%；达到 80% 时，下一轮发送会自动压缩早期对话`
              : '本会话的上下文估算。还没设置模型上下文窗口：到 设置 → AI 服务 的任务模型分配里填写（或点「获取模型」自动识别），之后这里会显示占用百分比'
          "
          @click="ctxOpen = !ctxOpen"
        >
          上下文 ≈{{ contextTokens }} tok
          <span v-if="usagePercent !== null" class="inline-block w-12 h-1 rounded-full overflow-hidden bg-[var(--border)] align-middle">
            <span
              class="block h-full w-full rounded-full origin-left"
              :style="{
                transform: `scaleX(${Math.min(usagePercent, 100) / 100})`,
                background: usagePercent >= 80 ? 'var(--danger)' : 'var(--accent)',
                transition: 'transform var(--dur-3) var(--ease-out)'
              }"
            />
          </span>
          <span v-if="usagePercent !== null">{{ usagePercent }}%</span>
        </button>

        <button v-if="conv.running" class="ink-icon-btn is-danger ml-1" title="停止生成" @click="conv.stop()">
          <Square :size="13" />
        </button>
        <button v-else class="ink-icon-btn-solid ml-1" :disabled="!canSend" title="发送（Enter）" @click="send">
          <ArrowUp :size="15" />
        </button>
      </div>
    </div>

    <div v-if="ctxOpen" class="mt-1.5 text-meta text-[var(--text-faint)] leading-5">
      当前会话累计约 {{ contextChars }} 字（≈ {{ contextTokens }} tokens）。引用技能与素材会在每次发送时注入系统提示词。
      <template v-if="usagePercent === null">
        尚未设置模型上下文窗口，<button class="underline cursor-pointer hover:text-[var(--accent)]" @click="app.go('settings')">去设置 → AI 服务填写</button>（或重新点「获取模型」自动识别），到 80% 时下一轮发送会自动压缩早期对话。
      </template>
      <template v-else>已占用模型窗口的 {{ usagePercent }}%，到 80% 时下一轮发送会自动压缩早期对话。</template>
    </div>

    <input ref="fileInput" type="file" accept=".md,.txt,.markdown,image/*" multiple class="hidden" @change="onFiles" />
  </div>
</template>

<style scoped>
/* 浮层（章节引用 / 圆桌 / 素材选择 / 模型参数）：统一纸感面板 + 二级阴影 */
.pop {
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--panel);
  box-shadow: var(--sh-2);
}
</style>
