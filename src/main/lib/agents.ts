export interface AgentDef {
  id: string
  name: string
  desc: string
  promptId: string
  stage: string
  welcome: string[]
  /** 默认可读目录；空数组表示可读全书 */
  readScope: string[]
  /** 资料区工具型智能体：通常由对应资料面板一键调用，在妙笔选择列表里默认折叠 */
  panel?: boolean
}

/** 面向创作阶段的专业智能体（提示词存在 userData/prompts/agent-*.md，可在设置中编辑） */
export const AGENTS: AgentDef[] = [
  {
    id: 'general',
    name: '通用写作助手',
    desc: '人物、剧情、大纲、正文都能处理',
    promptId: 'agent-general',
    stage: '通用',
    welcome: ['帮我看看这章有什么问题', '这个人物动机站得住吗', '给主线加一个转折'],
    readScope: []
  },
  {
    id: 'character',
    name: '人物智能体',
    desc: '设计人物、关系、动机与弧光',
    promptId: 'agent-character',
    stage: '人物',
    welcome: ['设计一个反派，要有说服力', '检查现有角色有没有工具人', '给主角设计一次道德困境'],
    readScope: ['角色', '大纲', '设定']
  },
  {
    id: 'plot',
    name: '剧情智能体',
    desc: '规划主线、冲突、转折与结局',
    promptId: 'agent-plot',
    stage: '剧情',
    welcome: ['帮我捋一下主线冲突是否够紧', '设计第二次转折', '盘点已埋未收的伏笔'],
    readScope: ['大纲', '设定', '角色', '正文']
  },
  {
    id: 'outline',
    name: '大纲智能体',
    desc: '把人物与剧情整理为分卷分节大纲',
    promptId: 'agent-outline',
    stage: '大纲',
    welcome: ['按黄金三章重写前三章大纲', '把现有剧情拆成三卷', '给第五卷设计爽点节奏'],
    readScope: ['大纲', '角色', '设定']
  },
  {
    id: 'manuscript',
    name: '正文专家',
    desc: '审阅成稿、统筹结构、润色修改',
    promptId: 'agent-manuscript',
    stage: '正文',
    welcome: ['审阅当前章节并给出修改提案', '这章节奏是不是太平了', '把这段描写改得更具体'],
    readScope: ['正文', '大纲', '设定', '角色']
  },
  {
    id: 'section',
    name: '分节写手',
    desc: '围绕当前章节写作，保持连续',
    promptId: 'agent-section',
    stage: '正文',
    welcome: ['按细纲写这一章', '从上一章结尾接着写', '把这一章的开头重写一遍'],
    readScope: ['正文', '大纲', '设定', '角色']
  },
  {
    id: 'setting',
    name: '设定智能体',
    desc: '构建世界观、力量体系、地图与专有名词',
    promptId: 'agent-setting',
    stage: '设定',
    welcome: ['帮我搭一套力量体系', '检查现有设定有没有自相矛盾', '把主要地图和场景列出来'],
    readScope: ['设定', '大纲', '角色']
  },
  {
    id: 'timeline',
    name: '时间线智能体',
    desc: '从文稿提取时间节点、补全断档、检查一致性',
    promptId: 'agent-timeline',
    stage: '时间线',
    welcome: ['从现有章节提取时间线', '检查时间线有没有矛盾', '补全缺失的时间节点'],
    readScope: ['大纲', '设定', '角色', '正文'],
    panel: true
  },
  {
    id: 'storyline',
    name: '故事线智能体',
    desc: '梳理故事节点、因果连接与主线支线',
    promptId: 'agent-storyline',
    stage: '故事线',
    welcome: ['根据大纲生成故事线节点', '梳理主角与反派的关系图', '标出哪些是主线，哪些是支线'],
    readScope: ['大纲', '设定', '角色', '正文'],
    panel: true
  },
  {
    id: 'foreshadow',
    name: '伏笔管理智能体',
    desc: '登记伏笔、追踪回收状态、提醒拖收的钩子',
    promptId: 'agent-foreshadow',
    stage: '伏笔',
    welcome: ['从正文排查所有伏笔并登记', '检查悬置伏笔有没有回收', '把拖收的伏笔排进后续回收计划'],
    readScope: ['大纲', '设定', '正文'],
    panel: true
  },
  {
    id: 'power',
    name: '境界体系智能体',
    desc: '维护境界阶梯、越级规则与角色当前境界',
    promptId: 'agent-power',
    stage: '境界',
    welcome: ['从设定梳理完整境界体系', '主角晋级了，更新角色境界', '检查战力有没有崩坏'],
    readScope: ['设定', '大纲', '正文'],
    panel: true
  },
  {
    id: 'tracking',
    name: '出场追踪智能体',
    desc: '记录角色状态与位置，防神隐防死人复活',
    promptId: 'agent-tracking',
    stage: '出场',
    welcome: ['从最近章节梳理角色出场状态', '检查有没有被写丢的角色', '更新角色受伤与换地图后的位置'],
    readScope: ['正文', '大纲', '角色'],
    panel: true
  },
  {
    id: 'mapper',
    name: '地图智能体',
    desc: '梳理地点与路径，标场景覆盖，查地理矛盾',
    promptId: 'agent-mapper',
    stage: '地图',
    welcome: ['从设定与正文梳理地理格局', '新地点登场了，更新地图', '检查移动路线合不合理'],
    readScope: ['设定', '大纲', '正文'],
    panel: true
  },
  {
    id: 'deconstruct',
    name: '拆书智能体',
    desc: '拆解范文与竞品：大纲、节奏爽点、人物关系',
    promptId: 'agent-deconstruct',
    stage: '拆书',
    welcome: ['拆解这本书的开篇结构', '分析它的爽点节奏', '总结它的人物关系'],
    readScope: []
  },
  {
    id: 'librarian',
    name: '资源管家',
    desc: '管理技能库 / 素材库 / 灵感便签：批量产出、改写、整理、体检',
    promptId: 'agent-librarian',
    stage: '资源库',
    welcome: [
      '帮我把素材库整理一遍，找出重复和主题相近的',
      '我想要 5 条阴狠但不脏话的反派台词素材',
      '把「拆书报告」里那篇提炼成写作技巧存进技能库',
      '给灵感便签写几个开篇钩子的点子'
    ],
    readScope: []
  }
]

