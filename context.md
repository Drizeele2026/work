# Project Context

## 项目是什么

这是一个零后端的值班排班工具。

- 公开页：`https://drizeele2026.github.io/work/`
- 管理页：`https://drizeele2026.github.io/work/admin/`
- 仓库：`https://github.com/Drizeele2026/work`
- 持久化数据：`data/schedule.json`

普通成员只看公开页。负责人在管理页改名单、发布排班。发布本质上是把新的 `data/schedule.json` commit 到 GitHub 仓库，GitHub Pages 再展示最新静态文件。

## 目录说明

- `index.html`：公开查看页。
- `admin/index.html`：管理页。
- `admin/member-utils.js`：管理页成员解析工具，支持 `姓名 | 飞书OpenID`。
- `data/schedule.json`：已发布排班数据。
- `.github/workflows/duty-reminder.yml`：飞书值班提醒 GitHub Actions。
- `scripts/send-duty-reminder.mjs`：读取当天排班并调用飞书群机器人。
- `scripts/send-duty-reminder.test.mjs`：提醒脚本测试。
- `scripts/member-utils.test.mjs`：成员解析工具测试。
- `README.md`：给使用者看的说明。

## GitHub 是怎么更新的

之前更新仓库时，用的是用户提供的 GitHub Personal Access Token，也就是 PAT。

这个 PAT 只需要有当前仓库 `Contents: Read and write` 权限，用来把本地提交 push 到 `main`。不要把真实 PAT 写进文件、README、日志、issue、commit message 或最终回复。

推荐给后续 AI 使用的流程：

```bash
git clone https://github.com/Drizeele2026/work.git /tmp/workrepo
cd /tmp/workrepo

# 修改文件后验证
node --test scripts/member-utils.test.mjs scripts/send-duty-reminder.test.mjs
node scripts/send-duty-reminder.mjs --dry-run
git diff --check

git add .
git commit -m "你的提交信息"

# GITHUB_PAT 由用户临时提供，或从安全环境变量里读取。
# 不要把真实 token 写进文档。
git -c http.extraHeader="Authorization: Bearer ${GITHUB_PAT}" push origin main
```

如果用远端 URL 方式，也必须只用临时命令，不要提交到仓库：

```bash
git push https://x-access-token:${GITHUB_PAT}@github.com/Drizeele2026/work.git main
```

## GitHub Actions 是怎么改的

Action 文件在：

```text
.github/workflows/duty-reminder.yml
```

修改定时任务、脚本命令、环境变量，都改这个文件，然后正常 commit + push 到 `main` 即可。GitHub 会自动识别 workflow 文件变化。

当前 workflow 关键点：

```yaml
name: Duty Reminder

on:
  schedule:
    - cron: "*/5 * * * *"
  workflow_dispatch:

jobs:
  remind:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Send Feishu duty reminder
        env:
          FEISHU_WEBHOOK: ${{ secrets.FEISHU_WEBHOOK }}
          PUBLIC_ROSTER_URL: https://drizeele2026.github.io/work/
        run: node scripts/send-duty-reminder.mjs
```

测试期用的是每 5 分钟：

```yaml
- cron: "*/5 * * * *"
```

正式每天北京时间 09:00，应改成 UTC 01:00：

```yaml
- cron: "0 1 * * *"
```

GitHub Actions 的 cron 使用 UTC，不是北京时间。

## 飞书 webhook 用的什么 key

飞书群机器人 webhook 没有写在仓库里。它存放在 GitHub Actions Secret：

```text
FEISHU_WEBHOOK
```

workflow 运行时通过下面这行读取：

```yaml
FEISHU_WEBHOOK: ${{ secrets.FEISHU_WEBHOOK }}
```

后续 AI 不能向用户索要后再写进代码。只能让用户在 GitHub Secret 里配置，或者用 GitHub API 写入 Secret。

手动配置位置：

```text
GitHub 仓库 -> Settings -> Secrets and variables -> Actions -> New repository secret
```

Secret 名称：

```text
FEISHU_WEBHOOK
```

Secret 值：

```text
飞书自定义机器人的 webhook 地址
```

## 如果要用 API 设置 GitHub Secret

GitHub Secret 不能直接明文 PUT。正确流程是：

1. 用 PAT 调 GitHub API 获取仓库 public key。
2. 用 public key 加密 secret 值。
3. PUT 加密后的 secret。

后续 AI 可以写临时脚本做这件事，但不要把 webhook 或 PAT 写进脚本文件并提交。脚本应从环境变量读取：

```bash
GITHUB_PAT="..." FEISHU_WEBHOOK="..." node /tmp/set-github-secret.mjs
```

需要的 API：

```text
GET /repos/Drizeele2026/work/actions/secrets/public-key
PUT /repos/Drizeele2026/work/actions/secrets/FEISHU_WEBHOOK
```

PAT 至少需要能管理当前仓库 Actions secrets。只改代码和 workflow 时，通常只需要 `Contents: Read and write`。

## 手动触发 Action

GitHub 页面有时不显示 `Run workflow` 按钮。可以用 API 触发：

```bash
curl -fsSL \
  -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer ${GITHUB_PAT}" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://api.github.com/repos/Drizeele2026/work/actions/workflows/duty-reminder.yml/dispatches \
  -d '{"ref":"main"}'
```

这会真实调用飞书 webhook 发消息。执行前必须确认用户确实要发一次群提醒。

## 飞书 @ 人规则

管理页成员名单支持：

```text
方思琪 | ou_xxx
唐宇宏
谭贤 | ou_xxx
```

- `|` 前面是排班显示名。
- `|` 后面是飞书 OpenID。
- 配了 OpenID 的成员，提醒消息里会真正 @。
- 没配 OpenID 的成员，只显示名字，不会 @，但消息仍然正常发送。

自定义机器人不能自动获取群成员 OpenID，也不能通过手机号或邮箱直接 @ 人。飞书文档说明自定义机器人没有数据访问权限。要自动反查 OpenID，需要做飞书自建应用、申请权限和审核；当前项目为了 0 元和简单维护，不走这条路。

## 常用验证命令

```bash
node --test scripts/member-utils.test.mjs scripts/send-duty-reminder.test.mjs
node --check scripts/send-duty-reminder.mjs
node --check admin/member-utils.js
node scripts/send-duty-reminder.mjs --dry-run
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/duty-reminder.yml"); puts "workflow yaml ok"'
rg -n "open-apis/bot/v2/hook|FEISHU_WEBHOOK=.*https" . --glob '!context.md'
```

最后一条应该没有输出。它用来确认仓库里没有飞书 webhook 明文。

## 安全底线

- 不要把 GitHub PAT 写进仓库。
- 不要把飞书 webhook 写进仓库。
- 不要在回复里复述用户给过的 token 或 webhook。
- 不要把带 token 的远端 URL 保存进 `.git/config`。
- 如果怀疑 PAT 或 webhook 泄露，让用户立即 revoke 或重置。
