import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const publicHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
const adminHtml = await readFile(new URL("../admin/index.html", import.meta.url), "utf8");
const workbenchCss = await readFile(new URL("../workbench.css", import.meta.url), "utf8");
const workbenchFragment = await readFile(new URL("../workbench-fragment.html", import.meta.url), "utf8");
const workbenchJs = await readFile(new URL("../workbench.js", import.meta.url), "utf8");
const publicationModule = await readFile(new URL("../publication-module.js", import.meta.url), "utf8");
const workflow = await readFile(new URL("../.github/workflows/duty-reminder.yml", import.meta.url), "utf8");
const organizations = JSON.parse(await readFile(new URL("../data/organizations.json", import.meta.url), "utf8"));
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

function sharedFunction(name) {
  const marker = `function ${name}(`;
  const start = workbenchJs.indexOf(marker);
  assert.notEqual(start, -1, `共享工作台缺少 ${name}`);
  const next = workbenchJs.indexOf("\n      function ", start + marker.length);
  return workbenchJs.slice(start, next < 0 ? workbenchJs.length : next);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function verifyAdapter(source, { label, route, prefix, publication }) {
  const escapedPrefix = escapeRegExp(prefix);
  assert.match(source, new RegExp(`data-route="${route}"`), `${label} 必须声明自己的 route`);
  assert.match(source, new RegExp(`<script src="${escapedPrefix}organization-utils\\.js"></script>`), `${label} 需要加载组织 module`);
  const endingScripts = publication
    ? new RegExp(`<script src="${escapedPrefix}schedule-utils\\.js"></script>\\s*<script src="${escapedPrefix}publication-module\\.js"></script>\\s*<script src="${escapedPrefix}workbench\\.js"></script>`)
    : new RegExp(`<script src="${escapedPrefix}schedule-utils\\.js"></script>\\s*<script src="${escapedPrefix}workbench\\.js"></script>`);
  assert.match(source, endingScripts, `${label} 需要按正确顺序加载工作台 module`);
  assert.equal((source.match(new RegExp(`${escapedPrefix}publication-module\\.js`, "g")) || []).length, publication ? 1 : 0, `${label} 的发布 module 加载策略不正确`);
  assert.doesNotMatch(source, /async function loadCurrentOrganization\(|function getCurrentSchedulePath\(/, `${label} 不应复制多组织 implementation`);
}

verifyAdapter(publicHtml, {
  label: "公开页",
  route: "public",
  prefix: "./",
  publication: false
});
verifyAdapter(adminHtml, {
  label: "管理页",
  route: "admin",
  prefix: "../",
  publication: true
});

assert.match(workbenchCss, /body\.admin-mode/, "共享样式必须按 route 区分管理视图");
assert.match(workbenchFragment, /id="brandSub"/, "共享结构需要保留组织副标题位置");
assert.match(workbenchFragment, /id="manageView"/, "共享结构需要保留按组织管理入口");

assert.equal((workbenchJs.match(/async function loadCurrentOrganization\(\)/g) || []).length, 1, "组织加载行为只能在共享工作台保留一份");
assert.match(workbenchJs, /const orgUtils = window\.DutyRosterOrganizations;/, "共享工作台需要使用组织 module");
assert.match(workbenchJs, /let currentOrganization = null;/, "共享工作台需要保存当前组织");
assert.match(workbenchJs, /function getCurrentSchedulePath\(\)\s*\{\s*return currentOrganization\?\.schedulePath \|\| orgUtils\.LEGACY_SCHEDULE_PATH;\s*\}/, "排班路径必须来自当前组织");
assert.match(workbenchJs, /orgUtils\.relativeDataPath\(getCurrentSchedulePath\(\), isAdminRoute\(\)\)/, "静态读取必须适配当前 route 和组织路径");
assert.doesNotMatch(workbenchJs, /const SCHEDULE_FILE = "data\/schedule\.json";/, "共享工作台不应写死排班文件");
assert.match(
  workbenchJs,
  /async function boot\(\)\s*\{[\s\S]*?await loadCurrentOrganization\(\);[\s\S]*?const remotePreview = await loadRemoteSchedulePreview\(\);/,
  "必须先确定组织，再读取该组织排班"
);

assert.match(workbenchJs, /window\.DutyRosterPublication/, "管理工作台需要读取发布 module");
assert.match(
  workbenchJs,
  /\.createPublication\(\{\s*organization:\s*currentOrganization,\s*settings:\s*readGithubSettings\(\),\s*storage:\s*localStorage,\s*fetchImpl:\s*window\.fetch\.bind\(window\),\s*scheduleUtils,\s*clock:\s*\(\) => new Date\(\)\s*\}\)/,
  "管理工作台需要把当前组织和生产 adapter 接入发布 module"
);
assert.match(workbenchJs, /createCurrentPublication\(\)\.restoreDraft\(remotePreview\)/, "管理工作台需要按当前组织恢复草稿");
assert.match(workbenchJs, /createCurrentPublication\(\)\.stageDraft\(/, "管理工作台需要通过发布 module 暂存组织草稿");
assert.match(
  sharedFunction("markTeamDraftSaved"),
  /teamConfigDirty = !\(options\.published === true \|\| draft\?\.published === true\)/,
  "本机草稿和远端已发布状态必须分开"
);
assert.match(
  sharedFunction("applyTeamFormState"),
  /\[1, 2, 3\]\.forEach\(\(index\) => setTeamForm\(index, \{ name: "", members: \[\] \}\)\)/,
  "恢复不足三个团队时必须先清空旧槽位"
);
assert.match(workbenchJs, /if \(!loadedTeamConfig\) applyOpenIdsFromRemote\(remotePreview\);/, "恢复本机草稿后不能用远端身份覆盖显式编辑");
const publishHandler = sharedFunction("handleTeamNextAction");
assert.match(publishHandler, /publication = createCurrentPublication\(\);\s*const result = await publication\.publish\(/, "管理工作台需要通过发布 module 发布当前组织");
assert.match(publishHandler, /remoteScheduleDocument = result\.document;/, "发布成功后共享工作台需要接回最新组织文档");
assert.match(publishHandler, /同时提交到 \$\{result\.repo\}\/\$\{result\.path\}/, "发布成功信息需要使用 module 返回的组织仓库与路径");
assert.doesNotMatch(
  workbenchJs,
  /function (?:getTeamConfigStorageKey|isRemoteNewerThanDraft|parseRepoSlug|getRepoApiBase|buildScheduleDocument|encodeBase64Utf8|decodeBase64Utf8|githubRequest|loadGithubScheduleDocument|saveScheduleToGithub)\b/,
  "草稿隔离、GitHub 传输和发布细节应隐藏在发布 module"
);
assert.doesNotMatch(workbenchJs, /\b(?:API_BASE|contentsUrl)\b|Authorization\s*:/, "GitHub 传输细节不应泄漏回共享工作台");

assert.match(publicationModule, /const draftKey = `\$\{draftKeyPrefix\}:\$\{organization\.slug\}`;/, "草稿 key 必须按组织隔离");
assert.match(publicationModule, /organizationSlug:\s*organization\.slug/, "草稿内容必须记录组织归属");
assert.match(publicationModule, /const organizationSlugs = new Set\(\[organization\.slug, \.\.\.organization\.aliases\]\)[\s\S]*!organizationSlugs\.has\(draft\?\.organizationSlug\)/, "恢复草稿时只能接受 canonical 组织或其别名的数据");
assert.match(publicationModule, /savedAtIso/, "组织草稿必须记录保存时间");
assert.match(publicationModule, /remoteUpdatedAt/, "组织草稿必须记录远端版本时间");
assert.match(publicationModule, /published: published === true/, "组织草稿必须记录是否已成功发布");
assert.match(publicationModule, /draft\.published === true[\s\S]*draft\.remoteUpdatedAt[\s\S]*remoteDocument\?\.updatedAt/, "恢复草稿时必须用远端版本确认已发布状态");
assert.match(publicationModule, /remoteUpdatedAt > savedAt/, "恢复草稿时必须丢弃远端更新后的旧草稿");
assert.match(publicationModule, /const path = organization\.schedulePath;/, "发布路径必须来自当前组织");
assert.match(publicationModule, /document\.organization\s*=\s*\{[\s\S]*slug:\s*organization\.slug[\s\S]*name:\s*organization\.name/, "发布文档必须记录当前组织");
assert.match(publicationModule, /Object\.freeze\(\{ restoreDraft, stageDraft, publish \}\)/, "发布 module 应只暴露三个高 leverage 动作");

assert.equal(organizations.defaultOrg, "intelligence");
const defaultOrganization = organizations.organizations.find((org) => org.slug === organizations.defaultOrg);
assert.ok(defaultOrganization, "默认组织必须存在");
assert.equal(defaultOrganization.name, "智慧门店");
assert.equal(defaultOrganization.schedulePath, "data/orgs/intelligence/schedule.json");
assert.deepEqual(defaultOrganization.aliases, ["default"], "default 旧入口应是智慧门店的组织别名");
assert.equal(organizations.organizations.some((org) => org.slug === "default"), false, "组织别名不能形成第二个组织");
const shmOrganization = organizations.organizations.find((org) => org.slug === "shm");
assert.ok(shmOrganization, "需要配置营运通组织");
assert.equal(shmOrganization.name, "营运通");
assert.equal(shmOrganization.schedulePath, "data/orgs/shm/schedule.json");
assert.equal(shmOrganization.reminder?.enabled, true, "营运通配置 webhook 后需要启用提醒");

assert.match(workflow, /FEISHU_WEBHOOK:\s*\$\{\{ secrets\.FEISHU_WEBHOOK \}\}/, "workflow 需要暴露默认组织 webhook");
assert.match(workflow, /FEISHU_WEBHOOK_SHM:\s*\$\{\{ secrets\.FEISHU_WEBHOOK_SHM \}\}/, "workflow 需要预留营运通 webhook secret");
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
assert.match(readme, /aliases.*正式 `slug`/, "README 需要说明组织别名归一语义");
assert.match(readme, /成功发送的组织.*reminder-state\.json.*提交/, "README 需要说明部分成功时已发送组织的状态仍会提交");
assert.match(readme, /缺 secret.*修好.*重跑/, "README 需要说明失败组织补 secret 后重跑");

console.log("多组织静态检查通过");
