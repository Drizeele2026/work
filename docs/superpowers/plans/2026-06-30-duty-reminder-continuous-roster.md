# Duty Reminder Continuous Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 取消 GitHub Actions 自带定时，只保留 cron-job.org 触发，并让提醒和公开页在没有月快照时按已发布规则连续顺排。

**Architecture:** 保持静态站架构，不引入构建工具。新增一个浏览器和 Node 都能使用的 `schedule-utils.js`，集中处理日期、接龙节点、历史快照优先和配置顺排兜底；提醒脚本和公开页都调用同一套规则。已有 `months` 继续作为历史快照，`config.teams` 作为长期规则来源。

**Tech Stack:** 原生 HTML/CSS/JavaScript，Node.js ESM 脚本，CommonJS 兼容的浏览器 IIFE，`node:test`/`assert`，GitHub Actions YAML。

## Global Constraints

- 默认中文文案和中文错误提示。
- 不引入后端服务、数据库或构建工具。
- 不一次性生成未来多个月写进 `schedule.json`。
- `workflow_dispatch`、`force` 输入和 `data/reminder-state.json` 去重继续保留。
- 已存在历史快照时优先使用快照；没有快照时按 `config.teams`、`anchors`、最近历史快照和旧 `last` 连续顺排。
- 修改某团队某天接龙节点后，这一天及之后按新节点顺排；这一天之前的历史排班不主动改。

---

## File Structure

- Create: `/private/tmp/workrepo.reminder-debug/schedule-utils.js`
  - 纯函数模块。浏览器通过 `window.DutyRosterSchedule` 使用；Node 通过 `import scheduleUtils from "../schedule-utils.js"` 使用 CommonJS default import。
- Create: `/private/tmp/workrepo.reminder-debug/scripts/schedule-utils.test.mjs`
  - 覆盖跨月顺排、历史快照种子、显式节点优先、快照优先和缺配置报错。
- Modify: `/private/tmp/workrepo.reminder-debug/scripts/send-duty-reminder.mjs`
  - 删除脚本内“只查 months”的排班查找逻辑，改用 `schedule-utils.js`。
- Modify: `/private/tmp/workrepo.reminder-debug/scripts/send-duty-reminder.test.mjs`
  - 保留旧导出兼容测试，新增 6/30 预告 7/1-7/3。
- Modify: `/private/tmp/workrepo.reminder-debug/index.html`
  - 加载 `schedule-utils.js`，公开页缺月快照时按已发布规则生成目标月。
- Modify: `/private/tmp/workrepo.reminder-debug/admin/index.html`
  - 与公开页同步加载和回退逻辑，避免两个页面漂移。
- Modify: `/private/tmp/workrepo.reminder-debug/scripts/verify-duty-anchors.mjs`
  - 增加 HTML 加载 `schedule-utils.js` 和缺月快照回退的静态检查。
- Modify: `/private/tmp/workrepo.reminder-debug/.github/workflows/duty-reminder.yml`
  - 删除 `on.schedule`，只保留 `workflow_dispatch`。
- Modify: `/private/tmp/workrepo.reminder-debug/README.md`
  - 更新“提醒任务”和“发布排班”说明，去掉必须逐月发布的说法。
- Modify: `/private/tmp/workrepo.reminder-debug/scripts/verify-readonly-layout.mjs`
  - 如果 README 校验文字受影响，同步改断言。

---

### Task 1: 新增共享连续顺排函数

**Files:**
- Create: `/private/tmp/workrepo.reminder-debug/schedule-utils.js`
- Create: `/private/tmp/workrepo.reminder-debug/scripts/schedule-utils.test.mjs`

**Interfaces:**
- Consumes: `schedule.json` 结构：`{ config: { teams: [...] }, months: { [monthKey]: { dailyAssignments: [...] } } }`
- Produces:
  - `DutyRosterSchedule.normalizeDateKey(value: string): string`
  - `DutyRosterSchedule.dateKeyForDay(year: number, month: number, day: number): string`
  - `DutyRosterSchedule.findAssignmentForDateWithFallback(schedule: object, dateKey: string): Assignment`
  - `DutyRosterSchedule.collectUpcoming(schedule: object, todayKey: string, days: number): UpcomingDay[]`
  - `DutyRosterSchedule.generateAssignmentsForMonth(schedule: object, year: number, month: number): MonthResult`

