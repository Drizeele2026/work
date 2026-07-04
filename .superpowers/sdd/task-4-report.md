# Task 4 报告：管理页移除节点和兜底起点

## 结果

已按 brief 完成：

- `index.html`
- `admin/index.html`
- `scripts/verify-clean-roster-model.mjs`

管理页和公开页都不再展示或读写节点/兜底起点，月排班改为走 `scheduleUtils.buildPublishedDocument()` + `scheduleUtils.generateAssignmentsForMonth()`，发布文档走规则版本模型。

## RED 证据

先新增 `scripts/verify-clean-roster-model.mjs`，再运行：

```bash
node scripts/verify-clean-roster-model.mjs
```

实际输出：

```text
node:internal/modules/run_main:123
    triggerUncaughtException(
    ^

AssertionError [ERR_ASSERTION]: 管理页 不应展示兜底起点
```

这和 brief 预期一致，先红灯后改代码。

## GREEN 证据

1. UI 校验

运行：

```bash
node scripts/verify-clean-roster-model.mjs
```

输出：

```text
干净排班模型 UI 检查通过
```

2. 脚本抽取语法检查

运行：

```bash
node --input-type=module -e 'import fs from "node:fs"; for (const file of ["index.html", "admin/index.html"]) { const html = fs.readFileSync(file, "utf8"); const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).join("\n"); new Function(scripts); console.log(`${file} script ok`); }'
```

输出：

```text
index.html script ok
admin/index.html script ok
```

3. 关键残留词检查

运行：

```bash
rg -n "team1Last|team2Last|team3Last|接龙节点|兜底起点|当天值班人|前一天值班人|applyRosterChangeAnchors" index.html admin/index.html
```

结果：无输出。

## 主要改动

1. 页面结构

- 两个页面的管理头部改成 `维护值班规则`
- 三个团队表单都只保留 `团队名称` + `成员名单`
- 删除节点编辑区、添加节点按钮、兜底起点控件
- 删除对应 anchor CSS

2. 表单读写

- `readTeamFormState()` / `applyTeamFormState()` / `simplifyTeams()` 改成只处理 `{ name, members, color }`
- `setTeamForm()` 改成只回填名称和成员，并刷新成员预览
- `buildTeamData()` 改成只校验团队名和成员名单

3. 生成与发布

- `generateAssignments()` 改为先调用 `scheduleUtils.buildPublishedDocument(null, ...)`
- 再调用 `scheduleUtils.generateAssignmentsForMonth(...)`
- `generateSchedule()` 不再走 draft seed / derive month
- `buildScheduleDocument()` 改为直接走共享的 `buildPublishedDocument()`
- 发布 commit message 改为 `chore: update roster rules ${todayDateKey()}`
- 发布成功提示改为“今天之前不主动改变，今天及以后按新规则顺排”

4. 交互文案

- 状态条、预览提示、`calendarSubtitle` 全部改成规则版本语义
- 不再出现节点模式相关文案

## 文件变更

- 修改：`/Users/tst/work/tastien/work_schedule/.worktrees/clean-duty-roster-model/index.html`
- 修改：`/Users/tst/work/tastien/work_schedule/.worktrees/clean-duty-roster-model/admin/index.html`
- 新增：`/Users/tst/work/tastien/work_schedule/.worktrees/clean-duty-roster-model/scripts/verify-clean-roster-model.mjs`

## Self-review

1. 已确认的问题

- 没有发现 `team1Last/team2Last/team3Last`
- 没有发现 `接龙节点/兜底起点/当天值班人/前一天值班人`
- 没有发现 `applyRosterChangeAnchors`
- 两个 HTML 内联脚本都能被 `new Function(...)` 成功解析

2. 发现但未继续扩范围处理的点

- 两个 HTML 里还留着一批旧 helper 定义，比如 `normalizeAnchors`、`anchorSignature`、`mergePublishedAssignmentsBeforeAnchors` 等。
- 这些函数现在没有参与本任务要求的主流程，当前语法检查和 UI 校验都通过，所以我没有继续做额外清理，避免超出 brief。

## Concerns

- 当前 concern 只有一个：两张 HTML 里还有未调用的旧 helper，后续如果继续收敛页面逻辑，可以单独做一轮死代码清理。

## 2026-07-04 Review Fix

