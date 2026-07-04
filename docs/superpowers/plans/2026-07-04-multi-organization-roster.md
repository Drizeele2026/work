# Multi-Organization Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前单组织排班工具改成支持多个组织空间，每个组织独立排班、独立发布、独立飞书提醒。

**Architecture:** 新增组织索引层，先根据 URL 或提醒参数选出组织，再把该组织的 `schedule.json` 交给现有排班计算函数。排班算法继续只处理单份 schedule，发布层和提醒层负责选择文件路径。默认组织沿用现有 `FEISHU_WEBHOOK`，避免当前提醒配置失效。

**Tech Stack:** 静态 HTML、原生 JavaScript、Node.js ESM 脚本、GitHub Pages、GitHub Actions、GitHub Contents API、node:test。

## Global Constraints

- 所有用户可见文案、错误提示、文档默认使用中文。
- 保持 GitHub Pages 静态站，不引入后端、数据库或登录体系。
- 第一版只做内部可信模式和页面软隔离，不承诺 GitHub PAT 文件级硬隔离。
- 继续复用 `current.teams` 和 `ruleVersions` 排班模型，不重写排班算法。
- 每个组织的提醒状态独立保存，不能互相影响。
- 不打印 webhook、token、请求头或 secret 原文。
- 新增组织时，GitHub Secret 需要在 workflow `env` 里显式暴露给 Node 脚本。
- 代码注释使用中文，只有 API 字段、协议字段和现有英文标识保持英文。
- 前端改动后必须跑脚本检查，并用浏览器验证真实页面、console 和布局。

---

## File Structure

- Create: `organization-utils.js`
  - 组织索引的纯函数。负责规范化 `slug`、解析组织索引、选择当前组织、构造相对数据路径。
  - 同时支持浏览器全局 `window.DutyRosterOrganizations` 和 Node `module.exports`。

- Create: `scripts/organization-utils.test.mjs`
  - 覆盖组织选择、默认组织、停用组织、legacy fallback 和路径拼接。

- Create: `data/organizations.json`
  - 组织索引。第一版只有 `default` 组织。

- Create: `data/orgs/default/schedule.json`
  - 从现有 `data/schedule.json` 迁移来的默认组织排班。

- Create: `data/orgs/default/reminder-state.json`
  - 从现有 `data/reminder-state.json` 迁移来的默认组织提醒去重状态。

- Modify: `index.html`
  - 引入 `organization-utils.js`。
  - 根据 `?org=` 选择组织。
  - 公开页读取当前组织的排班文件。
  - 文案显示当前组织名。

- Modify: `admin/index.html`
  - 引入 `../organization-utils.js`。
  - 根据 `?org=` 选择组织。
  - 管理页只读取和发布当前组织的排班文件。
  - 发布成功文案显示当前组织路径。

- Modify: `scripts/send-duty-reminder.mjs`
  - 支持遍历 `data/organizations.json`。
  - 支持 `--org slug` 单组织发送。
  - 每组织独立 webhook、publicUrl、reminder-state。
  - 保留 `SCHEDULE_PATH` 单文件测试入口。

- Modify: `scripts/send-duty-reminder.test.mjs`
  - 增加多组织提醒、单组织提醒、缺少 webhook、独立状态文件测试。
  - 保留现有单文件测试。

- Modify: `.github/workflows/duty-reminder.yml`
  - 暴露 `FEISHU_WEBHOOK` 给默认组织。
  - 提交 `data/orgs/*/reminder-state.json`。
  - 保留 `workflow_dispatch` 和 `force`。

- Modify: `scripts/verify-readonly-layout.mjs`
  - 更新 README 和 workflow 的静态断言。

- Create: `scripts/verify-multi-organization.mjs`
  - 静态检查多组织关键结构，避免回退到写死 `data/schedule.json`。

- Modify: `README.md`
  - 补充多组织入口、默认组织、新组织上线、提醒 secret 映射。

---

### Task 1: 组织索引纯函数和默认组织数据

**Files:**
- Create: `organization-utils.js`
- Create: `scripts/organization-utils.test.mjs`
- Create: `data/organizations.json`
- Create: `data/orgs/default/schedule.json`
- Create: `data/orgs/default/reminder-state.json`
- Modify: `data/orgs/default/schedule.json`

**Interfaces:**
- Consumes: 现有 `data/schedule.json`、`data/reminder-state.json`
- Produces:
  - `DutyRosterOrganizations.normalizeOrgSlug(value: unknown): string`
  - `DutyRosterOrganizations.normalizeOrganizationIndex(document: object | null): { version: number, defaultOrg: string, organizations: Array<Organization> }`
  - `DutyRosterOrganizations.resolveOrganization(document: object | null, requestedSlug: string, options?: { allowLegacy?: boolean }): { organization: Organization | null, index: object, reason: string, error: string }`
  - `DutyRosterOrganizations.relativeDataPath(path: string, isAdminRoute: boolean): string`
  - `DutyRosterOrganizations.organizationStatePath(organization: Organization): string`

- [ ] **Step 1: 写失败测试**

创建 `scripts/organization-utils.test.mjs`：

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../organization-utils.js", import.meta.url), "utf8");
const context = { window: {}, console, module: { exports: {} } };
vm.createContext(context);
vm.runInContext(source, context);
const orgUtils = context.module.exports;

test("normalizeOrgSlug 只保留 URL 和路径安全字符", () => {
  assert.equal(orgUtils.normalizeOrgSlug(" 外卖_业务组 "), "org");
  assert.equal(orgUtils.normalizeOrgSlug("TakeAway-Team_01"), "takeaway-team-01");
  assert.equal(orgUtils.normalizeOrgSlug("qa"), "qa");
});

