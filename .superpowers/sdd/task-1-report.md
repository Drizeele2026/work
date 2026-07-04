# Task 1 报告

## 结果

已完成 `schedule-utils.js` 和 `scripts/schedule-utils.test.mjs` 的改造，把核心排班模型从 `config/months/anchors` 切到 `current/ruleVersions`，并导出 `buildPublishedDocument`。

## RED 证据

先只改测试，再执行：

```bash
node --test scripts/schedule-utils.test.mjs
```

结果：FAIL

关键失败点：

- `findAssignmentForDateWithFallback` 仍报旧错误：`没有找到当天值班快照，也没有可用于顺排的团队配置。请先配置成员名单和接龙节点。`
- `utils.buildPublishedDocument is not a function`

这说明测试已经准确打到旧的 `config.teams` / anchor 逻辑和缺失导出。

## GREEN 证据

实现后再次执行：

```bash
node --test scripts/schedule-utils.test.mjs
```

结果：PASS

摘要：7 个测试全部通过，0 fail。

## 改动文件

- `schedule-utils.js`
- `scripts/schedule-utils.test.mjs`

## 具体改动

- 测试夹具改成 `version: 2 + current.teams + ruleVersions`
- 删除旧的 anchor/snapshot 相关测试，替换为 brief 指定的 rule-version 场景
- 核心计算逻辑改成按 `ruleVersions.effectiveDate` 选生效版本并顺排
- 当没有生效规则版本时，回退到 `current.teams`
- 新增 `buildPublishedDocument(remoteDocument, currentTeams, options)`
- 更新导出，只保留 brief 要求的 API
- 删除旧的 anchor/snapshot 相关实现和导出

## 自检结论

- 已确认只修改任务要求的两个代码文件
- `buildPublishedDocument` 在“名单不变”“当天值班人还在新名单里”“当天值班人已被移除”三类场景下都有测试覆盖
- 月排班、单日排班、未来几天列表都已经切到统一的 `ruleVersions` 计算路径

## Self-review findings

本次自检没有发现额外 bug。

## Concerns

无。

---

## 2026-07-04 review 修复追加

### 修复结果

已修复 reviewer 提的两处问题，只改了：

- `schedule-utils.js`
- `scripts/schedule-utils.test.mjs`

### 本轮 RED 证据

先补测试，再执行：

```bash
node --test scripts/schedule-utils.test.mjs
```

结果：FAIL

关键失败点：

- `generateAssignmentsForMonth 同月切换 ruleVersion 时返回团队和统计包含整月实际排到的人`
  - 实际 `teams` 只有 `前端:A,B`
  - 预期应包含同月后半段新版本里的 `C,D`
- `已有未来规则版本时，发布今天的名单比较发布日生效版本而不是最后一个版本`
  - 实际 `ruleVersions.length === 3`
  - 预期应保持 `2`

### 本轮修复点

- `generateAssignmentsForMonth`
  - 不再只用月初生效版本生成 `teams` / `counts`
  - 改成汇总“月初生效版本 + 月内切换版本 + dailyAssignments 实际排到的人”的并集
- `buildPublishedDocument`
  - 不再拿 `existingVersions.at(-1)` 比较
  - 改成比较 `publishDateKey` 当天的生效版本
  - 这样存在未来版本时，不会误追加当天新版本

### 本轮 GREEN 证据

再次执行：

```bash
node --test scripts/schedule-utils.test.mjs
```

结果：PASS

摘要：9 个测试全部通过，0 fail。

### 本轮改动文件

- `schedule-utils.js`
- `scripts/schedule-utils.test.mjs`
