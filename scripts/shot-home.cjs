// 重拍 01-主页：点击左栏「首页」（注意导航项叫首页不叫主页），截新 0.4 主页
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

async function main() {
  const ws = await connect((await getTarget()).webSocketDebuggerUrl)
  await send(ws, 'Page.enable')
  await send(ws, 'Runtime.enable')
  try { await send(ws, 'Page.bringToFront') } catch (e) {}
  await sleep(400)
  // 左栏导航项是「首页」；校验点击结果，失败即退出不再盲拍
  const r = await evalJs(ws, `(()=>{
    const els=[...document.querySelectorAll('button, .nav-item')].filter(e=>e.offsetParent!==null);
    const el=els.find(e=>e.textContent.trim().startsWith('首页'));
    if(!el) return 'no: 首页';
    el.click(); return 'ok'
  })()`)
  console.log('click 首页:', r)
  if (r !== 'ok') { ws.close(); process.exit(1) }
  await sleep(1000)
  // 确认顶部标题真的是首页再拍
  const title = await evalJs(ws, `document.querySelector('title') ? document.title : ''`)
  console.log('title:', title)
  await shot(ws, '01-主页')
  ws.close()
  console.log('done')
}
main().catch((e) => { console.error(e.message); process.exit(1) })
