// DAWO 宣传文案 0.4：Word 版（客观风格，0.3+0.4 合并更新说明 + 新功能截图）
const fs = require('fs')
const path = require('path')
const {
  Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel,
  AlignmentType, BorderStyle
} = require(process.env.TEMP + '/dawo-doc/node_modules/docx')
const { verifyDocx } = require('./docx-verify.cjs')

const SHOTS = path.join(__dirname, '..', 'resources', 'marketing-shots')
const OUT = path.join(__dirname, '..', 'release', 'DAWO 宣传文案-v0.4.docx')
const IMG_OUT = path.join(__dirname, '..', 'release', '文案配图-04')
fs.mkdirSync(IMG_OUT, { recursive: true })

let imgSeq = 0
function pngSize(file) {
  const b = fs.readFileSync(file)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}
function img(name, caption, width = 560) {
  const p = path.join(SHOTS, name + '.png')
  if (!fs.existsSync(p)) { console.log('缺图:', name); return null }
  imgSeq++
  const no = String(imgSeq).padStart(2, '0')
  fs.copyFileSync(p, path.join(IMG_OUT, `${no}-${caption.replace(/[\\/:*?"<>|]/g, '')}.png`))
  const { w, h } = pngSize(p)
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { before: 120, after: 80 },
      children: [new ImageRun({ type: 'png', data: fs.readFileSync(p), transformation: { width, height: Math.round(width * h / w) } })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 240 },
      children: [new TextRun({ text: `图 ${imgSeq}　${caption}（配图 ${no}）`, size: 18, color: '888888' })]
    })
  ]
}

