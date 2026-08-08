(() => {
  "use strict";

  /* Breachline 맵/월드 데이터 — 전장(월드 크기, 스폰 좌표, 엄폐물, 부시·물)
     의 단일 원본. game.html 에서 operators.js 직후에 로드되어
     window.BREACHLINE_MAP_DATA 로 노출된다. */
  const WORLD = Object.freeze({ width: 2600, height: 1800 });
  const SPAWNS = Object.freeze({ player: [-1080, 0], enemy: [1080, 0] });
  const rect = (id, type, x, y, w, h) => Object.freeze({ id, type, x, y, w, h });
  const point = (id, type, x, y, r = 28) => Object.freeze({ id, type, x, y, r });
  const bounds = () => [
    rect("boundary-west", "boundary", -1280, 0, 40, 1760),
    rect("boundary-east", "boundary", 1280, 0, 40, 1760),
    rect("boundary-north", "boundary", 0, 880, 2600, 40),
    rect("boundary-south", "boundary", 0, -880, 2600, 40),
  ];
  const oldCover = (points) => points.map(([id, x, y, w, h]) => rect(id, "cover", x, y, w, h));
  const legacy = [
    ["center-nw", -125, 125, 160, 160], ["center-ne", 125, 125, 160, 160],
    ["center-sw", -125, -125, 160, 160], ["center-se", 125, -125, 160, 160],
    ["north-center-cover", 0, 500, 170, 70], ["south-center-cover", 0, -500, 170, 70],
    ["north-west-long", -500, 380, 90, 220], ["north-west-short", -315, 290, 76, 92],
    ["north-east-long", 500, 380, 90, 220], ["north-east-short", 315, 290, 76, 92],
    ["south-west-long", -500, -380, 90, 220], ["south-west-short", -315, -290, 76, 92],
    ["south-east-long", 500, -380, 90, 220], ["south-east-short", 315, -290, 76, 92],
    ["west-mid-upper", -675, 135, 70, 130], ["west-mid-lower", -675, -135, 70, 130],
    ["east-mid-upper", 675, 135, 70, 130], ["east-mid-lower", 675, -135, 70, 130],
    ["corner-nw", -775, 525, 54, 54], ["corner-ne", 775, 525, 54, 54],
    ["corner-sw", -775, -525, 54, 54], ["corner-se", 775, -525, 54, 54],
  ];
  const shiftLegacy = (moves) => legacy.map((entry) => {
    const moved = moves[entry[0]];
    return moved ? [entry[0], moved[0], moved[1], entry[3], entry[4]] : entry;
  });

  const maps = [
    {
      id: "crossroads", name: "CROSSROADS", subtitle: "대칭 · 중앙 교차로",
      desc: "완전 대칭 구조. 중앙 사각 엄폐물 네 개를 먼저 잡는 팀이 각을 만든다.",
      theme: { floor: "#13242c", wall: "#34525d", cover: "#6b3938", water: "#258dc2", bush: "#39784b", crate: "#a86a35", accent: "#6de6df" },
      objects: [...bounds(), ...oldCover(legacy)],
    },
    {
      id: "offset", name: "OFFSET", subtitle: "비대칭 · 어긋난 라인",
      desc: "엄폐물이 좌우로 어긋나 있어 같은 위치라도 보이는 각이 달라지는 전장이다.",
      theme: { floor: "#13242c", wall: "#34525d", cover: "#70433f", water: "#258dc2", bush: "#39784b", crate: "#a86a35", accent: "#ffab63" },
      objects: [...bounds(), ...oldCover(shiftLegacy({
        "center-nw": [-145, 135], "center-ne": [145, 105], "center-sw": [-145, -105], "center-se": [145, -135],
        "north-center-cover": [80, 515], "south-center-cover": [-80, -515], "north-west-long": [-535, 345],
        "north-west-short": [-325, 435], "north-east-long": [535, 405], "north-east-short": [325, 285],
        "south-west-long": [-535, -405], "south-west-short": [-325, -285], "south-east-long": [535, -345],
        "south-east-short": [325, -435], "west-mid-upper": [-700, 160], "west-mid-lower": [-620, -145],
        "east-mid-upper": [620, 145], "east-mid-lower": [700, -160], "corner-nw": [-650, 550],
        "corner-ne": [805, 500], "corner-sw": [-805, -500], "corner-se": [650, -550],
      }))],
    },
    {
      id: "open-lanes", name: "OPEN LANES", subtitle: "개방 · 넓은 시야",
      desc: "중앙이 넓게 열린 장거리 전장. 외곽 엄폐와 투척물을 활용해 전진해야 한다.",
      theme: { floor: "#13242c", wall: "#34525d", cover: "#675151", water: "#258dc2", bush: "#39784b", crate: "#a86a35", accent: "#91b9ff" },
      objects: [...bounds(), ...oldCover(shiftLegacy({
        "center-nw": [-165, 145], "center-ne": [165, 145], "center-sw": [-165, -145], "center-se": [165, -145],
        "north-center-cover": [0, 535], "south-center-cover": [0, -535], "north-west-long": [-445, 425],
        "north-west-short": [-305, 230], "north-east-long": [445, 425], "north-east-short": [305, 230],
        "south-west-long": [-445, -425], "south-west-short": [-305, -230], "south-east-long": [445, -425],
        "south-east-short": [305, -230], "west-mid-upper": [-735, 155], "west-mid-lower": [-735, -155],
        "east-mid-upper": [735, 155], "east-mid-lower": [735, -155], "corner-nw": [-760, 470],
        "corner-ne": [760, 470], "corner-sw": [-760, -470], "corner-se": [760, -470],
      }))],
    },
    {
      id: "ruined-garden", name: "RUINED GARDEN", subtitle: "폐허 정원 · 다중 진입로",
      desc: "끊어진 수풀과 벽돌 폐허 사이로 중앙에 진입하고, 상하 외곽으로 우회하는 정원 전장.",
      theme: { floor: "#171d2d", wall: "#805049", cover: "#a66b42", water: "#249ed0", bush: "#4d873e", crate: "#b9793f", accent: "#8fca63" },
      objects: [...bounds(),
        rect("rg-center-n", "wall", 0, 190, 300, 70), rect("rg-center-s", "wall", 30, -210, 260, 70),
        rect("rg-west-upper", "wall", -470, 330, 100, 250), rect("rg-east-lower", "wall", 470, -330, 100, 250),
        rect("rg-west-mid", "cover", -420, -70, 140, 90), rect("rg-east-mid", "cover", 420, 70, 140, 90),
        rect("rg-west-crate", "crate", -720, 350, 110, 110), rect("rg-east-crate", "crate", 720, -350, 110, 110),
        rect("rg-north-water", "water", 330, 530, 230, 150), rect("rg-south-water", "water", -330, -530, 230, 150),
        rect("rg-bush-nw", "bush", -680, 570, 330, 120), rect("rg-bush-ne", "bush", 660, 340, 280, 100),
        rect("rg-bush-sw", "bush", -650, -330, 300, 110), rect("rg-bush-se", "bush", 690, -570, 330, 120),
        rect("rg-bush-center-w", "bush", -220, 40, 150, 100), rect("rg-bush-center-e", "bush", 230, -30, 150, 100),
      ],
    },
    {
      id: "frost-fortress", name: "FROST FORTRESS", subtitle: "얼음 요새 · 삼중 통로",
      desc: "중앙 다리와 위아래 우회로가 분명하고, 다리 양끝은 열린 공간으로 완충되는 대칭 요새.",
      theme: { floor: "#102847", wall: "#b24ca5", cover: "#83c9e8", water: "#244f82", bush: "#665aa7", crate: "#918ee8", accent: "#e786db" },
      objective: [0, 0],
      objects: [...bounds(),
        rect("ff-mid-n", "water", 0, 190, 620, 180), rect("ff-mid-s", "water", 0, -190, 620, 180),
        rect("ff-bridge-w", "wall", -430, 0, 180, 70), rect("ff-bridge-e", "wall", 430, 0, 180, 70),
        rect("ff-nw", "wall", -510, 430, 320, 90), rect("ff-ne", "wall", 510, 430, 320, 90),
        rect("ff-sw", "wall", -510, -430, 320, 90), rect("ff-se", "wall", 510, -430, 320, 90),
        rect("ff-ice-nw", "cover", -760, 210, 100, 120), rect("ff-ice-ne", "cover", 760, 210, 100, 120),
        rect("ff-ice-sw", "cover", -760, -210, 100, 120), rect("ff-ice-se", "cover", 760, -210, 100, 120),
        rect("ff-center", "cover", 0, 0, 90, 90),
      ],
    },
    {
      id: "brush-maze", name: "BRUSH MAZE", subtitle: "수풀 미로 · 노출과 은폐",
      desc: "수풀 띠가 여러 번 끊겨 있으며 물웅덩이 사이의 노출 통로로 빠르게 횡단할 수 있는 전장.",
      theme: { floor: "#282344", wall: "#6575cf", cover: "#dfb438", water: "#259fd3", bush: "#2f8c3f", crate: "#e5b83d", accent: "#70de84" },
      objects: [...bounds(),
        rect("bm-water-nw", "water", -430, 430, 230, 180), rect("bm-water-se", "water", 430, -430, 230, 180),
        rect("bm-water-ne", "water", 610, 420, 170, 140), rect("bm-water-sw", "water", -610, -420, 170, 140),
        rect("bm-block-n", "wall", 0, 330, 100, 240), rect("bm-block-s", "wall", 0, -330, 100, 240),
        rect("bm-block-w", "wall", -370, 0, 220, 90), rect("bm-block-e", "wall", 370, 0, 220, 90),
        rect("bm-crate-nw", "crate", -690, 170, 80, 80), rect("bm-crate-ne", "crate", 690, 170, 80, 80),
        rect("bm-crate-sw", "crate", -690, -170, 80, 80), rect("bm-crate-se", "crate", 690, -170, 80, 80),
        rect("bm-bush-nw", "bush", -650, 560, 380, 120), rect("bm-bush-n", "bush", -120, 590, 360, 100),
        rect("bm-bush-ne", "bush", 650, 570, 300, 120), rect("bm-bush-w", "bush", -650, 40, 280, 120),
        rect("bm-bush-center", "bush", 0, 0, 180, 110), rect("bm-bush-e", "bush", 650, -40, 280, 120),
        rect("bm-bush-sw", "bush", -650, -570, 300, 120), rect("bm-bush-s", "bush", 120, -590, 360, 100),
        rect("bm-bush-se", "bush", 650, -560, 380, 120),
      ],
    },
    {
      id: "sunscar-canyon", name: "SUNSCAR CANYON", subtitle: "사막 협곡 · 세로 축선",
      desc: "세 개의 긴 세로 통로를 가로 연결부와 상자 엄폐로 끊어 근거리 우회와 장거리 견제를 함께 살린 협곡.",
      theme: { floor: "#d99a5f", wall: "#d8a52f", cover: "#9b5e32", water: "#269ccc", bush: "#bd8424", crate: "#8f522c", accent: "#ffe08a" },
      objects: [...bounds(),
        rect("sc-west-n", "wall", -430, 470, 110, 330), rect("sc-west-s", "wall", -430, -430, 110, 300),
        rect("sc-east-n", "wall", 430, 430, 110, 300), rect("sc-east-s", "wall", 430, -470, 110, 330),
        rect("sc-cross-nw", "wall", -210, 260, 330, 80), rect("sc-cross-se", "wall", 210, -260, 330, 80),
        rect("sc-center-w", "cover", -170, 0, 100, 100), rect("sc-center-e", "cover", 170, 0, 100, 100),
        rect("sc-crate-nw", "crate", -720, 330, 120, 90), rect("sc-crate-ne", "crate", 720, 330, 120, 90),
        rect("sc-crate-sw", "crate", -720, -330, 120, 90), rect("sc-crate-se", "crate", 720, -330, 120, 90),
        rect("sc-oasis-n", "water", 80, 570, 210, 140), rect("sc-oasis-s", "water", -80, -570, 210, 140),
        rect("sc-hay-nw", "bush", -700, 570, 260, 110), rect("sc-hay-ne", "bush", 680, 560, 260, 110),
        rect("sc-hay-sw", "bush", -680, -560, 260, 110), rect("sc-hay-se", "bush", 700, -570, 260, 110),
        point("sc-cactus-nw", "decor", -850, 540), point("sc-cactus-se", "decor", 850, -540),
      ],
    },
  ];

  const data = Object.freeze({
    world: WORLD,
    spawns: SPAWNS,
    maps: Object.freeze(maps.map((map) => Object.freeze({ ...map, objects: Object.freeze(map.objects) }))),
    find(id) { return this.maps.find((map) => map.id === id) || this.maps[0]; },
  });
  window.BREACHLINE_MAP_DATA = data;
})();
