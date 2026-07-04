import fs from "node:fs/promises";
import scheduleUtils from "../schedule-utils.js";
import organizationUtils from "../organization-utils.js";

const DEFAULT_SCHEDULE_PATH = "data/schedule.json";
const DEFAULT_STATE_PATH = "data/reminder-state.json";
const DEFAULT_ORGANIZATIONS_PATH = "data/organizations.json";
const DEFAULT_PUBLIC_URL = "https://drizeele2026.github.io/work/";
const TIME_ZONE = "Asia/Shanghai";

export function formatBeijingDate(date = new Date()) {
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

export function findAssignmentForDate(schedule, dateKey) {
  return scheduleUtils.findAssignmentForDateWithFallback(schedule, dateKey);
}

// 顺着今天往后取未来 days 天的值班，按已发布规则版本连续顺排。
export function collectUpcoming(schedule, todayKey, days = 3) {
  return scheduleUtils.collectUpcoming(schedule, todayKey, days);
}

// 团队色圆点，对应公开页的蓝/绿/紫色标，让飞书卡片和网页视觉统一。
const TEAM_DOT = { blue: "🔵", green: "🟢", violet: "🟣", purple: "🟣", orange: "🟠", red: "🔴" };

function dutyPersonMarkdown(team) {
  // 卡片里用 <at id=...> @ 人；没配 openId 的显示姓名。
  return team.feishuOpenId ? `<at id=${team.feishuOpenId}></at>` : team.person;
}

export function buildFeishuCardMessage({ dateInfo, assignment, upcoming = [], publicUrl = DEFAULT_PUBLIC_URL }) {
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

export async function loadSchedule(path = DEFAULT_SCHEDULE_PATH) {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

export async function loadOrganizationIndex(path = DEFAULT_ORGANIZATIONS_PATH) {
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
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

export async function loadReminderState(path = DEFAULT_STATE_PATH) {
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch {
    // 文件不存在或内容损坏时，当作“从未发送过”处理
    return {};
  }
}

export function hasSentOn(state, dateKey) {
  return Boolean(state) && state.lastSentDate === dateKey;
}

export async function writeReminderState(path, dateKey) {
  await fs.writeFile(path, `${JSON.stringify({ lastSentDate: dateKey }, null, 2)}\n`, "utf8");
}

export async function postFeishuMessage(webhook, message, fetchImpl = globalThis.fetch) {
  if (!webhook) throw new Error("缺少 FEISHU_WEBHOOK。请在 GitHub Secrets 里配置飞书机器人 webhook。");
  if (!fetchImpl) throw new Error("当前 Node 环境缺少 fetch。");

  const response = await fetchImpl(webhook, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(message)
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!response.ok || (payload && payload.code !== undefined && payload.code !== 0)) {
    const detail = payload?.msg || payload?.message || payload?.raw || `HTTP ${response.status}`;
    throw new Error(`飞书机器人发送失败：${detail}`);
  }

  return payload;
}

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
  if (indexDocument === null) {
    return runSingleScheduleReminder({
      dryRun,
      force,
      schedulePath: DEFAULT_SCHEDULE_PATH,
      statePath,
      publicUrl,
      dateInfo,
      env
    });
  }
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
