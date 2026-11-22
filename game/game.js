import { createWorld, updateWorld, VIEW_W, VIEW_H, GROUND_Y } from './level.js'
import { PALETTE, PLAYER, ENEMY, GRUB_PALETTE, MOTH_PALETTE, GLYPHS } from './sprites.js'

const STEP = 1 / 60
const CAMERA_Y = Math.max(0, GROUND_Y + 22 - VIEW_H)
const canvas = document.querySelector('#game')
const ctx = canvas.getContext('2d', { alpha: false })
const win = document.querySelector('#win')
const winCoins = document.querySelector('#win-coins')
const again = document.querySelector('#again')
const hud = document.querySelector('#hud')
const buttons = {
  left: document.querySelector('#btn-left'),
  right: document.querySelector('#btn-right'),
  jump: document.querySelector('#btn-jump'),
}

ctx.imageSmoothingEnabled = false

const keys = new Set()
const pointers = { left: new Set(), right: new Set(), jump: new Set() }
let jumpQueued = false
let world = createWorld()
let cameraX = 0
let hudValue = -1
let winShown = false
const dust = []

function restart() {
  jumpQueued = false
  keys.clear()
  pointers.left.clear()
  pointers.right.clear()
  pointers.jump.clear()
  world = createWorld()
  cameraX = 0
  winShown = false
  win.hidden = true
  dust.length = 0
}

function bindHold(button, name) {
  const press = (event) => {
    event.preventDefault()
    try { button.setPointerCapture(event.pointerId) } catch { /* pointer already gone */ }
    pointers[name].add(event.pointerId)
    if (name === 'jump') jumpQueued = true
  }
  const release = (event) => pointers[name].delete(event.pointerId)
  button.addEventListener('pointerdown', press)
  button.addEventListener('pointerup', release)
  button.addEventListener('pointercancel', release)
  button.addEventListener('contextmenu', (event) => event.preventDefault())
}

bindHold(buttons.left, 'left')
bindHold(buttons.right, 'right')
bindHold(buttons.jump, 'jump')
again.addEventListener('click', restart)

window.addEventListener('keydown', (event) => {
  if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault()
  if ((event.code === 'Space' || event.code === 'Enter') && world.status === 'won') {
    restart()
    return
  }
  if (event.repeat) return
  keys.add(event.code)
  if (event.code === 'Space') jumpQueued = true
})
window.addEventListener('keyup', (event) => keys.delete(event.code))
window.addEventListener('blur', () => {
  keys.clear()
  pointers.left.clear()
  pointers.right.clear()
  pointers.jump.clear()
})

function sampleInput(jumpPressed) {
  return {
    left: keys.has('ArrowLeft') || keys.has('KeyA') || pointers.left.size > 0,
    right: keys.has('ArrowRight') || keys.has('KeyD') || pointers.right.size > 0,
    jumpHeld: keys.has('Space') || pointers.jump.size > 0,
    jumpPressed,
  }
}

function cameraTarget() {
  const player = world.player
  const look = player.facing * 16
  const target = player.x + player.w * 0.5 - VIEW_W * 0.36 + look
  return Math.max(0, Math.min(Math.max(0, world.width - VIEW_W), target))
}

function hash(n) {
  n = Math.imul(n ^ (n >>> 16), 2246822507)
  n = Math.imul(n ^ (n >>> 13), 3266489909)
  return ((n ^= n >>> 16) >>> 0) / 4294967296
}

function drawSprite(rows, x, y, palette, flip, squash = 1) {
  const height = rows.length
  const width = rows[0].length
  const drawH = Math.max(1, Math.round(height * squash))
  const top = Math.round(y + (height - drawH))
  const left = Math.round(x)
  const pixels = []
  for (let j = 0; j < drawH; j++) {
    const src = rows[Math.min(height - 1, Math.floor((j / drawH) * height))]
    for (let i = 0; i < width; i++) {
      const color = palette[src[flip ? width - 1 - i : i]]
      if (color) pixels.push([i, j, color])
    }
  }
  ctx.fillStyle = '#140e18'
  for (const [i, j] of pixels) {
    ctx.fillRect(left + i - 1, top + j, 1, 1)
    ctx.fillRect(left + i + 1, top + j, 1, 1)
    ctx.fillRect(left + i, top + j - 1, 1, 1)
    ctx.fillRect(left + i, top + j + 1, 1, 1)
  }
  for (const [i, j, color] of pixels) {
    ctx.fillStyle = color
    ctx.fillRect(left + i, top + j, 1, 1)
  }
}

