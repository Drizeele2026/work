import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFeishuTextMessage,
  findAssignmentForDate,
  formatBeijingDate
} from "./send-duty-reminder.mjs";

const schedule = {
  months: {
    "2026-06": {
      dailyAssignments: [
        {
          day: 19,
          dateStr: "2026/06/19",
          weekdayStr: "周五",
          teams: [
            { name: "前端", person: "方思琪" },
            { name: "后端", person: "李尚忠" },
            { name: "测试", person: "谭贤" }
          ]
        }
      ]
    }
  }
};

test("formatBeijingDate returns Beijing calendar fields", () => {
  const result = formatBeijingDate(new Date("2026-06-19T01:00:00.000Z"));

  assert.deepEqual(result, {
    dateKey: "2026-06-19",
    monthKey: "2026-06",
    displayDate: "2026年6月19日",
    weekday: "周五"
  });
});

test("findAssignmentForDate reads today's duty from schedule.json", () => {
  const result = findAssignmentForDate(schedule, "2026-06-19");

  assert.equal(result.dateStr, "2026/06/19");
  assert.deepEqual(
    result.teams.map((team) => `${team.name}:${team.person}`),
    ["前端:方思琪", "后端:李尚忠", "测试:谭贤"]
  );
});

test("findAssignmentForDate reports missing month clearly", () => {
  assert.throws(
    () => findAssignmentForDate({ months: {} }, "2026-06-19"),
    /没有找到 2026-06 的已发布排班/
  );
});

test("buildFeishuTextMessage formats a plain group reminder", () => {
  const dateInfo = formatBeijingDate(new Date("2026-06-19T01:00:00.000Z"));
  const assignment = findAssignmentForDate(schedule, dateInfo.dateKey);
  const message = buildFeishuTextMessage({ dateInfo, assignment });

  assert.deepEqual(message, {
    msg_type: "text",
    content: {
      text: [
        "今日值班提醒",
        "2026年6月19日 周五",
        "",
        "前端：方思琪",
        "后端：李尚忠",
        "测试：谭贤",
        "",
        "排班表：https://drizeele2026.github.io/work/"
      ].join("\n")
    }
  });
});
