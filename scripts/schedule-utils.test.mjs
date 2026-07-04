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
  version: 2,
  current: {
    teams: [
      {
        name: "前端",
        color: "blue",
        members: [
          { name: "A", feishuOpenId: "ou_a" },
          { name: "B", feishuOpenId: "ou_b" },
          { name: "C", feishuOpenId: "ou_c" }
        ]
      },
      {
        name: "后端",
        color: "green",
        members: ["D", "E"]
      }
    ]
  },
  ruleVersions: [
    {
      effectiveDate: "2026-06-30",
      teams: [
        {
          name: "前端",
          color: "blue",
          startPerson: "C",
          members: [
            { name: "A", feishuOpenId: "ou_a" },
            { name: "B", feishuOpenId: "ou_b" },
            { name: "C", feishuOpenId: "ou_c" }
          ]
        },
        {
          name: "后端",
          color: "green",
          startPerson: "E",
          members: ["D", "E"]
        }
      ]
    }
  ]
};

test("findAssignmentForDateWithFallback 按规则版本计算当天值班", () => {
  const result = utils.findAssignmentForDateWithFallback(schedule, "2026-07-01");

  assert.deepEqual(result.teams.map((team) => `${team.name}:${team.person}`), [
    "前端:A",
    "后端:D"
  ]);
  assert.equal(result.teams[0].feishuOpenId, "ou_a");
});

test("collectUpcoming 跨月返回未来三天", () => {
  const result = utils.collectUpcoming(schedule, "2026-06-30", 3);

  assert.deepEqual(Array.from(result, (day) => day.label), ["7/1 周三", "7/2 周四", "7/3 周五"]);
  assert.deepEqual(result[0].teams.map((team) => `${team.name}:${team.person}`), [
    "前端:A",
    "后端:D"
  ]);
});

test("generateAssignmentsForMonth 按规则版本生成整月", () => {
  const result = utils.generateAssignmentsForMonth(schedule, 2026, 7);

  assert.equal(result.daysInMonth, 31);
  assert.equal(result.dailyAssignments[0].dateStr, "2026/07/01");
  assert.deepEqual(result.dailyAssignments[0].teams.map((team) => `${team.name}:${team.person}`), [
    "前端:A",
    "后端:D"
  ]);
});

test("发布当天原值班人仍在新名单里，当天不变，后续按新名单顺排", () => {
  const remote = {
    version: 2,
    current: {
      teams: [
        { name: "测试", color: "violet", members: ["许绵绵", "郑成清", "谭贤", "钟右梅"] }
      ]
    },
    ruleVersions: [
      {
        effectiveDate: "2026-07-01",
        teams: [
          { name: "测试", color: "violet", startPerson: "谭贤", members: ["许绵绵", "郑成清", "谭贤", "钟右梅"] }
        ]
      }
    ]
  };
  const nextTeams = [
    { name: "测试", color: "violet", members: ["许绵绵", "郑成清", "谭贤", "钟右梅", "陈鸿历"] }
  ];

  const document = utils.buildPublishedDocument(remote, nextTeams, {
    publishDateKey: "2026-07-04",
    updatedAt: "2026-07-04T00:00:00.000Z"
  });

  assert.deepEqual(
    ["2026-07-03", "2026-07-04", "2026-07-05", "2026-07-06", "2026-07-07"].map((dateKey) => {
      const team = utils.findAssignmentForDateWithFallback(document, dateKey).teams[0];
      return `${dateKey}:${team.person}`;
    }),
    [
      "2026-07-03:许绵绵",
      "2026-07-04:郑成清",
      "2026-07-05:谭贤",
      "2026-07-06:钟右梅",
      "2026-07-07:陈鸿历"
    ]
  );
  assert.equal(document.ruleVersions.at(-1).teams[0].startPerson, "郑成清");
});

test("发布当天原值班人被移除，从新名单第一个人开始", () => {
  const remote = {
    version: 2,
    current: {
      teams: [
        { name: "测试", color: "violet", members: ["许绵绵", "郑成清", "谭贤"] }
      ]
    },
    ruleVersions: [
      {
        effectiveDate: "2026-07-01",
        teams: [
          { name: "测试", color: "violet", startPerson: "郑成清", members: ["许绵绵", "郑成清", "谭贤"] }
        ]
      }
    ]
  };
  const nextTeams = [
    { name: "测试", color: "violet", members: ["谭贤", "钟右梅"] }
  ];

  const document = utils.buildPublishedDocument(remote, nextTeams, {
    publishDateKey: "2026-07-03",
    updatedAt: "2026-07-03T00:00:00.000Z"
  });

  assert.equal(utils.findAssignmentForDateWithFallback(document, "2026-07-03").teams[0].person, "谭贤");
  assert.equal(document.ruleVersions.at(-1).teams[0].startPerson, "谭贤");
});

test("名单没变化时重复发布不追加规则版本", () => {
  const remote = {
    version: 2,
    current: {
      teams: [
        { name: "前端", color: "blue", members: ["A", "B"] }
      ]
    },
    ruleVersions: [
      {
        effectiveDate: "2026-07-01",
        teams: [
          { name: "前端", color: "blue", startPerson: "A", members: ["A", "B"] }
        ]
      }
    ]
  };

  const document = utils.buildPublishedDocument(remote, remote.current.teams, {
    publishDateKey: "2026-07-04",
    updatedAt: "2026-07-04T00:00:00.000Z"
  });

  assert.equal(document.ruleVersions.length, 1);
});

test("没有规则版本且没有 current.teams 时给中文错误", () => {
  assert.throws(
    () => utils.findAssignmentForDateWithFallback({ version: 2 }, "2026-07-01"),
    /没有可用于顺排的团队规则/
  );
});
