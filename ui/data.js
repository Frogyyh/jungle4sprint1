/* Breachline UI — 캐릭터 / 맵 데이터.
   이미지 에셋이 없으므로 초상화·미니맵은 SVG 로 그린다.
   무기 id 는 게임(index.html weaponVisualProfiles)에 실제로 있는 것만 쓴다. */

/* ---------------- 캐릭터 10인 ---------------- */

export const CHARACTERS = [
  {
    id: "vulcan",
    name: "VULCAN",
    role: "돌격",
    weapon: "RIFLE",
    weaponId: "rifle",
    color: "#6de6df",
    tagline: "교전의 기준점",
    desc: "낮은 스프레드의 소총으로 중거리를 지배한다. 특별한 재주는 없지만 어떤 조합에도 들어맞아, 팀의 첫 교전을 여는 역할을 맡는다.",
    traits: ["중거리 명중률 보정", "재장전 속도 +15%", "교전 시작 시 시야각 확장"],
    stats: { 화력: 4, 기동: 3, 생존: 3 },
  },
  {
    id: "buckshot",
    name: "BUCKSHOT",
    role: "돌파",
    weapon: "SHOTGUN",
    weaponId: "shotgun",
    color: "#ffab63",
    tagline: "문을 여는 사람",
    desc: "8펠릿 산탄으로 근거리를 한 번에 정리한다. 좁은 통로와 모퉁이에서 가장 강하고, 열린 곳에서는 가장 약하다.",
    traits: ["근거리 한 발 제압", "돌진 중 피해 감소", "연막 안에서 이동속도 +20%"],
    stats: { 화력: 5, 기동: 2, 생존: 4 },
  },
  {
    id: "wasp",
    name: "WASP",
    role: "기동",
    weapon: "SMG",
    weaponId: "smg",
    color: "#b9a4ff",
    tagline: "먼저 닿고 먼저 쏜다",
    desc: "가장 빠른 연사와 가장 빠른 발. 스프레드가 커서 오래 끌면 진다 — 짧게 붙고 빠지는 교전을 반복해야 한다.",
    traits: ["기본 이동속도 최상", "사격 중 감속 없음", "처치 시 재장전 즉시 완료"],
    stats: { 화력: 3, 기동: 5, 생존: 2 },
  },
  {
    id: "gemini",
    name: "GEMINI",
    role: "견제",
    weapon: "DUAL PISTOLS",
    weaponId: "dual_pistols",
    color: "#ffd166",
    tagline: "두 각도를 동시에",
    desc: "쌍권총으로 좌우를 번갈아 압박한다. 단발 화력은 낮지만 엄폐물 뒤 상대를 묶어두는 데 가장 좋다.",
    traits: ["좌우 교차 사격", "엄폐물 옆 사격 시 반동 감소", "탄약 예비량 최대"],
    stats: { 화력: 3, 기동: 4, 생존: 3 },
  },
  {
    id: "bulwark",
    name: "BULWARK",
    role: "방어",
    weapon: "SHIELD PISTOL",
    weaponId: "shield_pistol",
    color: "#7ea8ff",
    tagline: "전선을 만든다",
    desc: "전개형 방패로 없던 엄폐물을 만든다. 화력은 팀에서 가장 낮지만, 열린 통로를 팀의 통로로 바꾸는 유일한 캐릭터다.",
    traits: ["전개형 방패 (아군도 엄폐 가능)", "최대 체력 +30", "방패 전개 중 이동 불가"],
    stats: { 화력: 2, 기동: 2, 생존: 5 },
  },
  {
    id: "longshot",
    name: "LONGSHOT",
    role: "저격",
    weapon: "RAILGUN",
    weaponId: "railgun",
    color: "#55f0b0",
    tagline: "엄폐물은 잠깐 늦출 뿐",
    desc: "충전 후 발사하는 관통탄. 엄폐물 하나를 뚫고 지나가므로, 숨은 상대를 끌어내는 것이 아니라 숨은 채로 처리한다.",
    traits: ["엄폐물 1개 관통", "충전 시간 1.2초", "휠 시야 배율 확대폭 2배"],
    stats: { 화력: 5, 기동: 2, 생존: 2 },
  },
  {
    id: "frog",
    name: "FROG",
    role: "기동",
    weapon: "BUBBLE SPRAYER",
    weaponId: "frog_tongue",
    color: "#ff6b99",
    tagline: "물방울로 늦추고 혀로 날아든다",
    desc: "물방울 총으로 적의 움직임을 늦추고, 혀를 벽에 붙여 빠르게 전장을 가로지른다.",
    traits: ["좌클릭 물방울 분사", "물방울 적중 시 둔화", "SPACE 혀 발사 · A/D 스윙"],
    stats: { 화력: 3, 기동: 5, 생존: 2 },
    implemented: true,
  },
  {
    id: "edge",
    name: "EDGE",
    role: "암살",
    weapon: "KATANA",
    weaponId: "katana",
    color: "#ff5f6d",
    tagline: "한 번에 붙어서 한 번에",
    desc: "돌진 후 근접 처형. 총이 없으므로 접근에 실패하면 아무것도 못 한다. 연막과 섬광이 곧 이 캐릭터의 사거리다.",
    traits: ["돌진 후 근접 처형", "투척물 소지 +1", "원거리 공격 수단 없음"],
    stats: { 화력: 5, 기동: 4, 생존: 1 },
  },
  {
    id: "shade",
    name: "SHADE",
    role: "교란",
    weapon: "SHURIKEN",
    weaponId: "shuriken",
    color: "#9ef0ff",
    tagline: "각이 없어도 맞는다",
    desc: "휘어 날아가는 표창으로 엄폐물 뒤를 때린다. 피해량은 낮지만 상대의 자리를 계속 옮기게 만든다.",
    traits: ["곡선 투사체", "명중 시 상대 위치 3초 공개", "피해량 낮음"],
    stats: { 화력: 2, 기동: 4, 생존: 3 },
  },
  {
    id: "mortar",
    name: "MORTAR",
    role: "제압",
    weapon: "GRENADE LAUNCHER",
    weaponId: "grenade_launcher",
    color: "#ffa8f0",
    tagline: "자리를 빼앗는다",
    desc: "곡사 유탄으로 엄폐물 너머를 폭발시킨다. 직접 맞히기보다 상대가 있을 수 없는 구역을 만드는 무기다.",
    traits: ["곡사 광역 폭발", "엄폐물 너머 타격", "자신도 폭발에 피해"],
    stats: { 화력: 4, 기동: 2, 생존: 3 },
  },
];

