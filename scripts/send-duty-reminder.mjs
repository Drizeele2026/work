import fs from "node:fs/promises";
import path from "node:path";
import scheduleUtils from "../schedule-utils.js";
import organizationUtils from "../organization-utils.js";

const DEFAULT_PUBLIC_URL = "https://drizeele2026.github.io/work/";
const TIME_ZONE = "Asia/Shanghai";

function formatBeijingDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).formatToParts(date);

  const value = (type) => parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  const weekday = value("weekday");

  return {
    dateKey: `${year}-${month}-${day}`,
    monthKey: `${year}-${month}`,
    displayDate: `${Number(year)}年${Number(month)}月${Number(day)}日`,
    weekday
  };
}

// 团队色圆点，对应公开页的蓝/绿/紫色标，让飞书卡片和网页视觉统一。
const TEAM_DOT = { blue: "🔵", green: "🟢", violet: "🟣", purple: "🟣", orange: "🟠", red: "🔴" };

function dutyPersonMarkdown(team) {
  // 卡片里用 <at id=...> @ 人；没配 openId 的显示姓名。
  return team.feishuOpenId ? `<at id=${team.feishuOpenId}></at>` : team.person;
}

function buildFeishuCardMessage({ dateInfo, assignment, upcoming = [], publicUrl = DEFAULT_PUBLIC_URL }) {
  const dutyLines = assignment.teams.map((team) => ({
    tag: "div",
    text: {
      tag: "lark_md",
      content: `${TEAM_DOT[team.color] || "⚪"} **${team.name}**　${dutyPersonMarkdown(team)}`
    }
  }));

  const elements = [
    { tag: "div", text: { tag: "lark_md", content: `**${dateInfo.displayDate}　${dateInfo.weekday}**` } },
    { tag: "hr" },
    ...dutyLines
  ];

  // 预告未来几天：只显示姓名、不 @，避免提前打扰还没轮到的人。
  if (upcoming.length) {
    const upcomingLines = upcoming.map((day) => ({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `${day.label}　${day.teams.map((team) => `${team.name} ${team.person}`).join(" · ")}`
      }
    }));
    elements.push(
      { tag: "hr" },
      { tag: "div", text: { tag: "lark_md", content: "**接下来**" } },
      ...upcomingLines
    );
  }

  elements.push(
    { tag: "hr" },
    {
      tag: "action",
      actions: [
        {
          tag: "button",
          text: { tag: "plain_text", content: "查看完整排班" },
          url: publicUrl,
          type: "default"
        }
      ]
    }
  );

  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: "blue",
        title: { tag: "plain_text", content: "今日值班提醒" }
      },
      elements
    }
  };
}

function createRuntimeAdapter(adapter = {}) {
  const baseDir = adapter.baseDir || process.cwd();
  return {
    readFile: adapter.readFile || fs.readFile,
    writeFile: adapter.writeFile || fs.writeFile,
    fetch: adapter.fetch !== undefined ? adapter.fetch : globalThis.fetch,
    log: adapter.log || ((...args) => console.log(...args)),
    resolvePath: adapter.resolvePath || ((filePath) =>
      path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath))
  };
}

async function loadSchedule(filePath, adapter = {}) {
  const runtime = createRuntimeAdapter(adapter);
  return JSON.parse(await runtime.readFile(runtime.resolvePath(filePath), "utf8"));
}

