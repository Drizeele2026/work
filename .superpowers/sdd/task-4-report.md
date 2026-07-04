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
