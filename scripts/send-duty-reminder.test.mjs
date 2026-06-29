import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildFeishuCardMessage,
  collectUpcoming,
  findAssignmentForDate,
  formatBeijingDate,
  hasSentOn,
  loadReminderState,
  main
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
            { name: "前端", person: "方思琪", feishuOpenId: "ou_frontend", color: "blue" },
            { name: "后端", person: "李尚忠", color: "green" },
            { name: "测试", person: "谭贤", feishuOpenId: "ou_test", color: "violet" }
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

test("findAssignmentForDate 没有快照但有配置时顺排生成", () => {
  const result = findAssignmentForDate({
    config: {
      teams: [
        { name: "前端", members: ["A", "B"], last: "A", color: "blue" }
      ]
    },
    months: {}
  }, "2026-07-01");

  assert.equal(result.dateStr, "2026/07/01");
  assert.equal(result.teams[0].person, "B");
});

test("buildFeishuCardMessage 用色点标记团队、@ 配了 openId 的人、其余显示姓名", () => {
  const dateInfo = formatBeijingDate(new Date("2026-06-19T01:00:00.000Z"));
  const assignment = findAssignmentForDate(schedule, dateInfo.dateKey);
  const message = buildFeishuCardMessage({ dateInfo, assignment });

  assert.equal(message.msg_type, "interactive");
  assert.equal(message.card.header.template, "blue");
  assert.equal(message.card.header.title.content, "今日值班提醒");

  const lines = message.card.elements
    .filter((el) => el.tag === "div")
    .map((el) => el.text.content);
  assert.deepEqual(lines, [
    "**2026年6月19日　周五**",
    "🔵 **前端**　<at id=ou_frontend></at>",
    "🟢 **后端**　李尚忠",
    "🟣 **测试**　<at id=ou_test></at>"
  ]);

  const button = message.card.elements.find((el) => el.tag === "action").actions[0];
  assert.equal(button.text.content, "查看完整排班");
  assert.equal(button.url, "https://drizeele2026.github.io/work/");
});

test("collectUpcoming 顺排取未来几天、缺的天跳过", () => {
  const multiDay = {
    config: {
      teams: [
        { name: "前端", members: ["郑刘利", "林颖", "林胜聪"], last: "郑刘利", color: "blue" }
      ]
    },
    months: {
      "2026-06": {
        dailyAssignments: [
          { dateStr: "2026/06/20", teams: [{ name: "前端", person: "郑刘利", color: "blue" }] },
          { dateStr: "2026/06/21", teams: [{ name: "前端", person: "林颖", color: "blue" }] },
          { dateStr: "2026/06/22", teams: [{ name: "前端", person: "林胜聪", color: "blue" }] }
        ]
      }
    }
  };
  const days = collectUpcoming(multiDay, "2026-06-20", 3);
  assert.equal(days.length, 3);
  assert.equal(days[0].label, "6/21 周日");
  assert.equal(days[0].teams[0].person, "林颖");
  assert.equal(days[1].label, "6/22 周一");
  assert.equal(days[2].label, "6/23 周二");
});

test("collectUpcoming 在只有 6 月快照时也能预告 7 月前三天", () => {
  const endOfMonth = {
    config: {
      teams: [
        { name: "前端", members: ["A", "B", "C"], last: "A", color: "blue" },
        { name: "后端", members: ["D", "E"], last: "D", color: "green" }
      ]
    },
    months: {
      "2026-06": {
        dailyAssignments: [
          {
            dateStr: "2026/06/30",
            teams: [
              { name: "前端", person: "C", color: "blue" },
              { name: "后端", person: "E", color: "green" }
            ]
          }
        ]
      }
    }
  };

  const days = collectUpcoming(endOfMonth, "2026-06-30", 3);

  assert.deepEqual(days.map((day) => day.label), ["7/1 周三", "7/2 周四", "7/3 周五"]);
  assert.deepEqual(days[0].teams.map((team) => `${team.name}:${team.person}`), [
    "前端:A",
    "后端:D"
  ]);
});

