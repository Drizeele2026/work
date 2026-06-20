import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildFeishuPostMessage,
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
            { name: "前端", person: "方思琪", feishuOpenId: "ou_frontend" },
            { name: "后端", person: "李尚忠" },
            { name: "测试", person: "谭贤", feishuOpenId: "ou_test" }
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

test("buildFeishuPostMessage mentions configured users and falls back to names", () => {
  const dateInfo = formatBeijingDate(new Date("2026-06-19T01:00:00.000Z"));
  const assignment = findAssignmentForDate(schedule, dateInfo.dateKey);
  const message = buildFeishuPostMessage({ dateInfo, assignment });

  assert.deepEqual(message, {
    msg_type: "post",
    content: {
      post: {
        zh_cn: {
          title: "今日值班提醒",
          content: [
            [{ tag: "text", text: "2026年6月19日 周五" }],
            [{ tag: "text", text: "今日值班" }],
            [
              { tag: "text", text: "前端：" },
              { tag: "at", user_id: "ou_frontend", user_name: "方思琪" }
            ],
            [
              { tag: "text", text: "后端：" },
              { tag: "text", text: "李尚忠" }
            ],
            [
              { tag: "text", text: "测试：" },
              { tag: "at", user_id: "ou_test", user_name: "谭贤" }
            ],
            [
              { tag: "text", text: "排班表：" },
              { tag: "a", text: "查看公开排班", href: "https://drizeele2026.github.io/work/" }
            ]
          ]
        }
      }
    }
  });
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
    months: { "2026-06": { dailyAssignments: [
      { dateStr: "2026/06/20", teams: [{ name: "前端", person: "郑刘利", feishuOpenId: "ou_x" }] }
    ] } }
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
