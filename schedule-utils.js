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

  function normalizeTeam(team, index = 0) {
    const members = normalizeMembers(team?.members);
    const startPerson = String(team?.startPerson || "").trim().replace(/@/g, "");
    return {
      name: String(team?.name || `团队${index + 1}`).trim(),
      members,
      ...(startPerson ? { startPerson } : {}),
      color: typeof team?.color === "string" ? team.color : (team?.color?.name || "")
    };
  }

  function normalizeTeams(teams) {
    return (Array.isArray(teams) ? teams : [])
      .map(normalizeTeam)
      .filter((team) => team.name && team.members.length);
  }

  function mergeTeamMembers(targetTeam, members) {
    normalizeMembers(members).forEach((member) => {
      if (findMemberIndex(targetTeam.members, member) < 0) {
        targetTeam.members.push(member);
      }
    });
  }

  function collectTeamUnion(teamGroups) {
    const teamsByName = new Map();
    teamGroups.forEach((teams) => {
      normalizeTeams(teams).forEach((team) => {
        const existing = teamsByName.get(team.name);
        if (!existing) {
          teamsByName.set(team.name, {
            name: team.name,
            color: team.color,
            members: [...team.members],
            ...(team.startPerson ? { startPerson: team.startPerson } : {})
          });
          return;
        }
        if (!existing.color && team.color) existing.color = team.color;
        if (!existing.startPerson && team.startPerson) existing.startPerson = team.startPerson;
        mergeTeamMembers(existing, team.members);
      });
    });
    return [...teamsByName.values()];
  }

  function normalizeRuleVersion(version) {
    const effectiveDate = normalizeDateKey(version?.effectiveDate);
    const teams = normalizeTeams(version?.teams);
    if (!effectiveDate || !teams.length) return null;
    return { effectiveDate, teams };
  }

  function getRuleVersions(schedule) {
    const byDate = new Map();
    (Array.isArray(schedule?.ruleVersions) ? schedule.ruleVersions : [])
      .map(normalizeRuleVersion)
      .filter(Boolean)
      .forEach((version) => byDate.set(version.effectiveDate, version));
    return [...byDate.values()].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  }

  function getCurrentTeams(schedule) {
    return normalizeTeams(schedule?.current?.teams);
  }

  function memberKey(member) {
    return member.feishuOpenId || member.name;
  }

  function findMemberIndex(members, personOrMember) {
    const target = normalizeMember(personOrMember);
    if (!target.name && !target.feishuOpenId) return -1;
    if (target.feishuOpenId) {
      const openIdIndex = members.findIndex((member) => member.feishuOpenId === target.feishuOpenId);
      if (openIdIndex >= 0) return openIdIndex;
    }
    if (target.name) {
      return members.findIndex((member) => member.name === target.name);
    }
    return -1;
  }

  function teamSignature(team) {
    const normalized = normalizeTeam(team);
    return [
      normalized.name,
      normalized.color,
      normalized.members.map((member) => `${member.name}|${member.feishuOpenId}`).join(";")
    ].join("\n");
  }

  function teamsSignature(teams) {
    return normalizeTeams(teams).map(teamSignature).join("\n---\n");
  }

  function findVersionIndexForDate(versions, dateKey, maxIndex = versions.length - 1) {
    let active = -1;
    versions.forEach((version, index) => {
      if (index <= maxIndex && version.effectiveDate <= dateKey) active = index;
    });
    return active;
  }

  function findTeamByName(teams, teamName) {
    return (teams || []).find((team) => team.name === teamName) || null;
  }

  function getTeamDutyFromVersion(versions, versionIndex, teamName, dateKey) {
    const version = versions[versionIndex];
    const team = findTeamByName(version?.teams, teamName);
    if (!version || !team || !team.members.length) return null;

    let startIndex = findMemberIndex(team.members, { name: team.startPerson });
    if (startIndex < 0 && versionIndex > 0) {
      const previousDuty = getTeamDutyAt(versions, versionIndex - 1, teamName, version.effectiveDate);
      startIndex = findMemberIndex(team.members, previousDuty?.member || { name: previousDuty?.person || "" });
    }
    if (startIndex < 0) startIndex = 0;

    const offset = daysBetweenDateKeys(version.effectiveDate, dateKey);
    const member = team.members[wrapIndex(startIndex + offset, team.members.length)];
    return {
      name: team.name,
      person: member.name,
      member,
      feishuOpenId: member.feishuOpenId,
      color: team.color
    };
  }

  function getTeamDutyAt(versions, maxVersionIndex, teamName, dateKey) {
    const activeIndex = findVersionIndexForDate(versions, dateKey, maxVersionIndex);
    if (activeIndex < 0) return null;
    return getTeamDutyFromVersion(versions, activeIndex, teamName, dateKey);
  }

  function teamsFromRules(schedule, dateKey) {
    const versions = getRuleVersions(schedule);
    const activeIndex = findVersionIndexForDate(versions, dateKey);
    if (activeIndex >= 0) return versions[activeIndex].teams;

    const currentTeams = getCurrentTeams(schedule);
    if (currentTeams.length) {
      return currentTeams.map((team) => ({
        ...team,
        startPerson: team.startPerson || team.members[0]?.name || ""
      }));
    }

    throw new Error("没有可用于顺排的团队规则。请先维护团队成员并发布。");
  }

  function generatedAssignmentForDate(schedule, dateKey) {
    const normalizedDate = normalizeDateKey(dateKey);
    const [year, month, day] = normalizedDate.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    const versions = getRuleVersions(schedule);
    const activeIndex = findVersionIndexForDate(versions, normalizedDate);
    const teams = teamsFromRules(schedule, normalizedDate);
    const dutyTeams = activeIndex >= 0
      ? teams.map((team) => getTeamDutyFromVersion(versions, activeIndex, team.name, normalizedDate))
      : teams.map((team) => {
          const member = team.members[0];
          return {
            name: team.name,
            person: member.name,
            feishuOpenId: member.feishuOpenId,
            color: team.color
          };
        });

    return {
      day,
      dateStr: `${year}/${pad2(month)}/${pad2(day)}`,
      weekdayStr: WEEKDAYS[date.getDay()],
      teams: dutyTeams.filter(Boolean).map(({ member, ...team }) => team)
    };
  }

  function findAssignmentForDateWithFallback(schedule, dateKey) {
    const normalizedDate = normalizeDateKey(dateKey);
    if (!normalizedDate) throw new Error(`日期格式不正确：${dateKey}`);
    return generatedAssignmentForDate(schedule, normalizedDate);
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
    const monthStartKey = dateKeyForDay(year, month, 1);
    const monthEndKey = dateKeyForDay(year, month, daysInMonth);
    const dailyAssignments = Array.from({ length: daysInMonth }, (_, index) =>
      findAssignmentForDateWithFallback(schedule, dateKeyForDay(year, month, index + 1))
    );
    const versions = getRuleVersions(schedule);
    const activeTeamsInMonth = [
      teamsFromRules(schedule, monthStartKey),
      ...versions
        .filter((version) => version.effectiveDate >= monthStartKey && version.effectiveDate <= monthEndKey)
        .map((version) => version.teams),
      ...dailyAssignments.map((day) =>
        day.teams.map((team) => ({
          name: team.name,
          color: team.color,
          members: [{ name: team.person, feishuOpenId: team.feishuOpenId }]
        }))
      )
    ];
    const teams = collectTeamUnion(activeTeamsInMonth);
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

  function buildVersionTeamsFromPublish(remoteDocument, currentTeams, publishDateKey) {
    const versions = getRuleVersions(remoteDocument);
    const remoteActiveIndex = findVersionIndexForDate(versions, publishDateKey);
    const normalizedTeams = normalizeTeams(currentTeams);
    return normalizedTeams.map((team) => {
      let startPerson = team.members[0]?.name || "";
      if (remoteActiveIndex >= 0) {
        const previousDuty = getTeamDutyAt(versions, remoteActiveIndex, team.name, publishDateKey);
        const previousIndex = findMemberIndex(team.members, previousDuty?.member || { name: previousDuty?.person || "" });
        if (previousIndex >= 0) startPerson = team.members[previousIndex].name;
      }
      return { ...team, startPerson };
    });
  }

  function buildPublishedDocument(remoteDocument, currentTeams, options = {}) {
    const publishDateKey = normalizeDateKey(options.publishDateKey) || todayDateKey();
    const updatedAt = options.updatedAt || new Date().toISOString();
    const normalizedTeams = normalizeTeams(currentTeams);
    if (!normalizedTeams.length) throw new Error("至少要配置一个团队和成员名单。");

    const existingVersions = getRuleVersions(remoteDocument);
    const activeVersionIndex = findVersionIndexForDate(existingVersions, publishDateKey);
    const activeVersion = activeVersionIndex >= 0 ? existingVersions[activeVersionIndex] : null;
    const nextVersionTeams = buildVersionTeamsFromPublish(remoteDocument, normalizedTeams, publishDateKey);
    const nextVersion = { effectiveDate: publishDateKey, teams: nextVersionTeams };
    let ruleVersions = existingVersions;

    if (!activeVersion || teamsSignature(activeVersion.teams) !== teamsSignature(normalizedTeams)) {
      ruleVersions = existingVersions.filter((version) => version.effectiveDate !== publishDateKey);
      ruleVersions.push(nextVersion);
      ruleVersions.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    }

    return {
      version: 2,
      updatedAt,
      current: { teams: normalizedTeams },
      ruleVersions
    };
  }

  const api = {
    normalizeDateKey,
    dateKeyForDay,
    findAssignmentForDateWithFallback,
    collectUpcoming,
    generateAssignmentsForMonth,
    buildPublishedDocument
  };

  global.DutyRosterSchedule = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
