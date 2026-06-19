# 值班排班工具

这是一个部署在 GitHub Pages 上的排班工具。

- 公开查看：[https://drizeele2026.github.io/work/](https://drizeele2026.github.io/work/)
- 管理排班：[https://drizeele2026.github.io/work/admin/](https://drizeele2026.github.io/work/admin/)
- 仓库地址：[https://github.com/Drizeele2026/work](https://github.com/Drizeele2026/work)

## 谁用哪个页面

团队成员只打开公开页看排班，不需要登录，也不需要 token。

负责人打开 `/admin/` 管理排班。管理页不会从公开页露出入口，只有知道管理地址的人才会看到发布和 token 配置。

## 为什么这么设计

这个工具没有服务器，也没有数据库。页面是静态 HTML，数据存在仓库里的 `data/schedule.json`。

这样做有几个好处：

- 团队成员只是查看排班，不需要注册、登录、配置任何东西。
- 负责人只在可信电脑上配置一次 GitHub PAT。
- 点「发布到公开页」就是一次普通 GitHub commit。
- 每次发布天然有历史记录，可以在仓库提交记录里追溯。
- 不需要维护后端服务，也没有额外部署成本。

换句话说，GitHub 仓库就是这个工具的持久化存储。页面负责展示和编辑，GitHub Pages 负责托管，GitHub commit 负责保存历史。

## 负责人怎么发布

1. 打开 [管理排班](https://drizeele2026.github.io/work/admin/)。
2. 修改团队名称、成员名单、接龙起点。
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

它会每天北京时间 09:00 读取 `data/schedule.json`，找到当天值班人，然后调用飞书群机器人发消息。

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
