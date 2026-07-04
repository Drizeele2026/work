# Clean Duty Roster Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把排班系统改成“发布规则版本”模型，管理员只维护名单，历史不被后续名单修改影响。

**Architecture:** `schedule-utils.js` 成为唯一排班计算入口，公开页、管理页和飞书提醒都调用它。`data/schedule.json` 升级为 `version: 2`，使用 `current.teams` 和 `ruleVersions`，不再把 `anchors`、`last`、`months` 当正式模型。管理页删除用户可见的接龙节点和兜底起点，只在发布时由系统写入内部 `startPerson`。

**Tech Stack:** 原生 HTML/CSS/JavaScript，Node.js `node:test`，静态 JSON 数据，GitHub Pages，GitHub Contents API。

## Global Constraints

- 所有用户可见文案使用中文。
- 不引入构建工具和新依赖。
- 管理页不再展示“兜底起点”“接龙节点”“添加节点”“当天值班人”“前一天值班人”。
- 新团队没有历史时，从成员名单第一个人开始。
- 发布当天之前的排班不主动改变。
- 私下换班不进入系统。
- `startPerson` 是内部字段，不在管理页展示。
- `ruleVersions` 是新正式数据源；`anchors`、`last`、`months` 不再作为正式数据源。

---

### Task 1: 核心排班函数改成 ruleVersions

**Files:**
- Modify: `schedule-utils.js`
- Modify: `scripts/schedule-utils.test.mjs`

**Interfaces:**
- Consumes: `schedule.current.teams`, `schedule.ruleVersions[]`, 每个版本的 `effectiveDate`、`teams[]`、团队 `startPerson`
- Produces:
  - `normalizeDateKey(value: string): string`
  - `dateKeyForDay(year: number, month: number, day: number): string`
  - `findAssignmentForDateWithFallback(schedule: object, dateKey: string): object`
  - `collectUpcoming(schedule: object, todayKey: string, days?: number): array`
  - `generateAssignmentsForMonth(schedule: object, year: number, month: number): object`
  - `buildPublishedDocument(remoteDocument: object | null, currentTeams: array, options: { publishDateKey: string, updatedAt?: string }): object`

- [ ] **Step 1: Replace schedule-utils tests with rule-version tests**

Update `scripts/schedule-utils.test.mjs` so the first test fixtures use `current` and `ruleVersions` only:

```js
const schedule = {
  version: 2,
  current: {
    teams: [
      {
        name: "前端",
        color: "blue",
        members: [
          { name: "A", feishuOpenId: "ou_a" },
          { name: "B", feishuOpenId: "ou_b" },
          { name: "C", feishuOpenId: "ou_c" }
        ]
      },
      {
        name: "后端",
        color: "green",
        members: ["D", "E"]
      }
    ]
  },
  ruleVersions: [
    {
      effectiveDate: "2026-06-30",
      teams: [
        {
          name: "前端",
          color: "blue",
          startPerson: "C",
          members: [
            { name: "A", feishuOpenId: "ou_a" },
            { name: "B", feishuOpenId: "ou_b" },
            { name: "C", feishuOpenId: "ou_c" }
          ]
        },
        {
          name: "后端",
          color: "green",
          startPerson: "E",
          members: ["D", "E"]
        }
      ]
    }
  ]
};

test("findAssignmentForDateWithFallback 按规则版本计算当天值班", () => {
  const result = utils.findAssignmentForDateWithFallback(schedule, "2026-07-01");

  assert.deepEqual(result.teams.map((team) => `${team.name}:${team.person}`), [
    "前端:A",
    "后端:D"
  ]);
  assert.equal(result.teams[0].feishuOpenId, "ou_a");
});

test("generateAssignmentsForMonth 按规则版本生成整月", () => {
  const result = utils.generateAssignmentsForMonth(schedule, 2026, 7);

  assert.equal(result.daysInMonth, 31);
  assert.equal(result.dailyAssignments[0].dateStr, "2026/07/01");
  assert.deepEqual(result.dailyAssignments[0].teams.map((team) => `${team.name}:${team.person}`), [
    "前端:A",
    "后端:D"
  ]);
});

test("发布当天原值班人仍在新名单里，当天不变，后续按新名单顺排", () => {
  const remote = {
    version: 2,
    current: {
      teams: [
        { name: "测试", color: "violet", members: ["许绵绵", "郑成清", "谭贤", "钟右梅"] }
      ]
    },
    ruleVersions: [
      {
        effectiveDate: "2026-07-01",
        teams: [
          { name: "测试", color: "violet", startPerson: "谭贤", members: ["许绵绵", "郑成清", "谭贤", "钟右梅"] }
        ]
      }
    ]
  };
  const nextTeams = [
    { name: "测试", color: "violet", members: ["许绵绵", "郑成清", "谭贤", "钟右梅", "陈鸿历"] }
  ];

  const document = utils.buildPublishedDocument(remote, nextTeams, {
    publishDateKey: "2026-07-04",
    updatedAt: "2026-07-04T00:00:00.000Z"
  });

  assert.deepEqual(
    ["2026-07-03", "2026-07-04", "2026-07-05", "2026-07-06", "2026-07-07"].map((dateKey) => {
      const team = utils.findAssignmentForDateWithFallback(document, dateKey).teams[0];
      return `${dateKey}:${team.person}`;
    }),
    [
      "2026-07-03:许绵绵",
      "2026-07-04:郑成清",
      "2026-07-05:谭贤",
      "2026-07-06:钟右梅",
      "2026-07-07:陈鸿历"
    ]
  );
  assert.equal(document.ruleVersions.at(-1).teams[0].startPerson, "郑成清");
});

test("发布当天原值班人被移除，从新名单第一个人开始", () => {
  const remote = {
    version: 2,
    current: {
      teams: [
        { name: "测试", color: "violet", members: ["许绵绵", "郑成清", "谭贤"] }
      ]
    },
    ruleVersions: [
      {
        effectiveDate: "2026-07-01",
        teams: [
          { name: "测试", color: "violet", startPerson: "郑成清", members: ["许绵绵", "郑成清", "谭贤"] }
        ]
      }
    ]
  };
  const nextTeams = [
    { name: "测试", color: "violet", members: ["谭贤", "钟右梅"] }
  ];

  const document = utils.buildPublishedDocument(remote, nextTeams, {
    publishDateKey: "2026-07-03",
    updatedAt: "2026-07-03T00:00:00.000Z"
  });

  assert.equal(utils.findAssignmentForDateWithFallback(document, "2026-07-03").teams[0].person, "谭贤");
  assert.equal(document.ruleVersions.at(-1).teams[0].startPerson, "谭贤");
});

test("名单没变化时重复发布不追加规则版本", () => {
  const remote = {
    version: 2,
    current: {
      teams: [
        { name: "前端", color: "blue", members: ["A", "B"] }
      ]
    },
    ruleVersions: [
      {
        effectiveDate: "2026-07-01",
        teams: [
          { name: "前端", color: "blue", startPerson: "A", members: ["A", "B"] }
        ]
      }
    ]
  };

  const document = utils.buildPublishedDocument(remote, remote.current.teams, {
    publishDateKey: "2026-07-04",
    updatedAt: "2026-07-04T00:00:00.000Z"
  });

  assert.equal(document.ruleVersions.length, 1);
});
```

