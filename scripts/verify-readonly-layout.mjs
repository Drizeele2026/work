import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const adminHtml = await readFile(new URL("../admin/index.html", import.meta.url), "utf8");
const favicon = await readFile(new URL("../favicon.svg", import.meta.url), "utf8");
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const workflow = await readFile(new URL("../.github/workflows/duty-reminder.yml", import.meta.url), "utf8");

assert.match(html, /<link rel="icon" href="\.\/favicon\.svg" type="image\/svg\+xml" \/>/, "公开页需要使用自定义 favicon");
assert.match(adminHtml, /<link rel="icon" href="\.\.\/favicon\.svg" type="image\/svg\+xml" \/>/, "管理页需要使用同一个自定义 favicon");
assert.match(favicon, /<svg\b[^>]*viewBox="0 0 64 64"/, "favicon 需要是 64x64 SVG 图标");
assert.match(favicon, /aria-label="值班排班"/, "favicon 需要有清晰的可访问名称");

function verify(htmlText, label) {
  assert.ok(htmlText.includes('id="adminSummaryView"'), `${label} 需要保留后台月汇总区域`);
  assert.ok(htmlText.includes('class="card admin-summary"'), `${label} 月汇总区域必须是后台专用卡片`);
  assert.match(htmlText, /\$\("adminSummaryView"\)\.style\.display = admin && !isAbout && !isManage && !isConfirm \? "block" : "none";/, `${label} 月汇总只能在 /admin 的排班视图显示`);
  assert.ok(!htmlText.includes('class="panel inspector"'), `${label} 不应再保留右侧同步状态栏`);
  assert.ok(!/body\.admin-mode\s+\.layout\s*\{[^}]*grid-template-columns:\s*224px\s+minmax\(0,\s*1fr\)\s+252px/.test(htmlText), `${label} 布局不应再保留右侧第三列`);
  assert.match(htmlText, /\.schedule-shell\b/, `${label} 排班主体需要有独立的大屏容器`);
  assert.match(htmlText, /--calendar-weeks/, `${label} 日历高度应按展示周数自适应放大`);
  assert.match(htmlText, /\.week-head\s*\{[^}]*background:\s*linear-gradient/s, `${label} 周一到周日表头需要更明显的背景`);
  assert.match(htmlText, /\.week-head\s*\{[^}]*font-size:\s*13px/s, `${label} 周一到周日表头字号需要增强`);
  assert.match(htmlText, /\.week-head\s*\{[^}]*font-weight:\s*900/s, `${label} 周一到周日表头字重需要增强`);
  assert.match(htmlText, /\.week-head\s*\{[^}]*border-bottom:\s*2px solid/s, `${label} 周一到周日表头需要更强的底部分隔线`);
  assert.match(htmlText, /\.week-head\.weekend\b/, `${label} 周末表头需要和工作日略微区分`);
  assert.match(htmlText, /head\.className = "week-head" \+ \(index >= 5 \? " weekend" : ""\);/, `${label} 周末表头需要在渲染时加 weekend 类名`);
  assert.match(htmlText, /body:not\(\.admin-mode\) \.topbar\s*\{\s*display:\s*none;\s*\}/, `${label} 展示页需要隐藏外层顶栏，把空间留给排班`);
  assert.match(htmlText, /body:not\(\.admin-mode\) \.schedule-shell\s*\{[^}]*min-height:\s*100dvh/s, `${label} 展示页排班区域需要接近全屏高度`);
  assert.match(htmlText, /<div class="header-controls">[\s\S]*id="principlesBtn"[\s\S]*>说明<\/button>/, `${label} 需要在顶部控制区提供排班说明入口`);
  assert.match(htmlText, /<dialog class="principles-dialog" id="principlesDialog" aria-labelledby="principlesDialogTitle">/, `${label} 系统原理说明需要放在弹窗里`);
  assert.match(htmlText, /id="principlesDialogTitle"[\s\S]*排班说明/, `${label} 弹窗标题需要叫排班说明`);
  assert.match(htmlText, /<h3>排班规则<\/h3>[\s\S]*<h3>为什么公平<\/h3>[\s\S]*<h3>系统实现原理<\/h3>/, `${label} 弹窗需要覆盖规则、公平性和实现原理`);
  assert.match(htmlText, /<h3>系统实现原理<\/h3>[\s\S]*GitHub Pages[\s\S]*GitHub Actions[\s\S]*\.github\/workflows\/duty-reminder\.yml/, `${label} 系统实现原理需要说明用到的 GitHub Pages、Actions 和 workflow`);
  assert.match(htmlText, /function openPrinciplesDialog\(\)/, `${label} 需要有打开系统原理弹窗的逻辑`);
  assert.match(htmlText, /\$\("principlesBtn"\)\?\.addEventListener\("click", openPrinciplesDialog\);/, `${label} 顶部原理按钮需要能打开弹窗`);
}

verify(html, "公开页");
verify(adminHtml, "管理页");
assert.match(readme, /## 系统实现原理[\s\S]*GitHub Pages[\s\S]*GitHub Actions[\s\S]*\.github\/workflows\/duty-reminder\.yml/, "README 的系统实现原理需要写清楚用到的 GitHub Pages、Actions 和 workflow");
assert.match(readme, /data\/organizations\.json[\s\S]*data\/orgs\/\{slug\}\/schedule\.json/, "README 需要说明多组织数据文件");
assert.match(workflow, /workflow_dispatch:/, "提醒 workflow 需要保留 workflow_dispatch 给 cron-job.org 调用");
assert.doesNotMatch(workflow, /^\s*schedule:/m, "提醒 workflow 不应再使用 GitHub 自带 schedule");
assert.doesNotMatch(workflow, /^\s*-\s*cron:/m, "提醒 workflow 不应再配置 GitHub cron");

console.log("只读排班布局检查通过");
