<script setup lang="ts">
import { computed, ref } from 'vue'
import { aiRun } from '../../ai'
import InkButton from '../../ui/InkButton.vue'
import InkSelect from '../../ui/InkSelect.vue'
import { Copy, Check, LoaderCircle, WandSparkles } from 'lucide-vue-next'

const emit = defineEmits<{ (e: 'close'): void }>()

/** 每个类别的细分选项与占位提示 */
const CATEGORIES: { key: string; sub: { label: string; options: string[] }; ph: string }[] = [
  { key: '人物', sub: { label: '身份类型', options: ['主角', '反派', '女性角色', '长辈', '同伴'] }, ph: '如：冷峻寡言，背负血仇…' },
  { key: '地点', sub: { label: '地点类型', options: ['城镇', '自然', '宗门', '秘境'] }, ph: '如：环境恶劣，终年积雪…' },
  { key: '势力', sub: { label: '势力类型', options: ['宗门', '王朝', '世家', '江湖组织'] }, ph: '如：行事隐秘，亦正亦邪…' },
  { key: '招式', sub: { label: '功法类别', options: ['剑法', '刀法', '拳掌', '内功'] }, ph: '如：性格冷酷，五行属火…' },
  { key: '装备', sub: { label: '装备类型', options: ['兵器', '防具', '法宝', '饰品'] }, ph: '如：通体乌黑，饮血生纹…' },
  { key: '怪物', sub: { label: '怪物类型', options: ['妖兽', '凶兽', '灵兽', '异种'] }, ph: '如：盘踞深山，食人精气…' },
  { key: '道具', sub: { label: '道具类型', options: ['丹药', '符箓', '卷轴', '杂物'] }, ph: '如：可解百毒，也可致命…' }
]
const STYLES = ['中国风格', '西方风格', '日式风格', '混合风格']
const ERAS = ['古代/玄幻', '近现代', '未来/科幻']
const LENGTHS = ['不限', '1字', '2字', '3字']

const cat = ref('人物')
const style = ref(STYLES[0])
const era = ref(ERAS[0])
const sub = ref('')
const len = ref('不限')
const suffix = ref('')
const request = ref('')

const result = ref('')
const busy = ref(false)
const error = ref('')
const copiedIdx = ref(-1)
let aborter: { abort: () => void } | null = null

const subOptions = computed(() => CATEGORIES.find((c) => c.key === cat.value)?.sub.options || [])
const subLabel = computed(() => CATEGORIES.find((c) => c.key === cat.value)?.sub.label || '类型')
const placeholder = computed(() => CATEGORIES.find((c) => c.key === cat.value)?.ph || '')

function pickCat(k: string) {
  cat.value = k
  sub.value = ''
}

/** 解析「名字 —— 说明」行 */
const rows = computed(() =>
  result.value
    .split('\n')
    .map((l) => l.replace(/^[-*·\s\d.]+/, '').trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^(.{1,20}?)\s*[—–-]{1,2}\s*(.+)$/)
      return m ? { name: m[1].trim(), note: m[2].trim() } : { name: l, note: '' }
    })
)

async function generate() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  result.value = ''
  const parts = [sub.value, suffix.value ? `名字需包含字/后缀「${suffix.value}」` : '无包含字要求'].filter(Boolean)
  aborter = aiRun(
    'draft',
    'quick-name',
    {
      category: cat.value,
      style: style.value,
      era: era.value,
      length: len.value,
      suffix: parts[1] || '无包含字要求',
      request: `${parts[0] ? subLabel.value + '：' + parts[0] + '。' : ''}${request.value.trim() || '（无具体要求）'}`
    },
    { onChunk: (c) => (result.value += c) }
  )
  try {
    await aborter.promise
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
    aborter = null
  }
}

async function copyName(name: string, i: number) {
  await navigator.clipboard.writeText(name)
  copiedIdx.value = i
  setTimeout(() => (copiedIdx.value = -1), 1500)
}
</script>