Delete the old tests named:

```text
显式 currentDay 节点优先于历史快照种子
发布当月只改名单时沿用已有计划，未变团队整月不重排
发布当月名单变化时可自动加当天节点，让变更团队从当天按新名单顺排
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
node --test scripts/schedule-utils.test.mjs
```

Expected: FAIL. The failure should mention missing `buildPublishedDocument` or old `config.teams` / `anchors` behavior.

- [ ] **Step 3: Replace core schedule-utils implementation**

In `schedule-utils.js`, keep date helpers and member normalization. Replace anchor/snapshot logic with these functions:

```js
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
    return members.findIndex((member) => {
      if (target.feishuOpenId && member.feishuOpenId) return member.feishuOpenId === target.feishuOpenId;
      return member.name === target.name;
    });
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

  function generateAssignmentsForMonth(schedule, year, month) {
    const firstDay = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const dailyAssignments = Array.from({ length: daysInMonth }, (_, index) =>
      findAssignmentForDateWithFallback(schedule, dateKeyForDay(year, month, index + 1))
    );
    const teams = teamsFromRules(schedule, dateKeyForDay(year, month, 1));
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
    const lastVersion = existingVersions.at(-1);
    const nextVersionTeams = buildVersionTeamsFromPublish(remoteDocument, normalizedTeams, publishDateKey);
    const nextVersion = { effectiveDate: publishDateKey, teams: nextVersionTeams };
    let ruleVersions = existingVersions;

    if (!lastVersion || teamsSignature(lastVersion.teams) !== teamsSignature(normalizedTeams)) {
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
```

Update the exported API at the bottom of `schedule-utils.js`:

```js
  const api = {
    normalizeDateKey,
    dateKeyForDay,
    findAssignmentForDateWithFallback,
    collectUpcoming,
    generateAssignmentsForMonth,
    buildPublishedDocument
  };
```

Delete these old functions from `schedule-utils.js`:

```text
normalizeAnchors
getAnchorForDate
getPersonFromAnchor
findPublishedAssignment
findLatestSnapshotBeforeDate
findPublishedOpenId
teamsFromConfig
generateTeamForDate
applyRosterChangeAnchors
mergeGeneratedMonthWithRemote
anchorSignature
anchorsSignature
firstAnchorDifferenceDate
isImplicitMonthStartAnchor
maxDateKey
anchorDifferenceDateForTeam
firstAffectedDateForTeam
remoteTeamsByName
findDutyPersonForTeam
```

- [ ] **Step 4: Run schedule-utils tests**

