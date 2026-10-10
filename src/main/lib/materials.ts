import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync, copyFileSync } from 'fs'
import { join, normalize, sep, basename } from 'path'
import { app } from 'electron'
import { getLibraryRoot } from './library'

/** 素材库 / 技能库 / 灵感便签：Markdown + YAML frontmatter，条目按分组（子目录）组织 */
export type LibKind = 'materials' | 'skills' | 'notes'

export const LIB_DIR: Record<LibKind, string> = { materials: '_素材库', skills: '_技能库', notes: '_灵感便签' }
export const LIB_LABEL: Record<LibKind, string> = { materials: '素材库', skills: '技能库', notes: '灵感便签' }

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

function kindRoot(kind: LibKind): string {
  return join(getLibraryRoot(), LIB_DIR[kind])
}

/** 库根目录绝对路径（供「在资源管理器中打开」） */
export function kindRootPath(kind: LibKind): string {
  const p = kindRoot(kind)
  mkdirSync(p, { recursive: true })
  return p
}

export function ensureLibraries(): void {
  for (const kind of ['materials', 'skills', 'notes'] as LibKind[]) {
    const root = kindRoot(kind)
    mkdirSync(root, { recursive: true })
    if (!existsSync(join(root, '通用'))) mkdirSync(join(root, '通用'), { recursive: true })
  }
  seedBuiltinSkills()
  seedBuiltinMaterials()
  seedPresetLibraries()
}

/**
 * 安装包内置预置库（resources/preset-libraries/{skills,materials}/分组/条目.md）补缺：
 * - 首次启动（纯净安装）把预置的技能与素材写入用户库
 * - 已存在的条目绝不覆盖（保留用户改动）；被用户删除的条目也不会复活（种子标记按路径记录）
 * - 应用升级自带新条目时会自动补入
 */
export function seedPresetLibraries(): void {
  const base = app.isPackaged
    ? join(process.resourcesPath, 'preset-libraries')
    : join(app.getAppPath(), 'resources', 'preset-libraries')
  if (!existsSync(base)) return
  const markPath = join(app.getPath('userData'), 'preset-libs-seeded.json')
  let mark: Record<string, true> = {}
  try {
    mark = JSON.parse(readFileSync(markPath, 'utf8'))
  } catch {
    /* 无标记文件：全新环境 */
  }
  let dirty = false
  for (const kind of ['skills', 'materials'] as LibKind[]) {
    const src = join(base, kind)
    if (!existsSync(src)) continue
    const dest = kindRoot(kind)
    for (const group of readdirSync(src)) {
      const gdir = join(src, group)
      if (!statSync(gdir).isDirectory()) continue
      mkdirSync(join(dest, group), { recursive: true })
      for (const f of readdirSync(gdir)) {
        if (!f.endsWith('.md')) continue
        const relKey = `${kind}/${group}/${f}`
        const target = join(dest, group, f)
        if (mark[relKey]) continue // 这条预置之前已处理过（用户删了也不复活）
        if (!existsSync(target)) copyFileSync(join(gdir, f), target)
        mark[relKey] = true
        dirty = true
      }
    }
  }
  if (dirty) {
    try {
      writeFileSync(markPath, JSON.stringify(mark, null, 2), 'utf8')
    } catch {
      /* 标记写失败只是下次启动会重复补缺，无实害 */
    }
  }
}

/** 部分内置技能落在独立分组（不进「写作方法论」） */
const SKILL_GROUP_OVERRIDE: Record<string, string> = {
  三幕式骨架: '剧情骨架',
  '英雄之旅（网文改造版）': '剧情骨架',
  升级流分卷骨架: '剧情骨架',
  '单卷 30 章节奏表': '剧情骨架',
  力量体系模板: '设定模板',
  势力模板: '设定模板',
  地理与称谓速查模板: '设定模板',
  对标档案卡模板: '对标档案',
  开篇策略对比表模板: '对标档案',
  发布前自检清单: '自检清单',
  伏笔回收清单: '自检清单',
  人称与一致性检查: '自检清单'
}