function drawText(text, x, y, scale, color) {
  let cursor = x
  for (const ch of text) {
    const glyph = GLYPHS[ch]
    if (!glyph) {
      cursor += 3 * scale
      continue
    }
    ctx.fillStyle = color
    for (let j = 0; j < glyph.length; j++) {
      for (let i = 0; i < glyph[j].length; i++) {
        if (glyph[j][i] === '1') ctx.fillRect(cursor + i * scale, y + j * scale, scale, scale)
      }
    }
    cursor += (glyph[0].length + 1) * scale
  }
}

const SKY = [
  [0, [20, 14, 52]],
  [0.38, [86, 42, 112]],
  [0.66, [206, 86, 92]],
  [0.84, [255, 132, 86]],
  [1, [255, 198, 132]],
]

function skyColor(t) {
  let i = 0
  while (i < SKY.length - 2 && t > SKY[i + 1][0]) i++
  const a = SKY[i]
  const b = SKY[i + 1]
  const u = (t - a[0]) / (b[0] - a[0])
  return `rgb(${a[1].map((v, k) => Math.round(v + (b[1][k] - v) * u)).join(',')})`
}

function drawSky() {
  for (let y = 0; y < VIEW_H; y += 3) {
    ctx.fillStyle = skyColor(y / VIEW_H)
    ctx.fillRect(0, y, VIEW_W, 3)
  }
  for (let i = 0; i < 48; i++) {
    const sx = ((i * 97) - cameraX * 0.08) % (VIEW_W + 20)
    const x = sx < 0 ? sx + VIEW_W + 20 : sx
    if ((i * 13) % 10 > 6) continue
    ctx.fillStyle = i % 4 === 0 ? '#fff1c8' : '#d7c6ff'
    ctx.fillRect(Math.round(x), 8 + (i * 17) % 62, i % 5 === 0 ? 2 : 1, 1)
  }
  const sunX = Math.round(210 - cameraX * 0.12)
  const sunY = 46
  ctx.fillStyle = '#ffd7a4'
  for (let j = -14; j <= 14; j++) {
    const span = Math.floor(Math.sqrt(196 - j * j))
    ctx.fillRect(sunX - span, sunY + j, span * 2 + 1, 1)
  }
  ctx.fillStyle = '#fff0cf'
  ctx.fillRect(sunX - 4, sunY - 3, 5, 4)
}

function drawHills() {
  const layers = [
    { parallax: 0.18, color: '#3a2a66', base: 92, amp: 8, step: 64 },
    { parallax: 0.38, color: '#5c345c', base: 108, amp: 6, step: 46 },
  ]
  for (const layer of layers) {
    const scroll = cameraX * layer.parallax
    ctx.fillStyle = layer.color
    for (let x = 0; x <= VIEW_W; x += 4) {
      const wx = x + scroll
      const crest = Math.round(layer.base + Math.sin(wx * 0.02) * layer.amp + Math.sin(wx * 0.007 + 2) * 6)
      ctx.fillRect(x, crest, 4, VIEW_H - crest)
    }
    for (let wx = 0; wx < world.width + 200; wx += layer.step) {
      const sx = Math.round(wx - scroll)
      if (sx < -16 || sx > VIEW_W + 16) continue
      const crest = Math.round(layer.base + Math.sin(wx * 0.02) * layer.amp)
      ctx.fillRect(sx, crest - 8, 3, 16)
      ctx.fillRect(sx - 5, crest - 14, 13, 5)
      ctx.fillRect(sx - 3, crest - 20, 9, 6)
    }
  }
}

function columnHasGround(x) {
  return world.solids.some(s => !s.oneWay && s.y === GROUND_Y && x >= s.x && x < s.x + s.w)
}

