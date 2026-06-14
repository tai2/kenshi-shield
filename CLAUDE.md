# 剣士シールド — 開発メモ

子供と一緒に作っている2Dブラウザゲーム。`index.html` をブラウザで開くだけで遊べる。

## 動かし方

```
open index.html
```

ビルド不要のバニラHTML/CSS/JS。`game.js` を編集してブラウザをリロードするだけ。

## ファイル構成

- `index.html` — Canvas要素と `game.js` の読み込みのみ
- `style.css` — ページ周りの簡単なスタイル
- `game.js` — ゲーム本体（一枚岩、~1700行）

## 全体アーキテクチャ

`game.js` 内に以下の順で定義：

1. **定数** (`W=900, H=700, CENTER, ARENA_R=300, PLAYER_R=14, BOSS_MAX_HP=100`)
2. **グローバル状態** (`state`, `player`, `boss`, `projectiles`, `effects`, 入力 `keys/spaceDown`)
3. **入力ハンドラ** — キーは `e.code` (ArrowUp/Down/Left/Right, Space, Enter)
4. **Player クラス** — 残機3、武器ごとの状態を内包
5. **飛び道具クラス** — `SwordSlash`, `ShieldThrown`, `Arrow`, `BossSlash`, `BigArrow`
6. **Boss 基底 + 各ボス** — `SwordBoss`, `BowBoss`, `HammerBoss`
7. **描画ヘルパー** — `drawHero`, `drawShield`, `drawSword`, `drawHammer`, `drawZigzagMouth`, `drawHeart`, `roundRect`
8. **画面描画** — `drawWeaponSelect`, `drawArena`, `drawHUD`, `drawPlayer`, `drawEffects`, `drawBossIntro/GameOver/Victory`
9. **メインループ** — `loop(now)` が `state` を見て `update*` と `draw*` を呼ぶ

### ステートマシン

`state` のとる値:
- `WEAPON_SELECT` — タイトル＆武器選択
- `BOSS_INTRO` — `STAGE N` 表示 (`stateTimer=1.6s`)
- `BATTLE` — 戦闘中
- `BOSS_DEAD` — ボス撃破演出 (`stateTimer=2.0s`)
- `GAME_OVER` / `VICTORY` — Enter/クリックで `resetToWeaponSelect()`

`startStage(idx)` は **プレイヤーの残機を維持**したまま位置と alive をリセット。残機は `resetToWeaponSelect → 新 Player` で3に戻る。

## プレイヤー仕様

- 残機3。`hit()` で1減らし、0で死亡。残機が残っている時は `invuln=2.0s` の無敵
- 矢印キー移動、スペース攻撃
- 武器選択後は同じランで変更不可

### 武器（全て `Player.update` → `updateWeapon` で分岐）

| 武器 | 通常 (タップ) | 長押し |
|------|--------------|--------|
| 剣 | 近距離斬り 3dmg (range 46) | 2秒チャージで `SwordSlash` 飛ぶ斬撃 4dmg |
| 盾 | 押している間 `blocking=true` で矢を反射 2dmg | 0.7秒以上で離すと `ShieldThrown` 投擲 5dmg |
| ハンマー | 1秒チャージ後 AOE 5dmg (range 75) | 0.4秒以上で回転モード（移動可、連続2dmg/0.3s） |

長押し判定は `spaceHeldDuration` をフレーム毎にカウント、`onSpaceRelease(heldFor)` で分岐。

## ボス仕様

全ボス HP=100。各ボスは `mode` ステートマシンで攻撃パターンを切り替える。

### Boss 1: SwordBoss

`mode`: `idle` → ランダムで `telegraphFly` または `telegraphSlash` → 攻撃 → クールダウン/idle

- `flying` (5秒 or 3バウンス): 自身が回転突進、壁で反射、接触ダメージ
- 飛行後 → **`cooldown` 10秒**（無防備、グレー表示）
- `slashTelegraph` → `BossSlash` 飛び道具を発射 → `slashRecover` 0.8秒
- `isAttacking()` = `mode === 'flying'`

### Boss 2: BowBoss

`mode`: `idle` → 70% で `aiming`+`shooting`、30% で `charging`

