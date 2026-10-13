<script setup lang="ts">
// 写作台「检索」面板：向量语义索引状态一览 + 增量更新 / 重建 / 成本提示。
// 未配置「向量化」任务通道时给出设置引导；检索使用本身会自动增量同步，这里是手动兜底入口。
import { onMounted, ref, watch } from 'vue'
import { useLibraryStore } from '../../store/library'
import { useAppStore } from '../../store/app'
import { Database, RefreshCw, LoaderCircle, TriangleAlert, Settings2, CircleCheck } from 'lucide-vue-next'
import { inkConfirm } from '../../ui/inkPrompt'

const lib = useLibraryStore()
const app = useAppStore()

interface Status {
  configured: boolean
  model: string
  hasIndex: boolean
  count: number
  bookChunks: number
  libChunks: number
  sources: number
  chars: number
  estTokens: number
  builtAt: string
  updatedAt: string
  stale: boolean
}

const st = ref<Status | null>(null)
const busy = ref<'update' | 'rebuild' | ''>('')
const msg = ref('')
const msgOk = ref(false)

async function load() {
  if (!lib.current) {
    st.value = null
    return
  }
  try {
    st.value = (await window.api.vectorStatus(lib.current.title)) as Status
  } catch {
    st.value = null
  }
}

onMounted(() => void load())
watch(
  () => lib.current?.title,
  () => void load()
)

