# Task 4 报告

## 实现内容

- `scripts/send-duty-reminder.test.mjs`
  - 追加了 4 个多组织场景测试：
    - 多组织普通触发分别发送并分别写状态
    - `--org` 只发送指定组织
    - 多组织 `--dry-run` 不发送也不写状态
    - 某组织缺少 webhook secret 时，其它组织仍发送，最后抛出汇总错误
- `scripts/send-duty-reminder.mjs`
  - 增加 `organization-utils.js` 引用和 `DEFAULT_ORGANIZATIONS_PATH`
  - 新增 `loadOrganizationIndex`
  - 新增 `parseArgValue`
  - 新增 `resolveReminderOrganizations`
  - 新增组织级辅助函数：状态文件路径、公开页地址、webhook 读取
  - 新增 `sendOrganizationReminder`
  - 抽出 `runSingleScheduleReminder`，保留 `SCHEDULE_PATH` 单文件兼容入口
  - 重写 `main`：
    - 有 `SCHEDULE_PATH` 时走旧的单文件逻辑
    - 没有 `SCHEDULE_PATH` 时按组织索引批量发送
    - 支持 `--org` / `REMINDER_ORG`
    - 多组织错误按组织名汇总后统一抛出

## 测试命令和结果

1. `node --test scripts/send-duty-reminder.test.mjs`
   - RED 阶段：失败，4 个新增多组织测试不通过
   - GREEN 阶段：通过，16/16 通过
2. `node --test scripts/organization-utils.test.mjs scripts/schedule-utils.test.mjs`
   - 通过，17/17 通过

## TDD RED/GREEN 证据

### RED

- 命令：`node --test scripts/send-duty-reminder.test.mjs`
- 结果：退出码 1
- 关键失败：
  - `main：多组织普通触发分别发送并分别写状态`
    - `undefined !== 2`
  - `main：--org 只发送指定组织`
    - `undefined !== 1`
  - `main：多组织 dry-run 不发送也不写状态`
    - `undefined !== 2`
  - `main：某组织缺少 webhook secret 时，其他组织仍会发送，最终抛出汇总错误`
    - `Missing expected rejection.`

### GREEN

- 命令：`node --test scripts/send-duty-reminder.test.mjs`
- 结果：退出码 0，16/16 通过
- 命令：`node --test scripts/organization-utils.test.mjs scripts/schedule-utils.test.mjs`
- 结果：退出码 0，17/17 通过

## 改动文件

- `scripts/send-duty-reminder.mjs`
- `scripts/send-duty-reminder.test.mjs`
- `.superpowers/sdd/task-4-report.md`

## 自检结果

- 只改了 brief 指定的两个脚本文件，加上用户要求输出的报告文件
- 没改 workflow、README、前端页面
- 保留了 `SCHEDULE_PATH` 单文件兼容入口
- 没在日志、报告或提交信息里打印 webhook/token/secret 原文
- 提交时只会暂存这次任务相关的脚本文件，避免带上别人的脏改动

## 疑虑

- 当前 `--dry-run` 会打印卡片内容 JSON，这是原有行为延续。里面不包含 webhook secret，但会包含组织名、公开页地址和值班内容。
