/* Breachline UI — 캐릭터 / 맵 데이터.
   이미지 에셋이 없으므로 초상화·미니맵은 SVG 로 그린다.
   병과 데이터는 루트 operators.js, 맵 데이터와 SVG 렌더링은 이 파일이 담당한다. */

/* ---------------- 캐릭터 10인 ----------------
   단일 원본은 루트 operators.js다. 로비와 실제 게임이 같은 데이터를 공유한다. */

export const CHARACTERS = window.BREACHLINE_OPERATORS || [];

export function findCharacter(id) {
  return window.findBreachlineOperator ? window.findBreachlineOperator(id) : null;
}

/** 톱다운 오퍼레이터 초상화. 게임 화면과 같은 시점(위에서 본 모습)으로 그린다. */
export function characterPortrait(character, size = 120) {
  const c = character.color;
  const symbol = character.symbol || "◆";
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
  <circle cx="60" cy="58" r="23" fill="#08151c" stroke="${c}" stroke-width="2.5" />
  <text x="60" y="68" text-anchor="middle" font-size="25" font-family="Segoe UI Emoji, sans-serif">${symbol}</text>
  <rect x="57" y="13" width="6" height="25" rx="1.5" fill="${c}" opacity=".8" />
  <rect x="48" y="35" width="24" height="5" rx="2" fill="#31434c" />
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
