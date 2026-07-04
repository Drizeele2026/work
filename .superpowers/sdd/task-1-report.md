# Task 1 实现报告（组织索引纯函数和默认组织数据）

## 1. 实现内容
- 新增 `organization-utils.js`，实现任务要求的纯函数：
  - `DutyRosterOrganizations.normalizeOrgSlug`
  - `DutyRosterOrganizations.normalizeOrganizationIndex`
  - `DutyRosterOrganizations.resolveOrganization`
  - `DutyRosterOrganizations.relativeDataPath`
  - `DutyRosterOrganizations.organizationStatePath`
  - 同时按 brief 也导出 `normalizeOrganization`。
- 新增测试文件 `scripts/organization-utils.test.mjs`，覆盖 `normalizeOrgSlug`、组织解析、旧数据回退、路径工具函数。
- 新增默认组织索引：`data/organizations.json`。
- 新增默认组织目录并复制默认数据：
  - `data/orgs/default/schedule.json`（基于 `data/schedule.json` 复制后增加 `organization` 顶层字段）
  - `data/orgs/default/reminder-state.json`（基于 `data/reminder-state.json` 复制）

## 2. 测试命令与结果
- 失败验证（RED）：
  - 命令：`node --test scripts/organization-utils.test.mjs`
  - 结果：失败（`ENOENT`，缺少 `organization-utils.js`）。
- 实现后验证（GREEN）：
  - 命令：`node --test scripts/organization-utils.test.mjs`
  - 结果：通过，7/7。

## 3. RED/GREEN 证据
- RED 期望/实际：读取 `../organization-utils.js` 不存在，抛 `Error: ENOENT`。
- GREEN 期望/实际：7 条测试全部通过，输出显示 `pass 7 fail 0`。

## 4. 改动文件
- `organization-utils.js`
- `scripts/organization-utils.test.mjs`
- `data/organizations.json`
- `data/orgs/default/schedule.json`
- `data/orgs/default/reminder-state.json`

## 5. 自检结果
- `data/orgs/default/schedule.json` 已在 `updatedAt` 后、`current` 前补上 `organization: { slug: "default", name: "默认组织" }`。
- `data/organizations.json` 的 `organizations[0]` 与默认组织字段一致。
- `resolveOrganization(null, "", { allowLegacy: true })` 在测试中返回 legacy 组织，`schedulePath` 为 `data/schedule.json` 且 webhook 名为 `FEISHU_WEBHOOK`。

## 6. 疑虑
- 无。
