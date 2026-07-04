# 多组织排班设计

## 背景

现在这个工具只有一个使用空间：

- 公开页读 `data/schedule.json`。
- 管理页改同一个 `data/schedule.json`。
- 每日提醒只发到一个飞书群。
- 管理权限依赖 GitHub PAT，谁有仓库写权限谁能发布。

这对一个人或一个小团队够用。后面如果给公司内其他组织使用，需要把“谁的数据”“谁来维护”“提醒发到哪里”拆开。

这次不直接做完整 SaaS 多租户。当前项目是 GitHub Pages 静态站，没有后端、数据库和登录体系。直接上租户、角色、权限会把小工具变成一个平台项目，成本太高。

推荐先做轻量的“组织空间”。

## 目标

- 支持多个组织各自维护排班。
- 每个组织有独立的团队、成员、规则版本和提醒状态。
- 每个组织的提醒发到自己的飞书群。
- 现有默认排班继续可用，旧链接尽量不受影响。
- 先按内部可信模式做页面软隔离，后面能升级到真正权限隔离。
- 复用现有 `current.teams` 和 `ruleVersions` 排班模型，不重写排班算法。

## 非目标

- 不做完整登录体系。
- 不做数据库。
- 不做复杂租户计费、套餐、组织邀请。
- 第一版不做“创建组织”管理 UI。
- 第一版不保证 GitHub PAT 的文件级硬隔离。

## 推荐方案

采用“组织索引 + 每组织独立文件”的方式。

不要把所有组织塞进一个大 `schedule.json`。单文件改动小，但以后数据会混在一起，提醒状态、发布冲突、归档和权限都会变麻烦。

也不要马上做后端多租户。现在最划算的是把数据边界先切干净。

目录结构：

```text
data/
  organizations.json
  orgs/
    default/
      schedule.json
      reminder-state.json
    takeaway/
      schedule.json
      reminder-state.json
    qa/
      schedule.json
      reminder-state.json
```

层级关系：

```text
组织 organization
  -> 团队 team
    -> 成员 member
```

概念说明：

- `组织`：一个使用空间，比如“外卖业务组”“测试中心”。
- `团队`：组织里的排班线，比如前端、后端、测试。
- `成员`：实际值班人。
- `负责人`：维护某个组织排班的人。
- `提醒`：组织级配置，每个组织一个飞书群 webhook。

## 组织索引

新增 `data/organizations.json`，只保存组织列表和组织级元信息，不保存具体排班。

示例：

```json
{
  "version": 1,
  "defaultOrg": "default",
  "organizations": [
    {
      "slug": "default",
      "name": "默认组织",
      "owners": ["ou_xxx"],
      "schedulePath": "data/orgs/default/schedule.json",
      "enabled": true,
      "reminder": {
        "enabled": true,
        "webhookSecretName": "FEISHU_WEBHOOK_DEFAULT",
        "publicUrl": "https://drizeele2026.github.io/work/?org=default"
      }
    },
    {
      "slug": "takeaway",
      "name": "外卖业务组",
      "owners": ["ou_yyy"],
      "schedulePath": "data/orgs/takeaway/schedule.json",
      "enabled": true,
      "reminder": {
        "enabled": true,
        "webhookSecretName": "FEISHU_WEBHOOK_TAKEAWAY",
        "publicUrl": "https://drizeele2026.github.io/work/?org=takeaway"
      }
    }
  ]
}
```

字段说明：

- `slug`：URL 和文件路径用的稳定标识，只用小写字母、数字和短横线。
- `name`：页面上展示的组织名。
- `owners`：负责人标识，第一版只做说明和展示，不做强权限校验。
- `schedulePath`：该组织的排班文件路径。
- `enabled`：组织是否启用。
- `reminder.enabled`：是否参与每日提醒。
- `reminder.webhookSecretName`：GitHub Secret 名称，不存 webhook 原文。
- `reminder.publicUrl`：飞书卡片里的查看排班链接。

## 组织排班文件

每个组织一个 `schedule.json`。继续沿用现在的排班模型：