- [ ] **Step 1: 写失败测试**

Create `/private/tmp/workrepo.reminder-debug/scripts/schedule-utils.test.mjs`:

```js
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

  assert.deepEqual(result.map((day) => day.label), ["7/1 周三", "7/2 周四", "7/3 周五"]);
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
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node --test scripts/schedule-utils.test.mjs
```

Expected: FAIL，错误包含 `ENOENT` 或 `Cannot find module`，因为 `schedule-utils.js` 还没创建。

- [ ] **Step 3: 写最小实现**

Create `/private/tmp/workrepo.reminder-debug/schedule-utils.js` with these exported functions and no DOM dependency:

```js
(function (global) {
  const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function normalizeDateKey(value) {
    const text = String(value || "").trim().replaceAll("/", "-");
    const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match) return "";
    return `${match[1]}-${pad2(Number(match[2]))}-${pad2(Number(match[3]))}`;
  }

  function dateKeyForDay(year, month, day) {
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  function monthKeyForDate(dateKey) {
    return normalizeDateKey(dateKey).slice(0, 7);
  }

  function daysBetweenDateKeys(fromKey, toKey) {
    const [fromYear, fromMonth, fromDay] = normalizeDateKey(fromKey).split("-").map(Number);
    const [toYear, toMonth, toDay] = normalizeDateKey(toKey).split("-").map(Number);
    return Math.round((Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / 86400000);
  }

  function wrapIndex(index, length) {
    return ((index % length) + length) % length;
  }

  function normalizeMember(member) {
    if (typeof member === "string") {
      return { name: member.trim().replace(/@/g, ""), feishuOpenId: "" };
    }
    return {
      name: String(member?.name || "").trim().replace(/@/g, ""),
      feishuOpenId: String(member?.feishuOpenId || "").trim()
    };
  }

  function normalizeMembers(members) {
    return (Array.isArray(members) ? members : []).map(normalizeMember).filter((member) => member.name);
  }

  function normalizeDutyTeam(team, index = 0) {
    const personValue = typeof team?.person === "object" && team.person ? team.person : { name: team?.person };
    return {
      name: String(team?.name || `团队${index + 1}`).trim(),
      person: normalizeMember(personValue).name,
      feishuOpenId: String(team?.feishuOpenId || normalizeMember(personValue).feishuOpenId || "").trim(),
      color: typeof team?.color === "string" ? team.color : (team?.color?.name || "")
    };
  }

  function normalizeTeam(team, index = 0) {
    return {
      name: String(team?.name || `团队${index + 1}`).trim(),
      members: normalizeMembers(team?.members),
      last: String(team?.last || "").trim().replace(/@/g, ""),
      anchors: normalizeAnchors(team?.anchors, normalizeMembers(team?.members).map((member) => member.name)),
      color: typeof team?.color === "string" ? team.color : (team?.color?.name || "")
    };
  }

  function normalizeAnchors(anchors, names) {
    const seen = new Map();
    (Array.isArray(anchors) ? anchors : []).forEach((anchor) => {
      const date = normalizeDateKey(anchor?.date);
      const person = String(anchor?.person || "").trim().replace(/@/g, "");
      const mode = anchor?.mode === "previousDay" ? "previousDay" : "currentDay";
      if (!date || !names.includes(person)) return;
      seen.set(date, { date, mode, person });
    });
    return [...seen.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  function getAnchorForDate(dateKey, anchors) {
    return (Array.isArray(anchors) ? anchors : []).filter((anchor) => anchor.date <= dateKey).at(-1) || null;
  }

  function getPersonFromAnchor(anchor, dateKey, names) {
    if (!anchor || !names.length) return "";
    const anchorIndex = names.indexOf(anchor.person);
    if (anchorIndex < 0) return "";
    const modeOffset = anchor.mode === "previousDay" ? 1 : 0;
    return names[wrapIndex(anchorIndex + modeOffset + daysBetweenDateKeys(anchor.date, dateKey), names.length)];
  }

  function findPublishedAssignment(schedule, dateKey) {
    const month = schedule?.months?.[monthKeyForDate(dateKey)];
    const day = month?.dailyAssignments?.find((item) => normalizeDateKey(item.dateStr) === dateKey);
    if (!day) return null;
    return {
      ...day,
      dateStr: day.dateStr || dateKey.replaceAll("-", "/"),
      teams: (Array.isArray(day.teams) ? day.teams : []).map(normalizeDutyTeam)
    };
  }

  function findLatestSnapshotBeforeDate(schedule, dateKey, teamName) {
    let latest = null;
    Object.values(schedule?.months || {}).forEach((month) => {
      (month.dailyAssignments || []).forEach((day) => {
        const dayKey = normalizeDateKey(day.dateStr);
        if (!dayKey || dayKey >= dateKey) return;
        const team = (day.teams || []).map(normalizeDutyTeam).find((item) => item.name === teamName);
        if (team?.person && (!latest || dayKey > latest.date)) {
          latest = { date: dayKey, person: team.person };
        }
      });
    });
    return latest;
  }

  function generateTeamForDate(schedule, team, teamIndex, dateKey) {
    const normalized = normalizeTeam(team, teamIndex);
    if (!normalized.members.length) {
      throw new Error(`团队【${normalized.name}】没有可用于顺排的成员名单。`);
    }
    const names = normalized.members.map((member) => member.name);
    const snapshot = findLatestSnapshotBeforeDate(schedule, dateKey, normalized.name);
    const anchors = [...normalized.anchors];
    if (snapshot) anchors.push({ date: snapshot.date, mode: "previousDay", person: snapshot.person });
    anchors.sort((a, b) => a.date.localeCompare(b.date));
    const anchor = getAnchorForDate(dateKey, anchors);
    const person = anchor
      ? getPersonFromAnchor(anchor, dateKey, names)
      : names[wrapIndex(names.indexOf(normalized.last) + Number(dateKey.slice(8, 10)), names.length)];
    const member = normalized.members.find((item) => item.name === person) || normalized.members[0];
    return {
      name: normalized.name,
      person: member.name,
      feishuOpenId: member.feishuOpenId,
      color: normalized.color
    };
  }

  function teamsFromConfig(schedule) {
    const teams = (Array.isArray(schedule?.config?.teams) ? schedule.config.teams : []).map(normalizeTeam);
    if (!teams.length) {
      throw new Error("没有找到当天值班快照，也没有可用于顺排的团队配置。请先配置成员名单和接龙节点。");
    }
    return teams;
  }

  function generatedAssignmentForDate(schedule, dateKey) {
    const [year, month, day] = normalizeDateKey(dateKey).split("-").map(Number);
    const date = new Date(year, month - 1, day);
    const teams = teamsFromConfig(schedule).map((team, index) => generateTeamForDate(schedule, team, index, dateKey));
    return {
      day,
      dateStr: `${year}/${pad2(month)}/${pad2(day)}`,
      weekdayStr: WEEKDAYS[date.getDay()],
      teams
    };
  }

  function findAssignmentForDateWithFallback(schedule, dateKey) {
    const normalizedDate = normalizeDateKey(dateKey);
    if (!normalizedDate) throw new Error(`日期格式不正确：${dateKey}`);
    return findPublishedAssignment(schedule, normalizedDate) || generatedAssignmentForDate(schedule, normalizedDate);
  }

  function formatUpcomingLabel(dateKey) {
    const [year, month, day] = dateKey.split("-").map(Number);
    return `${month}/${day} ${WEEKDAYS[new Date(year, month - 1, day).getDay()]}`;
  }

  function addDays(dateKey, days) {
    const [year, month, day] = normalizeDateKey(dateKey).split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return dateKeyForDay(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  function collectUpcoming(schedule, todayKey, days = 3) {
    const result = [];
    for (let offset = 1; offset <= days; offset++) {
      const dateKey = addDays(todayKey, offset);
      const assignment = findAssignmentForDateWithFallback(schedule, dateKey);
      result.push({ label: formatUpcomingLabel(dateKey), teams: assignment.teams });
    }
    return result;
  }

  function generateAssignmentsForMonth(schedule, year, month) {
    const firstDay = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const dailyAssignments = Array.from({ length: daysInMonth }, (_, index) =>
      findAssignmentForDateWithFallback(schedule, dateKeyForDay(year, month, index + 1))
    );
    const teams = teamsFromConfig(schedule);
    const counts = {};
    teams.forEach((team) => {
      counts[team.name] = Object.fromEntries(team.members.map((member) => [member.name, 0]));
    });
    dailyAssignments.forEach((day) => {
      day.teams.forEach((team) => {
        if (!counts[team.name]) counts[team.name] = {};
        counts[team.name][team.person] = (counts[team.name][team.person] || 0) + 1;
      });
    });
    return {
      startWeekday: (firstDay.getDay() + 6) % 7,
      daysInMonth,
      counts,
      teams,
      dailyAssignments
    };
  }

  const api = {
    normalizeDateKey,
    dateKeyForDay,
    normalizeAnchors,
    getAnchorForDate,
    getPersonFromAnchor,
    findLatestSnapshotBeforeDate,
    findAssignmentForDateWithFallback,
    collectUpcoming,
    generateAssignmentsForMonth
  };

  global.DutyRosterSchedule = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
node --test scripts/schedule-utils.test.mjs
```

