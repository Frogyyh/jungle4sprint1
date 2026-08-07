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
      shieldViewDegrees: 20, // 아이언 방벽 홀드 중 시야각 제한
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
      flash: { radius: 200, duration: 1, fuse: 1.5, count: 2 },     // 군인 보유 수
      smoke: { radius: 150, duration: 10, fuse: 1.5, count: 2 },    // 스나이퍼 보유 수
      frag: { radius: 100, damage: 60, fuse: 2, count: 2 },         // 폭탄마 보유 수
      launcher: { radius: 67, damage: 40, speed: 620 },
    },

    /* 병과별 스킬/무기 */
    operators: {
      gunslinger: {
        weapon: { id: "dual_pistols", name: "DUAL PISTOLS", damage: 15, pellets: 1, rpm: 800, spreadDeg: 4, magSize: 30, reserve: 9999, reload: 2.5, range: 720, projectileSpeed: 1450, color: 0xffd166 },
        gunKata: { damage: 50, radius: 176, cooldown: 5 }, // 반경 = 근접 기본 사거리(88) × 2
        dash: { speed: 760, duration: 0.5 },
      },
      bulwark: {
        weapon: { id: "shield_pistol", name: "SHIELD & PISTOL", damage: 10, pellets: 1, rpm: 375, spreadDeg: 5, magSize: 20, reserve: 9999, reload: 2.5, range: 540, projectileSpeed: 950, color: 0x7ea8ff },
        barrier: { maxHp: 250, regenDelay: 1, regenRate: 50, breakCooldown: 10, halfAngleDeg: 60, inner: 55, outer: 100 },
        flashShield: { range: 260, halfAngleDeg: 120, duration: 1 },
      },
      sentinel: {
        weapon: { id: "railgun", name: "RAILGUN", damage: 40, pellets: 1, rpm: 45, spreadDeg: 0, magSize: 6, reserve: 9999, reload: 2.5, range: 580, projectileSpeed: 1, color: 0x55f0b0 },
        railgun: { chargeTime: 1 },
        reveal: { range: 920, duration: 7, cooldown: 15 },
      },
      soldier: {
        weapon: { id: "rifle", name: "ASSAULT RIFLE", damage: 20, pellets: 1, rpm: 420, spreadDeg: 4.5, magSize: 30, reserve: 9999, reload: 2.5, range: 1040, projectileSpeed: 1500, color: 0x6de6df },
      },
      frog: {
        weapon: { id: "frog", name: "FROG BUBBLE SPRAYER", damage: 4, pellets: 5, rpm: 300, spreadDeg: 12, magSize: 999, reserve: 9999, reload: 2.5, range: 900, projectileSpeed: 1200, color: 0x7eeeff },
        bubble: { damage: 2, speed: 920, color: 0x83ffad, range: 334 }, // 수동/자동 비눗방울 (사거리 334 = 시야 920×0.33 + 30)
        autoBubbleInterval: 0.32,                                     // 벽 부착 중 자동 발사 간격
        attachedVisionRatio: 0.33,                                    // 벽 부착 시 시야 비율 (920×0.33≈304)
        tongue: { pullSpeed: 1500, minLength: 48, wallAdjust: 72 },
        momentum: { max: 430, damping: 0.035 },
      },
      reaper: {
        weapon: { id: "scythe", name: "GREAT SCYTHE", damage: 40, pellets: 1, rpm: 80, spreadDeg: 0, magSize: 1, reserve: 9999, reload: 2.5, range: 128, projectileSpeed: 1, color: 0xc59bff },
        meleeHalfAngle: Math.PI * 0.31,
        scytheThrow: { range: 480, outSpeed: 950, returnSpeed: 1150, hitBuffer: 26, fxDots: 8, fxRing: 8 },
        summon: {
          costHp: 25, minHp: 25, hp: 1, expire: 20,
          spawnDistance: 44, scale: 0.62, scytheScale: 0.9,
          navCell: 48, navRadius: 14, hitRadius: 16,
          attackDamage: 10, attackRange: 38, attackInterval: 1, moveSpeed: 164,
        },
      },
      hunter: {
        weapon: { id: "shotgun", name: "DOUBLE BARREL", damage: 24, pellets: 5, rpm: 150, spreadDeg: 18, magSize: 2, reserve: 9999, reload: 2.5, range: 470, projectileSpeed: 1120, color: 0xffab63 },
        dash: { speed: 900, duration: 0.34, cooldown: 3, invulnerable: true }, // 공격 무시 + 즉시 재장전
      },
      ninja: {
        weapon: { id: "katana", name: "KATANA / DAGGERS", damage: 40, pellets: 1, rpm: 105, spreadDeg: 0, magSize: 1, reserve: 9999, reload: 2.5, range: 118, projectileSpeed: 1, color: 0xff5f6d },
        meleeHalfAngle: Math.PI * 0.29,
        dash: { speed: 780, duration: 0.33, cooldown: 5 },
        smoke: { radius: 225, duration: 5 },
        dagger: { damage: 15, range: 720, speed: 1050 },
      },
      sniper: {
        weapon: { id: "bolt_action", name: "BOLT-ACTION RIFLE", damage: 80, pellets: 1, rpm: 67, spreadDeg: 1, magSize: 1, reserve: 9999, reload: 0.9, range: 1420, projectileSpeed: 2200, color: 0x9ef0ff },
      },
      demolitionist: {
        weapon: { id: "grenade_launcher", name: "6-SHOT GRENADE LAUNCHER", damage: 40, pellets: 1, rpm: 90, spreadDeg: 0, magSize: 6, reserve: 9999, reload: 2.5, range: 780, projectileSpeed: 620, color: 0xffa8f0 },
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
