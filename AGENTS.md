# 本项目 Agent 操作说明

## 语言和文档

- 默认用中文回复和写文档。
- 不要把 PAT、飞书 webhook、请求头、secret 原文写进代码、README、提交信息或对话复盘。
- 本机私有操作手册在 `LOCAL_AI_OPERATIONS.md`。涉及 GitHub 推送、Action 触发、PAT 位置时，先读这份文档。

## 推送到远端

本仓库远端是普通 HTTPS 地址：

```text
https://github.com/Drizeele2026/work.git
```

不要直接执行普通 `git push origin main`，也不要给 git push 用 Bearer token。这个仓库的 git 推送需要 Basic 认证：用户名用 `x-access-token`，密码用本机 `.local/ai-secrets.env` 里的 `GITHUB_PAT`。

正确推送方式：

```bash
source /Users/tst/work/tastien/work_schedule/.local/ai-secrets.env
B64=$(printf 'x-access-token:%s' "$GITHUB_PAT" | base64 | tr -d '\n')
for i in 1 2 3 4 5; do
  git -c http.version=HTTP/1.1 -c http.extraHeader="Authorization: Basic ${B64}" push origin main && break
done
unset GITHUB_PAT B64
```

说明：

- `http.version=HTTP/1.1` 是为了避开偶发的 HTTP2 / SSL 网络抖动。
- 不要把 token 写进 remote URL，也不要提交 `.local/ai-secrets.env`。
- 推送后用下面命令确认远端 `main` 已更新：

```bash
git ls-remote origin refs/heads/main
```

## 推送前检查

改动较大时，推送前至少跑：

```bash
node --test scripts/member-utils.test.mjs scripts/organization-utils.test.mjs scripts/schedule-utils.test.mjs scripts/send-duty-reminder.test.mjs
node scripts/verify-clean-roster-model.mjs
node scripts/verify-readonly-layout.mjs
node scripts/verify-multi-organization.mjs
node --check scripts/send-duty-reminder.mjs
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/duty-reminder.yml"); puts "workflow yaml ok"'
git diff --check
```

