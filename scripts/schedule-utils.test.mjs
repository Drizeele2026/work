import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../schedule-utils.js", import.meta.url), "utf8");
const context = { window: {}, console, module: { exports: {} } };
vm.createContext(context);
vm.runInContext(source, context);
const utils = context.module.exports;

const schedule = {
  config: {
    teams: [
      {
        name: "前端",
        members: [
          { name: "A", feishuOpenId: "ou_a" },
          { name: "B", feishuOpenId: "ou_b" },
          { name: "C", feishuOpenId: "ou_c" }
        ],
        last: "A",
        color: "blue"
      },
      {
        name: "后端",
        members: ["D", "E"],
        last: "D",
        color: "green"
      }
    ]
  },
  months: {
    "2026-06": {
      dailyAssignments: [
        {
          dateStr: "2026/06/30",
          weekdayStr: "周二",
          teams: [
            { name: "前端", person: "C", feishuOpenId: "ou_c", color: "blue" },
            { name: "后端", person: "E", color: "green" }
          ]
        }
      ]
    }
  }
};

test("findAssignmentForDateWithFallback 优先读取已有快照", () => {
  const result = utils.findAssignmentForDateWithFallback(schedule, "2026-06-30");

  assert.deepEqual(result.teams.map((team) => `${team.name}:${team.person}`), [
    "前端:C",
    "后端:E"
  ]);
});

test("findAssignmentForDateWithFallback 没有下月快照时从最近历史快照继续顺排", () => {
  const result = utils.findAssignmentForDateWithFallback(schedule, "2026-07-01");

  assert.deepEqual(result.teams.map((team) => `${team.name}:${team.person}`), [
    "前端:A",
    "后端:D"
  ]);
  assert.equal(result.teams[0].feishuOpenId, "ou_a");
});

test("顺排生成未来日期时从历史快照补全 OpenID", () => {
  const historyOnlyOpenId = {
    config: {
      teams: [
        { name: "后端", members: ["D", "E"], last: "D", color: "green" }
      ]
    },
    months: {
      "2026-06": {
        dailyAssignments: [
          { dateStr: "2026/06/29", teams: [{ name: "后端", person: "D", feishuOpenId: "ou_d", color: "green" }] },
          { dateStr: "2026/06/30", teams: [{ name: "后端", person: "E", feishuOpenId: "ou_e", color: "green" }] }
        ]
      }
    }
  };

  const result = utils.findAssignmentForDateWithFallback(historyOnlyOpenId, "2026-07-01");

  assert.equal(result.teams[0].person, "D");
  assert.equal(result.teams[0].feishuOpenId, "ou_d");
});

test("显式 currentDay 节点优先于历史快照种子", () => {
  const withAnchor = structuredClone(schedule);
  withAnchor.config.teams[0].anchors = [
    { date: "2026-07-02", mode: "currentDay", person: "B" }
  ];

  const result = utils.findAssignmentForDateWithFallback(withAnchor, "2026-07-03");

  assert.equal(result.teams.find((team) => team.name === "前端").person, "C");
});

test("collectUpcoming 跨月返回未来三天", () => {
  const result = utils.collectUpcoming(schedule, "2026-06-30", 3);

  assert.deepEqual(Array.from(result, (day) => day.label), ["7/1 周三", "7/2 周四", "7/3 周五"]);
  assert.deepEqual(result[0].teams.map((team) => `${team.name}:${team.person}`), [
    "前端:A",
    "后端:D"
  ]);
});

test("generateAssignmentsForMonth 没有月快照时按配置生成整月", () => {
  const result = utils.generateAssignmentsForMonth(schedule, 2026, 7);

  assert.equal(result.daysInMonth, 31);
  assert.equal(result.dailyAssignments[0].dateStr, "2026/07/01");
  assert.equal(result.dailyAssignments[0].teams[0].person, "A");
});

test("没有快照且没有 config.teams 时给中文错误", () => {
  assert.throws(
    () => utils.findAssignmentForDateWithFallback({ months: {} }, "2026-07-01"),
    /没有可用于顺排的团队配置/
  );
});