/** 首次启动写入内置技能（源自 story / deai-writer 方法论） */
function seedBuiltinSkills(): void {
  for (const [name, summary, tags, body] of BUILTIN_SKILLS) {
    const dir = join(kindRoot('skills'), SKILL_GROUP_OVERRIDE[name] || '写作方法论')
    mkdirSync(dir, { recursive: true })
    const p = join(dir, `${name}.md`)
    if (!existsSync(p)) writeFileSync(p, serializeEntry({ name, summary, tags }, body), 'utf-8')
  }
}

/** 首次启动写入内置素材：桥段库与钩子金句（逐文件判断，缺哪个补哪个） */
function seedBuiltinMaterials(): void {
  for (const [group, items] of BUILTIN_MATERIALS) {
    const dir = join(kindRoot('materials'), group)
    mkdirSync(dir, { recursive: true })
    for (const [name, summary, tags, body] of items) {
      const p = join(dir, `${name}.md`)
      if (!existsSync(p)) writeFileSync(p, serializeEntry({ name, summary, tags }, body), 'utf-8')
    }
  }
}

const BUILTIN_MATERIALS: [string, [string, string, string[], string][]][] = [
  [
    '桥段库',
    [
      [
        '退婚打脸',
        '当众退婚→主角暗中崛起→对方追悔莫及的经典开局',
        ['桥段', '开篇', '打脸'],
        `## 适用场景
开局立目标、立恩怨。读者天然站在被退婚的一方。

## 标准展开
1. 当众受辱：退婚方要强势、傲慢，最好带一个更优越的新欢。
2. 主角不动声色：不当场翻脸，只留一句克制但扎人的话。
3. 时间落差：数章内让主角获得关键成长，双方实力倒转。
4. 重逢即打脸：对方主动挑衅，主角一次碾压，新欢目光转变。

## 反转变体
- 退婚方后来有难，主角施援——把仇写成情，格局立刻不同。
- 主角根本不在乎婚约，真正在意的是退婚背后指使的势力。`
      ],
      [
        '扮猪吃虎',
        '隐藏实力被人轻视，关键时刻露底震全场',
        ['桥段', '装逼', '压抑释放'],
        `## 适用场景
新环境（学院、宗门、公司、军队），主角需要重新建立地位。

## 标准展开
1. 铺垫轻视：让至少两个人当众小看主角，说出具体侮辱性评价。
2. 保留细节：主角偶尔露出与身份不符的小细节，给读者"他有问题"的暗示。
3. 压到临界：误会或陷害把主角逼到必须出手的局面。
4. 一次露底：只露一角，不解释来历，旁观者震惊分层写（不信→怀疑→骇然）。

## 反转变体
- 被识破者选择沉默甚至掩护，成为暗线盟友。
- 露底引来更大势力的注意，装猪变成真麻烦。`
      ],
      [
        '当众打脸三段式',
        '立威—质疑—实证的爽点标准节拍',
        ['桥段', '打脸', '节奏'],
        `## 适用场景
需要一次性兑现压抑积累的章节。

## 标准节拍
1. 立威宣言：反派或旁观者先立一个具体判断（"他绝不可能炼出丹"）。
2. 众人附和：把面子压到最大，侮辱越具体，打脸越响。
3. 实证反转：主角不辩论，直接拿结果说话；全程少说话。
4. 反应分层：最先嘲讽的人失态最重；之前保持中立的人转为敬畏。

## 要点
- 打脸后必须接一个"后果钩子"：反派背后有人，事情不会就这么完。`
      ],
      [
        '绝境翻盘',
        '山穷水尽时亮出最后一张底牌',
        ['桥段', '危机', '反转'],
        `## 适用场景
卷末高潮、BOSS 战、追杀戏。

## 标准展开
1. 断掉所有常规手段：金手指失效、援军被拦、退路被封。
2. 写透绝望：至少让主角自己也承认"这次可能真的完了"。
3. 底牌早埋：翻盘手段必须在之前章节出现过一次不经意的伏笔。
4. 代价兑现：翻盘要有损耗——伤、暴露、失去某物，爽而不廉价。

## 反转变体
- 底牌不是力量而是规则/信息：翻盘靠的是敌人不知道的真相。`
      ],
      [
        '拍卖会捡漏',
        '无人识货→主角识宝→引出更大的局',
        ['桥段', '夺宝', '发财'],
        `## 适用场景
过渡章节、需要给主角发装备或引出新势力时。

## 标准展开
1. 压轴破烂：真正的好东西伪装成不起眼的流拍品。
2. 小钱捡漏：主角以极低价格拿下，全过程克制，不露喜色。
3. 行家追悔：散场后被识货行家拦住，出高价想收——主角拒绝。
4. 麻烦上门：货主或势力循迹而来，捡漏变纠纷，钩子收尾。

## 反转变体
- 主角故意放出假消息，用捡漏当诱饵钓幕后黑手。`
      ],
      [
        '双线揭秘',
        '明线任务与暗线真相在同一章汇合',
        ['桥段', '悬念', '结构'],
        `## 适用场景
卷中大盘点、大反转前的收束章。

## 标准展开
1. 双线并行至少 5 章：明线（查案/任务）与暗线（真相线索）分开推进。
2. 各留半块拼图：每条线都只给一半信息，读者自己开始拼。
3. 汇合点设计在一个具体场景：同一地点、同一时刻、同一件物证。
4. 汇合即翻转：真相让主角的当前目标本身变得可疑或次要。

## 要点
- 汇合前的最后一章，两条线各给一次假汇合，吊住读者。`
      ]
    ]
  ],
  [
    '钩子金句',
    [
      [
        '开篇钩子六式',
        '前 300 字抓住注意力的六种开场方式',
        ['钩子', '开篇'],
        `1. **反常细节**：一个不对劲的画面（"棺材里的人在敲棺材板"）。
2. **危机进行时**：直接从冲突中段切入，跳过一切铺垫。
3. **反差身份**：两句话立一个矛盾身份（"他是全城最年轻的死刑犯，也是唯一的医仙"）。
4. **倒叙惊变**：先给结局的一个爆炸性片段，再回到"三天前"。
5. **断言式独白**：主角用一句极端的话定下全书基调（"我这条命，是捡来的"）。
6. **利害绑定**：30 字内讲清"主角马上要失去什么"。

## 使用要点
- 同一本书前五章避免连续用同一式。
- 钩子之后 300 字内必须落地到具体人物与场景，不能一直悬着。`
      ],
      [
        '章末断章五类',
        '每章结尾留住读者的五种收法',
        ['钩子', '断章', '节奏'],
        `1. **危机悬置**：刀已出鞘，结果留给下章（最常用，别连用超过两章）。
2. **揭秘前一刻**：关键人物张口说真相——"其实当年……"（切）。
3. **转折宣言**：一句颠覆认知的短句独立成段（"那个人，是我师父。"）。
4. **新变量登场**：神秘人物/势力/物品在末尾三行内出现。
5. **倒计时启动**：给出明确时限（"三日之后，血洗青云门"）。

## 使用要点
- 断章点选在"信息即将增加"的临界点，而不是情绪高点之后。
- 大高潮章节反着来：在圆满收尾处断，给读者满足感。`
      ],
      [
        '打脸台词公式',
        '冲突戏里让主角台词既克制又扎人',
        ['金句', '台词', '打脸'],
        `## 三条公式
1. **先接后翻**："你说得对，我确实炼不出丹——"（停顿）"所以我炼了两炉。"
2. **借人之口**：不自夸，让旁观者/敌人阵营的人替他说出真相，杀伤力翻倍。
3. **降维回应**：对方咆哮长篇，主角只回一个短句问句（"你说完了？"）。

## 要点
- 主角打脸台词永远比反派短。
- 台词之后必须跟动作或实证，光靠嘴炮会掉爽感。`
      ],
      [
        '名场面四要素',
        '让一个场景被读者记住的检查表',
        ['金句', '场面', '质检'],
        `## 四要素（缺一就回炉）
1. **一个具体动作**：不是"他很强大"，而是"他两根手指夹住了剑锋"。
2. **一句可摘抄的话**：读者会画线发到书评区的那种。
3. **一个旁观者反应**：世界的震动让场面变大。
4. **一处安静**：全场最响的时刻给一拍静默，动静对比出记忆点。

## 自检
把这段读给不了解剧情的人听——如果对方起鸡皮疙瘩或想追问，就成了。`
      ]
    ]
  ]
]

