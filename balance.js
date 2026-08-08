(() => {
  "use strict";

  /* Breachline 밸런스 모듈 — 인게임 수치의 단일 원본
     game.html 의 가장 앞(operators.js 이전)에 로드되어
     window.BREACHLINE_BALANCE 로 노출된다. 수치를 조정하려면 이 파일만 고치면 된다.

     ※ game.js 번들에 내장된 코어 상수(기본 이동 속도, 코어 시야 판정 등)는
       수정할 수 없으므로, 동기화 기준값으로 여기에 기록해 둔다. */

  const BALANCE = {
    /* 기본 캐릭터 */
    player: {
      hp: 100,     // 최대 체력 (코어 resetRound 와 동기)
      radius: 18,  // 코어 히트박스 반경 (FX 크기 계산 기준)
    },

    /* 시야 / 식별 */
    vision: {
      maxRange: 920,      // 코어 시야 최대 거리
      coneDegrees: 45,    // 코어 시야 부채꼴 (좌우 22.5도)
      nearRadius: 100,    // 원형 근접 시야 반경
      shieldViewDegrees: 90, // 아이언 시야각
      camera: { defaultScale: 1.25, sniperScale: 1.5 },
    },

    /* 공용 시스템 */
    skills: { cooldown: 5 }, // 특수능력 공용 쿨타임 (건카타/소환/닌자연막/섬광방패)
    melee: { swingDuration: 0.34, attackDelay: 0.32 },
    projectiles: { hitBuffer: 5 },
    ai: {
      fairRange: 620,          // 봇 공정 사거리 (화면 밖 저격 방지)
      summonCombatRange: 640,  // 봇-소환수 교전 인식 거리
    },

    /* 투척물/유탄 */
    gadgets: {
      flash: { radius: 200, duration: 2, fuse: 1.0, count: 2 },     // 군인 보유 수
      smoke: { radius: 150, duration: 10, fuse: 1.0, count: 2 },    // 스나이퍼 보유 수
      frag: { radius: 200, damage: 100, fuse: 1.5, count: 2 },
      launcher: { radius: 67, damage: 60, speed: 620 },
      throwSpeed: 1300, // 수류탄·연막탄·섬광탄 투척 초기 속도 (멀리 던지기 위해 상향)
    },

    /* 병과별 스킬/무기 */
    operators: {
      gunslinger: {
        hp: 150,
        weapon: { id: "dual_pistols", name: "DUAL PISTOLS", damage: 8, pellets: 1, rpm: 800, spreadDeg: 4, magSize: 30, reserve: 9999, reload: 2.5, range: 720, projectileSpeed: 1450, color: 0xffd166 },
        gunKata: { damage: 50, radius: 176, cooldown: 5 }, // 반경 = 근접 기본 사거리(88) × 2 · SPACE 건카타 돌진(쿨타임 5초·무제한)
        dash: { speed: 760, duration: 0.5 },
        // 우클릭 난사: 부채꼴 범위를 쌍권총으로 난사한다 (부채꼴 좌우 halfAngleDeg, duration 동안 shots발)
        spray: { damage: 15, shots: 16, halfAngleDeg: 32, duration: 0.55, cooldown: 8, projectileSpeed: 1450 },
      },
      bulwark: {
        hp: 300,
        weapon: { id: "shield_pistol", name: "SHIELD LMG", damage: 10, pellets: 1, rpm: 900, spreadDeg: 12, magSize: 100, reserve: 9999, reload: 2.5, range: 620, projectileSpeed: 1050, color: 0x7ea8ff },
        barrier: { duration: 3, cooldown: 10, halfAngleDeg: 60, inner: 55, outer: 100 },
        flashShield: { range: 260, halfAngleDeg: 120, duration: 1 },
      },
      sentinel: {
        hp: 100,
        weapon: { id: "railgun", name: "RAILGUN", damage: 90, pellets: 1, rpm: 45, spreadDeg: 0, magSize: 6, reserve: 9999, reload: 2.5, range: 580, projectileSpeed: 1, color: 0x55f0b0 },
        railgun: { chargeTime: 1 },
        reveal: { range: 920, duration: 7, cooldown: 15 },
        // 우클릭 헤비 레이저: 레일건 충전(1초)의 3배(3초)를 들여 넓은 보라색 관통 레이저를 발사한다.
        // 피해는 40 — 멀티플레이 서버의 sentinel 피해 상한과 동일하게 맞춘다.
        heavyLaser: { chargeTime: 3, damage: 150, halfWidth: 46, cooldown: 10, color: 0xb26cff },
      },
      soldier: {
        hp: 200,
        weapon: { id: "rifle", name: "ASSAULT RIFLE", damage: 15, pellets: 1, rpm: 420, spreadDeg: 4.5, magSize: 30, reserve: 9999, reload: 2.5, range: 1040, projectileSpeed: 1500, color: 0x6de6df },
        // 우클릭 섬광탄: 개수 무제한, 쿨타임 5초.
        flashCooldown: 5,
        // SPACE 신체강화: 5초간 이동속도·피해 부스트. 쿨타임 20초.
        enhance: { duration: 5, speedMult: 1.4, damageMult: 1.5, cooldown: 20 },
      },
      frog: {
        hp: 150,
        weapon: { id: "frog", name: "FROG BUBBLE SPRAYER", damage: 5, pellets: 5, rpm: 300, spreadDeg: 12, magSize: 30, reserve: 9999, reload: 2.5, range: 900, projectileSpeed: 1200, color: 0x7eeeff },
        waterSlow: { duration: 1, moveScale: 0.7 },
        bubble: { damage: 15, speed: 920, color: 0x83ffad, range: 334 },
        autoBubbleInterval: 0.2,                                     // 벽 부착 중 자동 발사 간격
        attachedVisionRatio: 0.33,                                    // 벽 부착 시 시야 비율 (920×0.33≈304)
        tongue: { pullSpeed: 1500, minLength: 48, wallAdjust: 72 },
        momentum: { max: 430, damping: 0.035 },
      },
      reaper: {
        hp: 200,
        weapon: { id: "scythe", name: "GREAT SCYTHE", damage: 80, pellets: 1, rpm: 80, spreadDeg: 0, magSize: 1, reserve: 9999, reload: 2.5, range: 128, projectileSpeed: 1, color: 0xc59bff },
        meleeHalfAngle: Math.PI * 0.31,
        scytheThrow: { damage: 50, range: 480, outSpeed: 950, returnSpeed: 1150, hitBuffer: 26, fxDots: 8, fxRing: 8 },
        summon: {
          costHp: 25, minHp: 25, hp: 1, expire: 20,
          spawnDistance: 44, scale: 0.62, scytheScale: 0.9,
          navCell: 48, navRadius: 14, hitRadius: 16,
          attackDamage: 20, attackRange: 38, attackInterval: 1, moveSpeed: 300,
        },
      },
      hunter: {
        hp: 200,
        viewDegrees: 90, // 기본 시야 부채꼴 (좌우 45도) — 코어 45도 대신 넓은 시야
        weapon: { id: "shotgun", name: "DOUBLE BARREL", damage: 24, pellets: 5, rpm: 150, spreadDeg: 18, magSize: 2, reserve: 9999, reload: 2.5, range: 470, projectileSpeed: 1120, color: 0xffab63 },
        dash: { speed: 900, duration: 0.34, cooldown: 3, invulnerable: true }, // 공격 무시 + 즉시 재장전
        // 우클릭 피냄새: 일정 거리 내 적 위치를 감지한다 (벽 관통·나만 보임·적에겐 안 보임)
        bloodScent: { range: 720, duration: 5, cooldown: 12 },
      },
      ninja: {
        hp: 150,
        weapon: { id: "katana", name: "KATANA / DAGGERS", damage: 60, pellets: 1, rpm: 105, spreadDeg: 0, magSize: 1, reserve: 9999, reload: 2.5, range: 118, projectileSpeed: 1, color: 0xff5f6d },
        meleeHalfAngle: Math.PI * 0.29,
        dash: { speed: 780, duration: 0.33, cooldown: 5 },
        smoke: { radius: 225, duration: 5 },
        dagger: { damage: 20, range: 720, speed: 1050 },
      },
      sniper: {
        hp: 100,
        weapon: { id: "bolt_action", name: "BOLT-ACTION RIFLE", damage: 100, pellets: 1, rpm: 67, spreadDeg: 1, magSize: 1, reserve: 9999, reload: 0.9, range: 1420, projectileSpeed: 2200, color: 0x9ef0ff },
        // 우클릭 투망: 처음 적중한 적을 2초간 50% 둔화시키고 스나이퍼는 뒤로 밀려난다.
        net: { damage: 20, range: 620, slowMult: 0.5, slowDuration: 2, knockback: 220, speed: 1150, cooldown: 8, color: 0xbfe9ff },
        // SPACE 설치 모드 → 범위(placeRange) 안 우클릭으로 설치. 쿨타임 cooldown 초, 최대 maxActive 개 동시 유지.
        // 하나가 사라지면(발동) 다시 설치할 수 있다. radius = 보이는 지뢰 크기, triggerRadius = 실제 발동 반경.
        // 밟으면 damage 약한 피해 + rootDuration 초 포박. 내 덫은 항상, 상대 덫은 시야 안에서만 보인다.
        // color = 적군 덫(빨강), allyColor = 아군/내 덫(파랑).
        trap: {
          maxActive: 3, cooldown: 5, rootDuration: 1, radius: 22, triggerRadius: 40, damage: 100, armDelay: 0.4, placeRange: 200,
          color: 0xff3b3b, allyColor: 0x4d9bff, alpha: 0.2, allyAlpha: 0.14,
        },
      },
      demolitionist: {
        hp: 150,
        weapon: { id: "grenade_launcher", name: "6-SHOT GRENADE LAUNCHER", damage: 60, pellets: 1, rpm: 90, spreadDeg: 0, magSize: 6, reserve: 9999, reload: 2.5, range: 780, projectileSpeed: 620, color: 0xffa8f0 },
        // 우클릭 수류탄: 개수 제한 없음, 쿨타임 3초.
        fragCooldown: 3,
        // SPACE 직선 폭격: 조준 방향으로 폭발을 일직선으로 연속 투하한다.
        barrage: { steps: 6, spacing: 95, radius: 67, damage: 50, interval: 0.1, cooldown: 12 },
      },
    },
  };

  const deepFreeze = (value) => {
    for (const key of Object.keys(value)) {
      const entry = value[key];
      if (entry && typeof entry === "object" && !Object.isFrozen(entry)) deepFreeze(entry);
    }
    return Object.freeze(value);
  };

  window.BREACHLINE_BALANCE = deepFreeze(BALANCE);
})();
