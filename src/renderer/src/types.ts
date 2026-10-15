export interface AppConfig {
  libraryRoot: string
  providers: { id: string; name: string; baseUrl: string; apiKey: string; /** 支持图片理解（多模态） */ vision?: boolean; /** 上下文窗口自动识别失败时手填 */ contextSize?: number }[]
  tasks: Record<string, { providerId: string; model: string; temperature: number }>
  agentParams: {
    thinkingLevel: 'off' | 'low' | 'medium' | 'high'
    temperature: number
  }
  /** 向量化嵌入服务（独立于对话模型的服务商列表） */
  embeddingService?: {
    baseUrl: string
    apiKey: string
    model: string
  }
  /** 向量化检索（语义搜索）行为配置；通道本身存在 tasks.embedding */
  embeddingOpts?: {
    /** 索引是否纳入资源库（技能/素材/便签） */
    includeLib: boolean
    /** 正文不超过该字数整章一块 */
    chunkFull: number
    /** 超出整章上限后的滑窗大小（字） */
    winSize: number
    /** 相似度阈值（0-1） */
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
  bindings: Record<string, { materials: string[]; skills: string[]; notes?: string[] }>
  /** 模型上下文窗口（key = `${providerId}/${model}`，token 数） */
  modelContexts: Record<string, number>
  /** 模型单价（key = 模型名，元 / 百万 token，混合口径），用于 AI 成本统计 */
  modelPrices?: Record<string, number>
  /** 联网搜索配置 */
  search: { provider: 'auto' | 'bocha' | 'tavily'; apiKey: string }
  /** 内置智能体联网搜索开关 */
  agentWebSearch: Record<string, boolean>
  /** 内置智能体分配模式开关（可指挥子智能体） */
  agentOrchestrator: Record<string, boolean>
  /** 服务商自带联网搜索开关 */
  providerSearch: Record<string, boolean>
  appearance: {
    theme: 'dark' | 'ink-blue' | 'ink-green' | 'ink-purple' | 'light' | 'sepia' | 'moon' | 'celadon'
    accent: string
    backgroundImage: string
    bgOpacity: number
    radius: 'sm' | 'md' | 'lg'
    fontScale: number
    glow: boolean
    orbs: boolean
    particles: boolean
    /** 按钮按压反馈（下沉弹回） */
    press: boolean
    /** 页面切换过渡（淡入上移） */
    pageFade: boolean
    /** 卡片入场动画（上浮错落） */
    cardRise: boolean
  }
  activeBook: string | null
}

export interface BookMeta {
  title: string
  genre: string
  createdAt: string
  updatedAt: string
  idea: string
  /** 投稿平台/读者定位 */
  platform: string
  /** 风格标签 */
  styleTags: string[]
  /** 叙事视角 */
  viewpoint: string
  /** 目标读者 */
  audience: string
  /** 书架分组；空串表示未分组 */
  group: string
  workflow: { step: number; chapterCursor: number; chapterTotal: number; completed: boolean[] }
}

// ============ 智能体会话 ============

export type ApprovalMode = 'manual' | 'auto-approve'

export interface AgentDef {
  id: string
  name: string
  desc: string
  promptId: string
  stage: string
  welcome: string[]
  readScope: string[]
}

export type DiffLineType = 'context' | 'addition' | 'deletion'

export interface DiffLine {
  type: DiffLineType
  text: string
  oldLineNumber: number | null
  newLineNumber: number | null
}

export interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

export type ProposalStatus = 'pending' | 'accepting' | 'accepted' | 'rejected' | 'conflict' | 'error'

export interface EditProposal {
  id: string
  runId: string
  book: string
  target: string
  summary: string
  baseContent: string
  newContent: string
  hunks: DiffHunk[]
  additions: number
  deletions: number
  truncated: boolean
  status: ProposalStatus
  message: string
  approvalMode: ApprovalMode
  createdAt: string
}

export interface ToolTrace {
  id: string
  name: string
  args: string
  ok: boolean
  result: string
  durationMs: number
  requestedAt: string
}

export interface SubagentRun {
  parentToolCallId: string
  name: string
  status: 'running' | 'done' | 'error'
  startedAt: string
}

export type ProcessingStep =
  | { id: string; type: 'thinking'; content: string; createdAt: string }
  | { id: string; type: 'tool'; toolCallId: string; createdAt: string }
  | { id: string; type: 'response'; content: string; createdAt: string }

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking: string
  status: 'streaming' | 'done' | 'error' | 'aborted'
  error?: string
  createdAt: string
  /** 团队（圆桌）模式下，这条消息出自哪个智能体 */
  agentId?: string
  /** 上下文压缩时被并入摘要的早期消息（界面保留，发送时排除） */
  compacted?: boolean
  processingSteps: ProcessingStep[]
  toolCalls: ToolTrace[]
  proposals: EditProposal[]
  /** 资源库入库提案（智能体写库前交作者确认） */
  libProposals?: LibProposal[]
  /** 分配模式：主智能体请求调用子智能体（需作者确认） */
  subagentRequests?: SubagentRequest[]
  attachments?: { name: string; size: number; image?: boolean }[]
  skillRefs?: { group: string; name: string }[]
  materialRefs?: { group: string; name: string }[]
  noteRefs?: { group: string; name: string }[]
}

