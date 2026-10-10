// 新功能宣传截图：主页 / 去AI味 / 工作流 / AI服务4标签 / 记忆 / 主题 / 自定义面板 / 向导
const fs = require('fs')
const path = require('path')
const OUT = path.join(__dirname, '..', 'resources', 'marketing-shots')

async function getTarget() {
  const res = await fetch('http://127.0.0.1:9222/json')
  return (await res.json()).find((t) => t.type === 'page')
}
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.onopen = () => resolve(ws)
    ws.onerror = () => reject(new Error('ws error'))
  })
}
let seq = 0
function send(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    const onMsg = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id === id) {
        ws.removeEventListener('message', onMsg)
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
      }
    }
    ws.addEventListener('message', onMsg)
    ws.send(JSON.stringify({ id, method, params }))
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function evalJs(ws, expression) {
  const r = await send(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('eval error: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text))
  return r.result.value
}
async function shot(ws, name) {
  await evalJs(ws, `new Promise(r => { let n = 0; const f = () => { if (++n >= 3) return r(); requestAnimationFrame(f) }; requestAnimationFrame(f); setTimeout(r, 1500) })`)
  await sleep(400)
  const r = await send(ws, 'Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'))
  console.log('saved', name)
}
/** 点击左栏/页面按钮（文本匹配） */
async function click(ws, text, exact = false) {
  const arg = JSON.stringify({ text, exact })
  return evalJs(
    ws,
    `(()=>{const p=${arg};const els=[...document.querySelectorAll('button, .nav-item')].filter(e=>e.offsetParent!==null);const el=els.find(e=>p.exact?e.textContent.trim()===p.text:e.textContent.includes(p.text));if(!el)return 'no: '+p.text;el.click();return 'ok'})()`
  )
}

async function main() {
  const ws = await connect((await getTarget()).webSocketDebuggerUrl)
  await send(ws, 'Page.enable')
  await send(ws, 'Runtime.enable')
  try { await send(ws, 'Page.bringToFront') } catch (e) {}
  await sleep(400)

  // 01 主页（含左栏自定义面板组 + 8 工具）——注意左栏导航项叫「首页」，叫「主页」匹配不到
  const r01 = await click(ws, '首页')
  if (r01 !== 'ok') throw new Error('点击「首页」失败: ' + r01)
  await sleep(700)
  await shot(ws, '01-主页')

  // 02 写作台右栏去AI味
  await click(ws, '写作台')
  await sleep(800)
  await click(ws, '去 AI 味')
  await sleep(900)
  await shot(ws, '02-去AI味-人类信号')

  // 03 工作流
  await click(ws, '工作流')
  await sleep(800)
  await shot(ws, '03-工作流')

  // 04 设置 AI 服务 - 服务商
  await click(ws, '设置')
  await sleep(800)
  await click(ws, 'AI 服务', true)
  await sleep(700)
  await shot(ws, '04-AI服务-服务商')

  // 05 任务模型
  await click(ws, '任务模型', true)
  await sleep(500)
  await shot(ws, '05-任务模型分配')

  // 06 记忆
  await click(ws, '记忆', true)
  await sleep(700)
  await shot(ws, '06-记忆管理')

  // 07 外观主题
  await click(ws, '外观', true)
  await sleep(600)
  await shot(ws, '07-外观主题')

  // 08 资料区自定义面板（经主页工具跳转）
  await click(ws, '主页')
  await sleep(600)
  await click(ws, '自定义面板')
  await sleep(900)
  await shot(ws, '08-自定义面板')

  // 09 左栏折叠组展开状态
  const expand = await evalJs(ws, `(()=>{
    const el=[...document.querySelectorAll('*')].find(e=>e.offsetParent!==null&&e.textContent.trim()==='自定义面板'&&e.querySelector('svg'));
    if(el)el.click();return !!el
  })()`)
  console.log('expand group:', expand)
  await sleep(500)
  await shot(ws, '09-左栏面板组')

  // 10 新建面板向导
  await evalJs(ws, `(()=>{
    const el=[...document.querySelectorAll('button')].find(b=>b.offsetParent!==null&&b.textContent.trim()==='添加');
    if(el)el.click();return !!el
  })()`)
  await sleep(700)
  await shot(ws, '10-新建面板向导')
  await evalJs(ws, `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.offsetParent!==null&&b.textContent.trim()==='取消');if(b)b.click();return true})()`)
  ws.close()
  console.log('done')
}
main().catch((e) => { console.error(e.message); process.exit(1) })
