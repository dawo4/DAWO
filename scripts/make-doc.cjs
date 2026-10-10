// 生成 DAWO 宣传文案 Word 文档（文案 + 12 张界面截图）
const fs = require('fs')
const path = require('path')
const {
  Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel,
  AlignmentType, BorderStyle
} = require(process.env.TEMP + '/dawo-doc/node_modules/docx')
const { verifyDocx } = require('./docx-verify.cjs')

const SHOTS = path.join(__dirname, '..', 'resources', 'marketing-shots')
const OUT = path.join(__dirname, '..', 'release', 'DAWO 宣传文案.docx')

// 读取 PNG 尺寸（IHDR）
function pngSize(file) {
  const b = fs.readFileSync(file)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

function img(name, width = 560) {
  const p = path.join(SHOTS, name + '.png')
  if (!fs.existsSync(p)) { console.log('缺图:', name); return null }
  const { w, h } = pngSize(p)
  const height = Math.round(width * h / w)
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 200 },
    children: [new ImageRun({ type: 'png', data: fs.readFileSync(p), transformation: { width, height } })]
  })
}

function caption(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
    children: [new TextRun({ text, size: 18, color: '888888' })]
  })
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

const children = []
const add = (...els) => els.forEach(e => e && children.push(e))

// ============ 标题 ============
add(h1('智能体只是个聊天框？我把它们做成了懂你这本书的编辑团队'))
add(sub('DAWO · AI 小说写作工作台 | 免费 · 数据全在本地'))

// ============ 写在前面 ============
add(h2('写在前面，先叠个甲'))
add(p('三件事，说在所有功能介绍前面。'))
add(p('一，这软件是人加 AI 一起写的。不是大厂出品，没有百人团队，就是一个人和 AI 搭档，从第一行代码一路迭代到现在。代码是谁敲的，我不藏着。'))
add(p('二，它是干净的。没有后门，不偷稿子，不暗中上传。你写的所有东西，正文也好，设定也好，就是你电脑里的一个文件夹。Markdown 格式，记事本都能打开。AI 干活全是你主动点按钮，数据一步不出门。'))
add(p('三，也是我最想说的：AI 在这里是你的编辑团队，不是你的代笔。我做的所有智能体功能，本意是让它们帮你盯设定、抓漏洞、查吃书、补登记。干的都是你不愿意干、也干不过机器的杂活。正文，最好还是你自己写。工具是放大你的，不是替代你的。'))
add(p('甲叠完了，说正事。', { bold: true }))

// ============ 痛点 ============
add(h2('先问你几个问题'))
add(li('让 AI 帮忙写设定，写完一堆散落的文字。想改一条，发现牵一发动全身？'))
add(li('让 AI 查「我这本书有没有吃书」，它回了一堆，但你根本不知道它看没看你的设定？'))
add(li('挂了俩智能体，想让它们分工，一个查资料一个动笔。结果俩人各聊各的？'))
add(li('想做个专属智能体，比如专查清代官职穿帮的。提示词教程看了半天，还是不会写？'))
add(p('中两条以上，往下看。'))

// ============ 定位 ============
add(h2('它叫 DAWO，一个把资料和智能体焊在一起的写作台'))
add(p('一句话：书架、写作台、九大资料板块、一支智能体团队，全在同一个地方。而且它们彼此认识。'))
add(p('「彼此认识」四个字是重点。市面上不少工具，资料库是资料库，AI 是 AI。你问 AI 一个设定，它得靠你复制粘贴。DAWO 不是。下面细说。'))

