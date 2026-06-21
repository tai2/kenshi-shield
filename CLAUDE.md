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
- `game.js` — ゲーム本体（一枚岩、~4500行。ゲーム1＋ゲーム2）

## 全体アーキテクチャ

`game.js` 内に以下の順で定義：

1. **定数** (`W=900, H=700, CENTER, ARENA_R=300, PLAYER_R=14, BOSS_MAX_HP=100`)
2. **グローバル状態** (`state`, `player`, `boss`, `projectiles`, `effects`, 入力 `keys/spaceDown`)
3. **入力ハンドラ** — キーは `e.code` (ArrowUp/Down/Left/Right, Space, Enter)
4. **Player クラス** — 残機3、武器ごとの状態を内包
5. **飛び道具クラス** — `SwordSlash`, `ShieldThrown`, `Arrow`(壁反射対応), `BossSlash`, `BigArrow`, `BombProjectile`, `Beam`, `PlayerArrow`(弓), `Shockwave`, `Spike`
6. **Boss 基底 + 各ボス** — ゲーム1: `SwordBoss`, `BowBoss`, `HammerBoss`, `BombBoss`, `SawBoss`(隠し)。ゲーム2: `SwordBoss2`, `BowBoss2`, `HammerBoss2`, `BombBoss2`, `SpikeBoss`(ラスボス), `CompositeBoss`(隠し)
7. **描画ヘルパー** — `drawHero`, `drawShield`, `drawSword`, `drawHammer`, `drawZigzagMouth`, `drawHeart`, `roundRect`
8. **画面描画** — `drawWeaponSelect`, `drawArena`, `drawHUD`, `drawPlayer`, `drawEffects`, `drawBossIntro/GameOver/Victory`
9. **メインループ** — `loop(now)` が `state` を見て `update*` と `draw*` を呼ぶ

### ステートマシン

`state` のとる値:
- `GAME_SELECT` — タイトル。ゲーム1 / ゲーム2 を選ぶ（**初期state**）
- `WEAPON_SELECT` — 武器選択（左上「← もどる」で `GAME_SELECT` へ）
- `BOSS_INTRO` — `STAGE N` 表示 (`stateTimer=1.6s`)
- `BATTLE` — 戦闘中
- `BOSS_DEAD` — ボス撃破演出 (`stateTimer=2.0s`)
- `GAME_OVER` / `VICTORY` — Enter/クリックで `resetToWeaponSelect()`（→ `GAME_SELECT`）

`startStage(idx)` は **プレイヤーの残機を維持**したまま位置と alive をリセット。残機は `resetToWeaponSelect → 新 Player` で3に戻る。

### ゲーム選択（章: 剣士シールド1 / 2）

- `currentGame` (1 or 2) が現在の章。`GAME1_STAGES = ['sword','bow','hammer','bomb']` / `GAME2_STAGES = ['sword2','bow2','hammer2','bomb2','spike']`。`defaultStages()` が章に応じて返す。
- **ゲーム2はゲーム1クリアで解禁**。クリアフラグは `localStorage['kenshiShield.game1Cleared']`（`saveGame1Cleared()` で保存、起動時に読み込み）。ゲーム1のラスボス(`bomb`)撃破時に保存。
- `GAME_SELECT` 画面はタイトル後に毎回表示。未解禁のゲーム2は鍵マーク付きで選べない (`gameSelectButtons()` の `locked`)。
- ボス名/ステージ数/勝利演出は `bossDisplayName()` / `isHiddenStage()` / `mainStageCount()` / `stageLabelText()` で章に依存して切り替え（`BOSS_NAMES` 表を参照）。

## プレイヤー仕様

- 残機3。`hit()` で1減らし、0で死亡。残機が残っている時は `invuln=2.0s` の無敵
- 矢印キー移動、スペース攻撃
- 武器選択後は同じランで変更不可

### 武器（全て `Player.update` → `updateWeapon` で分岐）

| 武器 | 通常 (タップ) | 長押し |
|------|--------------|--------|
| 剣 | 近距離斬り 3dmg (range 46) | 2秒チャージで `SwordSlash` 飛ぶ斬撃 4dmg |
| 盾 | 押している間 `blocking=true`。飛び道具を**全方向で無効化（完全無敵）**、正面なら反射 2dmg | 0.7秒以上で離すと `ShieldThrown` 投擲 5dmg |
| ハンマー | 1秒チャージ後 AOE 5dmg (range 75) | 0.4秒以上で回転モード（移動可、連続2dmg/0.3s） |
| 弓（**ゲーム2限定**） | `PlayerArrow` 射出 3dmg | 0.12秒以上で `bowAiming`（最寄り敵を自動照準）→ 離すと 5dmg |