### 修复内容

1. `syncTeamCards()` 不再读取已删除的 `team${index}Last` 控件，也不再调用 `readTeamAnchors()`、`setTeamLastOptions()`、`renderAnchorEditor()`。
2. `normalizePublishedTeams()` 现在只保留 `{ name, members, color }`，不再把 `last` 和 `anchors` 带回活跃团队状态。
3. 删除两份 HTML 里已无调用的旧节点 helper：`normalizeAnchors`、`anchorSignature`、`getFirstAffectedDate`、`mergePublishedAssignmentsBeforeAnchors`，以及同一串逻辑里一起失效的 `getAnchorForDate`、`getPersonFromAnchor`、`daysBetweenDateKeys`、`findRemoteConfigTeam`。

### 验证命令与输出

1. UI 校验

运行：

```bash
node scripts/verify-clean-roster-model.mjs
```

输出：

```text
干净排班模型 UI 检查通过
```

2. 内联脚本抽取校验

按 brief 里的检查意图执行了等价命令。原始单行命令在当前 shell/转义层里会把正则字面量打坏，所以改成 `new RegExp(...)` 版本做同样的抽取和 `new Function(...)` 校验。

运行：

```bash
node --input-type=module -e 'import fs from "node:fs"; for (const file of ["index.html", "admin/index.html"]) { const html = fs.readFileSync(file, "utf8"); const scripts = [...html.matchAll(new RegExp("<script>([\\s\\S]*?)</script>", "g"))].map((match) => match[1]).join("\n"); new Function(scripts); console.log(`${file} script ok`); }'
```

输出：

```text
index.html script ok
admin/index.html script ok
```

3. 旧引用残留检查

运行：

```bash
rg -n "team1Last|team2Last|team3Last|team1Anchors|team2Anchors|team3Anchors|readTeamAnchors|setTeamLastOptions|renderAnchorEditor|applyRosterChangeAnchors|normalizeAnchors|mergePublishedAssignmentsBeforeAnchors" index.html admin/index.html
```

结果：无输出。

### 备注

- 这次 `rg` 检查没有任何残留命中，所以没有“保留但可接受”的旧词需要解释。

## 2026-07-04 Re-review Fix

### 修复内容

1. `index.html` 和 `admin/index.html` 的 `renderPublishedScheduleMonth(document, year, month)` 开头都加了 v2/ruleVersions guard：

```js
if (document?.version >= 2 || Array.isArray(document?.ruleVersions)) return false;
```

2. 保持原来的调用顺序不动，让旧的 `renderPublishedScheduleMonth(...)` 只给非 v2 旧文档兜底，v2/ruleVersions 文档直接走 `renderContinuousScheduleMonth(...)`。
3. `scripts/verify-clean-roster-model.mjs` 新增校验，强制两张 HTML 都要带这条 guard。

### RED 证据

先只改校验脚本，再运行：

```bash
node scripts/verify-clean-roster-model.mjs
```

输出：

```text
node:internal/modules/run_main:123
    triggerUncaughtException(
    ^

AssertionError [ERR_ASSERTION]: 管理页 的 renderPublishedScheduleMonth 必须跳过 v2/ruleVersions 文档
```

说明返修点在当前代码里确实还没修到。

### GREEN 证据

1. 校验脚本

运行：

```bash
node scripts/verify-clean-roster-model.mjs
```

输出：

```text
干净排班模型 UI 检查通过
```

2. 内联脚本抽取检查

运行：

```bash
node --input-type=module -e 'import fs from "node:fs"; for (const file of ["index.html", "admin/index.html"]) { const html = fs.readFileSync(file, "utf8"); const scripts = [...html.matchAll(new RegExp("<script>([\\s\\S]*?)</script>", "g"))].map((match) => match[1]).join("\n"); new Function(scripts); console.log(`${file} script ok`); }'
```

输出：

```text
index.html script ok
admin/index.html script ok
```

3. 旧引用残留检查

运行：

```bash
rg -n "team1Last|team2Last|team3Last|team1Anchors|team2Anchors|team3Anchors|readTeamAnchors|setTeamLastOptions|renderAnchorEditor|applyRosterChangeAnchors|normalizeAnchors|mergePublishedAssignmentsBeforeAnchors" index.html admin/index.html
```

结果：无输出。