// ============ 资料区 ============
add(h2('九大资料板块，每个都是活的'))
add(p('大纲、角色、设定、时间线、故事线、卷章细纲、专名词典、伏笔登记、境界体系、出场追踪、地图路线图。写长篇会散落的东西，全都有专门的位置。'))
add(img('05-资料区-角色'))
add(caption('角色资料卡与关系图共用一个板块入口'))
add(p('几个设计是专门防翻车的。'))
add(p('词典防吃书。所有专有名词统一登记，别名和首次出场章节都记着。防止第三章写「中州」，第十八章写成「中洲」。', {}))
add(p('伏笔登记板。每条伏笔记埋设章节、计划回收点、状态。悬置的排最前面，拖太久没收的它会揪出来。'))
add(img('07-资料区-伏笔'))
add(caption('伏笔登记板：状态色点，悬置的永远排在最上面'))
add(p('出场追踪。谁受伤了、谁闭关了、谁在哪张地图、最近出场是第几章。防神隐，防死人复活，防瞬移。'))
add(p('地图。多张地图多标签页，手绘色块或者 AI 生成的示意底图，地点节点就压在底图对应位置上。'))
add(img('09-资料区-地图'))
add(caption('地图路线图：节点压在示意底图上，随画布缩放'))
add(p('关系图画布。谁跟谁是师徒，谁欠谁一条命，摆上去连线，一眼看全。'))
add(img('06-资料区-关系图'))
add(caption('角色关系图：AI 生成或手动拖拽，连线带关系标签'))

// ============ 智能体 x 资料 ============
add(h2('重点：这支智能体团队是怎么跟资料焊在一起的'))
add(p('DAWO 内置 15 个智能体。通用助手、人物、剧情、大纲、正文专家、分节写手、设定、时间线、故事线、伏笔管理、境界体系、出场追踪、地图、拆书、资源管家。'))
add(p('它们不是十五个换了提示词的聊天框。每个资料板块都有对应的读写通道，智能体能直接读你的词典，直接写你的伏笔登记板。'))
add(p('但不是拿笔往你稿子上乱画，走的是提案制。AI 提交，你看到一张差异卡：改了什么，加了几条，旧数据动没动，一目了然。你点接受，才落库。'))
add(p('写入还是增量合并的。AI 补一条新伏笔，你已有的登记原样不动。AI 补关系连线，端点写角色名它也认得。它删不了你的数据，想删会告诉你去面板手动删。这套东西没有任何炫技成分，但它是「敢让 AI 碰你的资料」的前提。'))
add(p('入口也顺。写正文写到一半，右栏点一下「出场追踪」，角色状态尽收眼底。发现吃书了，面板上「让智能体」一键把活派给对应智能体，你看着它流式干活。'))
add(img('03-写作台'))
add(caption('写作台：左侧章节树，右侧十五个资料与智能体标签，随写随查'))

// ============ 自定义智能体 ============
add(h2('再重点：自定义智能体，一句话造一个'))
add(p('内置的十五个不够用？智能体库右上角「AI 创建智能体」，一句话描述你要什么，AI 替你起草整张定义卡。职责、开场白、工作方式全给你拟好，你改改就能用。全程没写过一行提示词。'))
add(p('然后是权限，这块我做得比较抠。'))
add(li('读写目录：它能碰哪些文件夹。只给大纲，就别想动正文'))
add(li('资源库：能不能往技能库、素材库写东西'))
add(li('结构化板块：九大板块逐个勾选。不勾的，这个智能体看不见也改不了'))
add(li('联网搜索：要不要给它开外部资料'))
add(li('分配模式：它能不能把任务转派给别人，下面说'))
add(p('举个例子。你说「帮我查清代的官职、饮食、称谓是否穿帮」，一句话起草，勾上联网和词典板块，一个考据智能体就上岗了。下面这几张图，就是我真用这句话现场造出来的。'))
add(img('18-创建智能体-描述'))
add(caption('第一步：一句话描述职责，AI 起草'))
add(img('19-创建智能体-权限表单'))
add(caption('AI 起草出的「清代考据官」：名称、职责、欢迎语、系统提示词全部自动生成'))
add(img('20-创建智能体-板块色块'))
add(caption('权限细到每一块：目录、资源库、九大板块逐个勾选，联网与分配独立开关'))
add(img('11-智能体库'))
add(caption('智能体库：15 个内置智能体，右上角一句话创建专属智能体'))