```json
{
  "version": 2,
  "updatedAt": "2026-07-04T10:02:52.436Z",
  "organization": {
    "slug": "takeaway",
    "name": "外卖业务组"
  },
  "current": {
    "teams": [
      {
        "name": "后端",
        "color": "green",
        "members": [
          { "name": "张三", "feishuOpenId": "ou_xxx" }
        ]
      }
    ]
  },
  "ruleVersions": [
    {
      "effectiveDate": "2026-07-04",
      "teams": [
        {
          "name": "后端",
          "color": "green",
          "startPerson": "张三",
          "members": [
            { "name": "张三", "feishuOpenId": "ou_xxx" }
          ]
        }
      ]
    }
  ]
}
```

这里不把提醒 webhook 放进组织排班文件。提醒配置放在 `organizations.json` 里，方便提醒脚本遍历组织时一次读完。

## 页面入口

公开页：

```text
/work/
/work/?org=default
/work/?org=takeaway
```

管理页：

```text
/work/admin/
/work/admin/?org=default
/work/admin/?org=takeaway
```

规则：

- URL 有 `org` 参数时，按这个组织加载。
- URL 没有 `org`，且只有一个默认组织时，打开默认组织。
- URL 没有 `org`，且有多个组织时，展示组织选择页。
- 组织不存在、停用或没有排班文件时，给中文提示。
- 管理页顶部显示当前组织名。
- 发布按钮只发布当前组织的 `schedule.json`。

为了兼容旧链接，`/work/` 可以继续默认打开当前排班。迁移后把当前数据放到 `default` 组织。

## 管理权限

第一版采用内部可信模式。

超级维护者：

- 手动维护 `data/organizations.json`。
- 手动创建 `data/orgs/{slug}/schedule.json`。
- 配置对应 GitHub Secret。
- 把 `/work/admin/?org={slug}` 发给组织负责人。

组织负责人：

- 打开自己组织的管理链接。
- 修改本组织团队、成员和 OpenID。
- 发布时只写本组织的 `schedule.json`。

需要明确一个边界：纯 GitHub Pages 静态站做不到真正的文件级权限隔离。GitHub PAT 通常是仓库级 `Contents: Read and write`。页面可以只让负责人看到自己的组织，但如果对方懂 GitHub API，理论上仍能改仓库里别的文件。

这在内部可信、小范围试用时可以接受。后面如果需要硬隔离，有两个升级路径：

- 每个组织一个仓库，各自用自己的 PAT。
- 增加轻量后端，负责人不直接拿仓库写权限，由后端校验身份和组织权限后代写文件。

## 每日提醒

每个组织独立提醒，发到自己的飞书群。

流程：

```text
GitHub Actions / cron-job.org 每天触发一次
  -> 读取 data/organizations.json
  -> 遍历 enabled && reminder.enabled 的组织
  -> 读取 data/orgs/{slug}/schedule.json
  -> 计算该组织今天值班人
  -> 用 process.env[webhookSecretName] 取 webhook
  -> 发到对应飞书群
  -> 写 data/orgs/{slug}/reminder-state.json
```

状态必须按组织拆开：

```text
data/orgs/default/reminder-state.json
data/orgs/takeaway/reminder-state.json
data/orgs/qa/reminder-state.json
```

这样 A 组织发过提醒，不会导致 B 组织被跳过。

GitHub Secrets 示例：

```text
FEISHU_WEBHOOK_DEFAULT
FEISHU_WEBHOOK_TAKEAWAY
FEISHU_WEBHOOK_QA
```

提醒脚本需要支持两个模式：

- 不传组织：遍历所有启用提醒的组织。
- 传 `--org takeaway`：只发送某个组织，方便测试。

`--dry-run` 也要支持多组织，输出每个组织会发送的卡片内容摘要，不打印 webhook。

## 数据加载

新增组织解析函数，职责尽量小：

- 读取组织索引。
- 根据 URL 参数找到当前组织。
- 拼出该组织排班文件路径。
- 处理默认组织和组织不存在的提示。

排班计算函数继续接收单个 `schedule` 对象。也就是说，`schedule-utils.js` 尽量不关心多组织，只管“给我一份排班文件，我算某天谁值班”。

这样边界清楚：

```text
组织选择层
  负责选哪个 schedule.json

排班计算层
  负责根据 schedule.json 算排班

发布层
  负责把当前组织的 schedule.json 写回 GitHub

提醒层
  负责遍历组织并逐个发送
```

## 迁移方案

当前数据：

```text
data/schedule.json
data/reminder-state.json
```

迁移后：

