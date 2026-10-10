// DAWO 宣传文案 Word v2：全新结构（实战开场）+ 配图按序导出
const fs = require('fs')
const path = require('path')
const {
  Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel, AlignmentType
} = require(process.env.TEMP + '/dawo-doc/node_modules/docx')
const { verifyDocx } = require('./docx-verify.cjs')

const SHOTS = path.join(__dirname, '..', 'resources', 'marketing-shots')
const OUT = path.join(__dirname, '..', 'release', 'DAWO 宣传文案.docx')
const IMG_OUT = path.join(__dirname, '..', 'release', '文案配图')
fs.mkdirSync(IMG_OUT, { recursive: true })

let imgSeq = 0
function pngSize(file) {
  const b = fs.readFileSync(file)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}
function img(name, captionText, width = 560) {
  const p = path.join(SHOTS, name + '.png')
  if (!fs.existsSync(p)) { console.log('缺图:', name); return null }
  imgSeq++
  const seqNo = String(imgSeq).padStart(2, '0')
  fs.copyFileSync(p, path.join(IMG_OUT, `${seqNo}-${captionText.replace(/[\\/:*?"<>|]/g, '')}.png`))
  const { w, h } = pngSize(p)
  const height = Math.round(width * h / w)
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 80 }, children: [new ImageRun({ type: 'png', data: fs.readFileSync(p), transformation: { width, height } })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: `图 ${imgSeq}　${captionText}（配图文件：${seqNo}）`, size: 18, color: '888888' })] })
  ]
}
function h1(text) { return new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { before: 200, after: 120 }, children: [new TextRun({ text, bold: true, size: 44 })] }) }
function sub(text) { return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 300 }, children: [new TextRun({ text, size: 22, color: '666666' })] }) }
function h2(text) { return new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 140 }, children: [new TextRun({ text, bold: true, size: 30 })] }) }
function p(text, opts = {}) { return new Paragraph({ spacing: { after: 140, line: 360 }, children: [new TextRun({ text, size: 22, bold: !!opts.bold, color: opts.color })] }) }
function li(text) { return new Paragraph({ bullet: { level: 0 }, spacing: { after: 100, line: 340 }, children: [new TextRun({ text, size: 22 })] }) }

const children = []
const add = (...els) => els.flat().forEach(e => e && children.push(e))

// ============ 实战开场 ============
add(h1('我当着读者的面，用一句话造了个智能体'))
add(sub('DAWO · AI 小说写作工作台 | 免费 · 数据全在本地'))

add(p('事情是这样的。'))
add(p('我写清代背景的网文。最怕的不是写崩，是写穿。主角管六部尚书叫「部长」，集市上的小贩喊「这位大人」，读者嘴上不说，心里早把书关了。'))
add(p('所以我在自己的软件里做了个功能：一句话，造一个专管这事儿的智能体。'))
add(p('我在输入框里敲：「帮我做一个考据智能体，专门检查清代的官职、服饰、饮食、称谓在我的小说里是否穿帮，发现不符就给出符合史实的替换建议。」点一下 AI 起草，十几秒后，一张完整的定义卡摆在我面前。名称它起好了，叫清代考据官。职责它写好了。开场白它拟了四条。连系统提示词都替我写完了，末尾还有句「现在我是一位专注清代题材考据的网文小说作者，非常荣幸能为您服务」。'))
add(p('我改都没改，直接上岗。'))
add(...img('19-创建智能体-权限表单', 'AI 起草出的清代考据官：名称、职责、欢迎语、系统提示词全部自动生成'))
add(p('造出来的东西我也不是直接放它进书里。它能动我的哪些文件、能看哪几块资料、能不能联网查史料，全是一格一格的开关，我自己勾的。'))
add(...img('20-创建智能体-板块色块', '权限细到每一块：目录、资源库、九大板块逐个勾选，联网与分配独立开关'))

// ============ 它凭什么敢碰资料 ============
add(h2('关键是，它凭什么敢碰我的资料'))
add(p('这是整个软件我最想讲的部分。'))
add(p('很多 AI 写作工具也带资料库。但 AI 和资料是两张皮，你问它设定，它靠你复制粘贴；它写完的东西，散落在聊天记录里，你还得自己搬回资料库。搬的时候手一抖，三个月的设定就乱了。'))
add(p('DAWO 里不是这样。九大资料板块，大纲、角色、设定、时间线、故事线、卷章细纲、专名词典、伏笔登记、境界体系、出场追踪、地图路线图，每一块都给智能体修了专门的读写通道。智能体改你的伏笔登记板，不是往聊天框里贴一段文字让你自己抄，而是提交一张差异卡。'))
add(p('这张卡上写清楚：改了哪几条，加了几条，你原来的数据一个字没动。你点接受，才落库。不点，它就只是个提案。'))
add(p('写入还是增量合并的。AI 补一条新伏笔，你已有的登记原样保留。它提交的关系连线端点写的是角色名而不是内部编号，也认得。它甚至没有删除你数据的权限，想删某条旧设定，它会提示你到面板里手动删。'))
add(p('说白了，我花在这上面的心思，比花在任何花哨功能上的都多。因为「敢让 AI 碰资料」这件事，前提不是 AI 多聪明，是你随时能反悔。'))
add(...img('06-资料区-关系图', '角色关系图：AI 生成的节点与连线，差异卡审阅后才落库'))