async function loadOrganizationIndex(filePath, adapter = {}) {
  const runtime = createRuntimeAdapter(adapter);
  try {
    return JSON.parse(await runtime.readFile(runtime.resolvePath(filePath), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
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

function webhookForTarget(target, env) {
  const webhook = env[target.webhookSecretName];
  if (!webhook) {
    if (target.legacy) {
      throw new Error("缺少 FEISHU_WEBHOOK。请在 GitHub Secrets 里配置飞书机器人 webhook。");
    }
    throw new Error(`组织【${target.organization.name}】缺少 webhook secret：${target.webhookSecretName}`);
  }
  return webhook;
}

async function loadReminderState(filePath, adapter = {}) {
  const runtime = createRuntimeAdapter(adapter);
  try {
    return JSON.parse(await runtime.readFile(runtime.resolvePath(filePath), "utf8"));
  } catch {
    // 文件不存在或内容损坏时，当作“从未发送过”处理
    return {};
  }
}

function hasSentOn(state, dateKey) {
  return Boolean(state) && state.lastSentDate === dateKey;
}

async function writeReminderState(filePath, dateKey, adapter = {}) {
  const runtime = createRuntimeAdapter(adapter);
  await runtime.writeFile(
    runtime.resolvePath(filePath),
    `${JSON.stringify({ lastSentDate: dateKey }, null, 2)}\n`,
    "utf8"
  );
}

async function postFeishuMessage(webhook, message, fetchImpl = globalThis.fetch) {
  if (!webhook) throw new Error("缺少 FEISHU_WEBHOOK。请在 GitHub Secrets 里配置飞书机器人 webhook。");
  if (!fetchImpl) throw new Error("当前 Node 环境缺少 fetch。");

  let response;
  try {
    response = await fetchImpl(webhook, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(message)
    });
  } catch {
    throw new Error("飞书机器人发送失败：网络请求异常。");
  }
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!response.ok || (payload && payload.code !== undefined && payload.code !== 0)) {
    const detail = payload?.msg || payload?.message || payload?.raw || `HTTP ${response.status}`;
    const safeDetail = String(detail).split(webhook).join("[REDACTED]");
    throw new Error(`飞书机器人发送失败：${safeDetail}`);
  }

  return payload;
}

// 单组织提醒的内部执行；target 来自 organization-utils，I/O 只经过 adapter seam。
async function sendOrganizationReminder(target, options = {}, adapter = {}) {
  const {
    dateInfo,
    dryRun = false,
    force = false,
    env = process.env
  } = options;
  const runtime = createRuntimeAdapter(adapter);
  const { organization } = target;

  if (!dryRun) {
    const state = await loadReminderState(target.statePath, runtime);
    if (!force && hasSentOn(state, dateInfo.dateKey)) {
      runtime.log(target.legacy
        ? `${dateInfo.dateKey} 今天已发送过值班提醒，跳过。`
        : `${organization.name} ${dateInfo.dateKey} 今天已发送过值班提醒，跳过。`);
      return target.legacy
        ? { skipped: true, dateKey: dateInfo.dateKey }
        : { organization, skipped: true, dateKey: dateInfo.dateKey };
    }
  }

  const schedule = await loadSchedule(target.schedulePath, runtime);
  const assignment = scheduleUtils.findAssignmentForDateWithFallback(schedule, dateInfo.dateKey);
  if (!assignment.teams.length) {
    runtime.log(target.legacy
      ? `${dateInfo.dateKey} 尚未生效，跳过值班提醒。`
      : `${organization.name} ${dateInfo.dateKey} 尚未生效，跳过值班提醒。`);
    return target.legacy
      ? { skipped: true, dateKey: dateInfo.dateKey, reason: "not-started" }
      : { organization, skipped: true, dateKey: dateInfo.dateKey, reason: "not-started" };
  }
  const upcoming = scheduleUtils.collectUpcoming(schedule, dateInfo.dateKey, 3);
  const message = buildFeishuCardMessage({
    dateInfo,
    assignment,
    upcoming,
    publicUrl: target.publicUrl
  });

  if (dryRun) {
    runtime.log(JSON.stringify(target.legacy ? message : {
      organization: organization.slug,
      name: organization.name,
      message
    }, null, 2));
    return target.legacy ? message : { organization, dryRun: true, message };
  }

  await postFeishuMessage(webhookForTarget(target, env), message, runtime.fetch);
  if (!force) {
    await writeReminderState(target.statePath, dateInfo.dateKey, runtime);
  }
  runtime.log(target.legacy
    ? (force
      ? `已强制发送 ${dateInfo.dateKey}（force：未写入去重状态）。`
      : `已发送 ${dateInfo.dateKey} 值班提醒。`)
    : (force
      ? `已强制发送 ${organization.name} ${dateInfo.dateKey}（force：未写入去重状态）。`
      : `已发送 ${organization.name} ${dateInfo.dateKey} 值班提醒。`));
  return target.legacy ? message : { organization, message };
}

export async function main(argv = process.argv.slice(2), env = process.env, adapter = {}) {
  const runtime = createRuntimeAdapter(adapter);
  const dryRun = argv.includes("--dry-run");
  const force = argv.includes("--force") || env.FORCE_SEND === "1";
  const orgSlug = parseArgValue(argv, "--org") || env.REMINDER_ORG || "";
  const schedulePath = env.SCHEDULE_PATH || "";
  const statePath = env.REMINDER_STATE_PATH || "";
  const publicUrl = env.PUBLIC_ROSTER_URL || "";
  const dateInfo = formatBeijingDate(env.REMINDER_DATE ? new Date(env.REMINDER_DATE) : new Date());

  const indexDocument = schedulePath
    ? null
    : await loadOrganizationIndex(env.ORGANIZATIONS_PATH || organizationUtils.ORGANIZATIONS_PATH, runtime);
  const selection = organizationUtils.resolveReminderTargets(indexDocument, orgSlug, {
    schedulePath,
    statePath,
    publicUrl
  });
  if (!selection.targets.length) {
    runtime.log("没有启用提醒的组织，跳过。");
    return [];
  }

  const results = [];
  const errors = [];
  for (const target of selection.targets) {
    try {
      results.push(await sendOrganizationReminder(target, { dateInfo, dryRun, force, env }, runtime));
    } catch (error) {
      if (selection.legacyResult) throw error;
      errors.push(`${target.organization.name}：${error.message || error}`);
    }
  }

  if (errors.length) {
    throw new Error(errors.join("\n"));
  }
  return selection.legacyResult ? results[0] : results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