test("resolveOrganization 没有 org 时使用 defaultOrg", () => {
  const result = orgUtils.resolveOrganization({
    version: 1,
    defaultOrg: "default",
    organizations: [
      { slug: "default", name: "默认组织", schedulePath: "data/orgs/default/schedule.json", enabled: true },
      { slug: "takeaway", name: "外卖业务组", schedulePath: "data/orgs/takeaway/schedule.json", enabled: true }
    ]
  }, "");

  assert.equal(result.error, "");
  assert.equal(result.organization.slug, "default");
  assert.equal(result.organization.name, "默认组织");
});

test("resolveOrganization 按请求 slug 返回组织", () => {
  const result = orgUtils.resolveOrganization({
    version: 1,
    defaultOrg: "default",
    organizations: [
      { slug: "default", name: "默认组织", schedulePath: "data/orgs/default/schedule.json", enabled: true },
      { slug: "takeaway", name: "外卖业务组", schedulePath: "data/orgs/takeaway/schedule.json", enabled: true }
    ]
  }, "takeaway");

  assert.equal(result.error, "");
  assert.equal(result.organization.slug, "takeaway");
  assert.equal(result.organization.schedulePath, "data/orgs/takeaway/schedule.json");
});

test("resolveOrganization 停用组织不可用", () => {
  const result = orgUtils.resolveOrganization({
    version: 1,
    defaultOrg: "default",
    organizations: [
      { slug: "qa", name: "测试中心", schedulePath: "data/orgs/qa/schedule.json", enabled: false }
    ]
  }, "qa");

  assert.equal(result.organization, null);
  assert.match(result.error, /测试中心/);
  assert.match(result.error, /已停用/);
});

test("resolveOrganization 没有索引时可回退旧 schedule 文件", () => {
  const result = orgUtils.resolveOrganization(null, "", { allowLegacy: true });

  assert.equal(result.error, "");
  assert.equal(result.reason, "legacy");
  assert.equal(result.organization.slug, "default");
  assert.equal(result.organization.schedulePath, "data/schedule.json");
  assert.equal(result.organization.reminder.webhookSecretName, "FEISHU_WEBHOOK");
});

test("relativeDataPath 管理页自动回到站点根目录", () => {
  assert.equal(orgUtils.relativeDataPath("data/orgs/default/schedule.json", false), "data/orgs/default/schedule.json");
  assert.equal(orgUtils.relativeDataPath("data/orgs/default/schedule.json", true), "../data/orgs/default/schedule.json");
});

test("organizationStatePath 和 schedule 文件同目录", () => {
  assert.equal(
    orgUtils.organizationStatePath({ schedulePath: "data/orgs/takeaway/schedule.json" }),
    "data/orgs/takeaway/reminder-state.json"
  );
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:

```bash
node --test scripts/organization-utils.test.mjs
```

Expected: FAIL，报错包含 `ENOENT` 或 `organization-utils.js` 不存在。

- [ ] **Step 3: 实现 `organization-utils.js`**

创建 `organization-utils.js`：

```js
(function (global) {
  const ORGANIZATIONS_PATH = "data/organizations.json";
  const LEGACY_SCHEDULE_PATH = "data/schedule.json";
  const LEGACY_WEBHOOK_SECRET = "FEISHU_WEBHOOK";

  function normalizeOrgSlug(value) {
    const raw = String(value || "").trim().toLowerCase().replace(/_/g, "-");
    const ascii = raw.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    return ascii || "org";
  }

  function normalizeOwners(owners) {
    return (Array.isArray(owners) ? owners : [])
      .map((owner) => String(owner || "").trim())
      .filter(Boolean);
  }

  function normalizeReminder(reminder, slug) {
    const source = reminder && typeof reminder === "object" ? reminder : {};
    return {
      enabled: source.enabled !== false,
      webhookSecretName: String(source.webhookSecretName || "").trim(),
      publicUrl: String(source.publicUrl || `https://drizeele2026.github.io/work/?org=${slug}`).trim()
    };
  }

  function normalizeOrganization(organization, index = 0) {
    const rawSlug = organization?.slug || (index === 0 ? "default" : `org-${index + 1}`);
    const slug = normalizeOrgSlug(rawSlug);
    const name = String(organization?.name || (slug === "default" ? "默认组织" : slug)).trim();
    return {
      slug,
      name,
      owners: normalizeOwners(organization?.owners),
      schedulePath: String(organization?.schedulePath || `data/orgs/${slug}/schedule.json`).trim(),
      enabled: organization?.enabled !== false,
      reminder: normalizeReminder(organization?.reminder, slug)
    };
  }

  function normalizeOrganizationIndex(document) {
    const organizations = (Array.isArray(document?.organizations) ? document.organizations : [])
      .map(normalizeOrganization)
      .filter((organization) => organization.slug && organization.schedulePath);
    const defaultOrg = normalizeOrgSlug(document?.defaultOrg || organizations[0]?.slug || "default");
    return {
      version: Number(document?.version) || 1,
      defaultOrg,
      organizations
    };
  }

  function createLegacyOrganization() {
    return {
      slug: "default",
      name: "默认组织",
      owners: [],
      schedulePath: LEGACY_SCHEDULE_PATH,
      enabled: true,
      reminder: {
        enabled: true,
        webhookSecretName: LEGACY_WEBHOOK_SECRET,
        publicUrl: "https://drizeele2026.github.io/work/"
      }
    };
  }

  function findOrganization(index, slug) {
    return (index.organizations || []).find((organization) => organization.slug === slug) || null;
  }

  function resolveOrganization(document, requestedSlug, options = {}) {
    const index = normalizeOrganizationIndex(document);
    if (!index.organizations.length && options.allowLegacy) {
      return { organization: createLegacyOrganization(), index, reason: "legacy", error: "" };
    }

    const requested = requestedSlug ? normalizeOrgSlug(requestedSlug) : "";
    const slug = requested || index.defaultOrg;
    const organization = findOrganization(index, slug);
    if (!organization) {
      return { organization: null, index, reason: "missing", error: `组织 ${requested || slug} 不存在。` };
    }
    if (!organization.enabled) {
      return { organization: null, index, reason: "disabled", error: `组织【${organization.name}】已停用。` };
    }
    return { organization, index, reason: requested ? "requested" : "default", error: "" };
  }

  function relativeDataPath(path, isAdminRoute) {
    const clean = String(path || "").replace(/^\/+/, "");
    return isAdminRoute ? `../${clean}` : clean;
  }

  function organizationStatePath(organization) {
    const schedulePath = String(organization?.schedulePath || "").replace(/\/+$/, "");
    const slashIndex = schedulePath.lastIndexOf("/");
    const directory = slashIndex >= 0 ? schedulePath.slice(0, slashIndex) : ".";
    return `${directory}/reminder-state.json`;
  }

  const api = {
    ORGANIZATIONS_PATH,
    LEGACY_SCHEDULE_PATH,
    normalizeOrgSlug,
    normalizeOrganization,
    normalizeOrganizationIndex,
    resolveOrganization,
    relativeDataPath,
    organizationStatePath
  };

  global.DutyRosterOrganizations = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
