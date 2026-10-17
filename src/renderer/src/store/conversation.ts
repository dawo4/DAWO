import { defineStore } from 'pinia'
import { useAppStore } from './app'
import { useLibraryStore } from './library'
import type {
  ApprovalMode,
  ChatMessage,
  ConversationSummary,
  CustomAgent,
  EditProposal,
  LibProposal,
  ProcessingStep,
  StoredConversation,
  SubagentRequest,
  ToolTrace
} from '../types'

export const AGENTS: AgentItem[] = [
  { id: 'general', name: '通用写作助手', desc: '人物、剧情、大纲、正文都能处理', stage: '通用', welcome: ['帮我看看这章有什么问题', '这个人物动机站得住吗', '给主线加一个转折'], readScope: [] as string[] },
  { id: 'character', name: '人物智能体', desc: '设计人物、关系、动机与弧光', stage: '人物', welcome: ['设计一个反派，要有说服力', '检查现有角色有没有工具人', '给主角设计一次道德困境'], readScope: ['角色', '大纲', '设定'] },
  { id: 'plot', name: '剧情智能体', desc: '规划主线、冲突、转折与结局', stage: '剧情', welcome: ['帮我捋一下主线冲突是否够紧', '设计第二次转折', '盘点已埋未收的伏笔'], readScope: ['大纲', '设定', '角色', '正文'] },
  { id: 'outline', name: '大纲智能体', desc: '把人物与剧情整理为分卷分节大纲', stage: '大纲', welcome: ['按黄金三章重写前三章大纲', '把现有剧情拆成三卷', '给第五卷设计爽点节奏'], readScope: ['大纲', '角色', '设定'] },
  { id: 'manuscript', name: '正文专家', desc: '审阅成稿、统筹结构、润色修改', stage: '正文', welcome: ['审阅当前章节并给出修改提案', '这章节奏是不是太平了', '把这段描写改得更具体'], readScope: ['正文', '大纲', '设定', '角色'] },
  { id: 'section', name: '分节写手', desc: '围绕当前章节写作，保持连续', stage: '正文', welcome: ['按细纲写这一章', '从上一章结尾接着写', '把这一章的开头重写一遍'], readScope: ['正文', '大纲', '设定', '角色'] },
  { id: 'setting', name: '设定智能体', desc: '构建世界观、力量体系、地图与专有名词', stage: '设定', welcome: ['帮我搭一套力量体系', '检查现有设定有没有自相矛盾', '把主要地图和场景列出来'], readScope: ['设定', '大纲', '角色'] },
  { id: 'timeline', name: '时间线智能体', desc: '从文稿提取时间节点、补全断档、检查一致性', stage: '时间线', welcome: ['从现有章节提取时间线', '检查时间线有没有矛盾', '补全缺失的时间节点'], readScope: ['大纲', '设定', '角色', '正文'], panel: true },
  { id: 'storyline', name: '故事线智能体', desc: '梳理故事节点、因果连接与主线支线', stage: '故事线', welcome: ['根据大纲生成故事线节点', '梳理主角与反派的关系图', '标出哪些是主线，哪些是支线'], readScope: ['大纲', '设定', '角色', '正文'], panel: true },
  { id: 'foreshadow', name: '伏笔管理智能体', desc: '登记伏笔、追踪回收状态、提醒拖收的钩子', stage: '伏笔', welcome: ['从正文排查所有伏笔并登记', '检查悬置伏笔有没有回收', '把拖收的伏笔排进后续回收计划'], readScope: ['大纲', '设定', '正文'], panel: true },
  { id: 'power', name: '境界体系智能体', desc: '维护境界阶梯、越级规则与角色当前境界', stage: '境界', welcome: ['从设定梳理完整境界体系', '主角晋级了，更新角色境界', '检查战力有没有崩坏'], readScope: ['设定', '大纲', '正文'], panel: true },
  { id: 'tracking', name: '出场追踪智能体', desc: '记录角色状态与位置，防神隐防死人复活', stage: '出场', welcome: ['从最近章节梳理角色出场状态', '检查有没有被写丢的角色', '更新角色受伤与换地图后的位置'], readScope: ['正文', '大纲', '角色'], panel: true },
  { id: 'mapper', name: '地图智能体', desc: '梳理地点与路径，标场景覆盖，查地理矛盾', stage: '地图', welcome: ['从设定与正文梳理地理格局', '新地点登场了，更新地图', '检查移动路线合不合理'], readScope: ['设定', '大纲', '正文'], panel: true },
  { id: 'deconstruct', name: '拆书智能体', desc: '拆解范文与竞品：大纲、节奏爽点、人物关系', stage: '拆书', welcome: ['拆解这本书的开篇结构', '分析它的爽点节奏', '总结它的人物关系'], readScope: [] as string[] },
  {
    id: 'librarian',
    name: '资源管家',
    desc: '管理技能库 / 素材库 / 灵感便签：批量产出、改写、整理、体检',
    stage: '资源库',
    welcome: [
      '帮我把素材库整理一遍，找出重复和主题相近的',
      '我想要 5 条阴狠但不脏话的反派台词素材',
      '把「拆书报告」里那篇提炼成写作技巧存进技能库',
      '给灵感便签写几个开篇钩子的点子'
    ],
    readScope: [] as string[]
  }
]