Expected: PASS，6 个测试通过。

- [ ] **Step 5: 提交**

```bash
git add schedule-utils.js scripts/schedule-utils.test.mjs
git commit -m "feat: add continuous roster schedule utilities"
```

---

### Task 2: 提醒脚本改用连续顺排函数

**Files:**
- Modify: `/private/tmp/workrepo.reminder-debug/scripts/send-duty-reminder.mjs`
- Modify: `/private/tmp/workrepo.reminder-debug/scripts/send-duty-reminder.test.mjs`

**Interfaces:**
- Consumes: `DutyRosterSchedule.findAssignmentForDateWithFallback(schedule, dateKey)`
- Consumes: `DutyRosterSchedule.collectUpcoming(schedule, todayKey, days)`
- Produces: 保持现有导出名 `findAssignmentForDate`、`collectUpcoming`、`buildFeishuCardMessage`、`main`

- [ ] **Step 1: 先改测试，覆盖 6/30 预告 7 月**

Modify `/private/tmp/workrepo.reminder-debug/scripts/send-duty-reminder.test.mjs`:

```js
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
```

Also update the existing missing-month test:

```js
test("findAssignmentForDate 没有快照但有配置时顺排生成", () => {
  const result = findAssignmentForDate({
    config: {
      teams: [{ name: "前端", members: ["A", "B"], last: "A", color: "blue" }]
    },
    months: {}
  }, "2026-07-01");

  assert.equal(result.teams[0].person, "B");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node --test scripts/send-duty-reminder.test.mjs
```

