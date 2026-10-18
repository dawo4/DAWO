<script setup lang="ts">
/**
 * 赞助弹窗：无广告、无付费墙的自愿赞助入口。
 * 两层内容共用一个弹窗（列表 → 二维码）。不做嵌套弹窗：两层各自带遮罩会把上一层压黑，
 * 与参考图「列表可见、二维码浮在上面」的观感相反；这里改用同层切换 + 返回。
 */
import { computed, ref, watch } from 'vue'
import InkModal from './InkModal.vue'
import InkButton from './InkButton.vue'
import { ChevronRight, Coffee, ExternalLink, MessageCircle, ScanLine } from 'lucide-vue-next'
import alipayQr from '../assets/sponsor/alipay.png'
import wechatQr from '../assets/sponsor/wechat.png'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

/** 作者的爱发电主页：点开走系统浏览器（主进程 setWindowOpenHandler 会接管 target=_blank） */
const AFDIAN_URL = 'https://afdian.com/a/dawo4RyOKnmjj?tab=feed'

type ChannelKey = 'wechat' | 'alipay'

/** 渠道列表：qr 走收款码层，url 直接打开外部页面。
 *  微信 / 支付宝用品牌识别色圆底（不用厂商商标图形）；爱发电用应用强调色。 */
const CHANNELS: {
  key: string
  name: string
  desc: string
  icon: unknown
  tint: string
  ink: string
  qr?: string
  url?: string
}[] = [
  {
    key: 'wechat',
    name: '微信',
    desc: '用微信扫一扫',
    icon: MessageCircle,
    tint: 'color-mix(in srgb, #07c160 16%, transparent)',
    ink: '#07c160',
    qr: wechatQr
  },
  {
    key: 'alipay',
    name: '支付宝',
    desc: '用支付宝扫一扫',
    icon: ScanLine,
    tint: 'color-mix(in srgb, #1677ff 16%, transparent)',
    ink: '#1677ff',
    qr: alipayQr
  },
  {
    key: 'afdian',
    name: '爱发电',
    desc: '打开赞助页 · 可长期支持与留言',
    icon: Coffee,
    tint: 'color-mix(in srgb, var(--accent) 18%, transparent)',
    ink: 'var(--accent)',
    url: AFDIAN_URL
  }
]

const picked = ref<ChannelKey | ''>('')
const current = computed(() => CHANNELS.find((c) => c.key === picked.value))

// 关闭后回到列表层，下次打开不会停在二维码页
watch(
  () => props.open,
  (v) => {
    if (!v) picked.value = ''
  }
)
</script>

<template>
  <InkModal :open="open" :title="picked ? current?.name || '赞助支持' : '赞助支持'" @close="emit('close')">
    <!-- 第一层：说明 + 扫码赞助 -->
    <div v-if="!picked" class="space-y-4">
      <p class="text-label text-[var(--text-dim)] leading-6">
        本应用无广告、无付费墙。如果它对你有用，一点赞助就是它继续做下去的动力，谢谢！
      </p>
      <div class="section-title">赞助方式</div>
      <div class="ink-card overflow-hidden">
        <component
          :is="c.url ? 'a' : 'button'"
          v-for="(c, i) in CHANNELS"
          :key="c.key"
          :href="c.url"
          :target="c.url ? '_blank' : undefined"
          :rel="c.url ? 'noopener' : undefined"
          class="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer transition-colors hover:bg-[var(--hover)]"
          :class="i > 0 ? 'border-t border-[var(--border)]' : ''"
          :style="{ color: 'inherit' }"
          @click="c.url ? undefined : (picked = c.key as ChannelKey)"
        >
          <span class="w-8 h-8 rounded-full flex items-center justify-center shrink-0" :style="{ background: c.tint }">
            <component :is="c.icon" :size="16" :style="{ color: c.ink }" />
          </span>
          <span class="flex-1 min-w-0">
            <span class="block text-label">{{ c.name }}</span>
            <span class="block text-meta text-[var(--text-faint)] mt-0.5">{{ c.desc }}</span>
          </span>
          <ExternalLink v-if="c.url" :size="14" class="text-[var(--text-faint)] shrink-0" />
          <ChevronRight v-else :size="14" class="text-[var(--text-faint)] shrink-0" />
        </component>
      </div>
    </div>

    <!-- 第二层：收款码 -->
    <div v-else class="space-y-4">
      <div class="flex items-center justify-center rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-soft)] p-4">
        <img :src="current?.qr" alt="收款码" class="w-full max-w-[300px] h-auto rounded-[var(--r-sm)] bg-white" />
      </div>
      <p class="text-label text-[var(--text-dim)] leading-6">
        截图保存后，用{{ current?.name }}扫码即可。谢谢支持！
      </p>
      <div class="flex items-center justify-between">
        <button class="text-label text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer" @click="picked = ''">
          ← 返回
        </button>
        <InkButton variant="ghost" @click="emit('close')">关闭</InkButton>
      </div>
    </div>
  </InkModal>
</template>