// ============ 资料板块 ============
add(h2('九大板块，管的就是三十万字之后的你'))
add(p('写长篇真正的敌人，不是写不出来。是写到三十万字之后，你已经管不住这本书了。'))
add(p('第十七章主角使的招式，和第三章立的规矩对不上了。前面埋的伏笔，读者在评论区问「那个东西后来呢」，你才想起来。三师兄是谁来着，翻回去查要查半天。这些事我一个都经历过，所以每个板块都是照着一个具体的翻车现场设计的。'))
add(li('专名词典：所有专有名词统一登记，带别名和首次出场章节。新名词建议入册，防着第三章「中州」第十八章写成「中洲」'))
add(li('伏笔登记板：埋设章节、计划回收点、状态三样齐全。悬置的排最前面，拖太久没回收的它自己会浮上来'))
add(li('出场追踪：谁受伤了谁闭关了谁在哪张地图最近出场是第几章。防神隐，防死人复活，防瞬移'))
add(li('地图路线图：多张地图多标签页，手绘色块或 AI 示意底图，地点节点压在底图对应位置上'))
add(li('境界体系：等级阶梯、越级规则、每个角色当前在哪一层。战力崩没崩，一查便知'))
add(...img('07-资料区-伏笔', '伏笔登记板：悬置的永远排最前面'))
add(...img('09-资料区-地图', '地图路线图：地点节点压在 AI 示意底图上'))

// ============ 内置团队 ============
add(h2('考据官上岗之前，这里已经有十五个员工'))
add(p('通用写作助手、人物、剧情、大纲、正文专家、分节写手、设定、时间线、故事线、伏笔管理、境界体系、出场追踪、地图、拆书、资源管家。每个都连着对应的资料板块，每个都走提案制。'))
add(p('入口做得比较顺手。写正文写到一半，写作台右栏点一下「出场追踪」，谁在哪、伤没伤，一眼扫完。发现不对劲，面板上点「让智能体」，活儿直接派出去，它读资料、提交提案，全程你盯着。'))
add(...img('03-写作台', '写作台：左侧章节树，右侧十五个资料与智能体标签，随写随查'))
add(p('十五个不够用，就用刚才那招，一句话再造一个。'))

// ============ 多智能体 ============
add(h2('一个人用不够，还能让它们搭伙'))
add(p('两种组队方式。'))
add(p('圆桌接力。一个话题拉多个智能体进来，A 说完 B 接着说，互相补位，互相挑刺。人物智能体设计完动机，剧情智能体马上检验它推不推得动主线，不用你当传话筒。'))
add(p('分配模式。给某个智能体开通分配权限，它就成了包工头。你说「把这章的连续性全面体检一遍」，它自己拆任务，派出场追踪查位置，派境界体系查战力，派词典查专名，最后把结果汇总给你。中间怎么分的工，派给了谁，过程全部可见。'))
add(...img('10-妙笔', '妙笔：所有智能体的对话主场，支持圆桌与任务分配'))

// ============ 写作台与工作流 ============
add(h2('写作本身，也没有将就'))
add(li('AI 一键建书：题材、平台、标签定好，AI 生成简介再润色，一分钟开书'))
add(li('工作流：设定集、分卷、逐章生文一路跑，断网断流不丢进度，细纲自动登记'))
add(li('拆书：贴进竞品开篇，按维度拆解，报告存档，拆出来的套路沉淀进技能库'))
add(li('去 AI 味：22 种 AI 指纹逐条诊断，L1 到 L4 四档改写强度，五维评分'))
add(li('资源库：技能库、素材库、灵感便签开箱自带 26 条预置内容，从黄金三章到断章五类，全是现成方法论'))
add(...img('14-技能库-黄金三章', '技能库内置的黄金三章方法论，条目可直接改'))
add(...img('16-素材库-桥段库', '素材库：经典桥段按适用场景标注'))
add(li('透明度：模型你自己配，任意 OpenAI 兼容服务商；提示词全部开放编辑；每一次 AI 调用都有记录，干了什么花多少，可查'))

// ============ 两句实在话 ============
add(h2('两句实在话'))
add(p('第一，这软件是人加 AI 一起写的。一个人加一个 AI 搭档，不是什么大厂。代码里没有后门，不碰你的稿子，所有数据就是你电脑里的一个文件夹，Markdown 格式，记事本都能打开。'))
add(p('第二，我做了 AI 生成正文的功能，但我劝你少用。创意写作能从一句话想法跑到成稿，你图一乐可以玩。可你要是真想当作者，想攒自己的读者，篇篇 AI 代笔练不出笔力，读者也不傻。这里的智能体是给你查漏洞、盯设定、提方案的编辑，笔，还是握在你自己手里。'))

// ============ 结尾 ============
add(h2('最后'))
add(p('上面那个清代考据官，从一句话到上岗，不到一分钟。它现在还在我的软件里待命，专门盯我哪句话写了不合时代的称呼。'))
add(p('你最想造一个什么样的智能体盯着你的书？评论区说说。若是下个版本它直接内置了，别惊讶。'))

const doc = new Document({ sections: [{ children }] })
Packer.toBuffer(doc).then((buf) => {
  const v = verifyDocx(buf)
  fs.writeFileSync(OUT, buf)
  console.log('written:', OUT, Math.round(buf.length / 1024) + 'KB,', '配图导出:', imgSeq, '张 ->', IMG_OUT, '| 自检通过:', v.images, '张图片', v.exts.join('/'))
}).catch((e) => { console.error(e.message); process.exit(1) })