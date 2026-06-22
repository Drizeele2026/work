# Duty Roster Anchors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给每个团队增加独立接龙节点，让系统能从任意日期接上已有排期。

**Architecture:** 继续沿用静态 HTML + `data/schedule.json`。节点数据保存在每个团队配置里，生成月排班时每个团队各自找最近节点；发布时合并远端已有月份，并在当前月节点之前保留已发布值班人。

**Tech Stack:** 原生 HTML/CSS/JavaScript，Node.js `node:test`/`assert`，现有 GitHub Pages 发布方式。

---

## 文件结构

- 修改：`/Users/tst/work/tastien/work_schedule/admin/index.html`
  管理页 UI、节点编辑、排班生成、发布保存逻辑。
- 修改：`/Users/tst/work/tastien/work_schedule/index.html`
  公开页和管理页共用同一套内联脚本，需要同步节点生成逻辑。
- 创建：`/Users/tst/work/tastien/work_schedule/member-utils.js`
  提供成员解析、格式化、姓名和飞书 OpenID 读取工具。页面启动依赖这个浏览器全局。
- 创建：`/Users/tst/work/tastien/work_schedule/scripts/verify-duty-anchors.mjs`
  用 Node 验证节点辅助函数、UI 标记和两份 HTML 是否同步支持节点。
- 修改：`/Users/tst/work/tastien/work_schedule/README.md`
  更新“接龙起点”为“接龙节点”的说明。
- 已创建：`/Users/tst/work/tastien/work_schedule/docs/superpowers/specs/2026-06-22-duty-roster-anchors-design.md`
  保存需求和设计。

## Task 1: 写节点验证脚本

**Files:**
- Create: `/Users/tst/work/tastien/work_schedule/scripts/verify-duty-anchors.mjs`

- [ ] **Step 1: 写失败测试**

```js
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const adminHtml = await readFile(new URL("admin/index.html", root), "utf8");
const publicHtml = await readFile(new URL("index.html", root), "utf8");

function extractAnchorHelpers(html, label) {
  const match = html.match(/\/\/ Anchor scheduling helpers start([\s\S]*?)\/\/ Anchor scheduling helpers end/);
  assert.ok(match, `${label} 需要包含接龙节点纯函数块`);
  const context = {
    console,
    memberUtils: {
      memberName(member) {
        return typeof member === "string" ? member : member?.name || "";
      },
      memberNames(members) {
        return members.map((member) => this.memberName(member)).filter(Boolean);
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(`${match[1]}
    globalThis.__helpers = {
      normalizeAnchors,
      getAnchorForDate,
      getPersonFromAnchor,
      getFirstAffectedDate
    };`, context);
  return context.__helpers;
}

for (const [label, html] of [["管理页", adminHtml], ["公开页", publicHtml]]) {
  assert.match(html, /class="anchor-list"/, `${label} 需要有节点列表 UI`);
  assert.match(html, /data-act="add-anchor"/, `${label} 需要有添加节点按钮`);
  assert.match(html, /当天值班人/, `${label} 需要支持当天值班人模式`);
  assert.match(html, /前一天值班人/, `${label} 需要支持前一天值班人模式`);
  assert.match(html, /anchors:/, `${label} 需要在团队配置里读写 anchors`);

  const helpers = extractAnchorHelpers(html, label);
  const names = ["A", "B", "C", "D"];
  const anchors = helpers.normalizeAnchors([
    { date: "2026-06-22", mode: "currentDay", person: "C" },
    { date: "2026-06-01", mode: "currentDay", person: "A" }
  ], names);

  assert.deepEqual(anchors.map((anchor) => anchor.date), ["2026-06-01", "2026-06-22"]);
  assert.equal(helpers.getPersonFromAnchor(helpers.getAnchorForDate("2026-06-22", anchors), "2026-06-22", names), "C");
  assert.equal(helpers.getPersonFromAnchor(helpers.getAnchorForDate("2026-06-23", anchors), "2026-06-23", names), "D");

  const previousDay = helpers.normalizeAnchors([
    { date: "2026-06-22", mode: "previousDay", person: "C" }
  ], names);
  assert.equal(helpers.getPersonFromAnchor(previousDay[0], "2026-06-22", names), "D");
  assert.equal(helpers.getFirstAffectedDate(previousDay), "2026-06-22");
}

console.log("接龙节点检查通过");
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node scripts/verify-duty-anchors.mjs`