Run:

```bash
node --test scripts/schedule-utils.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add schedule-utils.js scripts/schedule-utils.test.mjs
git commit -m "refactor: use rule versions for roster calculation"
```

---

### Task 2: 飞书提醒改成新数据模型测试

**Files:**
- Modify: `scripts/send-duty-reminder.test.mjs`
- Keep: `scripts/send-duty-reminder.mjs`

**Interfaces:**
- Consumes: Task 1 的 `findAssignmentForDateWithFallback` 和 `collectUpcoming`
- Produces: 飞书提醒继续通过 `findAssignmentForDate` 和 `collectUpcoming` 取排班

- [ ] **Step 1: Replace old config/month fixtures in reminder tests**

In `scripts/send-duty-reminder.test.mjs`, replace schedule fixtures that use `config.teams`, `last`, and `months` with this shape:

```js
const schedule = {
  version: 2,
  current: {
    teams: [
      { name: "前端", color: "blue", members: [{ name: "方思琪", feishuOpenId: "ou_frontend" }, "郑刘利"] },
      { name: "后端", color: "green", members: ["李尚忠", "张家南"] },
      { name: "测试", color: "violet", members: [{ name: "谭贤", feishuOpenId: "ou_test" }, "郑成清"] }
    ]
  },
  ruleVersions: [
    {
      effectiveDate: "2026-06-19",
      teams: [
        { name: "前端", color: "blue", startPerson: "方思琪", members: [{ name: "方思琪", feishuOpenId: "ou_frontend" }, "郑刘利"] },
        { name: "后端", color: "green", startPerson: "李尚忠", members: ["李尚忠", "张家南"] },
        { name: "测试", color: "violet", startPerson: "谭贤", members: [{ name: "谭贤", feishuOpenId: "ou_test" }, "郑成清"] }
      ]
    }
  ]
};
```

Update the test named `findAssignmentForDate 没有快照但有配置时顺排生成` to:

```js
test("findAssignmentForDate 按规则版本顺排生成", () => {
  const result = findAssignmentForDate({
    version: 2,
    current: {
      teams: [
        { name: "前端", color: "blue", members: ["A", "B"] }
      ]
    },
    ruleVersions: [
      {
        effectiveDate: "2026-07-01",
        teams: [
          { name: "前端", color: "blue", startPerson: "A", members: ["A", "B"] }
        ]
      }
    ]
  }, "2026-07-02");

  assert.equal(result.dateStr, "2026/07/02");
  assert.equal(result.teams[0].person, "B");
});
```

Update the test named `collectUpcoming 在只有 6 月快照时也能预告 7 月前三天` to:

```js
test("collectUpcoming 按规则版本跨月预告", () => {
  const endOfMonth = {
    version: 2,
    current: {
      teams: [
        { name: "前端", color: "blue", members: ["A", "B", "C"] },
        { name: "后端", color: "green", members: ["D", "E"] }
      ]
    },
    ruleVersions: [
      {
        effectiveDate: "2026-06-30",
        teams: [
          { name: "前端", color: "blue", startPerson: "C", members: ["A", "B", "C"] },
          { name: "后端", color: "green", startPerson: "E", members: ["D", "E"] }
        ]
      }
    ]
  };

  const days = collectUpcoming(endOfMonth, "2026-06-30", 3);

  assert.deepEqual(days.map((day) => day.label), ["7/1 周三", "7/2 周四", "7/3 周五"]);
  assert.deepEqual(days[0].teams.map((team) => `${team.name}:${team.person}`), [
    "前端:A",
    "后端:D"
  ]);
});
```

Update `setupTmp()` so the written schedule uses `version: 2`, `current`, and `ruleVersions`:

```js
  await fs.writeFile(schedulePath, JSON.stringify({
    version: 2,
    current: {
      teams: [
        { name: "前端", color: "blue", members: [{ name: "郑刘利", feishuOpenId: "ou_x" }, "林颖"] }
      ]
    },
    ruleVersions: [
      {
        effectiveDate: "2026-06-20",
        teams: [
          { name: "前端", color: "blue", startPerson: "郑刘利", members: [{ name: "郑刘利", feishuOpenId: "ou_x" }, "林颖"] }
        ]
      }
    ]
  }));
```

- [ ] **Step 2: Run tests and verify they fail before Task 1 is applied**

Run:

```bash
node --test scripts/send-duty-reminder.test.mjs
```

Expected before Task 1: FAIL because old `schedule-utils.js` does not understand `ruleVersions`.

Expected after Task 1: PASS.

- [ ] **Step 3: Confirm send-duty-reminder.mjs needs no logic change**

Run:

```bash
rg -n "config\\.teams|last:|anchors|months" scripts/send-duty-reminder.mjs
```

Expected: no output, except `lastSentDate` if the search pattern includes `last`.

- [ ] **Step 4: Commit**

```bash
git add scripts/send-duty-reminder.test.mjs
git commit -m "test: cover reminders with rule versions"
```

