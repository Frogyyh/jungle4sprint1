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

/* ---------------- 맵 7종 ----------------
   로비와 게임은 루트 map-data.js의 동일 좌표/크기를 사용한다. */

const MAP_DATA = window.BREACHLINE_MAP_DATA;
if (!MAP_DATA) throw new Error("map-data.js must load before ui/data.js");

export const MAPS = MAP_DATA.maps;

export function findMap(id) {
  return MAPS.find((m) => m.id === id) || MAPS[0];
}

/** 실제 월드 오브젝트 좌표와 크기를 그대로 축소한 SVG 미니맵. */
export function mapPreview(map, width = 460) {
  const W = MAP_DATA.world.width;
  const H = MAP_DATA.world.height;
  const colors = map.theme;
  const fills = {
    boundary: colors.wall, wall: colors.wall, cover: colors.cover,
    crate: colors.crate, water: colors.water, bush: colors.bush, decor: colors.bush,
  };
  const blocks = map.objects.map((object) => {
    if (object.r) {
      return `<circle cx="${object.x + W / 2}" cy="${H / 2 - object.y}" r="${object.r}" fill="${fills[object.type]}" />`;
    }
    const opacity = object.type === "bush" ? 0.78 : 1;
    const dash = object.type === "bush" ? ' stroke-dasharray="18 10"' : "";
    return `<rect x="${object.x + W / 2 - object.w / 2}" y="${H / 2 - object.y - object.h / 2}"
      width="${object.w}" height="${object.h}" rx="10" fill="${fills[object.type]}" opacity="${opacity}"
      stroke="${object.type === "water" ? "#79d9f5" : "#111827"}" stroke-width="5"${dash} />`;
  }).join("");
  const spawn = (position, color, label) => `<g>
    <circle cx="${position[0] + W / 2}" cy="${H / 2 - position[1]}" r="58" fill="${color}" opacity=".28" />
    <text x="${position[0] + W / 2}" y="${H / 2 - position[1] + 20}" fill="${color}" font-size="58"
      font-weight="900" text-anchor="middle">${label}</text></g>`;
  const objective = map.objective
    ? `<circle cx="${map.objective[0] + W / 2}" cy="${H / 2 - map.objective[1]}" r="48"
        fill="none" stroke="${colors.accent}" stroke-width="14" />`
    : "";

  return `
<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${width}px" role="img"
     aria-label="${map.name} 맵 개략도">
  <rect width="${W}" height="${H}" fill="${colors.floor}" />
  <g stroke="#ffffff" stroke-opacity=".045" stroke-width="3">
    ${Array.from({ length: 9 }, (_, i) => `<line x1="${(i + 1) * (W / 10)}" y1="0" x2="${(i + 1) * (W / 10)}" y2="${H}" />`).join("")}
    ${Array.from({ length: 6 }, (_, i) => `<line x1="0" y1="${(i + 1) * (H / 7)}" x2="${W}" y2="${(i + 1) * (H / 7)}" />`).join("")}
  </g>
  ${blocks}
  ${spawn(MAP_DATA.spawns.player, "#6de6df", "A")}
  ${spawn(MAP_DATA.spawns.enemy, "#ff7a74", "B")}
  ${objective}
</svg>`.trim();
}