<template>
  <div class="flex gap-4 h-[460px]">
    <!-- 左：类别（人物 / 地点 / 势力 / 招式 / 装备 / 怪物 / 道具） -->
    <div class="w-[76px] shrink-0 border-r border-[var(--border)] flex flex-col gap-0.5 overflow-y-auto">
      <button
        v-for="c in CATEGORIES"
        :key="c.key"
        class="text-left text-[13px] px-3 py-2 rounded-lg cursor-pointer transition-colors"
        :class="cat === c.key ? 'bg-[var(--panel-2)] font-medium' : 'text-[var(--text-dim)] hover:bg-[var(--hover)]'"
        :style="cat === c.key ? { color: 'var(--accent)' } : {}"
        @click="pickCat(c.key)"
      >
        {{ c.key }}
      </button>
    </div>

    <!-- 中：条件 -->
    <div class="w-[280px] shrink-0 flex flex-col gap-3 overflow-y-auto pr-1">
      <div class="flex gap-2">
        <InkSelect v-model="style" class="flex-1" :options="STYLES.map((s) => ({ label: s, value: s }))" />
        <InkSelect v-model="era" class="flex-1" :options="ERAS.map((s) => ({ label: s, value: s }))" />
      </div>

      <div>
        <div class="text-[11.5px] text-[var(--text-faint)] mb-1.5">{{ subLabel }}</div>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="o in subOptions"
            :key="o"
            class="text-[12px] px-3 py-1 rounded-full cursor-pointer transition-colors"
            :class="sub === o ? 'font-medium' : 'text-[var(--text-dim)] hover:text-[var(--text)]'"
            :style="sub === o ? { background: 'var(--panel-2)', color: 'var(--accent)' } : { background: 'var(--bg-soft)' }"
            @click="sub = sub === o ? '' : o"
          >
            {{ o }}
          </button>
        </div>
      </div>

      <div>
        <div class="text-[11.5px] text-[var(--text-faint)] mb-1.5">字数限制</div>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="o in LENGTHS"
            :key="o"
            class="text-[12px] px-3 py-1 rounded-full cursor-pointer transition-colors"
            :class="len === o ? 'font-medium' : 'text-[var(--text-dim)] hover:text-[var(--text)]'"
            :style="len === o ? { background: 'var(--panel-2)', color: 'var(--accent)' } : { background: 'var(--bg-soft)' }"
            @click="len = o"
          >
            {{ o }}
          </button>
        </div>
      </div>

      <div>
        <div class="text-[11.5px] text-[var(--text-faint)] mb-1.5">包含字/后缀（选填）</div>
        <input v-model="suffix" class="ink-input" placeholder="如：城、谷、峰、神域" />
      </div>

      <div>
        <div class="text-[11.5px] text-[var(--text-faint)] mb-1.5">具体要求</div>
        <textarea v-model="request" rows="3" class="ink-textarea text-[12.5px] resize-none" :placeholder="placeholder" />
      </div>

      <InkButton :disabled="busy" @click="generate">
        <LoaderCircle v-if="busy" :size="13" class="animate-spin" />
        <WandSparkles v-else :size="13" />
        {{ busy ? '生成中…' : '开始生成' }}
      </InkButton>
      <div v-if="error" class="text-[12px] text-[#e08a7a]">{{ error }}</div>
    </div>

    <!-- 右：结果 -->
    <div class="flex-1 min-w-0 rounded-lg border border-[var(--border)] bg-[var(--bg-soft)]/50 overflow-y-auto p-3">      <template v-if="rows.length">
        <div
          v-for="(r, i) in rows"
          :key="i"
          class="group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer hover:bg-[var(--hover)] transition-colors"
          title="点击复制名字"
          @click="copyName(r.name, i)"
        >
          <span class="text-[14px] font-medium shrink-0" style="color: var(--accent)">{{ r.name }}</span>
          <span v-if="r.note" class="text-[11.5px] text-[var(--text-dim)] truncate flex-1">{{ r.note }}</span>
          <component :is="copiedIdx === i ? Check : Copy" :size="13" class="shrink-0" :class="copiedIdx === i ? '' : 'opacity-0 group-hover:opacity-100 text-[var(--text-faint)]'" />
        </div>
      </template>
      <div v-else-if="busy" class="h-full flex flex-col items-center justify-center gap-2 text-[var(--text-faint)]">
        <LoaderCircle :size="20" class="animate-spin" />
        <span class="text-[12px]">正在构思名字…</span>
      </div>
      <div v-else-if="result" class="p-3 text-[12.5px] leading-7 whitespace-pre-wrap select-text">{{ result }}</div>
      <div v-else class="h-full flex flex-col items-center justify-center gap-2 text-[var(--text-faint)]">
        <WandSparkles :size="22" class="opacity-50" />
        <span class="text-[12px]">选好条件点「开始生成」</span>
      </div>
    </div>
  </div>
</template>