Expected: FAIL，旧 `collectUpcoming` 缺少 7 月快照时返回空数组。

- [ ] **Step 3: 改提醒脚本实现**

Modify the top of `/private/tmp/workrepo.reminder-debug/scripts/send-duty-reminder.mjs`:

```js
import fs from "node:fs/promises";
import scheduleUtils from "../schedule-utils.js";
```

Replace existing `normalizeDateKey`, `normalizeDutyTeam`, `findAssignmentForDate`, and `collectUpcoming` implementation with:

```js
export function findAssignmentForDate(schedule, dateKey) {
  return scheduleUtils.findAssignmentForDateWithFallback(schedule, dateKey);
}

export function collectUpcoming(schedule, todayKey, days = 3) {
  return scheduleUtils.collectUpcoming(schedule, todayKey, days);
}
```

Keep `formatBeijingDate` and `buildFeishuCardMessage` unchanged.

- [ ] **Step 4: 运行提醒脚本测试**

Run:

```bash
node --test scripts/send-duty-reminder.test.mjs scripts/schedule-utils.test.mjs
```

Expected: PASS。

- [ ] **Step 5: dry-run 验证真实数据 6/30 带出 7 月预告**

Run:

```bash
REMINDER_DATE=2026-06-30T01:00:00Z node scripts/send-duty-reminder.mjs --dry-run > /tmp/duty-reminder-2026-06-30.json
rg -n "接下来|7/1|7/2|7/3" /tmp/duty-reminder-2026-06-30.json
```