Expected: FAIL，提示 `管理页 需要包含接龙节点纯函数块`。

## Task 2: 实现节点纯函数和数据读写

**Files:**
- Modify: `/Users/tst/work/tastien/work_schedule/admin/index.html`
- Modify: `/Users/tst/work/tastien/work_schedule/index.html`

- [ ] **Step 1: 在脚本区增加纯函数块**

在 `wrapIndex` 后面加入同一段代码：

```js
    // Anchor scheduling helpers start
    function normalizeDateKey(value) {
      const text = String(value || "").trim().replaceAll("/", "-");
      const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (!match) return "";
      return `${match[1]}-${pad2(Number(match[2]))}-${pad2(Number(match[3]))}`;
    }

    function dateKeyForDay(year, month, day) {
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }

    function daysBetweenDateKeys(fromKey, toKey) {
      const [fromYear, fromMonth, fromDay] = fromKey.split("-").map(Number);
      const [toYear, toMonth, toDay] = toKey.split("-").map(Number);
      const from = Date.UTC(fromYear, fromMonth - 1, fromDay);
      const to = Date.UTC(toYear, toMonth - 1, toDay);
      return Math.round((to - from) / 86400000);
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
      let active = null;
      anchors.forEach((anchor) => {
        if (anchor.date <= dateKey) active = anchor;
      });
      return active;
    }

    function getPersonFromAnchor(anchor, dateKey, names) {
      if (!anchor || !names.length) return "";
      const anchorIndex = names.indexOf(anchor.person);
      if (anchorIndex < 0) return "";
      const offset = daysBetweenDateKeys(anchor.date, dateKey);
      const modeOffset = anchor.mode === "previousDay" ? 1 : 0;
      return names[wrapIndex(anchorIndex + modeOffset + offset, names.length)];
    }

    function getFirstAffectedDate(anchors) {
      return anchors.length ? anchors[0].date : "";
    }
    // Anchor scheduling helpers end
```

- [ ] **Step 2: 扩展团队表单状态**

把 `readTeamFormState` 的返回对象改成：

```js
        last: $(`team${index}Last`).value.trim().replace(/@/g, ""),
        anchors: readTeamAnchors(index)
```

把 `applyTeamFormState` 传入 `setTeamForm` 的对象改成：

```js
          last: team.last || "",
          anchors: Array.isArray(team.anchors) ? team.anchors : []
```

- [ ] **Step 3: 让保存数据带上 anchors**

把 `simplifyTeams` 和 `cloneTeamsForDraft` 里的团队对象都增加：

```js
        anchors: normalizeTeamAnchors(team)
```

## Task 3: 增加每队节点编辑 UI

**Files:**
- Modify: `/Users/tst/work/tastien/work_schedule/admin/index.html`
- Modify: `/Users/tst/work/tastien/work_schedule/index.html`

- [ ] **Step 1: 给每个团队卡片加入节点容器**

在每个 `.team-form-grid` 后、成员名单前加入：

```html
                  <div class="anchor-editor">
                    <div class="anchor-editor-head">
                      <label>接龙节点</label>
                      <button type="button" data-act="add-anchor" data-team="1">添加节点</button>
                    </div>
                    <div class="anchor-list" id="team1Anchors"></div>
                  </div>
```

第二、第三个团队把 `data-team` 和 `id` 分别改成 `2/team2Anchors`、`3/team3Anchors`。

- [ ] **Step 2: 加节点样式**

把样式放在 `.member-field` 附近：

```css
    .anchor-editor {
      display: grid;
      gap: 8px;
      margin: 10px 0 12px;
    }

    .anchor-editor-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .anchor-editor-head label { margin: 0; }

    .anchor-list {
      display: grid;
      gap: 8px;
    }

    .anchor-row {
      display: grid;
      grid-template-columns: minmax(138px, 0.9fr) minmax(130px, 0.9fr) minmax(120px, 1fr) auto;
      gap: 8px;
      align-items: center;
    }

    .anchor-empty {
      padding: 9px 10px;
      border: 1px dashed var(--line);
      border-radius: 7px;
      color: var(--muted);
      font-size: 12px;
      background: #f8fafc;
    }

    @media (max-width: 760px) {
      .anchor-row { grid-template-columns: 1fr; }
    }
```