function fmtTime(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtTokens(n: number): string {
  return n >= 10000 ? `${(n / 10000).toFixed(1)} 万` : n >= 1000 ? `${(n / 1000).toFixed(1)} 千` : String(n)
}

async function doUpdate() {
  if (!lib.current || busy.value) return
  busy.value = 'update'
  msg.value = ''
  try {
    const r = (await window.api.vectorUpdate(lib.current.title)) as { ok: boolean; count: number; error: string }
    msgOk.value = r.ok
    msg.value = r.ok ? `增量更新完成，索引共 ${r.count} 块` : `更新失败：${r.error}`
    await load()
  } catch (e) {
    msgOk.value = false
    msg.value = `更新失败：${(e as Error).message}`
  } finally {
    busy.value = ''
  }
}

async function doRebuild() {
  if (!lib.current || busy.value) return
  const est = st.value?.estTokens || 0
  const ok = await inkConfirm(
    `重建会删除现有索引，把全书文稿与资源库全部重新嵌入，约消耗 ${fmtTokens(est)} token（按向量化模型计价）。确定重建？`,
    { confirmText: '重建索引' }
  )
  if (!ok) return
  busy.value = 'rebuild'
  msg.value = ''
  try {
    const r = (await window.api.vectorRebuild(lib.current.title)) as { ok: boolean; count: number; tokens: number; error: string }
    msgOk.value = r.ok
    msg.value = r.ok ? `重建完成：${r.count} 块，约 ${fmtTokens(r.tokens)} token` : `重建失败：${r.error}`
    await load()
  } catch (e) {
    msgOk.value = false
    msg.value = `重建失败：${(e as Error).message}`
  } finally {
    busy.value = ''
  }
}

function goSettings() {
  app.settingsTab = 'ai'
  app.go('settings')
}
</script>

<template>
  <div class="p-4 space-y-4 text-[12.5px]">
    <!-- 未配置向量化 -->
    <template v-if="!st?.configured">
      <div class="flex items-center gap-1.5 text-xs text-[var(--text-faint)] tracking-wider">
        <Database :size="13" /> 语义检索
      </div>
      <p class="text-[var(--text-dim)] leading-6">
        还没有配置「向量化」任务通道。配置后，逐章生文构思细纲前会自动检索全书相关前文、
        妙笔对话自动注入相关片段、Ctrl+K 支持语义混合检索。
      </p>
      <p class="text-[11px] text-[var(--text-faint)] leading-5">
        到「设置 → AI 服务 → 向量化检索」填入支持 /embeddings 接口的服务商与嵌入模型
        （如硅基流动 BAAI/bge-m3、Ollama 本地），并可调整索引范围、切块与注入开关。未配置不影响其他功能。
      </p>
      <button
        class="w-full flex items-center justify-center gap-1.5 text-[11.5px] py-1.5 rounded-lg cursor-pointer text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--hover)] transition-colors"
        @click="goSettings"
      >
        去设置向量化<Settings2 :size="13" />
      </button>
    </template>

    <!-- 已配置 -->
    <template v-else>
      <div class="flex items-center gap-1.5 text-xs text-[var(--text-faint)] tracking-wider">
        <Database :size="13" /> 语义检索索引
      </div>

      <!-- 换模型标脏 -->
      <div
        v-if="st.stale"
        class="rounded-lg border px-3 py-2 text-[11.5px] leading-5"
        :style="{ borderColor: 'color-mix(in srgb, #d9a441 55%, transparent)', background: 'color-mix(in srgb, #d9a441 10%, transparent)', color: '#d9a441' }"
      >
        <div class="flex items-center gap-1.5 mb-0.5"><TriangleAlert :size="13" /> 向量化模型已更换</div>
        旧索引用的是别的模型，向量空间不兼容，检索已暂停——重建后恢复。
      </div>

      <!-- 状态一览 -->
      <div class="rounded-lg border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
        <div class="flex items-center justify-between px-3 py-2">
          <span class="text-[var(--text-faint)]">状态</span>
          <span class="flex items-center gap-1">
            <CircleCheck v-if="st.hasIndex && !st.stale" :size="13" class="text-[var(--accent)]" />
            {{ st.hasIndex ? (st.stale ? '待重建' : '可用') : '未建索引' }}
          </span>
        </div>
        <div class="flex items-center justify-between px-3 py-2">
          <span class="text-[var(--text-faint)]">嵌入模型</span>
          <span class="truncate max-w-[55%]" :title="st.model">{{ st.model || '—' }}</span>
        </div>
        <div class="flex items-center justify-between px-3 py-2">
          <span class="text-[var(--text-faint)]">已嵌入</span>
          <span>{{ st.count }} 块<span class="text-[var(--text-faint)]">（文稿 {{ st.bookChunks }} · 资源库 {{ st.libChunks }}）</span></span>
        </div>
        <div class="flex items-center justify-between px-3 py-2">
          <span class="text-[var(--text-faint)]">来源</span>
          <span>{{ st.sources }} 个文件 / 条目</span>
        </div>
        <div class="flex items-center justify-between px-3 py-2">
          <span class="text-[var(--text-faint)]">索引体积</span>
          <span title="全部块正文字数与 token 估算">{{ (st.chars / 10000).toFixed(1) }} 万字 ≈ {{ fmtTokens(st.estTokens) }} token</span>
        </div>
        <div class="flex items-center justify-between px-3 py-2">
          <span class="text-[var(--text-faint)]">更新于</span>
          <span>{{ fmtTime(st.updatedAt) }}</span>
        </div>
      </div>

      <p class="text-[11px] text-[var(--text-faint)] leading-5">
        每次语义检索（生文细纲 / 妙笔对话 / Ctrl+K）都会自动增量同步新增与改动的章节，平时无需手动维护。
      </p>

      <div class="flex gap-2">
        <button
          class="flex-1 flex items-center justify-center gap-1.5 text-[11.5px] py-1.5 rounded-lg cursor-pointer border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--hover)] transition-colors disabled:opacity-50"
          :disabled="!!busy"
          @click="doUpdate"
        >
          <LoaderCircle v-if="busy === 'update'" :size="13" class="animate-spin" />
          <RefreshCw v-else :size="13" /> 增量更新
        </button>
        <button
          class="flex-1 flex items-center justify-center gap-1.5 text-[11.5px] py-1.5 rounded-lg cursor-pointer border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--hover)] transition-colors disabled:opacity-50"
          :disabled="!!busy"
          @click="doRebuild"
        >
          <LoaderCircle v-if="busy === 'rebuild'" :size="13" class="animate-spin" />
          <Database v-else :size="13" /> 重建索引
        </button>
      </div>

      <p v-if="msg" class="text-[11.5px]" :style="{ color: msgOk ? 'var(--accent)' : '#e08a7a' }">{{ msg }}</p>
    </template>
  </div>
</template>