function h1(text) {
  return new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { before: 200, after: 120 }, children: [new TextRun({ text, bold: true, size: 44 })] })
}
function sub(text) {
  return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 300 }, children: [new TextRun({ text, size: 22, color: '666666' })] })
}
function h2(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 140 }, children: [new TextRun({ text, bold: true, size: 30 })] })
}
function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 140, line: 360 },
    children: [new TextRun({ text, size: 22, bold: !!opts.bold, color: opts.color })]
  })
}
function li(text) {
  return new Paragraph({ bullet: { level: 0 }, spacing: { after: 100, line: 340 }, children: [new TextRun({ text, size: 22 })] })
}
function hr() {
  return new Paragraph({
    spacing: { before: 160, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' } },
    children: []
  })
}

const children = []
const add = (...els) => els.flat().forEach(e => e && children.push(e))

// ============ 标题 ============
add(h1('DAWO 0.4 更新：任务通道拆九条，智能体有了记忆，设定工具可以自己攒'))
add(sub('DAWO 0.4.1 · 免费 · 本地优先 · 面向长篇网文创作 · 含 0.3 内容回顾'))
add(hr())

// ============ 开头 ============
add(p('DAWO 是一款免费、本地优先的长篇网文写作软件，数据全部存在用户自己的磁盘上，无账号、无云端。0.3 与 0.4 两个版本累计改动较大，这里挑重点讲清楚，文末附小功能清单。'))
add(...img('01-主页', 'DAWO 0.4 主页：常用工具从四个扩到八个，记忆库和自定义面板有了直达入口'))

// ============ 一、任务通道 ============
add(h2('一、任务通道：九条 AI 通道各配各的模型'))
add(p('建书大纲和三百章正文对模型的要求不一样：前者要质量，后者要成本。0.4 把 AI 调用拆成九条任务通道——灵感与取名、建书大纲与设定、逐章正文、拆书与资料登记、智能续写、润色、去 AI 味、划词、智能体对话，逐条分配服务商与模型。'))
add(p('按单章正文换便宜模型估算，三百章的累计差额相当可观。任务模型页提供「应用到全部」：配好一行，九条通道一起跟上。老用户升级零成本——新通道自动继承原有配置，一个设置都不用动。'))
add(...img('05-任务模型分配', '九条任务通道逐条分配模型：逐章正文换便宜模型，大纲保留高质量'))
add(...img('04-AI服务-服务商', 'AI 设置标签化：服务商卡片标着「正在服务」哪些任务，删除前确认并清点任务引用'))

// ============ 二、作者记忆 ============
add(h2('二、作者记忆：全局与书籍两层，智能体可读可写'))
add(p('记忆功能在方案选型时对比过 Mem0、Zep、Letta、LangMem 四家，最终没有采用任何一家的向量库方案——写作场景的记忆量级是几百字，为这个量级引入向量库或图数据库不成比例。'))
add(p('落地形态是两个本地文件：'))
add(li('全局记忆：跨书生效，存所有作品通用的偏好与禁区'))
add(li('书籍记忆：每本书一个，存这本书的剧情决策（例如「女主的断臂设定第三章起全书不可逆」）'))
add(p('所有对话智能体的系统提示词都注入这两层记忆，写正文、改大纲前先读。智能体也能自己写记忆：对话里说「记住，这本书反派别脸谱化」，它会判断该存全局还是本书，提交审阅卡，作者点了才落盘。'))
add(p('记忆以条目为单位管理，逐条编辑、逐条删除，互不影响。攒多了提供一键 AI 整理：去重、合并、清理过时决策。'))
add(...img('06-记忆管理', '记忆页：全局与本书两层记忆，条目式逐条编辑，一键 AI 整理'))

// ============ 三、自定义面板 ============
add(h2('三、自定义面板：设定工具自己攒'))
add(p('内置九大板块覆盖通用需求，但每本书需要的设定工具不一样。0.4 提供面板注册表：资料区右侧「添加」按钮，起名、定义字段，一个专属面板即成，数据存在书里跟着书走。'))
add(li('智能体可读写自定义面板——建一个「文风」面板写上禁忌句式，写手智能体开口前会先读它；写入走提案制'))
add(li('权限到面板实例——创建自定义智能体时逐个勾选它能动哪些面板，专管文风审校的智能体可以碰不到时间线正文'))
add(li('全端接入——左栏导航、写作台右栏速览、Ctrl+K 全局搜索三处同步收录'))
add(p('内置九板块不动，老书原样可用。'))
add(...img('08-自定义面板', '自定义列表面板：字段自己定，条目逐条编辑，存在书里跟着书走'))
add(...img('10-新建面板向导', '新建面板向导：起名、定字段，两步出一个专属设定工具'))
add(...img('09-左栏面板组', '左栏导航自动追加「自定义面板」分组，全局搜索也能搜到里面的条目'))

// ============ 四、去AI味 ============
add(h2('四、去 AI 味：按文体拆两套规则，打分器本地零成本'))
add(p('旧版只有一套规则，小说正文和文章用同一把尺子。0.4 拆成两套：小说正文管叙述者越位、对话占比与句长落差；文章管机械连接词、科普腔、自问自答。'))
add(p('面板顶部的六维打分器（具体性、爆发度、疑虑、口语、离题、不完美）全程本地计算，不花 token，哪项弱了直接给出补法。判词词库外置为本地 JSON，用户可以自己加词。'))
add(p('生成端同样设防：逐章生文提示词禁用一组高危句式、强制句长落差，写出来首检就能过，比事后修补省一轮。'))
add(...img('02-去AI味-人类信号', '人类信号打分器：六维实时算分，零 token，判词词库可以自己改'))

// ============ 五、设定体检 ============
add(h2('五、设定体检：六类问题，附证据与调和方案'))
add(p('设定体量上去之后，自相矛盾和吃书靠人肉记忆查不全。新加的「设定体检」一键跑全库：对照词典、境界体系、地图与大纲，查六类问题——命名冲突、体系矛盾、地理穿帮、重复设定、无用设定、空洞设定。每条附双方原文证据，再给两个调和方案供挑选。'))
add(p('源头也有约束：建书完成后自动把大纲和设定登记进词典、境界、关系图；设定智能体每次开口前先读登记现状。'))
add(...img('07-资料区-伏笔', '伏笔登记板：逐章生文时整板注入作为硬约束，计划回收的必须回收'))

// ============ 六、工作流 0.4 ============
add(h2('六、工作流 0.4：长篇跑得动，也跑得稳'))
add(li('保守裁剪注入：大纲按当前卷切，角色卡按出场切（词典匹配 + 主角强制保留 + 多级回退），token 成本与幻觉率一起降'))
add(li('伏笔硬约束：悬置伏笔整板注入正文提示词，计划回收的必须回收'))
add(li('细纲全文存档（0.4.1 新增）：细纲板每章可存完整细纲全文，智能体生成的细纲、上次工作流生成的细纲都会存档；逐章生文检测到存档直接采用，不再重新构思，也不覆盖'))
add(li('字数估章数：填预估总字数与单章字数，章节数自动算出'))
add(li('稳定性：修复推理模型思考期导致的「假卡死」（思考内容走独立字段，此前未被监听，看门狗误杀正常请求）；现思考期有实时状态，60 秒无输出提示、150 秒自动中止；失败章节一律不当完整章落盘'))
add(...img('03-工作流', '逐章生文工作流：按卷切大纲、按出场切角色卡、伏笔硬约束、细纲存档直接采用'))

// ============ 小功能清单 ============
add(h2('小功能清单'))
add(li('AI 设置页标签化：服务商、任务模型、联网搜索、智能体行为各一页'))
add(li('服务商卡片标注「正在服务」的任务，删除前确认并清点任务引用'))
add(li('主题扩到六套（玄青夜砚、黛竹烟雨、紫霞夜卷、羊皮古卷等），圆角三档、字号四档可调'))
add(li('拆书支持直接导入 TXT/MD 文件，章数分五档精细度，三十章也能拆'))
add(li('全局搜索收录自定义面板条目'))
add(li('下拉框滚动误关闭等界面问题修复'))
add(...img('07-外观主题', '六套主题随换，圆角与字号三档四档可调'))

// ============ 结尾 ============
add(hr())
add(h2('升级说明'))
add(p('0.2、0.3 用户直接下载 0.4.1 覆盖安装，书稿与配置原地保留。新用户安装后先在设置里配一个 AI 服务商，其余跟着主页工具走。'))
add(p('DAWO 免费，无广告，无账号。所有数据都在用户自己的磁盘上。'))
add(...img('10-妙笔', '妙笔：智能体工作台，十五个内置智能体加自定义编外队'))

const doc = new Document({ sections: [{ children }] })
Packer.toBuffer(doc).then((buf) => {
  const v = verifyDocx(buf)
  fs.writeFileSync(OUT, buf)
  console.log('written:', OUT, Math.round(buf.length / 1024) + 'KB, 配图:', imgSeq, '张 ->', IMG_OUT, '| 自检通过:', v.images, '张图片', v.exts.join('/'))
}).catch((e) => { console.error(e.message); process.exit(1) })
