# 值班排班工具

这是一个部署在 GitHub Pages 上的排班工具。

- 公开查看：[https://drizeele2026.github.io/work/](https://drizeele2026.github.io/work/)
- 管理排班：[https://drizeele2026.github.io/work/admin/](https://drizeele2026.github.io/work/admin/)
- 仓库地址：[https://github.com/Drizeele2026/work](https://github.com/Drizeele2026/work)

## 谁用哪个页面

团队成员只打开公开页看排班，不需要登录，也不需要 token。

负责人打开 `/admin/` 管理排班。管理页不会从公开页露出入口，只有知道管理地址的人才会看到发布和 token 配置。

## 排班规则

每个团队独立排班。比如前端、后端、测试各有自己的成员名单和接龙节点，互不影响。

规则很简单：

- 成员按名单里的顺序循环值班。
- 每个团队独立维护「接龙节点」。节点默认表示“基准日当天值班人”，也可以切成“基准日前一天值班人”。
- 系统会从每个团队最近的节点往后接着排。节点之前已经发布过的排期不会主动重算。
- 排班按自然日连续推进，周一到周日都算一天，不跳过周六周日。
- 查看后续月份时，系统会从每个团队自己的最近节点继续往后推，不会每个月重新从第一个人开始。
- 每天每个团队安排 1 个人。成员少的团队轮得快，成员多的团队轮得慢。
- 如果名单、顺序或节点改了，就在管理页调整后重新发布。

## 为什么这样排

核心目标是公平，而且规则要透明。

顺序轮转的好处是大家都按同一条队列往前走，一个完整轮次里每个人都会轮到。人数不能整除月份天数时，有人会多一天、有人少一天，但差距最多就是 1 天。

周六周日也放在同一条自然日队列里，不单独拆规则。这样周末值班会随着日期一起往后滚，大家都有份，不会固定压在几个人身上，也不会有人长期避开周末。

跨月继续接龙也是同一个原因。如果每个月都从第一个人重新开始，月初、月末和周末很容易反复落到同一批人身上。连续推算可以把这种偏差摊开。

## 系统实现原理

这个工具没有服务器，也没有数据库。页面是静态 HTML，数据存在仓库里的 `data/schedule.json`。

用到的 GitHub 能力主要有这几块：

- GitHub Pages 负责托管公开页和管理页，团队成员打开链接就能看。
- GitHub 仓库里的 `data/schedule.json` 负责保存排班数据。
- GitHub commit 负责保存每次发布的历史记录，后续可以追溯和回滚。
- GitHub Actions 负责跑自动提醒；具体规则写在 `.github/workflows/duty-reminder.yml` 这个 workflow 里。

这样做有几个好处：

- 团队成员只是查看排班，不需要注册、登录、配置任何东西。
- 负责人只在可信电脑上配置一次 GitHub PAT。
- 点「发布到公开页」就是一次普通 GitHub commit。
- 每次发布天然有历史记录，可以在仓库提交记录里追溯。
- 不需要维护后端服务，也没有额外部署成本。

换句话说，GitHub 仓库就是这个工具的持久化存储。GitHub Pages 负责展示，GitHub Actions 负责定时任务，GitHub workflow 负责描述任务怎么跑，GitHub commit 负责保存历史。

## 负责人怎么发布

1. 打开 [管理排班](https://drizeele2026.github.io/work/admin/)。
2. 修改团队名称、成员名单、接龙节点。
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

- 不需要选择排班几个月。系统会从已发布结果继续往后推算。
- 修改名单后，直接重新发布即可。
- 发布成功后不能重复点发布；再次修改名单后按钮才会恢复可发布。
- 公开页只展示排班，不展示管理入口。

## 每日飞书提醒

仓库里有一个 GitHub Actions 定时任务：

```text
.github/workflows/duty-reminder.yml
```

测试期临时每 5 分钟执行一次。GitHub Actions 定时任务最短间隔是 5 分钟，测试完成后改回每天北京时间 09:00。

它会读取 `data/schedule.json`，找到当天值班人，然后调用飞书群机器人发消息。

提醒消息会优先 @ 当天值班人。负责人在管理页的成员名单里这样填：

```text
方思琪 | ou_xxx
唐宇宏
谭贤 | ou_xxx
```

`|` 前面是排班里显示的名字，后面是飞书 OpenID。没填 OpenID 的成员不会被 @，消息里仍然会显示名字，提醒照常发送。

飞书 webhook 不写进代码。需要在 GitHub 仓库里配置 Secret：

```text
FEISHU_WEBHOOK=飞书群机器人的 webhook
```

脚本位置：

```text
scripts/send-duty-reminder.mjs
```

本地只看消息内容，不真的发群：

```bash
node scripts/send-duty-reminder.mjs --dry-run
```

如果当天所在月份还没有发布排班，定时任务会失败并提示先发布当月排班。

## 数据文件

排班结果保存在：

```text
data/schedule.json
```

页面文件：

```text
index.html
admin/index.html
```

`index.html` 是公开页，`admin/index.html` 是管理页。