---

### Task 3: 迁移 data/schedule.json 到 version 2

**Files:**
- Modify: `data/schedule.json`
- Test: `scripts/schedule-utils.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `findAssignmentForDateWithFallback`
- Produces: 一个不含 `config`、`months`、`anchors`、`last` 的 `data/schedule.json`

- [ ] **Step 1: Replace data/schedule.json with the migrated document**

Set `data/schedule.json` to this structure. Keep the real OpenID values already present in the current file:

```json
{
  "version": 2,
  "updatedAt": "2026-07-04T10:02:52.436Z",
  "current": {
    "teams": [
      {
        "name": "前端",
        "color": "blue",
        "members": [
          { "name": "郑刘利", "feishuOpenId": "ou_829dd21e1d533b92f46450f92c151a30" },
          { "name": "林颖", "feishuOpenId": "ou_318016fe4e83f3fef13c8617d4528354" },
          { "name": "林胜聪", "feishuOpenId": "ou_1e0716a8b9659de4627606233b14c890" },
          { "name": "刘红辉", "feishuOpenId": "ou_c4a291ff05c2720c22d1eea9de5c46d6" },
          { "name": "王朋伟", "feishuOpenId": "ou_1909d0073684a0991e6815ede84027b7" }
        ]
      },
      {
        "name": "后端",
        "color": "green",
        "members": [
          { "name": "綦鹏", "feishuOpenId": "ou_6a10281075f0d40d197bec40ed60e1bb" },
          { "name": "陈琦", "feishuOpenId": "ou_8b5987145cea8b2955ff132b6cf8ace0" },
          { "name": "张凯", "feishuOpenId": "ou_717c4842226d47f536884f544bba155a" },
          { "name": "张家南", "feishuOpenId": "ou_5b5297ee0c45592cb128e63903b4a161" },
          { "name": "唐宇宏", "feishuOpenId": "ou_b515205ef38d5a88161d4dfe180baba4" },
          { "name": "俞如滃", "feishuOpenId": "ou_d1dc9845c7ee23f4a5d06f7669afa51e" },
          { "name": "杨朋举", "feishuOpenId": "ou_87e96da9292a86c158d0439ec8f578fd" },
          { "name": "郭绍东", "feishuOpenId": "ou_fc0d8e2b217c6958b96e83f72cecc1e7" }
        ]
      },
      {
        "name": "测试",
        "color": "violet",
        "members": [
          { "name": "许绵绵", "feishuOpenId": "ou_92ac090c14a7f4484c5b8efafd374615" },
          { "name": "郑成清", "feishuOpenId": "ou_75648e125c0ab651e0f2defb9e80b628" },
          { "name": "谭贤", "feishuOpenId": "ou_a675026629060b973ca8d39578fdb7c5" },
          { "name": "钟右梅", "feishuOpenId": "ou_a699ef811812abeb889986b37fc997c0" },
          { "name": "陈鸿历", "feishuOpenId": "ou_a8cc7aa5cc061691f60a127e23f36340" }
        ]
      }
    ]
  },
  "ruleVersions": [
    {
      "effectiveDate": "2026-07-01",
      "teams": [
        {
          "name": "前端",
          "color": "blue",
          "startPerson": "林颖",
          "members": [
            { "name": "郑刘利", "feishuOpenId": "ou_829dd21e1d533b92f46450f92c151a30" },
            { "name": "林颖", "feishuOpenId": "ou_318016fe4e83f3fef13c8617d4528354" },
            { "name": "林胜聪", "feishuOpenId": "ou_1e0716a8b9659de4627606233b14c890" },
            { "name": "刘红辉", "feishuOpenId": "ou_c4a291ff05c2720c22d1eea9de5c46d6" },
            { "name": "王朋伟", "feishuOpenId": "ou_1909d0073684a0991e6815ede84027b7" }
          ]
        },
        {
          "name": "后端",
          "color": "green",
          "startPerson": "綦鹏",
          "members": [
            { "name": "綦鹏", "feishuOpenId": "ou_6a10281075f0d40d197bec40ed60e1bb" },
            { "name": "陈琦", "feishuOpenId": "ou_8b5987145cea8b2955ff132b6cf8ace0" },
            { "name": "张凯", "feishuOpenId": "ou_717c4842226d47f536884f544bba155a" },
            { "name": "张家南", "feishuOpenId": "ou_5b5297ee0c45592cb128e63903b4a161" },
            { "name": "唐宇宏", "feishuOpenId": "ou_b515205ef38d5a88161d4dfe180baba4" },
            { "name": "俞如滃", "feishuOpenId": "ou_d1dc9845c7ee23f4a5d06f7669afa51e" },
            { "name": "杨朋举", "feishuOpenId": "ou_87e96da9292a86c158d0439ec8f578fd" },
            { "name": "郭绍东", "feishuOpenId": "ou_fc0d8e2b217c6958b96e83f72cecc1e7" }
          ]
        },
        {
          "name": "测试",
          "color": "violet",
          "startPerson": "谭贤",
          "members": [
            { "name": "许绵绵", "feishuOpenId": "ou_92ac090c14a7f4484c5b8efafd374615" },
            { "name": "郑成清", "feishuOpenId": "ou_75648e125c0ab651e0f2defb9e80b628" },
            { "name": "谭贤", "feishuOpenId": "ou_a675026629060b973ca8d39578fdb7c5" },
            { "name": "钟右梅", "feishuOpenId": "ou_a699ef811812abeb889986b37fc997c0" }
          ]
        }
      ]
    },
    {
      "effectiveDate": "2026-07-04",
      "teams": [
        {
          "name": "前端",
          "color": "blue",
          "startPerson": "王朋伟",
          "members": [
            { "name": "郑刘利", "feishuOpenId": "ou_829dd21e1d533b92f46450f92c151a30" },
            { "name": "林颖", "feishuOpenId": "ou_318016fe4e83f3fef13c8617d4528354" },
            { "name": "林胜聪", "feishuOpenId": "ou_1e0716a8b9659de4627606233b14c890" },
            { "name": "刘红辉", "feishuOpenId": "ou_c4a291ff05c2720c22d1eea9de5c46d6" },
            { "name": "王朋伟", "feishuOpenId": "ou_1909d0073684a0991e6815ede84027b7" }
          ]
        },
        {
          "name": "后端",
          "color": "green",
          "startPerson": "张家南",
          "members": [
            { "name": "綦鹏", "feishuOpenId": "ou_6a10281075f0d40d197bec40ed60e1bb" },
            { "name": "陈琦", "feishuOpenId": "ou_8b5987145cea8b2955ff132b6cf8ace0" },
            { "name": "张凯", "feishuOpenId": "ou_717c4842226d47f536884f544bba155a" },
            { "name": "张家南", "feishuOpenId": "ou_5b5297ee0c45592cb128e63903b4a161" },
            { "name": "唐宇宏", "feishuOpenId": "ou_b515205ef38d5a88161d4dfe180baba4" },
            { "name": "俞如滃", "feishuOpenId": "ou_d1dc9845c7ee23f4a5d06f7669afa51e" },
            { "name": "杨朋举", "feishuOpenId": "ou_87e96da9292a86c158d0439ec8f578fd" },
            { "name": "郭绍东", "feishuOpenId": "ou_fc0d8e2b217c6958b96e83f72cecc1e7" }
          ]
        },
        {
          "name": "测试",
          "color": "violet",
          "startPerson": "郑成清",
          "members": [
            { "name": "许绵绵", "feishuOpenId": "ou_92ac090c14a7f4484c5b8efafd374615" },
            { "name": "郑成清", "feishuOpenId": "ou_75648e125c0ab651e0f2defb9e80b628" },
            { "name": "谭贤", "feishuOpenId": "ou_a675026629060b973ca8d39578fdb7c5" },
            { "name": "钟右梅", "feishuOpenId": "ou_a699ef811812abeb889986b37fc997c0" },
            { "name": "陈鸿历", "feishuOpenId": "ou_a8cc7aa5cc061691f60a127e23f36340" }
          ]
        }
      ]
    }
  ]
}
```

- [ ] **Step 2: Verify migrated dates**

Run:

```bash
node --input-type=module -e 'import utils from "./schedule-utils.js"; import fs from "node:fs"; const schedule = JSON.parse(fs.readFileSync("data/schedule.json", "utf8")); for (const dateKey of ["2026-07-04", "2026-07-05", "2026-07-06", "2026-07-07"]) { const day = utils.findAssignmentForDateWithFallback(schedule, dateKey); console.log(`${dateKey} ${day.teams.map((team) => `${team.name}:${team.person}`).join(" | ")}`); }'
```

Expected:

```text
2026-07-04 前端:王朋伟 | 后端:张家南 | 测试:郑成清
2026-07-05 前端:郑刘利 | 后端:唐宇宏 | 测试:谭贤
2026-07-06 前端:林颖 | 后端:俞如滃 | 测试:钟右梅
2026-07-07 前端:林胜聪 | 后端:杨朋举 | 测试:陈鸿历
```

- [ ] **Step 3: Confirm old formal fields are gone**

Run:

```bash
rg -n '"config"|"months"|"anchors"|"last"' data/schedule.json
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add data/schedule.json
git commit -m "chore: migrate schedule data to rule versions"
```

---

### Task 4: 管理页移除节点和兜底起点

**Files:**
- Modify: `admin/index.html`
- Modify: `index.html`
- Test: `scripts/verify-clean-roster-model.mjs`

**Interfaces:**
- Consumes: Task 1 的 `scheduleUtils.generateAssignmentsForMonth()` 和 `scheduleUtils.buildPublishedDocument()`
- Produces: 管理页只读写 `{ name, members, color }` 团队数据，发布时写 `version: 2` 文档

- [ ] **Step 1: Create failing UI verification script**

Create `scripts/verify-clean-roster-model.mjs`:

```js
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
  assert.match(html, /buildPublishedDocument/, `${target.label} 发布应通过共享函数生成规则版本文档`);
  assert.match(html, /维护值班规则/, `${target.label} 标题应改成维护值班规则`);
}