Expected: 输出包含 `接下来`、`7/1 周三`、`7/2 周四`、`7/3 周五`。

- [ ] **Step 6: 提交**

```bash
git add scripts/send-duty-reminder.mjs scripts/send-duty-reminder.test.mjs
git commit -m "fix: generate duty reminders beyond published months"
```

---

### Task 3: 公开页缺月快照时按已发布规则生成

**Files:**
- Modify: `/private/tmp/workrepo.reminder-debug/index.html`
- Modify: `/private/tmp/workrepo.reminder-debug/admin/index.html`
- Modify: `/private/tmp/workrepo.reminder-debug/scripts/verify-duty-anchors.mjs`

**Interfaces:**
- Consumes: `window.DutyRosterSchedule.generateAssignmentsForMonth(schedule, year, month)`
- Produces: `renderContinuousScheduleMonth(document, year, month): boolean`

- [ ] **Step 1: 先改静态验证脚本**

Modify `/private/tmp/workrepo.reminder-debug/scripts/verify-duty-anchors.mjs` inside the HTML checks:

```js
assert.match(html, /schedule-utils\.js/, `${label} 需要加载连续顺排工具`);
assert.match(html, /function renderContinuousScheduleMonth\(/, `${label} 需要支持没有月快照时按规则顺排`);
assert.match(html, /renderContinuousScheduleMonth\(remotePreview,\s*year,\s*month\)/, `${label} 初始化时月快照缺失需要回退到规则顺排`);
```

- [ ] **Step 2: 运行验证确认失败**

Run:

```bash
node scripts/verify-duty-anchors.mjs
```

Expected: FAIL，提示页面还没加载 `schedule-utils.js` 或缺少 `renderContinuousScheduleMonth`。

- [ ] **Step 3: 页面加载共享脚本**

Modify `/private/tmp/workrepo.reminder-debug/index.html` near the existing `member-utils.js` script:

```html
<script src="./member-utils.js"></script>
<script src="./schedule-utils.js"></script>
<script>
```

Modify `/private/tmp/workrepo.reminder-debug/admin/index.html`:

```html
<script src="../member-utils.js"></script>
<script src="../schedule-utils.js"></script>
<script>
```

Inside both inline scripts, after `const memberUtils = window.DutyRosterMembers;`, add:

```js
const scheduleUtils = window.DutyRosterSchedule;
```

- [ ] **Step 4: 增加连续顺排渲染函数**

In both `/private/tmp/workrepo.reminder-debug/index.html` and `/private/tmp/workrepo.reminder-debug/admin/index.html`, add this function after `renderPublishedScheduleMonth`:

```js
function renderContinuousScheduleMonth(document, year, month) {
  if (!scheduleUtils?.generateAssignmentsForMonth || !Array.isArray(document?.config?.teams)) return false;
  let generated = null;
  try {
    generated = scheduleUtils.generateAssignmentsForMonth(document, year, month);
  } catch (error) {
    return false;
  }
  const monthKey = formatMonthKey(year, month);
  const teams = generated.teams.map((team, index) => ({
    name: team.name,
    members: memberUtils.serializeMembers(team.members),
    last: team.last,
    anchors: Array.isArray(team.anchors) ? team.anchors : [],
    color: resolveTeamColor(team.color, index)
  }));
  const dailyAssignments = generated.dailyAssignments.map((day) => ({
    ...day,
    teams: day.teams.map((team, index) => ({
      ...team,
      color: resolveTeamColor(team.color, index)
    }))
  }));

  renderCalendar(year, month, generated.startWeekday, generated.daysInMonth, dailyAssignments);
  renderSummary(year, month, teams, generated.counts, dailyAssignments);
  renderLegends(teams);
  renderMonthGridCopy(year, month, teams, generated.startWeekday, generated.daysInMonth, dailyAssignments);

  lastGeneratedState = {
    year,
    month,
    monthKey,
    teams,
    configTeams: normalizePublishedTeams({ config: document?.config }, { teams: document?.config?.teams || [] }, dailyAssignments),
    draftSeed: null,
    result: { startWeekday: generated.startWeekday, daysInMonth: generated.daysInMonth, counts: generated.counts, dailyAssignments },
    summary: lastSummary,
    remotePreview: document
  };
  persistedMonth = monthKey;
  pendingMonth = null;
  confirmationReady = false;
  updateMonthLabels(year, month);
  if ($("syncTime")) $("syncTime").textContent = nowTime();
  if ($("notePersistence")) $("notePersistence").textContent = `${monthKey} 按已发布规则顺排。`;
  if ($("noteMonth")) $("noteMonth").textContent = `${monthKey} 按已发布规则顺排，共 ${dailyAssignments.length} 天、${teams.length} 个团队。`;
  if ($("noteRoster")) $("noteRoster").textContent = `当前花名册：${teams.map((team) => `${team.name}${team.members.length}人`).join("，")}。`;
  if ($("draftRange")) $("draftRange").textContent = "已发布规则顺排";
  $("calendarSubtitle").textContent = "按已发布规则顺排";
  renderConfirmView();
  syncTopbar();
  return true;
}
```