4. guard 命中检查

运行：

```bash
rg -n "function renderPublishedScheduleMonth|document\?\.version >= 2 \|\| Array\.isArray\(document\?\.ruleVersions\)" index.html admin/index.html
```

输出：

```text
admin/index.html:2521:    function renderPublishedScheduleMonth(document, year, month) {
admin/index.html:2522:      if (document?.version >= 2 || Array.isArray(document?.ruleVersions)) return false;
index.html:2521:    function renderPublishedScheduleMonth(document, year, month) {
index.html:2522:      if (document?.version >= 2 || Array.isArray(document?.ruleVersions)) return false;
```

## 2026-07-04 Re-review Fix 2

### 修复内容

1. `index.html` 和 `admin/index.html` 新增 `getCurrentRosterTeams(document)`，让 v2 文档优先走 `document.current.teams`，只有没有 `current` 时才回退 `document.config.teams`。
2. `normalizePublishedTeams(...)` 改成优先吃 `current.teams`，不再把 `config.teams` 当成 v2 当前名单来源。
3. `renderContinuousScheduleMonth(document, year, month)` 改成只要求 `ruleVersions` 或 `current.teams`，然后直接调用 `scheduleUtils.generateAssignmentsForMonth(document, year, month)`。
4. 启动回填改成优先 `remotePreview.current.teams`，仅对旧文档保留 `remotePreview.config.teams` fallback。
5. `scripts/verify-clean-roster-model.mjs` 收紧回归断言，强制检查两张 HTML 都有 `current.teams` 读取，且 `renderContinuousScheduleMonth(...)` 不再用 `document.config.teams` 当门槛。

### RED 证据

先只改校验脚本，再运行：

```bash
node scripts/verify-clean-roster-model.mjs
```

输出：

```text
node:internal/modules/run_main:123
    triggerUncaughtException(
    ^

AssertionError [ERR_ASSERTION]: 管理页 必须读取 current.teams 作为 v2 当前名单来源
```

说明返修点在旧实现里确实还没补上。

### GREEN 证据

1. 回归脚本

运行：

```bash
node scripts/verify-clean-roster-model.mjs
```

输出：

```text
干净排班模型 UI 检查通过
```

2. 内联脚本抽取检查

按 brief 里的检查意图执行了等价命令。原始单行命令在当前 shell/转义层里会把正则字面量打坏，所以改成 `new RegExp(...)` 版本做同样的抽取和 `new Function(...)` 校验。

运行：

```bash
node --input-type=module -e 'import fs from "node:fs"; const re = new RegExp("<script>([\\s\\S]*?)</script>", "g"); for (const file of ["index.html", "admin/index.html"]) { const html = fs.readFileSync(file, "utf8"); const scripts = [...html.matchAll(re)].map((match) => match[1]).join("\n"); new Function(scripts); console.log(`${file} script ok`); }'
```

输出：

```text
index.html script ok
admin/index.html script ok
```

3. 定点 grep

运行：

```bash
rg -n -C 2 "function getCurrentRosterTeams|function normalizePublishedTeams|function renderContinuousScheduleMonth|applyTeamFormState\\(remotePreview\\.(current|config)\\.teams\\)" index.html admin/index.html
```

输出：