export function getAgent(id: string): AgentDef {
  return AGENTS.find((a) => a.id === id) || AGENTS[0]
}

/** 联网搜索工具（按智能体开关注入；schema 定义放这里与其它工具集中管理） */
export const WEB_TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '联网搜索。用于查现实世界的资料、考据、市场信息等作品里查不到的内容。返回标题、链接与摘要。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '搜索关键词' } },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_webpage',
      description: '读取一个网页的正文文字。url 来自 web_search 返回的链接。用于把搜索结果里最相关的一两篇读完整。',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: '网页地址（http/https）' } },
        required: ['url']
      }
    }
  }
]

/** 结构化板块权限表：key → 工具组。自定义智能体可按板块授权（故事线与关系图共用 read_graph/write_graph，故合并为一组） */
export const STRUCT_BOARDS: { key: string; label: string; tools: string[] }[] = [
  { key: 'timeline', label: '时间线', tools: ['read_timeline', 'write_timeline'] },
  { key: 'story', label: '故事线 / 关系图', tools: ['read_graph', 'write_graph'] },
  { key: 'dict', label: '专名词典', tools: ['read_dictionary', 'write_dictionary'] },
  { key: 'foreshadow', label: '伏笔登记', tools: ['read_foreshadow', 'write_foreshadow'] },
  { key: 'power', label: '境界体系', tools: ['read_power', 'write_power'] },
  { key: 'tracking', label: '出场追踪', tools: ['read_tracking', 'write_tracking'] },
  { key: 'outline', label: '卷 / 章细纲', tools: ['read_outline_plan', 'write_outline_plan'] },
  { key: 'map', label: '地图路线图', tools: ['read_map', 'write_map'] }
]

/** 分配模式工具：主智能体把具体工作分配给团队成员（每次调用需作者确认） */
export const DISPATCH_TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'dispatch_agent',
    description:
      '把一项具体工作分配给团队里的另一个智能体执行，它会独立完成任务并把汇报返回给你。agent 填成员 id，task 用一段话描述要它完成什么、输出什么格式。每次分配都需要作者确认后才会执行。',
    parameters: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: '成员 id（见系统提示词中的团队名册）' },
        task: { type: 'string', description: '交给它的一项具体工作，包含背景与期望输出' }
      },
      required: ['agent', 'task']
    }
  }
}