test("buildFeishuCardMessage 预告段只显示姓名、不 @", () => {
  const dateInfo = formatBeijingDate(new Date("2026-06-19T01:00:00.000Z"));
  const assignment = findAssignmentForDate(schedule, dateInfo.dateKey);
  const upcoming = [
    { label: "6/20 周六", teams: [
      { name: "前端", person: "郑刘利", feishuOpenId: "ou_x" },
      { name: "后端", person: "俞如滃", feishuOpenId: "ou_y" }
    ] }
  ];
  const message = buildFeishuCardMessage({ dateInfo, assignment, upcoming });
  const lines = message.card.elements.filter((el) => el.tag === "div").map((el) => el.text.content);
  assert.ok(lines.includes("**接下来**"));
  const upLine = lines.find((l) => l.startsWith("6/20"));
  assert.equal(upLine, "6/20 周六　前端 郑刘利 · 后端 俞如滃");
  assert.ok(!upLine.includes("<at"));   // 未来几天不 @
});

test("findAssignmentForDate can read published object-member schedules", () => {
  const objectMemberSchedule = {
    months: {
      "2026-06": {
        dailyAssignments: [
          {
            dateStr: "2026/06/19",
            teams: [
              {
                name: "前端",
                person: { name: "方思琪", feishuOpenId: "ou_frontend" }
              }
            ]
          }
        ]
      }
    }
  };

  const result = findAssignmentForDate(objectMemberSchedule, "2026-06-19");

  assert.deepEqual(result.teams[0], {
    name: "前端",
    person: "方思琪",
    feishuOpenId: "ou_frontend"
  });
});

test("hasSentOn 只在记录日期等于今天时为真", () => {
  assert.equal(hasSentOn({ lastSentDate: "2026-06-20" }, "2026-06-20"), true);
  assert.equal(hasSentOn({ lastSentDate: "2026-06-19" }, "2026-06-20"), false);
  assert.equal(hasSentOn({}, "2026-06-20"), false);
  assert.equal(hasSentOn(null, "2026-06-20"), false);
});

test("loadReminderState 在状态文件不存在时返回空对象", async () => {
  const result = await loadReminderState("scripts/__no_such_reminder_state__.json");
  assert.deepEqual(result, {});
});

async function setupTmp() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "duty-"));
  const schedulePath = path.join(dir, "schedule.json");
  const statePath = path.join(dir, "state.json");
  await fs.writeFile(schedulePath, JSON.stringify({
    config: {
      teams: [
        { name: "前端", members: [{ name: "郑刘利", feishuOpenId: "ou_x" }, "林颖"], last: "林颖", color: "blue" }
      ]
    },
    months: {
      "2026-06": {
        dailyAssignments: [
          { dateStr: "2026/06/20", teams: [{ name: "前端", person: "郑刘利", feishuOpenId: "ou_x", color: "blue" }] }
        ]
      }
    }
  }));
  return { schedulePath, statePath };
}

async function withMockFetch(fn) {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, text: async () => '{"code":0}' });
  try { return await fn(); } finally { globalThis.fetch = orig; }
}

test("main：force 发送后不写去重状态（不占当天名额）", async () => {
  const { schedulePath, statePath } = await setupTmp();
  await withMockFetch(() => main([], {
    FORCE_SEND: "1",
    REMINDER_DATE: "2026-06-20T02:00:00Z",
    SCHEDULE_PATH: schedulePath,
    REMINDER_STATE_PATH: statePath,
    FEISHU_WEBHOOK: "https://example.com/hook"
  }));
  let exists = true;
  try { await fs.access(statePath); } catch { exists = false; }
  assert.equal(exists, false, "force 模式不应写状态文件");
});

test("main：普通触发发送后写入去重状态", async () => {
  const { schedulePath, statePath } = await setupTmp();
  await withMockFetch(() => main([], {
    REMINDER_DATE: "2026-06-20T02:00:00Z",
    SCHEDULE_PATH: schedulePath,
    REMINDER_STATE_PATH: statePath,
    FEISHU_WEBHOOK: "https://example.com/hook"
  }));
  const saved = JSON.parse(await fs.readFile(statePath, "utf8"));
  assert.equal(saved.lastSentDate, "2026-06-20");
});
