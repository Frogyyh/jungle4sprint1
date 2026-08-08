import { test } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, loadScript } from "../test-helpers.mjs";

function loadOperators() {
  const context = createSandbox();
  loadScript(context, "balance.js");
  loadScript(context, "operators.js");
  return context;
}

test("operators.js는 10개 병과 로스터를 노출한다", () => {
  const context = loadOperators();
  const operators = context.BREACHLINE_OPERATORS;

  assert.equal(operators.length, 10);
  for (const operator of operators) {
    assert.ok(operator.id, "병과 id 가 있어야 한다");
    assert.ok(operator.name, "병과 이름이 있어야 한다");
    assert.ok(operator.weaponId, "무기 id 가 있어야 한다");
    assert.ok(operator.controls, "조작 정의가 있어야 한다");
    assert.ok(operator.color.startsWith("#"), "색상이 헥스여야 한다");
    assert.equal(operator.id, context.BREACHLINE_OPERATOR_BY_ID[operator.id].id);
  }
});

test("findBreachlineOperator 는 알 수 없는 id 를 soldier 로 폴백한다", () => {
  const context = loadOperators();

  assert.equal(context.findBreachlineOperator("soldier").id, "soldier");
  assert.equal(context.findBreachlineOperator("missing").id, "soldier");
  assert.equal(context.findBreachlineOperator(undefined).id, "soldier");
  assert.equal(context.resolveBreachlineOperatorId("missing"), "soldier");
});