export interface SubagentRequest {
  id: string
  agentId: string
  agentName: string
  task: string
  status: 'pending' | 'running' | 'done' | 'rejected' | 'error'
  /** 子智能体的实时输出 / 最终汇报 */
  output: string
}

export interface ConversationSummary {
  id: string
  title: string
  agentId: string
  updatedAt: string
  messageCount: number
}

export interface StoredConversation {
  id: string
  title: string
  agentId: string
  approvalMode: ApprovalMode
  createdAt: string
  updatedAt: string
  messages: ChatMessage[]
  /** 已压缩的早期对话摘要（继续对话时随系统提示词注入） */
  contextSummary?: string
}

// ============ 素材库 / 技能库 / 灵感便签 ============

export type LibKind = 'materials' | 'skills' | 'notes'

// ============ 专名词典（书内圣经） ============

export interface DictEntry {
  id: string
  term: string
  category: string
  aliases: string[]
  desc: string
  firstChapter: string
}

// ============ 伏笔登记板 / 境界体系板 / 角色出场追踪板 ============

export type ForeshadowStatus = '悬置' | '已收' | '作废'

export interface ForeshadowEntry {
  id: string
  /** 伏笔内容 */
  content: string
  /** 埋设章节 */
  plantChapter: string
  /** 计划回收点 */
  planRecycle: string
  status: ForeshadowStatus
  note: string
}

export interface PowerRealm {
  id: string
  name: string
  /** 排序序号，越小越低阶 */
  sortKey: number
}

export interface PowerChar {
  id: string
  name: string
  /** 当前境界 */
  realm: string
  note: string
}

export interface PowerData {
  realms: PowerRealm[]
  /** 越级 / 战力规则说明 */
  rules: string
  chars: PowerChar[]
}

export type TrackingStatus = '健康' | '受伤' | '闭关' | '离场' | '死亡'

export interface TrackingEntry {
  id: string
  name: string
  status: TrackingStatus
  /** 最近出场章节 */
  lastChapter: string
  /** 当前所在地 */
  location: string
  note: string
}

// ============ 地图路线图 / 卷章细纲板 ============

export type MapNodeStatus = '已写过' | '待写'

export interface MapNode {
  id: string
  label: string
  status: MapNodeStatus
  x: number
  y: number
}

export interface MapEdge {
  id: string
  source: string
  target: string
  label: string
}

export interface MapBase {
  /** draw=手绘 / image=上传图片 / none=无底图 */
  kind: 'draw' | 'image' | 'none'
  /** 底图文件的书内相对路径 */
  path: string
  /** 底图不透明度 0~1 */
  opacity: number
}

export interface BookMap {
  id: string
  name: string
  nodes: MapNode[]
  edges: MapEdge[]
  base: MapBase
}

export interface OutlineEntry {
  id: string
  /** 卷名（可空 = 未分卷） */
  vol: string
  /** 章节序号 */
  no: number
  title: string
  /** 一句话细纲 */
  beat: string
  /** 全文细纲存档（逐章生文检测到就直接采用，不再重新构思） */
  beatFull?: string
  status: '待写' | '已写'
}

// ============ 自定义智能体（智能体库） ============

export interface CustomAgent {
  id: string
  name: string
  desc: string
  stage: string
  /** 内联系统提示词 */
  prompt: string
  welcome: string[]
  /** 可读写目录（正文/大纲/设定/角色） */
  readScope: string[]
  /** 可读资源库；空数组 = 无库工具 */
  libsRead: LibKind[]
  libsWrite: boolean
  /** 允许调用的结构化板块 key（STRUCT_BOARDS）；省略 = 全部允许 */
  structBoards?: string[]
  webSearch: boolean
  enabled: boolean
  createdAt: string
}

/** /models 返回的模型信息（可能带上下文窗口大小） */
export interface ModelInfo {
  id: string
  contextLength?: number
}

// ============ 资源库入库提案 ============

export interface LibProposalItem {
  library: LibKind
  group: string
  name: string
  summary: string
  tags: string[]
  content: string
  /** 库中已存在同名条目（入库即覆盖） */
  exists: boolean
}

export interface LibProposal {
  id: string
  runId: string
  book: string
  items: LibProposalItem[]
  summary: string
  status: 'pending' | 'applied' | 'rejected' | 'error'
  /** 已入库条目的 key（`library/group/name`），支持逐条勾选分批入库 */
  appliedKeys: string[]
  message: string
  createdAt: string
}

export interface LibEntry {
  kind: LibKind
  group: string
  name: string
  path: string
  summary: string
  tags: string[]
  updatedAt: string
  size: number
}

export interface LibGroup {
  name: string
  entries: LibEntry[]
}