console.log("干净排班模型 UI 检查通过");
```

- [ ] **Step 2: Run verification and confirm it fails**

Run:

```bash
node scripts/verify-clean-roster-model.mjs
```

Expected: FAIL, first failure mentions `兜底起点` or `接龙节点`.

- [ ] **Step 3: Remove anchor/last controls from HTML**

In both `admin/index.html` and `index.html`, replace each team form grid block with a single team name field. For team 1 use:

```html
                  <div class="team-form-grid">
                    <div>
                      <label for="team1Name">团队名称</label>
                      <input id="team1Name" />
                    </div>
                  </div>
```

For team 2 use `team2Name`; for team 3 use `team3Name`.

Delete the three blocks shaped like:

```html
                  <div class="anchor-editor">
                    <div class="anchor-editor-head">
                      <label>接龙节点</label>
                      <button type="button" data-act="add-anchor" data-team="1">添加节点</button>
                    </div>
                    <div class="anchor-list" id="team1Anchors"></div>
                  </div>
```

Update the manage header:

```html
                <h2>维护值班规则</h2>
                <p>按真实值班顺序维护团队名单。发布后从今天开始使用新规则，今天之前的排班不主动改变。</p>
```

- [ ] **Step 4: Remove anchor CSS**

Delete CSS selectors for:

```text
.anchor-editor
.anchor-editor-head
.anchor-list
.anchor-row
.anchor-empty
```

Delete the responsive rule:

```css
      .anchor-row { grid-template-columns: 1fr; }