const BUILTIN_SKILLS: [string, string, string[], string][] = [
  [
    '黄金三章',
    '开篇三章的钩子、危机与第一次正向反馈设计',
    ['开篇', '节奏', '留存'],
    `## 适用场景
开新书、判断开篇能否留住读者时使用。

## 第一章（3000 字内必须完成）
1. **前 300 字**给出主角处境与最紧迫的问题，禁止环境铺陈式开场。
2. **核心冲突落地**：主角必须在本章内遭遇一次具体的、有代价的冲突。
3. **金手指/核心设定露面**：不必解释完，但要让读者看见它的样子。
4. 结尾留一个必须翻页的钩子。

## 第二章
放大危机。让主角的第一次应对失败或付出代价，读者的期待被拉高。

## 第三章
给出第一次小高潮和正向反馈（打脸、逆转、获得认可），兑现开篇承诺。

## 自检清单
- [ ] 第一章是否在 300 字内抓住注意力？
- [ ] 冲突是否有具体代价，还是只是"遇到麻烦"？
- [ ] 三章内是否兑现了至少一次正向反馈？
- [ ] 是否出现了总结式、概述式开头？`
  ],
  [
    '去 AI 味（22 模式）',
    '按三级 22 种 AI 写作模式逐条检查并改写文本',
    ['去AI味', '文风', '润色'],
    `## 一级：最明显的 AI 指纹
1. 夸大意义和趋势（标志着 / 见证了 / 是…的体现）
2. 否定式排比（不仅…而且… / 这不仅仅是…而是…）
3. 三段式列举（强行凑三项分组）
4. 句末分词短语假装深度（突出 / 强调 / 彰显 / 确保）
5. 过度强调知名度与媒体报道
6. 宣传广告式语言（充满活力的 / 令人叹为观止的）
7. 协作交流痕迹（希望这对您有帮助 / 当然！）
8. 公式化的挑战与未来展望

## 二级：常见的 AI 病
9. 滥用 AI 高频词（此外 / 至关重要 / 深入探讨 / 格局）
10. 回避系动词"是"（用"作为 / 代表着 / 充当"替代）
11. 模糊归因（行业报告显示 / 专家认为，无具体来源）
12. 同义词循环（同一对象相邻句换不同称呼）
13. 虚假范围（"从 X 到 Y"但两端不在同一维度）
14. 破折号过度使用
15. 粗体过度使用
16. 内联标题垂直列表

## 三级：细节层面的 AI 味
17. 填充短语（为了实现这一目标 / 由于…的事实）
18. 过度限定（也许 / 可能 / 在某种程度上）
19. 通用积极结论（未来看起来光明）
20. 知识截止日期免责声明
21. 谄媚语气（好问题！）
22. 表情符号装饰

## 改写通用约束
- 每段最多一个转折词
- 必须有一句不超过 10 个字；相邻段落长度差至少 2 倍
- 允许一处不完美的表达或碎片句；不要让每段都总结收尾
- 读起来像金句的句子，重写它
- 叙事文本至少加入一处具体感官细节，允许跳跃与留白`
  ],
  [
    '五维质量评分',
    '从直接性、节奏感、信任度、真实性、精炼度打分并给修改建议',
    ['评分', '质检'],
    `## 五个维度（每维 1-10 分）
- **直接性**：直截了当，不绕弯、不铺垫
- **节奏感**：长短句交替自然，段落长度参差
- **信任度**：简洁明了，信任读者能读懂，不过度解释
- **真实性**：像真人说话，有立场、有偏见、有语气
- **精炼度**：无一字可删

## 输出要求
先给 2-3 句总评，指出最值得改的两处，然后给出分数。低于 7 分的维度必须给出可直接替换的修改示例。`
  ],
  [
    '人物弧光设计',
    '让角色有缺点、欲望与转变轨迹，避免工具人',
    ['人物', '设定'],
    `## 设计要素
1. **欲望**：他想要什么（表层目标）
2. **需要**：他真正缺什么（深层缺口，往往与欲望冲突）
3. **缺点**：会导致他做出错误选择的性格缺陷
4. **创伤/秘密**：解释缺点的来源，不必对读者全部交代
5. **弧光**：故事结束时他在哪一点上变了，以及为此付出的代价

## 反工具人自检
- 这个角色有没有一次为了自己的利益而违背主角？
- 把主角从场景里拿掉，他还会做什么？
- 他的缺点是否真的造成了麻烦，而不只是"可爱的小毛病"？`
  ],
  // ============ 剧情骨架 ============
  [
    '三幕式骨架',
    '建书 / 卷级大纲的通用三幕结构，按比例拆分章节数',
    ['骨架', '大纲', '结构'],
    `## 适用场景
从零搭全书或单卷大纲时。

## 结构（以单卷 30 章为例）
- **第一幕·建置（约 25%，1-8 章）**：交代主角处境与欲望，核心冲突登场，金手指露面。第一幕末的"第一转折"必须把主角推上不归路。
- **第二幕·对抗（约 50%，9-23 章）**：主角主动出击，遭遇层层加码的对抗。中点（15 章左右）安排一次"假胜利"或"假失败"，随后赌注升级。
- **第三幕·决裂与解决（约 25%，24-30 章）**：最大的代价出现，主角用第二幕学到的东西打决胜局，收束本卷并抛出下一卷钩子。

## 使用要点
- 每幕结束时写一句"此刻主角失去了什么/得到了什么"，检验赌注是否递增。
- 大纲每章一句话概括，写不出一句话说明该章没有存在意义。`
  ],
  [
    '英雄之旅（网文改造版）',
    '12 段旅程对照网文升级流，适合单独一本的成长线',
    ['骨架', '成长', '结构'],
    `## 十二段（括号内为网文常见对应）
1. 平凡世界（废柴开局）2. 冒险召唤（机缘/危机上门）3. 拒绝召唤（犹豫一次，显真实）4. 遇见导师（师父/老爷爷/系统）5. 跨越门槛（进入新世界：进城、入门派）6. 试炼盟友（小怪与伙伴）7. 深入险境（接近核心秘密）8. 至暗时刻（大败/失去）9. 获得奖赏（逆袭夺回）10. 归途（带着收获面对新麻烦）11. 复活（终极考验，脱胎换骨）12. 携万能药归来（地位与认知双双改变）。

## 用法
- 升级流把它当"每卷的微观循环"：一卷走一遍 1→12，终点比起点高一个境界/阶层。
- 至暗时刻必须真实损失（人、物、尊严至少一样），否则复活不成立。`
  ],
  [
    '升级流分卷骨架',
    '境界驱动型网文的分卷模板：每卷一个地图、一个对手、一次跃升',
    ['骨架', '升级流', '分卷'],
    `## 每卷五件套（缺一卷就散）
1. **新地图**：换城/换域/换界，旧关系网降级为新地图的背景。
2. **地位重置**：主角在新地图从底层重新被轻视（压抑重启，但保留旧世界带来的底气）。
3. **卷级对手**：一个贯穿全卷的反派，其背后势力指向下一卷。
4. **境界节点**：卷末主角跨一个大境界，且这个境界在卷初就被立为"不可能"。
5. **关系网增量**：卷内至少新增一个长期角色（盟友/亦敌亦友），淘汰一个旧配角。

## 检查
连续两卷用了同类型地图（都是学院/都是秘境）→ 读者疲劳，必须换型。`
  ],
  [
    '单卷 30 章节奏表',
    '逐章节拍分配：爽点与压抑的配比参考',
    ['骨架', '节奏', '爽点'],
    `## 30 章节拍（可按卷长缩放）
- 1-3 章：新地图受辱+立目标（压抑）
- 4-6 章：第一次小胜（小爽）+ 树敌
- 7-9 章：探索与结盟，捡到卷级线索
- 10-12 章：中期小高潮（第一次正面对抗获胜）
- 13-15 章：假胜利——以为稳了，实则捅了马蜂窝（压抑加深）
- 16-20 章：被压着打，代价惨重，盟友出事
- 21-24 章：绝境蓄力，底牌伏笔全部就位
- 25-28 章：连续反打，三连爽点递增
- 29-30 章：卷末大高潮+下一卷钩子

## 配比原则
压抑 : 爽 ≈ 2 : 1，且大爽前必有大压；连续三章无任何进展就是事故。`
  ],
  // ============ 设定模板 ============
  [
    '力量体系模板',
    '搭境界等级表：九境填空法与自洽检查',
    ['模板', '力量体系', '设定'],
    `## 填空表（每境一行）
| 境界名 | 破境条件 | 力量标志 | 寿命/代价 | 社会地位 |
依次填 9 个境界，第一境要与主角开局处境衔接。

## 自洽检查
1. **越级挑战要有依据**：功法/血脉/道具三选一作为"以小博大"的解释，全书不改口。
2. **境界差 = 战力差的上限**要写死：隔几个境界必输，不许临场改规则。
3. **破境条件递进**：越往后越难且越个性化（第一境靠资源，第九境靠道心）。
4. **寿命与代价**：高境界一定有代价（寿元枷锁/心魔/天劫），这是后期剧情引擎。

## 命名
境界名两到三字，避 Aliyun 常用词堆砌；同一体系内命名风格必须统一（都用"境"或都不用）。`
  ],
  [
    '势力模板',
    '一个可写入正文的组织设定卡',
    ['模板', '势力', '设定'],
    `## 填空卡
- **名称与口号**：名字要能望文生义（听名字猜得出正邪与风格）。
- **层级**：首领—长老—核心—外围 四层，每层人数与称谓。
- **行事逻辑**：它靠什么生存（收税/垄断资源/信仰/护卫费），决定它对主角的态度。
- **立场的三条边界**：什么事绝不做（底线）、什么钱一定赚（动力）、谁是不能碰的（忌讳）。
- **与主角的三次关系变化**：初遇（轻视/拉拢）→ 冲突或结盟（中段）→ 定局（收编/覆灭/化敌为友）。

## 要点
一个势力至少给两个有名有姓的角色，否则它只是布景。`
  ],
  [
    '地理与称谓速查模板',
    '地图层级与称呼体系，防止越写越乱',
    ['模板', '地图', '称谓'],
    `## 地图层级（从大到小固定下来）
界 → 域 → 国 → 州 → 城 → 门派/家 → 秘境。每级写一句"特色+危险度"。

## 称谓体系（按题材选一套）
- **修真**：道友/前辈/真人/老祖；弟子分外门/内门/亲传。
- **古言**：大人/老爷/小姐；官职九品制，上下级称呼严格。
- **西幻**：阁下/殿下/爵士；教会与王庭两套序列并行。
- **都市**：哥/总/老师；商界称"总"，体制内称职务。

## 用法
开新地图前先查此表，称谓混用是吃书的重灾区。`
  ],
  [
    '对标档案卡模板',
    '登记对标爆款的档案卡，市场定位与拆书的参照系',
    ['对标', '市场', '模板'],
    `## 填空卡（每本对标一份）
- **书名 / 平台 / 题材标签**：
- **核心卖点（一句话）**：它靠什么留住读者。
- **开篇策略**：前三章各干了什么（对照黄金三章清单）。
- **更新与数据**：连载数量、均订/在榜情况（能查到多少写多少）。
- **与我书的差异**：一句话说清"读者为什么会两个都看 / 为什么只看我的"。

## 用法
- 建书前登记 2-3 本对标，工作流灵感步骤引用它们。
- 拆书报告产出后，回填到对应档案卡，形成"对标 = 数据 + 拆解"的完整档案。`
  ],
  [
    '开篇策略对比表模板',
    '把几本对标的第一章并排比，找自己的开篇路线',
    ['对标', '开篇', '模板'],
    `## 对比表
| 对标书 | 第一句写什么 | 前 300 字给什么 | 第一章冲突 | 金手指露面方式 |
填 3 行，然后回答：
1. 它们共同放弃的东西是什么（那可能就是差异化空间）。
2. 我的开篇在哪一格能同时做到"像类型"和"不像它们"。

## 用法
与「黄金三章」技能配合使用：先填表，再按清单自查。`
  ],
  // ============ 自检清单 ============
  [
    '发布前自检清单',
    '章节上传前的最后一道检查，逐项打勾',
    ['清单', '质检', '发布'],
    `## 每章发布前
- [ ] 主角称呼、名字全章一致（全文搜索一次姓名与绰号）
- [ ] 时间线没有跳跃矛盾（本章距离上章过了多久，明确）
- [ ] 每个出场角色都有存在意义（推动剧情 / 提供信息 / 制造情绪，至少占一样）
- [ ] 章末有钩子（对照「章末断章五类」）
- [ ] 无大段总结式说教；对话占比不低于三成
- [ ] 错别字高危词扫一遍：的地得、重复用字、同音错字
- [ ] 手机端预读开头 300 字，决定是否删掉第一段

## 每卷发布前
- [ ] 本卷伏笔登记表逐条核对：已埋/已收/悬置状态
- [ ] 力量体系、专名与词典一致`
  ],
  [
    '伏笔回收清单',
    '埋伏笔与收伏笔的登记追踪法',
    ['清单', '伏笔', '结构'],
    `## 登记格式（每条一行）
| 伏笔内容 | 埋设章节 | 计划回收点 | 状态（悬置/已收/作废） |

## 埋设规则
1. 伏笔出现时至少给两处细节，单处易被当笔误。
2. 当章只呈现现象，不解释——解释即提前泄底。
3. 大伏笔间隔 20 章以上，小伏笔 5-10 章。

## 回收规则
1. 回收时用一句话点明与埋设处的呼应，但不要重放原文。
2. 每卷末盘点：悬置超过两卷的伏笔要么下卷收，要么明确转为长线。
3. 作废的伏笔也要"废物利用"——让它在别处产生误导价值。`
  ],
  [
    '人称与一致性检查',
    '视角、时态、称谓的一致性自查',
    ['清单', '视角', '一致性'],
    `## 视角
- [ ] 全章视角是否锁定在主角（或明确的切换点）？有没有偷偷切到别人心里？
- [ ] 切视角场景开头三行内让读者知道"现在是谁的视角"。

## 时间
- [ ] 相邻章节时间是否连续？跨天/跨月要有一句交代。
- [ ] 季节、昼夜与描写一致（冬天没有蝉鸣）。

## 称谓与数字
- [ ] 同一人物在不同章的称呼是否统一（词典核对别名）。
- [ ] 修为/等级、金钱数额、距离与前文不冲突（大数字重点查）。
- [ ] 已死角色不再出场，已毁建筑保持损毁状态。`
  ]
]