```text
data/organizations.json
data/orgs/default/schedule.json
data/orgs/default/reminder-state.json
```

迁移步骤：

1. 新建 `data/organizations.json`，创建 `default` 组织。
2. 把现有 `data/schedule.json` 复制成 `data/orgs/default/schedule.json`。
3. 在默认组织排班文件里补 `organization.slug` 和 `organization.name`。
4. 把 `data/reminder-state.json` 复制成 `data/orgs/default/reminder-state.json`。
5. 页面加载逻辑优先读组织文件。
6. 短期保留旧 `data/schedule.json` 作为兜底。
7. 稳定后再决定是否删除旧文件。

旧链接兼容：

```text
/work/
  -> default 组织

/work/admin/
  -> default 组织管理页
```

新组织上线流程：

1. 超级维护者新增 `data/orgs/{slug}/schedule.json`。
2. 在 `data/organizations.json` 加组织记录。
3. 在 GitHub Secrets 配置该组织 webhook。
4. 本地 dry-run 验证提醒。
5. 把 `/work/?org={slug}` 和 `/work/admin/?org={slug}` 发给负责人。

## 错误处理

公开页：

- 组织不存在：提示“这个组织不存在或已停用”。
- 排班文件不存在：提示“这个组织还没有排班数据”。
- 没有规则版本也没有成员：提示“请先维护团队成员并发布”。

管理页：

- 没带 `org` 且有多个组织：先选择组织。
- 组织停用：只读展示，不允许发布。
- 发布时组织文件被别人更新：提示重新加载后再发布，避免覆盖。
- GitHub Token 缺失：沿用现有中文提示。

提醒脚本：

- 单个组织失败时记录错误，继续处理其他组织。
- 最终如果有组织失败，整体退出非 0，方便 GitHub Actions 暴露失败。
- 缺少某个组织 webhook secret 时，只跳过该组织并报清楚组织名和 secret 名。
- 不打印 webhook 原文。
- 每个组织独立去重。

## 测试范围

数据和纯函数：

- URL `org` 参数能找到正确组织。
- 没有 `org` 时能回到默认组织。
- 停用组织不会被公开页和提醒脚本使用。
- 单个组织的排班计算结果和迁移前一致。

管理页：

- `/admin/?org=default` 只加载默认组织。
- `/admin/?org=takeaway` 只加载外卖业务组。
- 发布时只写当前组织的 `schedule.json`。
- 多组织时不误写 `data/schedule.json`。

提醒脚本：

- 不传 `--org` 时遍历所有启用提醒的组织。
- `--org takeaway` 只处理外卖业务组。
- A 组织已发送不会影响 B 组织。
- 缺少某个 webhook secret 时不影响其他组织。
- dry-run 不写状态、不发消息。

兼容：

- `/work/` 还能打开默认组织。
- `/work/admin/` 还能打开默认组织管理页。
- 旧 `data/schedule.json` 存在时可兜底读取。

## 分阶段落地

第一阶段：数据边界

- 新增组织索引。
- 迁移默认组织数据。
- 页面支持 `org` 参数读取不同文件。
- 发布只写当前组织文件。

第二阶段：提醒拆分

- 提醒脚本遍历组织。
- 每组织独立 webhook secret。
- 每组织独立 reminder-state。
- 支持 `--org` 和多组织 dry-run。

第三阶段：体验补齐

- 无 `org` 时展示组织选择页。
- 管理页显示当前组织名和停用状态。
- README 补充多组织使用说明。

第四阶段：权限升级，按需要做

- 如果内部可信不够，再选“每组织一个仓库”或“轻量后端代写 GitHub”。
- 到这一步才需要把“组织”升级成真正租户。

## 设计判断

这版设计先解决数据隔离和提醒隔离，不急着做完整权限系统。

原因很直接：现在项目的核心优势是简单。只要还是 GitHub Pages 静态站，就很难做真正权限。与其在前端假装有强权限，不如把边界说清楚，先用可信模式跑起来。

文件按组织拆开后，后续升级也顺：

- 要做后端，只要把“发布层”换成后端接口。
- 要做每组织仓库，只要把 `schedulePath` 换成仓库信息。
- 要做创建组织 UI，也只是写 `organizations.json` 和初始化组织目录。

所以第一版叫“组织空间”，不要叫“租户”。等有登录、鉴权、审计、组织生命周期以后，再考虑租户模型。
