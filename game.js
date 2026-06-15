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
let stages = ['sword', 'bow', 'hammer', 'bomb'];

let player = null;
let boss = null;
let projectiles = [];
let effects = [];
let minions = []; // ボスの子分（爆弾ボス第二形態）
let coins = 0;
let upgrades = { sword: false, shield: false, hammer: false };
// 隠しボス解禁: 各ステージ中に一度も被弾していないと true。被弾でリセット。
// ラスボスをノーダメ撃破するとノコギリのボスが出現する。
let noHitRun = true;
const UPGRADE_COST = { hammer: 2, shield: 4, sword: 6 };
const COIN_REWARD = 2;

// アイテム: ショップで購入してバトル中にBキーで使用、Vキーで選択切替
const ITEM_ORDER = ['poison', 'potion', 'bigPotion', 'weaponSwap'];
const ITEMS = {
  poison:     { name: 'ポイズン',         cost: 1, color: '#7a4ab8', label: '毒', desc: 'ボス: 1秒1ダメ × 8秒' },
  potion:     { name: '回復ポーション',   cost: 1, color: '#d63636', label: '回', desc: '残機 +1' },
  bigPotion:  { name: 'ビッグポーション', cost: 2, color: '#a01818', label: '大', desc: '残機 満タン' },
  weaponSwap: { name: '武器変更',         cost: 2, color: '#3a7ab8', label: '替', desc: '武器がランダム変更' },
};
const POISON_DURATION = 8; // 1回の使用で 8 秒 (= 8 ダメ)
let inventory = { poison: 0, potion: 0, bigPotion: 0, weaponSwap: 0 };
let selectedItem = 'poison';

// ボス + 生存中の子分すべてを攻撃対象として返す。復活演出中の無敵は除外。
function aliveEnemies() {
  const list = [];
  if (boss && boss.alive && boss.mode !== 'reviving') list.push(boss);
  for (const m of minions) if (m.alive) list.push(m);
  return list;
}

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
  if (e.code === 'Enter') {
    if (state === 'GAME_OVER' || state === 'VICTORY') {
      resetToWeaponSelect();
    } else if (state === 'SHOP') {
      startStage(stageIndex + 1);
    }
  }
  if (e.code === 'KeyB' && state === 'BATTLE') {
    useSelectedItem();
    e.preventDefault();
  }
  if (e.code === 'KeyV' && state === 'BATTLE') {
    cycleSelectedItem();
    e.preventDefault();
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

// ---- タッチ操作 --------------------------------------------------------
// 攻撃／アイテムはソフトボタン（キーボードと同じ spaceDown 等を叩く）。
// 移動は左下のバーチャルスティック。スティック中心からの指の「角度」で
// キャラの進行方向を決める（十字キーではなくアナログ操作）。
let touchEnabled = false;
let touchControlsEl = null;
let itemUseBtn = null;
let joystickEl = null;
let joystickKnob = null;
// スティックの出力方向（正規化済み）と操作中の指 id
let joyDir = { active: false, x: 0, y: 0 };
let joyId = null;

// タッチ座標をキャンバス内のゲーム座標へ変換（CSSスケールを補正）
function touchToGame(t) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (t.clientX - r.left) * (W / r.width),
    y: (t.clientY - r.top) * (H / r.height),
  };
}

// スティックを離した／無効化したときの状態リセット
function resetJoystick() {
  joyId = null;
  joyDir.active = false;
  joyDir.x = 0; joyDir.y = 0;
  if (joystickKnob) joystickKnob.style.transform = 'translate(0, 0)';
}

// 指の位置からスティックの方向とノブ表示を更新する
function updateJoystick(t) {
  const r = joystickEl.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const dx = t.clientX - cx, dy = t.clientY - cy;
  const dist = Math.hypot(dx, dy);
  const max = r.width / 2;
  const nx = dist > 0 ? dx / dist : 0, ny = dist > 0 ? dy / dist : 0;
  // ノブは台座の内側に収まるようクランプして指方向へ寄せる
  const knobMax = max - joystickKnob.clientWidth / 2;
  const knobDist = Math.min(dist, knobMax);
  joystickKnob.style.transform = `translate(${nx * knobDist}px, ${ny * knobDist}px)`;
  // 小さなデッドゾーン内では動かさない
  if (dist > max * 0.28) {
    joyDir.active = true;
    joyDir.x = nx; joyDir.y = ny;
  } else {
    joyDir.active = false;
  }
}

function setupTouch() {
  touchEnabled = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  touchControlsEl = document.getElementById('touch-controls');
  itemUseBtn = document.getElementById('btn-item-use');
  if (!touchEnabled || !touchControlsEl) return;
  document.body.classList.add('touch');

  // 攻撃ボタン: スペースキー相当（押す=onSpacePress、離す=onSpaceRelease(長押し時間)）
  const atk = document.getElementById('btn-attack');
  atk.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (!spaceDown) {
      spaceDown = true;
      spaceHeldDuration = 0;
      if (player) player.onSpacePress();
    }
    atk.classList.add('pressed');
  }, { passive: false });
  const atkRelease = (e) => {
    e.preventDefault();
    if (spaceDown) {
      const held = spaceHeldDuration;
      spaceDown = false;
      spaceHeldDuration = 0;
      if (player) player.onSpaceRelease(held);
    }
    atk.classList.remove('pressed');
  };
  atk.addEventListener('touchend', atkRelease, { passive: false });
  atk.addEventListener('touchcancel', atkRelease, { passive: false });

  // アイテム使用(B) / 切替(V)
  itemUseBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (state === 'BATTLE') useSelectedItem();
  }, { passive: false });
  document.getElementById('btn-item-cycle').addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (state === 'BATTLE') cycleSelectedItem();
  }, { passive: false });

  // 移動スティック（左下）。中心からの指の角度で進行方向を決める。
  joystickEl = document.getElementById('joystick');
  joystickKnob = document.getElementById('joystick-knob');
  joystickEl.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (joyId !== null) return;
    const t = e.changedTouches[0];
    joyId = t.identifier;
    updateJoystick(t);
  }, { passive: false });
  joystickEl.addEventListener('touchmove', (e) => {
    if (joyId === null) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) updateJoystick(t);
    }
  }, { passive: false });
  const joyEnd = (e) => {
    if (joyId === null) return;
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) resetJoystick();
    }
  };
  joystickEl.addEventListener('touchend', joyEnd);
  joystickEl.addEventListener('touchcancel', joyEnd);

  // キャンバスのタッチ: メニュー画面（武器選択・ショップ・ゲームオーバー等）の
  // タップ操作。戦闘中の移動はスティックが受け持つのでここでは何もしない。
  canvas.addEventListener('touchstart', (e) => {
    if (state === 'BATTLE') return;
    e.preventDefault();
    const p = touchToGame(e.changedTouches[0]);
    mouse.x = p.x; mouse.y = p.y;
    handleClick();
  }, { passive: false });
}