- 武器一覧は `availableWeapons()`（ゲーム2のみ弓を含む）。`weaponButtons()` がこれを元にボタンを動的生成。
- 弓の強化(`upgrades.bow`, 4円)は `PlayerArrow` が壁で**2回反射**する（`maxBounces`）。
- 長押し判定は `spaceHeldDuration` をフレーム毎にカウント、`onSpaceRelease(heldFor)` で分岐。

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

## 剣士シールド2 のボス（`currentGame === 2`）

ゲーム1のボスとは別クラス。クラス名末尾 `2` または専用名。HP は基底の100（`spike`/`composite` のみ `maxHp=150`）。各ボスは絵 (`kenshi_shield_2_*.jpg`) を反映。

| ステージ | type | クラス | HP | 攻撃パターン |
|---|---|---|---|---|
| 1 | `sword2` | `SwordBoss2` | 100 | ビーム(`Beam`) / 斬撃(`BossSlash`) / 突撃(壁反射→`cooldown`5秒) |
| 2 | `bow2` | `BowBoss2` | 100 | 3連射(`Arrow` 壁1反射) / ロックオン射撃(`Arrow` 壁2反射→`cooldown`5秒)。逃走移動あり |
| 3 | `hammer2` | `HammerBoss2` | 100 | ロックオン叩きつけ / 追跡`rage`10秒(→cd5秒, `isAttacking`) / 波動(`Shockwave`リング) |
| 4 | `bomb2` | `BombBoss2` | 100 | 自爆AOE r=110(→cd10秒) / ロックオン`Beam` / ボム3連投(`BombProjectile`) |
| 5(ラスボス) | `spike` | `SpikeBoss` | 150 | 突撃 / 円周3周(→cd10秒) / トゲ扇状(`Spike`) / 追跡10秒(→cd10秒) |
| 6(隠し) | `composite` | `CompositeBoss` | 150 | **6パーツ合体で登場**(`drawCompositeIntro`)。第二形態あり |

- **隠しボス出現条件**: ラスボス(`spike`)を**ノーダメ撃破**(`noHitRun`)で `composite` を `stages` に push（ゲーム1の `saw` と同じ仕組み、`loop()` の `BOSS_DEAD` 分岐）。`noHitRun` は `player.hit()` 内でのみ false 化（無敵中の被弾は除外）、`startStage` で毎ステージ true にリセット。
- ラスボス戦中は HUD に**「ノーダメ」バッジ**を表示（`isLastMainBossStage() && noHitRun`）。被弾すると即消えるので隠しボスの条件が見える。
- `CompositeBoss` は `takeDamage` で1度目の撃破時に第二形態へ復活（`revived`, HP150再生）。形態1: ボム3連/ビーム(cd)/矢(cd)。形態2: + 斬撃 / 突撃(cd)。`intro`/`reviving` 中は無敵。
- 新飛び道具: `PlayerArrow`(弓), `Shockwave`(波動リング, 通過で1ダメ), `Spike`(トゲ, 盾反射可)。`Arrow` は `maxBounces` 引数で壁反射対応。
- ボス体の描画ヘルパー: `drawSwordBoss2Body`(上に丸い頭＋顔・細長い八角形の刃・下に鍔・台座。ゲーム1の剣ボスとは別の輪郭) / `drawBowBoss2Body`(D字型の弓＋貫通する長い矢・中央に丸い目。ゲーム1の三日月弓とは別の輪郭) / `drawHammerBoss2Body`(角付き) / `drawBombBoss2Body`(四分割+渦巻き目) / `drawSpikeBall`(トゲ玉+中央目) / `drawCompositeBody`(全要素のせ集め)。

## 接触ダメージのルール

**「攻撃中のみ接触ダメージが発生する」が原則**。各ボスの contact 判定は対象モードのブロック内に書き、`this.mode === 'X' && ...` で同フレーム内のモード遷移を明示的にガード済み。新パターン追加時もこの形を踏襲すること。

盾の構え (`player.blocking`) は**移動する飛び道具**(`Arrow`/`BossSlash`/`BigArrow`/`Spike`)を構えブロック半径内で全方向無効化（正面=反射、それ以外=消滅、いずれもダメージ0）。**接触ダメージ(突進等)とビーム(`Beam`)・波動(`Shockwave`)は盾で防げない**（回避用）。

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
| ボスHP | `BOSS_MAX_HP = 100`（基本）。`SpikeBoss`/`CompositeBoss` は `constructor` で `maxHp = 150` |
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