- [ ] **Step 3: 增加渲染和读取函数**

在成员编辑函数附近加入：

```js
    function normalizeTeamAnchors(team) {
      return normalizeAnchors(team.anchors, memberUtils.memberNames(team.members));
    }

    function readTeamAnchors(index) {
      const box = $(`team${index}Anchors`);
      if (!box) return [];
      return [...box.querySelectorAll(".anchor-row")].map((row) => ({
        date: row.querySelector('[data-field="date"]')?.value || "",
        mode: row.querySelector('[data-field="mode"]')?.value || "currentDay",
        person: row.querySelector('[data-field="person"]')?.value || ""
      }));
    }

    function renderAnchorEditor(index, members, anchors = []) {
      const box = $(`team${index}Anchors`);
      if (!box) return;
      const names = memberUtils.memberNames(members);
      const normalized = normalizeAnchors(anchors, names);
      if (!names.length) {
        box.innerHTML = `<div class="anchor-empty">先添加成员，再设置接龙节点。</div>`;
        return;
      }
      const rows = normalized.map((anchor, anchorIndex) => `
        <div class="anchor-row" data-anchor-index="${anchorIndex}">
          <input type="date" value="${escapeHtml(anchor.date)}" data-field="date" aria-label="节点日期">
          <select data-field="mode" aria-label="节点模式">
            <option value="currentDay"${anchor.mode === "currentDay" ? " selected" : ""}>当天值班人</option>
            <option value="previousDay"${anchor.mode === "previousDay" ? " selected" : ""}>前一天值班人</option>
          </select>
          <select data-field="person" aria-label="节点人员">
            ${names.map((name) => `<option value="${escapeHtml(name)}"${name === anchor.person ? " selected" : ""}>${escapeHtml(name)}</option>`).join("")}
          </select>
          <button type="button" data-act="delete-anchor" title="删除节点">删除</button>
        </div>
      `).join("");
      box.innerHTML = rows || `<div class="anchor-empty">还没有节点。添加一个日期，系统会从那天接着排。</div>`;
    }
```

- [ ] **Step 4: 绑定节点事件**

在 `bindTeamConfigEvents` 里增加：

```js
        $(`team${index}Anchors`)?.addEventListener("change", () => {
          syncTeamCards();
          setTeamConfigDirty(true);
        });
        $(`team${index}Anchors`)?.addEventListener("click", (event) => {
          if (event.target.dataset?.act !== "delete-anchor") return;
          const row = event.target.closest(".anchor-row");
          row?.remove();
          syncTeamCards();
          setTeamConfigDirty(true);
        });
        document.querySelector(`[data-act="add-anchor"][data-team="${index}"]`)?.addEventListener("click", () => {
          const members = parseMembers($(`team${index}Members`).value);
          const names = memberUtils.memberNames(members);
          if (!names.length) return;
          const anchors = readTeamAnchors(index);
          anchors.push({
            date: dateKeyForDay(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate()),
            mode: "currentDay",
            person: names[0]
          });
          renderAnchorEditor(index, members, anchors);
          setTeamConfigDirty(true);
        });
```

## Task 4: 改排班生成逻辑

**Files:**
- Modify: `/Users/tst/work/tastien/work_schedule/admin/index.html`
- Modify: `/Users/tst/work/tastien/work_schedule/index.html`

- [ ] **Step 1: 构建团队数据时校验 anchors**

在 `buildTeamData` 的返回对象里增加 `anchors: readTeamAnchors(index)`。校验阶段加入：

```js
        team.anchors = normalizeTeamAnchors(team);
        team.anchors.forEach((anchor) => {
          if (!names.includes(anchor.person)) {
            throw new Error(`团队【${team.name}】的节点人员“${anchor.person}”不在成员名单里。`);
          }
        });
```

- [ ] **Step 2: 用节点生成团队每日人员**

把 `generateAssignments` 里每个团队计算 `personIndex` 的逻辑替换成：

