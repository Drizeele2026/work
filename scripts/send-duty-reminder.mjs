import fs from "node:fs/promises";

const DEFAULT_SCHEDULE_PATH = "data/schedule.json";
const DEFAULT_STATE_PATH = "data/reminder-state.json";
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

function normalizeDateKey(dateStr) {
  return String(dateStr || "").replaceAll("/", "-");
}

function normalizeDutyTeam(team) {
  const person = typeof team?.person === "object" && team.person
    ? team.person
    : { name: team?.person };
  return {
    ...team,
    person: String(person.name || ""),
    feishuOpenId: String(team?.feishuOpenId || person.feishuOpenId || "").trim()
  };
}

export function findAssignmentForDate(schedule, dateKey) {
  const monthKey = dateKey.slice(0, 7);
  const month = schedule?.months?.[monthKey];
  if (!month) {
    throw new Error(`没有找到 ${monthKey} 的已发布排班，请先在管理页发布这个月的排班。`);
  }

  const assignment = month.dailyAssignments?.find((item) => normalizeDateKey(item.dateStr) === dateKey);
  if (!assignment) {
    throw new Error(`没有找到 ${dateKey} 的值班安排，请检查已发布排班。`);
  }

  return {
    ...assignment,
    teams: Array.isArray(assignment.teams) ? assignment.teams.map(normalizeDutyTeam) : []
  };
}

// 顺着今天往后取未来 days 天的值班（已发布数据），跨月自然顺排；缺的天跳过。
export function collectUpcoming(schedule, todayKey, days = 3) {
  const result = [];
  const base = new Date(`${todayKey}T12:00:00+08:00`); // 北京中午，避开时区边界
  for (let n = 1; n <= days; n++) {
    const info = formatBeijingDate(new Date(base.getTime() + n * 86400000));
    const month = schedule?.months?.[info.dateKey.slice(0, 7)];
    const assignment = month?.dailyAssignments?.find((item) => normalizeDateKey(item.dateStr) === info.dateKey);
    if (!assignment) continue;
    result.push({
      label: `${Number(info.dateKey.slice(5, 7))}/${Number(info.dateKey.slice(8, 10))} ${info.weekday}`,
      teams: (Array.isArray(assignment.teams) ? assignment.teams : []).map(normalizeDutyTeam)
    });
  }
  return result;
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

export async function main(argv = process.argv.slice(2), env = process.env) {
  const dryRun = argv.includes("--dry-run");
  const force = argv.includes("--force") || env.FORCE_SEND === "1";
  const schedulePath = env.SCHEDULE_PATH || DEFAULT_SCHEDULE_PATH;
  const statePath = env.REMINDER_STATE_PATH || DEFAULT_STATE_PATH;
  const publicUrl = env.PUBLIC_ROSTER_URL || DEFAULT_PUBLIC_URL;
  const dateInfo = formatBeijingDate(env.REMINDER_DATE ? new Date(env.REMINDER_DATE) : new Date());

  // dry-run 只预览消息内容，不去重、不写状态、不真的发送
  if (dryRun) {
    const schedule = await loadSchedule(schedulePath);
    const assignment = findAssignmentForDate(schedule, dateInfo.dateKey);
    const upcoming = collectUpcoming(schedule, dateInfo.dateKey, 3);
    const message = buildFeishuCardMessage({ dateInfo, assignment, upcoming, publicUrl });
    console.log(JSON.stringify(message, null, 2));
    return message;
  }

  // 去重：当天已经发过且不是强制发送，直接跳过（正常退出，不报错）
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
  // force（人工测试）不写去重状态：不占当天名额，也不影响自动触发那条
  if (!force) {
    await writeReminderState(statePath, dateInfo.dateKey);
  }
  console.log(force
    ? `已强制发送 ${dateInfo.dateKey}（force：未写入去重状态）。`
    : `已发送 ${dateInfo.dateKey} 值班提醒。`);
  return message;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