```

- [ ] **Step 4: 创建默认组织数据**

Run:

```bash
mkdir -p data/orgs/default
cp data/schedule.json data/orgs/default/schedule.json
cp data/reminder-state.json data/orgs/default/reminder-state.json
```

再用 `apply_patch` 给 `data/orgs/default/schedule.json` 顶层补 `organization`：

```json
"organization": {
  "slug": "default",
  "name": "默认组织"
},
```

位置：放在 `"updatedAt"` 后、`"current"` 前。

创建 `data/organizations.json`：

```json
{
  "version": 1,
  "defaultOrg": "default",
  "organizations": [
    {
      "slug": "default",
      "name": "默认组织",
      "owners": [],
      "schedulePath": "data/orgs/default/schedule.json",
      "enabled": true,
      "reminder": {
        "enabled": true,
        "webhookSecretName": "FEISHU_WEBHOOK",
        "publicUrl": "https://drizeele2026.github.io/work/"
      }
    }
  ]
}
```

- [ ] **Step 5: 跑测试确认通过**

Run:

```bash
node --test scripts/organization-utils.test.mjs
```

Expected: PASS。

- [ ] **Step 6: 提交**

Run:

```bash
git add organization-utils.js scripts/organization-utils.test.mjs data/organizations.json data/orgs/default/schedule.json data/orgs/default/reminder-state.json
git commit -m "feat: add organization roster data"
```

---

### Task 2: 公开页和管理页按组织读取排班

**Files:**
- Modify: `index.html`
- Modify: `admin/index.html`
- Create: `scripts/verify-multi-organization.mjs`

**Interfaces:**
- Consumes:
  - `DutyRosterOrganizations.resolveOrganization(document, requestedSlug, { allowLegacy: true })`
  - `DutyRosterOrganizations.relativeDataPath(path, isAdminRoute)`
- Produces:
  - Browser global state `currentOrganization`
  - `getCurrentSchedulePath(): string`
  - `getScheduleUrl(): string`
  - `loadCurrentOrganization(): Promise<void>`

- [ ] **Step 1: 写失败的静态验证脚本**

创建 `scripts/verify-multi-organization.mjs`：

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const publicHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
const adminHtml = await readFile(new URL("../admin/index.html", import.meta.url), "utf8");
const workflow = await readFile(new URL("../.github/workflows/duty-reminder.yml", import.meta.url), "utf8");
const organizations = JSON.parse(await readFile(new URL("../data/organizations.json", import.meta.url), "utf8"));

function verifyPage(html, label, scriptPath) {
  assert.match(html, new RegExp(`<script src="${scriptPath}"></script>`), `${label} 需要引入 organization-utils.js`);
  assert.match(html, /const orgUtils = window\.DutyRosterOrganizations;/, `${label} 需要使用组织工具`);
  assert.match(html, /let currentOrganization = null;/, `${label} 需要保存当前组织`);
  assert.match(html, /async function loadCurrentOrganization\(\)/, `${label} 需要加载当前组织`);
  assert.match(html, /function getCurrentSchedulePath\(\)/, `${label} 需要按组织返回 schedule 路径`);
  assert.match(html, /orgUtils\.relativeDataPath\(getCurrentSchedulePath\(\), isAdminRoute\(\)\)/, `${label} 读取排班时不能写死 data/schedule.json`);
  assert.doesNotMatch(html, /const SCHEDULE_FILE = "data\/schedule\.json";/, `${label} 不应再用固定 SCHEDULE_FILE`);
}

verifyPage(publicHtml, "公开页", "./organization-utils.js");
verifyPage(adminHtml, "管理页", "../organization-utils.js");

assert.equal(organizations.defaultOrg, "default");
assert.equal(organizations.organizations[0].schedulePath, "data/orgs/default/schedule.json");
assert.match(workflow, /FEISHU_WEBHOOK:/, "workflow 需要继续暴露默认组织使用的 FEISHU_WEBHOOK");

console.log("多组织静态检查通过");
```

- [ ] **Step 2: 跑验证确认失败**

Run:

```bash
node scripts/verify-multi-organization.mjs
```

Expected: FAIL，提示页面未引入 `organization-utils.js` 或仍有固定 `SCHEDULE_FILE`。

- [ ] **Step 3: 给页面加入脚本引用**

在 `index.html` 里，找到已有工具脚本区域，把组织工具放在 `schedule-utils.js` 前：

```html
<script src="./member-utils.js"></script>
<script src="./organization-utils.js"></script>
<script src="./schedule-utils.js"></script>
```

在 `admin/index.html` 里对应改成：

```html
<script src="../member-utils.js"></script>
<script src="../organization-utils.js"></script>
<script src="../schedule-utils.js"></script>
```

- [ ] **Step 4: 替换浏览器脚本里的固定排班路径**

在两个 HTML 的主脚本里，把：

```js
const SCHEDULE_FILE = "data/schedule.json";
```

替换为：

```js
const orgUtils = window.DutyRosterOrganizations;
const ORGANIZATIONS_FILE = orgUtils.ORGANIZATIONS_PATH;
let organizationIndexDocument = null;
let currentOrganization = null;
```