function drawPits(cam) {
  const start = Math.floor(cam / 16) * 16
  const end = cam + VIEW_W + 16
  let run = null
  for (let x = start; x < end; x += 16) {
    const open = x >= 0 && x < world.width && !columnHasGround(x + 8)
    if (open && run === null) run = x
    if ((!open || x + 16 >= end) && run !== null) {
      const right = open ? x + 16 : x
      ctx.fillStyle = '#120e1c'
      ctx.fillRect(run, GROUND_Y, right - run, CAMERA_Y + VIEW_H - GROUND_Y)
      const wave = Math.round(Math.sin(world.time * 3 + run * 0.05))
      ctx.fillStyle = '#1d4c78'
      ctx.fillRect(run, GROUND_Y + 8 + wave, right - run, 16)
      ctx.fillStyle = '#3f8fb8'
      ctx.fillRect(run, GROUND_Y + 8 + wave, right - run, 2)
      run = null
    }
  }
}

function drawSolids(cam) {
  for (const solid of world.solids) {
    if (solid.oneWay) continue
    if (solid.y !== GROUND_Y) continue
    if (solid.x + solid.w < cam || solid.x > cam + VIEW_W) continue
    const left = Math.max(solid.x, cam - 16)
    const right = Math.min(solid.x + solid.w, cam + VIEW_W + 16)
    for (let x = Math.floor(left / 16) * 16; x < right; x += 16) {
      if (x < solid.x || x >= solid.x + solid.w) continue
      const n = hash(x)
      ctx.fillStyle = n > 0.66 ? '#95d25a' : n > 0.33 ? '#78be42' : '#62a636'
      ctx.fillRect(x, GROUND_Y, 16, 4)
      ctx.fillStyle = n > 0.5 ? '#8d5a3c' : '#6e432c'
      ctx.fillRect(x, GROUND_Y + 4, 16, CAMERA_Y + VIEW_H - (GROUND_Y + 4))
      ctx.fillStyle = '#c98558'
      if (n > 0.72) ctx.fillRect(x + 4, GROUND_Y + 10, 2, 2)
      if (n > 0.4 && n < 0.55) ctx.fillRect(x + 10, GROUND_Y + 16, 3, 1)
      ctx.fillStyle = '#d8f08a'
      if ((x / 16) % 5 !== 0) ctx.fillRect(x + 2, GROUND_Y - 2, 1, 2)
      if ((x / 16) % 3 === 0) ctx.fillRect(x + 11, GROUND_Y - 3, 1, 3)
      if (n > 0.82) {
        ctx.fillStyle = '#3f7a32'
        ctx.fillRect(x + 3, GROUND_Y - 5, 7, 3)
        ctx.fillRect(x + 5, GROUND_Y - 8, 3, 3)
      }
    }
  }
  for (const solid of world.solids) {
    if (!solid.oneWay) continue
    if (solid.x + solid.w < cam || solid.x > cam + VIEW_W) continue
    ctx.fillStyle = '#d3924e'
    ctx.fillRect(solid.x, solid.y, solid.w, solid.h)
    ctx.fillStyle = '#8a4e24'
    ctx.fillRect(solid.x, solid.y + solid.h - 2, solid.w, 2)
    ctx.fillStyle = '#f0b56a'
    ctx.fillRect(solid.x, solid.y, solid.w, 1)
    for (let x = solid.x + 8; x < solid.x + solid.w; x += 8) ctx.fillRect(x, solid.y, 1, solid.h)
  }
}

function drawCoin(coin) {
  if (coin.taken && coin.burst <= 0) return
  const bob = coin.taken ? -((0.28 - coin.burst) * 10) : Math.round(Math.sin(world.time * 5 + coin.x) * 1)
  const cx = coin.x + 5
  const cy = coin.y + 5 + bob
  const span = coin.taken ? 2 : Math.max(2, Math.round(4 * Math.abs(Math.sin(world.time * 4 + coin.y))))
  ctx.fillStyle = '#ffd15a'
  ctx.fillRect(cx - span, cy - 3, span * 2, 6)
  ctx.fillRect(cx - span - 1, cy - 1, 1, 3)
  ctx.fillRect(cx + span, cy - 1, 1, 3)
  ctx.fillStyle = '#fff3bf'
  ctx.fillRect(cx - 1, cy - 2, 1, 2)
  if (coin.burst > 0) {
    const spread = (0.28 - coin.burst) * 28
    ctx.globalAlpha = Math.max(0, coin.burst / 0.28)
    ctx.fillStyle = '#fff3bf'
    ctx.fillRect(cx - spread, cy - spread * 0.4, 2, 2)
    ctx.fillRect(cx + spread, cy - spread * 0.2, 2, 2)
    ctx.fillRect(cx, cy - spread, 2, 2)
    ctx.globalAlpha = 1
  }
}

