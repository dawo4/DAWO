import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

export interface Provider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  /** 多模态：支持图片理解（vision），开启后聊天可附图 */
  vision?: boolean
}

export interface TaskCfg {
  providerId: string
  model: string
  temperature: number
}

export interface AppConfig {
  libraryRoot: string
  providers: Provider[]
  tasks: Record<'workflow' | 'draft' | 'structure' | 'chapter' | 'continue' | 'polish' | 'deai' | 'selection' | 'agent' | 'embedding', TaskCfg>
  agentParams: {
    thinkingLevel: 'off' | 'low' | 'medium' | 'high'
    temperature: number
  }
  /** 向量化嵌入服务（独立于对话模型的服务商列表）：接口地址 / Key / 嵌入模型 */
  embeddingService: {
    baseUrl: string
    apiKey: string
    model: string
  }
  /** 向量化检索（语义搜索）行为配置；通道本身存在 tasks.embedding */
  embeddingOpts: {
    /** 索引是否纳入资源库（技能/素材/便签）；关闭后增量同步会自动清掉已嵌的库块 */
    includeLib: boolean
    /** 正文不超过该字数整章一块 */
    chunkFull: number
    /** 超出整章上限后的滑窗大小（字） */
    winSize: number
    /** 相似度阈值：低于它的检索结果直接丢弃（0-1） */
    minScore: number
    /** 逐章生文构思细纲前注入相关前文 */
    injectBeat: boolean
    /** 细纲注入条数 */
    topKBeat: number
    /** 妙笔对话自动检索注入 */
    injectAgent: boolean
    /** 妙笔注入条数 */
    topKAgent: number
    /** Ctrl+K 混合检索 */
    injectSearch: boolean
    /** 全局搜索语义补充条数 */
    topKSearch: number
  }
  approvalMode: 'manual' | 'auto-approve'
  bindings: Record<string, { materials: string[]; skills: string[] }>
  /** 敏感词库：产出正文时规避这些词 */
  sensitiveWords: string[]
  /** 模型上下文窗口大小（key = `${providerId}/${model}`，单位 token） */
  modelContexts: Record<string, number>
  /** 联网搜索配置；provider=auto 用内置免费源，bocha/tavily 需填 Key */
  search: { provider: 'auto' | 'bocha' | 'tavily'; apiKey: string }
  /** 内置智能体的联网搜索开关（自定义智能体的开关存在其自身定义里） */
  agentWebSearch: Record<string, boolean>
  /** 内置智能体的分配模式开关（可指挥子智能体；自定义的存在其自身定义里） */
  agentOrchestrator: Record<string, boolean>
  /** 内置智能体的语义检索开关（对话前自动检索全书注入相关片段；默认关闭，自定义的存在其自身定义里） */
  agentVectorSearch: Record<string, boolean>
  /** 智能体级模型分配（key = agentId，内置与自定义统一）；未指定的智能体跟随「智能体对话」任务配置 */
  agentModels: Record<string, { providerId?: string; model?: string }>
  /** 服务商自带联网搜索开关（Kimi $web_search / 智谱 web_search / MiMo web_search / 通义 enable_search） */
  providerSearch: Record<string, boolean>
  /** 软件更新检查 */
  update: {
    /** 自动检查更新（关掉后只能手动点「检查更新」） */
    autoCheck: boolean
    /** 自动检查频率：每次启动 / 每天最多一次 / 仅手动 */
    frequency: 'startup' | 'daily' | 'manual'
  }
  /** 保存与备份 */
  backup: {
    /** 备份目录；留空用默认（书架旁「DAWO 备份」） */
    dir: string
    /** 退出应用时自动备份当前作品 */
    autoOnExit: boolean
    /** 安装更新前自动备份当前作品 */
    backupOnUpdate: boolean
  }
  appearance: {
    theme: 'dark' | 'ink-blue' | 'ink-green' | 'ink-purple' | 'light' | 'sepia' | 'moon' | 'celadon'
    accent: string
    backgroundImage: string
    bgOpacity: number
    /** 圆角档位：sm 紧凑 / md 标准 / lg 圆润 */
    radius: 'sm' | 'md' | 'lg'
    /** 界面字号缩放：0.9 / 1 / 1.1 / 1.2 */
    fontScale: number
    glow: boolean
    orbs: boolean
    particles: boolean
    /** 按压波纹动效 */
    press: boolean
    /** 页面切换淡入 */
    pageFade: boolean
    /** 卡片浮升入场 */
    cardRise: boolean
  }
  activeBook: string | null
}

let cfg: AppConfig
let cfgPath: string