把现有 `getScheduleUrl()` 和 `getPublicPageUrl()` 替换成：

```js
function getRequestedOrgSlug() {
  return new URLSearchParams(window.location.search).get("org") || "";
}

function getCurrentSchedulePath() {
  return currentOrganization?.schedulePath || orgUtils.LEGACY_SCHEDULE_PATH;
}

function getScheduleUrl() {
  return orgUtils.relativeDataPath(getCurrentSchedulePath(), isAdminRoute());
}

function getOrganizationsUrl() {
  return orgUtils.relativeDataPath(ORGANIZATIONS_FILE, isAdminRoute());
}

function getPublicPageUrl() {
  const base = isAdminRoute() ? "../" : "./";
  if (!currentOrganization || currentOrganization.slug === "default") return base;
  return `${base}?org=${encodeURIComponent(currentOrganization.slug)}`;
}
```

- [ ] **Step 5: 新增当前组织加载函数**

在 `loadRemoteSchedulePreview()` 前加入：

```js
async function loadCurrentOrganization() {
  try {
    const response = await fetch(`${getOrganizationsUrl()}?_=${Date.now()}`, { cache: "no-store" });
    if (response.ok) {
      organizationIndexDocument = await response.json();
    }
  } catch (error) {
    organizationIndexDocument = null;
  }

  const result = orgUtils.resolveOrganization(organizationIndexDocument, getRequestedOrgSlug(), { allowLegacy: true });
  if (result.error) {
    throw new Error(result.error);
  }
  currentOrganization = result.organization;
}
```

- [ ] **Step 6: boot 时先加载组织，再加载排班**

在 `boot()` 里，`const remotePreview = await loadRemoteSchedulePreview();` 前加入：

```js
try {
  await loadCurrentOrganization();
} catch (error) {
  showError(error.message || "组织加载失败。");
  applyViewState();
  syncTopbar();
  return;
}
```

同时把 `applyViewState()` 中品牌副标题替换成带组织名：

```js
const orgName = currentOrganization?.name || "默认组织";
$("brandSub").textContent = admin ? `管理排班 · ${orgName}` : `公开查看 · ${orgName}`;
```

- [ ] **Step 7: 跑验证确认通过**

Run:

```bash
node scripts/verify-multi-organization.mjs
node scripts/verify-clean-roster-model.mjs
node scripts/verify-readonly-layout.mjs
```

Expected: 三个脚本都 PASS。

- [ ] **Step 8: 提交**

Run:

```bash
git add index.html admin/index.html scripts/verify-multi-organization.mjs
git commit -m "feat: load roster by organization"
```

---

### Task 3: 管理页发布只写当前组织文件

**Files:**
- Modify: `index.html`
- Modify: `admin/index.html`
- Modify: `scripts/verify-multi-organization.mjs`

**Interfaces:**
- Consumes:
  - Task 2 的 `getCurrentSchedulePath()`
  - 现有 `buildScheduleDocument(state, remoteDocument)`
- Produces:
  - `loadGithubScheduleDocument(schedulePath?: string): Promise<{ sha: string | null, document: object | null }>`
  - `saveScheduleToGithub(preloadedRemote?: object | null): Promise<object>`

- [ ] **Step 1: 扩展失败验证**

在 `scripts/verify-multi-organization.mjs` 的 `verifyPage` 里追加断言：

```js
assert.match(html, /async function loadGithubScheduleDocument\(schedulePath = getCurrentSchedulePath\(\)\)/, `${label} GitHub 读取需要按当前组织路径`);
assert.match(html, /async function saveScheduleToGithub\(preloadedRemote = null\)/, `${label} GitHub 保存需要接受预加载远端文档`);
assert.match(html, /const contentsUrl = `\$\{repoApiBase\}\/contents\/\$\{schedulePath\}`;/, `${label} GitHub Contents API 需要使用组织 schedule 路径`);
assert.match(html, /同时提交到 \$\{settings\.repoSlug\}\/\$\{schedulePath\}/, `${label} 发布成功文案需要显示当前组织路径`);
```

- [ ] **Step 2: 跑验证确认失败**

Run:

```bash
node scripts/verify-multi-organization.mjs
```

Expected: FAIL，提示 GitHub 读取仍未按当前组织路径。

- [ ] **Step 3: 替换 `loadGithubScheduleDocument`**

在两个 HTML 中，把函数签名和路径构造改成：

```js
async function loadGithubScheduleDocument(schedulePath = getCurrentSchedulePath()) {
  const repoApiBase = getRepoApiBase();
  const contentsUrl = `${repoApiBase}/contents/${schedulePath}`;
  const response = await githubRequest(contentsUrl);
  if (response.status === 404) {
    return { sha: null, document: null };
  }
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error("GitHub 返回了无法解析的内容。");
    }
  }
  if (!response.ok) {
    throw new Error(payload?.message || `GitHub ${response.status}`);
  }
  if (!payload?.content) {
    return { sha: payload?.sha || null, document: null };
  }
  const decoded = decodeBase64Utf8(payload.content);
  let document = null;
  try {
    document = JSON.parse(decoded);
  } catch (error) {
    throw new Error("仓库里的 schedule.json 不是有效 JSON。");
  }
  return { sha: payload.sha || null, document };
}
```

- [ ] **Step 4: 替换 `saveScheduleToGithub`**

在两个 HTML 中，把 `saveScheduleToGithub` 改成：