/** 自定义面板读写工具：内置 9 板块各有专用工具，这一对只服务作者自建面板（list 原型） */
export const PANEL_TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'read_panel',
      description:
        '读取一个作者自建面板的条目（如「文风」「科技树」「桥段库」等自定义面板）。panel 填面板名称。内置板块（词典 / 境界 / 地图等）请用各自的专用工具。',
      parameters: {
        type: 'object',
        properties: { panel: { type: 'string', description: '面板名称' } },
        required: ['panel']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_panel',
      description:
        '向作者自建面板提交条目，增量合并：带 id 更新原条目，不带 id 追加；没提到的现有条目自动保留。提交后由作者审阅。entries 里的每条对象按面板字段给值（read_panel 返回里能看到字段名）。',
      parameters: {
        type: 'object',
        properties: {
          panel: { type: 'string', description: '面板名称' },
          entries: { type: 'array', description: '条目数组，每条为对象，键为面板字段名', items: { type: 'object' } },
          summary: { type: 'string', description: '一句话改动说明' }
        },
        required: ['panel', 'entries']
      }
    }
  }
]

/** 作者记忆工具：所有智能体可用（条目式：一条记忆一句话；全局跨书、书籍单书；设置→记忆 可查看） */
export const MEMORY_TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'read_memory',
      description:
        '读取作者记忆条目（每条含 id / 分类 / 一句话内容）。全局记忆（跨书通用偏好与禁区）和/或当前书籍记忆（本书剧情决策与作者要求）。写记忆前必须先读。',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['global', 'book'], description: 'global=全局记忆，book=当前书籍记忆；省略则两个都返回' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_memory',
      description:
        '写入一条记忆（单条新增或更新，不影响其他条目）。text 为一句话记忆，要具体（如「女主绝对不能死」而不是「注意女主」）。作者说「记住 XX」时判断该存全局（跨书通用偏好）还是本书（剧情决策/本书要求）。与现有条目矛盾时：用其 id 传参更新那条，而不是新增。',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['global', 'book'], description: 'global=全局记忆，book=当前书籍记忆' },
          text: { type: 'string', description: '一句话记忆内容，具体明确' },
          category: { type: 'string', description: '分类：偏好 / 禁区 / 剧情 / 要求 等，可省略' },
          id: { type: 'string', description: '更新已有条目时传该条目的 id；新增时不传' }
        },
        required: ['scope', 'text']
      }
    }
  }
]

/** 按智能体权限过滤工具声明。libsRead 省略 = 不限制（内置智能体行为）；webSearch 为 true 时追加联网工具；orchestrator 为 true 时追加分配工具；structBoards 省略 = 结构化板块全部可用；panelBoards 省略 = 自定义面板全部可用 */
export function toolSchemasFor(opts: {
  webSearch: boolean
  libsRead?: string[]
  libsWrite?: boolean
  orchestrator?: boolean
  /** 允许调用的结构化板块 key（STRUCT_BOARDS）；省略 = 全部允许 */
  structBoards?: string[]
  /** 允许读写的自定义面板名；省略 = 全部允许，空数组 = 全部禁止 */
  panelBoards?: string[]
}): typeof TOOL_SCHEMAS {
  let base = TOOL_SCHEMAS.filter((s) => {
    const name = s.function.name
    if (name === 'list_library') return !opts.libsRead || opts.libsRead.length > 0
    if (name === 'read_material') return !opts.libsRead || opts.libsRead.length > 0
    if (name === 'write_material' || name === 'write_materials') return opts.libsRead ? !!opts.libsWrite : true
    return true
  })
  // 收窄结构化板块：未授权板块的读写工具整个不出现在工具列表里
  if (opts.structBoards) {
    const allow = new Set(opts.structBoards)
    const denied = new Set(STRUCT_BOARDS.filter((b) => !allow.has(b.key)).flatMap((b) => b.tools))
    if (denied.size) base = base.filter((s) => !denied.has(s.function.name))
  }
  // 收窄库工具的 enum：只暴露已授权的库
  if (opts.libsRead && opts.libsRead.length) {
    const enums = opts.libsRead
    for (const s of base) {
      if (s.function.name === 'list_library' || s.function.name === 'read_material' || s.function.name === 'write_material') {
        const props = s.function.parameters.properties as Record<string, { type: string; enum?: string[] }>
        if (props.library) props.library.enum = enums
      }
      if (s.function.name === 'write_materials') {
        const items = s.function.parameters.properties.items as { items?: { properties?: Record<string, { type: string; enum?: string[] }> } }
        const libProp = items.items?.properties?.library
        if (libProp) libProp.enum = enums
      }
    }
  }
  const withWeb = [
    ...(base as unknown[]),
    ...MEMORY_TOOL_SCHEMAS,
    ...(opts.webSearch ? WEB_TOOL_SCHEMAS : []),
    ...(opts.orchestrator ? [DISPATCH_TOOL_SCHEMA] : []),
    // 自定义面板工具：授权了至少一个结构化板块或至少一个自定义面板（或未限制）才可用
    ...((!opts.structBoards || opts.structBoards.length > 0 || !!opts.panelBoards?.length) ? PANEL_TOOL_SCHEMAS : [])
  ]
  return withWeb as typeof TOOL_SCHEMAS
}

