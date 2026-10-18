<script setup lang="ts">
import { computed, onActivated, ref, watch } from 'vue'
import { useAppStore } from '../store/app'
import { useLibraryStore } from '../store/library'
import EmptyHint from '../ui/EmptyHint.vue'
import InkSegmented from '../ui/InkSegmented.vue'
import MdPanel from '../components/materials/MdPanel.vue'
import TimelinePanel from '../components/materials/TimelinePanel.vue'
import StorylinePanel from '../components/materials/StorylinePanel.vue'
import RelationPanel from '../components/materials/RelationPanel.vue'
import DictionaryPanel from '../components/materials/DictionaryPanel.vue'
import ForeshadowPanel from '../components/materials/ForeshadowPanel.vue'
import PowerPanel from '../components/materials/PowerPanel.vue'
import TrackingPanel from '../components/materials/TrackingPanel.vue'
import OutlinePanel from '../components/materials/OutlinePanel.vue'
import MapPanel from '../components/materials/MapPanel.vue'
import CustomListPanel from '../components/materials/CustomListPanel.vue'
import AddPanelModal from '../components/materials/AddPanelModal.vue'
import MaterialRail from '../components/materials/MaterialRail.vue'
import { BookOpen } from 'lucide-vue-next'

const app = useAppStore()
const lib = useLibraryStore()

const SECTIONS = ['大纲', '角色', '设定', '时间线', '故事线', '词典', '伏笔', '境界', '出场', '细纲', '地图'] as const
type Section = (typeof SECTIONS)[number]

/** 本书自定义面板（阶段二）：资料区导航动态追加 */
const customPanels = ref<{ key: string; label: string }[]>([])

async function refreshCustom() {
  if (!lib.current) {
    customPanels.value = []
    return
  }
  try {
    const list = (await window.api.panelsList(lib.current.title)) as { id: string; name: string; board?: string; hidden?: boolean }[]
    customPanels.value = list.filter((p) => !p.board && !p.hidden).map((p) => ({ key: p.name, label: p.name }))
    // 广播面板集合变化：左栏导航 / 写作台右栏等常驻组件同步刷新
    window.dispatchEvent(new CustomEvent('inkdesk:panels-changed'))
  } catch {
    customPanels.value = []
  }
}

watch(() => lib.current?.title, () => void refreshCustom(), { immediate: true })
// KeepAlive 缓存页面：切回资料区时重拉面板列表（别处新建/删除的面板要同步出现）
onActivated(() => void refreshCustom())

const addOpen = ref(false)

// 首页「添加面板」快捷入口：有作品时自动弹新建向导；没作品则等打开后再弹
function consumeAddRequest() {
  if (app.materialsAddOpen && lib.current) {
    app.materialsAddOpen = false
    addOpen.value = true
  }
}
watch(() => app.materialsAddOpen, consumeAddRequest)
onActivated(consumeAddRequest)
watch(() => lib.current?.title, consumeAddRequest)

async function onPanelCreated(name: string) {
  // 先刷新列表再跳转，否则 section 计算找不到新面板名会退回大纲，还可能撞上「面板不存在」
  await refreshCustom()
  app.goMaterials(name)
}

const section = computed<string>(() => {
  const t = app.materialsTab || ''
  if (customPanels.value.some((p) => p.key === t)) return t
  return (SECTIONS as readonly string[]).includes(t) ? (t as Section) : '大纲'
})

const customInst = computed(() => customPanels.value.find((p) => p.key === section.value))

/** 角色板块内的两个子视图：资料 / 关系图（由 goMaterials('关系图') 远程指定） */
const charView = computed<'资料' | '关系图'>({
  get: () => (app.charSubView === '关系图' ? '关系图' : '资料'),
  set: (v) => (app.charSubView = v)
})

const AGENT_OF: Record<string, string> = { 大纲: 'outline', 角色: 'character', 设定: 'setting' }
</script>

<template>
  <EmptyHint
    v-if="!lib.current"
    :icon="BookOpen"
    title="先打开一部作品"
    desc="资料区汇总大纲、角色、设定、时间线等，写书时随手可查"
    action="去书架"
    @action="app.go('bookshelf')"
  />

  <div v-else class="h-full flex">
    <!-- 中：板块内容 -->
    <div class="flex-1 min-w-0">
      <!-- 角色：先选资料 / 关系图 -->
      <div v-if="section === '角色'" class="h-full flex flex-col">
        <div class="panel-head">
          <InkSegmented
            v-model="charView"
            :options="[
              { value: '资料', label: '资料' },
              { value: '关系图', label: '关系图' }
            ]"
          />
          <div class="flex-1" />
          <span class="panel-head-meta">
            {{ charView === '资料' ? '角色卡：欲望 / 需要 / 缺点 / 弧光' : '关系图：亲情 / 爱情 / 友情 / 敌对 / 其他' }}
          </span>
        </div>
        <div class="flex-1 min-h-0">
          <RelationPanel v-if="charView === '关系图'" />
          <MdPanel v-else dir="角色" :agent-id="AGENT_OF['角色']" />
        </div>
      </div>

      <MdPanel v-else-if="section === '大纲'" :key="'大纲'" dir="大纲" :agent-id="AGENT_OF['大纲']" />
      <MdPanel v-else-if="section === '设定'" :key="'设定'" dir="设定" :agent-id="AGENT_OF['设定']" />
      <TimelinePanel v-else-if="section === '时间线'" :key="'时间线'" />
      <StorylinePanel v-else-if="section === '故事线'" :key="'故事线'" />
      <DictionaryPanel v-else-if="section === '词典'" :key="'词典'" />
      <ForeshadowPanel v-else-if="section === '伏笔'" :key="'伏笔'" />
      <PowerPanel v-else-if="section === '境界'" :key="'境界'" />
      <TrackingPanel v-else-if="section === '出场'" :key="'出场'" />
      <OutlinePanel v-else-if="section === '细纲'" :key="'细纲'" />
      <MapPanel v-else-if="section === '地图'" :key="'地图'" />
      <!-- 自定义面板（列表型） -->
      <CustomListPanel v-else-if="customInst" :key="section" :panel-id="section" @removed="refreshCustom" />
    </div>

    <!-- 右：竖排图标栏 -->
    <MaterialRail :extra="customPanels" @switch="(s) => app.goMaterials(s)" @add="addOpen = true" />

    <!-- 新建自定义面板向导 -->
    <AddPanelModal :open="addOpen" @close="addOpen = false" @created="onPanelCreated" />
  </div>
</template>