interface Ref {
  group: string
  name: string
}

/** UI 列表用的统一智能体形态（内置 + 已启用的自定义） */
export interface AgentItem {
  id: string
  name: string
  desc: string
  stage: string
  welcome: string[]
  readScope: string[]
  custom?: boolean
  webSearch?: boolean
  /** 资料区工具型智能体：通常由对应面板一键调用，选择列表里默认折叠 */
  panel?: boolean
}

interface State {
  book: string
  agentId: string
  approvalMode: ApprovalMode
  messages: ChatMessage[]
  running: boolean
  runId: string
  conversations: ConversationSummary[]
  currentId: string
  activeFile: string
  skillRefs: Ref[]
  materialRefs: Ref[]
  noteRefs: Ref[]
  /** 圆桌模式成员（按发言顺序）；为空表示单智能体 */
  teamAgents: string[]
  attachments: { name: string; text: string; image?: string }[]
  expandedThinking: Record<string, boolean>
  /** 自定义智能体（智能体库维护；妙笔只显示 enabled 的） */
  customAgents: CustomAgent[]
  /** 早期对话的压缩摘要（上下文达窗口 80% 后自动生成） */
  contextSummary: string
  /** 压缩正在进行中（防并发 + 防跨会话污染） */
  compressing: boolean
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function nowIso(): string {
  return new Date().toISOString()
}

/** 剥离 Vue 响应式代理后再交给 IPC：结构化克隆不支持 Proxy 对象 */
function plain<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/** 智能体事件监听是应用级单例：不随组件卸载断开，防止运行中切页丢事件导致 run 卡死 */
let agentListenerReady = false

export const useConversationStore = defineStore('conversation', {
  state: (): State => ({
    book: '',
    agentId: 'general',
    approvalMode: 'manual',
    messages: [],
    running: false,
    runId: '',
    conversations: [],
    currentId: '',
    activeFile: '',
    skillRefs: [],
    materialRefs: [],
    noteRefs: [],
    teamAgents: [],
    attachments: [],
    expandedThinking: {},
    customAgents: [],
    contextSummary: '',
    compressing: false
  }),

  getters: {
    /** 内置 + 已启用的自定义智能体（妙笔与圆桌的选择列表都用它） */
    allAgents: (s): AgentItem[] => [
      ...AGENTS,
      ...s.customAgents
        .filter((a) => a.enabled)
        .map((a) => ({ id: a.id, name: a.name, desc: a.desc, stage: a.stage, welcome: a.welcome, readScope: a.readScope, custom: true, webSearch: a.webSearch }))
    ],
    agent(s): AgentItem {
      return this.allAgents.find((a) => a.id === s.agentId) || AGENTS[0]
    },
    /** 当前会话上下文估算与窗口占用（窗口未知时 percent 为 null） */
    contextUsage(s): { tokens: number; window: number | null; percent: number | null } {
      let chars = this.contextSummary.length
      for (const m of s.messages) {
        if (m.compacted) continue
        chars += m.content.length + (m.thinking?.length || 0)
      }
      const tokens = Math.round(chars / 1.4)
      const app = useAppStore()
      const cfg = app.config
      const key = `${cfg?.tasks?.agent?.providerId || ''}/${cfg?.tasks?.agent?.model || ''}`
      const win = cfg?.modelContexts?.[key]
      return { tokens, window: win || null, percent: win ? Math.min(Math.round((tokens / win) * 100), 200) : null }
    },
    pendingProposals: (s) => s.messages.flatMap((m) => m.proposals).filter((p) => p.status === 'pending')
  },

  actions: {
    async init(book: string) {
      if (!book) return
      this.book = book
      const app = useAppStore()
      this.approvalMode = app.config?.approvalMode || 'manual'
      // 切书：清掉上一本书残留的上下文
      this.activeFile = ''
      this.teamAgents = []
      void this.refreshCustomAgents()
      this.conversations = (await window.api.convList(book)) as ConversationSummary[]
      if (this.conversations.length) {
        await this.loadConversation(this.conversations[0].id)
      } else {
        this.newConversation()
      }
    },

    /** 拉取自定义智能体列表（智能体库保存后也要调，妙笔列表才会刷新） */
    async refreshCustomAgents() {
      this.customAgents = ((await window.api.customAgentsList()) as CustomAgent[]) || []
    },

    /** 注册智能体事件监听（幂等；组件挂载时调用即可，卸载不断开） */
    ensureAgentListener() {
      if (agentListenerReady) return
      agentListenerReady = true
      window.api.agentOnEvent((evt) => this.handleEvent(evt))
    },

    newConversation() {
      this.currentId = uid('conv')
      this.messages = []
      this.running = false
      this.runId = ''
      this.attachments = []
      this.contextSummary = ''
      this.teamAgents = [] // 新会话不继承圆桌成员
      this.applyBindings()
    },

    /** 按当前智能体的默认引用（设置 → 资源库 → 智能体默认引用）初始化技能与素材 */
    applyBindings() {
      const b = useAppStore().config?.bindings?.[this.agentId]
      const split = (arr: string[] | undefined) =>
        (arr || [])
          .map((k) => {
            const i = k.indexOf('/')
            return i > 0 ? { group: k.slice(0, i), name: k.slice(i + 1) } : null
          })
          .filter((x): x is Ref => !!x)
      this.skillRefs = split(b?.skills)
      this.materialRefs = split(b?.materials)
      this.noteRefs = split(b?.notes)
    },

    async loadConversation(id: string) {
      // 上一轮还在跑：先中止，半截回复标记为已中止再保存，避免被当作完整回复永久落盘
      if (this.running && this.runId) {
        void window.api.agentAbort(this.runId).catch(() => {})
        const cur = this.messages[this.messages.length - 1]
        if (cur && cur.role === 'assistant' && cur.status === 'streaming') {
          cur.status = 'aborted'
          cur.error = cur.error || '（切换会话时已中止）'
        }
        this.running = false
        void this.persist()
      }
      const c = (await window.api.convLoad(this.book, id)) as StoredConversation | null
      if (!c) return
      this.currentId = c.id
      // 已删除的自定义智能体不再指向：回退到通用助手
      const aid = c.agentId || 'general'
      this.agentId = this.allAgents.some((a) => a.id === aid) ? aid : 'general'
      this.approvalMode = c.approvalMode || 'manual'
      this.messages = (c.messages || []).map((m) => ({ ...m, status: m.status === 'streaming' ? 'done' : m.status }))
      this.contextSummary = c.contextSummary || ''
      this.running = false
      this.runId = ''
      this.attachments = []
      this.applyBindings()
    },

    async persist() {
      if (!this.book || !this.currentId) return
      const firstUser = this.messages.find((m) => m.role === 'user')
      const conv: StoredConversation = {
        id: this.currentId,
        title: firstUser ? firstUser.content.slice(0, 24) : '新会话',
        agentId: this.agentId,
        approvalMode: this.approvalMode,
        createdAt: this.messages[0]?.createdAt || nowIso(),
        updatedAt: nowIso(),
        contextSummary: this.contextSummary || undefined,
        messages: plain(this.messages)
      }
      await window.api.convSave(this.book, plain(conv) as unknown as Record<string, unknown>)
      this.conversations = (await window.api.convList(this.book)) as ConversationSummary[]
    },

    async deleteConversation(id: string) {
      await window.api.convDelete(this.book, id)
      this.conversations = (await window.api.convList(this.book)) as ConversationSummary[]
      if (id === this.currentId) {
        if (this.conversations.length) await this.loadConversation(this.conversations[0].id)
        else this.newConversation()
      }
    },

    async exportCurrent() {
      if (this.currentId) await window.api.convExport(this.book, this.currentId)
    },

    async setApprovalMode(mode: ApprovalMode) {
      this.approvalMode = mode
      const app = useAppStore()
      await app.updateConfig({ approvalMode: mode })
      await this.persist()
    },

    async send(text: string) {
      if (this.running) return
      // 有文字或有附图都可以发（纯图片直接问也允许）
      if (!text.trim() && !this.attachments.some((a) => a.image)) return
      // 圆桌模式：成员按顺序依次发言，后者能看到前者的发言
      if (this.teamAgents.length >= 2) {
        const ids = [...this.teamAgents]
        const originalAgentId = this.agentId
        for (let i = 0; i < ids.length; i++) {
          const a = this.allAgents.find((x) => x.id === ids[i])
          if (!a) continue // 成员已被删除：跳过
          // 真正切换到该成员：人格提示词、库权限、语义检索与模型分配逐轮生效（此前所有轮次都在用同一智能体）
          this.agentId = a.id
          const prompt =
            i === 0
              ? text
              : `（圆桌继续，轮到${a?.name || '成员'}）请针对上面的任务与前面成员的发言，从你的职责出发给出补充、修正或不同意见；有分歧直说，前面已说清的就补他们没覆盖的角度。`
          await this.sendSingle(prompt)
          while (this.running) await new Promise((r) => setTimeout(r, 400))
          // 某一轮失败或被中止就停，避免连环报错
          const last = this.messages[this.messages.length - 1]?.status
          if (last === 'error' || last === 'aborted') break
        }
        // 圆桌结束：回到发起会话时的智能体，会话默认对象不变
        this.agentId = originalAgentId
        return
      }
      await this.sendSingle(text)
    },

    /**
     * 上下文压缩：每轮发送前检查。
     * 估算 token（中文 ≈ 1.4 字/token）达到模型窗口 80% 时，把较早的消息压成摘要，
     * 界面保留完整历史（compacted 标记），发送时只带「摘要 + 最近几条」。
     * 窗口未知则不压缩；AI 摘要失败降级为简单截摘。
     */
    async maybeCompress() {
      const usage = this.contextUsage
      if (!usage.window || usage.percent === null || usage.percent < 80) return
      const live = this.messages.filter((m) => !m.compacted && m.content.trim())
      const KEEP = 4 // 最近 4 条保留原文，其余可压缩
      if (live.length <= KEEP + 2) return
      const older = live.slice(0, live.length - KEEP)
      if (older.length < 2) return
      if (this.compressing) return // 防并发压缩
      this.compressing = true
      const bookAtStart = this.book
      const convAtStart = this.currentId
      try {
        let summary = ''
        try {
          summary = await window.api.agentSummarize(
            plain(older.map((m) => ({ role: m.role, content: m.content })))
          )
        } catch {
          // 降级：首条用户消息 + 最近两条的截断拼接，保证对话仍能继续
          const firstUser = older.find((m) => m.role === 'user')?.content || ''
          const tail = older.slice(-2).map((m) => m.content.slice(0, 300)).join(' … ')
          summary = `（自动压缩降级摘要）\n- 最初的请求：${firstUser.slice(0, 300)}\n- 最近的进展：${tail}`
        }
        // 压缩期间用户切了会话/切了书：结果作废，避免污染另一个会话的持久化
        if (this.book !== bookAtStart || this.currentId !== convAtStart) return
        // 旧摘要只保留尾部 2000 字再拼接，保证新摘要有空间（总长仍限 4000，保留最新内容）
        const prev = this.contextSummary ? this.contextSummary.slice(-2000) : ''
        summary = prev ? `${prev}\n\n（续）${summary}` : summary
        this.contextSummary = summary.slice(-4000)
        for (const m of older) m.compacted = true
        await this.persist()
      } finally {
        this.compressing = false
      }
    },

    async sendSingle(text: string) {
      if (this.running) return
      // 附件快照（含图片）：清空后仍用于消息展示与发请求
      const atts = [...this.attachments]
      const images = atts.filter((a) => a.image).map((a) => a.image!) as string[]
      // 空文字且无图片才是无效发送
      if (!text.trim() && !images.length) return
      const agentIdAtSend = this.agentId
      const body = text.trim()
      const imgTag = images.length ? `[附图 ×${images.length}]` : ''
      const userMsg: ChatMessage = {
        id: uid('msg'),
        role: 'user',
        content: body ? (imgTag ? `${body}\n${imgTag}` : body) : imgTag,
        thinking: '',
        status: 'done',
        createdAt: nowIso(),
        processingSteps: [],
        toolCalls: [],
        proposals: [],
        attachments: atts.map((a) => ({ name: a.name, size: a.text.length, image: !!a.image })),
        skillRefs: [...this.skillRefs],
        materialRefs: [...this.materialRefs],
        noteRefs: [...this.noteRefs]
      }
      const assistantMsg: ChatMessage = {
        id: uid('msg'),
        role: 'assistant',
        content: '',
        thinking: '',
        status: 'streaming',
        createdAt: nowIso(),
        agentId: agentIdAtSend,
        processingSteps: [{ id: uid('step'), type: 'thinking', content: '', createdAt: nowIso() }],
        toolCalls: [],
        proposals: []
      }
      this.messages.push(userMsg, assistantMsg)
      this.expandedThinking[assistantMsg.id] = true
      this.attachments = []
      this.runId = uid('run')
      this.running = true // 先置位：接下来可能的压缩窗口内禁止并发发送
      try {
        await this.persist()
      } catch (e) {
        this.failRun(assistantMsg, `会话保存失败：${(e as Error).message}`)
        return
      }

      const history = plain(
        this.messages
          .filter((m) => m.id !== assistantMsg.id && !m.compacted)
          .map((m) => ({ role: m.role, content: m.content }))
          .filter((m) => m.content.trim())
      )

      const app = useAppStore()
      const cfg = app.config
      const task = cfg?.tasks?.agent
      // 带图但服务商未开启多模态：直接提示，不发请求（纯文本模型会报 400）
      if (images.length && !cfg?.providers?.find((p) => p.id === task?.providerId)?.vision) {
        this.failRun(assistantMsg, '当前服务商未开启「支持图片理解」，无法识图。请到 设置 → AI 服务 为智能体使用的服务商开启多模态，或换用支持看图的模型。')
        return
      }
      try {
        // 每轮发送前先做上下文压缩检查（达到窗口 80% 才实际压缩；此时 running 已置位，防并发）
        await this.maybeCompress()
        await window.api.agentRun({
          runId: this.runId,
          book: this.book,
          agentId: this.agentId,
          approvalMode: this.approvalMode,
          activeFile: this.activeFile,
          history,
          skillRefs: plain(this.skillRefs),
          materialRefs: plain(this.materialRefs),
          noteRefs: plain(this.noteRefs),
          attachmentText: plain(atts.filter((a) => !a.image).map(({ name, text }) => ({ name, text }))),
          images: images.length ? images : undefined,
          contextSummary: this.contextSummary || undefined,
          taskOverride: {
            providerId: task?.providerId,
            model: task?.model,
            temperature: cfg?.agentParams?.temperature ?? task?.temperature ?? 0.7,
            thinkingLevel: cfg?.agentParams?.thinkingLevel || 'medium'
          }
        })
      } catch (e) {
        this.failRun(assistantMsg, `无法启动智能体：${(e as Error).message}`)
      }
    },

    /** 兜底：任何异常都让本轮结束，避免气泡一直转圈 */
    failRun(msg: ChatMessage, reason: string) {
      msg.status = 'error'
      msg.error = reason
      this.running = false
      void this.persist()
    },

    async stop() {
      if (this.runId) await window.api.agentAbort(this.runId)
    },

    /**
     * 供资料区等页面调用：指定智能体与文件上下文，把一个任务交给它。
     * 会先确保会话已绑定当前作品，再另起一个干净会话（原会话已持久化，可在历史里找回），
     * 这样智能体与默认引用都是这次任务对应的那一套。
     */
    async askWith(agentId: string, text: string, activeFile?: string) {
      if (this.running) return
      const book = useLibraryStore().current?.title || ''
      if (!book) return
      if (this.book !== book) await this.init(book)
      this.agentId = agentId
      this.teamAgents = [] // 系统任务不走圆桌
      this.newConversation()
      if (activeFile) this.activeFile = activeFile
      await this.send(text)
    },

    currentAssistant(): ChatMessage | undefined {
      for (let i = this.messages.length - 1; i >= 0; i--) {
        const m = this.messages[i]
        if (m.role === 'assistant' && m.status === 'streaming') return m
      }
      return this.messages[this.messages.length - 1]
    },

    handleEvent(evt: { runId: string; type: string; payload?: unknown }) {
      if (!this.running || (this.runId && evt.runId !== this.runId)) return
      const msg = this.currentAssistant()
      if (!msg || msg.role !== 'assistant') return
      switch (evt.type) {
        case 'thinking': {
          msg.thinking += evt.payload as string
          const step = msg.processingSteps.find((s) => s.type === 'thinking')
          if (step && step.type === 'thinking') step.content = msg.thinking
          break
        }
        case 'chunk': {
          msg.content += evt.payload as string
          break
        }
        case 'tool_start': {
          const p = evt.payload as { id: string; name: string; args: string; requestedAt: string }
          const step: ProcessingStep = { id: uid('step'), type: 'tool', toolCallId: p.id, createdAt: p.requestedAt || nowIso() }
          msg.processingSteps.push(step)
          break
        }
        case 'tool_end': {
          const trace = evt.payload as ToolTrace
          msg.toolCalls.push(trace)
          break
        }
        case 'proposal': {
          const prop = evt.payload as EditProposal
          msg.proposals.push(prop)
          if (prop.approvalMode === 'auto-approve' && prop.status === 'pending') {
            void this.autoApply(prop.id)
          }
          break
        }
        case 'lib_proposal': {
          const lp = evt.payload as LibProposal
          if (!msg.libProposals) msg.libProposals = []
          msg.libProposals.push(lp)
          break
        }
        // 分配模式：主智能体请求调用子智能体（需作者确认）
        case 'subagent_request': {
          const p = evt.payload as SubagentRequest
          if (!msg.subagentRequests) msg.subagentRequests = []
          if (!msg.subagentRequests.some((x) => x.id === p.id)) {
            msg.subagentRequests.push({ ...p, status: 'pending', output: '' })
          }
          break
        }
        case 'subagent_delta': {
          const p = evt.payload as { id: string; text: string }
          const r = msg.subagentRequests?.find((x) => x.id === p.id)
          if (r) r.output += (r.output ? '\n\n' : '') + p.text
          break
        }
        case 'subagent_status': {
          const p = evt.payload as { id: string; status: SubagentRequest['status']; output?: string }
          const r = msg.subagentRequests?.find((x) => x.id === p.id)
          if (r) {
            r.status = p.status
            if (p.output !== undefined) r.output = p.output
          }
          break
        }
        case 'done': {
          msg.status = 'done'
          if (!msg.content.trim() && typeof evt.payload === 'string') msg.content = evt.payload
          this.running = false
          void this.persist()
          break
        }
        case 'error': {
          msg.status = 'error'
          msg.error = String(evt.payload || '未知错误')
          this.running = false
          void this.persist()
          break
        }
        case 'aborted': {
          msg.status = 'aborted'
          this.running = false
          void this.persist()
          break
        }
        default:
          break
      }
    },

    async autoApply(proposalId: string) {
      const res = (await window.api.proposalApply(proposalId)) as { ok: boolean; status: string; message: string }
      this.patchProposal(proposalId, res.status as EditProposal['status'], res.message)
      // 与手动接受一致：通知编辑器重新载入，否则旧缓冲会在下次保存时把 AI 改动覆盖回去
      if (res.ok) {
        const target = this.messages.flatMap((m) => m.proposals).find((p) => p.id === proposalId)?.target || ''
        window.dispatchEvent(new CustomEvent('inkdesk:file-changed', { detail: { path: target } }))
      }
    },

    patchProposal(proposalId: string, status: EditProposal['status'], message: string) {
      for (const m of this.messages) {
        const p = m.proposals.find((x) => x.id === proposalId)
        if (p) {
          p.status = status
          p.message = message
          break
        }
      }
    },

    async acceptProposal(proposalId: string) {
      this.patchProposal(proposalId, 'accepting', '正在应用变更并保存……')
      const res = (await window.api.proposalApply(proposalId)) as { ok: boolean; status: string; message: string }
      this.patchProposal(proposalId, res.status as EditProposal['status'], res.message)
      await this.persist()
      if (res.ok) {
        const target = this.messages.flatMap((m) => m.proposals).find((p) => p.id === proposalId)?.target || ''
        window.dispatchEvent(new CustomEvent('inkdesk:file-changed', { detail: { path: target } }))
      }
    },

    async rejectProposal(proposalId: string) {
      const res = (await window.api.proposalReject(proposalId)) as { ok: boolean; message: string }
      this.patchProposal(proposalId, 'rejected', res.message)
      await this.persist()
    },

    /** 资源库入库提案：定位到所在消息并更新状态 */
    patchLibProposal(proposalId: string, status: LibProposal['status'], message: string) {
      for (const m of this.messages) {
        const p = m.libProposals?.find((x) => x.id === proposalId)
        if (p) {
          p.status = status
          p.message = message
          break
        }
      }
    },

    async acceptLibProposal(proposalId: string, onlyKeys?: string[]) {
      const res = (await window.api.libProposalApply(proposalId, onlyKeys)) as {
        ok: boolean
        status: string
        message: string
      }
      this.patchLibProposal(proposalId, res.status as LibProposal['status'], res.message)
      if (res.ok) {
        // 把已入库的 key 回填到本地提案，界面据此标记「已入库」
        for (const m of this.messages) {
          const p = m.libProposals?.find((x) => x.id === proposalId)
          if (!p) continue
          const keys = onlyKeys?.length ? onlyKeys : p.items.map((i) => `${i.library}/${i.group}/${i.name}`)
          for (const k of keys) if (!p.appliedKeys.includes(k)) p.appliedKeys.push(k)
          if (p.appliedKeys.length >= p.items.length) p.status = 'applied'
          break
        }
      }
      await this.persist()
      if (res.ok) window.dispatchEvent(new CustomEvent('inkdesk:lib-changed'))
    },

    async rejectLibProposal(proposalId: string) {
      const res = (await window.api.libProposalReject(proposalId)) as { ok: boolean; message: string }
      this.patchLibProposal(proposalId, 'rejected', res.message)
      await this.persist()
    },

    /** 分配模式：作者批准 / 拒绝主智能体的子智能体调用请求 */
    async decideSubagent(requestId: string, allow: boolean) {
      await window.api.agentSubagentDecide(requestId, allow)
      const msg = this.messages.find((m) => m.subagentRequests?.some((x) => x.id === requestId))
      const r = msg?.subagentRequests?.find((x) => x.id === requestId)
      if (r && !allow) r.status = 'rejected'
      await this.persist()
    },

    toggleThinking(messageId: string) {
      this.expandedThinking[messageId] = !this.expandedThinking[messageId]
    },

    addSkillRef(ref: Ref) {
      if (!this.skillRefs.some((r) => r.group === ref.group && r.name === ref.name)) this.skillRefs.push(ref)
    },
    removeSkillRef(i: number) {
      this.skillRefs.splice(i, 1)
    },
    addMaterialRef(ref: Ref) {
      if (!this.materialRefs.some((r) => r.group === ref.group && r.name === ref.name)) this.materialRefs.push(ref)
    },
    removeMaterialRef(i: number) {
      this.materialRefs.splice(i, 1)
    },
    addNoteRef(ref: Ref) {
      if (!this.noteRefs.some((r) => r.group === ref.group && r.name === ref.name)) this.noteRefs.push(ref)
    },
    removeNoteRef(i: number) {
      this.noteRefs.splice(i, 1)
    },
    /** 圆桌模式：切换某个智能体的出场与否（顺序即点击顺序） */
    toggleTeamAgent(id: string) {
      const i = this.teamAgents.indexOf(id)
      if (i >= 0) this.teamAgents.splice(i, 1)
      else this.teamAgents.push(id)
    },
    clearTeam() {
      this.teamAgents = []
    },
    addAttachment(name: string, text: string) {
      this.attachments.push({ name, text })
    },
    /** 附加图片（data URL，随当轮请求发给多模态模型） */
    addImageAttachment(name: string, dataUrl: string) {
      this.attachments.push({ name, text: '', image: dataUrl })
    },
    removeAttachment(i: number) {
      this.attachments.splice(i, 1)
    }
  }
})