export function defaultConfig(): AppConfig {
  return {
    libraryRoot: join(app.getPath('documents'), 'DAWO 书架'),
    providers: [],
    tasks: {
      workflow: { providerId: '', model: '', temperature: 0.8 },
      draft: { providerId: '', model: '', temperature: 0.8 },
      structure: { providerId: '', model: '', temperature: 0.7 },
      chapter: { providerId: '', model: '', temperature: 0.8 },
      continue: { providerId: '', model: '', temperature: 0.8 },
      polish: { providerId: '', model: '', temperature: 0.6 },
      deai: { providerId: '', model: '', temperature: 0.7 },
      selection: { providerId: '', model: '', temperature: 0.6 },
      agent: { providerId: '', model: '', temperature: 0.7 },
      embedding: { providerId: '', model: '', temperature: 0 }
    },
    agentParams: { thinkingLevel: 'medium', temperature: 0.7 },
    embeddingService: { baseUrl: '', apiKey: '', model: '' },
    embeddingOpts: {
      includeLib: true,
      chunkFull: 3000,
      winSize: 1500,
      minScore: 0.3,
      injectBeat: true,
      topKBeat: 5,
      injectAgent: true,
      topKAgent: 4,
      injectSearch: true,
      topKSearch: 6
    },
    approvalMode: 'manual',
    bindings: {},
    sensitiveWords: [],
    modelContexts: {},
    search: { provider: 'auto', apiKey: '' },
    agentWebSearch: {},
    agentOrchestrator: {},
    agentVectorSearch: {},
    agentModels: {},
    providerSearch: {},
    update: { autoCheck: true, frequency: 'startup' },
    backup: { dir: '', autoOnExit: false, backupOnUpdate: true },
    appearance: {
      theme: 'dark',
      accent: '#c9a15f',
      backgroundImage: '',
      bgOpacity: 0.08,
      radius: 'md',
      fontScale: 1,
      glow: true,
      orbs: true,
      particles: false,
      press: true,
      pageFade: true,
      cardRise: true
    },
    activeBook: null
  }
}

export function initConfig(): void {
  cfgPath = join(app.getPath('userData'), 'inkdesk-config.json')
  try {
    if (existsSync(cfgPath)) {
      cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'))
      const d = defaultConfig()
      // 补齐缺失字段
      cfg = {
        ...d,
        ...cfg,
        tasks: { ...d.tasks, ...(cfg.tasks || {}) },
        agentParams: { ...d.agentParams, ...(cfg.agentParams || {}) },
        embeddingService: { ...d.embeddingService, ...(cfg.embeddingService || {}) },
        embeddingOpts: { ...d.embeddingOpts, ...(cfg.embeddingOpts || {}) },
        update: { ...d.update, ...(cfg.update || {}) },
        agentVectorSearch: { ...(d.agentVectorSearch || {}), ...(cfg.agentVectorSearch || {}) },
        agentModels: { ...(d.agentModels || {}), ...(cfg.agentModels || {}) },
        bindings: { ...(d.bindings || {}), ...(cfg.bindings || {}) },
        backup: { ...d.backup, ...(cfg.backup || {}) },
        appearance: { ...d.appearance, ...(cfg.appearance || {}) }
      }
      // 新版拆出的任务通道（draft/structure/chapter）：老配置缺失时继承原 workflow 配置，升级零设置
      for (const k of ['draft', 'structure', 'chapter'] as const) {
        const w = cfg.tasks.workflow
        if (w && cfg.tasks[k] && !cfg.tasks[k].providerId && !cfg.tasks[k].model) cfg.tasks[k] = { ...w }
      }
      // 向量化独立服务：老版本绑定在服务商列表上的通道自动迁移一次（服务商卡片删除/改名不再影响向量化）
      const es = cfg.embeddingService
      const oldEmb = cfg.tasks?.embedding
      if (es && !es.baseUrl && !es.model && oldEmb?.providerId && oldEmb?.model) {
        const p = (cfg.providers || []).find((x) => x.id === oldEmb.providerId)
        if (p) {
          cfg.embeddingService = { baseUrl: p.baseUrl, apiKey: p.apiKey, model: oldEmb.model }
          // 清空旧通道引用，避免用户清空面板后下次启动又被迁移回来
          cfg.tasks.embedding = { providerId: '', model: '', temperature: 0 }
          saveConfig()
        }
      }
      return
    }
  } catch {
    /* 损坏则重建 */
  }
  cfg = defaultConfig()
  saveConfig()
}

export function getConfig(): AppConfig {
  // 自愈防御：任何路径漏调 initConfig（或模块图异常）时自动初始化，绝不让 cfg 保持 undefined
  if (!cfg) initConfig()
  return cfg
}

export function saveConfig(): void {
  mkdirSync(dirname(cfgPath), { recursive: true })
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8')
}

export function updateConfig(patch: Record<string, unknown>): AppConfig {
  const d = defaultConfig()
  const merge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...a }
    for (const k of Object.keys(b)) {
      const av = a[k]
      const bv = b[k]
      if (av && bv && typeof av === 'object' && typeof bv === 'object' && !Array.isArray(av) && !Array.isArray(bv)) {
        out[k] = merge(av as Record<string, unknown>, bv as Record<string, unknown>)
      } else {
        out[k] = bv
      }
    }
    return out
  }
  cfg = merge(d as unknown as Record<string, unknown>, cfg as unknown as Record<string, unknown>) as unknown as AppConfig
  // patch 用浅合并：渲染层传的 Record 类字段（modelContexts/providerSearch 等映射表）都是完整对象，
  // 深合并会让「删除的键」在主进程配置里静默复活
  cfg = { ...cfg, ...patch } as unknown as AppConfig
  saveConfig()
  return cfg
}
