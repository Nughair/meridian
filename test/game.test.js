import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPlayer, stepPlayer, TUNE, PLAYER_H } from '../game/physics.js'
import { createWorld, updateWorld, debugMap, GROUND_Y } from '../game/level.js'

const STEP = 1 / 60
const idle = { left: false, right: false, jumpHeld: false, jumpPressed: false }

function jumpHeight(holdFrames) {
  const ground = [{ x: 0, y: 200, w: 4000, h: 40, oneWay: false }]
  const player = createPlayer(0, 200 - PLAYER_H)
  player.onGround = true
  player.coyote = TUNE.coyote
  let peak = player.y
  for (let i = 0; i < 180; i++) {
    stepPlayer(player, {
      left: false,
      right: false,
      jumpPressed: i === 0,
      jumpHeld: i < holdFrames,
    }, ground, STEP)
    if (player.y < peak) peak = player.y
  }
  return (200 - PLAYER_H) - peak
}

test('a tap hops low and holding the button jumps high', () => {
  const tap = jumpHeight(1)
  const full = jumpHeight(180)
  assert.ok(tap < 30, `tap ${tap}`)
  assert.ok(full > 56 && full < 78, `full ${full}`)
  assert.ok(full - tap > 30, `delta ${full - tap}`)
})

test('a held running jump clears a two-tile pit and a tap falls in', () => {
  const groundY = 200
  const solids = [
    { x: 0, y: groundY, w: 400, h: 80, oneWay: false },
    { x: 432, y: groundY, w: 400, h: 80, oneWay: false },
  ]
  function cross(holdFrames) {
    const player = createPlayer(0, groundY - PLAYER_H)
    player.onGround = true
    player.coyote = TUNE.coyote
    let jumping = false
    let hold = 0
    for (let i = 0; i < 700; i++) {
      let jumpPressed = false
      if (!jumping && player.onGround && player.x + player.w >= 396) {
        jumping = true
        jumpPressed = true
        hold = holdFrames
      }
      stepPlayer(player, {
        left: false,
        right: true,
        jumpPressed,
        jumpHeld: hold > 0,
      }, solids, STEP)
      if (hold > 0) hold -= 1
      if (player.y > groundY + 50) return 'fall'
      if (player.x > 470 && player.onGround) return 'clear'
    }
    return 'timeout'
  }
  assert.equal(cross(180), 'clear')
  assert.equal(cross(1), 'fall')
})

test('one-way planks can be jumped through and landed on', () => {
  const ground = [
    { x: 0, y: 200, w: 200, h: 40, oneWay: false },
    { x: 40, y: 160, w: 48, h: 8, oneWay: true },
  ]
  const player = createPlayer(48, 200 - PLAYER_H)
  player.onGround = true
  player.coyote = TUNE.coyote
  let crossed = false
  let landed = false
  for (let i = 0; i < 180; i++) {
    const before = player.y
    stepPlayer(player, {
      left: false, right: false,
      jumpPressed: i === 0,
      jumpHeld: true,
    }, ground, STEP)
    if (before + player.h > 160 && player.y + player.h < 160) crossed = true
    if (crossed && player.onGround && Math.abs(player.y + player.h - 160) < 0.01) landed = true
  }
  assert.equal(crossed, true)
  assert.equal(landed, true)
})

test('the opening is safe ground and the route has pits, planks, patrols, and a flag', () => {
  const world = createWorld()
  const [plats, ground, marks] = debugMap(world).split('\n')
  const firstPit = ground.indexOf('.')
  assert.ok(firstPit >= 64, `first pit at tile ${firstPit}`)
  assert.ok(ground.includes('.'))
  assert.ok(plats.includes('='))
  assert.ok(marks.includes('E'))
  assert.ok(marks.includes('F'))
  assert.ok(marks.includes('C'))
  assert.ok(world.enemies.length >= 4)
  assert.ok(world.checkpoints.length >= 4)
  assert.ok(world.coins.length >= 25)
})

test('standing still at the start does not kill or move the courier', () => {
  const world = createWorld()
  const start = world.player.x
  for (let i = 0; i < 180; i++) updateWorld(world, idle, STEP)
  assert.equal(world.deaths, 0)
  assert.equal(world.status, 'play')
  assert.ok(Math.abs(world.player.x - start) < 0.01)
  assert.ok(Math.abs(world.player.y + world.player.h - GROUND_Y) < 0.01)
})

