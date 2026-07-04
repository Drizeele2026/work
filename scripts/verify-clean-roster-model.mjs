import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const targets = [
  { label: "管理页", path: "../admin/index.html" },
  { label: "公开页", path: "../index.html" }
];

for (const target of targets) {
  const html = await readFile(new URL(target.path, import.meta.url), "utf8");

  assert.doesNotMatch(html, /兜底起点/, `${target.label} 不应展示兜底起点`);
  assert.doesNotMatch(html, /接龙节点/, `${target.label} 不应展示接龙节点`);
  assert.doesNotMatch(html, /添加节点/, `${target.label} 不应展示添加节点`);
  assert.doesNotMatch(html, /当天值班人/, `${target.label} 不应展示当天值班人节点模式`);
  assert.doesNotMatch(html, /前一天值班人/, `${target.label} 不应展示前一天值班人节点模式`);
  assert.doesNotMatch(html, /data-act="add-anchor"/, `${target.label} 不应有添加节点按钮`);
  assert.doesNotMatch(html, /team1Last|team2Last|team3Last/, `${target.label} 不应有兜底起点控件`);
  assert.doesNotMatch(html, /team1Anchors|team2Anchors|team3Anchors/, `${target.label} 不应有节点控件`);
  assert.doesNotMatch(html, /applyRosterChangeAnchors/, `${target.label} 不应再自动补接龙节点`);
  assert.match(
    html,
    /function renderPublishedScheduleMonth\(document, year, month\)\s*\{\s*if\s*\(document\?\.(?:version)\s*>=\s*2\s*\|\|\s*Array\.isArray\(document\?\.(?:ruleVersions)\)\)\s*return false;/,
    `${target.label} 的 renderPublishedScheduleMonth 必须跳过 v2/ruleVersions 文档`
  );
  assert.match(html, /buildPublishedDocument/, `${target.label} 发布应通过共享函数生成规则版本文档`);
  assert.match(html, /维护值班规则/, `${target.label} 标题应改成维护值班规则`);
}

console.log("干净排班模型 UI 检查通过");
