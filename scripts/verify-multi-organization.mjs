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
  assert.match(html, /async function loadGithubScheduleDocument\(schedulePath = getCurrentSchedulePath\(\)\)/, `${label} GitHub 读取需要按当前组织路径`);
  assert.match(html, /async function saveScheduleToGithub\(preloadedRemote = null\)/, `${label} GitHub 保存需要接受预加载远端文档`);
  assert.match(html, /const contentsUrl = `\$\{repoApiBase\}\/contents\/\$\{schedulePath\}`;/, `${label} GitHub Contents API 需要使用组织 schedule 路径`);
  assert.match(html, /同时提交到 \$\{settings\.repoSlug\}\/\$\{schedulePath\}/, `${label} 发布成功文案需要显示当前组织路径`);
  assert.match(html, /orgUtils\.relativeDataPath\(getCurrentSchedulePath\(\), isAdminRoute\(\)\)/, `${label} 读取排班时不能写死 data\/schedule.json`);
  assert.doesNotMatch(html, /const SCHEDULE_FILE = "data\/schedule\.json";/, `${label} 不应再用固定 SCHEDULE_FILE`);
}

verifyPage(publicHtml, "公开页", "./organization-utils.js");
verifyPage(adminHtml, "管理页", "../organization-utils.js");

assert.equal(organizations.defaultOrg, "default");
const defaultOrganization = organizations.organizations.find((org) => org.slug === organizations.defaultOrg);
assert.ok(defaultOrganization, "默认组织必须存在");
assert.equal(defaultOrganization.schedulePath, "data/orgs/default/schedule.json");
assert.match(workflow, /FEISHU_WEBHOOK:/, "workflow 需要继续暴露默认组织使用的 FEISHU_WEBHOOK");
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
assert.match(workflow, /FEISHU_WEBHOOK:\s*\$\{\{ secrets\.FEISHU_WEBHOOK \}\}/, "workflow 需要暴露默认组织 webhook");
assert.match(workflow, /git status --porcelain data\/orgs/, "workflow 需要检查组织提醒状态");
assert.match(workflow, /git add data\/orgs\/\*\/reminder-state\.json/, "workflow 需要提交组织提醒状态");
assert.match(readme, /多组织/, "README 需要说明多组织");
assert.match(readme, /\/work\/\?org=/, "README 需要说明按 org 查看排班");
assert.match(readme, /data\/organizations\.json/, "README 需要说明组织索引文件");

console.log("多组织静态检查通过");
