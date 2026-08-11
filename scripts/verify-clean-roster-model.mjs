import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const publicHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
const adminHtml = await readFile(new URL("../admin/index.html", import.meta.url), "utf8");
const workbenchCss = await readFile(new URL("../workbench.css", import.meta.url), "utf8");
const workbenchFragment = await readFile(new URL("../workbench-fragment.html", import.meta.url), "utf8");
const workbenchJs = await readFile(new URL("../workbench.js", import.meta.url), "utf8");
const publicationModule = await readFile(new URL("../publication-module.js", import.meta.url), "utf8");

const adapters = [
  { label: "公开页", source: publicHtml },
  { label: "管理页", source: adminHtml }
];
const retiredRosterCopy = /兜底起点|接龙节点|添加节点|当天值班人|前一天值班人/;
const retiredRosterCode = /data-act="add-anchor"|team[123](?:Last|Anchors)|applyRosterChangeAnchors/;

function sharedFunction(name) {
  const marker = `function ${name}(`;
  const start = workbenchJs.indexOf(marker);
  assert.notEqual(start, -1, `共享工作台缺少 ${name}`);
  const next = workbenchJs.indexOf("\n      function ", start + marker.length);
  return workbenchJs.slice(start, next < 0 ? workbenchJs.length : next);
}

for (const adapter of adapters) {
  assert.match(adapter.source, /id="workbenchMount"/, `${adapter.label} 应只保留共享工作台挂载点`);
  assert.match(adapter.source, /workbench\.css/, `${adapter.label} 必须加载共享样式`);
  assert.match(adapter.source, /workbench\.js/, `${adapter.label} 必须加载共享行为`);
  assert.doesNotMatch(adapter.source, /function\s+(?:startWorkbench|renderPublishedScheduleMonth|renderContinuousScheduleMonth)\b/, `${adapter.label} 不应复制工作台 implementation`);
  assert.ok(adapter.source.split("\n").length < 40, `${adapter.label} 应保持为薄 adapter`);
}

assert.doesNotMatch(
  workbenchFragment,
  retiredRosterCopy,
  "共享工作台不应恢复旧的排班接龙文案"
);
assert.doesNotMatch(
  [workbenchFragment, workbenchJs].join("\n"),
  retiredRosterCode,
  "共享工作台不应恢复旧的排班接龙实现"
);
assert.match(workbenchFragment, /维护值班规则/, "共享工作台标题应为维护值班规则");

const sharedSources = [publicHtml, adminHtml, workbenchJs].join("\n");
assert.equal(
  (sharedSources.match(/function renderPublishedScheduleMonth\(/g) || []).length,
  1,
  "v1 排班兼容行为只能在共享工作台保留一份"
);
assert.equal(
  (sharedSources.match(/function renderContinuousScheduleMonth\(/g) || []).length,
  1,
  "v2 规则版本行为只能在共享工作台保留一份"
);

const v1Renderer = sharedFunction("renderPublishedScheduleMonth");
const v2Renderer = sharedFunction("renderContinuousScheduleMonth");
assert.match(
  v1Renderer,
  /if \(document\?\.version >= 2 \|\| Array\.isArray\(document\?\.ruleVersions\)\) return false;/,
  "v1 renderer 必须跳过 v2/ruleVersions 文档"
);
assert.match(
  v1Renderer,
  /document\?\.months\?\.\[monthKey\][\s\S]*?dailyAssignments/,
  "v1 renderer 仍需读取已发布月份快照"
);
assert.match(
  v2Renderer,
  /Array\.isArray\(document\?\.ruleVersions\)[\s\S]*?Array\.isArray\(document\?\.current\?\.teams\)[\s\S]*?generateAssignmentsForMonth\(document, year, month\)/,
  "v2 renderer 必须通过共享排班 module 读取 ruleVersions/current.teams"
);
assert.match(v1Renderer, /renderTeamConfigStatus\(\);/, "v1 已发布快照渲染后必须同步管理状态");
assert.match(v2Renderer, /renderTeamConfigStatus\(\);/, "v2 已发布规则渲染后必须同步管理状态");
assert.match(
  workbenchJs,
  /applyTeamFormState\(remotePreview\.current\??\.teams\)/,
  "管理页回填必须优先使用 v2 current.teams"
);

assert.match(publicationModule, /function createPublication\(options = \{\}\)/, "发布应由独立 deep module 提供");
assert.match(publicationModule, /scheduleUtils\.buildPublishedDocument\(/, "发布 module 应生成规则版本文档");
assert.match(publicationModule, /document\.organization\s*=\s*\{/, "发布 module 应补齐组织归属");
assert.match(workbenchJs, /\.createPublication\(\{/, "管理工作台应接入发布 module");
assert.match(workbenchJs, /\.restoreDraft\(remotePreview\)/, "管理工作台应通过发布 module 恢复草稿");
assert.match(workbenchJs, /\.publish\(/, "管理工作台应通过发布 module 发布规则版本");

console.log("干净排班模型 UI 检查通过");
