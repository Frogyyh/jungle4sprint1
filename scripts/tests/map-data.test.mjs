import { test } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, loadScript } from "../test-helpers.mjs";

test("map-data.js는 맵/월드 데이터를 노출한다", () => {
  const context = createSandbox();
  loadScript(context, "map-data.js");
  const data = context.BREACHLINE_MAP_DATA;

  assert.equal(data.world.width, 2600);
  assert.equal(data.world.height, 1800);
  assert.equal(data.spawnDepth, 300);
  assert.equal(data.spawnLength, 900);
  assert.equal(data.spawns.player[0], -1450, "블루/좌 스폰은 맵 밖 좌측");
  assert.equal(data.spawns.player[1], 0);
  assert.equal(data.spawns.enemy[0], 1450, "레드/우 스폰은 맵 밖 우측");
  assert.equal(data.spawns.enemy[1], 0);
  assert.ok(Object.isFrozen(data.maps), "맵 목록은 동결되어야 한다");
  assert.ok(data.maps.length >= 7, "선택 가능한 맵이 7개 이상이어야 한다");
});

test("find 는 없는 맵을 첫 맵으로 폴백한다", () => {
  const context = createSandbox();
  loadScript(context, "map-data.js");
  const data = context.BREACHLINE_MAP_DATA;

  assert.equal(data.find("crossroads").id, "crossroads");
  assert.equal(data.find("missing-map").id, data.maps[0].id);
});

test("모든 맵은 스폰 구역을 포함한 경계 안에 있다", () => {
  const context = createSandbox();
  loadScript(context, "map-data.js");
  const data = context.BREACHLINE_MAP_DATA;
  // 스폰 구역이 맵 밖(x±1300~±1600)으로 확장되므로, 확장 경계를 기준으로 검증
  const xBound = data.world.width / 2 + data.spawnDepth + 60;
  const yBound = data.world.height / 2 + 60;

  for (const map of data.maps) {
    for (const object of map.objects) {
      const halfWidth = (object.w || object.r * 2 || 0) / 2;
      const halfHeight = (object.h || object.r * 2 || 0) / 2;
      assert.ok(Math.abs(object.x) + halfWidth <= xBound,
        `${map.id} 의 오브젝트 ${object.id} 가 경계를 벗어났다`);
      assert.ok(Math.abs(object.y) + halfHeight <= yBound,
        `${map.id} 의 오브젝트 ${object.id} 가 경계를 벗어났다`);
    }
  }
});

test("모든 맵은 좌/우 맵 밖 스폰 구역과 경계 틈을 가진다", () => {
  const context = createSandbox();
  loadScript(context, "map-data.js");
  const data = context.BREACHLINE_MAP_DATA;

  for (const map of data.maps) {
    const ids = map.objects.map((object) => object.id);
    for (const id of ["spawn-blue-outer", "spawn-blue-top", "spawn-blue-bottom",
      "spawn-red-outer", "spawn-red-top", "spawn-red-bottom"]) {
      assert.ok(ids.includes(id), `${map.id} 는 ${id} 를 가져야 한다`);
    }
    // 좌/우 경계가 상·하로 분리되어 중앙에 진입 틈(y=-450~+450)이 남는다
    assert.ok(ids.includes("boundary-west-top") && ids.includes("boundary-west-bottom"));
    assert.ok(ids.includes("boundary-east-top") && ids.includes("boundary-east-bottom"));
  }

  const blue = data.find("crossroads").objects.find((object) => object.id === "spawn-blue-outer");
  assert.equal(blue.x, -1600);
  assert.equal(blue.h, data.spawnLength);
});
