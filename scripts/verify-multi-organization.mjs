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
  assert.match(html, /function getTeamConfigStorageKey\(\)/, `${label} 团队草稿需要按组织生成 storage key`);
  assert.match(html, /localStorage\.setItem\(getTeamConfigStorageKey\(\), JSON\.stringify\(/, `${label} 保存团队草稿时需要使用组织隔离 key`);
  assert.match(html, /localStorage\.getItem\(getTeamConfigStorageKey\(\)\)/, `${label} 读取团队草稿时需要使用组织隔离 key`);
  assert.match(
    html,
    /async function boot\(\) \{[\s\S]*await loadCurrentOrganization\(\);[\s\S]*const loadedTeamConfig = loadLocalUiState\(\);/,
    `${label} 必须先确定当前组织，再读取本地团队草稿`
  );
  assert.match(html, /async function loadGithubScheduleDocument\(schedulePath = getCurrentSchedulePath\(\)\)/, `${label} GitHub 读取需要按当前组织路径`);
  assert.match(html, /async function saveScheduleToGithub\(preloadedRemote = null\)/, `${label} GitHub 保存需要接受预加载远端文档`);
  assert.match(html, /const contentsUrl = `\$\{repoApiBase\}\/contents\/\$\{schedulePath\}`;/, `${label} GitHub Contents API 需要使用组织 schedule 路径`);
  assert.match(html, /同时提交到 \$\{settings\.repoSlug\}\/\$\{schedulePath\}/, `${label} 发布成功文案需要显示当前组织路径`);
  assert.match(html, /orgUtils\.relativeDataPath\(getCurrentSchedulePath\(\), isAdminRoute\(\)\)/, `${label} 读取排班时不能写死 data\/schedule.json`);
  assert.doesNotMatch(html, /const SCHEDULE_FILE = "data\/schedule\.json";/, `${label} 不应再用固定 SCHEDULE_FILE`);
}

verifyPage(publicHtml, "公开页", "./organization-utils.js");
verifyPage(adminHtml, "管理页", "../organization-utils.js");

assert.equal(organizations.defaultOrg, "intelligence");
const defaultOrganization = organizations.organizations.find((org) => org.slug === organizations.defaultOrg);
assert.ok(defaultOrganization, "默认组织必须存在");
assert.equal(defaultOrganization.name, "智慧门店");
assert.equal(defaultOrganization.schedulePath, "data/orgs/intelligence/schedule.json");
const legacyDefaultOrganization = organizations.organizations.find((org) => org.slug === "default");
assert.ok(legacyDefaultOrganization, "需要保留 default 旧入口");
assert.equal(legacyDefaultOrganization.schedulePath, "data/orgs/intelligence/schedule.json");
assert.equal(legacyDefaultOrganization.reminder?.enabled, false, "default 旧入口不能重复发送提醒");
const shmOrganization = organizations.organizations.find((org) => org.slug === "shm");
assert.ok(shmOrganization, "需要配置营运通组织");
assert.equal(shmOrganization.name, "营运通");
assert.equal(shmOrganization.schedulePath, "data/orgs/shm/schedule.json");
assert.equal(shmOrganization.reminder?.enabled, true, "营运通配置 webhook 后需要启用提醒");
assert.match(workflow, /FEISHU_WEBHOOK:/, "workflow 需要继续暴露默认组织使用的 FEISHU_WEBHOOK");
assert.match(workflow, /FEISHU_WEBHOOK_SHM:\s*\$\{\{ secrets\.FEISHU_WEBHOOK_SHM \}\}/, "workflow 需要预留营运通 webhook secret");
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
assert.match(workflow, /FEISHU_WEBHOOK:\s*\$\{\{ secrets\.FEISHU_WEBHOOK \}\}/, "workflow 需要暴露默认组织 webhook");
assert.match(workflow, /org:\s*\n\s*description: "只发送指定组织/, "workflow 手动触发需要支持指定组织");
assert.match(workflow, /REMINDER_ORG:\s*\$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.org \|\| '' \}\}/, "workflow 需要把指定组织传给提醒脚本");
assert.match(workflow, /echo "exit_code=\$status" >> "\$GITHUB_OUTPUT"/, "workflow 需要记录提醒脚本退出码");
assert.match(workflow, /if:\s*always\(\)/, "workflow 需要在提醒脚本失败时仍提交 reminder state");
assert.match(workflow, /steps\.send_reminder\.outputs\.exit_code != '0'/, "workflow 需要在提交状态后按原退出码失败");
assert.match(workflow, /git status --porcelain data\/orgs/, "workflow 需要检查组织提醒状态");
assert.match(workflow, /git add data\/orgs\/\*\/reminder-state\.json/, "workflow 需要提交组织提醒状态");
assert.match(readme, /多组织/, "README 需要说明多组织");
assert.match(readme, /\/work\/\?org=/, "README 需要说明按 org 查看排班");
assert.match(readme, /data\/organizations\.json/, "README 需要说明组织索引文件");
assert.match(readme, /成功发送的组织.*reminder-state\.json.*提交/, "README 需要说明部分成功时已发送组织的状态仍会提交");
assert.match(readme, /缺 secret.*修好.*重跑/, "README 需要说明失败组织补 secret 后重跑");

console.log("多组织静态检查通过");
