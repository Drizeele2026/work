(function (global) {
  const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function normalizeDateKey(value) {
    const text = String(value || "").trim().replaceAll("/", "-");
    const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match) return "";
    return `${match[1]}-${pad2(Number(match[2]))}-${pad2(Number(match[3]))}`;
  }

  function dateKeyForDay(year, month, day) {
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  function monthKeyForDate(dateKey) {
    return normalizeDateKey(dateKey).slice(0, 7);
  }

  function daysBetweenDateKeys(fromKey, toKey) {
    const [fromYear, fromMonth, fromDay] = normalizeDateKey(fromKey).split("-").map(Number);
    const [toYear, toMonth, toDay] = normalizeDateKey(toKey).split("-").map(Number);
    const from = Date.UTC(fromYear, fromMonth - 1, fromDay);
    const to = Date.UTC(toYear, toMonth - 1, toDay);
    return Math.round((to - from) / 86400000);
  }

  function wrapIndex(index, length) {
    return ((index % length) + length) % length;
  }

  function normalizeMember(member) {
    if (typeof member === "string") {
      return { name: member.trim().replace(/@/g, ""), feishuOpenId: "" };
    }

    return {
      name: String(member?.name || "").trim().replace(/@/g, ""),
      feishuOpenId: String(member?.feishuOpenId || "").trim()
    };
  }

  function normalizeMembers(members) {
    return (Array.isArray(members) ? members : [])
      .map(normalizeMember)
      .filter((member) => member.name);
  }

  function normalizeDutyTeam(team, index = 0) {
    const personValue = typeof team?.person === "object" && team.person
      ? team.person
      : { name: team?.person };
    const person = normalizeMember(personValue);
    const color = typeof team?.color === "string" ? team.color : (team?.color?.name || "");
    return {
      name: String(team?.name || `团队${index + 1}`).trim(),
      person: person.name,
      feishuOpenId: String(team?.feishuOpenId || person.feishuOpenId || "").trim(),
      ...(color ? { color } : {})
    };
  }

  function normalizeAnchors(anchors, names) {
    const seen = new Map();
    (Array.isArray(anchors) ? anchors : []).forEach((anchor) => {
      const date = normalizeDateKey(anchor?.date);
      const person = String(anchor?.person || "").trim().replace(/@/g, "");
      const mode = anchor?.mode === "previousDay" ? "previousDay" : "currentDay";
      if (!date || !names.includes(person)) return;
      seen.set(date, { date, mode, person });
    });
    return [...seen.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  function normalizeTeam(team, index = 0) {
    const members = normalizeMembers(team?.members);
    return {
      name: String(team?.name || `团队${index + 1}`).trim(),
      members,
      last: String(team?.last || "").trim().replace(/@/g, ""),
      anchors: normalizeAnchors(team?.anchors, members.map((member) => member.name)),
      color: typeof team?.color === "string" ? team.color : (team?.color?.name || "")
    };
  }

  function getAnchorForDate(dateKey, anchors) {
    let active = null;
    (Array.isArray(anchors) ? anchors : []).forEach((anchor) => {
      if (anchor.date <= dateKey) active = anchor;
    });
    return active;
  }

  function getPersonFromAnchor(anchor, dateKey, names) {
    if (!anchor || !names.length) return "";
    const anchorIndex = names.indexOf(anchor.person);
    if (anchorIndex < 0) return "";
    const modeOffset = anchor.mode === "previousDay" ? 1 : 0;
    const offset = daysBetweenDateKeys(anchor.date, dateKey);
    return names[wrapIndex(anchorIndex + modeOffset + offset, names.length)];
  }

  function findPublishedAssignment(schedule, dateKey) {
    const month = schedule?.months?.[monthKeyForDate(dateKey)];
    const day = month?.dailyAssignments?.find((item) => normalizeDateKey(item.dateStr) === dateKey);
    if (!day) return null;
    return {
      ...day,
      dateStr: day.dateStr || dateKey.replaceAll("-", "/"),
      teams: (Array.isArray(day.teams) ? day.teams : []).map(normalizeDutyTeam)
    };
  }

  function findLatestSnapshotBeforeDate(schedule, dateKey, teamName) {
    let latest = null;
    Object.values(schedule?.months || {}).forEach((month) => {
      (month.dailyAssignments || []).forEach((day) => {
        const dayKey = normalizeDateKey(day.dateStr);
        if (!dayKey || dayKey >= dateKey) return;
        const team = (day.teams || []).map(normalizeDutyTeam).find((item) => item.name === teamName);
        if (team?.person && (!latest || dayKey > latest.date)) {
          latest = { date: dayKey, person: team.person };
        }
      });
    });
    return latest;
  }

  function findPublishedOpenId(schedule, teamName, personName) {
    let latest = null;
    Object.values(schedule?.months || {}).forEach((month) => {
      (month.dailyAssignments || []).forEach((day) => {
        const dayKey = normalizeDateKey(day.dateStr);
        if (!dayKey) return;
        const team = (day.teams || []).map(normalizeDutyTeam)
          .find((item) => item.name === teamName && item.person === personName && item.feishuOpenId);
        if (team && (!latest || dayKey > latest.date)) {
          latest = { date: dayKey, feishuOpenId: team.feishuOpenId };
        }
      });
    });
    return latest?.feishuOpenId || "";
  }

  function teamsFromConfig(schedule) {
    const teams = (Array.isArray(schedule?.config?.teams) ? schedule.config.teams : []).map(normalizeTeam);
    if (!teams.length) {
      throw new Error("没有找到当天值班快照，也没有可用于顺排的团队配置。请先配置成员名单和接龙节点。");
    }
    return teams;
  }

  function generateTeamForDate(schedule, team, teamIndex, dateKey) {
    const normalized = normalizeTeam(team, teamIndex);
    if (!normalized.members.length) {
      throw new Error(`团队【${normalized.name}】没有可用于顺排的成员名单。`);
    }

    const names = normalized.members.map((member) => member.name);
    const snapshot = findLatestSnapshotBeforeDate(schedule, dateKey, normalized.name);
    const anchors = [...normalized.anchors];
    if (snapshot) {
      anchors.push({ date: snapshot.date, mode: "currentDay", person: snapshot.person });
    }
    anchors.sort((a, b) => a.date.localeCompare(b.date));

    const anchor = getAnchorForDate(dateKey, anchors);
    const personName = anchor
      ? getPersonFromAnchor(anchor, dateKey, names)
      : names[wrapIndex(names.indexOf(normalized.last) + Number(dateKey.slice(8, 10)), names.length)];
    const member = normalized.members.find((item) => item.name === personName) || normalized.members[0];

    return {
      name: normalized.name,
      person: member.name,
      feishuOpenId: member.feishuOpenId || findPublishedOpenId(schedule, normalized.name, member.name),
      color: normalized.color
    };
  }

  function generatedAssignmentForDate(schedule, dateKey) {
    const [year, month, day] = normalizeDateKey(dateKey).split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return {
      day,
      dateStr: `${year}/${pad2(month)}/${pad2(day)}`,
      weekdayStr: WEEKDAYS[date.getDay()],
      teams: teamsFromConfig(schedule).map((team, index) => generateTeamForDate(schedule, team, index, dateKey))
    };
  }

  function findAssignmentForDateWithFallback(schedule, dateKey) {
    const normalizedDate = normalizeDateKey(dateKey);
    if (!normalizedDate) throw new Error(`日期格式不正确：${dateKey}`);
    return findPublishedAssignment(schedule, normalizedDate) || generatedAssignmentForDate(schedule, normalizedDate);
  }

  function formatUpcomingLabel(dateKey) {
    const [year, month, day] = dateKey.split("-").map(Number);
    return `${month}/${day} ${WEEKDAYS[new Date(year, month - 1, day).getDay()]}`;
  }

  function addDays(dateKey, days) {
    const [year, month, day] = normalizeDateKey(dateKey).split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return dateKeyForDay(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  function collectUpcoming(schedule, todayKey, days = 3) {
    const result = [];
    for (let offset = 1; offset <= days; offset++) {
      const dateKey = addDays(todayKey, offset);
      const assignment = findAssignmentForDateWithFallback(schedule, dateKey);
      result.push({ label: formatUpcomingLabel(dateKey), teams: assignment.teams });
    }
    return result;
  }

  function generateAssignmentsForMonth(schedule, year, month) {
    const firstDay = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const dailyAssignments = Array.from({ length: daysInMonth }, (_, index) =>
      findAssignmentForDateWithFallback(schedule, dateKeyForDay(year, month, index + 1))
    );
    const teams = teamsFromConfig(schedule);
    const counts = {};
    teams.forEach((team) => {
      counts[team.name] = Object.fromEntries(team.members.map((member) => [member.name, 0]));
    });
    dailyAssignments.forEach((day) => {
      day.teams.forEach((team) => {
        if (!counts[team.name]) counts[team.name] = {};
        counts[team.name][team.person] = (counts[team.name][team.person] || 0) + 1;
      });
    });
    return {
      startWeekday: (firstDay.getDay() + 6) % 7,
      daysInMonth,
      counts,
      teams,
      dailyAssignments
    };
  }

  function todayDateKey() {
    const now = new Date();
    return dateKeyForDay(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }

  function memberNamesSignature(team) {
    return normalizeMembers(team?.members).map((member) => member.name).join("\n");
  }

  function anchorSignature(anchor) {
    return anchor ? `${anchor.date}|${anchor.mode}|${anchor.person}` : "";
  }

  function anchorsSignature(anchors) {
    return (Array.isArray(anchors) ? anchors : []).map(anchorSignature).join("\n");
  }

  function firstAnchorDifferenceDate(currentAnchors, remoteAnchors) {
    const dates = [...new Set([
      ...(Array.isArray(currentAnchors) ? currentAnchors : []).map((anchor) => anchor.date),
      ...(Array.isArray(remoteAnchors) ? remoteAnchors : []).map((anchor) => anchor.date)
    ])].filter(Boolean).sort();
    return dates.find((date) =>
      anchorSignature((currentAnchors || []).find((anchor) => anchor.date === date)) !==
      anchorSignature((remoteAnchors || []).find((anchor) => anchor.date === date))
    ) || "";
  }

  function isImplicitMonthStartAnchor(current, remote, monthFirstDate) {
    if (remote.anchors.length || current.anchors.length !== 1) return false;
    const anchor = current.anchors[0];
    return current.last === remote.last &&
      anchor.date === monthFirstDate &&
      anchor.mode === "previousDay" &&
      anchor.person === current.last;
  }

  function maxDateKey(left, right) {
    const a = normalizeDateKey(left);
    const b = normalizeDateKey(right);
    if (!a) return b;
    if (!b) return a;
    return a > b ? a : b;
  }

  function anchorDifferenceDateForTeam(current, remote, monthFirstDate) {
    if (
      anchorsSignature(current.anchors) === anchorsSignature(remote.anchors) ||
      isImplicitMonthStartAnchor(current, remote, monthFirstDate)
    ) {
      return "";
    }
    return firstAnchorDifferenceDate(current.anchors, remote.anchors);
  }

  function firstAffectedDateForTeam(currentTeam, remoteTeam, monthFirstDate, publishDateKey) {
    const current = normalizeTeam(currentTeam);
    const remote = remoteTeam ? normalizeTeam(remoteTeam) : null;
    if (!remote) return publishDateKey || monthFirstDate;

    let firstAffected = "";
    if (memberNamesSignature(current) !== memberNamesSignature(remote)) {
      firstAffected = publishDateKey || monthFirstDate;
    }
    if (!current.anchors.length && !remote.anchors.length && current.last !== remote.last) {
      firstAffected = firstAffected || (publishDateKey || monthFirstDate);
    }
    firstAffected = firstAffected || anchorDifferenceDateForTeam(current, remote, monthFirstDate);

    return firstAffected ? maxDateKey(firstAffected, publishDateKey) : "";
  }

  function shouldContinueFromRemoteSeed(currentTeam, remoteTeam, monthFirstDate) {
    const current = normalizeTeam(currentTeam);
    const remote = remoteTeam ? normalizeTeam(remoteTeam) : null;
    if (!remote) return false;
    const rosterChanged = memberNamesSignature(current) !== memberNamesSignature(remote) || current.last !== remote.last;
    return rosterChanged && !anchorDifferenceDateForTeam(current, remote, monthFirstDate);
  }

  function remoteTeamsByName(remoteDocument) {
    return new Map((remoteDocument?.config?.teams || [])
      .map((team) => [normalizeTeam(team).name, team])
      .filter(([name]) => name));
  }

  function generateTeamFromRemoteSeed(remoteDocument, currentTeam, dateKey, seedDateKey, teamIndex = 0) {
    const team = normalizeTeam(currentTeam, teamIndex);
    const names = team.members.map((member) => member.name);
    if (!names.length) return normalizeDutyTeam(currentTeam, teamIndex);

    const seedAssignment = findAssignmentForDateWithFallback(remoteDocument, seedDateKey);
    const seedPerson = (seedAssignment.teams || []).find((item) => item.name === team.name)?.person;
    const anchorPerson = names.includes(seedPerson) ? seedPerson : names[0];
    const personName = getPersonFromAnchor({ date: seedDateKey, mode: "currentDay", person: anchorPerson }, dateKey, names);
    const member = team.members.find((item) => item.name === personName) || team.members[0];
    return {
      name: team.name,
      person: member.name,
      feishuOpenId: member.feishuOpenId || findPublishedOpenId(remoteDocument, team.name, member.name),
      ...(team.color ? { color: team.color } : {})
    };
  }

  function mergeGeneratedMonthWithRemote(monthEntry, remoteDocument, options = {}) {
    if (!monthEntry || !remoteDocument) return monthEntry;
    let remoteMonth = null;
    try {
      remoteMonth = generateAssignmentsForMonth(remoteDocument, monthEntry.year, monthEntry.month);
    } catch {
      return monthEntry;
    }

    const publishDateKey = normalizeDateKey(options.publishDateKey) || todayDateKey();
    const monthFirstDate = dateKeyForDay(monthEntry.year, monthEntry.month, 1);
    const remoteByTeamName = remoteTeamsByName(remoteDocument);
    const firstAffectedByTeam = new Map((monthEntry.teams || []).map((team) => {
      const name = normalizeTeam(team).name;
      return [name, firstAffectedDateForTeam(team, remoteByTeamName.get(name), monthFirstDate, publishDateKey)];
    }));
    const continueFromRemoteSeed = new Map((monthEntry.teams || []).map((team) => {
      const name = normalizeTeam(team).name;
      return [name, shouldContinueFromRemoteSeed(team, remoteByTeamName.get(name), monthFirstDate)];
    }));
    const currentConfigByName = new Map((monthEntry.teams || []).map((team) => [normalizeTeam(team).name, team]));
    const remoteDayByDate = new Map(remoteMonth.dailyAssignments.map((day) => [normalizeDateKey(day.dateStr), day]));

    monthEntry.dailyAssignments = (monthEntry.dailyAssignments || []).map((day) => {
      const dateKey = normalizeDateKey(day.dateStr);
      const remoteDay = remoteDayByDate.get(dateKey);
      if (!remoteDay) return day;

      const remoteTeamByName = new Map((remoteDay.teams || []).map((team, index) => {
        const normalized = normalizeDutyTeam(team, index);
        return [normalized.name, normalized];
      }));
      const used = new Set();
      const teams = [];

      (day.teams || []).forEach((team, index) => {
        const normalized = normalizeDutyTeam(team, index);
        const firstAffected = firstAffectedByTeam.get(normalized.name);
        const remoteTeam = remoteTeamByName.get(normalized.name);
        used.add(normalized.name);

        if (!firstAffected) {
          if (remoteTeam) teams.push(remoteTeam);
          else teams.push(team);
          return;
        }
        if (dateKey >= firstAffected) {
          if (continueFromRemoteSeed.get(normalized.name)) {
            teams.push(generateTeamFromRemoteSeed(
              remoteDocument,
              currentConfigByName.get(normalized.name) || team,
              dateKey,
              firstAffected,
              index
            ));
          } else {
            teams.push(team);
          }
          return;
        }
        if (remoteTeam) teams.push(remoteTeam);
      });

      (remoteDay.teams || []).map(normalizeDutyTeam).forEach((team) => {
        if (!used.has(team.name) && dateKey < publishDateKey) teams.push(team);
      });

      return { ...day, teams };
    });

    return monthEntry;
  }

  const api = {
    normalizeDateKey,
    dateKeyForDay,
    normalizeAnchors,
    getAnchorForDate,
    getPersonFromAnchor,
    findLatestSnapshotBeforeDate,
    findAssignmentForDateWithFallback,
    collectUpcoming,
    generateAssignmentsForMonth,
    mergeGeneratedMonthWithRemote
  };

  global.DutyRosterSchedule = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
