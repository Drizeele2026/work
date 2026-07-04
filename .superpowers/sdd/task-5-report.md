# Task 5 报告

## 实现内容

- 按 brief 扩展 `scripts/verify-multi-organization.mjs`，新增对 workflow 默认 webhook、组织状态提交，以及 README 多组织说明的静态断言。
- 按 brief 扩展 `scripts/verify-readonly-layout.mjs`，把 README 的系统实现原理和多组织数据文件说明纳入校验。
- 更新 `.github/workflows/duty-reminder.yml`：
  - 保留 `workflow_dispatch`。
  - 提醒步骤继续暴露默认组织 `FEISHU_WEBHOOK`。
  - 新增示例组织 secret 映射 `FEISHU_WEBHOOK_TAKEAWAY`。
  - 提交状态从单文件改成检查 `data/orgs`，并提交 `data/orgs/*/reminder-state.json`。
- 更新 `README.md`：
  - 改成中文说明多组织访问方式。
  - 说明默认组织和 `org` 参数访问路径。
  - 说明 `data/organizations.json`、`data/orgs/{slug}/schedule.json`、`data/orgs/{slug}/reminder-state.json`。
  - 说明提醒脚本按组织遍历，以及 GitHub Secret 和 workflow env 的映射要求。

## 测试命令和结果

### RED

1. `node scripts/verify-multi-organization.mjs`
   - 结果：失败
   - 关键信息：`AssertionError [ERR_ASSERTION]: workflow 需要检查组织提醒状态`
2. `node scripts/verify-readonly-layout.mjs`
   - 结果：失败
   - 关键信息：`AssertionError [ERR_ASSERTION]: README 需要说明多组织数据文件`

### GREEN

1. `node scripts/verify-multi-organization.mjs`
   - 结果：通过
   - 输出：`多组织静态检查通过`
2. `node scripts/verify-readonly-layout.mjs`
   - 结果：通过
   - 输出：`只读排班布局检查通过`
3. `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/duty-reminder.yml"); puts "workflow yaml ok"'`
   - 结果：通过
   - 输出：`workflow yaml ok`

## RED/GREEN 证据

- RED 证据 1：workflow 仍然检查 `data/reminder-state.json`，未按组织目录提交。
- RED 证据 2：README 仍然把数据文件写成单一 `data/schedule.json`，没有多组织说明。
- GREEN 证据 1：两条 Node 校验脚本都输出通过。
- GREEN 证据 2：workflow YAML 通过 Ruby 解析。

## 改动文件

- `.github/workflows/duty-reminder.yml`
- `README.md`
- `scripts/verify-readonly-layout.mjs`
- `scripts/verify-multi-organization.mjs`

## 自检结果

- 只改了 brief 指定的 4 个业务文件，外加按要求新增报告文件。
- 没有改前端页面，也没有改提醒脚本。
- `workflow_dispatch` 仍然保留，未增加 GitHub schedule / cron。
- README 已改成中文，并包含多组织、默认组织、secret env 映射说明。
- 提交前已重新跑完整校验。

## 疑虑

- 当前仓库里的 `data/organizations.json` 还是只有默认组织；workflow 里先按 brief 暴露了 `FEISHU_WEBHOOK_TAKEAWAY` 示例映射。后续真加组织时，还需要继续在 workflow 里补对应 env。