// ============ 多智能体 ============
add(h2('多智能体：不是群聊，是分工'))
add(p('两种玩法。'))
add(p('圆桌接力。一个话题拉多个智能体进来，A 说完 B 接着说，互相补位，互相挑刺。人物智能体设计完动机，剧情智能体马上检验它推不推得动主线。'))
add(p('分配模式。给一个智能体开通分配权限，它就成了包工头。你把大任务丢给它，它自己拆解，派给合适的成员，汇总结果。你说「把这章的连续性全面体检一遍」，它可能派出场追踪查位置，派境界体系查战力，派词典查专名，最后给你一份汇总。'))

// ============ 其他板块 ============
add(h2('其他板块，快速过一遍'))
add(li('AI 一键建书：定位、题材、平台、标签，AI 生成简介再润色，一分钟开书'))
add(li('工作流：从设定集到分卷到逐章生文，断网断流不丢进度，细纲自动登记'))
add(li('拆书：贴进竞品开篇，按维度拆解，报告存档，套路沉淀进技能库'))
add(li('去 AI 味：22 种 AI 指纹逐条诊断，L1 到 L4 四档改写强度，五维评分'))
add(li('透明度：模型你自己配，任意 OpenAI 兼容服务商；提示词全部开放编辑；每一次 AI 调用都有记录可查'))
add(img('10-妙笔'))
add(caption('妙笔：所有智能体的对话主场，支持圆桌与任务分配'))
add(img('12-资源库'))
add(caption('资源库：技能库、素材库、灵感便签，AI 管家帮你整理体检'))
add(img('01-首页'))
add(caption('首页：常用入口与作品直达'))

// ============ 资源库章节（补充） ============
add(h2('资源库：自带一支写作弹药库'))
add(p('技能库和素材库不是空的容器，开箱就带 26 条预置内容，覆盖一个网文作者从开书到发布整条路上的高频需求。'))
add(p('技能库里，写作方法论有黄金三章、去 AI 味 22 种模式、五维质量评分、人物弧光设计。剧情骨架给了三幕式、升级流分卷、单卷 30 章节奏表、英雄之旅的网文改造版。再往下还有对标档案模板、发布前自检清单、力量体系与势力设定模板。'))
add(img('13-资源库-技能库'))
add(caption('技能库：按分组管理，左侧切库，正文区直接可改'))
add(img('14-技能库-黄金三章'))
add(caption('黄金三章：逐条对照着检查自己的开篇'))
add(img('15-技能库-三幕式骨架'))
add(caption('三幕式骨架：建书和卷级大纲都能套'))
add(p('素材库走轻量路线。桥段库收了退婚打脸、扮猪吃虎、当众打脸三段式、绝境翻盘这类经典桥段的标准节拍。钩子金句给了开篇钩子六式、章末断章五类、打脸台词公式。卡文的时候翻一翻，经常能捡到一根救命稻草。'))
add(img('16-素材库-桥段库'))
add(caption('素材库：桥段按适用场景标注'))
add(img('17-素材库-退婚打脸'))
add(caption('退婚打脸：立威、质疑、实证的完整节拍拆解'))
add(p('所有条目都是 Markdown，你可以随便改、随便加。素材库还能让 AI 管家起草、改写、批量整理、做重复度体检。你拆书拆出来的套路，也能一键沉淀成自己的技能条目。'))

// ============ 结尾 ============
add(h2('最后'))
add(p('长篇的敌人从来不是写不出来。是写到三十万字之后，你已经管不住这本书了。'))
add(p('DAWO 里那一堆板块和智能体，管的就是这个。软件免费，数据在你自己电脑上。'))
add(p('那么问题来了。你写小说的时候，最希望有个专属智能体帮你盯什么？评论区聊聊。说不定下个版本，它就内置了。'))

const doc = new Document({
  sections: [{ children }]
})
Packer.toBuffer(doc).then((buf) => {
  const v = verifyDocx(buf)
  fs.writeFileSync(OUT, buf)
  console.log('written:', OUT, Math.round(buf.length / 1024) + 'KB | 自检通过:', v.images, '张图片', v.exts.join('/'))
}).catch((e) => { console.error(e.message); process.exit(1) })
