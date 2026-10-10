// CDP 截图脚本 v2：先还原窗口置前，每次截图前等双 rAF 确保过渡完成
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'resources', 'marketing-shots')
fs.mkdirSync(OUT, { recursive: true })

async function getTarget() {
  const res = await fetch('http://127.0.0.1:9222/json')
  const list = await res.json()
  const page = list.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target')
  return page
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
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
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
  // 等双 rAF：确保 page-fade 过渡真正走完（窗口可见时 rAF 才会跑，所以先还原窗口）
  await evalJs(ws, `new Promise(r => { let n = 0; const f = () => { if (++n >= 3) return r(); requestAnimationFrame(f) }; requestAnimationFrame(f); setTimeout(r, 1500) })`)
  await sleep(600)
  const r = await send(ws, 'Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'))
  console.log('saved', name)
}

function clickNav(label) {
  return `(function(){
    const els = [...document.querySelectorAll('button, .nav-item, [class*=nav]')];
    const el = els.find(e => e.textContent.trim().includes('${label}') && e.offsetParent !== null);
    if (!el) return 'not found: ${label}';
    el.click();
    return 'clicked ${label}';
  })()`
}

async function main() {
  const target = await getTarget()
  const ws = await connect(target.webSocketDebuggerUrl)
  await send(ws, 'Page.enable')
  await send(ws, 'Runtime.enable')

  // 还原窗口并置前：rAF 只有窗口可见才会跑，否则过渡永远卡住
  try {
    const { windowId } = await send(ws, 'Browser.getWindowForTarget')
    await send(ws, 'Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } })
  } catch (e) { console.log('window restore skip:', e.message) }
  try { await send(ws, 'Page.bringToFront') } catch (e) {}
  await sleep(500)

  await evalJs(ws, clickNav('首页'))
  await shot(ws, '01-首页')
  await evalJs(ws, clickNav('书架'))
  await shot(ws, '02-书架')
  await evalJs(ws, clickNav('写作台'))
  await shot(ws, '03-写作台')
  await evalJs(ws, clickNav('资料'))
  await shot(ws, '04-资料区-大纲')
  await evalJs(ws, clickNav('角色'))
  await shot(ws, '05-资料区-角色')
  await evalJs(ws, `(()=>{const els=[...document.querySelectorAll('button')];const el=els.find(e=>e.textContent.trim()==='关系图'&&e.offsetParent!==null);if(el)el.click();return !!el})()`)
  await shot(ws, '06-资料区-关系图')
  await evalJs(ws, clickNav('伏笔'))
  await shot(ws, '07-资料区-伏笔')
  await evalJs(ws, clickNav('境界'))
  await shot(ws, '08-资料区-境界')
  await evalJs(ws, clickNav('地图'))
  await shot(ws, '09-资料区-地图')
  await evalJs(ws, clickNav('妙笔'))
  await shot(ws, '10-妙笔')
  await evalJs(ws, clickNav('智能体库'))
  await shot(ws, '11-智能体库')
  await evalJs(ws, clickNav('资源库'))
  await shot(ws, '12-资源库')

  ws.close()
  console.log('done:', OUT)
}
main().catch((e) => { console.error(e.message); process.exit(1) })