export function findCharacter(id) {
  return CHARACTERS.find((c) => c.id === id) || null;
}

/** 톱다운 오퍼레이터 초상화. 게임 화면과 같은 시점(위에서 본 모습)으로 그린다. */
export function characterPortrait(character, size = 120) {
  const c = character.color;
  return `
<svg viewBox="0 0 120 120" width="${size}" height="${size}" role="img"
     aria-label="${character.name} 캐릭터 이미지">
  <defs>
    <radialGradient id="g-${character.id}" cx="50%" cy="45%">
      <stop offset="0%" stop-color="${c}" stop-opacity=".28" />
      <stop offset="100%" stop-color="${c}" stop-opacity="0" />
    </radialGradient>
  </defs>
  <circle cx="60" cy="58" r="52" fill="url(#g-${character.id})" />
  <path d="M60 58 L14 24 A56 56 0 0 1 106 24 Z" fill="${c}" opacity=".13" />
  <circle cx="60" cy="58" r="21" fill="#08151c" stroke="${c}" stroke-width="2.5" />
  <circle cx="60" cy="58" r="8" fill="${c}" opacity=".55" />
  <rect x="57" y="16" width="6" height="30" rx="1.5" fill="${c}" />
  <rect x="50" y="34" width="20" height="7" rx="2" fill="#31434c" />
  <circle cx="60" cy="58" r="51" fill="none" stroke="${c}" stroke-width="1" opacity=".33"
          stroke-dasharray="5 8" />
</svg>`.trim();
}

/* ---------------- 맵 3종 ---------------- */