```js
          const names = memberUtils.memberNames(team.members);
          const dateKey = dateKeyForDay(year, month, day);
          const anchors = normalizeTeamAnchors(team);
          const anchor = getAnchorForDate(dateKey, anchors);
          let person = "";
          if (anchor) {
            person = getPersonFromAnchor(anchor, dateKey, names);
          } else {
            const lastIndex = names.indexOf(team.last);
            person = names[(lastIndex + day) % names.length];
          }
          const member = team.members.find((item) => memberUtils.memberName(item) === person) || team.members[0];
```

- [ ] **Step 3: 改跨月推导**

`deriveTeamsForMonth` 继续保留旧 `last` 推导，但 `anchors` 不按月份平移。返回团队时保留：

```js
          anchors: normalizeTeamAnchors(team)
```

## Task 5: 发布时保护节点之前的已发布结果

**Files:**
- Modify: `/Users/tst/work/tastien/work_schedule/admin/index.html`
- Modify: `/Users/tst/work/tastien/work_schedule/index.html`

- [ ] **Step 1: 增加合并函数**

在 `buildScheduleDocument` 前加入：

```js
    function mergePublishedAssignmentsBeforeAnchors(monthEntry, remoteMonth, teams) {
      if (!remoteMonth?.dailyAssignments?.length) return monthEntry;
      const firstAffectedByTeam = Object.fromEntries(
        teams.map((team) => [team.name, getFirstAffectedDate(normalizeTeamAnchors(team))])
      );
      monthEntry.dailyAssignments = monthEntry.dailyAssignments.map((day) => {
        const dateKey = normalizeDateKey(day.dateStr);
        const remoteDay = remoteMonth.dailyAssignments.find((item) => normalizeDateKey(item.dateStr) === dateKey);
        if (!remoteDay) return day;
        return {
          ...day,
          teams: day.teams.map((team) => {
            const firstAffected = firstAffectedByTeam[team.name];
            if (!firstAffected || dateKey >= firstAffected) return team;
            return remoteDay.teams?.find((item) => item.name === team.name) || team;
          })
        };
      });
      return monthEntry;
    }
```

- [ ] **Step 2: 保存前合并远端当前月**

把 `buildScheduleDocument(state)` 改成接收远端文档：

```js
    function buildScheduleDocument(state, remoteDocument = null) {
```

生成 `monthEntry` 后加入：

```js
      const remoteMonth = remoteDocument?.months?.[state.monthKey];
      mergePublishedAssignmentsBeforeAnchors(monthEntry, remoteMonth, teams);
```

`saveScheduleToGithub` 里改成：

```js
      const document = buildScheduleDocument(lastGeneratedState, remote.document);
```

## Task 6: 文档和验证

**Files:**
- Modify: `/Users/tst/work/tastien/work_schedule/README.md`
- Test: `/Users/tst/work/tastien/work_schedule/scripts/verify-duty-anchors.mjs`

- [ ] **Step 1: 更新 README 排班规则**

把“接龙起点”相关文案改成：

```md
- 每个团队独立维护接龙节点。
- 节点默认表示“基准日当天值班人”，也可以切成“基准日前一天值班人”。
- 系统从每个团队最近的节点往后接着排，节点之前已发布的排期不主动重算。
```

- [ ] **Step 2: 跑验证命令**

Run:

```bash
node scripts/verify-duty-anchors.mjs
node scripts/verify-readonly-layout.mjs
node --test scripts/send-duty-reminder.test.mjs
```

Expected:

```text
接龙节点检查通过
只读排班布局检查通过
所有 node:test 用例通过
```

- [ ] **Step 3: 检查工作区变化**

Run: `find docs scripts admin data -maxdepth 3 -type f | sort`

Expected: 能看到新增的设计文档、计划文档和 `scripts/verify-duty-anchors.mjs`。当前目录不是 Git 仓库，不执行 `git commit`。

## 自查

- 设计里的每队独立节点：Task 2、Task 3、Task 4 覆盖。
- 默认当天值班人和前一天值班人：Task 1、Task 3、Task 4 覆盖。
- 节点之前已发布排期不重算：Task 5 覆盖。
- 旧 `last` 兼容：Task 2、Task 4 覆盖。
- 飞书提醒不改读取方式：Task 6 继续跑原测试。
