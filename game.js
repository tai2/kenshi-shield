// =====================================================================
// 剣と盾 - ボスバトルゲーム
// =====================================================================

const W = 900, H = 700;
const CENTER = { x: W / 2, y: H / 2 };
const ARENA_R = 300;
const PLAYER_SPEED = 3.2;
const PLAYER_R = 14;
const BOSS_MAX_HP = 100;

// ---- グローバル状態 -----------------------------------------------------
let canvas, ctx;
let state = 'WEAPON_SELECT'; // WEAPON_SELECT, BOSS_INTRO, BATTLE, BOSS_DEAD, GAME_OVER, VICTORY
let selectedWeapon = null;   // 'sword' | 'shield' | 'hammer'
let stageIndex = 0;
const stages = ['sword', 'bow', 'hammer'];

let player = null;
let boss = null;
let projectiles = [];
let effects = [];

let keys = {};
let mouse = { x: 0, y: 0, down: false };
let spaceDown = false;
let spaceHeldDuration = 0;
let stateTimer = 0;
let lastTime = 0;

// =====================================================================
// 入力処理
// =====================================================================
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !spaceDown) {
    spaceDown = true;
    spaceHeldDuration = 0;
    if (player) player.onSpacePress();
    e.preventDefault();
  }
  if (e.code.startsWith('Arrow')) {
    keys[e.code] = true;
    e.preventDefault();
  }
  if (e.code === 'Enter' && (state === 'GAME_OVER' || state === 'VICTORY')) {
    resetToWeaponSelect();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    const held = spaceHeldDuration;
    spaceDown = false;
    spaceHeldDuration = 0;
    if (player) player.onSpaceRelease(held);
  }
  if (e.code.startsWith('Arrow')) keys[e.code] = false;
});

function setupMouse() {
  const rect = () => canvas.getBoundingClientRect();
  canvas.addEventListener('mousemove', (e) => {
    const r = rect();
    mouse.x = (e.clientX - r.left) * (W / r.width);
    mouse.y = (e.clientY - r.top) * (H / r.height);
  });
  canvas.addEventListener('mousedown', (e) => {
    const r = rect();
    mouse.x = (e.clientX - r.left) * (W / r.width);
    mouse.y = (e.clientY - r.top) * (H / r.height);
    mouse.down = true;
    handleClick();
  });
  canvas.addEventListener('mouseup', () => { mouse.down = false; });
}

function handleClick() {
  if (state === 'WEAPON_SELECT') {
    // 武器ボタン
    const buttons = weaponButtons();
    for (const b of buttons) {
      if (mouse.x >= b.x && mouse.x <= b.x + b.w &&
          mouse.y >= b.y && mouse.y <= b.y + b.h) {
        selectedWeapon = b.weapon;
        return;
      }
    }
    // スタートボタン
    const sb = startButton();
    if (selectedWeapon &&
        mouse.x >= sb.x && mouse.x <= sb.x + sb.w &&
        mouse.y >= sb.y && mouse.y <= sb.y + sb.h) {
      startGame();
    }
  } else if (state === 'GAME_OVER' || state === 'VICTORY') {
    resetToWeaponSelect();
  }
}

// =====================================================================
// プレイヤー
// =====================================================================
class Player {
  constructor(weapon) {
    this.x = CENTER.x;
    this.y = CENTER.y + 200;
    this.r = PLAYER_R;
    this.weapon = weapon;
    this.facing = { x: 0, y: -1 };
    this.alive = true;
    this.lives = 3;
    this.invuln = 1.2;

    // 共通アニメーション
    this.swordSlash = 0;
    this.hammerSwing = 0;
    this.bobTimer = 0;

    // 剣
    this.swordCharge = 0;

    // 盾
    this.blocking = false;
    this.shieldThrown = false;
    this.shieldProj = null;

    // ハンマー
    this.hammerWindup = 0;     // 通常攻撃の溜め
    this.hammerSpinning = false;
    this.hammerSpinAngle = 0;
    this.spinHitCooldown = 0;  // ボスへの連続ヒット間隔
  }

  update(dt) {
    if (this.invuln > 0) this.invuln -= dt;
    if (this.swordSlash > 0) this.swordSlash -= dt;
    if (this.hammerSwing > 0) this.hammerSwing -= dt;
    this.bobTimer += dt;

    // 移動方向
    let dx = 0, dy = 0;
    if (keys['ArrowLeft']) dx -= 1;
    if (keys['ArrowRight']) dx += 1;
    if (keys['ArrowUp']) dy -= 1;
    if (keys['ArrowDown']) dy += 1;
    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      dx /= len; dy /= len;
      this.facing = { x: dx, y: dy };
      let speed = PLAYER_SPEED;
      if (this.blocking) speed *= 0.55;
      if (this.swordCharge > 0) speed *= 0.7;
      if (this.hammerWindup > 0) speed *= 0.2;
      if (this.hammerSpinning) speed *= 0.95;
      this.x += dx * speed;
      this.y += dy * speed;
    }
    // 円形アリーナで制限
    const ddx = this.x - CENTER.x, ddy = this.y - CENTER.y;
    const d = Math.hypot(ddx, ddy);
    const maxR = ARENA_R - this.r;
    if (d > maxR) {
      this.x = CENTER.x + ddx / d * maxR;
      this.y = CENTER.y + ddy / d * maxR;
    }

    // 武器ごとの処理
    this.updateWeapon(dt);
  }

  updateWeapon(dt) {
    if (this.weapon === 'sword') {
      if (spaceDown) this.swordCharge = Math.min(2.0, this.swordCharge + dt);
    } else if (this.weapon === 'shield') {
      this.blocking = spaceDown && !this.shieldThrown;
    } else if (this.weapon === 'hammer') {
      if (this.hammerWindup > 0) {
        this.hammerWindup -= dt;
        if (this.hammerWindup <= 0) this.executeHammerAOE();
      }
      // 長押しで回転モードへ
      if (spaceDown && spaceHeldDuration >= 0.4 &&
          !this.hammerSpinning && this.hammerWindup <= 0) {
        this.hammerSpinning = true;
      }
      if (!spaceDown && this.hammerSpinning) this.hammerSpinning = false;

      if (this.hammerSpinning) {
        this.hammerSpinAngle += dt * 14;
        this.spinHitCooldown -= dt;
        // ボスへの連続ヒット判定
        if (this.spinHitCooldown <= 0 && boss) {
          const d = Math.hypot(boss.x - this.x, boss.y - this.y);
          if (d <= 55 + boss.r) {
            boss.takeDamage(2);
            this.spinHitCooldown = 0.3;
          }
        }
      }
    }
  }

  onSpacePress() {
    // 何もしない。実行はリリース時。
  }

  onSpaceRelease(heldFor) {
    if (!this.alive) return;
    if (this.weapon === 'sword') {
      if (heldFor >= 2.0) {
        projectiles.push(new SwordSlash(this.x, this.y, this.facing));
      } else {
        this.swordSlash = 0.22;
        this.checkSwordHit();
      }
      this.swordCharge = 0;
    } else if (this.weapon === 'shield') {
      if (heldFor >= 0.7 && !this.shieldThrown) {
        const proj = new ShieldThrown(this.x, this.y, this.facing, this);
        this.shieldThrown = true;
        this.shieldProj = proj;
        projectiles.push(proj);
      }
    } else if (this.weapon === 'hammer') {
      if (this.hammerSpinning) {
        this.hammerSpinning = false;
      } else if (this.hammerWindup <= 0) {
        this.hammerWindup = 1.0;
      }
    }
  }

  checkSwordHit() {
    if (!boss) return;
    const dx = boss.x - this.x, dy = boss.y - this.y;
    const d = Math.hypot(dx, dy);
    const range = 46;
    if (d > range + boss.r) return;
    const dot = (dx * this.facing.x + dy * this.facing.y) / Math.max(d, 0.0001);
    if (dot > 0.2) {
      boss.takeDamage(3);
      effects.push({ type: 'spark', x: boss.x, y: boss.y, life: 0.3 });
    }
  }

  executeHammerAOE() {
    this.hammerSwing = 0.3;
    const range = 75;
    if (boss && Math.hypot(boss.x - this.x, boss.y - this.y) <= range + boss.r) {
      boss.takeDamage(5);
    }
    effects.push({ type: 'aoe', x: this.x, y: this.y, r: range, life: 0.35, maxLife: 0.35 });
  }

  hit() {
    if (this.invuln > 0 || !this.alive) return false;
    this.lives--;
    if (this.lives <= 0) {
      this.alive = false;
      effects.push({ type: 'death', x: this.x, y: this.y, life: 1.0, maxLife: 1.0 });
      return true;
    }
    // 残機が残っていればしばらく無敵
    this.invuln = 2.0;
    effects.push({ type: 'damage', x: this.x, y: this.y, life: 0.6, maxLife: 0.6 });
    return true;
  }
}