```js
async function saveScheduleToGithub(preloadedRemote = null) {
  clearGithubMessage();
  if (!lastGeneratedState) {
    throw new Error("请先维护团队名单，再发布到公开页。");
  }
  const settings = readGithubSettings();
  const schedulePath = getCurrentSchedulePath();
  const repoApiBase = getRepoApiBase();
  const contentsUrl = `${repoApiBase}/contents/${schedulePath}`;
  const remote = preloadedRemote || await loadGithubScheduleDocument(schedulePath);

  const document = buildScheduleDocument(lastGeneratedState, remote.document);
  document.organization = {
    slug: currentOrganization?.slug || "default",
    name: currentOrganization?.name || "默认组织"
  };

  const body = {
    message: `chore: update ${document.organization.slug} roster rules ${todayDateKey()}`,
    content: encodeBase64Utf8(`${JSON.stringify(document, null, 2)}\n`)
  };
  if (remote.sha) body.sha = remote.sha;

  const response = await githubRequest(contentsUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result?.message || `GitHub ${response.status}`);
  }

  persistedMonth = lastGeneratedState.monthKey;
  pendingMonth = null;
  persistGithubSettings(settings);
  persistTeamConfigToStorage();
  if ($("notePersistence")) {
    $("notePersistence").textContent = `已发布值班规则；今天之前不主动改变，今天及以后按新规则顺排。`;
  }
  syncTopbar();
  setGithubMessage("ok", `已发布到公开页，同时提交到 ${settings.repoSlug}/${schedulePath}。`);
  return result;
}
```

- [ ] **Step 5: 确保发布前读取当前组织远端文件**

在 `handleTeamNextAction()` 中确认保留这段逻辑：

```js
const remote = settings.token
  ? await loadGithubScheduleDocument()
  : { sha: null, document: remoteScheduleDocument };
```

然后确认发布调用传入 remote：

```js
const result = await saveScheduleToGithub(remote);
```

公开页不是管理入口，这段逻辑不会被普通用户触发；两个 HTML 仍保持一致，避免 `/admin/` 和根页面脚本漂移。

- [ ] **Step 6: 跑验证**

Run:

```bash
node scripts/verify-multi-organization.mjs
node scripts/verify-clean-roster-model.mjs
node scripts/verify-readonly-layout.mjs
```

Expected: PASS。

- [ ] **Step 7: 提交**

Run:

```bash
git add index.html admin/index.html scripts/verify-multi-organization.mjs
git commit -m "feat: publish roster by organization"
```

---

### Task 4: 飞书提醒支持多组织

**Files:**
- Modify: `scripts/send-duty-reminder.mjs`
- Modify: `scripts/send-duty-reminder.test.mjs`

**Interfaces:**
- Consumes:
  - `organization-utils.js`
  - `organization.reminder.webhookSecretName`
  - `organization.reminder.publicUrl`
- Produces:
  - `loadOrganizationIndex(path?: string): Promise<object | null>`
  - `resolveReminderOrganizations(indexDocument: object | null, orgSlug: string): Array<Organization>`
  - `sendOrganizationReminder(organization: object, options: object): Promise<object>`
  - `main(argv?: string[], env?: object): Promise<object | Array<object>>`

- [ ] **Step 1: 写失败测试**

在 `scripts/send-duty-reminder.test.mjs` 末尾追加：

