# final review fix report

日期：2026-07-04

## 1. 每个 finding 怎么修的

### 1.1 具名组织不能 legacy fallback 到默认组织

- 改了 `organization-utils.js` 的 `resolveOrganization(...)`。
- 现在只有两种情况还能走 legacy：
  - URL 没显式带 `org`
  - 显式 `org=default`
- 只要是具名组织，比如 `?org=takeaway`，遇到组织索引缺失、损坏、加载失败，都会返回中文错误 `组织索引缺失或损坏，无法打开组织 ...`，不会再悄悄落到默认组织，也不会再让管理页误发到 `data/schedule.json`。
- 补了 `scripts/organization-utils.test.mjs` 回归：
  - `org=default` 还能 legacy fallback
  - 具名组织不能 fallback，必须报错

### 1.2 管理页本地团队草稿按组织隔离

- `index.html` 和 `admin/index.html` 两边同步改了。
- 团队草稿 key 不再是全局 `duty-roster-team-config`，改成按组织拼 key：
  - `duty-roster-team-config:${slug}`
- 新增了 `getTeamConfigStorageKey()`，保存和读取都走这个 helper。
- 启动顺序也调了：
  - 先读全局 GitHub repo/token
  - 再 `loadCurrentOrganization()`
  - 确认当前组织以后，才 `loadLocalUiState()` 读取团队草稿
- 这样 A 组织的草稿不会再串到 B 组织。
- 补了 `scripts/verify-multi-organization.mjs` 静态断言：
  - 必须存在按组织生成 key 的 helper
  - `setItem/getItem` 必须走组织 key
  - `boot()` 里必须先加载组织，再读团队草稿

### 1.3 workflow 部分成功状态要能提交

- 改了 `.github/workflows/duty-reminder.yml`。
- 提醒脚本步骤现在会自己记录退出码到 `GITHUB_OUTPUT`，不直接让 job 在这里中断。
- `Commit reminder state` 改成 `if: always()`，这样就算后面有组织缺 webhook，前面已经成功发送并写好的 `data/orgs/*/reminder-state.json` 也会照常提交。
- 最后新增一个收尾 step，按 `steps.send_reminder.outputs.exit_code` 把 workflow 失败状态补回来，所以：
  - 成功组织的状态能提交
  - 失败组织仍然会让 workflow 失败
- README 也补了一句：部分成功时，成功组织的状态还是会提交；失败组织把 secret 修好后直接重跑。

## 2. 跑了哪些验证，结果是什么

### 2.1 Node 测试

```bash
node --test scripts/organization-utils.test.mjs scripts/send-duty-reminder.test.mjs
```

结果：通过。`29` 个测试全部 `pass`，`fail 0`。

### 2.2 静态检查

```bash
node scripts/verify-multi-organization.mjs
node scripts/verify-readonly-layout.mjs
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/duty-reminder.yml"); puts "workflow yaml ok"'
git diff --check
```

结果：

- `多组织静态检查通过`
- `只读排班布局检查通过`
- `workflow yaml ok`
- `git diff --check` 无输出，退出码 `0`

## 3. 是否有浏览器验证，页面和结论

有，做了真实浏览器验证。

本地服务：

```bash
python3 -m http.server 4173 --bind 127.0.0.1
```

验证页面：

- `http://127.0.0.1:4173/admin/?org=default`

检查结果：

- console error 数量：`0`
- 组织副标题：`管理排班 · 默认组织`
- 默认组织团队回填正常：
  - `team1Name = 前端`
  - `team1Members` 已回填默认组织成员
- 清空 token 后点击“发布到公开页”：
  - 页面提示：`先填写 GitHub Token。`
  - toast：`先填写 GitHub Token。`
- localStorage 已写到组织隔离 key：
  - `duty-roster-team-config:default`

结论：

- 默认组织管理页没回归
- 团队草稿已经按组织 key 落盘
- 这次没有真实第二组织数据，所以跨组织隔离靠静态断言兜底；默认组织页面行为已实测

## 4. commit 列表

- `HEAD` `fix: harden organization isolation`
- `f951bf7` `fix: block legacy fallback for named orgs`
- `2a5d0b3` `fix: skip sent org before loading schedule`
- `a2fe425` `docs: document multi-organization usage`