function drawLamp(point) {
  const x = point.spawnX + 5
  ctx.fillStyle = '#6b442c'
  ctx.fillRect(x, GROUND_Y - 18, 2, 18)
  ctx.fillStyle = point.reached ? '#ffd56a' : '#5c5270'
  ctx.fillRect(x - 3, GROUND_Y - 24, 8, 7)
  ctx.fillStyle = point.reached ? '#fff6d0' : '#3a3450'
  ctx.fillRect(x - 1, GROUND_Y - 22, 4, 3)
  if (point.reached) {
    ctx.globalAlpha = 0.28 + Math.sin(world.time * 4 + x) * 0.08
    ctx.fillStyle = '#ffd56a'
    ctx.fillRect(x - 6, GROUND_Y - 28, 14, 14)
    ctx.globalAlpha = 1
  }
}

function drawFlag() {
  const flag = world.flag
  const x = flag.x + 6
  const top = GROUND_Y - 70
  ctx.fillStyle = '#f6f1e6'
  ctx.fillRect(x, top, 2, 70)
  ctx.fillStyle = '#ffd56a'
  ctx.fillRect(x - 2, top - 4, 6, 4)
  const flick = Math.sin(world.time * 8) > 0 ? 0 : 1
  ctx.fillStyle = '#ff4d5e'
  ctx.fillRect(x + 2, top + 4, 12 - flick, 7)
  ctx.fillStyle = '#ffd0a8'
  ctx.fillRect(x + 2, top + 7, 7 - flick, 2)
  ctx.fillStyle = '#7a4630'
  ctx.fillRect(x - 6, GROUND_Y - 3, 16, 3)
}

function drawSign(sign) {
  ctx.fillStyle = '#6b442c'
  ctx.fillRect(sign.x, GROUND_Y - 18, 2, 18)
  ctx.fillStyle = '#f0d0a0'
  ctx.fillRect(sign.x - 9, GROUND_Y - 30, 20, 13)
  ctx.fillStyle = '#6b442c'
  ctx.fillRect(sign.x - 9, GROUND_Y - 30, 20, 1)
  ctx.fillRect(sign.x - 6, GROUND_Y - 24, 9, 2)
  ctx.fillRect(sign.x + 1, GROUND_Y - 27, 2, 2)
  ctx.fillRect(sign.x + 3, GROUND_Y - 25, 2, 2)
  ctx.fillRect(sign.x + 1, GROUND_Y - 21, 2, 2)
  ctx.fillRect(sign.x + 3, GROUND_Y - 23, 2, 2)
}

function drawPlayer() {
  const player = world.player
  const sprite = !player.onGround
    ? PLAYER.jump
    : Math.abs(player.vx) > 12 && Math.floor(Math.abs(player.x) / 6) % 2 === 1
      ? PLAYER.walk
      : PLAYER.idle
  const squash = world.landPulse > 0.04 ? 0.86 : 1
  drawSprite(sprite, player.x - 2, player.y + (squash === 1 ? 0 : 2), PALETTE, player.facing < 0, squash)
}

function drawEnemy(enemy) {
  if (enemy.dead && enemy.squash <= 0) return
  const rows = Math.floor(world.time * 8 + enemy.x) % 2 === 0 ? ENEMY.walk : ENEMY.idle
  const palette = enemy.kind === 'moth' ? MOTH_PALETTE : GRUB_PALETTE
  drawSprite(rows, enemy.x - 1, enemy.y + 1, palette, enemy.dir < 0, enemy.dead ? 0.42 : 1)
}