```

- [ ] **Step 5: Replace form read/write helpers**

In both HTML files, replace `readTeamFormState()`, `applyTeamFormState()`, and `simplifyTeams()` with:

```js
    function readTeamFormState() {
      return [1, 2, 3].map((index) => ({
        name: $(`team${index}Name`).value.trim(),
        members: parseMembers($(`team${index}Members`).value),
        color: teamColors[index - 1]
      }));
    }

    function applyTeamFormState(teams) {
      [1, 2, 3].forEach((index) => {
        const team = teams?.[index - 1];
        if (!team) return;
        setTeamForm(index, {
          name: team.name || "",
          members: Array.isArray(team.members) ? team.members : []
        });
      });
      syncTeamCards();
    }

    function simplifyTeams(teams) {
      return teams.map((team, index) => ({
        name: team.name,
        members: memberUtils.serializeMembers(team.members),
        color: team.color?.name || team.color || teamColors[index]?.name || ""
      }));
    }
```

Replace `setTeamForm()` with:

```js
    function setTeamForm(index, team) {
      const members = Array.isArray(team.members) ? team.members : [];
      $(`team${index}Name`).value = team.name || "";
      $(`team${index}Members`).value = memberUtils.formatMembers(members);
      renderMemberPreview(index, members);
    }
```

Delete these functions:

```text
setTeamLastOptions
currentMonthFirstDateKey
normalizeTeamAnchors
inferDisplayAnchors
readTeamAnchors
renderAnchorEditor
applyRosterChangeAnchorsToForm
getDutyPersonFromTeamsForDate
getCurrentTeamDutyPerson
```

- [ ] **Step 6: Replace buildTeamData validation**

Replace `buildTeamData()` with:

```js
    function buildTeamData() {
      const teams = [1, 2, 3].map((index) => {
        const name = $(`team${index}Name`).value.trim();
        const members = parseMembers($(`team${index}Members`).value);
        return { name, members, color: teamColors[index - 1] };
      }).filter((team) => team.name || team.members.length);

      if (!teams.length) throw new Error("至少要配置一个团队和成员名单。");

      teams.forEach((team) => {
        const names = memberUtils.memberNames(team.members);
        if (!team.name) throw new Error("团队名称不能为空。");
        if (!names.length) throw new Error(`团队【${team.name}】至少要有一个成员。`);
      });

      return teams;
    }
```

- [ ] **Step 7: Make generation use shared schedule-utils**

Replace `generateAssignments(year, month, teams)` with:

```js
    function generateAssignments(year, month, teams) {
      const schedule = scheduleUtils.buildPublishedDocument(null, simplifyTeams(teams), {
        publishDateKey: dateKeyForDay(year, month, 1),
        updatedAt: new Date().toISOString()
      });
      return scheduleUtils.generateAssignmentsForMonth(schedule, year, month);
    }
```

Replace `renderContinuousScheduleMonth()` team mapping with:

```js
      const teams = generated.teams.map((team, index) => ({
        name: team.name,
        members: memberUtils.serializeMembers(team.members),
        color: resolveTeamColor(team.color, index)
      }));