```js
async function setupMultiOrgTmp() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "duty-orgs-"));
  const defaultDir = path.join(dir, "data/orgs/default");
  const qaDir = path.join(dir, "data/orgs/qa");
  await fs.mkdir(defaultDir, { recursive: true });
  await fs.mkdir(qaDir, { recursive: true });

  const makeSchedule = (name, person) => ({
    version: 2,
    organization: { slug: name, name },
    current: {
      teams: [
        { name: "后端", color: "green", members: [person, "B"] }
      ]
    },
    ruleVersions: [
      {
        effectiveDate: "2026-06-20",
        teams: [
          { name: "后端", color: "green", startPerson: person, members: [person, "B"] }
        ]
      }
    ]
  });

  const defaultSchedulePath = path.join(defaultDir, "schedule.json");
  const qaSchedulePath = path.join(qaDir, "schedule.json");
  await fs.writeFile(defaultSchedulePath, JSON.stringify(makeSchedule("default", "张三")), "utf8");
  await fs.writeFile(qaSchedulePath, JSON.stringify(makeSchedule("qa", "李四")), "utf8");

  const organizationsPath = path.join(dir, "data/organizations.json");
  await fs.mkdir(path.dirname(organizationsPath), { recursive: true });
  await fs.writeFile(organizationsPath, JSON.stringify({
    version: 1,
    defaultOrg: "default",
    organizations: [
      {
        slug: "default",
        name: "默认组织",
        schedulePath: defaultSchedulePath,
        enabled: true,
        reminder: {
          enabled: true,
          webhookSecretName: "FEISHU_WEBHOOK",
          publicUrl: "https://example.com/default"
        }
      },
      {
        slug: "qa",
        name: "测试中心",
        schedulePath: qaSchedulePath,
        enabled: true,
        reminder: {
          enabled: true,
          webhookSecretName: "FEISHU_WEBHOOK_QA",
          publicUrl: "https://example.com/qa"
        }
      }
    ]
  }), "utf8");

  return { dir, organizationsPath, defaultDir, qaDir };
}

test("main：多组织普通触发分别发送并分别写状态", async () => {
  const { organizationsPath, defaultDir, qaDir } = await setupMultiOrgTmp();
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, text: async () => '{"code":0}' };
  };
  try {
    const result = await main([], {
      ORGANIZATIONS_PATH: organizationsPath,
      REMINDER_DATE: "2026-06-20T02:00:00Z",
      FEISHU_WEBHOOK: "https://example.com/default-hook",
      FEISHU_WEBHOOK_QA: "https://example.com/qa-hook"
    });

    assert.equal(result.length, 2);
    assert.deepEqual(calls.map((call) => call.url), [
      "https://example.com/default-hook",
      "https://example.com/qa-hook"
    ]);
    const defaultState = JSON.parse(await fs.readFile(path.join(defaultDir, "reminder-state.json"), "utf8"));
    const qaState = JSON.parse(await fs.readFile(path.join(qaDir, "reminder-state.json"), "utf8"));
    assert.equal(defaultState.lastSentDate, "2026-06-20");
    assert.equal(qaState.lastSentDate, "2026-06-20");
  } finally {
    globalThis.fetch = orig;
  }
});

test("main：--org 只发送指定组织", async () => {
  const { organizationsPath, defaultDir, qaDir } = await setupMultiOrgTmp();
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, text: async () => '{"code":0}' };
  };
  try {
    const result = await main(["--org", "qa"], {
      ORGANIZATIONS_PATH: organizationsPath,
      REMINDER_DATE: "2026-06-20T02:00:00Z",
      FEISHU_WEBHOOK: "https://example.com/default-hook",
      FEISHU_WEBHOOK_QA: "https://example.com/qa-hook"
    });

    assert.equal(result.length, 1);
    assert.equal(result[0].organization.slug, "qa");
    assert.deepEqual(calls.map((call) => call.url), ["https://example.com/qa-hook"]);
    await assert.rejects(() => fs.readFile(path.join(defaultDir, "reminder-state.json"), "utf8"));
    const qaState = JSON.parse(await fs.readFile(path.join(qaDir, "reminder-state.json"), "utf8"));
    assert.equal(qaState.lastSentDate, "2026-06-20");
  } finally {
    globalThis.fetch = orig;
  }
});

test("main：多组织 dry-run 不发送也不写状态", async () => {
  const { organizationsPath, defaultDir, qaDir } = await setupMultiOrgTmp();
  const orig = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("dry-run 不应该发送请求");
  };
  try {
    const result = await main(["--dry-run"], {
      ORGANIZATIONS_PATH: organizationsPath,
      REMINDER_DATE: "2026-06-20T02:00:00Z",
      FEISHU_WEBHOOK: "https://example.com/default-hook",
      FEISHU_WEBHOOK_QA: "https://example.com/qa-hook"
    });

    assert.equal(result.length, 2);
    await assert.rejects(() => fs.readFile(path.join(defaultDir, "reminder-state.json"), "utf8"));
    await assert.rejects(() => fs.readFile(path.join(qaDir, "reminder-state.json"), "utf8"));
  } finally {
    globalThis.fetch = orig;
  }
});

test("main：某组织缺少 webhook secret 时，其他组织仍会发送，最终抛出汇总错误", async () => {
  const { organizationsPath, defaultDir, qaDir } = await setupMultiOrgTmp();
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, text: async () => '{"code":0}' };
  };
  try {
    await assert.rejects(
      () => main([], {
        ORGANIZATIONS_PATH: organizationsPath,
        REMINDER_DATE: "2026-06-20T02:00:00Z",
        FEISHU_WEBHOOK: "https://example.com/default-hook"
      }),
      /测试中心.*FEISHU_WEBHOOK_QA/
    );
    assert.deepEqual(calls.map((call) => call.url), ["https://example.com/default-hook"]);
    const defaultState = JSON.parse(await fs.readFile(path.join(defaultDir, "reminder-state.json"), "utf8"));
    assert.equal(defaultState.lastSentDate, "2026-06-20");
    await assert.rejects(() => fs.readFile(path.join(qaDir, "reminder-state.json"), "utf8"));
  } finally {
    globalThis.fetch = orig;
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:

```bash
node --test scripts/send-duty-reminder.test.mjs
```

Expected: FAIL，提示多组织函数或行为不存在。

- [ ] **Step 3: 修改 imports 和常量**

在 `scripts/send-duty-reminder.mjs` 顶部改成：

```js
import fs from "node:fs/promises";
import path from "node:path";
import scheduleUtils from "../schedule-utils.js";
import organizationUtils from "../organization-utils.js";

