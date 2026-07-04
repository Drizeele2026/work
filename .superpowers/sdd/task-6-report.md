# Task 6 验证报告

## 1. 执行的命令和结果

### 1.1 Node 测试

```bash
node --test scripts/member-utils.test.mjs scripts/organization-utils.test.mjs scripts/schedule-utils.test.mjs scripts/send-duty-reminder.test.mjs
```

结果：通过。`41` 个测试全部 `pass`，`fail 0`。

### 1.2 静态验证

```bash
node scripts/verify-clean-roster-model.mjs
node scripts/verify-readonly-layout.mjs
node scripts/verify-multi-organization.mjs
node --check scripts/send-duty-reminder.mjs
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/duty-reminder.yml"); puts "workflow yaml ok"'
git diff --check
```

结果：

- `干净排班模型 UI 检查通过`
- `只读排班布局检查通过`
- `多组织静态检查通过`
- `workflow yaml ok`
- `node --check` 无输出，退出码 `0`
- `git diff --check` 无输出，退出码 `0`

### 1.3 浏览器检查

本地服务：

```bash
python3 -m http.server 4173
```

Playwright CLI wrapper：

```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
```

检查命令包含：

```bash
"$PWCLI" open http://127.0.0.1:4173/
"$PWCLI" goto http://127.0.0.1:4173/
"$PWCLI" goto http://127.0.0.1:4173/?org=default
"$PWCLI" goto http://127.0.0.1:4173/admin/
"$PWCLI" goto http://127.0.0.1:4173/admin/?org=default
"$PWCLI" console error --json
"$PWCLI" run-code 'async (page) => { ... }' --json
"$PWCLI" requests --json
```

结果见下方“浏览器检查明细”。

### 1.4 dry-run 验证

```bash
node scripts/send-duty-reminder.mjs --dry-run
node scripts/send-duty-reminder.mjs --dry-run --org default
```

配套校验命令：

```bash
shasum -a 256 data/orgs/default/reminder-state.json
stat -f "%m %z" data/orgs/default/reminder-state.json
```

结果：

- 两次 dry-run 都输出了默认组织卡片 JSON。
- 状态文件哈希和 `mtime/size` 前后完全一致。
- 输出里没有 `webhook`、`hooks.`、`open.feishu` 等敏感串。
- 没有出现“已发送”类发送结果输出。

## 2. 浏览器检查明细

### 2.1 页面和 console error

| 页面 | console error 数量 | 关键结论 |
| --- | ---: | --- |
| `/` | 0 | 顶部显示 `公开查看 · 默认组织`；月历正常渲染 |
| `/?org=default` | 0 | 顶部显示 `公开查看 · 默认组织`；和 `/` 展示的是同一份默认组织排班 |
| `/admin/` | 0 | 顶部显示 `管理排班 · 默认组织`；默认组织团队名单成功回填 |
| `/admin/?org=default` | 0 | 顶部显示 `管理排班 · 默认组织`；默认组织团队名单成功回填 |

### 2.2 关键 UI 结论

- 公开页 `/` 和 `/?org=default` 的顶部文案一致，都是 `公开查看 · 默认组织`。
- 两个公开页前几行内容一致，都是 `2026 年 7 月 / 按已发布规则顺排`，说明都读取到了默认组织排班。
- 管理页 `/admin/` 和 `/admin/?org=default` 都能回填默认组织数据，采样看到前端团队与成员输入框已有值，如 `前端 / 郑刘利 / 林颖 / 林胜聪`。
- 未配置 token 时，点击“发布到公开页”后，页面提示和 toast 都是 `先填写 GitHub Token。`。
- 点击发布后请求列表只看到本地静态数据读取：`data/organizations.json`、`data/orgs/default/schedule.json`，没有出现发布请求。

## 3. dry-run 前后 `data/orgs/default/reminder-state.json` 是否变化

### 判断方式

对 `data/orgs/default/reminder-state.json` 在 dry-run 前、中、后分别检查：

```bash
shasum -a 256 data/orgs/default/reminder-state.json
stat -f "%m %z" data/orgs/default/reminder-state.json
```

### 结果

- `before_sha` = `d2c1ac5dd585953d53e8855b57de6e356716d33a6724994589fa51ed8afb662c`
- `mid_sha` = `d2c1ac5dd585953d53e8855b57de6e356716d33a6724994589fa51ed8afb662c`
- `after_sha` = `d2c1ac5dd585953d53e8855b57de6e356716d33a6724994589fa51ed8afb662c`
- `before_stat` = `1783174056 35`
- `mid_stat` = `1783174056 35`
- `after_stat` = `1783174056 35`