```

Inside `generateSchedule()`, delete this block:

```js
        if (options.resetSeed || !draftSeedState) {
          createDraftSeed(year, month, formTeams);
        }
        const teams = deriveTeamsForMonth(year, month);
```

Use this instead:

```js
        const teams = cloneTeamsForDraft(formTeams);
```

Update the generated state block:

```js
        lastGeneratedState = {
          year,
          month,
          monthKey: formatMonthKey(year, month),
          teams,
          configTeams: cloneTeamsForDraft(formTeams),
          result,
          summary: lastSummary,
          remotePreview: null
        };
```

Delete these draft-seed functions because month generation is no longer a published concept:

```text
createDraftSeed
deriveTeamsForMonth
```

- [ ] **Step 8: Publish version 2 document**

Replace `buildScheduleDocument(state, remoteDocument = null)` with:

```js
    function buildScheduleDocument(state, remoteDocument = null) {
      const now = new Date().toISOString();
      return scheduleUtils.buildPublishedDocument(remoteDocument, simplifyTeams(state.configTeams || state.teams), {
        publishDateKey: todayDateKey(),
        updatedAt: now
      });
    }
```

In `saveScheduleToGithub()`, change the precondition error:

```js
        throw new Error("请先维护团队名单，再发布到公开页。");
```

Delete the old months merge block:

```js
      if (remote.document?.months) {
        document.months = {
          ...remote.document.months,
          ...document.months
        };
      }
```

Change the commit message:

```js
        message: `chore: update roster rules ${todayDateKey()}`,
```

Change the publish success note:

```js
        $("notePersistence").textContent = `已发布值班规则；今天之前不主动改变，今天及以后按新规则顺排。`;
```

- [ ] **Step 9: Remove old event bindings**

In both HTML files, in `bindTeamConfigEvents()`, remove the listeners for:

```text
team${index}Last change
team${index}Anchors change
team${index}Anchors click
data-act="add-anchor"
```

Keep only team name input and member editor binding:

```js
    function bindTeamConfigEvents() {
      [1, 2, 3].forEach((index) => {
        $(`team${index}Name`).addEventListener("input", () => {
          syncTeamCards();
          setTeamConfigDirty(true);
        });
        bindMemberEditor(index);
      });
    }
```

- [ ] **Step 10: Update management copy**

Replace these status messages:

```js
        status.innerHTML = `<span><strong>下一步：修正名单</strong> · 请检查团队名称和成员名单。</span><span>修正后再发布</span>`;
        status.innerHTML = `<span><strong>下一步：发布到公开页</strong> · 点击右上按钮会保存规则并更新公开页。</span><span>失败会直接提示原因</span>`;
      status.innerHTML = `<span><strong>下一步：发布到公开页</strong> · 名单${savedText}，点击后会更新公开页。</span><span>按已发布规则预览</span>`;
```

Replace generated-month messages:

```js
            ? "当前只是查看排班。要发布变更，请进入“维护值班规则”。"
            : "已按当前名单预览排班，发布后从今天开始生效。";
```

```js
          showOk("已按当前名单预览排班。");
```

Replace `calendarSubtitle` text containing `按节点接龙` with:

```js
      $("calendarSubtitle").textContent = "按规则版本顺排";
```

- [ ] **Step 11: Run UI verification**

Run:

```bash
node scripts/verify-clean-roster-model.mjs
```

Expected: PASS.

- [ ] **Step 12: Run syntax check**

Run the script extraction check for both HTML files:

```bash
node --input-type=module -e 'import fs from "node:fs"; for (const file of ["index.html", "admin/index.html"]) { const html = fs.readFileSync(file, "utf8"); const scripts = [...html.matchAll(/<script>([\\s\\S]*?)<\\/script>/g)].map((match) => match[1]).join("\\n"); new Function(scripts); console.log(`${file} script ok`); }'
```

Expected:

```text
index.html script ok
admin/index.html script ok
```

- [ ] **Step 13: Commit**

```bash
git add index.html admin/index.html scripts/verify-clean-roster-model.mjs
git commit -m "refactor: simplify roster management flow"
```

---

### Task 5: 文档和旧校验脚本收口

**Files:**
- Modify: `README.md`
- Delete: `scripts/verify-duty-anchors.mjs`
- Modify: `docs/superpowers/specs/2026-06-22-duty-roster-anchors-design.md`
- Modify: `docs/superpowers/specs/2026-06-30-duty-reminder-continuous-roster-design.md`
- Modify: `docs/superpowers/plans/2026-06-22-duty-roster-anchors.md`
- Modify: `docs/superpowers/plans/2026-06-30-duty-reminder-continuous-roster.md`

**Interfaces:**
- Consumes: Task 4 的新管理流程
- Produces: 文档不再把接龙节点当当前能力

- [ ] **Step 1: Update README core wording**

Replace README sentences about 接龙节点 with:

```md
每个团队独立排班。前端、后端、测试各有自己的成员名单和已发布规则版本，互不影响。

