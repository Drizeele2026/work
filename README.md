# 值班排班工具

这是一个部署在 GitHub Pages 上的排班工具。

- 公开查看：[https://drizeele2026.github.io/work/](https://drizeele2026.github.io/work/)
- 管理排班：[https://drizeele2026.github.io/work/admin/](https://drizeele2026.github.io/work/admin/)
- 仓库地址：[https://github.com/Drizeele2026/work](https://github.com/Drizeele2026/work)

## 谁用哪个页面

团队成员只打开公开页看排班，不需要登录，也不需要 token。

负责人打开 `/admin/` 管理排班。管理页不会从公开页露出入口，只有知道管理地址的人才会看到发布和 token 配置。

## 排班规则

每个团队独立排班。前端、后端、测试各有自己的成员名单和已发布规则版本，互不影响。

规则很简单：

- 管理员只维护团队名称、成员顺序和飞书 OpenID。
- 点击发布后，系统会记录一版从今天开始生效的规则。
- 今天之前的排班不主动改变，今天及以后按新名单顺排。
- 私下换班不进入系统，由值班同事自行处理。

## 为什么这样排

核心目标是公平，而且规则要透明。

顺序轮转的好处是大家都按同一条队列往前走，一个完整轮次里每个人都会轮到。人数不能整除月份天数时，有人会多一天、有人少一天，但差距最多就是 1 天。

周六周日也放在同一条自然日队列里，不单独拆规则。这样周末值班会随着日期一起往后滚，大家都有份，不会固定压在几个人身上，也不会有人长期避开周末。

跨月继续接龙也是同一个原因。如果每个月都从第一个人重新开始，月初、月末和周末很容易反复落到同一批人身上。连续推算可以把这种偏差摊开。

## 系统实现原理

这个工具没有服务器，也没有数据库。页面是静态 HTML，数据直接存在仓库里。

用到的 GitHub 能力主要有这几块：

- GitHub Pages 负责托管公开页和管理页，团队成员打开链接就能看。
- GitHub 仓库里的 `data/organizations.json` 和 `data/orgs/{slug}/schedule.json` 负责保存组织索引和各组织排班数据。
- GitHub commit 负责保存每次发布的历史记录，后续可以追溯和回滚。
- GitHub Actions 负责跑自动提醒；具体规则写在 `.github/workflows/duty-reminder.yml` 这个 workflow 里。

这样做有几个好处：

- 团队成员只是查看排班，不需要注册、登录、配置任何东西。
- 负责人只在可信电脑上配置一次 GitHub PAT。
- 点「发布到公开页」就是一次普通 GitHub commit。
- 每次发布天然有历史记录，可以在仓库提交记录里追溯。
- 不需要维护后端服务，也没有额外部署成本。

换句话说，GitHub 仓库就是这个工具的持久化存储。GitHub Pages 负责展示，GitHub Actions 负责定时任务，GitHub workflow 负责描述任务怎么跑，GitHub commit 负责保存历史。

## 多组织

默认组织仍然可以直接打开：

```text
/work/
/work/admin/
```

其他组织使用 `org` 参数：

```text
/work/?org=takeaway
/work/admin/?org=takeaway
```

当前已配置组织：

```text
智慧门店：/work/?org=intelligence
营运通：/work/?org=shm
```

旧的 `?org=default` 仍然可以打开智慧门店，用来兼容旧链接。

组织列表保存在：

```text
data/organizations.json
```

每个组织有自己的排班和提醒状态：

```text
data/orgs/{slug}/schedule.json
data/orgs/{slug}/reminder-state.json
```

第一版是内部可信模式。管理页会按 URL 只操作当前组织，但 GitHub PAT 仍然是仓库级权限。

## 负责人怎么发布

1. 打开 [管理排班](https://drizeele2026.github.io/work/admin/)。
2. 修改团队名称、成员顺序和飞书 OpenID。
3. 点「发布到公开页」。
4. 发布成功后，公开页会更新，按钮会变成「已发布」。

如果点发布时没有权限，页面会提示去配置 GitHub Token。配置完成后再点一次发布即可。

## GitHub Token 怎么配

只需要负责人配置一次，保存在当前电脑的浏览器本地存储里，不会写进仓库。

推荐使用 Fine-grained PAT：

1. 打开 GitHub 的 Personal access tokens 页面。
2. 创建 Fine-grained token。
3. Repository access 只选择 `Drizeele2026/work` 这个仓库。
4. Repository permissions 只给 `Contents: Read and write`。
5. 回到管理页，把 token 填进「GitHub Token」，点「保存到本机」。

不要把 token 发给别人，也不要提交到仓库。如果怀疑泄露，直接在 GitHub 里 revoke 掉，再生成一个新的。

## 日常规则

- 不需要选择排班几个月。系统会按已发布规则继续往后推算。
- 修改名单后，直接重新发布即可。系统会从发布当天开始让这个团队按新名单顺排，其他团队不受影响。
- 发布成功后不能重复点发布；再次修改名单后按钮才会恢复可发布。
- 公开页只展示排班，不展示管理入口。

## 每日飞书提醒

仓库里有一个 GitHub Actions 提醒 workflow：

```text
.github/workflows/duty-reminder.yml
```

GitHub Actions 只保留 `workflow_dispatch`，不再使用 GitHub 自带 schedule。每天北京时间 09:00 的自动提醒由 cron-job.org 调 GitHub API 触发这个 workflow。

每日提醒会读取 `data/organizations.json`，遍历已启用提醒的组织。每个组织用自己的 `data/orgs/{slug}/schedule.json` 算当天值班人，再发到该组织配置的飞书群。

提醒消息会优先 @ 当日排班人。负责人在管理页的成员名单里这样填：

```text
方思琪 | ou_xxx
唐宇宏
谭贤 | ou_xxx
```

`|` 前面是排班里显示的名字，后面是飞书 OpenID。没填 OpenID 的成员不会被 @，消息里仍然会显示名字，提醒照常发送。

默认组织继续使用现有 Secret：

```text
FEISHU_WEBHOOK
```

新增组织时，需要在 `data/organizations.json` 填 `reminder.webhookSecretName`，在 GitHub Secrets 创建同名 secret，并在 `.github/workflows/duty-reminder.yml` 的提醒步骤 env 中暴露它。

如果一次 workflow 里有的组织发成功了、有的组织因为缺 secret 失败，成功发送的组织 `reminder-state.json` 还是会先提交，避免下次重复提醒。失败组织把 secret 修好后，直接重跑这个 workflow 就行。

脚本位置：

```text
scripts/send-duty-reminder.mjs
```

本地只看消息内容，不真的发群：

```bash
node scripts/send-duty-reminder.mjs --dry-run
```

提醒脚本会按已发布规则版本连续顺排；只有成员名单和规则版本都不可用时才会失败。

## 数据文件

组织索引保存在：

```text
data/organizations.json
```

每个组织的排班和提醒状态保存在：

```text
data/orgs/{slug}/schedule.json
data/orgs/{slug}/reminder-state.json
```

`data/organizations.json` 只管组织列表、默认组织和提醒配置。每个 `data/orgs/{slug}/schedule.json` 里，`current.teams` 是当前维护的团队名单，`ruleVersions` 是已经发布的规则版本，每个版本有 `effectiveDate` 和团队成员顺序。版本里的 `startPerson` 是系统内部起算人，不需要在管理页手动填写。

页面文件：

```text
index.html
admin/index.html
```

`index.html` 是公开页，`admin/index.html` 是管理页。