结论：两次 dry-run 都没有写 `data/orgs/default/reminder-state.json`。

## 4. 是否修改了文件

有修改。原因是验证时发现两个真实问题：

1. 公开页把顶栏整体隐藏了，导致 `/` 和 `/?org=default` 看不到默认组织副标题。
2. 管理页未配置 token 时，发布提示不是 brief 要求的 `先填写 GitHub Token。`

修改文件：

- `index.html`：公开页保留顶栏；未配置 token 时统一提示 `先填写 GitHub Token。`
- `admin/index.html`：同步同样的提示逻辑和展示逻辑
- `scripts/verify-readonly-layout.mjs`：把旧的“公开页必须隐藏顶栏”校验改成新的“必须保留组织副标题”校验，和本次 brief 对齐

commit：`fix: stabilize multi-organization roster`

## 5. 最终 git 状态摘要

### `git status --short`

```bash
git status --short
```

结果：无输出，工作区干净。

### `git log --oneline -6`

```bash
git log --oneline -6
```

结果：

```text
fix: stabilize multi-organization roster
a2fe425 docs: document multi-organization usage
2a5d0b3 fix: skip sent org before loading schedule
f951bf7 fix: block legacy fallback for named orgs
cf64794 fix: keep legacy reminder fallback
d73f48c feat: send reminders by organization
```

## 6. Reviewer 阻塞项修复补充

### 6.1 修复内容

这次只做了 reviewer 指定的最小修复：

- `index.html`
  - 把公开态 `body:not(.admin-mode) .schedule-shell` 从 `min-height: 100dvh` 改成 `min-height: calc(100dvh - 104px)`。
  - 把公开态 `calendar-grid` 和 `day-cell` 的高度计算同步收口到扣掉顶栏后的剩余视口，避免页面总高变成“顶栏 + 100dvh”。
- `admin/index.html`
  - 同步和公开页完全一致的公开态高度规则，避免两个入口再漂移。
- `scripts/verify-readonly-layout.mjs`
  - 新增“公开态不能隐藏 topbar”的静态断言。
  - 新增公开态 `schedule-shell`、`calendar-grid`、`day-cell` 必须按“视口减 topbar”收口的静态断言，防止回归。

### 6.2 这次额外跑的验证

```bash
node scripts/verify-readonly-layout.mjs
git diff --check
```

结果：

- `只读排班布局检查通过`
- `git diff --check` 无输出，退出码 `0`

### 6.3 Playwright 真实浏览器检查

本次继续使用 `4173` 端口，端口未被占用。

本地服务：

```bash
python3 -m http.server 4173 --bind 127.0.0.1
```

浏览器检查页面：

- `http://127.0.0.1:4173/`
- `http://127.0.0.1:4173/?org=default`
- `http://127.0.0.1:4173/admin/`

检查结果：

- `/`：
  - `brandSub` = `公开查看 · 默认组织`
  - `console error` = `0`
  - `document.documentElement.scrollHeight - window.innerHeight = 0`
- `/?org=default`：
  - `brandSub` = `公开查看 · 默认组织`
  - `console error` = `0`
  - `document.documentElement.scrollHeight - window.innerHeight = 0`
- `/admin/`：
  - `brandSub` = `管理排班 · 默认组织`
  - `console error` = `0`
  - 直接 `await handleTeamNextAction()` 后：
    - `teamPublishMessage` = `先填写 GitHub Token。`
    - `toast` = `先填写 GitHub Token。`

结论：公开页顶栏副标题恢复正常，公开页总高度没有明显超过视口高度，管理页无 token 发布提示也还正常。

### 6.4 补充 git log 证据

之前 Step 5 只截了 `-6`，看不全任务链。这次补充更长的历史：

```bash
git log --oneline --decorate -20
```

结果摘录：

```text
92e7ce9 (HEAD -> multi-organization-roster) fix: stabilize multi-organization roster
a2fe425 docs: document multi-organization usage
2a5d0b3 fix: skip sent org before loading schedule
f951bf7 fix: block legacy fallback for named orgs
cf64794 fix: keep legacy reminder fallback
d73f48c feat: send reminders by organization
d757956 fix: preserve publish validation order
a27601b feat: publish roster by organization
2fa2f84 fix: align organization page copy
560f90f feat: load roster by organization
56ec53f feat: add organization roster data
```

现在已经能直接看到 brief 要求的 5 个任务提交：

- `feat: add organization roster data`
- `feat: load roster by organization`
- `feat: publish roster by organization`
- `feat: send reminders by organization`
- `docs: document multi-organization usage`