- [ ] **Step 5: 初始化和切月时使用连续顺排回退**

In both HTML files, replace the passive remote branch in `generateSchedule`:

```js
if (options.passive && !teamConfigDirty && remoteScheduleDocument) {
  if (renderPublishedScheduleMonth(remoteScheduleDocument, year, month) || renderContinuousScheduleMonth(remoteScheduleDocument, year, month)) {
    if (!options.silent) showOk("已读取公开排班。");
    return true;
  }
}
```

In both HTML files, replace boot rendering:

```js
const renderedPublished = remotePreview && !teamConfigDirty && (
  renderPublishedScheduleMonth(remotePreview, year, month) ||
  renderContinuousScheduleMonth(remotePreview, year, month)
);
```

- [ ] **Step 6: 跑静态验证**

Run:

```bash
node scripts/verify-duty-anchors.mjs
node scripts/verify-readonly-layout.mjs
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add index.html admin/index.html scripts/verify-duty-anchors.mjs
git commit -m "fix: render roster months from published rules"
```

---

### Task 4: 取消 GitHub schedule 并更新文档

**Files:**
- Modify: `/private/tmp/workrepo.reminder-debug/.github/workflows/duty-reminder.yml`
- Modify: `/private/tmp/workrepo.reminder-debug/README.md`
- Modify: `/private/tmp/workrepo.reminder-debug/scripts/verify-readonly-layout.mjs`

**Interfaces:**
- Consumes: cron-job.org 调用 GitHub `workflow_dispatch`
- Produces: workflow 只包含手动/API 触发，不包含 GitHub 自带 `schedule`

- [ ] **Step 1: 先加 workflow 静态检查**

Append to `/private/tmp/workrepo.reminder-debug/scripts/verify-readonly-layout.mjs`:

```js
const workflow = await readFile(new URL("../.github/workflows/duty-reminder.yml", import.meta.url), "utf8");
assert.match(workflow, /workflow_dispatch:/, "提醒 workflow 需要保留 workflow_dispatch 给 cron-job.org 调用");
assert.doesNotMatch(workflow, /^\s*schedule:/m, "提醒 workflow 不应再使用 GitHub 自带 schedule");
assert.doesNotMatch(workflow, /^\s*-\s*cron:/m, "提醒 workflow 不应再配置 GitHub cron");
```

- [ ] **Step 2: 运行验证确认失败**

Run:

```bash
node scripts/verify-readonly-layout.mjs
```

Expected: FAIL，提示 workflow 仍包含 `schedule` 或 `cron`。

- [ ] **Step 3: 删除 GitHub 自带 schedule**

Modify `/private/tmp/workrepo.reminder-debug/.github/workflows/duty-reminder.yml`:

```yaml
name: Duty Reminder

on:
  workflow_dispatch:
    inputs:
      force:
        description: "跳过去重，强制发送一条（用于测试）"
        type: boolean
        default: false
```

Keep the existing `permissions`、`concurrency` and `jobs` sections unchanged.

- [ ] **Step 4: 更新 README**

Modify `/private/tmp/workrepo.reminder-debug/README.md` so these facts are explicit:

