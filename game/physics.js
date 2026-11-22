// Fixed-step movement for Mica. Kept separate so jump feel and collisions can be tested without a browser.
export const TILE = 16
export const PLAYER_W = 12
export const PLAYER_H = 14

export const TUNE = {
  gravity: 900,
  fallGravity: 1550,
  lowJumpGravity: 2700,
  jumpVelocity: -340,
  maxRun: 96,
  accel: 700,
  airAccel: 520,
  friction: 1500,
  airFriction: 90,
  terminal: 310,
  coyote: 0.1,
  jumpBuffer: 0.12,
  stompSlop: 10,
  stompBounce: -210,
  stompBounceHeld: -300,
}

export function createPlayer(x, y) {
  return {
    x, y, w: PLAYER_W, h: PLAYER_H,
    vx: 0, vy: 0,
    onGround: false,
    facing: 1,
    coyote: 0,
    jumpBuffer: 0,
  }
}

export function aabb(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function overlapsX(a, s) {
  return a.x + 0.5 < s.x + s.w && a.x + a.w - 0.5 > s.x
}

function resolveX(player, solids) {
  for (let pass = 0; pass < 2; pass++) {
    for (const s of solids) {
      if (s.oneWay || !aabb(player, s)) continue
      // Feet resting on a surface are flush with the top and must not snag as a wall.
      if (player.y + player.h <= s.y + 3) continue
      if (player.vx > 0 || (player.vx === 0 && player.x + player.w - s.x < s.x + s.w - player.x)) {
        if (player.vx >= 0) player.x = s.x - player.w
        else player.x = s.x + s.w
      } else {
        player.x = s.x + s.w
      }
      player.vx = 0
    }
  }
}

function depenetrate(player, solids) {
  for (let pass = 0; pass < 3; pass++) {
    let hit = false
    for (const s of solids) {
      if (s.oneWay || !aabb(player, s)) continue
      const penTop = player.y + player.h - s.y
      const penBottom = s.y + s.h - player.y
      const penLeft = player.x + player.w - s.x
      const penRight = s.x + s.w - player.x
      const min = Math.min(penTop, penBottom, penLeft, penRight)
      hit = true
      if (min === penTop) {
        player.y = s.y - player.h
        if (player.vy > 0) player.vy = 0
        player.onGround = true
      } else if (min === penBottom) {
        player.y = s.y + s.h
        if (player.vy < 0) player.vy = 0
      } else if (min === penLeft) {
        player.x = s.x - player.w
        player.vx = 0
      } else {
        player.x = s.x + s.w
        player.vx = 0
      }
    }
    if (!hit) break
  }
}

export function stepPlayer(player, input, solids, dt) {
  dt = Math.min(Math.max(dt, 0), 1 / 20)
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0)
  const accel = player.onGround ? TUNE.accel : TUNE.airAccel
  const friction = player.onGround ? TUNE.friction : TUNE.airFriction
  if (dir !== 0) {
    player.facing = dir
    player.vx += dir * accel * dt
    if (player.vx > TUNE.maxRun) player.vx = TUNE.maxRun
    if (player.vx < -TUNE.maxRun) player.vx = -TUNE.maxRun
  } else if (player.vx !== 0) {
    const drop = friction * dt
    if (Math.abs(player.vx) <= drop) player.vx = 0
    else player.vx -= Math.sign(player.vx) * drop
  }

  if (input.jumpPressed) player.jumpBuffer = TUNE.jumpBuffer
  else player.jumpBuffer = Math.max(0, player.jumpBuffer - dt)

  if (player.jumpBuffer > 0 && (player.onGround || player.coyote > 0)) {
    player.vy = TUNE.jumpVelocity
    player.onGround = false
    player.coyote = 0
    player.jumpBuffer = 0
  }

  const gravity = player.vy < 0
    ? (input.jumpHeld ? TUNE.gravity : TUNE.lowJumpGravity)
    : TUNE.fallGravity
  player.vy = Math.min(TUNE.terminal, player.vy + gravity * dt)

  const prevBottom = player.y + player.h
  const dropSpeed = player.vy

  player.x += player.vx * dt
  resolveX(player, solids)

  player.y += player.vy * dt
  let floor = null
  let ceiling = null
  for (const s of solids) {
    if (!overlapsX(player, s)) continue
    const newBottom = player.y + player.h
    const newTop = player.y
    if (dropSpeed >= 0 && prevBottom <= s.y + 0.8 && newBottom >= s.y) {
      if (floor === null || s.y < floor) floor = s.y
    } else if (!s.oneWay && dropSpeed < 0 && prevBottom > s.y + s.h - 0.8 && newTop <= s.y + s.h && newBottom > s.y) {
      const bottom = s.y + s.h
      if (ceiling === null || bottom > ceiling) ceiling = bottom
    }
  }

  player.onGround = false
  if (dropSpeed < 0 && ceiling !== null) {
    player.y = ceiling
    player.vy = 0
  } else if (floor !== null && dropSpeed >= 0) {
    player.y = floor - player.h
    player.vy = 0
    player.onGround = true
  }
  depenetrate(player, solids)

  if (player.onGround) player.coyote = TUNE.coyote
  else player.coyote = Math.max(0, player.coyote - dt)

  return { prevBottom, dropSpeed }
}

export function stepPatrol(enemy, solids, dt) {
  if (enemy.dead) return
  dt = Math.min(Math.max(dt, 0), 1 / 20)
  const dir = enemy.dir || 1
  const next = enemy.x + dir * enemy.speed * dt
  const turn = () => { enemy.dir = -dir }
  if (next < enemy.minX || next + enemy.w > enemy.maxX) return turn()
  const front = dir > 0 ? next + enemy.w + 1 : next - 1
  const foot = enemy.y + enemy.h + 1
  const supported = solids.some(s => front >= s.x && front < s.x + s.w && foot >= s.y && foot < s.y + s.h)
  if (!supported) return turn()
  const midY = enemy.y + enemy.h * 0.4
  const blocked = solids.some(s => !s.oneWay && front >= s.x && front < s.x + s.w && midY >= s.y && midY < s.y + s.h)
  if (blocked) return turn()
  enemy.x = next
}

// 'stomp' when feet come down through the top of a live enemy. Anything else that overlaps hurts.
export function enemyContact(player, prevBottom, dropSpeed, enemy) {
  if (enemy.dead) return 'none'
  const box = { x: enemy.x + 1, y: enemy.y, w: Math.max(1, enemy.w - 2), h: enemy.h }
  if (!aabb(player, box)) return 'none'
  if (dropSpeed > 0 && prevBottom <= enemy.y + TUNE.stompSlop) return 'stomp'
  return 'hurt'
}
