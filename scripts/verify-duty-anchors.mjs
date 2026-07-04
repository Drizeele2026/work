import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const adminHtml = await readFile(new URL("admin/index.html", root), "utf8");
const publicHtml = await readFile(new URL("index.html", root), "utf8");
const memberUtilsScript = await readFile(new URL("member-utils.js", root), "utf8");

const memberUtilsContext = { window: {} };
vm.createContext(memberUtilsContext);
vm.runInContext(memberUtilsScript, memberUtilsContext);
const memberUtils = memberUtilsContext.window.DutyRosterMembers;
assert.equal(typeof memberUtils?.parseMembers, "function", "member-utils.js 需要提供 parseMembers");
assert.equal(typeof memberUtils?.formatMembers, "function", "member-utils.js 需要提供 formatMembers");
assert.equal(typeof memberUtils?.memberNames, "function", "member-utils.js 需要提供 memberNames");
assert.equal(JSON.stringify(memberUtils.parseMembers("张三 | ou_1\n李四")), JSON.stringify([
  { name: "张三", feishuOpenId: "ou_1" },
  { name: "李四", feishuOpenId: "" }
]));
assert.equal(memberUtils.formatMembers([{ name: "张三", feishuOpenId: "ou_1" }, { name: "李四", feishuOpenId: "" }]), "张三 | ou_1\n李四");
assert.match(adminHtml, /<script src="\.\.\/member-utils\.js"><\/script>/, "管理页需要从上级目录加载 member-utils.js");
assert.match(publicHtml, /<script src="\.\/member-utils\.js"><\/script>/, "公开页需要从当前目录加载 member-utils.js");

function extractAnchorHelpers(html, label) {
  const match = html.match(/\/\/ Anchor scheduling helpers start([\s\S]*?)\/\/ Anchor scheduling helpers end/);
  assert.ok(match, `${label} 需要包含接龙节点纯函数块`);
  const context = {
    console,
    pad2(num) {
      return String(num).padStart(2, "0");
    },
    wrapIndex(index, length) {
      return ((index % length) + length) % length;
    }
  };
  vm.createContext(context);
  vm.runInContext(`${match[1]}
    globalThis.__helpers = {
      normalizeAnchors,
      getAnchorForDate,
      getPersonFromAnchor,
      getFirstAffectedDate
    };`, context);
  return context.__helpers;
}

for (const [label, html] of [["管理页", adminHtml], ["公开页", publicHtml]]) {
  assert.match(html, /class="anchor-list"/, `${label} 需要有节点列表 UI`);
  assert.match(html, /data-act="add-anchor"/, `${label} 需要有添加节点按钮`);
  assert.match(html, /当天值班人/, `${label} 需要支持当天值班人模式`);
  assert.match(html, /前一天值班人/, `${label} 需要支持前一天值班人模式`);
  assert.match(html, /anchors:/, `${label} 需要在团队配置里读写 anchors`);
  assert.match(html, /mode:\s*"previousDay",\s*person:\s*last/, `${label} 兼容旧 last 时必须按“前一天值班人”处理`);
  assert.match(html, /function getCurrentTeamDutyPerson\(/, `${label} 添加节点时需要能取当前日期值班人`);
  assert.match(html, /person:\s*getCurrentTeamDutyPerson\(index,\s*names\[0\]\)/, `${label} 新增节点需要默认选择当天值班人`);
  assert.match(html, /schedule-utils\.js/, `${label} 需要加载连续顺排工具`);
  assert.match(html, /function renderPublishedScheduleMonth\(/, `${label} 公开排班需要支持直接渲染已发布快照`);
  assert.match(html, /function renderContinuousScheduleMonth\(/, `${label} 需要支持没有月快照时按规则顺排`);
  assert.match(html, /renderPublishedScheduleMonth\(remotePreview/, `${label} 加载远端排班后需要优先渲染已发布快照`);
  assert.match(html, /renderContinuousScheduleMonth\(remotePreview,\s*year,\s*month\)/, `${label} 初始化时月快照缺失需要回退到规则顺排`);
  if (label === "管理页") {
    assert.match(html, /applyRosterChangeAnchorsToForm/, "管理页发布名单变更时需要自动补当天节点");
    assert.match(html, /applyRosterChangeAnchors/, "管理页需要调用共享逻辑判断名单变更节点");
  }

  const helpers = extractAnchorHelpers(html, label);
  const names = ["A", "B", "C", "D"];
  const anchors = helpers.normalizeAnchors([
    { date: "2026-06-22", mode: "currentDay", person: "C" },
    { date: "2026-06-01", mode: "currentDay", person: "A" }
  ], names);

  assert.deepEqual(Array.from(anchors, (anchor) => anchor.date), ["2026-06-01", "2026-06-22"]);
  assert.equal(helpers.getPersonFromAnchor(helpers.getAnchorForDate("2026-06-22", anchors), "2026-06-22", names), "C");
  assert.equal(helpers.getPersonFromAnchor(helpers.getAnchorForDate("2026-06-23", anchors), "2026-06-23", names), "D");

  const previousDay = helpers.normalizeAnchors([
    { date: "2026-06-22", mode: "previousDay", person: "C" }
  ], names);
  assert.equal(helpers.getPersonFromAnchor(previousDay[0], "2026-06-22", names), "D");
  assert.equal(helpers.getFirstAffectedDate(previousDay, "2026-06-01", []), "2026-06-22");

  const midMonthAdded = helpers.normalizeAnchors([
    { date: "2026-06-01", mode: "previousDay", person: "A" },
    { date: "2026-06-22", mode: "currentDay", person: "C" }
  ], names);
  assert.equal(helpers.getFirstAffectedDate(midMonthAdded, "2026-06-01", []), "2026-06-22");
  assert.equal(helpers.getFirstAffectedDate(midMonthAdded, "2026-06-01", midMonthAdded), "2026-06-01");
}

console.log("接龙节点检查通过");