function serializeEntry(meta: { name: string; summary: string; tags: string[] }, body: string): string {
  const tags = meta.tags.length ? `[${meta.tags.join(', ')}]` : '[]'
  return `---\nname: ${meta.name}\nsummary: ${meta.summary}\ntags: ${tags}\nupdatedAt: ${new Date().toISOString()}\n---\n\n${body}`
}

export interface ParsedEntry {
  name: string
  summary: string
  tags: string[]
  updatedAt: string
  body: string
}

export function parseEntry(raw: string, fallbackName: string): ParsedEntry {
  const out: ParsedEntry = { name: fallbackName, summary: '', tags: [], updatedAt: '', body: raw }
  if (!raw.startsWith('---')) return out
  const end = raw.indexOf('\n---', 3)
  if (end < 0) return out
  const head = raw.slice(3, end)
  out.body = raw.slice(end + 4).replace(/^\r?\n/, '')
  for (const line of head.split('\n')) {
    const i = line.indexOf(':')
    if (i < 0) continue
    const k = line.slice(0, i).trim()
    const v = line.slice(i + 1).trim()
    if (k === 'name') out.name = v || fallbackName
    else if (k === 'summary') out.summary = v
    else if (k === 'updatedAt') out.updatedAt = v
    else if (k === 'tags') out.tags = v.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean)
  }
  return out
}

