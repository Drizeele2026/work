# 值班提醒改为连续顺排设计

## 背景

现在提醒有两套触发来源：

- cron-job.org 每天北京时间 09:00 调 GitHub `workflow_dispatch`。
- GitHub Actions 自己的 `schedule` 兜底触发。

GitHub `schedule` 实测会严重延迟。2026-06-30 00:40 的提醒就是延迟任务跨过 0 点后发出的。现在既然已经用 cron-job.org 做主触发，就不再需要 GitHub 自己的定时。

另一个问题是排班数据语义。代码里目前把 `months[YYYY-MM].dailyAssignments` 当成提醒和公开页的唯一来源。这样 2026-06 之后，如果没有手动发布 2026-07，提醒脚本就查不到 7 月，也不会显示未来三天。这和实际规则不一致：发布的是人员名单、接龙节点和规则，不是每个月都要发布一份快照。

## 目标

- GitHub Actions 不再自己定时触发，只保留 `workflow_dispatch` 给 cron-job.org 和人工测试使用。
- 排班按 `config.teams`、成员顺序、`anchors` 和旧 `last` 连续顺排，跨月自然生效。
- 某团队在某天新增或修改接龙节点后，这一天及之后按新节点顺排；这一天之前的历史排班不主动改。
- 提醒脚本在没有目标月份快照时，也能算出当天和未来三天。
- 公开页在没有目标月份快照时，也能按配置生成当前展示月。
- 保留已有 `months` 快照读取能力，避免已经发布过的历史展示变化。

## 非目标

- 不接入后端服务或数据库。
- 不把未来很多个月一次性写进 `schedule.json`。
- 不改 cron-job.org 配置本身；本次只改 GitHub 仓库内 workflow 和代码。
- 不重新设计管理页 UI，只调整文案和数据语义。

## 推荐方案

采用“快照优先，配置顺排兜底”的方式。

读取某天值班时：

1. 如果 `months[YYYY-MM].dailyAssignments` 里有这一天，优先用快照。
2. 如果没有快照，就从 `config.teams` 连续计算这一天。
3. 连续计算时，优先找目标日期之前最近的历史快照，把那一天的值班人当成 `currentDay` 节点；找不到历史快照时才用旧 `last` 兜底。
4. 未来三天和公开页展示都使用同一套规则。

这样能兼容已有 2026-06 快照，也能自然算出 2026-07 及以后。

## 数据模型

`schedule.json` 保持兼容：

```json
{
  "version": 1,
  "config": {
    "teams": [
      {
        "name": "前端",
        "members": ["郑刘利", "林颖"],
        "last": "郑刘利",
        "anchors": [
          { "date": "2026-06-30", "mode": "currentDay", "person": "郑刘利" }
        ],
        "color": "blue"
      }
    ]
  },
  "months": {
    "2026-06": {
      "dailyAssignments": []
    }
  }
}
```

语义调整：

- `config.teams` 是长期规则来源。
- `anchors` 是接龙节点。`currentDay` 表示节点当天就是 `person`；`previousDay` 表示节点前一天是 `person`。
- `last` 只做旧数据兜底。没有 `anchors` 且没有可用历史快照时，用旧逻辑推导顺排。
- `months` 是历史快照，不再代表“必须逐月发布”。

## 组件调整

### Workflow

`.github/workflows/duty-reminder.yml` 删除 `on.schedule`。

保留：

- `workflow_dispatch`
- `force` 输入
- 发送提醒步骤
- 成功后提交 `data/reminder-state.json` 的去重状态

这样 cron-job.org 每天 09:00 触发一次，GitHub 不再半夜自己补跑。

### 排班纯函数

新增或抽出一组共享函数，给浏览器和 Node 脚本复用：

- 日期格式化和日期差计算。
- 成员规范化，兼容字符串成员和 `{ name, feishuOpenId }` 成员。
- `normalizeAnchors`
- `getAnchorForDate`
- `getPersonFromAnchor`
- `findLatestSnapshotBeforeDate`
- `generateAssignmentForDate`
- `generateAssignmentsForMonth`
- `findAssignmentForDateWithFallback`

这组函数只接收 `schedule.json` 数据和日期，不依赖 DOM、fetch、localStorage。

### 提醒脚本

`scripts/send-duty-reminder.mjs` 改为：

- 当天值班：调用 `findAssignmentForDateWithFallback(schedule, dateKey)`。
- 未来三天：每天也走同一个函数。
- 如果既没有快照，也没有可用 `config.teams`，才报错。
- 错误文案从“请先发布这个月排班”改为“请先配置成员名单和接龙节点”。

### 公开页

公开页加载 `data/schedule.json` 后：

- 当前月有快照：仍然渲染快照。
- 当前月没有快照：用 `config.teams` 生成当前月并渲染。

页面文案从“已发布快照”调整成“按已发布规则顺排”，避免让人以为必须每月发布。

### 管理页发布

管理页继续点击“发布到公开页”提交 `data/schedule.json`。

发布仍然可以写入当前展示月的 `months`，但核心变化是：未来月份不依赖这些快照。`config.teams` 必须保存最新成员、openId、颜色、`anchors` 和旧 `last`。

如果后续要进一步瘦身，可以再考虑发布时只写配置、不写当前月快照；本次不做，避免扩大改动。

## 数据流

cron-job.org：

```text
cron-job.org 09:00
  -> GitHub workflow_dispatch
  -> node scripts/send-duty-reminder.mjs
  -> 读取 data/schedule.json
  -> 快照优先，缺失时按 config 顺排
  -> 发飞书卡片
  -> 写 data/reminder-state.json
```

公开页：

```text
打开页面
  -> fetch data/schedule.json
  -> 当前月有快照就渲染快照
  -> 没有快照就按 config 顺排生成当前月
```

管理页：

```text
修改成员或接龙节点
  -> 发布 data/schedule.json
  -> 节点日期之前历史快照不主动改
  -> 节点日期及之后按新规则顺排
```

## 错误处理

- cron-job.org 重复触发时，现有 `reminder-state.json` 继续按北京日期去重。
- GitHub workflow 人工 `force` 继续不写去重状态。
- `config.teams` 为空、成员为空、节点人员不在成员名单里时，提醒脚本给中文错误。
- 某天没有快照但配置可计算时，不报错。
- 某天有快照但某个团队缺人时，优先暴露数据问题，不静默生成半套结果。

## 测试

最小验证：

- workflow 文件不再包含 `schedule:` 和 `cron:`。
- 只有 2026-06 快照时，提醒脚本能算出 2026-07-01。
- 2026-06-30 的未来三天能显示 7/1、7/2、7/3。
- 快照存在时仍优先读快照。
- 没有快照时，公开页能按 `config.teams` 生成目标月份。
- 修改某团队某天 `currentDay` 节点后，这一天及之后变化，之前日期不变。

验证命令沿用现有项目习惯：

```bash
node --test scripts/member-utils.test.mjs scripts/send-duty-reminder.test.mjs
node scripts/verify-duty-anchors.mjs
node scripts/verify-readonly-layout.mjs
node --check scripts/send-duty-reminder.mjs
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/duty-reminder.yml"); puts "workflow yaml ok"'
git diff --check
```