/** 工具声明（OpenAI function calling 格式） */
export const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'list_documents',
      description: '列出当前作品的全部文件与目录结构。了解作品内容前先调用它。',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_document',
      description: '读取作品内某个文件的完整内容。路径来自 list_documents 的返回值，例如「正文/第001章.md」。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '书内相对路径' } },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_book',
      description: '在当前作品的全部 Markdown 文件中搜索关键词，返回命中的文件、行号与原句。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '要搜索的关键词' } },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'propose_edit',
      description:
        '提出对某个文件的修改提案。调用后不会直接写入，作者会在界面看到差异并决定接受或拒绝。修改任何文稿都必须用它。content 是修改后的完整文件内容。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '书内相对路径，如「正文/第001章.md」' },
          content: { type: 'string', description: '修改后的完整文件内容' },
          summary: { type: 'string', description: '一句话说明这次改了什么，供作者审阅时参考' }
        },
        required: ['path', 'content', 'summary']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_material',
      description:
        '读取资源库中某个条目的全文。library 取值 materials（素材库）、skills（技能库）或 notes（灵感便签）。',
      parameters: {
        type: 'object',
        properties: {
          library: { type: 'string', enum: ['materials', 'skills', 'notes'] },
          group: { type: 'string', description: '分组名，如「通用」' },
          name: { type: 'string', description: '条目名（不含 .md）' }
        },
        required: ['library', 'group', 'name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_library',
      description:
        '列出资源库的分组与条目（含摘要、标签、字数）。不传 library 则三个库都列，keyword 可按名称/摘要/标签过滤。整理、体检、查重前先用它了解现状。',
      parameters: {
        type: 'object',
        properties: {
          library: {
            type: 'string',
            enum: ['materials', 'skills', 'notes'],
            description: '只列某个库；省略则三个库都列'
          },
          keyword: { type: 'string', description: '按名称/摘要/标签过滤' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_material',
      description:
        '在资源库中新建或覆盖一个条目。会提交「入库提案」交由作者审阅确认，不是直接写入。library 取值：materials（素材库，放可直接引用的事实/片段/设定）、skills（技能库，放写作方法论/步骤/检查清单）、notes（灵感便签，放点子与方向）。',
      parameters: {
        type: 'object',
        properties: {
          library: { type: 'string', enum: ['materials', 'skills', 'notes'] },
          group: { type: 'string', description: '分组名，不存在会自动创建' },
          name: { type: 'string', description: '条目名（不含 .md）' },
          summary: { type: 'string', description: '一句话摘要' },
          tags: { type: 'array', items: { type: 'string' }, description: '标签' },
          content: { type: 'string', description: 'Markdown 正文' }
        },
        required: ['library', 'group', 'name', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_materials',
      description:
        '一次提交多个资源库条目的入库提案（同样由作者审阅确认）。用于批量产出：例如一次生成 5 条素材、或把一份拆书报告提炼成多个技能条目。',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: '要入库的条目列表',
            items: {
              type: 'object',
              properties: {
                library: { type: 'string', enum: ['materials', 'skills', 'notes'] },
                group: { type: 'string', description: '分组名，不存在会自动创建' },
                name: { type: 'string', description: '条目名（不含 .md）' },
                summary: { type: 'string', description: '一句话摘要' },
                tags: { type: 'array', items: { type: 'string' } },
                content: { type: 'string', description: 'Markdown 正文' }
              },
              required: ['library', 'group', 'name', 'content']
            }
          },
          summary: { type: 'string', description: '本次批量入库的一句话说明，如「反派台词素材 5 条」' }
        },
        required: ['items']
      }
    }
  },
  {
      type: 'function',
      function: {
        name: 'read_timeline',
        description: '读取当前作品的结构化时间线。修改时间线前必须先读它。',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'write_timeline',
        description:
          '提交时间线的修改提案（会以可读差异交给作者审阅）。nodes 只传要增改的事件：没提到的旧事件会自动保留，不会被清掉。已有事件沿用原 id 更稳。',
        parameters: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: '一句话说明这次时间线改了什么' },
            nodes: {
              type: 'array',
              description: '要增改的事件数组（未提到的旧事件自动保留）',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: '已有节点请沿用原 id；新节点可省略' },
                  title: { type: 'string', description: '事件标题' },
                  time: { type: 'string', description: '时间描述，如「三年前」「登基当日」' },
                  sortKey: { type: 'number', description: '时间顺序序号，越小越早' },
                  line: { type: 'string', enum: ['main', 'sub'], description: '主线还是支线' },
                  chapters: { type: 'array', items: { type: 'string' }, description: '绑定的章节文件路径数组（可绑多个，大线可跨十几章），如「正文/第003章.md」' },
                  desc: { type: 'string', description: '事件详情' },
                  characters: { type: 'array', items: { type: 'string' }, description: '涉及角色名' }
                },
                required: ['title']
              }
            }
          },
          required: ['summary', 'nodes']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_dictionary',
        description: '读取本书的专名词典（人物/地点/组织/功法/物品/称谓的统一登记表）。写正文与设定前必读，所有专有名词必须与词典一致，不许吃书。',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'write_dictionary',
        description:
          '提交专名词典的修改提案（新登场的人名/地名/组织/功法等要登记进词典，由作者审阅后生效）。entries 只传要增改的条目：没提到的旧条目自动保留，不会被清掉。已有条目沿用原 id 更稳（记不住就传对 term）。',
        parameters: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: '一句话说明这次词典改了什么' },
            entries: {
              type: 'array',
              description: '完整的词典条目数组',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: '已有条目请沿用原 id；新条目可省略' },
                  term: { type: 'string', description: '专名' },
                  category: { type: 'string', enum: ['人物', '地点', '组织势力', '功法技能', '物品道具', '称谓礼仪', '其他'] },
                  aliases: { type: 'array', items: { type: 'string' }, description: '别名/旧称' },
                  desc: { type: 'string', description: '设定说明' },
                  firstChapter: { type: 'string', description: '首次出场章节，可空' }
                },
                required: ['term']
              }
            }
          },
          required: ['summary', 'entries']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_foreshadow',
        description: '读取本书的伏笔登记板（埋下的伏笔/钩子挂账表：内容、埋设章节、计划回收点、状态）。写正文前必读，避免伏笔悬置遗忘或提前泄底。',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'write_foreshadow',
        description:
          '提交伏笔登记板的修改提案（正文里新埋的伏笔要登记，回收/作废时更新状态，由作者审阅后生效）。entries 只传要增改的条目：没提到的旧条目自动保留，不会被清掉。已有条目沿用原 id 更稳。',
        parameters: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: '一句话说明这次伏笔登记改了什么' },
            entries: {
              type: 'array',
              description: '完整的伏笔条目数组',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: '已有条目请沿用原 id；新条目可省略' },
                  content: { type: 'string', description: '伏笔内容' },
                  plantChapter: { type: 'string', description: '埋设章节，如「正文/第003章.md」' },
                  planRecycle: { type: 'string', description: '计划回收点（章节或时机描述），可空' },
                  status: { type: 'string', enum: ['悬置', '已收', '作废'], description: '悬置=待回收' },
                  note: { type: 'string', description: '补充备注，可空' }
                },
                required: ['content']
              }
            }
          },
          required: ['summary', 'entries']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_power',
        description: '读取本书的境界体系板（力量等级从低到高、越级/战力规则、主要角色当前境界）。写战斗与修炼情节前必读，防战力崩坏。',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'write_power',
        description:
          '提交境界体系板的修改提案（境界晋级、新增境界、规则修订、角色当前境界变化时提交，由作者审阅后生效）。只传要增改的部分：没提到的旧境界/旧角色/rules 自动保留，不会被清掉。已有条目沿用原 id 更稳。',
        parameters: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: '一句话说明这次境界体系改了什么' },
            realms: {
              type: 'array',
              description: '完整的境界数组，按低到高排序',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: '已有境界请沿用原 id；新增可省略' },
                  name: { type: 'string', description: '境界名，如「炼气」「筑基」' },
                  sortKey: { type: 'number', description: '排序序号，越小越低阶' }
                },
                required: ['name']
              }
            },
            rules: { type: 'string', description: '越级 / 战力规则说明' },
            chars: {
              type: 'array',
              description: '主要角色当前境界表（全量）',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: '已有条目请沿用原 id；新增可省略' },
                  name: { type: 'string', description: '角色名' },
                  realm: { type: 'string', description: '当前境界名（须与 realms 里的名称一致）' },
                  note: { type: 'string', description: '备注，可空' }
                },
                required: ['name']
              }
            }
          },
          required: ['summary']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_tracking',
        description: '读取本书的角色出场追踪板（每个角色：状态[健康/受伤/闭关/离场/死亡]、最近出场章节、所在地）。写正文前必读，防止角色神隐、死人复活或穿越瞬移。',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'write_tracking',
        description:
          '提交角色出场追踪板的修改提案（角色受伤/闭关/离场/死亡、换地图时更新登记，由作者审阅后生效）。entries 只传要增改的条目：没提到的旧条目自动保留，不会被清掉。已有条目沿用原 id 更稳（记不住就传对 name）。',
        parameters: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: '一句话说明这次出场追踪改了什么' },
            entries: {
              type: 'array',
              description: '完整的角色出场条目数组',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: '已有条目请沿用原 id；新条目可省略' },
                  name: { type: 'string', description: '角色名' },
                  status: { type: 'string', enum: ['健康', '受伤', '闭关', '离场', '死亡'] },
                  lastChapter: { type: 'string', description: '最近出场章节，如「正文/第012章.md」' },
                  location: { type: 'string', description: '当前所在地' },
                  note: { type: 'string', description: '补充备注，可空' }
                },
                required: ['name']
              }
            }
          },
          required: ['summary', 'entries']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_map',
        description: '读取本书的地图路线图（多张地图：地点节点[已写过/待写]、地点间连线）。写涉及地理移动的情节前必读，防瞬移防迷路。',
        parameters: {
          type: 'object',
          properties: { mapId: { type: 'string', description: '要读的地图 id，缺省读全部' } },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'write_map',
        description:
          '提交地图路线图的修改提案（新地点登场、场景状态变化、路径关系变化、设置底图时提交，由作者审阅后生效）。maps 只传要改的地图即可：没提到的地图、节点、连线、坐标、状态、底图都会自动保留现状，不会被清掉。改哪张地图时尽量沿用其原 id（记不住就传对 name 也行）。',
        parameters: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: '一句话说明这次地图改了什么' },
            maps: {
              type: 'array',
              description: '只放这次要改的地图，未提到的地图自动原样保留',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: '已有地图请沿用原 id；新地图可省略' },
                  name: { type: 'string', description: '地图名，如「青云宗周边」' },
                  nodes: {
                    type: 'array',
                    description: '该图的地点节点数组',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string', description: '已有节点请沿用原 id；新增可省略' },
                        label: { type: 'string', description: '地点名' },
                        status: { type: 'string', enum: ['已写过', '待写'], description: '该地点的场景写没写过' },
                        x: { type: 'number' },
                        y: { type: 'number' }
                      },
                      required: ['label']
                    }
                  },
                  edges: {
                    type: 'array',
                    description: '该图的连线数组（地点间路径）。不传 = 连线不变；source/target 填节点 id 或地名都可以；本工具对连线只增改、不清除（删线由作者在地图页手动操作）',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        source: { type: 'string', description: '起点节点 id 或地名' },
                        target: { type: 'string', description: '终点节点 id 或地名' },
                        label: { type: 'string', description: '路径说明，可空' }
                      },
                      required: ['source', 'target']
                    }
                  },
                  base: {
                    type: 'object',
                    description:
                      '底图设置（可省略=不改底图）。kind 取 image（用已有图片文件当底图）或 none（清除底图）；path 为书内相对路径，支持 png/jpg/webp/svg，如「设定/地图图/底图.svg」——画底图时先 read_map 记下各节点坐标 (x,y)，用 propose_edit 写一个 viewBox=0 0 1600 1000 的 SVG（该坐标系与节点坐标重合，色块中心对准节点坐标），再用本字段指向它；opacity 为 0.05~1 的不透明度',
                    properties: {
                      kind: { type: 'string', enum: ['image', 'none', 'draw'] },
                      path: { type: 'string', description: '底图文件的书内相对路径' },
                      opacity: { type: 'number', description: '0.05~1，缺省 0.5' }
                    }
                  }
                },
                required: ['name']
              }
            }
          },
          required: ['summary', 'maps']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_outline_plan',
        description: '读取本书的卷/章细纲板（每章一句话细纲+完成状态[待写/已写]，按卷分组；标注「有全文存档」的章还存有完整细纲）。写正文前必读，保持与全局节奏一致。',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'write_outline_plan',
        description:
          '提交卷/章细纲板的修改提案（规划或修订逐章细纲时提交，由作者审阅后生效）。entries 只传要增改的章：没提到的旧章自动保留，不会被清掉。按章序号（no）认章最稳。',
        parameters: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: '一句话说明这次细纲改了什么' },
            entries: {
              type: 'array',
              description: '完整的细纲条目数组',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: '已有条目请沿用原 id；新条目可省略' },
                  vol: { type: 'string', description: '所属卷名，可空' },
                  no: { type: 'number', description: '章节序号' },
                  title: { type: 'string', description: '章节标题' },
                  beat: { type: 'string', description: '一句话到三句话细纲：这章发生什么、推进什么、埋什么钩子' },
                  beatFull: { type: 'string', description: '本细纲全文存档（推荐提交）：场景顺序拆解、出场角色、关键转折与钩子等完整内容。逐章生文检测到全文存档会直接采用该细纲写正文，不再重新构思' },
                  status: { type: 'string', enum: ['待写', '已写'] }
                },
                required: ['no', 'beat']
              }
            }
          },
          required: ['summary', 'entries']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_graph',
        description: '读取当前作品的结构化图数据。kind=story 读故事线，kind=characters 读角色关系图。修改前必须先读。',
        parameters: {
          type: 'object',
          properties: { kind: { type: 'string', enum: ['story', 'characters'] } },
          required: ['kind']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'write_graph',
        description:
          '提交故事线或角色关系图的修改提案（会以可读差异交给作者审阅）。必须指定 kind：story=故事线，characters=角色关系图（漏传会被拒绝）。没提到的旧节点/连线会自动保留，只需传要改的部分。',
        parameters: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['story', 'characters'], description: '必填：story=故事线，characters=角色关系图' },
            summary: { type: 'string', description: '一句话说明这次改了什么' },
            nodes: {
              type: 'array',
              description: '要增改的节点数组（未提到的旧节点自动保留）',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: '已有节点沿用原 id' },
                  label: { type: 'string', description: 'story：节点标题；characters：填在 name' },
                  name: { type: 'string', description: 'characters：角色名' },
                  role: { type: 'string', description: 'characters：身份定位' },
                  kind: {
                    type: 'string',
                    enum: ['setup', 'conflict', 'turn', 'climax', 'ending', 'foreshadow', 'payoff'],
                    description: 'story 节点类型'
                  },
                  main: { type: 'boolean', description: 'story：是否主线' },
                  chapters: { type: 'array', items: { type: 'string' }, description: '绑定的章节文件路径数组（可绑多个），如「正文/第003章.md」' },
                  desc: { type: 'string', description: '节点说明' },
                  x: { type: 'number', description: '画布坐标，不确定时可省略，系统会自动排布' },
                  y: { type: 'number' }
                },
                required: []
              }
            },
            edges: {
              type: 'array',
              description: '连线数组（未提到的旧连线自动保留）。source/target 填节点 id 或名称（角色名/节点标题）都可以',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  source: { type: 'string', description: '起点：节点 id 或名称' },
                  target: { type: 'string', description: '终点：节点 id 或名称' },
                  relation: {
                    type: 'string',
                    enum: ['family', 'love', 'friend', 'enemy', 'other'],
                    description: 'characters：关系类型'
                  },
                  label: { type: 'string', description: '关系或因果说明' }
                },
                required: ['source', 'target']
              }
            }
          },
          required: ['kind', 'summary', 'nodes']
        }
      }
    }
  ]