(function () {
  const workbenchScriptUrl = document.currentScript.src;

  async function mountWorkbench() {
    const fragmentUrl = new URL("./workbench-fragment.html", workbenchScriptUrl);
    const response = await fetch(fragmentUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("排班工作台加载失败：HTTP " + response.status);
    }
    document.body.innerHTML = await response.text();
    startWorkbench();
  }

  function startWorkbench() {
      const weekdayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
      const weekdayNamesByDate = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
      const teamColors = [
        { name: "blue", bg: "#e4ecff", text: "#2446b3" },
        { name: "green", bg: "#def6ec", text: "#0f7b55" },
        { name: "violet", bg: "#eee7ff", text: "#663bdf" }
      ];
      const teamColorMap = Object.fromEntries(teamColors.map((color) => [color.name, color]));

      const DEFAULT_CONFIG = {
        team1Name: "前端",
        team1Members: ["郑刘利", "林颖", "林胜聪", "刘红辉", "方思琪"],
        team2Name: "后端",
        team2Members: ["綦鹏", "陈琦", "张凯", "张家南", "李尚忠", "俞如滃", "杨朋举", "郭绍东"],
        team3Name: "测试",
        team3Members: ["许绵绵", "郑成清", "谭贤", "钟右梅"]
      };

      const $ = (id) => document.getElementById(id);
      const memberUtils = window.DutyRosterMembers;
      const orgUtils = window.DutyRosterOrganizations;
      const scheduleUtils = window.DutyRosterSchedule;
      const publicationUtils = window.DutyRosterPublication;
      const LS_TOKEN = "duty-roster-token";
      const LS_REPO = "duty-roster-repo";
      const DEFAULT_REPO = "Drizeele2026/work";
      const ORGANIZATIONS_FILE = orgUtils.ORGANIZATIONS_PATH;
      const PUBLISH_LOADING_MIN_MS = 800;
      let pendingMonth = null;
      let persistedMonth = null;
      let lastGeneratedMonthGridHTML = "";
      let lastGeneratedMonthGridPlain = "";
      let lastSummary = [];
      let githubState = { repoSlug: DEFAULT_REPO, token: "" };
      let lastGeneratedState = null;
      let currentView = isAdminRoute() ? "manage" : "schedule";
      let teamConfigDirty = false;
      let teamConfigSavedAt = null;
      let confirmationReady = false;
      let organizationIndexDocument = null;
      let currentOrganization = null;
      let remoteScheduleDocument = null;

      function pad2(num) {
        return String(num).padStart(2, "0");
      }

      function escapeHtml(text) {
        return String(text)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }

      function formatMonthKey(year, month) {
        return `${year}-${pad2(month)}`;
      }

      function isAdminRoute() {
        const configuredRoute = document.documentElement.dataset.route;
        if (configuredRoute) return configuredRoute === "admin";
        const path = window.location.pathname.replace(/\/+$/, "");
        return path.endsWith("/admin") || path.endsWith("/admin/index.html");
      }

      function getRequestedOrgSlug() {
        return new URLSearchParams(window.location.search).get("org") || "";
      }

      function getCurrentSchedulePath() {
        return currentOrganization?.schedulePath || orgUtils.LEGACY_SCHEDULE_PATH;
      }

      function getScheduleUrl() {
        return orgUtils.relativeDataPath(getCurrentSchedulePath(), isAdminRoute());
      }

      function getOrganizationsUrl() {
        return orgUtils.relativeDataPath(ORGANIZATIONS_FILE, isAdminRoute());
      }

      function getPublicPageUrl() {
        const base = isAdminRoute() ? "../" : "./";
        if (!currentOrganization || currentOrganization.slug === "default") return base;
        return `${base}?org=${encodeURIComponent(currentOrganization.slug)}`;
      }

      function shiftMonthValue(year, month, delta) {
        const date = new Date(year, month - 1 + delta, 1);
        return { year: date.getFullYear(), month: date.getMonth() + 1 };
      }

      function monthSerial(year, month) {
        return year * 12 + month - 1;
      }

      function monthFromSerial(serial) {
        return { year: Math.floor(serial / 12), month: (serial % 12) + 1 };
      }

      function daysInMonthValue(year, month) {
        return new Date(year, month, 0).getDate();
      }

      function monthStartDayOffset(fromYear, fromMonth, toYear, toMonth) {
        const from = monthSerial(fromYear, fromMonth);
        const to = monthSerial(toYear, toMonth);
        if (from === to) return 0;

        let days = 0;
        if (to > from) {
          for (let serial = from; serial < to; serial++) {
            const item = monthFromSerial(serial);
            days += daysInMonthValue(item.year, item.month);
          }
          return days;
        }

        for (let serial = to; serial < from; serial++) {
          const item = monthFromSerial(serial);
          days -= daysInMonthValue(item.year, item.month);
        }
        return days;
      }

      function wrapIndex(index, length) {
        return ((index % length) + length) % length;
      }

      function resolveTeamColor(color, fallbackIndex = 0) {
        const name = typeof color === "string" ? color : color?.name;
        return teamColorMap[name] || teamColors[fallbackIndex % teamColors.length] || teamColors[0];
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

      function nowTime() {
        const now = new Date();
        return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
      }

      function setCurrentYearMonth() {
        const now = new Date();
        $("year").value = now.getFullYear();
        $("month").value = now.getMonth() + 1;
      }

      function setTeamForm(index, team) {
        const members = Array.isArray(team.members) ? team.members : [];
        $(`team${index}Name`).value = team.name || "";
        $(`team${index}Members`).value = memberUtils.formatMembers(members);
        renderMemberPreview(index, members);
      }

      function renderMemberPreview(index, members) {
        const preview = $(`team${index}Preview`);
        if (!preview) return;
        const rows = members.map((member, i) => {
          const name = memberUtils.memberName(member);
          const oid = memberUtils.memberOpenId(member);
          return `
            <div class="mrow" data-i="${i}">
              <span class="mrow-grip" draggable="true" title="拖动排序" aria-hidden="true">⠿</span>
              <div class="mrow-main">
                <span class="mrow-order">${i + 1}</span>
                <input class="mrow-name" type="text" value="${escapeHtml(name)}" data-act="name" aria-label="成员姓名">
                <button type="button" class="mrow-id ${oid ? "on" : ""}" data-act="toggleid" title="飞书 OpenID（用于 @ 人）">${oid ? "已配 ID" : "配 ID"}</button>
              </div>
              <button type="button" class="mrow-del" data-act="del" title="删除">✕</button>
              <div class="mrow-id-edit" hidden>
                <input class="mrow-oid" type="text" value="${escapeHtml(oid)}" placeholder="飞书 OpenID，形如 ou_xxx；留空则只显示姓名、不 @" data-act="oid" aria-label="飞书 OpenID">
              </div>
            </div>`;
        }).join("");
        const emptyHint = members.length ? "" : `<div class="mrow-empty">还没有成员，在下面添加第一个</div>`;
        preview.innerHTML = `${emptyHint}${rows}
          <div class="mrow-add">
            <input class="mrow-addname" type="text" placeholder="输入姓名，回车或点「添加」" data-act="addname" aria-label="添加成员">
            <button type="button" class="mrow-addbtn" data-act="add">添加</button>
          </div>`;
      }

      function commitMembers(index, members) {
        $(`team${index}Members`).value = memberUtils.formatMembers(members);
        syncTeamCards();
        setTeamConfigDirty(true);
      }

      function addMemberFromInput(index) {
        const input = $(`team${index}Preview`).querySelector(".mrow-addname");
        if (!input) return;
        const name = input.value.trim().replace(/@/g, "");
        if (!name) return;
        const members = parseMembers($(`team${index}Members`).value);
        members.push({ name, feishuOpenId: "" });
        commitMembers(index, members);
        $(`team${index}Preview`).querySelector(".mrow-addname")?.focus();
      }

      function bindMemberEditor(index) {
        const box = $(`team${index}Preview`);
        if (!box) return;
        box.addEventListener("click", (event) => {
          const act = event.target.dataset?.act;
          if (!act) return;
          const row = event.target.closest(".mrow");
          const i = row ? Number(row.dataset.i) : -1;
          const members = parseMembers($(`team${index}Members`).value);
          if (act === "add") {
            addMemberFromInput(index);
          } else if (act === "del" && i >= 0) {
            members.splice(i, 1);
            commitMembers(index, members);
          } else if (act === "toggleid" && row) {
            const editor = row.querySelector(".mrow-id-edit");
            editor.hidden = !editor.hidden;
            if (!editor.hidden) editor.querySelector("input")?.focus();
          }
        });
        let dragFrom = null;
        box.addEventListener("dragstart", (event) => {
          const grip = event.target.closest(".mrow-grip");
          const row = grip && grip.closest(".mrow");
          if (!row) { event.preventDefault(); return; }
          dragFrom = Number(row.dataset.i);
          row.classList.add("dragging");
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", String(dragFrom));
        });
        box.addEventListener("dragover", (event) => {
          if (dragFrom === null) return;
          event.preventDefault();
          const row = event.target.closest(".mrow");
          box.querySelectorAll(".drag-over").forEach((r) => r.classList.remove("drag-over"));
          if (row) row.classList.add("drag-over");
        });
        box.addEventListener("drop", (event) => {
          if (dragFrom === null) return;
          event.preventDefault();
          const row = event.target.closest(".mrow");
          if (row) {
            const to = Number(row.dataset.i);
            if (to !== dragFrom) {
              const members = parseMembers($(`team${index}Members`).value);
              const [moved] = members.splice(dragFrom, 1);
              members.splice(to, 0, moved);
              commitMembers(index, members);
            }
          }
          dragFrom = null;
        });
        box.addEventListener("dragend", () => {
          box.querySelectorAll(".dragging, .drag-over").forEach((r) => r.classList.remove("dragging", "drag-over"));
          dragFrom = null;
        });
        box.addEventListener("change", (event) => {
          const act = event.target.dataset?.act;
          const row = event.target.closest(".mrow");
          if (!row || (act !== "name" && act !== "oid")) return;
          const i = Number(row.dataset.i);
          const members = parseMembers($(`team${index}Members`).value);
          if (!members[i]) return;
          if (act === "name") {
            const name = event.target.value.trim().replace(/@/g, "");
            if (!name) { syncTeamCards(); return; }  // 不允许空名，恢复原值
            members[i] = { name, feishuOpenId: memberUtils.memberOpenId(members[i]) };
          } else {
            members[i] = { name: memberUtils.memberName(members[i]), feishuOpenId: event.target.value.trim() };
          }
          commitMembers(index, members);
        });
        box.addEventListener("keydown", (event) => {
          if (event.key === "Enter" && event.target.dataset?.act === "addname") {
            event.preventDefault();
            addMemberFromInput(index);
          }
        });
      }

      function syncTeamCards() {
        [1, 2, 3].forEach((index) => {
          const name = $(`team${index}Name`).value.trim() || `团队 ${index}`;
          const members = parseMembers($(`team${index}Members`).value);
          $(`team${index}Title`).textContent = name;
          $(`team${index}Count`).textContent = `${members.length} 人`;
          renderMemberPreview(index, members);
        });
      }

      function setTeamConfigDirty(isDirty) {
        teamConfigDirty = isDirty;
        if (isDirty) {
          teamConfigSavedAt = null;
          pendingMonth = null;
          persistedMonth = null;
          lastGeneratedState = null;
          confirmationReady = false;
          resetConfirmChecks();
        }
        renderTeamConfigStatus();
        renderConfirmView();
        syncTopbar();
      }

      function setTeamNextAction(label, tone = "primary", disabled = false) {
        const button = $("teamNextActionBtn");
        if (!button) return;
        button.textContent = label;
        button.className = tone;
        button.disabled = disabled;
      }

      function renderTeamConfigStatus(messageType = "") {
        const status = $("teamConfigStatus");
        if (!status) return;
        if (messageType === "error") {
          status.className = "status-strip danger";
          status.innerHTML = `<span><strong>下一步：修正名单</strong> · 请检查团队名称和成员名单。</span><span>修正后再发布</span>`;
          setTeamNextAction("修正后发布");
          return;
        }
        if (teamConfigDirty) {
          status.className = "status-strip";
          const detail = teamConfigSavedAt
            ? `名单已保存 ${teamConfigSavedAt}，尚未发布。`
            : "点击右上按钮会保存规则并更新公开页。";
          status.innerHTML = `<span><strong>下一步：发布到公开页</strong> · ${detail}</span><span>失败会直接提示原因</span>`;
          setTeamNextAction("发布到公开页");
          return;
        }
        if (persistedMonth) {
          status.className = "status-strip success";
          status.innerHTML = `<span><strong>已发布到公开页</strong> · 当前名单和排班已经更新。</span><span>修改名单后可再次发布</span>`;
          setTeamNextAction("已发布", "success", true);
          return;
        }
        status.className = "status-strip success";
        const savedText = teamConfigSavedAt ? `已保存 ${teamConfigSavedAt}` : "已保存到本机";
        status.innerHTML = `<span><strong>下一步：发布到公开页</strong> · 名单${savedText}，点击后会更新公开页。</span><span>按已发布规则预览</span>`;
        setTeamNextAction("发布到公开页");
      }

      function resetConfirmChecks() {}

      function setTeamPublishMessage(type, message) {
        const box = $("teamPublishMessage");
        if (!box) return;
        box.className = `message ${type}`;
        box.style.display = "block";
        box.textContent = message;
      }

      function clearTeamPublishMessage() {
        const box = $("teamPublishMessage");
        if (!box) return;
        box.className = "message info";
        box.style.display = "none";
        box.textContent = "";
      }

      function renderConfirmView() {}
      function updateConfirmPublishState() {}

      function applyDefaultMembers() {
        setTeamForm(1, {
          name: DEFAULT_CONFIG.team1Name,
          members: DEFAULT_CONFIG.team1Members
        });
        setTeamForm(2, {
          name: DEFAULT_CONFIG.team2Name,
          members: DEFAULT_CONFIG.team2Members
        });
        setTeamForm(3, {
          name: DEFAULT_CONFIG.team3Name,
          members: DEFAULT_CONFIG.team3Members
        });
        syncTeamCards();
      }

      function populateMonthPicker(baseYear, baseMonth) {
        const picker = $("monthPicker");
        const selected = formatMonthKey(Number($("year").value), Number($("month").value));
        picker.innerHTML = "";
        for (let offset = -6; offset <= 17; offset++) {
          const date = new Date(baseYear, baseMonth - 1 + offset, 1);
          const year = date.getFullYear();
          const month = date.getMonth() + 1;
          const option = document.createElement("option");
          option.value = formatMonthKey(year, month);
          option.textContent = `${year} 年 ${month} 月`;
          picker.appendChild(option);
        }
        picker.value = selected;
      }

      function updateMonthLabels(year, month) {
        const prev = shiftMonthValue(year, month, -1);
        const next = shiftMonthValue(year, month, 1);
        if ($("currentMonthLabel")) $("currentMonthLabel").textContent = formatMonthKey(year, month);
        if ($("prevMonthLabel")) $("prevMonthLabel").textContent = formatMonthKey(prev.year, prev.month);
        if ($("nextMonthLabel")) $("nextMonthLabel").textContent = formatMonthKey(next.year, next.month);
        $("monthPicker").value = formatMonthKey(year, month);
        if ($("inspectorMonth")) $("inspectorMonth").textContent = formatMonthKey(year, month);
      }

      function parseMembers(text) {
        return memberUtils.parseMembers(text);
      }

      function showError(message) {
        if (!$("errorBox") || !$("okBox")) return;
        $("errorBox").style.display = "block";
        $("errorBox").textContent = message;
        $("okBox").style.display = "none";
      }

      function showOk(message) {
        if (!$("errorBox") || !$("okBox")) return;
        $("okBox").style.display = "block";
        $("okBox").textContent = message;
        $("errorBox").style.display = "none";
      }

      function clearMessages() {
        if (!$("errorBox") || !$("okBox")) return;
        $("errorBox").style.display = "none";
        $("okBox").style.display = "none";
        $("errorBox").textContent = "";
        $("okBox").textContent = "";
      }

      let toastTimer = null;
      function showToast(message, type = "ok") {
        const toast = $("toast");
        if (!toast) return;
        window.clearTimeout(toastTimer);
        toast.className = `toast ${type === "error" ? "error" : ""}`;
        toast.textContent = message;
        requestAnimationFrame(() => {
          toast.classList.add("visible");
        });
        toastTimer = window.setTimeout(() => {
          toast.classList.remove("visible");
        }, 1800);
      }

      function getSaveStatus() {
        if (teamConfigDirty) {
          return {
            tone: "warn",
            label: "待发布",
            detail: teamConfigSavedAt ? "草稿已保存" : "名单已修改",
            rail: "名单未发布"
          };
        }
        if (pendingMonth) {
          return {
            tone: "warn",
            label: "待发布",
            detail: `${pendingMonth} 排班已生成`,
            rail: "待发布公开页"
          };
        }
        if (persistedMonth) {
          return {
            tone: "success",
            label: "已发布",
            detail: `${persistedMonth} 公开页已更新`,
            rail: "已发布到公开页"
          };
        }
        return {
          tone: "warn",
          label: "未发布",
          detail: "本机配置",
          rail: "公开页未更新"
        };
      }

      function syncTopbar() {
        const hasToken = isAdminMode() && Boolean(localStorage.getItem(LS_TOKEN));
        const saveStatus = getSaveStatus();
        $("repoChip").innerHTML = `<strong>仓库</strong> · ${githubState.repoSlug || DEFAULT_REPO}`;
        $("tokenChip").innerHTML = `<strong>token</strong> · ${hasToken ? "已配置" : "未配置"}`;
        $("saveChip").className = `chip chip-button admin-only ${saveStatus.tone}`;
        $("saveChip").innerHTML = `<strong>${saveStatus.label}</strong> · ${saveStatus.detail}`;
        if ($("dirtyState")) $("dirtyState").textContent = saveStatus.rail;
      }

      function isAdminMode() {
        return isAdminRoute();
      }

      function applyViewState() {
        const admin = isAdminMode();
        document.body.classList.toggle("admin-mode", admin);
        if (!admin && (currentView === "manage" || currentView === "confirm")) {
          currentView = "schedule";
        } else if (admin && currentView === "confirm") {
          currentView = "manage";
        }

        document.querySelectorAll(".nav-link").forEach((button) => {
          button.classList.toggle("active", button.dataset.view === currentView);
        });

        const isAbout = currentView === "about";
        const isManage = admin && currentView === "manage";
        const isConfirm = false;
        document.body.classList.toggle("confirm-mode", isConfirm);
        $("aboutView").classList.toggle("visible", isAbout);
        $("manageView").classList.toggle("visible", isManage);
        $("scheduleView").style.display = isAbout || isManage || isConfirm ? "none" : "";
        $("adminSummaryView").style.display = admin && !isAbout && !isManage && !isConfirm ? "block" : "none";
        const orgName = currentOrganization?.name || "默认组织";
        $("brandSub").textContent = admin ? `管理排班 · ${orgName}` : `公开查看 · ${orgName}`;
        renderConfirmView();
      }

      function normalizeRepoSlug(value) {
        return String(value || "").trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
      }

      function setGithubMessage(type, message) {
        const box = $("githubMessage");
        if (!box) return;
        box.className = `message ${type}`;
        box.style.display = "block";
        box.textContent = message;
      }

      function clearGithubMessage() {
        const box = $("githubMessage");
        if (!box) return;
        box.className = "message info";
        box.style.display = "none";
        box.textContent = "";
      }

      function readGithubSettings() {
        const repoSlug = normalizeRepoSlug($("repoSlug")?.value || githubState.repoSlug || DEFAULT_REPO);
        const token = String($("githubToken")?.value || githubState.token || localStorage.getItem(LS_TOKEN) || "").trim();
        return { repoSlug, token };
      }

      function applyGithubSettings(settings) {
        githubState = {
          repoSlug: normalizeRepoSlug(settings.repoSlug || DEFAULT_REPO) || DEFAULT_REPO,
          token: String(settings.token || "").trim()
        };
        $("repoSlug").value = githubState.repoSlug;
        $("githubToken").value = githubState.token;
      }

      function persistGithubSettings(settings) {
        applyGithubSettings(settings);
        localStorage.setItem(LS_REPO, githubState.repoSlug);
        if (githubState.token) {
          localStorage.setItem(LS_TOKEN, githubState.token);
        } else {
          localStorage.removeItem(LS_TOKEN);
        }
        syncTopbar();
      }

      function readTeamFormState() {
        return [1, 2, 3].map((index) => ({
          name: $(`team${index}Name`).value.trim(),
          members: parseMembers($(`team${index}Members`).value),
          color: teamColors[index - 1]
        }));
      }

      function createCurrentPublication() {
        if (!publicationUtils?.createPublication) {
          throw new Error("规则发布 module 不可用。");
        }
        return publicationUtils.createPublication({
          organization: currentOrganization,
          settings: readGithubSettings(),
          storage: localStorage,
          fetchImpl: window.fetch.bind(window),
          scheduleUtils,
          clock: () => new Date()
        });
      }

      function markTeamDraftSaved(draft = null, options = {}) {
        const savedAt = new Date(draft?.savedAtIso || "");
        teamConfigSavedAt = Number.isNaN(savedAt.getTime())
          ? nowTime()
          : `${pad2(savedAt.getHours())}:${pad2(savedAt.getMinutes())}`;
        teamConfigDirty = !(options.published === true || draft?.published === true);
        renderTeamConfigStatus();
        renderConfirmView();
        syncTopbar();
      }

      function applyTeamFormState(teams) {
        [1, 2, 3].forEach((index) => setTeamForm(index, { name: "", members: [] }));
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

      function stageTeamDraft() {
        const draft = createCurrentPublication().stageDraft(
          simplifyTeams(readTeamFormState()),
          remoteScheduleDocument
        );
        markTeamDraftSaved(draft);
        return draft;
      }

      function restoreTeamDraft(remotePreview = null) {
        const draft = createCurrentPublication().restoreDraft(remotePreview);
        if (!draft) return false;
        applyTeamFormState(draft.teams);
        markTeamDraftSaved(draft);
        return true;
      }

      function loadGithubSettingsFromStorage() {
        const storedRepo = normalizeRepoSlug(localStorage.getItem(LS_REPO) || DEFAULT_REPO) || DEFAULT_REPO;
        const storedToken = String(localStorage.getItem(LS_TOKEN) || "").trim();
        applyGithubSettings({ repoSlug: storedRepo, token: storedToken });
        $("manageDetails").open = false;
      }

      function loadLocalUiState(remotePreview = null) {
        return isAdminRoute() ? restoreTeamDraft(remotePreview) : false;
      }

      function openGithubSettings(targetId) {
        $("manageDetails").open = true;
        applyViewState();
        $("githubBox").scrollIntoView({ block: "nearest" });
        if (targetId && $(targetId)) {
          $(targetId).focus();
        }
        syncTopbar();
      }

      function openPublishPanel() {
        currentView = "manage";
        applyViewState();
        $("teamNextActionBtn")?.focus();
        $("manageView").scrollIntoView({ block: "start" });
        syncTopbar();
      }

      function simplifyTeams(teams) {
        return teams.map((team, index) => ({
          name: team.name,
          members: memberUtils.serializeMembers(team.members),
          color: team.color?.name || team.color || teamColors[index]?.name || ""
        }));
      }

      function cloneTeamsForDraft(teams) {
        return teams.map((team) => ({
          name: team.name,
          members: memberUtils.serializeMembers(team.members),
          color: team.color
        }));
      }

      function simplifyAssignments(dailyAssignments) {
        return dailyAssignments.map((item) => ({
          day: item.day,
          dateStr: item.dateStr,
          weekdayStr: item.weekdayStr,
          teams: item.teams.map((team) => ({
            name: team.name,
            person: team.person,
            ...(team.feishuOpenId ? { feishuOpenId: team.feishuOpenId } : {}),
            color: team.color?.name || team.color || ""
          }))
        }));
      }

      function buildSummaryFromAssignments(teams, dailyAssignments) {
        const counts = {};
        teams.forEach((team) => {
          counts[team.name] = Object.fromEntries(memberUtils.memberNames(team.members).map((member) => [member, 0]));
        });
        dailyAssignments.forEach((day) => {
          (day.teams || []).forEach((team) => {
            if (!counts[team.name]) counts[team.name] = {};
            if (!Object.prototype.hasOwnProperty.call(counts[team.name], team.person)) {
              counts[team.name][team.person] = 0;
            }
            counts[team.name][team.person] += 1;
          });
        });

        const lastDay = dailyAssignments[dailyAssignments.length - 1] || { teams: [] };
        return teams.map((team) => ({
          team: team.name,
          members: memberUtils.memberNames(team.members).map((member) => ({
            name: member,
            count: counts[team.name]?.[member] || 0
          })),
          lastPerson: (lastDay.teams || []).find((item) => item.name === team.name)?.person || "-"
        }));
      }

      async function loadCurrentOrganization() {
        try {
          const response = await fetch(`${getOrganizationsUrl()}?_=${Date.now()}`, { cache: "no-store" });
          if (response.ok) {
            organizationIndexDocument = await response.json();
          }
        } catch (error) {
          organizationIndexDocument = null;
        }

        const result = orgUtils.resolveOrganization(organizationIndexDocument, getRequestedOrgSlug(), { allowLegacy: true });
        if (result.error) {
          throw new Error(result.error);
        }
        currentOrganization = result.organization;
      }

      async function loadRemoteSchedulePreview() {
        try {
          const response = await fetch(`${getScheduleUrl()}?_=${Date.now()}`, { cache: "no-store" });
          if (!response.ok) return null;
          return await response.json();
        } catch (error) {
          return null;
        }
      }

      function normalizePublishedDutyTeam(team, index = 0) {
        const personValue = typeof team?.person === "object" && team.person ? team.person : { name: team?.person };
        return {
          name: String(team?.name || `团队${index + 1}`).trim(),
          person: memberUtils.memberName(personValue),
          feishuOpenId: String(team?.feishuOpenId || memberUtils.memberOpenId(personValue) || "").trim(),
          color: resolveTeamColor(team?.color, index)
        };
      }

      function publishedDayNumber(item) {
        const day = Number(item?.day);
        if (day) return day;
        return Number(normalizeDateKey(item?.dateStr).slice(8, 10)) || 0;
      }

      function normalizePublishedAssignmentsForMonth(monthEntry, year, month) {
        const daysInMonth = new Date(year, month, 0).getDate();
        const byDay = new Map((monthEntry?.dailyAssignments || []).map((item) => [publishedDayNumber(item), item]));
        return Array.from({ length: daysInMonth }, (_, dayIndex) => {
          const day = dayIndex + 1;
          const currentDate = new Date(year, month - 1, day);
          const source = byDay.get(day) || {};
          return {
            day,
            dateStr: source.dateStr || `${year}/${pad2(month)}/${pad2(day)}`,
            weekdayStr: source.weekdayStr || weekdayNamesByDate[currentDate.getDay()],
            teams: (Array.isArray(source.teams) ? source.teams : []).map(normalizePublishedDutyTeam)
          };
        });
      }

      function collectPublishedMembers(dailyAssignments, teamName) {
        const seen = new Set();
        dailyAssignments.forEach((day) => {
          (day.teams || []).forEach((team) => {
            if (team.name === teamName && team.person) seen.add(team.person);
          });
        });
        return Array.from(seen);
      }

      function getCurrentRosterTeams(document) {
        if (Array.isArray(document?.current?.teams)) return document.current.teams;
        if (Array.isArray(document?.config?.teams)) return document.config.teams;
        return [];
      }

      function normalizePublishedTeams(document, monthEntry, dailyAssignments) {
        const sourceTeams = Array.isArray(monthEntry?.teams) && monthEntry.teams.length
          ? monthEntry.teams
          : getCurrentRosterTeams(document);
        const sourceByName = new Map(sourceTeams.map((team) => [String(team?.name || "").trim(), team]));
        const firstDayTeams = dailyAssignments.find((day) => day.teams?.length)?.teams || [];
        const names = firstDayTeams.length
          ? firstDayTeams.map((team) => team.name)
          : sourceTeams.map((team) => String(team?.name || "").trim()).filter(Boolean);

        return names.map((name, index) => {
          const source = sourceByName.get(name) || {};
          const assignmentTeam = firstDayTeams.find((team) => team.name === name);
          const members = Array.isArray(source.members) && source.members.length
            ? source.members
            : collectPublishedMembers(dailyAssignments, name);
          return {
            name,
            members: memberUtils.serializeMembers(members),
            color: resolveTeamColor(assignmentTeam?.color || source.color, index)
          };
        });
      }

      function countPublishedAssignments(teams, dailyAssignments) {
        const counts = {};
        teams.forEach((team) => {
          counts[team.name] = Object.fromEntries(memberUtils.memberNames(team.members).map((member) => [member, 0]));
        });
        dailyAssignments.forEach((day) => {
          (day.teams || []).forEach((team) => {
            if (!counts[team.name]) counts[team.name] = {};
            if (!Object.prototype.hasOwnProperty.call(counts[team.name], team.person)) {
              counts[team.name][team.person] = 0;
            }
            counts[team.name][team.person] += 1;
          });
        });
        return counts;
      }

      function findPublishedDutyTeam(document, dateKey, teamName) {
        const month = document?.months?.[dateKey.slice(0, 7)];
        const day = month?.dailyAssignments?.find((item) => normalizeDateKey(item.dateStr) === dateKey);
        const index = (day?.teams || []).findIndex((team) => String(team?.name || "").trim() === teamName);
        if (index < 0) return null;
        return normalizePublishedDutyTeam(day.teams[index], index);
      }

      // 用仓库已发布数据里的 openId，补全管理页名单中同名成员（仅管理页执行）。
      function applyOpenIdsFromRemote(remote) {
        if (!isAdminRoute() || !remote) return;
        const knownMembers = getCurrentRosterTeams(remote)
          .flatMap((team) => Array.isArray(team.members) ? team.members : []);
        Object.values(remote.months || {}).forEach((month) =>
          (month.dailyAssignments || []).forEach((day) =>
            (day.teams || []).forEach((team) => knownMembers.push({
              name: team.person,
              feishuOpenId: team.feishuOpenId
            }))
          )
        );

        let changed = false;
        [1, 2, 3].forEach((index) => {
          const field = $(`team${index}Members`);
          if (!field) return;
          const current = memberUtils.parseMembers(field.value);
          const merged = memberUtils.mergeKnownIdentities(current, knownMembers);
          const formatted = memberUtils.formatMembers(merged);
          if (formatted !== memberUtils.formatMembers(current)) changed = true;
          field.value = formatted;
        });

        if (changed) {
          syncTeamCards();
          stageTeamDraft();
        }
      }

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

      function generateAssignments(year, month, teams) {
        const schedule = scheduleUtils.buildPublishedDocument(null, simplifyTeams(teams), {
          publishDateKey: dateKeyForDay(year, month, 1),
          updatedAt: new Date().toISOString()
        });
        return scheduleUtils.generateAssignmentsForMonth(schedule, year, month);
      }

      function renderCalendar(year, month, startWeekday, daysInMonth, dailyAssignments) {
        const today = new Date();
        $("calendarTitle").textContent = `${year} 年 ${month} 月`;
        $("calendarSubtitle").textContent = "当前月 · 公开视图";
        const grid = $("calendarGrid");
        grid.innerHTML = "";

        weekdayNames.forEach((name, index) => {
          const head = document.createElement("div");
          head.className = "week-head" + (index >= 5 ? " weekend" : "");
          head.textContent = name;
          grid.appendChild(head);
        });

        const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;
        grid.style.setProperty("--calendar-weeks", String(totalCells / 7));
        for (let index = 0; index < totalCells; index++) {
          const day = index - startWeekday + 1;
          const weekday = index % 7;
          const cell = document.createElement("div");
          cell.className = "day-cell" + (weekday >= 5 ? " weekend" : "");

          if (day < 1 || day > daysInMonth) {
            cell.className = "day-cell empty";
            grid.appendChild(cell);
            continue;
          }

          const isToday = year === today.getFullYear() && month === today.getMonth() + 1 && day === today.getDate();
          if (isToday) cell.classList.add("today");

          const data = dailyAssignments[day - 1];
          cell.innerHTML = `
            <div class="day-num">
              <span>${day}</span>
              ${isToday ? '<span class="today-tag">今天</span>' : ""}
            </div>
          `;

          const list = document.createElement("div");
          list.className = "duty-list";
          data.teams.forEach((team) => {
            const color = resolveTeamColor(team.color, data.teams.indexOf(team));
            const pill = document.createElement("div");
            pill.className = "pill";
            pill.style.background = color.bg;
            pill.style.color = color.text;
            pill.innerHTML = `<span>${escapeHtml(team.name)}</span><span>${escapeHtml(team.person)}</span>`;
            list.appendChild(pill);
          });
          cell.appendChild(list);
          grid.appendChild(cell);
        }
      }

      function renderSummary(year, month, teams, counts, dailyAssignments) {
        const lastDay = dailyAssignments[dailyAssignments.length - 1];
        const monthKey = formatMonthKey(year, month);
        lastSummary = teams.map((team) => {
          const lastPerson = lastDay.teams.find((item) => item.name === team.name)?.person || "-";
          return {
            team: team.name,
            members: team.members.map((member) => ({
              name: memberUtils.memberName(member),
              count: counts[team.name][memberUtils.memberName(member)] || 0
            })),
            lastPerson
          };
        });

        $("summaryTable").innerHTML = `
          <tbody>
            ${lastSummary.map((item) => `
              <tr>
                <td>${escapeHtml(item.team)}</td>
                <td>
                  <div class="summary-members">
                    ${item.members.map((member) => `
                      <span class="summary-member">
                        <span>${escapeHtml(member.name)}</span>
                        <strong>${member.count} 天</strong>
                      </span>
                    `).join("")}
                  </div>
                </td>
              </tr>
            `).join("")}
          </tbody>
        `;

        if ($("noteMonth")) $("noteMonth").textContent = `当前展示 ${monthKey}，共 ${dailyAssignments.length} 天、${teams.length} 个团队。`;
        if ($("noteRoster")) $("noteRoster").textContent = `当前花名册：${teams.map((team) => `${team.name}${team.members.length}人`).join("，")}。`;
        if ($("draftRange")) $("draftRange").textContent = "按规则版本顺排";
        $("calendarSubtitle").textContent = "按规则版本顺排";
      }

      function renderPublishedScheduleMonth(document, year, month) {
        if (document?.version >= 2 || Array.isArray(document?.ruleVersions)) return false;
        const monthKey = formatMonthKey(year, month);
        const monthEntry = document?.months?.[monthKey];
        if (!monthEntry?.dailyAssignments?.length) return false;

        const firstDay = new Date(year, month - 1, 1);
        const startWeekday = (firstDay.getDay() + 6) % 7;
        const daysInMonth = new Date(year, month, 0).getDate();
        const dailyAssignments = normalizePublishedAssignmentsForMonth(monthEntry, year, month);
        const teams = normalizePublishedTeams(document, monthEntry, dailyAssignments);
        const counts = countPublishedAssignments(teams, dailyAssignments);

        renderCalendar(year, month, startWeekday, daysInMonth, dailyAssignments);
        renderSummary(year, month, teams, counts, dailyAssignments);
        renderLegends(teams);
        renderMonthGridCopy(year, month, teams, startWeekday, daysInMonth, dailyAssignments);

        lastGeneratedState = {
          year,
          month,
          monthKey,
          teams,
          configTeams: normalizePublishedTeams(document, { teams: getCurrentRosterTeams(document) }, dailyAssignments),
          result: { startWeekday, daysInMonth, counts, dailyAssignments },
          summary: lastSummary,
          remotePreview: document
        };
        persistedMonth = monthKey;
        pendingMonth = null;
        confirmationReady = false;
        updateMonthLabels(year, month);
        if ($("syncTime")) $("syncTime").textContent = nowTime();
        if ($("notePersistence")) $("notePersistence").textContent = `${monthKey} 已从公开排班读取。`;
        if ($("noteMonth")) $("noteMonth").textContent = `${monthKey} 已发布排班，共 ${dailyAssignments.length} 天、${teams.length} 个团队。`;
        if ($("noteRoster")) $("noteRoster").textContent = `当前花名册：${teams.map((team) => `${team.name}${team.members.length}人`).join("，")}。`;
        if ($("draftRange")) $("draftRange").textContent = "已发布快照";
        $("calendarSubtitle").textContent = "已发布排班";
        renderConfirmView();
        renderTeamConfigStatus();
        syncTopbar();
        return true;
      }

      function renderContinuousScheduleMonth(document, year, month) {
        const hasContinuousSource = Array.isArray(document?.ruleVersions)
          || Array.isArray(document?.current?.teams);
        if (!scheduleUtils?.generateAssignmentsForMonth || !hasContinuousSource) return false;
        let generated = null;
        try {
          generated = scheduleUtils.generateAssignmentsForMonth(document, year, month);
        } catch (error) {
          return false;
        }
        const monthKey = formatMonthKey(year, month);
        const teams = generated.teams.map((team, index) => ({
          name: team.name,
          members: memberUtils.serializeMembers(team.members),
          color: resolveTeamColor(team.color, index)
        }));
        const dailyAssignments = generated.dailyAssignments.map((day) => ({
          ...day,
          teams: day.teams.map((team, index) => ({
            ...team,
            color: resolveTeamColor(team.color, index)
          }))
        }));

        renderCalendar(year, month, generated.startWeekday, generated.daysInMonth, dailyAssignments);
        renderSummary(year, month, teams, generated.counts, dailyAssignments);
        renderLegends(teams);
        renderMonthGridCopy(year, month, teams, generated.startWeekday, generated.daysInMonth, dailyAssignments);

        lastGeneratedState = {
          year,
          month,
          monthKey,
          teams,
          configTeams: normalizePublishedTeams(document, { teams: getCurrentRosterTeams(document) }, dailyAssignments),
          result: { startWeekday: generated.startWeekday, daysInMonth: generated.daysInMonth, counts: generated.counts, dailyAssignments },
          summary: lastSummary,
          remotePreview: document
        };
        persistedMonth = monthKey;
        pendingMonth = null;
        confirmationReady = false;
        updateMonthLabels(year, month);
        if ($("syncTime")) $("syncTime").textContent = nowTime();
        if ($("notePersistence")) $("notePersistence").textContent = `${monthKey} 按已发布规则顺排。`;
        if ($("noteMonth")) $("noteMonth").textContent = `${monthKey} 按已发布规则顺排，共 ${dailyAssignments.length} 天、${teams.length} 个团队。`;
        if ($("noteRoster")) $("noteRoster").textContent = `当前花名册：${teams.map((team) => `${team.name}${team.members.length}人`).join("，")}。`;
        if ($("draftRange")) $("draftRange").textContent = "已发布规则顺排";
        $("calendarSubtitle").textContent = "按已发布规则顺排";
        renderConfirmView();
        renderTeamConfigStatus();
        syncTopbar();
        return true;
      }

      function renderLegends(teams) {
        ["legendTeam1", "legendTeam2", "legendTeam3"].forEach((id, index) => {
          const item = $(id);
          if (!item) return;
          item.textContent = teams[index]?.name || "-";
        });
      }

      function buildMonthGridMatrix(year, month, teams, startWeekday, daysInMonth, dailyAssignments) {
        const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;
        const rows = [];

        for (let index = 0; index < totalCells; index += 7) {
          const row = [];
          for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
            const cellIndex = index + dayIndex;
            const day = cellIndex - startWeekday + 1;
            if (day < 1 || day > daysInMonth) {
              row.push({ empty: true, text: "" });
            } else {
              const data = dailyAssignments[day - 1];
              const lines = [String(day)];
              teams.forEach((team) => {
                const found = data.teams.find((entry) => entry.name === team.name);
                lines.push(`${team.name}：${found ? found.person : ""}`);
              });
              row.push({ empty: false, text: lines.join("\n") });
            }
          }
          rows.push(row);
        }
        return rows;
      }

      function renderMonthGridCopy(year, month, teams, startWeekday, daysInMonth, dailyAssignments) {
        const matrix = buildMonthGridMatrix(year, month, teams, startWeekday, daysInMonth, dailyAssignments);
        const cellStyle = "border:1px solid #d7dee7;padding:8px 10px;vertical-align:top;text-align:left;white-space:normal;line-height:1.45;font-size:13px;color:#0f172a;";
        const headStyle = "border:1px solid #d7dee7;padding:8px 10px;background:#f5f7fa;text-align:center;font-weight:700;color:#0f172a;";

        lastGeneratedMonthGridHTML =
          `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;table-layout:fixed;width:980px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;">` +
          `<thead><tr>${weekdayNames.map((name) => `<th style="${headStyle}">${escapeHtml(name)}</th>`).join("")}</tr></thead>` +
          `<tbody>` +
          matrix.map((row) => {
            return `<tr>` + row.map((cell) => {
              if (cell.empty) return `<td style="${cellStyle}">&nbsp;</td>`;
              const lines = cell.text.split("\n");
              return `<td style="${cellStyle}"><strong>${escapeHtml(lines[0])}</strong><br>${lines.slice(1).map(escapeHtml).join("<br>")}</td>`;
            }).join("") + `</tr>`;
          }).join("") +
          `</tbody></table>`;

        const plainLines = [weekdayNames.join("\t")];
        matrix.forEach((row) => {
          plainLines.push(row.map((cell) => {
            const text = cell.text.replace(/"/g, '""');
            return text ? `"${text}"` : "";
          }).join("\t"));
        });
        lastGeneratedMonthGridPlain = plainLines.join("\n");
      }

      function generateSchedule(options = {}) {
        clearMessages();
        try {
          const year = Number($("year").value);
          const month = Number($("month").value);
          if (!year || !month || month < 1 || month > 12) {
            throw new Error("请先填写正确的年份和月份。");
          }
          if (!options.passive && teamConfigDirty) {
            throw new Error("名单还没保存。请先发布，系统会自动保存名单。");
          }
          if (options.passive && !teamConfigDirty && remoteScheduleDocument) {
            if (
              renderPublishedScheduleMonth(remoteScheduleDocument, year, month) ||
              renderContinuousScheduleMonth(remoteScheduleDocument, year, month)
            ) {
              if (!options.silent) showOk("已读取公开排班。");
              return true;
            }
          }

          const formTeams = buildTeamData();
          const teams = cloneTeamsForDraft(formTeams);
          const result = generateAssignments(year, month, teams);
          renderCalendar(year, month, result.startWeekday, result.daysInMonth, result.dailyAssignments);
          renderSummary(year, month, teams, result.counts, result.dailyAssignments);
          renderLegends(teams);
          renderMonthGridCopy(year, month, teams, result.startWeekday, result.daysInMonth, result.dailyAssignments);

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
          if (!options.passive) {
            pendingMonth = formatMonthKey(year, month);
            persistedMonth = null;
            confirmationReady = true;
          }
          updateMonthLabels(year, month);
          if ($("syncTime")) $("syncTime").textContent = nowTime();
          if ($("notePersistence")) {
            $("notePersistence").textContent = options.passive
              ? "当前只是查看排班。要发布变更，请进入“维护值班规则”。"
              : "已按当前名单预览排班，发布后从今天开始生效。";
          }
          renderConfirmView();
          syncTopbar();

          if (!options.silent) {
            showOk("已按当前名单预览排班。");
          }
          return true;
        } catch (error) {
          showError(error.message || "生成失败，请检查配置。");
          return false;
        }
      }

      function shiftMonth(delta) {
        const year = Number($("year").value);
        const month = Number($("month").value);
        const next = shiftMonthValue(year, month, delta);
        $("year").value = next.year;
        $("month").value = next.month;
        populateMonthPicker(next.year, next.month);
        generateSchedule({ passive: true });
      }

      function syncGithubBoxState() {
        applyViewState();
        syncTopbar();
      }

      function saveGithubSettings() {
        const settings = readGithubSettings();
        persistGithubSettings(settings);
        setGithubMessage("ok", `已保存设置到本机，仓库：${settings.repoSlug}。`);
        updateConfirmPublishState();
      }

      async function copyMonthGrid() {
        if (!lastGeneratedMonthGridHTML) {
          showToast("还没有可复制的月历", "error");
          return;
        }
        try {
          if (navigator.clipboard && window.ClipboardItem) {
            const item = new ClipboardItem({
              "text/html": new Blob([lastGeneratedMonthGridHTML], { type: "text/html" }),
              "text/plain": new Blob([lastGeneratedMonthGridPlain], { type: "text/plain" })
            });
            await navigator.clipboard.write([item]);
            showToast("复制成功");
            return;
          }
          if (navigator.clipboard) {
            await navigator.clipboard.writeText(lastGeneratedMonthGridPlain);
            showToast("复制成功");
            return;
          }
          throw new Error("clipboard unavailable");
        } catch (error) {
          try {
            await navigator.clipboard.writeText(lastGeneratedMonthGridPlain);
            showToast("复制成功");
          } catch (fallbackError) {
            showToast("复制失败，请使用截图或打印", "error");
          }
        }
      }

      function selectView(view) {
        if (view === "confirm") view = "manage";
        currentView = view;
        applyViewState();

        if (view === "manage") {
          $("manageView").scrollIntoView({ block: "start" });
        }
        if (view === "about") {
          $("aboutView").scrollIntoView({ block: "start" });
        }
        syncTopbar();
      }

      function openPrinciplesDialog() {
        const dialog = $("principlesDialog");
        if (!dialog) return;
        if (typeof dialog.showModal === "function") {
          dialog.showModal();
          return;
        }
        dialog.setAttribute("open", "");
      }

      function closePrinciplesDialog() {
        const dialog = $("principlesDialog");
        if (!dialog) return;
        if (typeof dialog.close === "function") {
          dialog.close();
          return;
        }
        dialog.removeAttribute("open");
      }

      async function handleTeamNextAction() {
        const button = $("teamNextActionBtn");
        const loadingStartedAt = Date.now();
        let publication = null;
        clearTeamPublishMessage();
        clearGithubMessage();
        if (button) {
          button.disabled = true;
          button.classList.add("loading");
          button.textContent = "发布中...";
        }
        try {
          const teams = buildTeamData();
          const settings = readGithubSettings();
          publication = createCurrentPublication();
          const result = await publication.publish(simplifyTeams(teams));

          persistGithubSettings(settings);
          remoteScheduleDocument = result.document;
          markTeamDraftSaved(publication.restoreDraft(result.document), { published: true });
          setCurrentYearMonth();
          populateMonthPicker(Number($("year").value), Number($("month").value));
          updateMonthLabels(Number($("year").value), Number($("month").value));
          renderContinuousScheduleMonth(
            result.document,
            Number($("year").value),
            Number($("month").value)
          );
          if ($("notePersistence")) {
            $("notePersistence").textContent = "已发布值班规则；今天之前不主动改变，今天及以后按新规则顺排。";
          }
          confirmationReady = false;
          resetConfirmChecks();
          setGithubMessage("ok", `已发布到公开页，同时提交到 ${result.repo}/${result.path}。`);
          setTeamPublishMessage("ok", `已发布到公开页，提交：${result.commit?.sha ? result.commit.sha.slice(0, 7) : "完成"}。`);
          showToast("已发布到公开页");
        } catch (error) {
          if (publication) {
            const draft = publication.restoreDraft(remoteScheduleDocument);
            if (draft) markTeamDraftSaved(draft);
          }
          if (error?.code === "TOKEN_REQUIRED") {
            openGithubSettings("githubToken");
            setTeamPublishMessage("error", error.message);
            showToast(error.message, "error");
            return;
          }
          setTeamPublishMessage("error", error.message || "发布失败。");
          showToast(error.message || "发布失败", "error");
        } finally {
          const elapsed = Date.now() - loadingStartedAt;
          if (elapsed < PUBLISH_LOADING_MIN_MS) {
            await new Promise((resolve) => setTimeout(resolve, PUBLISH_LOADING_MIN_MS - elapsed));
          }
          if (button) {
            button.classList.remove("loading");
            button.disabled = false;
          }
          renderTeamConfigStatus();
          syncTopbar();
        }
      }

      function bindTeamConfigEvents() {
        [1, 2, 3].forEach((index) => {
          $(`team${index}Name`).addEventListener("input", () => {
            syncTeamCards();
            setTeamConfigDirty(true);
          });
          bindMemberEditor(index);
        });
      }

      async function boot() {
        setCurrentYearMonth();
        applyDefaultMembers();
        if (isAdminRoute()) loadGithubSettingsFromStorage();
        syncTeamCards();
        renderTeamConfigStatus();
        populateMonthPicker(Number($("year").value), Number($("month").value));
        updateMonthLabels(Number($("year").value), Number($("month").value));
        try {
          await loadCurrentOrganization();
        } catch (error) {
          showError(error.message || "组织加载失败。");
          applyViewState();
          syncTopbar();
          return;
        }
        const remotePreview = await loadRemoteSchedulePreview();
        remoteScheduleDocument = remotePreview;
        const loadedTeamConfig = loadLocalUiState(remotePreview);
        if (remotePreview) {
          if (isAdminRoute() && !loadedTeamConfig && Array.isArray(remotePreview.current?.teams)) {
            applyTeamFormState(remotePreview.current.teams);
            setTeamConfigDirty(false);
          } else if (isAdminRoute() && !loadedTeamConfig && Array.isArray(remotePreview.config?.teams)) {
            applyTeamFormState(remotePreview.config.teams);
            setTeamConfigDirty(false);
          }
          if (lastGeneratedState) {
            lastGeneratedState.remotePreview = remotePreview;
          }
          if (!loadedTeamConfig) applyOpenIdsFromRemote(remotePreview);
        }
        applyViewState();
        syncTopbar();
        const year = Number($("year").value);
        const month = Number($("month").value);
        const renderedPublished = remotePreview && !teamConfigDirty && (
          renderPublishedScheduleMonth(remotePreview, year, month) ||
          renderContinuousScheduleMonth(remotePreview, year, month)
        );
        if (!renderedPublished) {
          generateSchedule({ silent: true, passive: true });
        }
      }

      $("prevMonthBtn").addEventListener("click", () => shiftMonth(-1));
      $("todayMonthBtn").addEventListener("click", () => {
        setCurrentYearMonth();
        populateMonthPicker(Number($("year").value), Number($("month").value));
        generateSchedule({ resetSeed: true, silent: true, passive: true });
      });
      $("nextMonthBtn").addEventListener("click", () => shiftMonth(1));
      $("monthPicker").addEventListener("change", (event) => {
        const [year, month] = String(event.target.value).split("-").map(Number);
        $("year").value = year;
        $("month").value = month;
        generateSchedule({ passive: true });
      });
      $("copyMonthGridBtn")?.addEventListener("click", copyMonthGrid);
      $("printBtn")?.addEventListener("click", () => window.print());
      $("principlesBtn")?.addEventListener("click", openPrinciplesDialog);
      $("principlesCloseBtn")?.addEventListener("click", closePrinciplesDialog);
      $("principlesDialog")?.addEventListener("click", (event) => {
        if (event.target === $("principlesDialog")) closePrinciplesDialog();
      });
      if (isAdminRoute()) {
        $("manageDetails").addEventListener("toggle", syncGithubBoxState);
        $("repoChip").addEventListener("click", () => openGithubSettings("repoSlug"));
        $("tokenChip").addEventListener("click", () => openGithubSettings("githubToken"));
        $("saveChip").addEventListener("click", openPublishPanel);
        $("teamNextActionBtn").addEventListener("click", handleTeamNextAction);
        $("saveGithubBtn").addEventListener("click", saveGithubSettings);
        $("clearGithubBtn").addEventListener("click", () => {
          persistGithubSettings({ repoSlug: readGithubSettings().repoSlug, token: "" });
          setGithubMessage("ok", "token 已清空。");
        });
        bindTeamConfigEvents();
      }
      document.querySelectorAll(".nav-link").forEach((button) => {
        button.addEventListener("click", () => selectView(button.dataset.view));
      });
      boot();

  }

  mountWorkbench().catch((error) => {
    const mount = document.getElementById("workbenchMount");
    if (mount) mount.textContent = error.message || "排班工作台加载失败。";
    console.error(error);
  });
})();
