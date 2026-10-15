export {}

declare global {
  interface Window {
    api: {
      // 无边框窗口控制
      winMinimize: () => Promise<void>
      winMaximizeToggle: () => Promise<boolean>
      winClose: () => Promise<void>
      winIsMaximized: () => Promise<boolean>
      winOnState: (cb: (s: { maximized: boolean }) => void) => () => void

      configGet: () => Promise<Record<string, unknown>>
      configUpdate: (patch: Record<string, unknown>) => Promise<Record<string, unknown>>
      booksList: () => Promise<unknown[]>
      bookCreate: (meta: Record<string, unknown>) => Promise<unknown>
      bookDelete: (title: string) => Promise<void>
      bookRename: (oldTitle: string, newTitle: string) => Promise<Record<string, unknown>>
      bookMetaRead: (book: string) => Promise<Record<string, unknown>>
      bookMetaWrite: (book: string, patch: Record<string, unknown>) => Promise<Record<string, unknown>>
      fileRead: (book: string, rel: string) => Promise<string>
      fileWrite: (book: string, rel: string, content: string) => Promise<void>
      fileDelete: (book: string, rel: string) => Promise<void>
      historyList: (book: string, rel: string) => Promise<{ file: string; at: string }[]>
      historyRead: (book: string, rel: string, file: string) => Promise<string>
      historyRestore: (book: string, rel: string, file: string) => Promise<void>
      historyDiff: (book: string, rel: string, file: string) => Promise<{ base: string; current: string; hunks: unknown[]; additions: number; deletions: number; truncated: boolean }>
      batchRevise: (params: { runId: string; book: string; chapters: { path: string; title: string }[]; instruction: string }) => Promise<void>
      batchAbort: (runId: string) => Promise<void>
      vectorSearch: (
        book: string,
        query: string,
        topK?: number,
        opts?: { scope?: 'all' | 'book'; minScore?: number }
      ) => Promise<{ hits: { title: string; path: string; offset: number; text: string; score: number; src: 'book' | 'lib' }[]; reason: string }>
      vectorStatus: (book: string) => Promise<{
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
      }>
      vectorUpdate: (book: string) => Promise<{ ok: boolean; count: number; error: string }>
      vectorRebuild: (book: string) => Promise<{ ok: boolean; count: number; tokens: number; error: string }>
      vectorClear: (book: string) => Promise<void>
      vectorTest: (baseUrl: string, apiKey: string, model: string) => Promise<{ ok: boolean; latencyMs: number; model: string; dim: number; error: string }>
      treeList: (book: string) => Promise<unknown[]>
      statsGet: (book: string) => Promise<{ days: Record<string, { handwritten: number; ai: number }>; prevCounts: Record<string, number> }>
      statsAdd: (book: string, hand: number, ai: number) => Promise<unknown>
      statsRecord: (book: string, rel: string, len: number) => Promise<void>
      importPick: () => Promise<string | null>
      importPickText: () => Promise<{ name: string; text: string } | null>
      importMigrate: (mode: 'each' | 'merge', mergeTitle: string) => Promise<{ books: string[]; chapters: number; errors: string[] }>
      importFile: (book: string, filePath: string) => Promise<void>
      openLibrary: () => Promise<void>
      presetLastUpdate: () => Promise<{ at: string; added: string[] } | null>
      promptsList: () => Promise<string[]>
      promptsGet: (id: string) => Promise<string>
      promptsSave: (id: string, content: string) => Promise<void>
      promptsDir: () => Promise<string>
      aiRun: (params: Record<string, unknown>) => Promise<void>
      aiAbort: (runId: string) => Promise<void>
      aiFetchModels: (provider: Record<string, string>) => Promise<{ id: string; contextLength?: number }[]>
      aiTestProvider: (provider: Record<string, string>, model: string) => Promise<{ ok: boolean; latencyMs: number; model: string; error: string }>
      aiProviderSearchSupported: (baseUrl: string) => Promise<boolean>
      aiOnEvent: (cb: (evt: { runId: string; type: string; payload?: unknown }) => void) => () => void

      // 智能体
      agentRun: (params: Record<string, unknown>) => Promise<void>
      agentAbort: (runId: string) => Promise<void>
      agentSubagentDecide: (id: string, allow: boolean) => Promise<{ ok: boolean; message: string }>
      agentProposals: () => Promise<unknown[]>
      agentBookFiles: (book: string) => Promise<{ path: string; size: number }[]>
      proposalApply: (id: string) => Promise<{ ok: boolean; status: string; message: string }>
      proposalReject: (id: string) => Promise<{ ok: boolean; message: string }>
      libProposalApply: (id: string, keys?: string[]) => Promise<{ ok: boolean; status: string; message: string }>
      libProposalReject: (id: string) => Promise<{ ok: boolean; message: string }>
      agentOnEvent: (cb: (evt: { runId: string; type: string; payload?: unknown }) => void) => () => void

      // 自定义智能体（智能体库）
      customAgentsList: () => Promise<unknown[]>
      customAgentsSave: (a: Record<string, unknown>) => Promise<{ ok: boolean; message: string }>
      customAgentsDelete: (id: string) => Promise<{ ok: boolean; message: string }>
      customAgentsSetEnabled: (id: string, enabled: boolean) => Promise<{ ok: boolean; message: string }>
      customAgentsDraft: (desc: string, bookContext: string) => Promise<unknown>
      agentSummarize: (history: { role: 'user' | 'assistant'; content: string }[]) => Promise<string>

      // 会话
      convList: (book: string) => Promise<unknown[]>
      convLoad: (book: string, id: string) => Promise<unknown>
      convSave: (book: string, conv: Record<string, unknown>) => Promise<void>
      convDelete: (book: string, id: string) => Promise<void>
      convExport: (book: string, id: string) => Promise<string | null>

      // 素材库 / 技能库
      libList: (kind: string) => Promise<unknown[]>
      libRead: (kind: string, group: string, name: string) => Promise<{ name: string; summary: string; tags: string[]; updatedAt: string; body: string }>
      libWrite: (kind: string, group: string, name: string, summary: string, tags: string[], body: string) => Promise<void>
      libDelete: (kind: string, group: string, name: string) => Promise<void>
      libCreateGroup: (kind: string, group: string) => Promise<void>
      libDeleteGroup: (kind: string, group: string) => Promise<void>
      libImportSkill: (group: string) => Promise<string | null>
      libRoot: () => Promise<string>
      libOpen: (kind: string) => Promise<void>

      // 外观：背景图
      bgPick: () => Promise<string | null>
      bgDataUrl: (p: string) => Promise<string>

      // 结构化资料：时间线 / 故事线 / 关系图
      tlRead: (book: string) => Promise<unknown>
      tlWrite: (book: string, nodes: unknown) => Promise<unknown>
      storyRead: (book: string) => Promise<unknown>
      storyWrite: (book: string, nodes: unknown, edges: unknown) => Promise<unknown>
      dictRead: (book: string) => Promise<unknown[]>
      dictWrite: (book: string, entries: unknown) => Promise<unknown[]>
      foreshadowRead: (book: string) => Promise<unknown[]>
      foreshadowWrite: (book: string, entries: unknown) => Promise<unknown[]>
      powerRead: (book: string) => Promise<unknown>
      powerWrite: (book: string, data: unknown) => Promise<unknown>
      trackingRead: (book: string) => Promise<unknown[]>
      trackingWrite: (book: string, entries: unknown) => Promise<unknown[]>
      mapRead: (book: string) => Promise<unknown[]>
      mapWrite: (book: string, maps: unknown) => Promise<unknown[]>
      mapImageSave: (book: string, mapId: string, dataUrl: string) => Promise<string>
      mapImagePick: (book: string, mapId: string) => Promise<string | null>
      mapImageRead: (book: string, rel: string) => Promise<string>
      outlineRead: (book: string) => Promise<unknown[]>
      outlineWrite: (book: string, entries: unknown) => Promise<unknown[]>
      outlineUpsert: (book: string, patch: Record<string, unknown>) => Promise<unknown[]>
      outlineSetStatus: (book: string, no: number, status: string) => Promise<unknown[]>
      charGraphRead: (book: string) => Promise<unknown>
      structureRegister: (book: string, payload: unknown) => Promise<Record<string, number | { added: string[] }>>
      panelsList: (book: string) => Promise<unknown[]>
      panelsAdd: (book: string, input: { name: string; fields?: { key: string; label: string; type: string }[] }) => Promise<unknown>
      panelsRename: (book: string, id: string, name: string) => Promise<unknown[]>
      panelsRemove: (book: string, id: string) => Promise<unknown[]>
      panelsSetHidden: (book: string, id: string, hidden: boolean) => Promise<unknown[]>
      panelsRead: (book: string, panelId: string) => Promise<{ entries: unknown }>
      panelsWrite: (book: string, panelId: string, data: unknown) => Promise<{ entries: unknown }>
      lexiconRead: () => Promise<Record<string, unknown>>
      lexiconSave: (data: unknown) => Promise<void>
      lexiconOpen: () => Promise<void>
      memoryReadGlobal: () => Promise<{ id: string; text: string; category: string; createdAt: string }[]>
      memoryWriteGlobal: (entries: unknown) => Promise<void>
      memoryReadBook: (book: string) => Promise<{ id: string; text: string; category: string; createdAt: string }[]>
      memoryWriteBook: (book: string, entries: unknown) => Promise<void>
      memoryOpen: (scope: 'global' | 'book', book?: string) => Promise<void>
      charGraphWrite: (book: string, nodes: unknown, edges: unknown) => Promise<unknown>

      // AI 调用记录
      aiLogQuery: (filter?: Record<string, unknown>) => Promise<
        {
          id: string
          at: string
          kind: 'text' | 'agent'
          feature: string
          featureLabel: string
          provider: string
          model: string
          ok: boolean
          status: 'success' | 'failed' | 'aborted'
          durationMs: number
          tokens: number
          tokensEstimated: boolean
          error: string
        }[]
      >
      aiLogStats: () => Promise<{ total: number; success: number; failed: number; aborted: number; tokens: number; avgMs: number }>
      aiLogFeatures: () => Promise<{ key: string; label: string }[]>
      aiLogClear: () => Promise<void>

      // 保存与备份
      backupCreate: (book: string) => Promise<{ book: string; dir: string; at: string; sizeBytes: number }>
      backupList: () => Promise<{ book: string; dir: string; at: string; sizeBytes: number }[]>
      backupDelete: (dir: string) => Promise<void>
      backupRestore: (dir: string) => Promise<string>
      backupOpen: () => Promise<string>

      // 角色一人一档
      charactersReadAll: (book: string) => Promise<{ files: { path: string; name: string; content: string }[]; joined: string }>
      charactersSaveSplit: (book: string, text: string) => Promise<{ count: number; legacy: boolean }>

      // 自动更新
      updateCheck: () => Promise<{ ok: boolean; version?: string; message?: string }>
      updateDownload: () => Promise<{ ok: boolean }>
      updateInstall: () => Promise<{ ok: boolean }>
      updateOpenPage: () => Promise<{ ok: boolean }>
      onUpdateStatus: (
        cb: (s: { status: string; version?: string; percent?: number; message?: string }) => void
      ) => () => void
    }
  }
}