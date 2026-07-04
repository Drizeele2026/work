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