```md
- GitHub Actions 只保留 `workflow_dispatch`，不再使用 GitHub 自带 schedule。
- 每天 09:00 的自动提醒由 cron-job.org 调 GitHub API 触发。
- `data/schedule.json` 里的 `config.teams` 是长期规则来源；`months` 是历史快照。
- 未来月份不需要逐月发布。没有月快照时，公开页和提醒脚本会按成员名单、接龙节点和历史快照连续顺排。
```

Remove or rewrite the old sentence:

```md
如果当天所在月份还没有发布排班，定时任务会失败并提示先发布当月排班。
```

Replacement:

```md
如果当天没有月快照，提醒脚本会按已发布规则顺排；只有成员名单和接龙节点都不可用时才会失败。
```

- [ ] **Step 5: YAML 和文档验证**

Run:

```bash
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/duty-reminder.yml"); puts "workflow yaml ok"'
node scripts/verify-readonly-layout.mjs
rg -n "先发布当月|测试期临时每 5 分钟|GitHub Actions 定时任务最短间隔|cron:|schedule:" README.md .github/workflows/duty-reminder.yml
```

Expected:

- Ruby prints `workflow yaml ok`
- `verify-readonly-layout` PASS
- `rg` 不应命中旧的逐月发布或 GitHub cron 文案；如果命中 YAML 的 `workflow_dispatch` 下文之外内容，需要改掉。

- [ ] **Step 6: 提交**

```bash
git add .github/workflows/duty-reminder.yml README.md scripts/verify-readonly-layout.mjs
git commit -m "chore: rely on cron-job for duty reminder dispatch"
```

---

### Task 5: 总验证和推送

**Files:**
- Verify only.

**Interfaces:**
- Consumes: Tasks 1-4 commits.
- Produces: pushed `main` branch on `Drizeele2026/work`.

- [ ] **Step 1: 跑完整本地验证**

Run:

```bash
node --test scripts/member-utils.test.mjs scripts/schedule-utils.test.mjs scripts/send-duty-reminder.test.mjs
node scripts/verify-duty-anchors.mjs
node scripts/verify-readonly-layout.mjs
node --check scripts/send-duty-reminder.mjs
node --check schedule-utils.js
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/duty-reminder.yml"); puts "workflow yaml ok"'
git diff --check
```

Expected: 全部 exit 0。

- [ ] **Step 2: 用真实数据 dry-run**

Run:

```bash
REMINDER_DATE=2026-06-30T01:00:00Z node scripts/send-duty-reminder.mjs --dry-run > /tmp/duty-reminder-2026-06-30.json
rg -n "接下来|7/1 周三|7/2 周四|7/3 周五" /tmp/duty-reminder-2026-06-30.json
REMINDER_DATE=2026-07-01T01:00:00Z node scripts/send-duty-reminder.mjs --dry-run > /tmp/duty-reminder-2026-07-01.json
rg -n "2026年7月1日|今日值班提醒" /tmp/duty-reminder-2026-07-01.json
```

Expected: 第一条包含 7/1、7/2、7/3；第二条能生成 2026-07-01 今日提醒。

- [ ] **Step 3: 检查提交历史和敏感信息**

Run:

```bash
git log --oneline --max-count=8
rg -n "github_pat_|open-apis/bot/v2/hook|FEISHU_WEBHOOK=.*https" .
```

Expected: 能看到本次设计、计划和实现提交；敏感信息搜索没有命中真实 token 或 webhook。

- [ ] **Step 4: 推送**

Run:

```bash
source /Users/tst/work/tastien/work_schedule/.local/ai-secrets.env
B64=$(printf 'x-access-token:%s' "$GITHUB_PAT" | base64 | tr -d '\n')
for i in 1 2 3 4 5; do
  git -c http.version=HTTP/1.1 -c http.extraHeader="Authorization: Basic ${B64}" push origin main && break
done
unset GITHUB_PAT B64
```

Expected: push succeeds.

- [ ] **Step 5: 查远端 workflow 最新文件**

Run:

```bash
curl -fsSL https://raw.githubusercontent.com/Drizeele2026/work/main/.github/workflows/duty-reminder.yml | sed -n '1,40p'
```

Expected: 只看到 `workflow_dispatch`，没有 `schedule` 和 `cron`。
