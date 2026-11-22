// One authored minute across Bukit Arang: a safe meadow, then pits, planks, patrols, and a pennant.
import {
  TILE, PLAYER_H, TUNE, createPlayer, stepPlayer, stepPatrol, enemyContact,
} from './physics.js'

export const VIEW_W = 256
export const VIEW_H = 144
export const GROUND_Y = 192
const PLAT = 160
const HIGH = 144
const DEATH_Y = GROUND_Y + 36

function build() {
  const solids = []
  const coins = []
  const enemies = []
  const checkpoints = []
  const decor = []
  let x = 0
  let flag = null

  function coin(tile, y) {
    coins.push({ x: tile * TILE + 3, y, w: 10, h: 10, taken: false, burst: 0 })
  }
  function ground(tiles, every = 0) {
    const start = x
    solids.push({ x: start * TILE, y: GROUND_Y, w: tiles * TILE, h: 80, oneWay: false })
    x += tiles
    if (every > 0) {
      for (let t = start + 2; t < x - 1; t += every) coin(t, 176)
    }
    return start
  }
  function gap(tiles, withCoin = false) {
    if (withCoin) coin(x + Math.floor((tiles - 1) / 2), 146)
    x += tiles
  }
  function island(tiles, y) {
    solids.push({ x: x * TILE, y, w: tiles * TILE, h: 8, oneWay: true })
    coin(x + Math.floor((tiles - 1) / 2), y - 18)
    x += tiles
  }
  function plank(tile, tiles, y) {
    solids.push({ x: tile * TILE, y, w: tiles * TILE, h: 8, oneWay: true })
    coin(tile + Math.floor((tiles - 1) / 2), y - 18)
  }
  function lampAt(tile, reached = false) {
    checkpoints.push({
      x: tile * TILE + 2,
      y: GROUND_Y - 34,
      w: 12,
      h: 34,
      spawnX: tile * TILE,
      spawnY: GROUND_Y - PLAYER_H,
      reached,
    })
  }
  function lamp() { lampAt(x - 3) }
  function enemy(fromTile, toTile, speed, kind) {
    const w = 14
    const h = 12
    enemies.push({
      x: fromTile * TILE + 8,
      y: GROUND_Y - h,
      w, h,
      minX: fromTile * TILE + 2,
      maxX: toTile * TILE - 2,
      speed, dir: 1, dead: false, squash: 0, kind,
    })
  }

  // Meadow. Flat ground, walking coins, a tap jump, and a full jump — nothing can kill you.
  ground(48)
  for (const tile of [8, 12, 16, 20, 24]) coin(tile, 176)
  for (const tile of [28, 32, 36]) coin(tile, 156)
  coin(42, 112)
  plank(30, 4, PLAT)
  plank(38, 3, HIGH)
  decor.push({ kind: 'sign', x: 7 * TILE })

  // More planks over solid ground, then the first checkpoint and the first pit.
  ground(24)
  plank(52, 4, PLAT)
  plank(58, 4, HIGH)
  plank(64, 4, PLAT)
  lamp()
  gap(2, true)
  ground(8)

  // First patrol. The grub's route stops well before the next hole.
  {
    const start = ground(28, 4)
    enemy(start + 4, start + 16, 26, 'grub')
    for (const step of [6, 10, 14]) coin(start + step, 136)
    lamp()
  }

  gap(2, true)
  ground(6)

  // Ravine of planks. Same-height islands, one higher step in the middle.
  gap(2)
  island(5, PLAT)
  gap(2)
  island(6, PLAT)
  gap(2)
  island(6, HIGH)
  gap(2)
  island(6, PLAT)
  gap(2)
  {
    ground(12, 4)
    lamp()
  }

  {
    const start = ground(28, 4)
    enemy(start + 4, start + 16, 32, 'moth')
    lamp()
  }

  // Short hops across broken ground.
  gap(2, true)
  ground(5)
  gap(2, true)
  ground(5)
  gap(2, true)
  ground(5)
  gap(2)
  {
    ground(12, 4)
    lamp()
  }

  gap(2)
  island(5, PLAT)
  gap(2)
  island(5, PLAT)
  gap(2)
  island(6, PLAT)
  gap(2)
  island(6, HIGH)
  gap(2)
  island(6, PLAT)
  gap(2)
  {
    ground(14, 3)
    lamp()
  }

  {
    const start = ground(26, 4)
    enemy(start + 3, start + 14, 30, 'grub')
    lamp()
  }

  gap(2, true)
  ground(5)
  gap(2)
  island(5, PLAT)
  gap(2)
  island(5, PLAT)
  gap(2)
  island(6, PLAT)
  gap(2)
  island(5, PLAT)
  gap(2)

  // Flag court. A lit lamp, one last moth, then the pennant.
  {
    const start = x
    ground(20, 3)
    lampAt(start + 1)
    enemy(start + 4, start + 11, 24, 'moth')
    const flagTile = start + 15
    flag = { x: flagTile * TILE, y: GROUND_Y - 96, w: 16, h: 96 }
    coin(flagTile - 1, 150)
    coin(flagTile - 1, 128)
  }
  ground(6)

  const width = x * TILE
  solids.push({ x: -48, y: -400, w: 48, h: 900, oneWay: false })
  solids.push({ x: width, y: -400, w: 48, h: 900, oneWay: false })

  const spawn = { x: 4 * TILE, y: GROUND_Y - PLAYER_H }
  checkpoints.unshift({
    x: spawn.x + 2,
    y: GROUND_Y - 34,
    w: 12,
    h: 34,
    spawnX: spawn.x,
    spawnY: spawn.y,
    reached: true,
  })

  return { solids, coins, enemies, checkpoints, decor, flag, width, spawn }
}

