import fs from "node:fs/promises";

const DEFAULT_SCHEDULE_PATH = "data/schedule.json";
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

  return assignment;
}

export function buildFeishuTextMessage({ dateInfo, assignment, publicUrl = DEFAULT_PUBLIC_URL }) {
  const dutyLines = assignment.teams.map((team) => `${team.name}：${team.person}`);
  return {
    msg_type: "text",
    content: {
      text: [
        "今日值班提醒",
        `${dateInfo.displayDate} ${dateInfo.weekday}`,
        "",
        ...dutyLines,
        "",
        `排班表：${publicUrl}`
      ].join("\n")
    }
  };
}

export async function loadSchedule(path = DEFAULT_SCHEDULE_PATH) {
  return JSON.parse(await fs.readFile(path, "utf8"));
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
  const schedulePath = env.SCHEDULE_PATH || DEFAULT_SCHEDULE_PATH;
  const publicUrl = env.PUBLIC_ROSTER_URL || DEFAULT_PUBLIC_URL;
  const dateInfo = formatBeijingDate(env.REMINDER_DATE ? new Date(env.REMINDER_DATE) : new Date());
  const schedule = await loadSchedule(schedulePath);
  const assignment = findAssignmentForDate(schedule, dateInfo.dateKey);
  const message = buildFeishuTextMessage({ dateInfo, assignment, publicUrl });

  if (dryRun) {
    console.log(JSON.stringify(message, null, 2));
    return message;
  }

  await postFeishuMessage(env.FEISHU_WEBHOOK, message);
  console.log(`已发送 ${dateInfo.dateKey} 值班提醒。`);
  return message;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