- 管理员只维护团队名称、成员顺序和飞书 OpenID。
- 点击发布后，系统会记录一版从今天开始生效的规则。
- 今天之前的排班不主动改变，今天及以后按新名单顺排。
- 私下换班不进入系统，由值班同事自行处理。
```

Replace data model wording with:

```md
`current.teams` 是当前维护的团队名单。`ruleVersions` 是已经发布的规则版本，每个版本有 `effectiveDate` 和团队成员顺序。版本里的 `startPerson` 是系统内部起算人，不需要在管理页手动填写。
```

- [ ] **Step 2: Mark old specs/plans as historical**

At the top of these four old docs, add:

```md
> 这份文档是历史方案，当前实现已改为 `ruleVersions` 模型。不要再按这里的 `anchors` / `last` / 接龙节点设计继续扩展。
```

- [ ] **Step 3: Remove old anchor verifier**

Delete:

```text
scripts/verify-duty-anchors.mjs
```

Do not leave references to `verify-duty-anchors` in runtime code, README, or package-facing instructions after this task finishes.

- [ ] **Step 4: Search for stale active wording**

Run:

```bash
rg -n "兜底起点|接龙节点|添加节点|当天值班人|前一天值班人|自动生成本月排班|生成本月排班|verify-duty-anchors" README.md admin/index.html index.html schedule-utils.js scripts/send-duty-reminder.mjs scripts/*.test.mjs
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/superpowers/specs/2026-06-22-duty-roster-anchors-design.md docs/superpowers/specs/2026-06-30-duty-reminder-continuous-roster-design.md docs/superpowers/plans/2026-06-22-duty-roster-anchors.md docs/superpowers/plans/2026-06-30-duty-reminder-continuous-roster.md
git rm scripts/verify-duty-anchors.mjs
git commit -m "docs: retire manual roster anchors"
```

---

### Task 6: 全量验证和浏览器检查

**Files:**
- Read: `admin/index.html`
- Read: `index.html`
- Read: `data/schedule.json`

**Interfaces:**
- Consumes: Tasks 1-5
- Produces: 可发布的最终状态

- [ ] **Step 1: Run all Node tests**

Run:

```bash
node --test scripts/*.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run layout and clean-model verification**

Run:

```bash
node scripts/verify-readonly-layout.mjs
node scripts/verify-clean-roster-model.mjs
```

Expected:

```text
只读布局检查通过
干净排班模型 UI 检查通过
```

- [ ] **Step 3: Verify key duty dates**

Run:

```bash
node --input-type=module -e 'import utils from "./schedule-utils.js"; import fs from "node:fs"; const schedule = JSON.parse(fs.readFileSync("data/schedule.json", "utf8")); const expected = new Map([["2026-07-04", "前端:王朋伟 | 后端:张家南 | 测试:郑成清"], ["2026-07-05", "前端:郑刘利 | 后端:唐宇宏 | 测试:谭贤"], ["2026-07-06", "前端:林颖 | 后端:俞如滃 | 测试:钟右梅"], ["2026-07-07", "前端:林胜聪 | 后端:杨朋举 | 测试:陈鸿历"]]); for (const [dateKey, expectedLine] of expected) { const actual = utils.findAssignmentForDateWithFallback(schedule, dateKey).teams.map((team) => `${team.name}:${team.person}`).join(" | "); if (actual !== expectedLine) throw new Error(`${dateKey} expected ${expectedLine}, got ${actual}`); console.log(`${dateKey} ${actual}`); }'
```

Expected:

```text
2026-07-04 前端:王朋伟 | 后端:张家南 | 测试:郑成清
2026-07-05 前端:郑刘利 | 后端:唐宇宏 | 测试:谭贤
2026-07-06 前端:林颖 | 后端:俞如滃 | 测试:钟右梅
2026-07-07 前端:林胜聪 | 后端:杨朋举 | 测试:陈鸿历
```

- [ ] **Step 4: Verify reminder dry-run**

Run:

```bash
REMINDER_DATE=2026-07-04T02:00:00+08:00 node scripts/send-duty-reminder.mjs --dry-run | rg "王朋伟|张家南|郑成清|7/5 周日|唐宇宏|谭贤"
```

Expected: output contains all searched names and `7/5 周日`.

- [ ] **Step 5: Browser verify public and admin pages**

Start a static server:

```bash
python3 -m http.server 4173
```

Open:

```text
http://localhost:4173/
http://localhost:4173/admin/
```

Check:

```text
公开页 2026-07-04 显示 前端 王朋伟、后端 张家南、测试 郑成清。
管理页标题是“维护值班规则”。
管理页没有“兜底起点”“接龙节点”“添加节点”。
浏览器 Console 没有 JavaScript 报错。
```

- [ ] **Step 6: Final git check**

Run:

```bash
git status --short --branch
git log --oneline -8
```

Expected: working tree clean, branch ahead by the implementation commits created in this plan.