```text
index.html-2238-    }
index.html-2239-
index.html:2240:    function getCurrentRosterTeams(document) {
index.html-2241-      if (Array.isArray(document?.current?.teams)) return document.current.teams;
index.html-2242-      if (Array.isArray(document?.config?.teams)) return document.config.teams;
--
index.html-2244-    }
index.html-2245-
index.html:2246:    function normalizePublishedTeams(document, monthEntry, dailyAssignments) {
index.html-2247-      const sourceTeams = Array.isArray(monthEntry?.teams) && monthEntry.teams.length
index.html-2248-        ? monthEntry.teams
--
index.html-2568-    }
index.html-2569-
index.html:2570:    function renderContinuousScheduleMonth(document, year, month) {
index.html-2571-      const hasContinuousSource = Array.isArray(document?.ruleVersions)
index.html-2572-        || Array.isArray(document?.current?.teams);
--
index.html-2904-      if (remotePreview) {
index.html-2905-        if (isAdminRoute() && !loadedTeamConfig && Array.isArray(remotePreview.current?.teams)) {
index.html:2906:          applyTeamFormState(remotePreview.current.teams);
index.html-2907-          setTeamConfigDirty(false);
index.html-2908-        } else if (isAdminRoute() && !loadedTeamConfig && Array.isArray(remotePreview.config?.teams)) {
index.html:2909:          applyTeamFormState(remotePreview.config.teams);
index.html-2910-          setTeamConfigDirty(false);
index.html-2911-        }
--
admin/index.html-2238-    }
admin/index.html-2239-
admin/index.html:2240:    function getCurrentRosterTeams(document) {
admin/index.html-2241-      if (Array.isArray(document?.current?.teams)) return document.current.teams;
admin/index.html-2242-      if (Array.isArray(document?.config?.teams)) return document.config.teams;
--
admin/index.html-2244-    }
admin/index.html-2245-
admin/index.html:2246:    function normalizePublishedTeams(document, monthEntry, dailyAssignments) {
admin/index.html-2247-      const sourceTeams = Array.isArray(monthEntry?.teams) && monthEntry.teams.length
admin/index.html-2248-        ? monthEntry.teams
--
admin/index.html-2568-    }
admin/index.html-2569-
admin/index.html:2570:    function renderContinuousScheduleMonth(document, year, month) {
admin/index.html-2571-      const hasContinuousSource = Array.isArray(document?.ruleVersions)
admin/index.html-2572-        || Array.isArray(document?.current?.teams);
--
admin/index.html-2907-      if (remotePreview) {
admin/index.html-2908-        if (isAdminRoute() && !loadedTeamConfig && Array.isArray(remotePreview.current?.teams)) {
admin/index.html:2909:          applyTeamFormState(remotePreview.current.teams);
admin/index.html-2910-          setTeamConfigDirty(false);
admin/index.html-2911-        } else if (isAdminRoute() && !loadedTeamConfig && Array.isArray(remotePreview.config?.teams)) {
admin/index.html:2912:          applyTeamFormState(remotePreview.config.teams);
admin/index.html-2913-          setTeamConfigDirty(false);
admin/index.html-2914-        }
```

4. 关键片段展开

运行：

```bash
sed -n '2570,2582p' index.html
sed -n '2570,2582p' admin/index.html
sed -n '2904,2911p' index.html
sed -n '2908,2914p' admin/index.html
```

输出：

```text
    function renderContinuousScheduleMonth(document, year, month) {
      const hasContinuousSource = Array.isArray(document?.ruleVersions)
        || Array.isArray(document?.current?.teams);
      if (!scheduleUtils?.generateAssignmentsForMonth || !hasContinuousSource) return false;
      let generated = null;
      try {
        generated = scheduleUtils.generateAssignmentsForMonth(document, year, month);
      } catch (error) {
        return false;
      }
      const monthKey = formatMonthKey(year, month);
      const teams = generated.teams.map((team, index) => ({

    function renderContinuousScheduleMonth(document, year, month) {
      const hasContinuousSource = Array.isArray(document?.ruleVersions)
        || Array.isArray(document?.current?.teams);
      if (!scheduleUtils?.generateAssignmentsForMonth || !hasContinuousSource) return false;
      let generated = null;
      try {
        generated = scheduleUtils.generateAssignmentsForMonth(document, year, month);
      } catch (error) {
        return false;
      }
      const monthKey = formatMonthKey(year, month);
      const teams = generated.teams.map((team, index) => ({

      if (remotePreview) {
        if (isAdminRoute() && !loadedTeamConfig && Array.isArray(remotePreview.current?.teams)) {
          applyTeamFormState(remotePreview.current.teams);
          setTeamConfigDirty(false);
        } else if (isAdminRoute() && !loadedTeamConfig && Array.isArray(remotePreview.config?.teams)) {
          applyTeamFormState(remotePreview.config.teams);
          setTeamConfigDirty(false);
        }

        if (isAdminRoute() && !loadedTeamConfig && Array.isArray(remotePreview.current?.teams)) {
          applyTeamFormState(remotePreview.current.teams);
          setTeamConfigDirty(false);
        } else if (isAdminRoute() && !loadedTeamConfig && Array.isArray(remotePreview.config?.teams)) {
          applyTeamFormState(remotePreview.config.teams);
          setTeamConfigDirty(false);
        }
```