// 戦闘中だけソフトボタンを表示し、使用ボタンに現在のアイテムと所持数を出す
function updateTouchControls() {
  if (!touchEnabled || !touchControlsEl) return;
  const show = state === 'BATTLE';
  touchControlsEl.style.display = show ? 'block' : 'none';
  if (show && itemUseBtn) {
    const it = ITEMS[selectedItem];
    itemUseBtn.textContent = it.label + '\n×' + inventory[selectedItem];
  } else if (!show && joyId !== null) {
    // 戦闘外ではスティックを解除（指が残っていても動かさない）
    resetJoystick();
  }
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
  } else if (state === 'SHOP') {
    const cost = UPGRADE_COST[selectedWeapon];
    const buyBtn = shopBuyButton();
    if (!upgrades[selectedWeapon] && coins >= cost &&
        mouse.x >= buyBtn.x && mouse.x <= buyBtn.x + buyBtn.w &&
        mouse.y >= buyBtn.y && mouse.y <= buyBtn.y + buyBtn.h) {
      coins -= cost;
      upgrades[selectedWeapon] = true;
      return;
    }
    // アイテム購入
    for (const r of shopItemRects()) {
      const item = ITEMS[r.id];
      if (coins >= item.cost &&
          mouse.x >= r.x && mouse.x <= r.x + r.w &&
          mouse.y >= r.y && mouse.y <= r.y + r.h) {
        coins -= item.cost;
        inventory[r.id]++;
        return;
      }
    }
    const contBtn = shopContinueButton();
    if (mouse.x >= contBtn.x && mouse.x <= contBtn.x + contBtn.w &&
        mouse.y >= contBtn.y && mouse.y <= contBtn.y + contBtn.h) {
      startStage(stageIndex + 1);
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
    this.attackCooldown = 0; // 全武器共通の攻撃後クールダウン

    // 共通アニメーション
    this.swordSlash = 0;
    this.hammerSwing = 0;
    this.bobTimer = 0;

    // 剣
    this.swordCharge = 0;
    this.swordSpinning = false; // 強化時の長押し回転
    this.swordSpinAngle = 0;

    // 盾
    this.blocking = false;
    this.shieldThrown = false;
    this.shieldProj = null;

    // ハンマー
    this.hammerWindup = 0;     // 通常攻撃の溜め
    this.hammerSpinning = false;
    this.hammerSpinAngle = 0;
    this.spinHitCooldown = 0;  // 連続ヒット間隔（剣/ハンマー回転共用）
  }

  update(dt) {
    if (this.invuln > 0) this.invuln -= dt;
    if (this.swordSlash > 0) this.swordSlash -= dt;
    if (this.hammerSwing > 0) this.hammerSwing -= dt;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    this.bobTimer += dt;

    // 移動方向
    let dx = 0, dy = 0;
    if (keys['ArrowLeft']) dx -= 1;
    if (keys['ArrowRight']) dx += 1;
    if (keys['ArrowUp']) dy -= 1;
    if (keys['ArrowDown']) dy += 1;
    // タッチ移動: キー入力が無いときはスティックの方向へ進む
    if (!dx && !dy && joyDir.active) {
      dx = joyDir.x; dy = joyDir.y;
    }
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
      if (upgrades.sword) {
        // 強化: 長押しで回転、ヒットでダメージ
        if (spaceDown && spaceHeldDuration >= 0.25 &&
            !this.swordSpinning && this.attackCooldown <= 0) {
          this.swordSpinning = true;
          this.attackCooldown = 0.5;
        }
        if (!spaceDown && this.swordSpinning) this.swordSpinning = false;
        if (this.swordSpinning) {
          this.swordSpinAngle += dt * 16;
          this.spinHitCooldown -= dt;
          if (this.spinHitCooldown <= 0) {
            let hit = false;
            for (const e of aliveEnemies()) {
              if (Math.hypot(e.x - this.x, e.y - this.y) <= 50 + e.r) {
                e.takeDamage(1);
                hit = true;
              }
            }
            if (hit) this.spinHitCooldown = 0.3;
          }
        }
      } else {
        // クールダウン中はチャージも蓄積しない
        if (spaceDown && this.attackCooldown <= 0) {
          this.swordCharge = Math.min(2.0, this.swordCharge + dt);
        }
      }
    } else if (this.weapon === 'shield') {
      this.blocking = spaceDown && !this.shieldThrown;
    } else if (this.weapon === 'hammer') {
      if (this.hammerWindup > 0) {
        this.hammerWindup -= dt;
        if (this.hammerWindup <= 0) this.executeHammerAOE();
      }
      // 長押しで回転モードへ
      if (spaceDown && spaceHeldDuration >= 0.4 &&
          !this.hammerSpinning && this.hammerWindup <= 0 &&
          this.attackCooldown <= 0) {
        this.hammerSpinning = true;
        this.attackCooldown = 0.5;
      }
      if (!spaceDown && this.hammerSpinning) this.hammerSpinning = false;

      if (this.hammerSpinning) {
        this.hammerSpinAngle += dt * 14;
        this.spinHitCooldown -= dt;
        // 敵への連続ヒット判定（ボス + 子分）
        if (this.spinHitCooldown <= 0) {
          let hitAny = false;
          for (const e of aliveEnemies()) {
            if (Math.hypot(e.x - this.x, e.y - this.y) <= 55 + e.r) {
              e.takeDamage(1);
              hitAny = true;
            }
          }
          if (hitAny) this.spinHitCooldown = 0.3;
        }
        // 強化: 近くの敵の飛び道具をランダム方向へ反射
        if (upgrades.hammer) {
          for (const p of projectiles) {
            if (p.owner === 'boss' && !p.reflected && typeof p.reflect === 'function' &&
                p.reflectable !== false) {
              if (Math.hypot(p.x - this.x, p.y - this.y) < 55 + (p.r || 8)) {
                p.reflect();
                effects.push({ type: 'spark', x: p.x, y: p.y, life: 0.25 });
              }
            }
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
      if (upgrades.sword) {
        // 強化: 回転中ならランダム方向へ斬撃を放つ。タップなら近接。
        if (this.swordSpinning) {
          this.swordSpinning = false;
          const a = Math.random() * Math.PI * 2;
          projectiles.push(new SwordSlash(this.x, this.y, { x: Math.cos(a), y: Math.sin(a) }));
          this.attackCooldown = 0.5;
        } else if (this.attackCooldown <= 0) {
          this.swordSlash = 0.22;
          this.checkSwordHit();
          this.attackCooldown = 0.5;
        }
        return;
      }
      if (this.attackCooldown > 0) {
        this.swordCharge = 0;
        return;
      }
      if (this.swordCharge >= 2.0) {
        projectiles.push(new SwordSlash(this.x, this.y, this.facing));
      } else {
        this.swordSlash = 0.22;
        this.checkSwordHit();
      }
      this.swordCharge = 0;
      this.attackCooldown = 0.5;
    } else if (this.weapon === 'shield') {
      if (heldFor >= 0.7 && !this.shieldThrown && this.attackCooldown <= 0) {
        const proj = new ShieldThrown(this.x, this.y, this.facing, this);
        this.shieldThrown = true;
        this.shieldProj = proj;
        projectiles.push(proj);
        this.attackCooldown = 0.5;
      }
    } else if (this.weapon === 'hammer') {
      if (this.hammerSpinning) {
        this.hammerSpinning = false;
        this.attackCooldown = 0.5;
      } else if (this.hammerWindup <= 0 && this.attackCooldown <= 0) {
        this.hammerWindup = 1.0;
        this.attackCooldown = 0.5;
      }
    }
  }

  checkSwordHit() {
    const range = 46;
    for (const e of aliveEnemies()) {
      const dx = e.x - this.x, dy = e.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d > range + e.r) continue;
      const dot = (dx * this.facing.x + dy * this.facing.y) / Math.max(d, 0.0001);
      if (dot > 0.2) {
        e.takeDamage(3);
        effects.push({ type: 'spark', x: e.x, y: e.y, life: 0.3 });
      }
    }
  }

  executeHammerAOE() {
    this.hammerSwing = 0.3;
    const range = 75;
    for (const e of aliveEnemies()) {
      if (Math.hypot(e.x - this.x, e.y - this.y) <= range + e.r) {
        e.takeDamage(5);
      }
    }
    effects.push({ type: 'aoe', x: this.x, y: this.y, r: range, life: 0.35, maxLife: 0.35 });
  }

  hit() {
    if (this.invuln > 0 || !this.alive) return false;
    noHitRun = false;
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
    for (const e of aliveEnemies()) {
      if (Math.hypot(e.x - this.x, e.y - this.y) < this.r + e.r) {
        e.takeDamage(this.damage);
        this.alive = false;
        effects.push({ type: 'spark', x: this.x, y: this.y, life: 0.3 });
        break;
      }
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

    // アリーナの外に当たったら戻る
    const cd = Math.hypot(this.x - CENTER.x, this.y - CENTER.y);
    if (cd > ARENA_R - 10) {
      this.returning = true;
    }

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

    for (const e of aliveEnemies()) {
      if (this.hitTargets.has(e)) continue;
      if (Math.hypot(e.x - this.x, e.y - this.y) < this.r + e.r) {
        e.takeDamage(this.damage);
        this.hitTargets.add(e);
        effects.push({ type: 'spark', x: this.x, y: this.y, life: 0.3 });
        this.returning = true;
        break;
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
      for (const e of aliveEnemies()) {
        if (Math.hypot(this.x - e.x, this.y - e.y) < this.r + e.r) {
          e.takeDamage(this.damage);
          this.alive = false;
          effects.push({ type: 'spark', x: this.x, y: this.y, life: 0.3 });
          break;
        }
      }
    }
  }
  reflect() {
    const a = Math.random() * Math.PI * 2;
    this.vx = Math.cos(a) * 7;
    this.vy = Math.sin(a) * 7;
    this.angle = Math.atan2(this.vy, this.vx);
    this.owner = 'player';
    this.reflected = true;
    this.damage = 2;
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
    this.reflected = false;
    this.damage = 3;
  }
  reflect() {
    const a = Math.random() * Math.PI * 2;
    this.vx = Math.cos(a) * 6;
    this.vy = Math.sin(a) * 6;
    this.angle = Math.atan2(this.vy, this.vx);
    this.owner = 'player';
    this.reflected = true;
  }
  update(dt) {
    this.x += this.vx; this.y += this.vy;
    this.life -= dt;
    if (this.life <= 0) this.alive = false;
    const cd = Math.hypot(this.x - CENTER.x, this.y - CENTER.y);
    if (cd > ARENA_R - 5) this.alive = false;
    if (this.owner === 'boss') {
      // 盾構えで反射
      if (player.blocking) {
        const dx = this.x - player.x, dy = this.y - player.y;
        const d = Math.hypot(dx, dy);
        if (d < player.r + 26) {
          const dot = (dx * player.facing.x + dy * player.facing.y) / Math.max(d, 0.0001);
          if (dot > 0.2) {
            const nx = player.facing.x, ny = player.facing.y;
            this.vx = nx * 7;
            this.vy = ny * 7;
            this.angle = Math.atan2(ny, nx);
            this.owner = 'player';
            this.reflected = true;
            this.damage = 5;
            effects.push({ type: 'spark', x: this.x, y: this.y, life: 0.3 });
            return;
          }
        }
      }
      if (player.alive && Math.hypot(this.x - player.x, this.y - player.y) < this.r + player.r) {
        if (player.hit()) this.alive = false;
      }
    } else {
      for (const e of aliveEnemies()) {
        if (Math.hypot(this.x - e.x, this.y - e.y) < this.r + e.r) {
          e.takeDamage(this.damage);
          this.alive = false;
          effects.push({ type: 'spark', x: this.x, y: this.y, life: 0.3 });
          break;
        }
      }
    }
  }
  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.fillStyle = this.reflected ? '#7ec0ff' : '#ff6060';
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
      for (const e of aliveEnemies()) {
        if (Math.hypot(this.x - e.x, this.y - e.y) < this.r + e.r) {
          e.takeDamage(this.damage);
          this.alive = false;
          effects.push({ type: 'spark', x: this.x, y: this.y, life: 0.3 });
          break;
        }
      }
    }
  }
  reflect() {
    const a = Math.random() * Math.PI * 2;
    this.vx = Math.cos(a) * 9;
    this.vy = Math.sin(a) * 9;
    this.angle = Math.atan2(this.vy, this.vx);
    this.owner = 'player';
    this.reflected = true;
    this.damage = 4;
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

// ボス4の爆弾飛び道具（大砲弾・投擲ボム共用）
class BombProjectile {
  constructor(x, y, tx, ty, flightTime, explodeR, kind, reflectable = true) {
    this.startX = x; this.startY = y;
    this.x = x; this.y = y;
    this.tx = tx; this.ty = ty;
    this.flightTime = flightTime;
    this.timer = 0;
    this.height = 0;
    this.maxHeight = (kind === 'cannon') ? 35 : 65;
    this.r = (kind === 'cannon') ? 10 : 8;
    this.explodeR = explodeR;
    this.alive = true;
    this.owner = 'boss';
    this.kind = kind;
    this.fuseSpark = 0;
    this.reflected = false;
    // 反射可能か（ラスボスの爆弾は false。トゲ付きで見た目も変わる）
    this.reflectable = reflectable;
  }
  // 任意方向への反射本体。reflectable フラグは無視（強制反射）。
  reflectAt(angle) {
    const dist = 240;
    this.startX = this.x;
    this.startY = this.y;
    let tx = this.x + Math.cos(angle) * dist;
    let ty = this.y + Math.sin(angle) * dist;
    // アリーナ内に収まるようクランプ
    const cd = Math.hypot(tx - CENTER.x, ty - CENTER.y);
    if (cd > ARENA_R - 20) {
      const k = (ARENA_R - 20) / cd;
      tx = CENTER.x + (tx - CENTER.x) * k;
      ty = CENTER.y + (ty - CENTER.y) * k;
    }
    this.tx = tx; this.ty = ty;
    this.timer = 0;
    this.flightTime = 0.6;
    this.maxHeight = 50;
    this.owner = 'player';
    this.reflected = true;
  }
  reflect() {
    // 通常の反射経路（ハンマー強化など）は reflectable をチェック。
    if (!this.reflectable) return;
    this.reflectAt(Math.random() * Math.PI * 2);
  }
  update(dt) {
    this.timer += dt;
    this.fuseSpark += dt * 14;
    // 強化盾のブロック: 反射不可フラグも無視し、構えた向きへ跳ね返す。
    if (this.owner === 'boss' && upgrades.shield && player.alive && player.blocking) {
      const dx = this.x - player.x, dy = this.y - player.y;
      const d = Math.hypot(dx, dy);
      if (d < player.r + 26) {
        const dot = (dx * player.facing.x + dy * player.facing.y) / Math.max(d, 0.0001);
        if (dot > 0.2) {
          this.reflectAt(Math.atan2(player.facing.y, player.facing.x));
          effects.push({ type: 'spark', x: this.x, y: this.y, life: 0.3 });
          return;
        }
      }
    }
    const t = this.timer / this.flightTime;
    if (t >= 1) {
      this.x = this.tx; this.y = this.ty;
      this.height = 0;
      effects.push({ type: 'aoe', x: this.x, y: this.y, r: this.explodeR, life: 0.5, maxLife: 0.5 });
      effects.push({ type: 'spark', x: this.x, y: this.y, life: 0.4 });
      if (this.owner === 'boss') {
        if (player.alive && Math.hypot(player.x - this.x, player.y - this.y) < this.explodeR) {
          player.hit();
        }
      } else {
        for (const e of aliveEnemies()) {
          if (Math.hypot(e.x - this.x, e.y - this.y) < this.explodeR) {
            e.takeDamage(6);
          }
        }
      }
      this.alive = false;
      return;
    }
    this.x = this.startX + (this.tx - this.startX) * t;
    this.y = this.startY + (this.ty - this.startY) * t;
    this.height = Math.sin(t * Math.PI) * this.maxHeight;
  }
  draw(ctx) {
    // 着弾予告マーカー
    const t = this.timer / this.flightTime;
    ctx.save();
    ctx.translate(this.tx, this.ty);
    const flash = 0.45 + 0.3 * Math.sin(t * 26);
    ctx.strokeStyle = `rgba(255, 80, 60, ${flash})`;
    ctx.fillStyle = `rgba(255, 80, 60, 0.14)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, this.explodeR, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-this.explodeR * 0.4, 0); ctx.lineTo(this.explodeR * 0.4, 0);
    ctx.moveTo(0, -this.explodeR * 0.4); ctx.lineTo(0, this.explodeR * 0.4);
    ctx.stroke();
    ctx.restore();
    // 影
    ctx.fillStyle = `rgba(0,0,0,${Math.max(0.05, 0.28 - this.height * 0.002)})`;
    ctx.beginPath();
    ctx.ellipse(this.x, this.y, Math.max(2, this.r - this.height * 0.06), Math.max(1, this.r * 0.45 - this.height * 0.025), 0, 0, Math.PI * 2);
    ctx.fill();
    // ボム本体
    ctx.save();
    ctx.translate(this.x, this.y - this.height);
    // 反射不可ボムは赤いトゲで警告
    if (!this.reflectable) {
      ctx.fillStyle = '#d83030';
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1.5;
      const spikes = 8;
      const rIn = this.r + 0.5;
      const rOut = this.r + 5;
      ctx.beginPath();
      for (let i = 0; i < spikes; i++) {
        const a1 = (i / spikes) * Math.PI * 2;
        const am = ((i + 0.5) / spikes) * Math.PI * 2;
        const a2 = ((i + 1) / spikes) * Math.PI * 2;
        if (i === 0) ctx.moveTo(Math.cos(a1) * rIn, Math.sin(a1) * rIn);
        ctx.lineTo(Math.cos(am) * rOut, Math.sin(am) * rOut);
        ctx.lineTo(Math.cos(a2) * rIn, Math.sin(a2) * rIn);
      }
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = this.reflectable ? '#3a3a44' : '#5a1a24';
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, 0, this.r, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    // ハイライト
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.arc(-this.r * 0.35, -this.r * 0.4, this.r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    // 導火線
    ctx.strokeStyle = '#3a2818';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -this.r);
    ctx.quadraticCurveTo(3, -this.r - 5, 1, -this.r - 9);
    ctx.stroke();
    ctx.lineCap = 'butt';
    // 火花
    const sparkR = 2 + Math.sin(this.fuseSpark) * 1;
    ctx.fillStyle = '#ffd040';
    ctx.beginPath();
    ctx.arc(1, -this.r - 9, sparkR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff5b0';
    ctx.beginPath();
    ctx.arc(1, -this.r - 9, sparkR * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ノコギリボスの右手ビーム。発射時の方向に固定された直線レーザー。
// telegraph フェーズで警告線を出し、active フェーズで実際に当たり判定。
class Beam {
  constructor(x, y, dir, telegraphTime = 0.35, activeTime = 0.5) {
    this.startX = x; this.startY = y;
    this.dir = dir;
    this.range = 900;
    this.telegraphTime = telegraphTime;
    this.activeTime = activeTime;
    this.life = telegraphTime + activeTime;
    this.maxLife = this.life;
    this.alive = true;
    this.owner = 'boss';
    this.width = 18;
    this.didHit = false;
  }
  update(dt) {
    this.life -= dt;
    if (this.life <= 0) { this.alive = false; return; }
    // telegraph 中は判定なし
    if (this.life > this.activeTime) return;
    if (this.didHit || !player.alive) return;
    const dx = player.x - this.startX, dy = player.y - this.startY;
    const proj = dx * this.dir.x + dy * this.dir.y;
    if (proj < 0 || proj > this.range) return;
    const perpX = dx - proj * this.dir.x;
    const perpY = dy - proj * this.dir.y;
    const perp = Math.hypot(perpX, perpY);
    if (perp < this.width / 2 + player.r) {
      if (player.hit()) this.didHit = true;
    }
  }
  draw(ctx) {
    ctx.save();
    ctx.translate(this.startX, this.startY);
    ctx.rotate(Math.atan2(this.dir.y, this.dir.x));
    if (this.life > this.activeTime) {
      // telegraph 警告
      const a = 0.45 + 0.4 * Math.sin(this.life * 30);
      ctx.strokeStyle = `rgba(255, 60, 60, ${a})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(this.range, 0);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      // active ビーム
      const t = this.life / this.activeTime;
      const w = this.width * Math.max(0.4, t);
      ctx.fillStyle = `rgba(255, 80, 60, ${t * 0.4})`;
      ctx.fillRect(0, -w * 2, this.range, w * 4);
      ctx.fillStyle = `rgba(255, 220, 80, ${t * 0.9})`;
      ctx.fillRect(0, -w * 0.7, this.range, w * 1.4);
      ctx.fillStyle = `rgba(255, 255, 255, ${t})`;
      ctx.fillRect(0, -w / 2.4, this.range, w / 1.2);
    }
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

// ---- ボス4: 爆弾（ラスボス） ---------------------------------------
class BombBoss extends Boss {
  constructor() {
    super(CENTER.x, CENTER.y - 100);
    this.r = 32;
    // 第一形態のmode: idle | telegraphOffscreen | flyingOffscreen | cannonBarrage | returnToArena
    //                | throwTelegraph | throwingBombs
    //                | chargeTelegraph | charging | selfDestructWindup | cooldown
    // 第二形態追加mode: reviving | rapidFireTelegraph | rapidFire
    //                  | telegraphSummon | flyingToSummon | summonHold
    this.mode = 'idle';
    this.modeTimer = 2.5;
    this.angle = 0;
    this.fuseSpark = 0;
    this.bobTimer = 0;
    this.startPos = null;
    this.targetPos = null;
    this.cannonCooldown = 0;
    this.bombsLeft = 0;
    this.bombCooldown = 0;
    this.rapidFireCooldown = 0;
    this.revived = false; // 一度倒されると true、第二形態突入
  }
  isAttacking() { return this.mode === 'charging'; }
  takeDamage(amount) {
    if (!this.alive) return;
    if (this.mode === 'reviving') return; // 復活演出中は無敵
    this.hp -= amount;
    this.hitFlash = 0.18;
    if (this.hp <= 0) {
      if (!this.revived) {
        // 第二形態へ復活：HP満タンで再生
        this.revived = true;
        this.hp = BOSS_MAX_HP;
        this.mode = 'reviving';
        this.modeTimer = 1.8;
        // 中央付近へ復帰
        effects.push({ type: 'bossDeath', x: this.x, y: this.y, life: 1.0, maxLife: 1.0 });
        effects.push({ type: 'aoe', x: this.x, y: this.y, r: 90, life: 0.6, maxLife: 0.6 });
        return;
      }
      this.hp = 0;
      this.alive = false;
      effects.push({ type: 'bossDeath', x: this.x, y: this.y, life: 1.5, maxLife: 1.5 });
      // 子分も巻き添えで消滅
      for (const m of minions) {
        if (m.alive) {
          m.alive = false;
          effects.push({ type: 'aoe', x: m.x, y: m.y, r: 30, life: 0.4, maxLife: 0.4 });
        }
      }
    }
  }
  pickNextAttack() {
    const c = Math.random();
    if (!this.revived) {
      if (c < 0.35) {
        this.mode = 'telegraphOffscreen';
        this.modeTimer = 0.7;
      } else if (c < 0.7) {
        this.mode = 'throwTelegraph';
        this.modeTimer = 0.5;
        this.bombsLeft = 3;
        this.bombCooldown = 0;
      } else {
        this.mode = 'chargeTelegraph';
        this.modeTimer = 0.6;
      }
      return;
    }
    // 第二形態：既存の3パターン + 連射 + 子分召喚
    const canSummon = minions.length === 0;
    if (c < 0.2) {
      this.mode = 'telegraphOffscreen';
      this.modeTimer = 0.7;
    } else if (c < 0.4) {
      this.mode = 'throwTelegraph';
      this.modeTimer = 0.5;
      this.bombsLeft = 3;
      this.bombCooldown = 0;
    } else if (c < 0.6) {
      this.mode = 'chargeTelegraph';
      this.modeTimer = 0.6;
    } else if (c < 0.8 || !canSummon) {
      this.mode = 'rapidFireTelegraph';
      this.modeTimer = 0.7;
    } else {
      this.mode = 'telegraphSummon';
      this.modeTimer = 0.8;
    }
  }
  update(dt) {
    if (!this.alive) return;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    this.modeTimer -= dt;
    this.fuseSpark += dt * 12;
    this.bobTimer += dt;

    if (this.mode === 'idle') {
      // ホームポジションへ漂う
      const homeX = CENTER.x;
      const homeY = CENTER.y - 100;
      this.x += (homeX - this.x) * 0.04;
      this.y += (homeY - this.y) * 0.04 + Math.sin(this.bobTimer * 2) * 0.3;
      this.angle = Math.sin(this.bobTimer * 1.5) * 0.08;
      if (this.modeTimer <= 0) this.pickNextAttack();
    } else if (this.mode === 'reviving') {
      // 復活演出：中央へ漂いつつ火花を強く出す
      this.fuseSpark += dt * 36;
      this.angle += dt * 8;
      this.x += (CENTER.x - this.x) * 0.05;
      this.y += ((CENTER.y - 100) - this.y) * 0.05;
      if (this.modeTimer <= 0) {
        this.mode = 'idle';
        this.modeTimer = 1.4;
      }
    } else if (this.mode === 'rapidFireTelegraph') {
      this.angle += dt * 8;
      this.fuseSpark += dt * 22;
      if (this.modeTimer <= 0) {
        this.mode = 'rapidFire';
        this.modeTimer = 3.0;
        this.rapidFireCooldown = 0;
      }
    } else if (this.mode === 'rapidFire') {
      // 3秒間ボムを連射
      this.angle += dt * 4;
      this.rapidFireCooldown -= dt;
      if (this.rapidFireCooldown <= 0) {
        const tx = player.x + (Math.random() - 0.5) * 110;
        const ty = player.y + (Math.random() - 0.5) * 110;
        projectiles.push(new BombProjectile(this.x, this.y, tx, ty, 0.55, 42, 'thrown', false));
        this.rapidFireCooldown = 0.26;
      }
      if (this.modeTimer <= 0) {
        this.mode = 'idle';
        this.modeTimer = 1.8;
      }
    } else if (this.mode === 'telegraphSummon') {
      this.angle += dt * 5;
      this.fuseSpark += dt * 14;
      if (this.modeTimer <= 0) {
        const sides = [
          { x: CENTER.x, y: 40 },
          { x: CENTER.x, y: H - 40 },
          { x: 40, y: CENTER.y },
          { x: W - 40, y: CENTER.y },
        ];
        this.startPos = { x: this.x, y: this.y };
        this.targetPos = sides[Math.floor(Math.random() * sides.length)];
        this.mode = 'flyingToSummon';
        this.modeTimer = 0.6;
      }
    } else if (this.mode === 'flyingToSummon') {
      const t = 1 - Math.max(0, this.modeTimer) / 0.6;
      this.x = this.startPos.x + (this.targetPos.x - this.startPos.x) * t;
      this.y = this.startPos.y + (this.targetPos.y - this.startPos.y) * t;
      this.angle += dt * 4;
      if (this.modeTimer <= 0) {
        this.x = this.targetPos.x;
        this.y = this.targetPos.y;
        // アリーナ内に対角の位置で2体召喚
        const a = Math.random() * Math.PI * 2;
        const dist = 140;
        const m1 = new BombMinion(CENTER.x + Math.cos(a) * dist, CENTER.y + Math.sin(a) * dist);
        const m2 = new BombMinion(CENTER.x + Math.cos(a + Math.PI) * dist, CENTER.y + Math.sin(a + Math.PI) * dist);
        minions.push(m1, m2);
        effects.push({ type: 'spark', x: m1.x, y: m1.y, life: 0.4 });
        effects.push({ type: 'spark', x: m2.x, y: m2.y, life: 0.4 });
        this.mode = 'summonHold';
        // 子分が生存中はずっと場外。安全のため15秒上限。
        this.modeTimer = 15.0;
      }
    } else if (this.mode === 'summonHold') {
      this.angle += dt * 0.6; // 静かに揺れる
      const aliveCount = minions.reduce((n, m) => n + (m.alive ? 1 : 0), 0);
      if (aliveCount === 0 || this.modeTimer <= 0) {
        this.startPos = { x: this.x, y: this.y };
        this.targetPos = { x: CENTER.x, y: CENTER.y - 100 };
        this.mode = 'returnToArena';
        this.modeTimer = 0.7;
      }
    } else if (this.mode === 'telegraphOffscreen') {
      this.angle += dt * 5;
      if (this.modeTimer <= 0) {
        // 画面外（アリーナの外側、キャンバスの縁）の位置を選ぶ
        const sides = [
          { x: CENTER.x, y: 40 },
          { x: CENTER.x, y: H - 40 },
          { x: 40, y: CENTER.y },
          { x: W - 40, y: CENTER.y },
        ];
        this.startPos = { x: this.x, y: this.y };
        this.targetPos = sides[Math.floor(Math.random() * sides.length)];
        this.mode = 'flyingOffscreen';
        this.modeTimer = 0.7;
      }
    } else if (this.mode === 'flyingOffscreen') {
      const t = 1 - Math.max(0, this.modeTimer) / 0.7;
      this.x = this.startPos.x + (this.targetPos.x - this.startPos.x) * t;
      this.y = this.startPos.y + (this.targetPos.y - this.startPos.y) * t;
      this.angle += dt * 4;
      if (this.modeTimer <= 0) {
        this.x = this.targetPos.x;
        this.y = this.targetPos.y;
        this.mode = 'cannonBarrage';
        this.modeTimer = 3.6;
        this.cannonCooldown = 0.4;
      }
    } else if (this.mode === 'cannonBarrage') {
      this.cannonCooldown -= dt;
      this.angle = Math.sin(this.bobTimer * 3) * 0.18;
      if (this.cannonCooldown <= 0) {
        // プレイヤー近辺へ大砲弾
        const tx = player.x + (Math.random() - 0.5) * 80;
        const ty = player.y + (Math.random() - 0.5) * 80;
        projectiles.push(new BombProjectile(this.x, this.y, tx, ty, 1.0, 70, 'cannon', false));
        this.cannonCooldown = 0.85;
      }
      if (this.modeTimer <= 0) {
        this.startPos = { x: this.x, y: this.y };
        this.targetPos = { x: CENTER.x, y: CENTER.y - 100 };
        this.mode = 'returnToArena';
        this.modeTimer = 0.7;
      }
    } else if (this.mode === 'returnToArena') {
      const t = 1 - Math.max(0, this.modeTimer) / 0.7;
      this.x = this.startPos.x + (this.targetPos.x - this.startPos.x) * t;
      this.y = this.startPos.y + (this.targetPos.y - this.startPos.y) * t;
      this.angle += dt * 4;
      if (this.modeTimer <= 0) {
        this.mode = 'idle';
        this.modeTimer = 1.5;
      }
    } else if (this.mode === 'throwTelegraph') {
      this.angle += dt * 4;
      if (this.modeTimer <= 0) {
        this.mode = 'throwingBombs';
        this.modeTimer = 2.0;
        this.bombCooldown = 0;
      }
    } else if (this.mode === 'throwingBombs') {
      this.bombCooldown -= dt;
      this.angle = Math.sin(this.bobTimer * 5) * 0.2;
      if (this.bombCooldown <= 0 && this.bombsLeft > 0) {
        projectiles.push(new BombProjectile(this.x, this.y, player.x, player.y, 0.8, 55, 'thrown', false));
        this.bombsLeft--;
        this.bombCooldown = 0.55;
      }
      if (this.bombsLeft <= 0 && this.bombCooldown <= -0.3) {
        this.mode = 'idle';
        this.modeTimer = 1.5;
      }
    } else if (this.mode === 'chargeTelegraph') {
      this.angle += dt * 6;
      this.fuseSpark += dt * 18;
      if (this.modeTimer <= 0) {
        this.mode = 'charging';
        this.modeTimer = 2.5;
      }
    } else if (this.mode === 'charging') {
      this.angle += dt * 9;
      this.fuseSpark += dt * 18;
      const dx = player.x - this.x, dy = player.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      const speed = 3.8;
      this.x += dx / d * speed;
      this.y += dy / d * speed;
      // アリーナ内に制限
      const ddx = this.x - CENTER.x, ddy = this.y - CENTER.y;
      const ad = Math.hypot(ddx, ddy);
      if (ad > ARENA_R - this.r) {
        this.x = CENTER.x + ddx / ad * (ARENA_R - this.r);
        this.y = CENTER.y + ddy / ad * (ARENA_R - this.r);
      }
      // 突進中は接触ダメージなし。爆発（selfDestructWindup の終了時）のみダメージ。
      // プレイヤーに到達 or タイムアウトで停止
      if (d < this.r + player.r + 5 || this.modeTimer <= 0) {
        this.mode = 'selfDestructWindup';
        this.modeTimer = 1.0;
      }
    } else if (this.mode === 'selfDestructWindup') {
      this.fuseSpark += dt * 40;
      this.angle += dt * 4;
      if (this.modeTimer <= 0) {
        const explodeR = 95;
        effects.push({ type: 'aoe', x: this.x, y: this.y, r: explodeR, life: 0.7, maxLife: 0.7 });
        effects.push({ type: 'spark', x: this.x, y: this.y, life: 0.6 });
        if (player.alive && Math.hypot(player.x - this.x, player.y - this.y) < explodeR) {
          player.hit();
        }
        this.mode = 'cooldown';
        this.modeTimer = 5.0;
      }
    } else if (this.mode === 'cooldown') {
      // ぐったり。ホームへゆっくり戻る
      this.angle += dt * 0.4;
      this.x += (CENTER.x - this.x) * 0.006;
      this.y += ((CENTER.y - 100) - this.y) * 0.006;
      if (this.modeTimer <= 0) {
        this.mode = 'idle';
        this.modeTimer = 1.5;
      }
    }
  }
  draw(ctx) {
    this.baseDraw(function() {
      ctx.translate(this.x, this.y);

      // 復活演出のオーラ
      if (this.mode === 'reviving') {
        const t = 1 - this.modeTimer / 1.8;
        ctx.strokeStyle = `rgba(255, 120, 50, ${0.75 - t * 0.45})`;
        ctx.fillStyle = `rgba(255, 120, 50, 0.16)`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, 50 + Math.sin(t * 28) * 10, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        // 放射状の輝き
        ctx.strokeStyle = `rgba(255, 220, 100, ${0.7 - t * 0.6})`;
        ctx.lineWidth = 2;
        for (let i = 0; i < 8; i++) {
          const a = i / 8 * Math.PI * 2 + t * 4;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * 40, Math.sin(a) * 40);
          ctx.lineTo(Math.cos(a) * 80, Math.sin(a) * 80);
          ctx.stroke();
        }
      }
      // 自爆カウントダウン用の警告リング（回転前に描画）
      if (this.mode === 'selfDestructWindup') {
        const t = 1 - this.modeTimer;
        ctx.strokeStyle = `rgba(255, 60, 60, ${0.6 + 0.4 * Math.sin(t * 30)})`;
        ctx.fillStyle = `rgba(255, 60, 60, 0.1)`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 95, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }
      // 突進予告：照準線
      if (this.mode === 'chargeTelegraph') {
        const dx = player.x - this.x, dy = player.y - this.y;
        const ang = Math.atan2(dy, dx);
        ctx.strokeStyle = 'rgba(255, 80, 60, 0.55)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * 40, Math.sin(ang) * 40);
        ctx.lineTo(Math.cos(ang) * 320, Math.sin(ang) * 320);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 本体の色（第二形態はデフォルトが赤暗）
      const baseColor = this.revived ? '#3a2a30' : '#3a3a44';
      let bodyColor = baseColor;
      if (this.mode === 'chargeTelegraph') {
        bodyColor = (Math.floor(this.modeTimer * 18) % 2 === 0) ? '#d04040' : baseColor;
      } else if (this.mode === 'charging') {
        bodyColor = '#d04040';
      } else if (this.mode === 'selfDestructWindup') {
        const t = 1 - this.modeTimer;
        bodyColor = (Math.floor(t * 25) % 2 === 0) ? '#ff5050' : '#a01010';
      } else if (this.mode === 'telegraphOffscreen' || this.mode === 'throwTelegraph') {
        bodyColor = (Math.floor(this.modeTimer * 18) % 2 === 0) ? '#806820' : baseColor;
      } else if (this.mode === 'cooldown') {
        bodyColor = '#5a5a64';
      } else if (this.mode === 'rapidFireTelegraph' || this.mode === 'rapidFire') {
        bodyColor = (Math.floor(this.fuseSpark) % 2 === 0) ? '#ff8030' : baseColor;
      } else if (this.mode === 'telegraphSummon' || this.mode === 'flyingToSummon' || this.mode === 'summonHold') {
        bodyColor = (Math.floor(this.modeTimer * 16) % 2 === 0) ? '#7050d0' : baseColor;
      } else if (this.mode === 'reviving') {
        bodyColor = (Math.floor(this.modeTimer * 25) % 2 === 0) ? '#ffd040' : '#ff6060';
      }

      // 自爆中のパルススケール
      let scale = 1;
      if (this.mode === 'selfDestructWindup') {
        scale = 1 + (1 - this.modeTimer) * 0.18 + Math.sin(this.fuseSpark) * 0.05;
      }

      // 両手のボム（装飾、ワールド向き）
      const handBombDist = this.r + 14;
      const handBombR = 10;
      const handBob = Math.sin(this.bobTimer * 3) * 2;
      for (const sign of [-1, 1]) {
        ctx.save();
        ctx.translate(sign * handBombDist, 8 + handBob);
        ctx.fillStyle = '#3a3a44';
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, handBombR, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.beginPath(); ctx.arc(-3, -3, 2.5, 0, Math.PI * 2); ctx.fill();
        // 導火線
        ctx.strokeStyle = '#3a2818';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, -handBombR);
        ctx.quadraticCurveTo(3, -handBombR - 4, 1, -handBombR - 9);
        ctx.stroke();
        ctx.lineCap = 'butt';
        // 火花
        const hs = 1.6 + Math.sin(this.fuseSpark + sign * 0.7) * 0.6;
        ctx.fillStyle = '#ffd040';
        ctx.beginPath(); ctx.arc(1, -handBombR - 9, hs, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff5b0';
        ctx.beginPath(); ctx.arc(1, -handBombR - 9, hs * 0.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }

      ctx.save();
      ctx.scale(scale, scale);
      ctx.rotate(this.angle);

      // 本体（球）
      ctx.fillStyle = bodyColor;
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, this.r, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      // ハイライト
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.beginPath();
      ctx.arc(-this.r * 0.35, -this.r * 0.4, this.r * 0.28, 0, Math.PI * 2);
      ctx.fill();

      // 導火線
      ctx.strokeStyle = '#3a2818';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, -this.r);
      ctx.quadraticCurveTo(10, -this.r - 18, 6, -this.r - 36);
      ctx.stroke();
      // 縞模様
      ctx.strokeStyle = '#6a4a30';
      ctx.lineWidth = 1.4;
      for (let i = 1; i <= 6; i++) {
        const tt = i / 7;
        const px = 10 * (2 * tt - tt * tt);
        const py = -this.r - 36 * tt;
        ctx.beginPath();
        ctx.moveTo(px - 3, py + 1);
        ctx.lineTo(px + 3, py - 1);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
      // 火花
      const tipX = 6, tipY = -this.r - 36;
      const sparkR = 4 + Math.sin(this.fuseSpark) * 1.5;
      ctx.fillStyle = '#ffd040';
      ctx.beginPath();
      ctx.arc(tipX, tipY, sparkR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff5b0';
      ctx.beginPath();
      ctx.arc(tipX, tipY, sparkR * 0.55, 0, Math.PI * 2);
      ctx.fill();
      // 火花の放射
      ctx.strokeStyle = '#ffd040';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * Math.PI * 2 + this.fuseSpark * 0.3;
        ctx.beginPath();
        ctx.moveTo(tipX + Math.cos(a) * sparkR, tipY + Math.sin(a) * sparkR);
        ctx.lineTo(tipX + Math.cos(a) * (sparkR + 4), tipY + Math.sin(a) * (sparkR + 4));
        ctx.stroke();
      }

      // 怒り目
      const eyeY = -this.r * 0.12;
      // 左目
      ctx.fillStyle = '#1a1a1a';
      ctx.save();
      ctx.translate(-this.r * 0.32, eyeY);
      ctx.beginPath();
      ctx.moveTo(-9, -8);
      ctx.lineTo(10, -1);
      ctx.lineTo(7, 8);
      ctx.lineTo(-4, 8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(2, 2, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // 右目
      ctx.save();
      ctx.translate(this.r * 0.32, eyeY);
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath();
      ctx.moveTo(9, -8);
      ctx.lineTo(-10, -1);
      ctx.lineTo(-7, 8);
      ctx.lineTo(4, 8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(-2, 2, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // クールダウン中はぐるぐる目
      if (this.mode === 'cooldown') {
        ctx.fillStyle = bodyColor;
        // 目を覆う
        ctx.fillRect(-this.r * 0.32 - 10, eyeY - 9, 22, 19);
        ctx.fillRect(this.r * 0.32 - 12, eyeY - 9, 22, 19);
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 2;
        const swirl = this.bobTimer * 4;
        for (const sx of [-this.r * 0.32, this.r * 0.32]) {
          ctx.beginPath();
          for (let i = 0; i < 20; i++) {
            const r = i * 0.4;
            const a = i * 0.5 + swirl;
            const px = sx + Math.cos(a) * r;
            const py = eyeY + Math.sin(a) * r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
      }

      ctx.restore();
    });
  }
}

// 爆弾ボスの子分（小型爆弾、逃げながら投擲）
class BombMinion {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.r = 16;
    this.maxHp = 10;
    this.hp = this.maxHp;
    this.alive = true;
    this.hitFlash = 0;
    this.mode = 'spawn'; // spawn -> flee
    this.modeTimer = 0.5;
    this.throwCooldown = 1.6;
    this.angle = 0;
    this.bobTimer = 0;
    this.fuseSpark = 0;
  }
  takeDamage(amount) {
    if (!this.alive) return;
    this.hp -= amount;
    this.hitFlash = 0.16;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      effects.push({ type: 'aoe', x: this.x, y: this.y, r: 32, life: 0.4, maxLife: 0.4 });
      effects.push({ type: 'spark', x: this.x, y: this.y, life: 0.4 });
    }
  }
  update(dt) {
    if (!this.alive) return;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    this.bobTimer += dt;
    this.fuseSpark += dt * 12;

    if (this.mode === 'spawn') {
      this.modeTimer -= dt;
      this.angle += dt * 6;
      if (this.modeTimer <= 0) this.mode = 'flee';
      return;
    }

    // プレイヤーから逃げる（遠いときは横移動）
    const dx = this.x - player.x, dy = this.y - player.y;
    const d = Math.hypot(dx, dy) || 1;
    let mvx, mvy;
    if (d < 220) {
      const sp = 2.5;
      mvx = dx / d * sp;
      mvy = dy / d * sp;
    } else {
      const sp = 1.4;
      mvx = -dy / d * sp;
      mvy = dx / d * sp;
    }
    this.x += mvx;
    this.y += mvy;

    // アリーナ内に制限
    const ddx = this.x - CENTER.x, ddy = this.y - CENTER.y;
    const ad = Math.hypot(ddx, ddy);
    if (ad > ARENA_R - this.r - 20) {
      this.x = CENTER.x + ddx / ad * (ARENA_R - this.r - 20);
      this.y = CENTER.y + ddy / ad * (ARENA_R - this.r - 20);
    }
    this.angle = Math.sin(this.bobTimer * 4) * 0.18;

    // 投擲
    this.throwCooldown -= dt;
    if (this.throwCooldown <= 0) {
      projectiles.push(new BombProjectile(this.x, this.y, player.x, player.y, 0.7, 42, 'thrown'));
      this.throwCooldown = 1.8 + Math.random() * 0.6;
    }
  }
  draw(ctx) {
    if (!this.alive) return;
    ctx.save();
    if (this.hitFlash > 0) {
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 14;
    }
    ctx.translate(this.x, this.y);

    let scale = 1;
    if (this.mode === 'spawn') {
      scale = 1 - this.modeTimer / 0.5;
    }
    ctx.save();
    ctx.scale(scale, scale);
    ctx.rotate(this.angle);

    // 本体
    ctx.fillStyle = '#3a2a30';
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, this.r, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    // ハイライト
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.arc(-this.r * 0.35, -this.r * 0.4, this.r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    // 導火線
    ctx.strokeStyle = '#3a2818';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -this.r);
    ctx.quadraticCurveTo(5, -this.r - 10, 3, -this.r - 18);
    ctx.stroke();
    ctx.lineCap = 'butt';
    // 火花
    const sparkR = 2.4 + Math.sin(this.fuseSpark) * 1;
    ctx.fillStyle = '#ffd040';
    ctx.beginPath();
    ctx.arc(3, -this.r - 18, sparkR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff5b0';
    ctx.beginPath();
    ctx.arc(3, -this.r - 18, sparkR * 0.5, 0, Math.PI * 2);
    ctx.fill();
    // 小さな怒り目
    ctx.fillStyle = '#1a1a1a';
    ctx.save();
    ctx.translate(-5, -1);
    ctx.beginPath();
    ctx.moveTo(-4, -4); ctx.lineTo(5, 0); ctx.lineTo(3, 4); ctx.lineTo(-2, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(5, -1);
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.moveTo(4, -4); ctx.lineTo(-5, 0); ctx.lineTo(-3, 4); ctx.lineTo(2, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.restore();

    // HPバー（被弾後のみ）
    if (this.hp < this.maxHp) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(-this.r, -this.r - 12, this.r * 2, 3);
      ctx.fillStyle = '#d63636';
      ctx.fillRect(-this.r, -this.r - 12, this.r * 2 * (this.hp / this.maxHp), 3);
    }
    ctx.restore();
  }
}

// ---- 隠しボス: ノコギリ ---------------------------------------------
// 体力200。登場演出（体→目→左手→右手）、4種の攻撃パターン、
// 一度倒すと体力100で復活し移動速度+5%。
class SawBoss extends Boss {
  constructor(speedMult) {
    super(CENTER.x, CENTER.y - 80);
    this.r = 42;
    this.maxHp = BOSS_MAX_HP;
    this.hp = BOSS_MAX_HP;
    this.speedMult = speedMult || 1;
    this.revived = false;

    // 登場演出: introBody → introEye → introLeft → introRight → idle
    this.mode = 'introBody';
    this.modeTimer = 0.9;
    this.bodyAlpha = 0;
    this.spinAngle = 0;

    // パーツの付着フラグ
    this.eyeAttached = false;
    this.leftAttached = false;
    this.rightAttached = false;

    // 手の独立位置（離れているときも、付いているときも常に値を更新する）
    this.leftHand = { x: this.x - 36, y: this.y + 12 };
    this.rightHand = { x: this.x + 36, y: this.y + 12 };

    // 突進
    this.vx = 0; this.vy = 0;
    this.bounces = 0;
    this.maxBounces = 10;

    // 右手ビーム
    this.beamCooldown = 0;
    this.beamMoveDir = 1;
    this.beamFromX = 0;
    this.beamToX = 0;

    // 左手爆弾
    this.bombCooldown = 0;

    // 円周移動
    this.circAngle = 0;
  }

  takeDamage(amount) {
    if (!this.alive) return;
    // 登場演出中と復活演出中は無敵
    const introModes = ['introBody', 'introEye', 'introLeft', 'introRight'];
    if (introModes.includes(this.mode) || this.mode === 'reviving') return;
    this.hp -= amount;
    this.hitFlash = 0.18;
    if (this.hp <= 0) {
      if (!this.revived) {
        // 復活: HP満タンで再生、速度+5%
        this.revived = true;
        this.maxHp = BOSS_MAX_HP;
        this.hp = BOSS_MAX_HP;
        this.speedMult *= 1.05;
        this.mode = 'reviving';
        this.modeTimer = 1.6;
        this.vx = 0; this.vy = 0;
        effects.push({ type: 'bossDeath', x: this.x, y: this.y, life: 1.0, maxLife: 1.0 });
        effects.push({ type: 'aoe', x: this.x, y: this.y, r: 100, life: 0.6, maxLife: 0.6 });
        return;
      }
      this.hp = 0;
      this.alive = false;
      effects.push({ type: 'bossDeath', x: this.x, y: this.y, life: 1.5, maxLife: 1.5 });
    }
  }

  isAttacking() {
    return this.mode === 'spinCharge' || this.mode === 'circumference';
  }

  pickNextAttack() {
    const choices = ['spinCharge', 'rightBeam', 'leftBomb', 'circumference'];
    const pick = choices[Math.floor(Math.random() * choices.length)];
    if (pick === 'spinCharge') {
      const dx = player.x - this.x, dy = player.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      const speed = 4.8 * this.speedMult;
      this.vx = dx / d * speed;
      this.vy = dy / d * speed;
      this.bounces = 0;
      this.mode = 'spinCharge';
      this.modeTimer = 30.0; // 念のための上限（通常は10バウンスで終わる）
    } else if (pick === 'rightBeam') {
      // ボス本体がアリーナ上部の端→反対側の端へスライドしながら、右手から真下へビームを撃つ
      this.beamMoveDir = (Math.random() < 0.5) ? 1 : -1;
      const r = ARENA_R - 80;
      this.beamFromX = CENTER.x + (-this.beamMoveDir) * r;
      this.beamToX = CENTER.x + this.beamMoveDir * r;
      this.beamY = CENTER.y - ARENA_R + 80;
      this.startPos = { x: this.x, y: this.y };
      this.rightAttached = true;
      this.mode = 'rightBeamFlyOut';
      this.modeTimer = 0.6;
      this.beamCooldown = 0.5;
    } else if (pick === 'leftBomb') {
      this.leftHand.x = this.x - 36;
      this.leftHand.y = this.y + 12;
      this.leftHand.startX = this.leftHand.x;
      this.leftHand.startY = this.leftHand.y;
      this.leftHand.targetX = CENTER.x + (Math.random() < 0.5 ? -1 : 1) * 80;
      this.leftHand.targetY = CENTER.y - ARENA_R + 70;
      this.leftAttached = false;
      this.mode = 'leftBombFlyOut';
      this.modeTimer = 0.5;
      this.bombCooldown = 0;
    } else if (pick === 'circumference') {
      const dx = this.x - CENTER.x, dy = this.y - CENTER.y;
      this.circAngle = Math.atan2(dy, dx);
      this.mode = 'circumferenceStart';
      this.modeTimer = 0.5;
    }
  }

  update(dt) {
    if (!this.alive) return;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    this.modeTimer -= dt;

    // 刃の回転（モードによって速度可変）
    let spinRate = 4;
    if (this.mode === 'spinCharge') spinRate = 18;
    else if (this.mode === 'circumference') spinRate = 14;
    else if (this.mode === 'reviving') spinRate = 16;
    this.spinAngle += dt * spinRate;

    // ---- 登場演出 ----
    if (this.mode === 'introBody') {
      this.bodyAlpha = Math.min(1, 1 - this.modeTimer / 0.9);
      if (this.modeTimer <= 0) {
        this.bodyAlpha = 1;
        this.mode = 'introEye';
        this.modeTimer = 0.75;
      }
    } else if (this.mode === 'introEye') {
      if (this.modeTimer <= 0) {
        this.eyeAttached = true;
        effects.push({ type: 'spark', x: this.x, y: this.y, life: 0.4 });
        this.mode = 'introLeft';
        this.modeTimer = 0.75;
      }
    } else if (this.mode === 'introLeft') {
      if (this.modeTimer <= 0) {
        this.leftAttached = true;
        effects.push({ type: 'spark', x: this.x - 36, y: this.y + 12, life: 0.4 });
        this.mode = 'introRight';
        this.modeTimer = 0.75;
      }
    } else if (this.mode === 'introRight') {
      if (this.modeTimer <= 0) {
        this.rightAttached = true;
        effects.push({ type: 'spark', x: this.x + 36, y: this.y + 12, life: 0.4 });
        this.mode = 'idle';
        this.modeTimer = 0.6;
      }
    } else if (this.mode === 'idle') {
      // 攻撃間の短い静止（クールダウン無し）
      if (this.modeTimer <= 0) this.pickNextAttack();
    } else if (this.mode === 'reviving') {
      // 復活演出
      if (this.modeTimer <= 0) {
        this.mode = 'idle';
        this.modeTimer = 0.5;
      }
    }
    // ---- 攻撃モード ----
    else if (this.mode === 'spinCharge') {
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
        effects.push({ type: 'spark', x: this.x, y: this.y, life: 0.3 });
        if (this.bounces >= this.maxBounces) {
          this.vx = 0; this.vy = 0;
          this.mode = 'idle';
          this.modeTimer = 0.5;
        }
      }
      if (this.mode === 'spinCharge' && player.alive &&
          Math.hypot(player.x - this.x, player.y - this.y) < this.r + player.r) {
        player.hit();
      }
      if (this.modeTimer <= 0) {
        this.vx = 0; this.vy = 0;
        this.mode = 'idle';
        this.modeTimer = 0.5;
      }
    } else if (this.mode === 'rightBeamFlyOut') {
      // ボス本体を開始位置（端、上部）へ移動
      const t = 1 - Math.max(0, this.modeTimer) / 0.6;
      this.x = this.startPos.x + (this.beamFromX - this.startPos.x) * t;
      this.y = this.startPos.y + (this.beamY - this.startPos.y) * t;
      if (this.modeTimer <= 0) {
        this.x = this.beamFromX;
        this.y = this.beamY;
        this.mode = 'rightBeam';
        this.modeTimer = 3.5;
        this.beamCooldown = 0.4;
      }
    } else if (this.mode === 'rightBeam') {
      // ボス本体が beamFromX → beamToX へ横スライド。右手は付いたまま、真下にビームを撃つ
      const range = Math.abs(this.beamToX - this.beamFromX);
      const sp = (range / 3.5) * dt * this.speedMult;
      const dirX = (this.beamToX > this.beamFromX) ? 1 : -1;
      this.x += dirX * sp;
      if ((dirX > 0 && this.x >= this.beamToX) ||
          (dirX < 0 && this.x <= this.beamToX)) {
        this.x = this.beamToX;
      }
      this.beamCooldown -= dt;
      if (this.beamCooldown <= 0) {
        projectiles.push(new Beam(this.rightHand.x, this.rightHand.y, { x: 0, y: 1 }));
        this.beamCooldown = 1.0;
      }
      if (this.modeTimer <= 0) {
        this.mode = 'rightBeamReturn';
        this.modeTimer = 0.4;
      }
    } else if (this.mode === 'rightBeamReturn') {
      // 短い余韻。本体は今の位置のままで次の攻撃へ
      if (this.modeTimer <= 0) {
        this.mode = 'idle';
        this.modeTimer = 0.3;
      }
    } else if (this.mode === 'leftBombFlyOut') {
      const t = 1 - Math.max(0, this.modeTimer) / 0.5;
      this.leftHand.x = this.leftHand.startX + (this.leftHand.targetX - this.leftHand.startX) * t;
      this.leftHand.y = this.leftHand.startY + (this.leftHand.targetY - this.leftHand.startY) * t;
      if (this.modeTimer <= 0) {
        this.leftHand.x = this.leftHand.targetX;
        this.leftHand.y = this.leftHand.targetY;
        this.mode = 'leftBomb';
        this.modeTimer = 5.0;
        this.bombCooldown = 0.25;
      }
    } else if (this.mode === 'leftBomb') {
      // 軽く揺れる
      this.leftHand.x += Math.sin(performance.now() / 90) * 0.4;
      this.bombCooldown -= dt;
      if (this.bombCooldown <= 0) {
        projectiles.push(new BombProjectile(
          this.leftHand.x, this.leftHand.y, player.x, player.y, 0.7, 45, 'thrown'));
        this.bombCooldown = 0.45;
      }
      if (this.modeTimer <= 0) {
        this.mode = 'leftBombReturn';
        this.modeTimer = 0.5;
      }
    } else if (this.mode === 'leftBombReturn') {
      const tx = this.x - 36, ty = this.y + 12;
      const dx = tx - this.leftHand.x, dy = ty - this.leftHand.y;
      const d = Math.hypot(dx, dy);
      const sp = 8;
      if (d > sp) {
        this.leftHand.x += dx / d * sp;
        this.leftHand.y += dy / d * sp;
      } else {
        this.leftHand.x = tx; this.leftHand.y = ty;
      }
      if (this.modeTimer <= 0) {
        this.leftAttached = true;
        this.mode = 'idle';
        this.modeTimer = 0.3;
      }
    } else if (this.mode === 'circumferenceStart') {
      // 円周上の初期位置へ近づく
      const r = ARENA_R - this.r - 16;
      const tx = CENTER.x + Math.cos(this.circAngle) * r;
      const ty = CENTER.y + Math.sin(this.circAngle) * r;
      this.x += (tx - this.x) * 0.2;
      this.y += (ty - this.y) * 0.2;
      if (this.modeTimer <= 0) {
        this.x = tx; this.y = ty;
        this.mode = 'circumference';
        this.modeTimer = 5.0;
      }
    } else if (this.mode === 'circumference') {
      this.circAngle += dt * 1.2 * this.speedMult;
      const r = ARENA_R - this.r - 16;
      this.x = CENTER.x + Math.cos(this.circAngle) * r;
      this.y = CENTER.y + Math.sin(this.circAngle) * r;
      if (player.alive &&
          Math.hypot(player.x - this.x, player.y - this.y) < this.r + player.r) {
        player.hit();
      }
      if (this.modeTimer <= 0) {
        this.mode = 'idle';
        this.modeTimer = 0.4;
      }
    }

    // 付着中の手は本体に追従
    if (this.rightAttached) {
      this.rightHand.x = this.x + 36;
      this.rightHand.y = this.y + 12 + Math.sin(performance.now() / 320) * 1.5;
    }
    if (this.leftAttached) {
      this.leftHand.x = this.x - 36;
      this.leftHand.y = this.y + 12 + Math.sin(performance.now() / 320 + 1) * 1.5;
    }
  }

  // 補間用: 場外の出現位置から本体への着弾位置
  introEyePos() {
    const t = 1 - this.modeTimer / 0.75;
    const fromX = this.x + 320, fromY = this.y - 220;
    return { x: fromX + (this.x - fromX) * t, y: fromY + (this.y - fromY) * t };
  }
  introLeftPos() {
    const t = 1 - this.modeTimer / 0.75;
    const fromX = this.x - 360, fromY = this.y + 240;
    const tx = this.x - 36, ty = this.y + 12;
    return { x: fromX + (tx - fromX) * t, y: fromY + (ty - fromY) * t };
  }
  introRightPos() {
    const t = 1 - this.modeTimer / 0.75;
    const fromX = this.x + 360, fromY = this.y + 240;
    const tx = this.x + 36, ty = this.y + 12;
    return { x: fromX + (tx - fromX) * t, y: fromY + (ty - fromY) * t };
  }

  draw(ctx) {
    this.baseDraw(function() {
      // 復活演出のオーラ
      if (this.mode === 'reviving') {
        const t = 1 - this.modeTimer / 1.6;
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.strokeStyle = `rgba(255, 120, 50, ${0.75 - t * 0.45})`;
        ctx.fillStyle = `rgba(255, 120, 50, 0.16)`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, 55 + Math.sin(t * 28) * 10, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.strokeStyle = `rgba(255, 220, 100, ${0.7 - t * 0.6})`;
        ctx.lineWidth = 2;
        for (let i = 0; i < 8; i++) {
          const a = i / 8 * Math.PI * 2 + t * 4;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * 45, Math.sin(a) * 45);
          ctx.lineTo(Math.cos(a) * 90, Math.sin(a) * 90);
          ctx.stroke();
        }
        ctx.restore();
      }

      // ノコギリ本体
      let bodyColor = this.revived ? '#b8b8c8' : '#cdd1d8';
      if (this.mode === 'spinCharge') {
        bodyColor = '#ff7060';
      } else if (this.mode === 'reviving') {
        bodyColor = (Math.floor(this.modeTimer * 25) % 2 === 0) ? '#ffd040' : '#ff6060';
      }
      if (this.bodyAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = this.bodyAlpha;
        drawSawBlade(ctx, this.x, this.y, this.r, this.spinAngle, bodyColor);
        ctx.restore();
      }

      // プレイヤーへの視線
      const gx = player.x - this.x, gy = player.y - this.y;
      const gd = Math.hypot(gx, gy) || 1;
      const gaze = { x: gx / gd, y: gy / gd };

      // 目（中央。固定向き、瞳孔のみ動く）
      if (this.eyeAttached) {
        drawSawEye(ctx, this.x, this.y, gaze);
      } else if (this.mode === 'introEye') {
        const p = this.introEyePos();
        drawSawEye(ctx, p.x, p.y, gaze);
      }

      // 左手
      if (this.leftAttached || this.mode === 'leftBombFlyOut' ||
          this.mode === 'leftBomb' || this.mode === 'leftBombReturn') {
        let telegraph = null;
        if (this.mode === 'leftBomb' || this.mode === 'leftBombFlyOut') telegraph = 'bomb';
        drawSawHand(ctx, this.leftHand.x, this.leftHand.y, 'left', telegraph);
      } else if (this.mode === 'introLeft') {
        const p = this.introLeftPos();
        drawSawHand(ctx, p.x, p.y, 'left');
      }

      // 右手
      if (this.rightAttached || this.mode === 'rightBeamFlyOut' ||
          this.mode === 'rightBeam' || this.mode === 'rightBeamReturn') {
        let telegraph = null;
        if (this.mode === 'rightBeam' || this.mode === 'rightBeamFlyOut') telegraph = 'beam';
        drawSawHand(ctx, this.rightHand.x, this.rightHand.y, 'right', telegraph);
      } else if (this.mode === 'introRight') {
        const p = this.introRightPos();
        drawSawHand(ctx, p.x, p.y, 'right');
      }

      // spinCharge 中の警告リング
      if (this.mode === 'spinCharge') {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.strokeStyle = `rgba(255, 80, 60, ${0.3 + 0.25 * Math.sin(performance.now() / 60)})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, this.r + 16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // 残バウンス回数（突進中のみ）
      if (this.mode === 'spinCharge') {
        ctx.save();
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 3;
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        const txt = `あと${this.maxBounces - this.bounces}回`;
        ctx.strokeText(txt, this.x, this.y - this.r - 16);
        ctx.fillText(txt, this.x, this.y - this.r - 16);
        ctx.restore();
      }
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

// ノコギリ刃（外周にギザ歯のついた円盤）
function drawSawBlade(ctx, x, y, r, spinAngle, bodyColor) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spinAngle);
  const teeth = 14;
  const rOuter = r + 11;
  ctx.fillStyle = bodyColor || '#cdd1d8';
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a1 = (i / teeth) * Math.PI * 2;
    const a2 = ((i + 0.35) / teeth) * Math.PI * 2;
    const a3 = ((i + 0.55) / teeth) * Math.PI * 2;
    const a4 = ((i + 1) / teeth) * Math.PI * 2;
    if (i === 0) ctx.moveTo(Math.cos(a1) * r, Math.sin(a1) * r);
    ctx.lineTo(Math.cos(a2) * rOuter, Math.sin(a2) * rOuter);
    ctx.lineTo(Math.cos(a3) * rOuter, Math.sin(a3) * rOuter);
    ctx.lineTo(Math.cos(a4) * r, Math.sin(a4) * r);
  }
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // 内側のディスク
  ctx.fillStyle = '#a8a8b2';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(0, 0, r - 4, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  // 三本のアーム模様
  ctx.strokeStyle = '#6a6a72';
  ctx.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * (r - 6), Math.sin(a) * (r - 6));
    ctx.lineTo(Math.cos(a) * (r * 0.35), Math.sin(a) * (r * 0.35));
    ctx.stroke();
  }
  // 中央ハブ
  ctx.fillStyle = '#3a3a44';
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.32, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

// ノコギリボスの中央の大きな目
function drawSawEye(ctx, x, y, gaze) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(0, 0, 13, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  // 瞳孔（プレイヤー方向に少しズレる）
  const gx = gaze ? gaze.x * 4 : 0;
  const gy = gaze ? gaze.y * 4 : 0;
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.arc(gx, gy, 5.5, 0, Math.PI * 2);
  ctx.fill();
  // ハイライト
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(gx - 1.6, gy - 1.6, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ノコギリボスの手（拳）。サイズで左右共用。
function drawSawHand(ctx, x, y, side, telegraph) {
  ctx.save();
  ctx.translate(x, y);
  const r = 13;
  let color = '#cdd1d8';
  if (telegraph) {
    const flash = Math.floor(performance.now() / 80) % 2 === 0;
    color = flash ? (telegraph === 'beam' ? '#ff6060' : '#ff8030') : '#cdd1d8';
  }
  ctx.fillStyle = color;
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  // 親指
  const sx = (side === 'left') ? r * 0.7 : -r * 0.7;
  ctx.beginPath();
  ctx.arc(sx, -r * 0.55, r * 0.42, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  // 関節の点
  ctx.fillStyle = '#1a1a1a';
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.arc(i * 4, -2, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
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
    // 構え中は一回り大きく、より前方に。視認性アップ
    drawShield(ctx, 0, options.blocking ? -26 : -18, options.blocking ? 19 : 13);
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
  // 剣回転モード（強化）
  if (weapon === 'sword' && options.swordSpinning) {
    ctx.save();
    ctx.rotate(options.swordSpinAngle || 0);
    drawSword(ctx, 0, -34, 22);
    ctx.restore();
  }

  // 上向きのとき武器を体の後ろに（盾だけは常に体の前に描いて見えるようにする）
  const isSpinning = (weapon === 'hammer' && options.spinning) ||
                     (weapon === 'sword' && options.swordSpinning);
  if (facingUp && !isSpinning && weapon !== 'shield') {
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

  // 武器を体の前に（盾は上向きでも見えるように常にここで描く）
  if ((!facingUp || weapon === 'shield') && !isSpinning) {
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
      hammer: 'ハンマー: 範囲攻撃 (5、1秒溜め) / 長押しで回転攻撃 (1連続)',
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
    const bossMaxHp = boss.maxHp || BOSS_MAX_HP;
    ctx.fillRect(bx, by, bw * (boss.hp / bossMaxHp), bh);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    const isHidden = stages[stageIndex] === 'saw';
    const bossName = isHidden ? 'ノコギリのボス'
      : ['剣のボス', '弓のボス', 'ハンマーのボス', 'ラスボス'][stageIndex];
    const stageLabel = isHidden ? '隠しステージ' : `STAGE ${stageIndex + 1} / 4`;
    ctx.fillText(`${stageLabel}   ${bossName}`, W / 2, by + bh + 16);
  }
  // 武器アイコン
  ctx.save();
  ctx.translate(60, 60);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.arc(0, 0, 32, 0, Math.PI * 2); ctx.fill();
  if (player.weapon === 'sword') drawSword(ctx, 0, 12, 22);
  if (player.weapon === 'shield') drawShield(ctx, 0, -4, 16);
  if (player.weapon === 'hammer') drawHammer(ctx, 0, 16, 22);
  if (upgrades[player.weapon]) {
    ctx.fillStyle = '#ffd040';
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1.5;
    ctx.font = 'bold 18px serif';
    ctx.textAlign = 'center';
    ctx.strokeText('★', 22, -18);
    ctx.fillText('★', 22, -18);
  }
  ctx.restore();

  // 残機（ハート）
  ctx.save();
  for (let i = 0; i < 3; i++) {
    drawHeart(ctx, 110 + i * 28, 60, 10, i < player.lives);
  }
  ctx.restore();

  // コイン表示
  ctx.save();
  drawCoin(ctx, 60, 110, 12);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`x ${coins}`, 78, 116);
  ctx.restore();

  // 所持アイテム
  const ownedItems = ITEM_ORDER.filter(it => inventory[it] > 0);
  if (ownedItems.length) {
    ctx.save();
    let ix = 60;
    const iy = 150;
    for (const id of ITEM_ORDER) {
      if (!inventory[id]) continue;
      const isSel = id === selectedItem;
      if (isSel) {
        ctx.fillStyle = 'rgba(255, 220, 80, 0.35)';
        ctx.strokeStyle = '#ffd040';
        ctx.lineWidth = 2;
        roundRect(ctx, ix - 4, iy - 14, 50, 30, 6);
        ctx.fill(); ctx.stroke();
      }
      drawItemIcon(ctx, ix + 10, iy + 1, id, 11);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`x${inventory[id]}`, ix + 24, iy + 6);
      ix += 54;
    }
    ctx.fillStyle = '#ddd';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('B:使用 V:切替', 60, iy + 30);
    ctx.restore();
  }

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
    swordSpinning: player.swordSpinning,
    swordSpinAngle: player.swordSpinAngle,
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
  // 剣回転エフェクト
  if (player.swordSpinning) {
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.strokeStyle = 'rgba(140, 200, 255, 0.4)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 42, 0, Math.PI * 2);
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
  coins = 0;
  upgrades = { sword: false, shield: false, hammer: false };
  stages = ['sword', 'bow', 'hammer', 'bomb'];
  noHitRun = true;
  inventory = { poison: 0, potion: 0, bigPotion: 0, weaponSwap: 0 };
  selectedItem = 'poison';
  player = new Player(selectedWeapon);
  startStage(0);
}

// ---- アイテム操作 ------------------------------------------------------
function cycleSelectedItem() {
  const owned = ITEM_ORDER.filter(it => inventory[it] > 0);
  if (!owned.length) { selectedItem = ITEM_ORDER[0]; return; }
  const idx = owned.indexOf(selectedItem);
  selectedItem = owned[(idx + 1) % owned.length];
}

function useSelectedItem() {
  if (!inventory[selectedItem]) {
    cycleSelectedItem();
    if (!inventory[selectedItem]) return;
  }
  const id = selectedItem;
  inventory[id]--;
  applyItem(id);
  if (!inventory[id]) cycleSelectedItem();
}

function applyItem(id) {
  if (id === 'poison') {
    if (boss && boss.alive) {
      boss.poisonTimer = (boss.poisonTimer || 0) + POISON_DURATION;
      if (boss.poisonTick === undefined) boss.poisonTick = 1;
      effects.push({ type: 'spark', x: boss.x, y: boss.y, life: 0.5 });
    }
  } else if (id === 'potion') {
    if (player && player.alive && player.lives < 3) {
      player.lives++;
      effects.push({ type: 'spark', x: player.x, y: player.y, life: 0.4 });
    }
  } else if (id === 'bigPotion') {
    if (player && player.alive) {
      player.lives = 3;
      effects.push({ type: 'spark', x: player.x, y: player.y, life: 0.5 });
    }
  } else if (id === 'weaponSwap') {
    if (player && player.alive) {
      const others = ['sword', 'shield', 'hammer'].filter(w => w !== player.weapon);
      player.weapon = others[Math.floor(Math.random() * others.length)];
      // 武器系の一時状態を初期化（投擲中の盾などが残らないように）
      player.swordCharge = 0;
      player.swordSlash = 0;
      player.swordSpinning = false;
      player.blocking = false;
      player.shieldThrown = false;
      player.shieldProj = null;
      player.hammerWindup = 0;
      player.hammerSwing = 0;
      player.hammerSpinning = false;
      player.spinHitCooldown = 0;
      player.attackCooldown = 0;
      effects.push({ type: 'spark', x: player.x, y: player.y, life: 0.5 });
    }
  }
}

function startStage(idx) {
  stageIndex = idx;
  projectiles = [];
  effects = [];
  minions = [];
  const type = stages[idx];
  if (type === 'sword') boss = new SwordBoss();
  else if (type === 'bow') boss = new BowBoss();
  else if (type === 'hammer') boss = new HammerBoss();
  else if (type === 'bomb') boss = new BombBoss();
  else if (type === 'saw') boss = new SawBoss();
  // 各ステージはノーダメ判定をリスタート
  noHitRun = true;
  // プレイヤー位置リセット
  player.x = CENTER.x;
  player.y = CENTER.y + 200;
  player.invuln = 1.2;
  player.alive = true;
  player.attackCooldown = 0;
  // 武器の一時状態もリセット（投擲中の盾がフィールドに残らないように）
  player.swordCharge = 0;
  player.swordSlash = 0;
  player.blocking = false;
  player.shieldThrown = false;
  player.shieldProj = null;
  player.hammerWindup = 0;
  player.hammerSwing = 0;
  player.hammerSpinning = false;
  player.swordSpinning = false;
  player.spinHitCooldown = 0;
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
  minions = [];
  stageIndex = 0;
  stages = ['sword', 'bow', 'hammer', 'bomb'];
  noHitRun = true;
  inventory = { poison: 0, potion: 0, bigPotion: 0, weaponSwap: 0 };
  selectedItem = 'poison';
}

function updateBattle(dt) {
  if (spaceDown) spaceHeldDuration += dt;
  player.update(dt);
  boss.update(dt);
  // ポイズンのスリップダメージ（1秒に1ダメ）
  if (boss.alive && (boss.poisonTimer || 0) > 0) {
    boss.poisonTimer -= dt;
    boss.poisonTick = (boss.poisonTick || 0) - dt;
    if (boss.poisonTick <= 0) {
      boss.takeDamage(1);
      boss.poisonTick = 1;
      effects.push({ type: 'spark', x: boss.x, y: boss.y, life: 0.2 });
    }
  }
  for (const m of minions) m.update(dt);
  minions = minions.filter(m => m.alive);
  for (const p of projectiles) p.update(dt);
  projectiles = projectiles.filter(p => p.alive);
  updateEffects(dt);

  if (!player.alive) {
    state = 'GAME_OVER';
    stateTimer = 0;
    return;
  }
  if (!boss.alive) {
    coins += COIN_REWARD;
    state = 'BOSS_DEAD';
    stateTimer = 2.0;
    return;
  }
}

function drawBattle() {
  drawArena();
  // 描画順: ボス -> 子分 -> プレイヤー -> 弾 -> エフェクト -> HUD
  if (boss && boss.alive && (boss.poisonTimer || 0) > 0) {
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 120);
    ctx.fillStyle = `rgba(120, 220, 60, ${0.15 + pulse * 0.18})`;
    ctx.beginPath();
    ctx.arc(boss.x, boss.y, (boss.r || 32) + 10 + pulse * 5, 0, Math.PI * 2);
    ctx.fill();
  }
  boss && boss.draw(ctx);
  for (const m of minions) m.draw(ctx);
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
  const isHidden = stages[stageIndex] === 'saw';
  ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
  ctx.font = 'bold 60px serif';
  ctx.textAlign = 'center';
  ctx.fillText(isHidden ? '隠しステージ' : `STAGE ${stageIndex + 1}`, W / 2, 270);
  ctx.font = 'bold 36px serif';
  const names = ['剣のボス', '弓のボス', 'ハンマーのボス', 'ラスボス'];
  ctx.fillText(isHidden ? 'ノコギリのボス' : names[stageIndex], W / 2, 330);
  ctx.font = '18px sans-serif';
  ctx.fillStyle = `rgba(255, 240, 200, ${a})`;
  ctx.fillText('まもなく開始...', W / 2, 370);
  ctx.restore();
}

function drawCoin(ctx, x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#f0c040';
  ctx.strokeStyle = '#8a5a18';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, size, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff5b0';
  ctx.beginPath();
  ctx.arc(-size * 0.3, -size * 0.3, size * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8a5a18';
  ctx.font = `bold ${Math.round(size * 1.1)}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('円', 0, 1);
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

function shopBuyButton() {
  return { x: W / 2 - 90, y: 350, w: 180, h: 44 };
}
function shopContinueButton() {
  return { x: W / 2 - 110, y: 580, w: 220, h: 60 };
}
function shopItemRects() {
  const cellW = 200, cellH = 100, gap = 10;
  const totalW = cellW * ITEM_ORDER.length + gap * (ITEM_ORDER.length - 1);
  const baseX = (W - totalW) / 2;
  const baseY = 450;
  return ITEM_ORDER.map((id, i) => ({
    id, x: baseX + i * (cellW + gap), y: baseY, w: cellW, h: cellH,
  }));
}

// アイテムアイコン（HUD・ショップ共用）
function drawItemIcon(ctx, x, y, id, r) {
  const item = ITEMS[id];
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = item.color;
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(r * 1.25)}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(item.label, 0, 1);
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

const UPGRADE_DESC = {
  sword: '長押しで剣が回転攻撃、放すとランダム方向へ斬撃',
  shield: '構えた盾でラスボスの爆弾を含むすべての飛び道具を反射',
  hammer: '回転中、近くの飛び道具をランダム方向へ反射',
};
const WEAPON_LABEL = { sword: '剣', shield: '盾', hammer: 'ハンマー' };

function drawShop() {
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
  ctx.font = 'bold 38px serif';
  ctx.textAlign = 'center';
  ctx.fillText('武器強化ショップ', W / 2, 70);
  ctx.font = '16px sans-serif';
  ctx.fillStyle = '#555';
  ctx.fillText(`STAGE ${stageIndex + 1} クリア！`, W / 2, 96);

  // 所持金
  drawCoin(ctx, W / 2 - 36, 140, 18);
  ctx.fillStyle = '#222';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`x ${coins}`, W / 2 - 10, 150);

  // 武器カード
  const cardX = W / 2 - 170, cardY = 170, cardW = 340, cardH = 160;
  const upgraded = upgrades[selectedWeapon];
  ctx.fillStyle = upgraded ? '#fff7d0' : '#fff';
  ctx.strokeStyle = upgraded ? '#e0b020' : '#aaa';
  ctx.lineWidth = upgraded ? 4 : 2;
  roundRect(ctx, cardX, cardY, cardW, cardH, 12);
  ctx.fill(); ctx.stroke();

  // 武器名
  ctx.fillStyle = '#222';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(WEAPON_LABEL[selectedWeapon], cardX + cardW / 2, cardY + 32);
  // アイコン
  const ix = cardX + 70, iy = cardY + 110;
  if (selectedWeapon === 'sword') drawSword(ctx, ix, iy + 22, 38);
  else if (selectedWeapon === 'shield') drawShield(ctx, ix, iy, 28);
  else if (selectedWeapon === 'hammer') drawHammer(ctx, ix, iy + 22, 38);
  if (upgraded) {
    ctx.fillStyle = '#e0b020';
    ctx.font = 'bold 24px serif';
    ctx.textAlign = 'center';
    ctx.fillText('★', ix + 30, iy - 22);
  }
  // 説明
  ctx.fillStyle = '#444';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'left';
  wrapText(ctx, UPGRADE_DESC[selectedWeapon], cardX + 130, cardY + 80, cardW - 145, 20);

  // 購入ボタン or 強化済み表示
  const cost = UPGRADE_COST[selectedWeapon];
  const buyBtn = shopBuyButton();
  if (upgraded) {
    ctx.fillStyle = '#daa030';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('★ 強化済み ★', buyBtn.x + buyBtn.w / 2, buyBtn.y + buyBtn.h / 2 + 8);
  } else {
    const canAfford = coins >= cost;
    const hover = mouse.x >= buyBtn.x && mouse.x <= buyBtn.x + buyBtn.w &&
                  mouse.y >= buyBtn.y && mouse.y <= buyBtn.y + buyBtn.h;
    if (canAfford) {
      ctx.fillStyle = hover ? '#3a9050' : '#4abf65';
      ctx.strokeStyle = '#2c7a40';
    } else {
      ctx.fillStyle = '#ccc';
      ctx.strokeStyle = '#999';
    }
    ctx.lineWidth = 3;
    roundRect(ctx, buyBtn.x, buyBtn.y, buyBtn.w, buyBtn.h, 10);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`購入 (${cost} 円)`, buyBtn.x + buyBtn.w / 2, buyBtn.y + buyBtn.h / 2);
    ctx.textBaseline = 'alphabetic';
    if (!canAfford) {
      ctx.fillStyle = '#a00';
      ctx.font = '12px sans-serif';
      ctx.fillText('お金が足りないよ', buyBtn.x + buyBtn.w / 2, buyBtn.y - 6);
    }
  }

  // アイテム購入セクション
  ctx.fillStyle = '#222';
  ctx.font = 'bold 22px serif';
  ctx.textAlign = 'center';
  ctx.fillText('アイテム', W / 2, 430);
  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#666';
  ctx.fillText('（バトル中 B:使用 V:切替）', W / 2, 446);

  for (const r of shopItemRects()) {
    const item = ITEMS[r.id];
    const canAfford = coins >= item.cost;
    const hover = mouse.x >= r.x && mouse.x <= r.x + r.w &&
                  mouse.y >= r.y && mouse.y <= r.y + r.h;
    if (canAfford) {
      ctx.fillStyle = hover ? '#ffe890' : '#fff7d0';
      ctx.strokeStyle = '#daa030';
    } else {
      ctx.fillStyle = '#eee';
      ctx.strokeStyle = '#aaa';
    }
    ctx.lineWidth = 2;
    roundRect(ctx, r.x, r.y, r.w, r.h, 10);
    ctx.fill(); ctx.stroke();
    // アイコン
    drawItemIcon(ctx, r.x + 26, r.y + 28, r.id, 16);
    // 名前
    ctx.fillStyle = '#222';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(item.name, r.x + 50, r.y + 24);
    // 説明
    ctx.fillStyle = '#444';
    ctx.font = '11px sans-serif';
    wrapText(ctx, item.desc, r.x + 12, r.y + 58, r.w - 24, 14);
    // 価格
    ctx.fillStyle = canAfford ? '#2c7a40' : '#888';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${item.cost}円`, r.x + r.w - 10, r.y + 24);
    // 所持数
    if (inventory[r.id]) {
      ctx.fillStyle = '#3a7ab8';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`所持 x${inventory[r.id]}`, r.x + r.w - 10, r.y + r.h - 8);
    }
  }

  // 次へボタン
  const contBtn = shopContinueButton();
  const cHover = mouse.x >= contBtn.x && mouse.x <= contBtn.x + contBtn.w &&
                 mouse.y >= contBtn.y && mouse.y <= contBtn.y + contBtn.h;
  ctx.fillStyle = cHover ? '#3a6090' : '#4a80b0';
  ctx.strokeStyle = '#1c3a5c';
  ctx.lineWidth = 3;
  roundRect(ctx, contBtn.x, contBtn.y, contBtn.w, contBtn.h, 16);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('次のステージへ', contBtn.x + contBtn.w / 2, contBtn.y + contBtn.h / 2);
  ctx.textBaseline = 'alphabetic';
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const chars = text.split('');
  let line = '';
  let cy = y;
  for (const c of chars) {
    const test = line + c;
    if (ctx.measureText(test).width > maxWidth && line.length) {
      ctx.fillText(line, x, cy);
      line = c;
      cy += lineHeight;
    } else {
      line = test;
    }
  }
  if (line.length) ctx.fillText(line, x, cy);
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
  const bossCount = stages.includes('saw') ? 5 : 4;
  ctx.fillText(`${bossCount}体のボスを倒した！`, W / 2, H / 2 + 10);
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
      const curType = stages[stageIndex];
      if (curType === 'bomb') {
        // ラスボスをノーダメで倒すと隠しの「ノコギリのボス」へ
        if (noHitRun && !stages.includes('saw')) {
          stages.push('saw');
          startStage(stageIndex + 1);
        } else {
          state = 'VICTORY';
        }
      } else if (curType === 'saw') {
        state = 'VICTORY';
      } else {
        state = 'SHOP';
      }
    }
  } else if (state === 'SHOP') {
    drawShop();
  } else if (state === 'GAME_OVER') {
    drawGameOver();
  } else if (state === 'VICTORY') {
    drawVictory();
  }

  updateTouchControls();
  requestAnimationFrame(loop);
}

window.addEventListener('load', () => {
  canvas = document.getElementById('game');
  ctx = canvas.getContext('2d');
  setupMouse();
  setupTouch();
  requestAnimationFrame(loop);
});