function drawHud() {
  ctx.fillStyle = '#ffd15a'
  ctx.fillRect(10, 9, 6, 6)
  ctx.fillStyle = '#fff3bf'
  ctx.fillRect(11, 10, 2, 2)
  const label = `${world.coinsCollected}/${world.coins.length}`
  drawText(label, 20, 8, 2, '#fff6e4')
  drawText('MICA', 86 - Math.min(80, cameraX * 0.15), 28, 3, '#fff1d6')
}

function draw() {
  const cam = Math.round(cameraX)
  drawSky()
  drawHills()
  ctx.save()
  if (world.shake > 0) ctx.translate(Math.round(Math.sin(world.time * 90) * world.shake * 10), 0)
  ctx.translate(-cam, -CAMERA_Y)
  drawPits(cam)
  drawSolids(cam)
  for (const sign of world.decor) drawSign(sign)
  for (const point of world.checkpoints) {
    if (point.spawnX > cam - 20 && point.spawnX < cam + VIEW_W + 20) drawLamp(point)
  }
  if (world.flag.x > cam - 30 && world.flag.x < cam + VIEW_W + 30) drawFlag()
  for (const coin of world.coins) {
    if (coin.x > cam - 16 && coin.x < cam + VIEW_W + 16) drawCoin(coin)
  }
  for (const mote of dust) {
    ctx.globalAlpha = Math.max(0, mote.life / 0.22)
    ctx.fillStyle = '#c98558'
    ctx.fillRect(Math.round(mote.x), Math.round(mote.y), 2, 2)
  }
  ctx.globalAlpha = 1
  for (const enemy of world.enemies) {
    if (enemy.x > cam - 24 && enemy.x < cam + VIEW_W + 24) drawEnemy(enemy)
  }
  drawPlayer()
  ctx.restore()
  if (world.hurtFlash > 0) {
    ctx.fillStyle = `rgba(180, 24, 48, ${Math.min(0.45, world.hurtFlash)})`
    ctx.fillRect(0, 0, VIEW_W, VIEW_H)
  }
  drawHud()
}

function syncUi(input) {
  if (hudValue !== world.coinsCollected) {
    hudValue = world.coinsCollected
    hud.textContent = `Koin: ${hudValue}`
  }
  const won = world.status === 'won'
  if (won && !winShown) {
    winShown = true
    winCoins.textContent = `Koin: ${world.coinsCollected}`
    win.hidden = false
  }
  buttons.left.classList.toggle('is-down', input.left)
  buttons.right.classList.toggle('is-down', input.right)
  buttons.jump.classList.toggle('is-down', input.jumpHeld)
  buttons.left.setAttribute('aria-pressed', input.left ? 'true' : 'false')
  buttons.right.setAttribute('aria-pressed', input.right ? 'true' : 'false')
  buttons.jump.setAttribute('aria-pressed', input.jumpHeld ? 'true' : 'false')
}

function updateDust(dt) {
  const player = world.player
  if (world.status === 'play' && player.onGround && Math.abs(player.vx) > 40) {
    const tick = Math.floor(world.time * 16)
    const prev = Math.floor((world.time - dt) * 16)
    if (tick !== prev) dust.push({ x: player.x + (player.facing > 0 ? 0 : player.w), y: player.y + player.h - 1, life: 0.22 })
  }
  for (const mote of dust) mote.life -= dt
  while (dust.length && dust[0].life <= 0) dust.shift()
  if (dust.length > 12) dust.splice(0, dust.length - 12)
}

let last = 0
let acc = 0
function frame(now) {
  if (!last) last = now
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  acc += dt
  let steps = 0
  let consumedJump = false
  let input = sampleInput(false)
  while (acc >= STEP && steps < 5) {
    input = sampleInput(jumpQueued && !consumedJump)
    updateWorld(world, input, STEP)
    if (input.jumpPressed) consumedJump = true
    acc -= STEP
    steps++
  }
  if (consumedJump) jumpQueued = false
  if (steps === 5) acc = 0
  if (steps === 0) input = sampleInput(false)
  if (world.cameraSnap) {
    cameraX = cameraTarget()
    world.cameraSnap = false
  } else {
    const target = cameraTarget()
    cameraX += (target - cameraX) * (1 - Math.exp(-8 * Math.max(dt, STEP)))
  }
  updateDust(dt)
  draw()
  syncUi(input)
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
