import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const publicHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
const adminHtml = await readFile(new URL("../admin/index.html", import.meta.url), "utf8");
const workbenchCss = await readFile(new URL("../workbench.css", import.meta.url), "utf8");
const workbenchFragment = await readFile(new URL("../workbench-fragment.html", import.meta.url), "utf8");
const workbenchJs = await readFile(new URL("../workbench.js", import.meta.url), "utf8");
const publicationModule = await readFile(new URL("../publication-module.js", import.meta.url), "utf8");
const favicon = await readFile(new URL("../favicon.svg", import.meta.url), "utf8");
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const workflow = await readFile(new URL("../.github/workflows/duty-reminder.yml", import.meta.url), "utf8");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function verifyAdapter(source, { label, route, prefix, publication }) {
  const escapedPrefix = escapeRegExp(prefix);
  assert.match(source, new RegExp(`<html[^>]*data-route="${route}"`), `${label} 必须显式声明 ${route} route`);
  assert.equal((source.match(/id="workbenchMount"/g) || []).length, 1, `${label} 必须且只能提供一个共享工作台挂载点`);
  assert.equal((source.match(new RegExp(`${escapedPrefix}workbench\\.css`, "g")) || []).length, 1, `${label} 必须且只能加载一次共享样式`);
  const orderedScripts = publication
    ? new RegExp(`<script src="${escapedPrefix}member-utils\\.js"></script>\\s*<script src="${escapedPrefix}organization-utils\\.js"></script>\\s*<script src="${escapedPrefix}schedule-utils\\.js"></script>\\s*<script src="${escapedPrefix}publication-module\\.js"></script>\\s*<script src="${escapedPrefix}workbench\\.js"></script>`)
    : new RegExp(`<script src="${escapedPrefix}member-utils\\.js"></script>\\s*<script src="${escapedPrefix}organization-utils\\.js"></script>\\s*<script src="${escapedPrefix}schedule-utils\\.js"></script>\\s*<script src="${escapedPrefix}workbench\\.js"></script>`);
  assert.match(source, orderedScripts, `${label} 必须按正确顺序加载共享 module`);
  assert.equal((source.match(new RegExp(`${escapedPrefix}workbench\\.js`, "g")) || []).length, 1, `${label} 必须且只能加载一次共享行为`);
  assert.equal((source.match(new RegExp(`${escapedPrefix}publication-module\\.js`, "g")) || []).length, publication ? 1 : 0, `${label} 的发布 module 加载策略不正确`);
  assert.doesNotMatch(source, /<script(?![^>]*\bsrc=)[^>]*>/, `${label} 不应再内联工作台行为`);
  assert.doesNotMatch(source, /id="(?:scheduleView|manageView|adminSummaryView|principlesDialog)"/, `${label} 不应复制共享工作台结构`);
  assert.doesNotMatch(source, /<(?:style|section|header|aside|dialog)\b/, `${label} 不应内联共享样式或结构`);
  assert.ok(source.split("\n").length < 40, `${label} 应保持为薄 adapter`);
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

assert.match(publicHtml, /<link rel="icon" href="\.\/favicon\.svg" type="image\/svg\+xml" \/>/, "公开页需要使用自定义 favicon");
assert.match(adminHtml, /<link rel="icon" href="\.\.\/favicon\.svg" type="image\/svg\+xml" \/>/, "管理页需要使用同一个自定义 favicon");
assert.match(favicon, /<svg\b[^>]*viewBox="0 0 64 64"/, "favicon 需要是 64x64 SVG 图标");
assert.match(favicon, /aria-label="值班排班"/, "favicon 需要有清晰的可访问名称");

assert.match(workbenchJs, /const workbenchScriptUrl = document\.currentScript\.src;/, "共享行为必须记录自身脚本地址");
assert.match(workbenchJs, /new URL\("\.\/workbench-fragment\.html", workbenchScriptUrl\)/, "共享行为必须按自身地址加载共享结构");
assert.match(workbenchJs, /document\.body\.innerHTML = await response\.text\(\);\s*startWorkbench\(\);/, "共享结构加载完成后才能启动工作台");
assert.equal((workbenchJs.match(/function openPrinciplesDialog\(\)/g) || []).length, 1, "排班说明行为只能有一份 implementation");
assert.match(workbenchJs, /document\.documentElement\.dataset\.route/, "共享行为必须读取 adapter 的 data-route");
assert.match(workbenchJs, /\$\("adminSummaryView"\)\.style\.display = admin && !isAbout && !isManage && !isConfirm \? "block" : "none";/, "月汇总只能在管理 route 的排班视图显示");
assert.match(workbenchJs, /\$\("brandSub"\)\.textContent = admin \? `管理排班 · \$\{orgName\}` : `公开查看 · \$\{orgName\}`;/, "共享行为需要按 route 显示组织副标题");
assert.match(workbenchJs, /head\.className = "week-head" \+ \(index >= 5 \? " weekend" : ""\);/, "周末表头需要在渲染时加 weekend 类名");
assert.match(workbenchJs, /function openPrinciplesDialog\(\)/, "需要有打开排班说明的共享行为");
assert.match(workbenchJs, /\$\("principlesBtn"\)\?\.addEventListener\("click", openPrinciplesDialog\);/, "排班说明按钮需要接入共享行为");

assert.match(workbenchFragment, /id="adminSummaryView"/, "共享结构需要保留管理页月汇总区域");
assert.match(workbenchFragment, /class="card admin-summary"/, "月汇总区域必须是管理专用卡片");
assert.doesNotMatch(workbenchFragment, /class="panel inspector"/, "共享结构不应再保留右侧同步状态栏");
assert.match(workbenchFragment, /class="card schedule-shell"/, "排班主体需要有独立的大屏容器");
assert.match(workbenchFragment, /<div class="header-controls">[\s\S]*id="principlesBtn"[\s\S]*>说明<\/button>/, "顶部控制区需要提供排班说明入口");
assert.match(workbenchFragment, /<dialog class="principles-dialog" id="principlesDialog" aria-labelledby="principlesDialogTitle">/, "排班说明需要放在弹窗里");
assert.match(workbenchFragment, /id="principlesDialogTitle"[\s\S]*排班说明/, "弹窗标题需要叫排班说明");
assert.match(workbenchFragment, /<h3>排班规则<\/h3>[\s\S]*<h3>为什么公平<\/h3>[\s\S]*<h3>系统实现原理<\/h3>/, "弹窗需要覆盖规则、公平性和实现原理");
assert.match(workbenchFragment, /<h3>系统实现原理<\/h3>[\s\S]*GitHub Pages[\s\S]*GitHub Actions[\s\S]*\.github\/workflows\/duty-reminder\.yml/, "实现原理需要说明 GitHub Pages、Actions 和 workflow");
for (const id of ["brandSub", "scheduleView", "manageView", "adminSummaryView", "principlesDialog"]) {
  assert.equal((workbenchFragment.match(new RegExp(`id="${id}"`, "g")) || []).length, 1, `共享结构中的 ${id} 必须且只能出现一次`);
}

assert.doesNotMatch(workbenchCss, /body\.admin-mode\s+\.layout\s*\{[^}]*grid-template-columns:\s*224px\s+minmax\(0,\s*1fr\)\s+252px/s, "布局不应再保留右侧第三列");
assert.match(workbenchCss, /\.schedule-shell\b/, "共享样式需要覆盖排班大屏容器");
assert.match(workbenchCss, /--calendar-weeks/, "日历高度应按展示周数自适应放大");
assert.match(workbenchCss, /\.week-head\s*\{[^}]*background:\s*linear-gradient/s, "周一到周日表头需要更明显的背景");
assert.match(workbenchCss, /\.week-head\s*\{[^}]*font-size:\s*13px/s, "周一到周日表头字号需要增强");
assert.match(workbenchCss, /\.week-head\s*\{[^}]*font-weight:\s*900/s, "周一到周日表头字重需要增强");
assert.match(workbenchCss, /\.week-head\s*\{[^}]*border-bottom:\s*2px solid/s, "周一到周日表头需要更强的底部分隔线");
assert.match(workbenchCss, /\.week-head\.weekend\b/, "周末表头需要和工作日略微区分");
assert.doesNotMatch(workbenchCss, /body:not\(\.admin-mode\) \.topbar\s*\{[^}]*display:\s*none/s, "公开页不应隐藏顶栏");
assert.match(workbenchCss, /body:not\(\.admin-mode\) \.schedule-shell\s*\{[^}]*min-height:\s*calc\(100dvh - 104px\)/s, "公开页排班区域高度需要扣除顶栏");
assert.match(workbenchCss, /body:not\(\.admin-mode\) \.calendar-grid\s*\{[^}]*min-height:\s*calc\(100dvh - 206px\)/s, "公开页日历网格高度需要和顶栏联动");
assert.match(workbenchCss, /body:not\(\.admin-mode\) \.day-cell\s*\{[^}]*min-height:\s*max\(110px,\s*calc\(\(100dvh - 252px\) \/ var\(--calendar-weeks\)\)\)/s, "公开页日期格高度应按可用视口计算");

assert.match(publicationModule, /global\.DutyRosterPublication = api;/, "管理 adapter 加载的发布 module 必须暴露浏览器 global");
assert.match(readme, /## 系统实现原理[\s\S]*GitHub Pages[\s\S]*GitHub Actions[\s\S]*\.github\/workflows\/duty-reminder\.yml/, "README 的系统实现原理需要写清 GitHub Pages、Actions 和 workflow");
assert.match(readme, /data\/organizations\.json[\s\S]*data\/orgs\/\{slug\}\/schedule\.json/, "README 需要说明多组织数据文件");
assert.match(workflow, /workflow_dispatch:/, "提醒 workflow 需要保留 workflow_dispatch 给 cron-job.org 调用");
assert.doesNotMatch(workflow, /^\s*schedule:/m, "提醒 workflow 不应使用 GitHub 自带 schedule");
assert.doesNotMatch(workflow, /^\s*-\s*cron:/m, "提醒 workflow 不应配置 GitHub cron");

console.log("只读排班布局检查通过");