/** 防路径穿越 */
function safeResolve(kind: LibKind, relPath: string): string {
  const base = normalize(kindRoot(kind))
  const full = normalize(join(base, relPath))
  if (!full.startsWith(base + sep) && full !== base) throw new Error('非法路径')
  return full
}

export function listLibrary(kind: LibKind): LibGroup[] {
  const root = kindRoot(kind)
  mkdirSync(root, { recursive: true })
  const groups: LibGroup[] = []
  for (const name of readdirSync(root)) {
    const p = join(root, name)
    try {
      if (!statSync(p).isDirectory()) continue
    } catch {
      continue
    }
    const entries: LibEntry[] = []
    for (const f of readdirSync(p)) {
      if (!f.endsWith('.md')) continue
      const fp = join(p, f)
      try {
        const raw = readFileSync(fp, 'utf-8')
        const parsed = parseEntry(raw, f.replace(/\.md$/, ''))
        entries.push({
          kind,
          group: name,
          name: parsed.name,
          path: `${name}/${f}`,
          summary: parsed.summary,
          tags: parsed.tags,
          updatedAt: parsed.updatedAt || statSync(fp).mtime.toISOString(),
          size: raw.length
        })
      } catch {
        /* 跳过损坏条目 */
      }
    }
    groups.push({ name, entries: entries.sort((a, b) => a.name.localeCompare(b.name, 'zh')) })
  }
  return groups.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

export function readEntry(kind: LibKind, group: string, name: string): ParsedEntry {
  const p = safeResolve(kind, join(group, `${name}.md`))
  if (!existsSync(p)) return { name, summary: '', tags: [], updatedAt: '', body: '' }
  return parseEntry(readFileSync(p, 'utf-8'), name)
}

export function writeEntry(kind: LibKind, group: string, name: string, summary: string, tags: string[], body: string): void {
  if (!/^[^\\/:*?"<>|]+$/.test(group) || !/^[^\\/:*?"<>|]+$/.test(name)) throw new Error('名称含非法字符')
  const dir = safeResolve(kind, group)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.md`), serializeEntry({ name, summary, tags }, body), 'utf-8')
}

export function deleteEntry(kind: LibKind, group: string, name: string): void {
  const p = safeResolve(kind, join(group, `${name}.md`))
  if (existsSync(p)) rmSync(p)
}

export function createGroup(kind: LibKind, group: string): void {
  if (!/^[^\\/:*?"<>|]+$/.test(group)) throw new Error('名称含非法字符')
  mkdirSync(safeResolve(kind, group), { recursive: true })
}

export function deleteGroup(kind: LibKind, group: string): void {
  const p = safeResolve(kind, group)
  if (!existsSync(p)) return
  rmSync(p, { recursive: true, force: true })
  // Windows 下目录可能仍被占用而删除失败，此时必须报错，不能静默当成功
  if (existsSync(p)) throw new Error(`分组「${group}」删除失败，目录可能仍被其他程序占用`)
}

/** 从外部 Markdown 文件导入为技能条目 */
export function importSkillFile(srcPath: string, group: string): string {
  const name = basename(srcPath).replace(/\.md$/i, '')
  const dir = safeResolve('skills', group)
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, `${name}.md`)
  if (existsSync(dest)) throw new Error('已存在同名技能')
  const raw = readFileSync(srcPath, 'utf-8')
  if (raw.startsWith('---')) copyFileSync(srcPath, dest)
  else writeFileSync(dest, serializeEntry({ name, summary: '', tags: [] }, raw), 'utf-8')
  return name
}

/** 读取多个条目内容，供智能体上下文注入 */
export function readEntriesForContext(kind: LibKind, refs: { group: string; name: string }[]): { title: string; content: string }[] {
  const out: { title: string; content: string }[] = []
  for (const r of refs) {
    const e = readEntry(kind, r.group, r.name)
    if (e.body.trim()) out.push({ title: `[${LIB_LABEL[kind]}·${r.group}] ${e.name}${e.summary ? ` — ${e.summary}` : ''}`, content: e.body })
  }
  return out
}