// =====================================================================
// 飛び道具
// =====================================================================
class SwordSlash {
  constructor(x, y, dir) {
    this.x = x; this.y = y;
    this.vx = dir.x * 7; this.vy = dir.y * 7;
    this.angle = Math.atan2(dir.y, dir.x);
    this.r = 18;
    this.life = 2.0;
    this.alive = true;
    this.owner = 'player';
    this.damage = 4;
  }
  update(dt) {
    this.x += this.vx; this.y += this.vy;
    this.life -= dt;
    if (this.life <= 0) this.alive = false;
    const d = Math.hypot(this.x - CENTER.x, this.y - CENTER.y);
    if (d > ARENA_R - 5) this.alive = false;
    if (boss && Math.hypot(boss.x - this.x, boss.y - this.y) < this.r + boss.r) {
      boss.takeDamage(this.damage);
      this.alive = false;
      effects.push({ type: 'spark', x: this.x, y: this.y, life: 0.3 });
    }
  }
  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.fillStyle = '#7ec0ff';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.ellipse(0, 0, 24, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(0, 0, 14, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

class ShieldThrown {
  constructor(x, y, dir, owner) {
    this.x = x; this.y = y;
    this.vx = dir.x * 6; this.vy = dir.y * 6;
    this.angle = 0;
    this.r = 16;
    this.life = 3.0;
    this.alive = true;
    this.owner = 'player';
    this.ownerRef = owner;
    this.returning = false;
    this.damage = 5;
    this.hitTargets = new Set();
  }
  update(dt) {
    this.angle += dt * 18;
    this.life -= dt;
    if (this.life <= 0) this.alive = false;

    // アリーナの外に出たら戻る
    const cd = Math.hypot(this.x - CENTER.x, this.y - CENTER.y);
    if (cd > ARENA_R - 10) this.returning = true;

    if (this.returning && this.ownerRef && this.ownerRef.alive) {
      const dx = this.ownerRef.x - this.x;
      const dy = this.ownerRef.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d < 18) {
        // 戻った
        this.ownerRef.shieldThrown = false;
        this.ownerRef.shieldProj = null;
        this.alive = false;
      } else {
        this.vx = dx / d * 7;
        this.vy = dy / d * 7;
      }
    }
    this.x += this.vx; this.y += this.vy;

    if (boss && Math.hypot(boss.x - this.x, boss.y - this.y) < this.r + boss.r) {
      if (!this.hitTargets.has('boss')) {
        boss.takeDamage(this.damage);
        this.hitTargets.add('boss');
        this.returning = true;
        effects.push({ type: 'spark', x: this.x, y: this.y, life: 0.3 });
      }
    }
  }
  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    drawShield(ctx, 0, 0, 18);
    ctx.restore();
  }
}

class Arrow {
  constructor(x, y, dir) {
    this.x = x; this.y = y;
    this.vx = dir.x * 6; this.vy = dir.y * 6;
    this.angle = Math.atan2(dir.y, dir.x);
    this.r = 5;
    this.alive = true;
    this.owner = 'boss';
    this.life = 5.0;
    this.damage = 1;
    this.reflected = false;
  }
  update(dt) {
    this.x += this.vx; this.y += this.vy;
    this.life -= dt;
    if (this.life <= 0) this.alive = false;
    // 壁
    const cd = Math.hypot(this.x - CENTER.x, this.y - CENTER.y);
    if (cd > ARENA_R - 4) this.alive = false;

    if (!this.reflected && player.alive) {
      // 盾構えで反射
      if (player.blocking) {
        const dx = this.x - player.x, dy = this.y - player.y;
        const d = Math.hypot(dx, dy);
        if (d < player.r + 22) {
          // 矢が盾の正面側にあるとき反射
          const dot = (dx * player.facing.x + dy * player.facing.y) / Math.max(d, 0.0001);
          if (dot > 0.2) {
            // 反射してボスへ
            const nx = player.facing.x, ny = player.facing.y;
            this.vx = nx * 7;
            this.vy = ny * 7;
            this.angle = Math.atan2(ny, nx);
            this.owner = 'player';
            this.reflected = true;
            this.damage = 2;
            effects.push({ type: 'spark', x: this.x, y: this.y, life: 0.3 });
            return;
          }
        }
      }
      if (Math.hypot(this.x - player.x, this.y - player.y) < this.r + player.r) {
        if (player.hit()) this.alive = false;
      }
    } else if (this.reflected) {
      if (boss && Math.hypot(this.x - boss.x, this.y - boss.y) < this.r + boss.r) {
        boss.takeDamage(this.damage);
        this.alive = false;
        effects.push({ type: 'spark', x: this.x, y: this.y, life: 0.3 });
      }
    }
  }
  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.strokeStyle = this.reflected ? '#7ec0ff' : '#5a3a2a';
    ctx.fillStyle = this.reflected ? '#7ec0ff' : '#3a2818';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-12, 0);
    ctx.lineTo(8, 0);
    ctx.stroke();
    // 矢じり
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(2, -3);
    ctx.lineTo(2, 3);
    ctx.closePath();
    ctx.fill();
    // 羽
    ctx.beginPath();
    ctx.moveTo(-12, 0);
    ctx.lineTo(-18, -4);
    ctx.lineTo(-15, 0);
    ctx.lineTo(-18, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// ボス1の斬撃飛び道具
class BossSlash {
  constructor(x, y, dir) {
    this.x = x; this.y = y;
    this.vx = dir.x * 5.5; this.vy = dir.y * 5.5;
    this.angle = Math.atan2(dir.y, dir.x);
    this.r = 20;
    this.life = 3.0;
    this.alive = true;
    this.owner = 'boss';
  }
  update(dt) {
    this.x += this.vx; this.y += this.vy;
    this.life -= dt;
    if (this.life <= 0) this.alive = false;
    const cd = Math.hypot(this.x - CENTER.x, this.y - CENTER.y);
    if (cd > ARENA_R - 5) this.alive = false;
    if (player.alive && Math.hypot(this.x - player.x, this.y - player.y) < this.r + player.r) {
      if (player.hit()) this.alive = false;
    }
  }
  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.fillStyle = '#ff6060';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.ellipse(0, 0, 28, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(0, 0, 18, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ボス2の溜め撃ち大矢
class BigArrow {
  constructor(x, y, dir) {
    this.x = x; this.y = y;
    this.vx = dir.x * 7.5; this.vy = dir.y * 7.5;
    this.angle = Math.atan2(dir.y, dir.x);
    this.r = 10;
    this.alive = true;
    this.owner = 'boss';
    this.life = 4.0;
    this.damage = 1;
    this.reflected = false;
    this.trail = [];
  }
  update(dt) {
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 8) this.trail.shift();
    this.x += this.vx; this.y += this.vy;
    this.life -= dt;
    if (this.life <= 0) this.alive = false;
    const cd = Math.hypot(this.x - CENTER.x, this.y - CENTER.y);
    if (cd > ARENA_R - 4) this.alive = false;

    if (!this.reflected && player.alive) {
      // 盾で反射
      if (player.blocking) {
        const dx = this.x - player.x, dy = this.y - player.y;
        const d = Math.hypot(dx, dy);
        if (d < player.r + 24) {
          const dot = (dx * player.facing.x + dy * player.facing.y) / Math.max(d, 0.0001);
          if (dot > 0.2) {
            this.vx = player.facing.x * 9;
            this.vy = player.facing.y * 9;
            this.angle = Math.atan2(this.vy, this.vx);
            this.owner = 'player';
            this.reflected = true;
            this.damage = 4;
            effects.push({ type: 'spark', x: this.x, y: this.y, life: 0.3 });
            return;
          }
        }
      }
      if (Math.hypot(this.x - player.x, this.y - player.y) < this.r + player.r) {
        if (player.hit()) this.alive = false;
      }
    } else if (this.reflected) {
      if (boss && Math.hypot(this.x - boss.x, this.y - boss.y) < this.r + boss.r) {
        boss.takeDamage(this.damage);
        this.alive = false;
        effects.push({ type: 'spark', x: this.x, y: this.y, life: 0.3 });
      }
    }
  }
  draw(ctx) {
    // 軌跡
    for (let i = 0; i < this.trail.length; i++) {
      const t = i / this.trail.length;
      ctx.fillStyle = `rgba(255, 200, 80, ${t * 0.4})`;
      ctx.beginPath();
      ctx.arc(this.trail[i].x, this.trail[i].y, this.r * t, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.fillStyle = this.reflected ? '#7ec0ff' : '#ff8030';
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-18, 0);
    ctx.lineTo(12, 0);
    ctx.stroke();
    // 矢じり
    ctx.beginPath();
    ctx.moveTo(20, 0);
    ctx.lineTo(8, -7);
    ctx.lineTo(8, 7);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // 羽
    ctx.beginPath();
    ctx.moveTo(-18, 0);
    ctx.lineTo(-26, -6);
    ctx.lineTo(-22, 0);
    ctx.lineTo(-26, 6);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}

// =====================================================================
// ボス基底
// =====================================================================
class Boss {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.hp = BOSS_MAX_HP;
    this.r = 28;
    this.hitFlash = 0;
    this.alive = true;
    this.attackTimer = 2.5; // 最初の攻撃まで
    this.angle = 0;
  }
  takeDamage(amount) {
    if (!this.alive) return;
    this.hp -= amount;
    this.hitFlash = 0.18;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      effects.push({ type: 'bossDeath', x: this.x, y: this.y, life: 1.5, maxLife: 1.5 });
    }
  }
  baseDraw(drawBody) {
    ctx.save();
    if (this.hitFlash > 0) {
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 20;
    }
    drawBody.call(this);
    ctx.restore();
  }
}

// ---- ボス1: 剣 -----------------------------------------------------
class SwordBoss extends Boss {
  constructor() {
    super(CENTER.x, CENTER.y - 100);
    this.r = 26;
    this.mode = 'idle'; // idle | telegraph | flying
    this.modeTimer = 2.0;
    this.bounces = 0;
    this.maxBounces = 3;
    this.vx = 0; this.vy = 0;
    this.angle = 0;
    this.spinSpeed = 0;
  }
  update(dt) {
    if (!this.alive) return;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    this.modeTimer -= dt;

    if (this.mode === 'idle') {
      this.angle += dt * 1.2;
      if (this.modeTimer <= 0) {
        // 次の攻撃を選ぶ（飛行か斬撃）
        const choice = Math.random() < 0.5 ? 'fly' : 'slash';
        this.mode = (choice === 'fly') ? 'telegraphFly' : 'telegraphSlash';
        this.modeTimer = 0.7;
      }
    } else if (this.mode === 'telegraphFly') {
      this.angle += dt * 3;
      if (this.modeTimer <= 0) {
        const dx = player.x - this.x, dy = player.y - this.y;
        const d = Math.hypot(dx, dy) || 1;
        this.vx = dx / d * 6.5;
        this.vy = dy / d * 6.5;
        this.mode = 'flying';
        this.bounces = 0;
        this.modeTimer = 5.0;
        this.spinSpeed = 18;
      }
    } else if (this.mode === 'telegraphSlash') {
      this.angle += dt * 3;
      if (this.modeTimer <= 0) {
        const dx = player.x - this.x, dy = player.y - this.y;
        const d = Math.hypot(dx, dy) || 1;
        projectiles.push(new BossSlash(this.x, this.y, { x: dx / d, y: dy / d }));
        this.mode = 'slashRecover';
        this.modeTimer = 0.8;
      }
    } else if (this.mode === 'slashRecover') {
      this.angle += dt * 0.6;
      if (this.modeTimer <= 0) {
        this.mode = 'idle';
        this.modeTimer = 2.0;
      }
    } else if (this.mode === 'flying') {
      this.angle += dt * this.spinSpeed;
      this.x += this.vx;
      this.y += this.vy;
      const ddx = this.x - CENTER.x, ddy = this.y - CENTER.y;
      const d = Math.hypot(ddx, ddy);
      if (d > ARENA_R - this.r) {
        const nx = ddx / d, ny = ddy / d;
        this.x = CENTER.x + nx * (ARENA_R - this.r);
        this.y = CENTER.y + ny * (ARENA_R - this.r);
        const dot = this.vx * nx + this.vy * ny;
        this.vx -= 2 * dot * nx;
        this.vy -= 2 * dot * ny;
        this.bounces++;
        if (this.bounces >= this.maxBounces) {
          this.mode = 'cooldown';
          this.modeTimer = 10.0;
          this.vx = 0; this.vy = 0;
        }
      }
      if (this.mode === 'flying' && this.modeTimer <= 0) {
        this.mode = 'cooldown';
        this.modeTimer = 10.0;
        this.vx = 0; this.vy = 0;
      }
      if (this.mode === 'flying' &&
          player.alive && Math.hypot(player.x - this.x, player.y - this.y) < this.r + player.r) {
        player.hit();
      }
    } else if (this.mode === 'cooldown') {
      // 飛行攻撃後はぐったり
      this.angle += dt * 0.3;
      if (this.modeTimer <= 0) {
        this.mode = 'idle';
        this.modeTimer = 2.0;
      }
    }
  }
  isAttacking() { return this.mode === 'flying'; }
  draw(ctx) {
    this.baseDraw(function() {
      ctx.translate(this.x, this.y);
      ctx.rotate(this.angle);
      // 構え中は刃の色がチカチカ
      let bladeColor = '#eaeaf0';
      if ((this.mode === 'telegraphFly' || this.mode === 'telegraphSlash') &&
          Math.floor(this.modeTimer * 20) % 2 === 0) {
        bladeColor = (this.mode === 'telegraphSlash') ? '#ff8080' : '#ffcc66';
      } else if (this.mode === 'cooldown') {
        bladeColor = '#8a8a90';
      }
      // 剣身（顔つき）
      const bladeLen = 60, bladeW = 28;
      ctx.fillStyle = bladeColor;
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-bladeW / 2, 18);
      ctx.lineTo(bladeW / 2, 18);
      ctx.lineTo(bladeW / 2, -bladeLen + 9);
      ctx.lineTo(0, -bladeLen);
      ctx.lineTo(-bladeW / 2, -bladeLen + 9);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      // 鍔
      ctx.fillStyle = '#3a2818';
      ctx.fillRect(-26, 18, 52, 8);
      ctx.strokeRect(-26, 18, 52, 8);
      // 柄
      ctx.fillStyle = '#7a4f20';
      ctx.fillRect(-5, 26, 10, 14);
      ctx.strokeRect(-5, 26, 10, 14);
      // 柄頭
      ctx.fillStyle = '#d4a040';
      ctx.beginPath();
      ctx.arc(0, 42, 4, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      // 顔（刃の上に）
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(-8, -30, 5, 7);
      ctx.fillRect(3, -30, 5, 7);
      // ジグザグの歯
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 2;
      drawZigzagMouth(ctx, -9, -15, 18, 5, 5);
    });
  }
}

// ---- ボス2: 弓 -----------------------------------------------------
class BowBoss extends Boss {
  constructor() {
    super(CENTER.x, CENTER.y - 100);
    this.r = 28;
    this.mode = 'idle'; // idle | aiming | shooting
    this.modeTimer = 2.0;
    this.shotsLeft = 0;
    this.shotCooldown = 0;
    this.aimAngle = 0;
    this.moveTimer = 0;
    this.moveDir = { x: 0, y: 0 };
  }
  update(dt) {
    if (!this.alive) return;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    this.modeTimer -= dt;

    // 動き: 溜め中とスタン中以外は動ける（射撃中も逃げる）
    const canMove = (this.mode !== 'charging' && this.mode !== 'stunned');
    if (canMove) {
      const dxp = player.x - this.x, dyp = player.y - this.y;
      const distToPlayer = Math.hypot(dxp, dyp);
      const FLEE_DIST = 220;
      let speed;
      if (distToPlayer < FLEE_DIST && distToPlayer > 0.01) {
        // 逃げる
        this.moveDir = { x: -dxp / distToPlayer, y: -dyp / distToPlayer };
        this.moveTimer = 0.3;
        speed = 2.8;
      } else {
        this.moveTimer -= dt;
        if (this.moveTimer <= 0) {
          const a = Math.random() * Math.PI * 2;
          this.moveDir = { x: Math.cos(a), y: Math.sin(a) };
          this.moveTimer = 1.0 + Math.random();
        }
        speed = 1.2;
      }
      this.x += this.moveDir.x * speed;
      this.y += this.moveDir.y * speed;
      const ddx = this.x - CENTER.x, ddy = this.y - CENTER.y;
      const d = Math.hypot(ddx, ddy);
      if (d > ARENA_R - this.r - 30) {
        this.x = CENTER.x + ddx / d * (ARENA_R - this.r - 30);
        this.y = CENTER.y + ddy / d * (ARENA_R - this.r - 30);
        // 壁にぶつかったら逃げる方向を変える
        if (distToPlayer < FLEE_DIST) {
          const tangent = { x: -ddy / d, y: ddx / d };
          this.moveDir = tangent;
        } else {
          this.moveTimer = 0;
        }
      }
    }

    if (this.mode === 'idle') {
      if (this.modeTimer <= 0) {
        // 30%の確率で溜め撃ち
        if (Math.random() < 0.3) {
          this.mode = 'charging';
          this.modeTimer = 1.8;
        } else {
          this.mode = 'aiming';
          this.modeTimer = 0.6;
          this.shotsLeft = 3;
        }
      }
    } else if (this.mode === 'aiming') {
      const dx = player.x - this.x, dy = player.y - this.y;
      this.aimAngle = Math.atan2(dy, dx);
      if (this.modeTimer <= 0) {
        this.mode = 'shooting';
        this.shotCooldown = 0;
      }
    } else if (this.mode === 'shooting') {
      this.shotCooldown -= dt;
      const dx = player.x - this.x, dy = player.y - this.y;
      this.aimAngle = Math.atan2(dy, dx);
      if (this.shotCooldown <= 0 && this.shotsLeft > 0) {
        const d = Math.hypot(dx, dy) || 1;
        projectiles.push(new Arrow(this.x + dx / d * 32, this.y + dy / d * 32, { x: dx / d, y: dy / d }));
        this.shotsLeft--;
        this.shotCooldown = 0.35;
      }
      if (this.shotsLeft <= 0 && this.shotCooldown <= -0.2) {
        this.mode = 'idle';
        this.modeTimer = 2.0;
      }
    } else if (this.mode === 'charging') {
      const dx = player.x - this.x, dy = player.y - this.y;
      this.aimAngle = Math.atan2(dy, dx);
      if (this.modeTimer <= 0) {
        // 大矢発射
        const d = Math.hypot(dx, dy) || 1;
        projectiles.push(new BigArrow(this.x + dx / d * 36, this.y + dy / d * 36, { x: dx / d, y: dy / d }));
        this.mode = 'stunned';
        this.modeTimer = 5.0;
      }
    } else if (this.mode === 'stunned') {
      if (this.modeTimer <= 0) {
        this.mode = 'idle';
        this.modeTimer = 2.0;
      }
    }
  }
  draw(ctx) {
    this.baseDraw(function() {
      ctx.translate(this.x, this.y);
      const aim = this.aimAngle;
      // 溜め攻撃中はオーラ
      if (this.mode === 'charging') {
        const t = 1 - this.modeTimer / 1.8;
        ctx.save();
        ctx.fillStyle = `rgba(255, 140, 60, ${0.25 + 0.25 * Math.sin(this.modeTimer * 12)})`;
        ctx.beginPath();
        ctx.arc(0, 0, 40 + t * 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      // スタン中は dim & ぐったり
      ctx.save();
      if (this.mode === 'stunned') ctx.globalAlpha = 0.55;
      ctx.rotate(aim);
      // 弓本体（後ろ側にカーブ）
      ctx.strokeStyle = '#7a4f20';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(-18, 0, 26, -Math.PI * 0.55, Math.PI * 0.55);
      ctx.stroke();
      ctx.lineCap = 'butt';
      // 弦
      ctx.strokeStyle = '#fdf5e1';
      ctx.lineWidth = 1.5;
      const sx = -18 + Math.cos(-Math.PI * 0.55) * 26;
      const sy = Math.sin(-Math.PI * 0.55) * 26;
      const pull = (this.mode === 'aiming' || this.mode === 'charging') ? -14 - (this.mode === 'charging' ? 10 : 0) : -22;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(pull, 0);
      ctx.lineTo(sx, -sy);
      ctx.stroke();
      // 矢の柄
      ctx.strokeStyle = '#7a4f20';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-32, 0);
      ctx.lineTo(16, 0);
      ctx.stroke();
      // 矢羽
      ctx.fillStyle = '#fdf5e1';
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-30, 0);
      ctx.lineTo(-38, -5);
      ctx.lineTo(-32, 0);
      ctx.lineTo(-38, 5);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      // 矢じり（顔つき）
      ctx.fillStyle = '#d4d4dc';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(16, -11);
      ctx.lineTo(34, 0);
      ctx.lineTo(16, 11);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      // 顔
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(19, -5, 2.5, 3.5);
      ctx.fillRect(24, -5, 2.5, 3.5);
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1.2;
      drawZigzagMouth(ctx, 19, 2, 9, 3, 3);
      ctx.restore();
      // 構え予告
      if (this.mode === 'aiming' || this.mode === 'shooting') {
        ctx.strokeStyle = 'rgba(255, 60, 60, 0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(Math.cos(aim) * 36, Math.sin(aim) * 36);
        ctx.lineTo(Math.cos(aim) * 500, Math.sin(aim) * 500);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });
  }
}

// ---- ボス3: ハンマー ------------------------------------------------
class HammerBoss extends Boss {
  constructor() {
    super(CENTER.x, CENTER.y - 100);
    this.r = 32;
    this.mode = 'idle';
    this.modeTimer = 2.5;
    this.rageTimer = 0;
    this.angle = 0;
    this.vx = 0; this.vy = 0;
    this.slamTarget = null;
    this.jumpHeight = 0; // 叩きつけ用のジャンプ表現
  }
  update(dt) {
    if (!this.alive) return;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    this.modeTimer -= dt;

    if (this.mode === 'idle') {
      this.angle += dt * 0.8;
      if (this.modeTimer <= 0) {
        // 回転追跡 or 叩きつけ をランダム選択
        if (Math.random() < 0.5) {
          this.mode = 'telegraphRage';
          this.modeTimer = 1.0;
        } else {
          this.mode = 'telegraphSlam';
          this.modeTimer = 1.2;
        }
      }
    } else if (this.mode === 'telegraphRage') {
      this.angle += dt * 4;
      if (this.modeTimer <= 0) {
        this.mode = 'rage';
        this.rageTimer = 10.0; // 20 → 10
      }
    } else if (this.mode === 'rage') {
      this.angle += dt * 16;
      this.rageTimer -= dt;
      const dx = player.x - this.x, dy = player.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      const target = { x: dx / d * 3.0, y: dy / d * 3.0 };
      this.vx += (target.x - this.vx) * 0.06;
      this.vy += (target.y - this.vy) * 0.06;
      this.x += this.vx;
      this.y += this.vy;
      const ddx = this.x - CENTER.x, ddy = this.y - CENTER.y;
      const dd = Math.hypot(ddx, ddy);
      if (dd > ARENA_R - this.r) {
        this.x = CENTER.x + ddx / dd * (ARENA_R - this.r);
        this.y = CENTER.y + ddy / dd * (ARENA_R - this.r);
      }
      if (this.mode === 'rage' &&
          player.alive && Math.hypot(player.x - this.x, player.y - this.y) < this.r + player.r) {
        player.hit();
      }
      if (this.rageTimer <= 0) {
        this.mode = 'cooldown';
        this.modeTimer = 10.0; // 3 → 10
        this.vx = 0; this.vy = 0;
      }
    } else if (this.mode === 'telegraphSlam') {
      this.angle += dt * 2;
      if (this.modeTimer <= 0) {
        // プレイヤー位置をロックして放物線で飛ぶ
        this.slamStart = { x: this.x, y: this.y };
        this.slamTarget = { x: player.x, y: player.y };
        this.mode = 'slamJump';
        this.modeTimer = 0.9;
        this.jumpHeight = 0;
      }
    } else if (this.mode === 'slamJump') {
      this.angle += dt * 6;
      const t = 1 - this.modeTimer / 0.9;
      // 放物線で移動
      this.x = this.slamStart.x + (this.slamTarget.x - this.slamStart.x) * t;
      this.y = this.slamStart.y + (this.slamTarget.y - this.slamStart.y) * t;
      this.jumpHeight = Math.sin(t * Math.PI) * 80;
      if (this.modeTimer <= 0) {
        this.x = this.slamTarget.x;
        this.y = this.slamTarget.y;
        this.jumpHeight = 0;
        if (player.alive && Math.hypot(player.x - this.x, player.y - this.y) < 75) {
          player.hit();
        }
        effects.push({ type: 'aoe', x: this.x, y: this.y, r: 75, life: 0.5, maxLife: 0.5 });
        this.mode = 'slamRecover';
        this.modeTimer = 2.0;
      }
    } else if (this.mode === 'slamRecover') {
      this.angle += dt * 0.3;
      if (this.modeTimer <= 0) {
        this.mode = 'idle';
        this.modeTimer = 2.0;
      }
    } else if (this.mode === 'cooldown') {
      this.angle += dt * 0.3;
      if (this.modeTimer <= 0) {
        this.mode = 'idle';
        this.modeTimer = 2.0;
      }
    }
  }
  isAttacking() { return this.mode === 'rage'; }
  draw(ctx) {
    this.baseDraw(function() {
      // 叩きつけ予告: 地面に着弾マーカー
      if (this.mode === 'slamJump' && this.slamTarget) {
        ctx.save();
        ctx.translate(this.slamTarget.x, this.slamTarget.y);
        const t = 1 - this.modeTimer / 0.9;
        ctx.strokeStyle = `rgba(220, 60, 60, ${0.6 + 0.4 * Math.sin(t * 30)})`;
        ctx.fillStyle = `rgba(220, 60, 60, 0.18)`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 75, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        // 十字
        ctx.beginPath();
        ctx.moveTo(-75, 0); ctx.lineTo(75, 0);
        ctx.moveTo(0, -75); ctx.lineTo(0, 75);
        ctx.stroke();
        ctx.restore();
      }
      // 本体（ジャンプ中は高さに応じてオフセット）
      ctx.translate(this.x, this.y - (this.jumpHeight || 0));
      // ジャンプ中の影
      if (this.jumpHeight > 0) {
        ctx.save();
        ctx.fillStyle = `rgba(0,0,0,${0.3 - this.jumpHeight / 300})`;
        ctx.beginPath();
        ctx.ellipse(0, this.jumpHeight, 30 - this.jumpHeight * 0.15, 8 - this.jumpHeight * 0.04, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.rotate(this.angle);
      let headColor = '#bcbcc4';
      const isTelegraph = (this.mode === 'telegraphRage' || this.mode === 'telegraphSlam');
      if (isTelegraph) {
        const baseColor = (this.mode === 'telegraphSlam') ? '#ff5050' : '#ff8060';
        headColor = (Math.floor(this.modeTimer * 20) % 2 === 0) ? baseColor : '#bcbcc4';
      }
      if (this.mode === 'rage' || this.mode === 'slamJump') headColor = '#d83030';
      if (this.mode === 'cooldown' || this.mode === 'slamRecover') headColor = '#8a8a90';
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 2.4;
      // 柄（下に垂れる）
      ctx.fillStyle = '#7a4f20';
      ctx.fillRect(-4, 4, 8, 34);
      ctx.strokeRect(-4, 4, 8, 34);
      // 頭部（横長）
      const hw = 56, hh = 30;
      ctx.fillStyle = headColor;
      ctx.fillRect(-hw / 2, -hh / 2 - 5, hw, hh);
      ctx.strokeRect(-hw / 2, -hh / 2 - 5, hw, hh);
      // 両端の出っ張り
      ctx.fillStyle = '#5a5a64';
      ctx.fillRect(-hw / 2 - 6, -hh / 2 - 2, 7, hh - 6);
      ctx.strokeRect(-hw / 2 - 6, -hh / 2 - 2, 7, hh - 6);
      ctx.fillRect(hw / 2 - 1, -hh / 2 - 2, 7, hh - 6);
      ctx.strokeRect(hw / 2 - 1, -hh / 2 - 2, 7, hh - 6);
      // 目（怒り）
      ctx.fillStyle = '#1a1a1a';
      ctx.save();
      ctx.translate(-9, -14);
      ctx.beginPath();
      ctx.moveTo(-4, -2); ctx.lineTo(5, 2); ctx.lineTo(5, 5); ctx.lineTo(-4, 5);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.translate(9, -14);
      ctx.beginPath();
      ctx.moveTo(4, -2); ctx.lineTo(-5, 2); ctx.lineTo(-5, 5); ctx.lineTo(4, 5);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      // ジグザグの歯
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 2;
      drawZigzagMouth(ctx, -14, -1, 28, 6, 5);
    });
  }
}

// =====================================================================
// 描画ヘルパー
// =====================================================================
// 共通: ジグザグの歯
function drawZigzagMouth(ctx, leftX, y, w, teeth, h) {
  ctx.beginPath();
  for (let i = 0; i <= teeth; i++) {
    const px = leftX + (i / teeth) * w;
    const py = y + (i % 2 === 0 ? 0 : h);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

function drawShield(ctx, x, y, size) {
  // 上が平らで下が丸い、スタッド付きの盾
  ctx.save();
  ctx.translate(x, y);
  const w = size * 0.95, h = size * 1.1;
  ctx.fillStyle = '#dbc287';
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(-w, -h * 0.75);
  ctx.lineTo(w, -h * 0.75);
  ctx.lineTo(w, h * 0.15);
  ctx.quadraticCurveTo(w * 0.95, h * 0.95, 0, h);
  ctx.quadraticCurveTo(-w * 0.95, h * 0.95, -w, h * 0.15);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // スタッド
  ctx.fillStyle = '#3a2818';
  const studs = [
    [-w * 0.65, -h * 0.55], [0, -h * 0.6], [w * 0.65, -h * 0.55],
    [-w * 0.75, -h * 0.05], [w * 0.75, -h * 0.05],
    [-w * 0.45, h * 0.55], [w * 0.45, h * 0.55],
  ];
  for (const [sx, sy] of studs) {
    ctx.beginPath();
    ctx.arc(sx, sy, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawSword(ctx, x, y, size) {
  // (x, y)を持ち手の位置として刃が上を向く
  ctx.save();
  ctx.translate(x, y);
  const bw = 5.5;
  // 刃
  ctx.fillStyle = '#eaeaf0';
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(-bw, 0);
  ctx.lineTo(bw, 0);
  ctx.lineTo(bw, -size + 7);
  ctx.lineTo(0, -size);
  ctx.lineTo(-bw, -size + 7);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // 鍔
  ctx.fillStyle = '#3a2818';
  ctx.fillRect(-13, -1, 26, 5);
  ctx.strokeRect(-13, -1, 26, 5);
  // 柄
  ctx.fillStyle = '#7a4f20';
  ctx.fillRect(-3, 4, 6, 12);
  ctx.strokeRect(-3, 4, 6, 12);
  // 柄頭
  ctx.fillStyle = '#d4a040';
  ctx.beginPath();
  ctx.arc(0, 18, 3, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

function drawHammer(ctx, x, y, size) {
  // (x, y)を持ち手の位置として頭部が上、柄が下
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#7a4f20';
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 1.8;
  // 柄（持ち手から頭の中央まで）
  ctx.fillRect(-3, -size + 6, 6, size);
  ctx.strokeRect(-3, -size + 6, 6, size);
  // 頭部
  const hw = size * 0.75, hh = size * 0.5;
  ctx.fillStyle = '#bcbcc4';
  ctx.fillRect(-hw, -size - hh * 0.4, hw * 2, hh);
  ctx.strokeRect(-hw, -size - hh * 0.4, hw * 2, hh);
  // 両端の出っ張り
  ctx.fillStyle = '#666';
  ctx.fillRect(-hw - 4, -size - hh * 0.4 + 1, 5, hh - 2);
  ctx.strokeRect(-hw - 4, -size - hh * 0.4 + 1, 5, hh - 2);
  ctx.fillRect(hw - 1, -size - hh * 0.4 + 1, 5, hh - 2);
  ctx.strokeRect(hw - 1, -size - hh * 0.4 + 1, 5, hh - 2);
  ctx.restore();
}

function drawHeldWeapon(ctx, weapon, fx, fy, options) {
  const ang = Math.atan2(fy, fx);
  ctx.save();
  if (weapon === 'sword') {
    ctx.rotate(ang + Math.PI / 2);
    let yOff = -18;
    if (options.swordSlashing) yOff = -24;
    drawSword(ctx, 0, yOff, 20);
  } else if (weapon === 'shield' && !options.shieldGone) {
    ctx.rotate(ang + Math.PI / 2);
    drawShield(ctx, 0, -18, options.blocking ? 17 : 13);
  } else if (weapon === 'hammer') {
    ctx.rotate(ang + Math.PI / 2 + (options.hammerSwing || 0));
    drawHammer(ctx, 0, -14, 20);
  }
  ctx.restore();
}

function drawHero(ctx, x, y, weapon, facing, bobOffset, options = {}) {
  ctx.save();
  ctx.translate(x, y + (bobOffset || 0));

  const fx = facing ? facing.x : 0;
  const fy = facing ? facing.y : -1;
  const facingUp = fy < -0.4;

  // ハンマー回転モード
  if (weapon === 'hammer' && options.spinning) {
    ctx.save();
    ctx.rotate(options.spinAngle || 0);
    drawHammer(ctx, 0, -28, 20);
    ctx.restore();
  }

  // 上向きのとき武器を体の後ろに
  if (facingUp && !(weapon === 'hammer' && options.spinning)) {
    drawHeldWeapon(ctx, weapon, fx, fy, options);
  }

  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 2;

  // 足（人形の短い脚）
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(-9, 11, 7, 9);
  ctx.strokeRect(-9, 11, 7, 9);
  ctx.fillRect(2, 11, 7, 9);
  ctx.strokeRect(2, 11, 7, 9);
  // 靴
  ctx.fillStyle = '#6a4020';
  ctx.fillRect(-12, 17, 11, 5);
  ctx.strokeRect(-12, 17, 11, 5);
  ctx.fillRect(1, 17, 11, 5);
  ctx.strokeRect(1, 17, 11, 5);

  // 胸当て（鎧）
  const bodyW = 30, bodyH = 22;
  ctx.fillStyle = '#cdd1d8';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(-bodyW / 2 - 2, -bodyH / 2);
  ctx.lineTo(bodyW / 2 + 2, -bodyH / 2);
  ctx.lineTo(bodyW / 2 - 1, bodyH / 2);
  ctx.lineTo(-bodyW / 2 + 1, bodyH / 2);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // 中央の縦ライン
  ctx.strokeStyle = '#6a7080';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, -bodyH / 2 + 2);
  ctx.lineTo(0, bodyH / 2 - 2);
  ctx.stroke();
  // 紋章（赤い十字）
  ctx.fillStyle = '#b03030';
  ctx.fillRect(-1.5, -5, 3, 10);
  ctx.fillRect(-5, -1.5, 10, 3);

  // 丸い手（両側）
  ctx.fillStyle = '#c0c4ca';
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.arc(-bodyW / 2 - 4, 2, 5, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(bodyW / 2 + 4, 2, 5, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();

  // 兜（ヘルメット）
  const helmW = 28, helmH = 24;
  const helmBottomY = -bodyH / 2 - 1; // 胸当ての上に乗る
  const helmTopY = helmBottomY - helmH;
  ctx.fillStyle = '#cdd1d8';
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  // 下端（顎ガード）
  ctx.moveTo(-helmW / 2, helmBottomY);
  ctx.lineTo(helmW / 2, helmBottomY);
  // 右側面
  ctx.lineTo(helmW / 2 - 1, helmBottomY - helmH * 0.4);
  // 丸い頭頂部
  ctx.quadraticCurveTo(helmW / 2 - 1, helmTopY, 0, helmTopY);
  ctx.quadraticCurveTo(-helmW / 2 + 1, helmTopY, -helmW / 2 + 1, helmBottomY - helmH * 0.4);
  // 左側面（戻る）
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  // 羽根飾り（赤いプルーム）
  ctx.strokeStyle = '#c83838';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, helmTopY);
  ctx.bezierCurveTo(-5, helmTopY - 6, -12, helmTopY - 12, -8, helmTopY - 18);
  ctx.stroke();
  // 留め具
  ctx.fillStyle = '#d4a040';
  ctx.beginPath();
  ctx.arc(0, helmTopY + 1, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineCap = 'butt';
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = '#1a1a1a';
  ctx.stroke();

  // バイザー（縦溝＋横スリット）
  const slitY = helmBottomY - helmH * 0.45;
  ctx.fillStyle = '#1a1a1a';
  // 縦のリッジ
  ctx.fillRect(-1.5, helmTopY + 4, 3, helmH - 8);
  // 横スリット
  ctx.fillRect(-helmW / 2 + 4, slitY - 2, helmW - 8, 5);

  // スリットの中の目（白く光って向きでずれる）
  const eyeOffX = fx * 1.6;
  const eyeOffY = fy * 0.8;
  ctx.fillStyle = '#fff';
  ctx.fillRect(-7 + eyeOffX, slitY - 0.5 + eyeOffY, 3, 2);
  ctx.fillRect(4 + eyeOffX, slitY - 0.5 + eyeOffY, 3, 2);

  // 武器を体の前に
  if (!facingUp && !(weapon === 'hammer' && options.spinning)) {
    drawHeldWeapon(ctx, weapon, fx, fy, options);
  }

  ctx.restore();
}

// =====================================================================
// 武器選択画面
// =====================================================================
function weaponButtons() {
  const startX = 380;
  const y = 280;
  const gap = 130;
  return [
    { x: startX, y, w: 100, h: 130, weapon: 'sword', label: '剣' },
    { x: startX + gap, y, w: 100, h: 130, weapon: 'shield', label: '盾' },
    { x: startX + gap * 2, y, w: 100, h: 130, weapon: 'hammer', label: 'ハンマー' },
  ];
}
function startButton() {
  return { x: W / 2 - 100, y: 560, w: 200, h: 60 };
}

function drawWeaponSelect(dt) {
  // 白背景
  ctx.fillStyle = '#fafafa';
  ctx.fillRect(0, 0, W, H);
  // 床のグラデ
  const grd = ctx.createLinearGradient(0, H * 0.7, 0, H);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, 'rgba(0,0,0,0.08)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, H * 0.7, W, H * 0.3);
  // タイトル
  ctx.fillStyle = '#222';
  ctx.font = 'bold 42px serif';
  ctx.textAlign = 'center';
  ctx.fillText('剣士シールド', W / 2, 80);
  ctx.font = '18px sans-serif';
  ctx.fillStyle = '#555';
  ctx.fillText('武器を えらんでね', W / 2, 115);
  // 主人公（左側）
  const heroX = 180, heroY = 360;
  // 影
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath(); ctx.ellipse(heroX, heroY + 30, 30, 8, 0, 0, Math.PI * 2); ctx.fill();
  // bob
  const bob = Math.sin(performance.now() / 350) * 4;
  drawHero(ctx, heroX, heroY + bob, selectedWeapon, { x: 1, y: 0 }, 0);
  // 武器ボタン
  const buttons = weaponButtons();
  for (const b of buttons) {
    const hover = mouse.x >= b.x && mouse.x <= b.x + b.w && mouse.y >= b.y && mouse.y <= b.y + b.h;
    const selected = selectedWeapon === b.weapon;
    ctx.fillStyle = selected ? '#fff7d0' : (hover ? '#f0f0f0' : '#fff');
    ctx.strokeStyle = selected ? '#e0b020' : '#aaa';
    ctx.lineWidth = selected ? 4 : 2;
    roundRect(ctx, b.x, b.y, b.w, b.h, 12);
    ctx.fill(); ctx.stroke();
    // アイコン
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2 - 10;
    if (b.weapon === 'sword') drawSword(ctx, cx, cy + 25, 40);
    if (b.weapon === 'shield') drawShield(ctx, cx, cy, 30);
    if (b.weapon === 'hammer') drawHammer(ctx, cx, cy + 25, 40);
    ctx.fillStyle = '#222';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(b.label, cx, b.y + b.h - 12);
  }
  // 武器説明
  if (selectedWeapon) {
    const desc = {
      sword: '剣: 近距離 (3) / 2秒長押しで斬撃 (4)',
      shield: '盾: 構えて反射 (2) / 長押し投げ (5)',
      hammer: 'ハンマー: 範囲攻撃 (5、1秒溜め) / 長押しで回転攻撃 (2連続)',
    }[selectedWeapon];
    ctx.fillStyle = '#333';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(desc, W / 2, 490);
  }
  // スタートボタン
  const sb = startButton();
  const sbHover = mouse.x >= sb.x && mouse.x <= sb.x + sb.w && mouse.y >= sb.y && mouse.y <= sb.y + sb.h;
  if (selectedWeapon) {
    ctx.fillStyle = sbHover ? '#3aa055' : '#4abf65';
    ctx.strokeStyle = '#2c7a40';
  } else {
    ctx.fillStyle = '#ccc';
    ctx.strokeStyle = '#999';
  }
  ctx.lineWidth = 3;
  roundRect(ctx, sb.x, sb.y, sb.w, sb.h, 16);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('スタート', sb.x + sb.w / 2, sb.y + sb.h / 2);
  ctx.textBaseline = 'alphabetic';
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// =====================================================================
// バトル描画
// =====================================================================
function drawArena() {
  // 背景
  ctx.fillStyle = '#2a2a3a';
  ctx.fillRect(0, 0, W, H);
  // アリーナ床
  ctx.fillStyle = '#e9dfc1';
  ctx.beginPath();
  ctx.arc(CENTER.x, CENTER.y, ARENA_R, 0, Math.PI * 2);
  ctx.fill();
  // 模様
  ctx.strokeStyle = '#d0c08e';
  ctx.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(CENTER.x + Math.cos(a) * 100, CENTER.y + Math.sin(a) * 100);
    ctx.lineTo(CENTER.x + Math.cos(a) * (ARENA_R - 10), CENTER.y + Math.sin(a) * (ARENA_R - 10));
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(CENTER.x, CENTER.y, 80, 0, Math.PI * 2);
  ctx.stroke();
  // 縁
  ctx.strokeStyle = '#4a3a20';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(CENTER.x, CENTER.y, ARENA_R, 0, Math.PI * 2);
  ctx.stroke();
}

function drawHUD() {
  // ボスHPバー
  if (boss) {
    const bw = 500, bh = 18;
    const bx = (W - bw) / 2, by = 24;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
    ctx.fillStyle = '#330000';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = '#d63636';
    ctx.fillRect(bx, by, bw * (boss.hp / BOSS_MAX_HP), bh);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    const bossName = ['剣のボス', '弓のボス', 'ハンマーのボス'][stageIndex];
    ctx.fillText(`STAGE ${stageIndex + 1} / 3   ${bossName}`, W / 2, by + bh + 16);
  }
  // 武器アイコン
  ctx.save();
  ctx.translate(60, 60);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.arc(0, 0, 32, 0, Math.PI * 2); ctx.fill();
  if (player.weapon === 'sword') drawSword(ctx, 0, 12, 22);
  if (player.weapon === 'shield') drawShield(ctx, 0, -4, 16);
  if (player.weapon === 'hammer') drawHammer(ctx, 0, 16, 22);
  ctx.restore();

  // 残機（ハート）
  ctx.save();
  for (let i = 0; i < 3; i++) {
    drawHeart(ctx, 110 + i * 28, 60, 10, i < player.lives);
  }
  ctx.restore();

  // チャージインジケータ
  if (player.weapon === 'sword' && player.swordCharge > 0) {
    drawChargeBar(player.swordCharge / 2.0, player.swordCharge >= 2.0);
  }
  if (player.weapon === 'shield' && spaceDown && !player.shieldThrown) {
    drawChargeBar(Math.min(spaceHeldDuration / 0.7, 1), spaceHeldDuration >= 0.7);
  }
  if (player.weapon === 'hammer' && player.hammerWindup > 0) {
    drawChargeBar(1 - player.hammerWindup, false, '#ff8040');
  }
}

function drawChargeBar(ratio, full, color = '#7ec0ff') {
  const x = player.x - 24, y = player.y - 32;
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(x - 1, y - 1, 50, 6);
  ctx.fillStyle = full ? '#ffd040' : color;
  ctx.fillRect(x, y, 48 * Math.min(ratio, 1), 4);
}

function drawHeart(ctx, x, y, size, filled) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = filled ? '#e84050' : '#3a2828';
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(0, size * 0.9);
  ctx.bezierCurveTo(-size * 1.4, size * 0.1, -size * 1.0, -size * 1.0, 0, -size * 0.2);
  ctx.bezierCurveTo(size * 1.0, -size * 1.0, size * 1.4, size * 0.1, 0, size * 0.9);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

function drawPlayer() {
  if (!player.alive) return;
  // 影
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(player.x, player.y + 24, 15, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // 無敵点滅
  if (player.invuln > 0 && Math.floor(player.invuln * 20) % 2 === 0) {
    return;
  }
  drawHero(ctx, player.x, player.y, player.weapon, player.facing, 0, {
    blocking: player.blocking,
    shieldGone: player.shieldThrown,
    spinning: player.hammerSpinning,
    spinAngle: player.hammerSpinAngle,
    hammerSwing: player.hammerSwing > 0 ? -0.6 : 0,
    swordSlashing: player.swordSlash > 0,
  });

  // 剣の斬りつけエフェクト
  if (player.swordSlash > 0) {
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(Math.atan2(player.facing.y, player.facing.x));
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.globalAlpha = player.swordSlash / 0.22;
    ctx.beginPath();
    ctx.arc(20, 0, 28, -1, 1);
    ctx.stroke();
    ctx.restore();
  }
  // ハンマー回転エフェクト
  if (player.hammerSpinning) {
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.strokeStyle = 'rgba(255, 200, 100, 0.4)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 38, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// =====================================================================
// エフェクト
// =====================================================================
function updateEffects(dt) {
  for (const e of effects) {
    e.life -= dt;
  }
  effects = effects.filter(e => e.life > 0);
}
function drawEffects() {
  for (const e of effects) {
    if (e.type === 'spark') {
      ctx.save();
      ctx.translate(e.x, e.y);
      const a = e.life / 0.3;
      ctx.globalAlpha = a;
      ctx.fillStyle = '#ffe080';
      for (let i = 0; i < 6; i++) {
        const ang = i / 6 * Math.PI * 2;
        const r = (1 - a) * 14 + 4;
        ctx.beginPath();
        ctx.arc(Math.cos(ang) * r, Math.sin(ang) * r, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    } else if (e.type === 'aoe') {
      const a = e.life / e.maxLife;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.strokeStyle = `rgba(255, 200, 80, ${a})`;
      ctx.fillStyle = `rgba(255, 200, 80, ${a * 0.25})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, e.r * (1.1 - a * 0.2), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    } else if (e.type === 'death') {
      const a = e.life / e.maxLife;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.fillStyle = `rgba(120, 120, 200, ${a})`;
      ctx.beginPath();
      ctx.arc(0, 0, (1 - a) * 40 + 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (e.type === 'damage') {
      const a = e.life / e.maxLife;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.strokeStyle = `rgba(255, 80, 80, ${a})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, (1 - a) * 28 + 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (e.type === 'bossDeath') {
      const a = e.life / e.maxLife;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.fillStyle = `rgba(255, 230, 100, ${a})`;
      for (let i = 0; i < 12; i++) {
        const ang = i / 12 * Math.PI * 2 + (1 - a) * 4;
        const r = (1 - a) * 60;
        ctx.beginPath();
        ctx.arc(Math.cos(ang) * r, Math.sin(ang) * r, 6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
}

// =====================================================================
// ゲームループ
// =====================================================================
function startGame() {
  stageIndex = 0;
  player = new Player(selectedWeapon);
  startStage(0);
}

function startStage(idx) {
  stageIndex = idx;
  projectiles = [];
  effects = [];
  const type = stages[idx];
  if (type === 'sword') boss = new SwordBoss();
  else if (type === 'bow') boss = new BowBoss();
  else if (type === 'hammer') boss = new HammerBoss();
  // プレイヤー位置リセット
  player.x = CENTER.x;
  player.y = CENTER.y + 200;
  player.invuln = 1.2;
  player.alive = true;
  // 状態
  state = 'BOSS_INTRO';
  stateTimer = 1.6;
}

function resetToWeaponSelect() {
  state = 'WEAPON_SELECT';
  selectedWeapon = null;
  player = null;
  boss = null;
  projectiles = [];
  effects = [];
  stageIndex = 0;
}

function updateBattle(dt) {
  if (spaceDown) spaceHeldDuration += dt;
  player.update(dt);
  boss.update(dt);
  for (const p of projectiles) p.update(dt);
  projectiles = projectiles.filter(p => p.alive);
  updateEffects(dt);

  if (!player.alive) {
    state = 'GAME_OVER';
    stateTimer = 0;
    return;
  }
  if (!boss.alive) {
    state = 'BOSS_DEAD';
    stateTimer = 2.0;
    return;
  }
}

function drawBattle() {
  drawArena();
  // 描画順: ボス -> プレイヤー -> 弾 -> エフェクト -> HUD
  boss && boss.draw(ctx);
  drawPlayer();
  for (const p of projectiles) p.draw(ctx);
  drawEffects();
  drawHUD();
}

function drawBossIntro() {
  drawArena();
  boss && boss.draw(ctx);
  drawPlayer();
  // VS
  ctx.save();
  const a = Math.min(1, stateTimer / 1.6);
  ctx.fillStyle = `rgba(0, 0, 0, ${0.55 * a})`;
  ctx.fillRect(0, 200, W, 200);
  ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
  ctx.font = 'bold 60px serif';
  ctx.textAlign = 'center';
  ctx.fillText(`STAGE ${stageIndex + 1}`, W / 2, 270);
  ctx.font = 'bold 36px serif';
  const names = ['剣のボス', '弓のボス', 'ハンマーのボス'];
  ctx.fillText(names[stageIndex], W / 2, 330);
  ctx.font = '18px sans-serif';
  ctx.fillStyle = `rgba(255, 240, 200, ${a})`;
  ctx.fillText('まもなく開始...', W / 2, 370);
  ctx.restore();
}

function drawGameOver() {
  drawBattle();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ff5050';
  ctx.font = 'bold 72px serif';
  ctx.textAlign = 'center';
  ctx.fillText('GAME OVER', W / 2, H / 2 - 20);
  ctx.fillStyle = '#fff';
  ctx.font = '20px sans-serif';
  ctx.fillText('Enterキー または クリックで もう一度', W / 2, H / 2 + 30);
}

function drawVictory() {
  drawArena();
  drawPlayer();
  ctx.fillStyle = 'rgba(255, 255, 220, 0.4)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#daa030';
  ctx.font = 'bold 70px serif';
  ctx.textAlign = 'center';
  ctx.fillText('VICTORY!', W / 2, H / 2 - 30);
  ctx.fillStyle = '#333';
  ctx.font = '24px sans-serif';
  ctx.fillText('3体のボスを倒した！', W / 2, H / 2 + 10);
  ctx.font = '18px sans-serif';
  ctx.fillText('Enterキー または クリックで タイトルへ', W / 2, H / 2 + 50);
}

// =====================================================================
// メインループ
// =====================================================================
function loop(now) {
  const dt = Math.min(0.033, (now - lastTime) / 1000 || 0);
  lastTime = now;

  if (state === 'WEAPON_SELECT') {
    drawWeaponSelect(dt);
  } else if (state === 'BOSS_INTRO') {
    stateTimer -= dt;
    drawBossIntro();
    if (stateTimer <= 0) state = 'BATTLE';
  } else if (state === 'BATTLE') {
    updateBattle(dt);
    drawBattle();
  } else if (state === 'BOSS_DEAD') {
    updateEffects(dt);
    drawBattle();
    stateTimer -= dt;
    if (stateTimer <= 0) {
      if (stageIndex + 1 >= stages.length) {
        state = 'VICTORY';
      } else {
        startStage(stageIndex + 1);
      }
    }
  } else if (state === 'GAME_OVER') {
    drawGameOver();
  } else if (state === 'VICTORY') {
    drawVictory();
  }

  requestAnimationFrame(loop);
}

window.addEventListener('load', () => {
  canvas = document.getElementById('game');
  ctx = canvas.getContext('2d');
  setupMouse();
  requestAnimationFrame(loop);
});