const DEFAULT_SCHEDULE_PATH = "data/schedule.json";
const DEFAULT_STATE_PATH = "data/reminder-state.json";
const DEFAULT_ORGANIZATIONS_PATH = "data/organizations.json";
const DEFAULT_PUBLIC_URL = "https://drizeele2026.github.io/work/";
const TIME_ZONE = "Asia/Shanghai";
```

- [ ] **Step 4: 增加组织读取和选择函数**

放在 `loadSchedule` 后：

```js
export async function loadOrganizationIndex(path = DEFAULT_ORGANIZATIONS_PATH) {
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function parseArgValue(argv, name) {
  const prefix = `${name}=`;
  const inline = argv.find((item) => item.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1] || "";
  return "";
}

export function resolveReminderOrganizations(indexDocument, orgSlug = "") {
  const index = organizationUtils.normalizeOrganizationIndex(indexDocument);
  const requested = organizationUtils.normalizeOrgSlug(orgSlug || "");
  const enabledOrganizations = index.organizations.filter((organization) =>
    organization.enabled && organization.reminder?.enabled !== false
  );

  if (orgSlug) {
    const organization = enabledOrganizations.find((item) => item.slug === requested);
    if (!organization) throw new Error(`组织 ${orgSlug} 不存在、已停用或未启用提醒。`);
    return [organization];
  }

  return enabledOrganizations;
}

function statePathForOrganization(organization) {
  return organizationUtils.organizationStatePath(organization);
}

function publicUrlForOrganization(organization) {
  return organization.reminder?.publicUrl || DEFAULT_PUBLIC_URL;
}

function webhookForOrganization(organization, env) {
  const secretName = organization.reminder?.webhookSecretName || "FEISHU_WEBHOOK";
  const webhook = env[secretName];
  if (!webhook) {
    throw new Error(`组织【${organization.name}】缺少 webhook secret：${secretName}`);
  }
  return webhook;
}
```

- [ ] **Step 5: 抽出单组织发送函数**

放在 `postFeishuMessage` 后：

```js
export async function sendOrganizationReminder(organization, options = {}) {
  const {
    dateInfo,
    dryRun = false,
    force = false,
    env = process.env,
    fetchImpl = globalThis.fetch
  } = options;

  const schedule = await loadSchedule(organization.schedulePath);
  const assignment = findAssignmentForDate(schedule, dateInfo.dateKey);
  const upcoming = collectUpcoming(schedule, dateInfo.dateKey, 3);
  const message = buildFeishuCardMessage({
    dateInfo,
    assignment,
    upcoming,
    publicUrl: publicUrlForOrganization(organization)
  });

  if (dryRun) {
    console.log(JSON.stringify({
      organization: organization.slug,
      name: organization.name,
      message
    }, null, 2));
    return { organization, dryRun: true, message };
  }

  const statePath = statePathForOrganization(organization);
  const state = await loadReminderState(statePath);
  if (!force && hasSentOn(state, dateInfo.dateKey)) {
    console.log(`${organization.name} ${dateInfo.dateKey} 今天已发送过值班提醒，跳过。`);
    return { organization, skipped: true, dateKey: dateInfo.dateKey };
  }

  await postFeishuMessage(webhookForOrganization(organization, env), message, fetchImpl);
  if (!force) {
    await writeReminderState(statePath, dateInfo.dateKey);
  }
  console.log(force
    ? `已强制发送 ${organization.name} ${dateInfo.dateKey}（force：未写入去重状态）。`
    : `已发送 ${organization.name} ${dateInfo.dateKey} 值班提醒。`);
  return { organization, message };
}
```

- [ ] **Step 6: 保留单文件兼容入口**

把当前 `main` 的主体提取为：

```js
async function runSingleScheduleReminder({ dryRun, force, schedulePath, statePath, publicUrl, dateInfo, env }) {
  if (dryRun) {
    const schedule = await loadSchedule(schedulePath);
    const assignment = findAssignmentForDate(schedule, dateInfo.dateKey);
    const upcoming = collectUpcoming(schedule, dateInfo.dateKey, 3);
    const message = buildFeishuCardMessage({ dateInfo, assignment, upcoming, publicUrl });
    console.log(JSON.stringify(message, null, 2));
    return message;
  }

  const state = await loadReminderState(statePath);
  if (!force && hasSentOn(state, dateInfo.dateKey)) {
    console.log(`${dateInfo.dateKey} 今天已发送过值班提醒，跳过。`);
    return { skipped: true, dateKey: dateInfo.dateKey };
  }

  const schedule = await loadSchedule(schedulePath);
  const assignment = findAssignmentForDate(schedule, dateInfo.dateKey);
  const upcoming = collectUpcoming(schedule, dateInfo.dateKey, 3);
  const message = buildFeishuCardMessage({ dateInfo, assignment, upcoming, publicUrl });

  await postFeishuMessage(env.FEISHU_WEBHOOK, message);
  if (!force) {
    await writeReminderState(statePath, dateInfo.dateKey);
  }
  console.log(force
    ? `已强制发送 ${dateInfo.dateKey}（force：未写入去重状态）。`
    : `已发送 ${dateInfo.dateKey} 值班提醒。`);
  return message;
}
```

- [ ] **Step 7: 替换 main**

把 `main` 改成：

```js
export async function main(argv = process.argv.slice(2), env = process.env) {
  const dryRun = argv.includes("--dry-run");
  const force = argv.includes("--force") || env.FORCE_SEND === "1";
  const orgSlug = parseArgValue(argv, "--org") || env.REMINDER_ORG || "";
  const schedulePath = env.SCHEDULE_PATH || "";
  const statePath = env.REMINDER_STATE_PATH || DEFAULT_STATE_PATH;
  const publicUrl = env.PUBLIC_ROSTER_URL || DEFAULT_PUBLIC_URL;
  const dateInfo = formatBeijingDate(env.REMINDER_DATE ? new Date(env.REMINDER_DATE) : new Date());

  if (schedulePath) {
    return runSingleScheduleReminder({
      dryRun,
      force,
      schedulePath,
      statePath,
      publicUrl,
      dateInfo,
      env
    });
  }

  const organizationsPath = env.ORGANIZATIONS_PATH || DEFAULT_ORGANIZATIONS_PATH;
  const indexDocument = await loadOrganizationIndex(organizationsPath);
  const organizations = resolveReminderOrganizations(indexDocument, orgSlug);
  if (!organizations.length) {
    console.log("没有启用提醒的组织，跳过。");
    return [];
  }

  const results = [];
  const errors = [];
  for (const organization of organizations) {
    try {
      results.push(await sendOrganizationReminder(organization, { dateInfo, dryRun, force, env }));
    } catch (error) {
      errors.push(`${organization.name}：${error.message || error}`);
    }
  }

  if (errors.length) {
    throw new Error(errors.join("\n"));
  }
  return results;
}
```

- [ ] **Step 8: 跑测试**

Run:

```bash
node --test scripts/send-duty-reminder.test.mjs
node --test scripts/organization-utils.test.mjs scripts/schedule-utils.test.mjs
```

Expected: PASS。

- [ ] **Step 9: 提交**

Run:

```bash
git add scripts/send-duty-reminder.mjs scripts/send-duty-reminder.test.mjs
git commit -m "feat: send reminders by organization"
```

---

### Task 5: GitHub Actions 和文档同步

**Files:**
- Modify: `.github/workflows/duty-reminder.yml`
- Modify: `scripts/verify-readonly-layout.mjs`
- Modify: `scripts/verify-multi-organization.mjs`
- Modify: `README.md`

**Interfaces:**
- Consumes:
  - Task 4 的多组织提醒脚本
  - `data/orgs/*/reminder-state.json`
- Produces:
  - workflow 能提交多个组织的提醒状态
  - README 说明多组织使用方式

- [ ] **Step 1: 扩展静态验证**

在 `scripts/verify-multi-organization.mjs` 末尾追加：

```js
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
assert.match(workflow, /FEISHU_WEBHOOK:\s*\$\{\{ secrets\.FEISHU_WEBHOOK \}\}/, "workflow 需要暴露默认组织 webhook");
assert.match(workflow, /git status --porcelain data\/orgs/, "workflow 需要检查组织提醒状态");
assert.match(workflow, /git add data\/orgs\/\*\/reminder-state\.json/, "workflow 需要提交组织提醒状态");
assert.match(readme, /多组织/, "README 需要说明多组织");
assert.match(readme, /\/work\/\?org=/, "README 需要说明按 org 查看排班");
assert.match(readme, /data\/organizations\.json/, "README 需要说明组织索引文件");
```

在 `scripts/verify-readonly-layout.mjs` 里，把 README 对 `data/schedule.json` 的单文件强表述断言改成：

```js
assert.match(readme, /## 系统实现原理[\s\S]*GitHub Pages[\s\S]*GitHub Actions[\s\S]*\.github\/workflows\/duty-reminder\.yml/, "README 的系统实现原理需要写清楚用到的 GitHub Pages、Actions 和 workflow");
assert.match(readme, /data\/organizations\.json[\s\S]*data\/orgs\/\{slug\}\/schedule\.json/, "README 需要说明多组织数据文件");
```

- [ ] **Step 2: 跑验证确认失败**

Run:

```bash
node scripts/verify-multi-organization.mjs
node scripts/verify-readonly-layout.mjs
```

Expected: FAIL，提示 workflow 和 README 尚未更新。

- [ ] **Step 3: 更新 workflow**

把 `.github/workflows/duty-reminder.yml` 的提醒步骤 env 改成：

```yaml
        env:
          FEISHU_WEBHOOK: ${{ secrets.FEISHU_WEBHOOK }}
          FORCE_SEND: ${{ (github.event_name == 'workflow_dispatch' && inputs.force) && '1' || '0' }}
```

新增组织时，在这里追加：

```yaml
          FEISHU_WEBHOOK_TAKEAWAY: ${{ secrets.FEISHU_WEBHOOK_TAKEAWAY }}
```

把提交状态步骤改成：

```yaml
      - name: Commit reminder state
        run: |
          if [ -n "$(git status --porcelain data/orgs)" ]; then
            git config user.name "github-actions[bot]"
            git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
            git add data/orgs/*/reminder-state.json
            git commit -m "chore: duty reminder sent $(TZ=Asia/Shanghai date +%Y-%m-%d)"
            git pull --rebase --autostash
            git push
          else
            echo "状态文件无变化（今天已发过或本次未发送），跳过提交。"
          fi
```

- [ ] **Step 4: 更新 README**

把“系统实现原理”和“数据文件”相关段落改成这些要点：

```markdown
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
```

把飞书提醒段落补成：

```markdown
每日提醒会读取 `data/organizations.json`，遍历已启用提醒的组织。每个组织用自己的 `data/orgs/{slug}/schedule.json` 算当天值班人，再发到该组织配置的飞书群。

默认组织继续使用现有 Secret：

```text
FEISHU_WEBHOOK
```

新增组织时，需要在 `data/organizations.json` 填 `reminder.webhookSecretName`，在 GitHub Secrets 创建同名 secret，并在 `.github/workflows/duty-reminder.yml` 的提醒步骤 env 中暴露它。
```

- [ ] **Step 5: 跑验证**

Run:

```bash
node scripts/verify-multi-organization.mjs
node scripts/verify-readonly-layout.mjs
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/duty-reminder.yml"); puts "workflow yaml ok"'
```

Expected: PASS，Ruby 输出 `workflow yaml ok`。

- [ ] **Step 6: 提交**

Run:

```bash
git add .github/workflows/duty-reminder.yml README.md scripts/verify-readonly-layout.mjs scripts/verify-multi-organization.mjs
git commit -m "docs: document multi-organization usage"
```

---

### Task 6: 全量验证和浏览器检查

**Files:**
- Modify: only if verification finds a bug

**Interfaces:**
- Consumes: Tasks 1-5 的全部改动
- Produces: 可交付的多组织基础能力

- [ ] **Step 1: 跑所有 Node 测试**

Run:

```bash
node --test scripts/member-utils.test.mjs scripts/organization-utils.test.mjs scripts/schedule-utils.test.mjs scripts/send-duty-reminder.test.mjs
```

Expected: PASS。

- [ ] **Step 2: 跑静态验证**

Run:

```bash
node scripts/verify-clean-roster-model.mjs
node scripts/verify-readonly-layout.mjs
node scripts/verify-multi-organization.mjs
node --check scripts/send-duty-reminder.mjs
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/duty-reminder.yml"); puts "workflow yaml ok"'
git diff --check
```

Expected:

```text
干净排班模型 UI 检查通过
只读排班布局检查通过
多组织静态检查通过
workflow yaml ok
```

`node --check` 和 `git diff --check` 无输出且退出码为 0。

- [ ] **Step 3: 本地预览页面**

Run:

```bash
python3 -m http.server 4173
```

打开：

```text
http://localhost:4173/
http://localhost:4173/?org=default
http://localhost:4173/admin/
http://localhost:4173/admin/?org=default
```

检查：

- 页面没有 console error。
- `/` 和 `/?org=default` 展示同一份默认组织排班。
- `/admin/` 和 `/admin/?org=default` 都能回填默认组织团队名单。
- 顶部副标题能显示默认组织。
- 管理页未配置 token 时，发布仍提示“先填写 GitHub Token”。

- [ ] **Step 4: dry-run 验证提醒**

Run:

```bash
node scripts/send-duty-reminder.mjs --dry-run
node scripts/send-duty-reminder.mjs --dry-run --org default
```

Expected:

- 两条命令都输出默认组织的飞书卡片 JSON。
- 不写 `data/orgs/default/reminder-state.json`。
- 不发送真实请求。
- 不打印 webhook。

- [ ] **Step 5: 最终状态检查**

Run:

```bash
git status --short
git log --oneline -6
```

Expected:

- 只有本次任务相关文件处于已修改或工作区干净。
- 最近提交按任务拆开，能看到：
  - `feat: add organization roster data`
  - `feat: load roster by organization`
  - `feat: publish roster by organization`
  - `feat: send reminders by organization`
  - `docs: document multi-organization usage`

- [ ] **Step 6: 提交验证修正**

如果 Step 1-4 发现并修了问题，提交修正：

```bash
git add <fixed-files>
git commit -m "fix: stabilize multi-organization roster"
```

如果没有修正，不创建空提交。