- 通常: `aiming` 0.6秒 → `shooting` で `Arrow` を3発（0.35秒間隔）
- **`charging` 1.8秒** → `BigArrow` を1発 → **`stunned` 5秒**
- **プレイヤーが220px以内なら逃走**（射撃中も動く、`canMove` = mode が `charging`/`stunned` 以外）

### Boss 3: HammerBoss

`mode`: `idle` → ランダムで `telegraphRage` または `telegraphSlam`

- **`rage` 10秒**（追跡 spin）→ **`cooldown` 10秒**（接触ダメージあり、`isAttacking()`）
- **`telegraphSlam` 1.2秒** → `slamJump` 0.9秒 で `slamStart→slamTarget` を放物線移動 (`jumpHeight = sin(t*π)*80`) → 着地AOE (range 75) → `slamRecover` 2秒
- 着地点には十字マーカーが先に表示される

## 接触ダメージのルール

**「攻撃中のみ接触ダメージが発生する」が原則**。各ボスの contact 判定は対象モードのブロック内に書き、`this.mode === 'X' && ...` で同フレーム内のモード遷移を明示的にガード済み。新パターン追加時もこの形を踏襲すること。

## ビジュアル方針

子供が描いた絵を反映している。一貫したスタイル：

- **太い黒の輪郭** (`strokeStyle='#1a1a1a'`, `lineWidth=2~2.5`)
- **クリーム/シルバー系の塗り** + ジグザグの歯 (`drawZigzagMouth`) + 四角の目
- **ボスは全員に顔がついている**:
  - 剣ボス: 刃に四角目とジグザグ歯
  - 弓ボス: 矢じり先端に小さな顔
  - ハンマーボス: ヘッドに怒り三角目とジグザグ歯
- **主人公（西洋騎士の人形ボディ）** — `drawHero` 参照
  - 兜（横スリットから目）、赤いプルーム、銀の胸当て+赤十字、両側に丸い手、短い脚と茶色の靴
  - 顔を真正面に固定し、目とその前にある武器の位置で向きを表現
  - `drawHeldWeapon` が `facing` 方向に武器を回転＋オフセット配置

## バランス調整箇所

| 何を | どこ |
|------|------|
| プレイヤー残機 | `Player.constructor` の `this.lives = 3` |
| プレイヤー無敵時間 | `Player.constructor` の `this.invuln = 1.2`（初期）, `hit()` 内 `this.invuln = 2.0`（被弾後） |
| ボスHP | `BOSS_MAX_HP = 100`（全ボス共通） |
| 武器ダメージ | `Player.onSpaceRelease` / `checkSwordHit` / `executeHammerAOE` 等の各箇所のリテラル |
| ボスの攻撃間隔 | 各 `update` の `this.modeTimer = N` |
| プレイヤー速度 | `PLAYER_SPEED = 3.2` |
| アリーナ半径 | `ARENA_R = 300` |

## エフェクト

`effects` 配列に `{type, x, y, life, maxLife, ...}` を push、`updateEffects` で減算、`drawEffects` で type 別描画。
- `spark`, `aoe`, `damage`, `death`, `bossDeath` の5種類

新エフェクトを足すときは `drawEffects` に `else if` を追加。

## 既知の注意点

- マウス座標は `canvas.getBoundingClientRect()` でスケール変換しているので、CSSでcanvasのサイズを変えても入力は壊れない
- 関数宣言 (`function`) で書いてあるのでホイスティングされる。呼び出し順序を気にせず書ける
- `Boss.baseDraw(fn)` は `ctx.save/restore` で囲み、`hitFlash > 0` のとき白いシャドウを付ける共通ラッパ。子クラスの draw は中身を関数として渡す
- BowBoss の draw 内で外側 `ctx.save/restore` を一組追加してあるので、構造を変える時は対応関係を崩さないこと

## よくある作業パターン

- 新ボスパターン追加: `mode` の値を増やす → `update` に `else if` 分岐追加 → `draw` で見た目を切り替え → `idle` からランダム選択するロジックを足す
- 新武器追加: `Player.constructor` で状態追加 → `updateWeapon`/`onSpaceRelease` で挙動 → `drawHeldWeapon` / 武器選択画面 / HUD 用に `drawXxx` ヘルパー追加 → `weaponButtons()` にエントリ追加
- 難易度調整: バランス調整箇所の表を参照。子供と遊んでフィードバックを取りながら調整する前提