/* 좌표는 게임 index.html 의 layouts 배열 원본. 월드 범위는 대략 ±900 × ±600. */
const LAYOUT_POINTS = {
  crossroads: [
    [-125, 125], [125, 125], [-125, -125], [125, -125],
    [0, 500], [0, -500],
    [-500, 380], [-315, 290], [500, 380], [315, 290],
    [-500, -380], [-315, -290], [500, -380], [315, -290],
    [-675, 135], [-675, -135], [675, 135], [675, -135],
    [-775, 525], [775, 525], [-775, -525], [775, -525],
  ],
  offset: [
    [-145, 135], [145, 105], [-145, -105], [145, -135],
    [80, 515], [-80, -515],
    [-535, 345], [-325, 435], [535, 405], [325, 285],
    [-535, -405], [-325, -285], [535, -345], [325, -435],
    [-700, 160], [-620, -145], [620, 145], [700, -160],
    [-650, 550], [805, 500], [-805, -500], [650, -550],
  ],
  "open-lanes": [
    [-165, 145], [165, 145], [-165, -145], [165, -145],
    [0, 535], [0, -535],
    [-445, 425], [-305, 230], [445, 425], [305, 230],
    [-445, -425], [-305, -230], [445, -425], [305, -230],
    [-735, 155], [-735, -155], [735, 155], [735, -155],
    [-760, 470], [760, 470], [-760, -470], [760, -470],
  ],
};

export const MAPS = [
  {
    id: "crossroads",
    name: "CROSSROADS",
    subtitle: "대칭 · 중앙 교차로",
    desc: "완전 대칭 구조. 중앙 사각 엄폐물 네 개를 먼저 잡는 팀이 각을 만든다. 정직한 교전이 많아 조합 차이가 그대로 드러난다.",
  },
  {
    id: "offset",
    name: "OFFSET",
    subtitle: "비대칭 · 어긋난 라인",
    desc: "엄폐물이 좌우로 어긋나 있어 같은 위치라도 보이는 각이 다르다. 한쪽 롱 라인이 길어 저격·관통 캐릭터가 유리하다.",
  },
  {
    id: "open-lanes",
    name: "OPEN LANES",
    subtitle: "개방 · 넓은 시야",
    desc: "엄폐물이 바깥으로 밀려나 중앙이 넓게 뚫려 있다. 은폐물이 적어 연막과 섬광 없이는 중앙을 건널 수 없다.",
  },
];

export function findMap(id) {
  return MAPS.find((m) => m.id === id) || MAPS[0];
}

/** 실제 엄폐물 좌표로 그리는 미니맵(개략도). 스폰은 좌·우 끝. */
export function mapPreview(map, width = 460) {
  const points = LAYOUT_POINTS[map.id] || [];
  const W = 1900;
  const H = 1300;
  const cover = 96;
  const blocks = points
    .map(
      ([x, y]) =>
        `<rect x="${(x + W / 2 - cover / 2).toFixed(0)}" y="${(H / 2 - y - cover / 2).toFixed(
          0
        )}" width="${cover}" height="${cover}" rx="6" fill="#12242e" stroke="#33525e" stroke-width="4" />`
    )
    .join("");

  return `
<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${width}px" role="img"
     aria-label="${map.name} 맵 개략도">
  <rect width="${W}" height="${H}" fill="#060f16" />
  <g stroke="#0f2029" stroke-width="2">
    ${Array.from({ length: 9 }, (_, i) => `<line x1="${(i + 1) * (W / 10)}" y1="0" x2="${(i + 1) * (W / 10)}" y2="${H}" />`).join("")}
    ${Array.from({ length: 6 }, (_, i) => `<line x1="0" y1="${(i + 1) * (H / 7)}" x2="${W}" y2="${(i + 1) * (H / 7)}" />`).join("")}
  </g>
  <rect x="40" y="${H / 2 - 190}" width="150" height="380" rx="10" fill="#6de6df" opacity=".12" />
  <rect x="${W - 190}" y="${H / 2 - 190}" width="150" height="380" rx="10" fill="#ffab63" opacity=".12" />
  <text x="115" y="${H / 2 + 12}" fill="#6de6df" font-size="52" font-weight="900"
        text-anchor="middle" letter-spacing="4">A</text>
  <text x="${W - 115}" y="${H / 2 + 12}" fill="#ffab63" font-size="52" font-weight="900"
        text-anchor="middle" letter-spacing="4">B</text>
  ${blocks}
  <rect x="4" y="4" width="${W - 8}" height="${H - 8}" fill="none" stroke="#22404c" stroke-width="8" />
</svg>`.trim();
}