test('running collects a coin, pits send you to the last checkpoint, and the flag wins', () => {
  const world = createWorld()
  for (let i = 0; i < 180; i++) updateWorld(world, { ...idle, right: true }, STEP)
  assert.ok(world.coinsCollected > 0)

  const checkpoint = world.checkpoints[1]
  world.player.x = checkpoint.spawnX
  world.player.y = checkpoint.spawnY
  world.player.vx = 0
  world.player.vy = 0
  updateWorld(world, idle, STEP)
  assert.equal(world.spawn.x, checkpoint.spawnX)

  const ground = debugMap(world).split('\n')[1]
  const pit = ground.indexOf('.')
  world.player.x = pit * 16
  world.player.y = GROUND_Y + 80
  world.player.vy = 40
  world.safeTimer = 0
  updateWorld(world, idle, STEP)
  assert.equal(world.deaths, 1)
  assert.equal(world.player.x, checkpoint.spawnX)

  world.player.x = world.flag.x
  world.player.y = GROUND_Y - PLAYER_H
  world.safeTimer = 0
  updateWorld(world, idle, STEP)
  assert.equal(world.status, 'won')
  const deaths = world.deaths
  world.player.y = 999
  updateWorld(world, idle, STEP)
  assert.equal(world.deaths, deaths)
})

test('dropping onto a patrol stomps it and walking into one respawns', () => {
  const world = createWorld()
  const enemy = world.enemies[0]
  world.player.x = enemy.x
  world.player.y = enemy.y - world.player.h - 1
  world.player.vy = 120
  world.player.onGround = false
  updateWorld(world, idle, STEP)
  assert.equal(enemy.dead, true)
  assert.equal(world.deaths, 0)
  assert.ok(world.player.vy < 0)

  const side = createWorld()
  const grub = side.enemies[0]
  side.player.x = grub.x - side.player.w + 4
  side.player.y = grub.y
  side.player.onGround = true
  updateWorld(side, idle, STEP)
  assert.equal(side.deaths, 1)
  assert.equal(side.player.x, side.spawn.x)
})

test('patrols stay on their stretch of ground', () => {
  const world = createWorld()
  const origins = world.enemies.map(enemy => ({ x: enemy.x, y: enemy.y }))
  for (let i = 0; i < 30; i++) updateWorld(world, idle, STEP)
  assert.ok(world.enemies.some((enemy, i) => enemy.x !== origins[i].x))
  for (let i = 0; i < 60 * 12; i++) updateWorld(world, idle, STEP)
  world.enemies.forEach((enemy, i) => {
    assert.equal(enemy.y, origins[i].y)
    assert.ok(enemy.x >= enemy.minX - 0.1, `left ${enemy.x} < ${enemy.minX}`)
    assert.ok(enemy.x + enemy.w <= enemy.maxX + 0.1, `right ${enemy.x + enemy.w} > ${enemy.maxX}`)
    assert.equal(enemy.dead, false)
  })
})

function runner(world) {
  const player = world.player
  const feet = player.y + player.h
  const supported = (x, y) => world.solids.some(s => x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h)
  const edge = player.onGround && supported(player.x + player.w * 0.5, feet + 2) && !supported(player.x + player.w + 6, feet + 6)
  let enemy = false
  for (const foe of world.enemies) {
    if (foe.dead) continue
    const dx = foe.x - (player.x + player.w)
    const dy = Math.abs((foe.y + foe.h) - feet)
    if (dx < 24 && dx > -6 && dy < 18) enemy = true
  }
  const jumpPressed = player.onGround && player.vx > 50 && (edge || enemy)
  return { left: false, right: true, jumpPressed, jumpHeld: jumpPressed || player.vy < 0 }
}

test('holding right and jumping the gaps reaches the flag in about a minute', () => {
  const world = createWorld()
  let guard = 0
  while (world.status !== 'won' && world.time < 120 && guard < 20000) {
    updateWorld(world, runner(world), STEP)
    guard++
  }
  assert.equal(world.status, 'won', `x=${world.player.x.toFixed(0)} deaths=${world.deaths} t=${world.time.toFixed(1)}\n${debugMap(world)}`)
  assert.equal(world.deaths, 0, `deaths at x=${world.player.x.toFixed(0)} t=${world.time.toFixed(1)}`)
  assert.ok(world.time >= 45 && world.time <= 85, `duration ${world.time.toFixed(1)}s`)
  assert.ok(world.coinsCollected > 5)
})

test('the page exposes keyboard hints, simultaneous touch buttons, coins, and play again', () => {
  const root = path.dirname(fileURLToPath(import.meta.url))
  const html = fs.readFileSync(path.join(root, '../game/index.html'), 'utf8')
  assert.match(html, /id="game"/)
  assert.match(html, /id="btn-left"/)
  assert.match(html, /id="btn-right"/)
  assert.match(html, /id="btn-jump"/)
  assert.match(html, /id="again"/)
  assert.match(html, /Main lagi/)
  assert.match(html, /Koin:/)
  assert.match(html, /type="module" src="\.\/game\.js"/)
  const css = fs.readFileSync(path.join(root, '../game/style.css'), 'utf8')
  assert.match(css, /touch-action:\s*none/)
})