function respawn(world) {
  const player = world.player
  player.x = world.spawn.x
  player.y = world.spawn.y
  player.vx = 0
  player.vy = 0
  player.onGround = true
  player.coyote = TUNE.coyote
  player.jumpBuffer = 0
  world.enemies = world.enemyTemplate.map(enemy => ({ ...enemy }))
  world.safeTimer = 0.45
  world.hurtFlash = 0.5
  world.cameraSnap = true
  world.deaths += 1
}

export function createWorld() {
  const built = build()
  const player = createPlayer(built.spawn.x, built.spawn.y)
  player.onGround = true
  player.coyote = TUNE.coyote
  return {
    ...built,
    player,
    enemyTemplate: built.enemies.map(enemy => ({ ...enemy })),
    coinsCollected: 0,
    status: 'play',
    time: 0,
    deaths: 0,
    hurtFlash: 0,
    shake: 0,
    landPulse: 0,
    safeTimer: 0,
    cameraSnap: true,
  }
}

export function updateWorld(world, raw, dt) {
  dt = Math.min(Math.max(dt, 0), 1 / 20)
  world.time += dt
  world.hurtFlash = Math.max(0, world.hurtFlash - dt)
  world.shake = Math.max(0, world.shake - dt)
  world.landPulse = Math.max(0, world.landPulse - dt)
  world.safeTimer = Math.max(0, world.safeTimer - dt)
  if (world.status !== 'play') return world

  const input = {
    left: !!raw.left,
    right: !!raw.right,
    jumpHeld: !!raw.jumpHeld,
    jumpPressed: !!raw.jumpPressed,
  }
  const player = world.player
  for (const enemy of world.enemies) stepPatrol(enemy, world.solids, dt)
  const motion = stepPlayer(player, input, world.solids, dt)
  if (motion.landed) world.landPulse = 0.09

  let hurt = false
  for (const enemy of world.enemies) {
    if (enemy.squash > 0) enemy.squash = Math.max(0, enemy.squash - dt)
    const kind = enemyContact(player, motion.prevBottom, motion.dropSpeed, enemy)
    if (kind === 'stomp') {
      enemy.dead = true
      enemy.squash = 0.16
      player.vy = input.jumpHeld ? TUNE.stompBounceHeld : TUNE.stompBounce
      player.y = enemy.y - player.h
      player.onGround = false
      player.coyote = 0
      world.shake = 0.12
    } else if (kind === 'hurt') {
      hurt = true
    }
  }
  if (hurt && world.safeTimer <= 0) {
    respawn(world)
    return world
  }

  for (const coin of world.coins) {
    if (coin.burst > 0) coin.burst = Math.max(0, coin.burst - dt)
    if (!coin.taken && player.x < coin.x + coin.w && player.x + player.w > coin.x && player.y < coin.y + coin.h && player.y + player.h > coin.y) {
      coin.taken = true
      coin.burst = 0.28
      world.coinsCollected += 1
    }
  }

  for (const point of world.checkpoints) {
    const hit = player.x < point.x + point.w && player.x + player.w > point.x && player.y < point.y + point.h && player.y + player.h > point.y
    if (!hit) continue
    point.reached = true
    world.spawn = { x: point.spawnX, y: point.spawnY }
  }

  const flag = world.flag
  if (player.x < flag.x + flag.w && player.x + player.w > flag.x && player.y < flag.y + flag.h && player.y + player.h > flag.y) {
    world.status = 'won'
    player.vx = 0
    player.vy = 0
    return world
  }

  if (world.safeTimer <= 0 && player.y > DEATH_Y) respawn(world)
  return world
}

export function debugMap(world) {
  const tiles = Math.ceil(world.width / TILE)
  let plat = ''
  let ground = ''
  let marks = ''
  for (let i = 0; i < tiles; i++) {
    const px = i * TILE + 8
    const onGround = world.solids.some(s => !s.oneWay && s.y === GROUND_Y && px >= s.x && px < s.x + s.w)
    const onPlat = world.solids.some(s => s.oneWay && px >= s.x && px < s.x + s.w)
    ground += onGround ? '#' : '.'
    plat += onPlat ? '=' : '.'
    const flag = Math.abs(world.flag.x - i * TILE) < 14
    const point = world.checkpoints.some(c => Math.abs(c.spawnX - i * TILE) < 8)
    const patrol = world.enemies.some(e => px >= e.minX && px < e.maxX)
    marks += flag ? 'F' : point ? 'C' : patrol ? 'E' : '.'
  }
  return `${plat}\n${ground}\n${marks}`
}
