import { test } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, loadScript } from "../test-helpers.mjs";

test("map-data.js는 맵/월드 데이터를 노출한다", () => {
  const context = createSandbox();
  loadScript(context, "map-data.js");
  const data = context.BREACHLINE_MAP_DATA;

  assert.equal(data.world.width, 2600);
  assert.equal(data.world.height, 1800);
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

test("모든 맵은 월드 경계 밖을 벗어나지 않는다", () => {
  const context = createSandbox();
  loadScript(context, "map-data.js");
  const data = context.BREACHLINE_MAP_DATA;

  for (const map of data.maps) {
    for (const object of map.objects) {
      const halfWidth = (object.w || object.r * 2 || 0) / 2;
      const halfHeight = (object.h || object.r * 2 || 0) / 2;
      assert.ok(Math.abs(object.x) + halfWidth <= data.world.width / 2 + 60,
        `${map.id} 의 오브젝트 ${object.id} 가 경계를 벗어났다`);
      assert.ok(Math.abs(object.y) + halfHeight <= data.world.height / 2 + 60,
        `${map.id} 의 오브젝트 ${object.id} 가 경계를 벗어났다`);
    }
  }
});
