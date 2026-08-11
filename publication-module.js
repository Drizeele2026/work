(function (global) {
  "use strict";

  const DEFAULT_REPO = "Drizeele2026/work";
  const DEFAULT_DRAFT_KEY_PREFIX = "duty-roster-team-config";
  const GITHUB_BASE_URL = "https://api.github.com";

  function createError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function text(value) {
    return String(value || "").trim();
  }

  function normalizeOrganization(organization) {
    const slug = text(organization?.slug);
    const schedulePath = text(organization?.schedulePath).replace(/^\/+/, "");
    if (!slug || !schedulePath) {
      throw createError("INVALID_ORGANIZATION", "组织 slug 和排班文件路径不能为空。");
    }
    return {
      slug,
      name: text(organization?.name) || slug,
      schedulePath
    };
  }

  function normalizeRepoSlug(value) {
    return text(value || DEFAULT_REPO)
      .replace(/^https:\/\/github\.com\//, "")
      .replace(/\.git$/, "");
  }

  function parseRepoSlug(value) {
    const slug = normalizeRepoSlug(value);
    const parts = slug.split("/").filter(Boolean);
    if (parts.length !== 2 || parts.some((part) => /\s/.test(part))) {
      throw createError(
        "INVALID_REPOSITORY",
        "仓库格式要写成 owner/repo，比如 Drizeele2026/work。"
      );
    }
    return { owner: parts[0], repo: parts[1], slug: `${parts[0]}/${parts[1]}` };
  }

  function cloneTeams(teams) {
    if (!Array.isArray(teams) || !teams.length) {
      throw createError("INVALID_TEAMS", "至少要配置一个团队和成员名单。");
    }
    try {
      return JSON.parse(JSON.stringify(teams));
    } catch {
      throw createError("INVALID_TEAMS", "团队名单不是可保存的数据。");
    }
  }

  function clockDate(clock) {
    const value = typeof clock === "function" ? clock() : new Date();
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw createError("INVALID_CLOCK", "发布时间无效。");
    }
    return date;
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function dateKey(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function bytesToBinary(bytes) {
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return binary;
  }

  function encodeBase64Utf8(value) {
    const source = String(value);
    if (typeof global.TextEncoder === "function" && typeof global.btoa === "function") {
      return global.btoa(bytesToBinary(new global.TextEncoder().encode(source)));
    }
    if (global.Buffer) {
      return global.Buffer.from(source, "utf8").toString("base64");
    }
    throw createError("BASE64_UNAVAILABLE", "当前环境无法编码发布内容。");
  }

  function decodeBase64Utf8(value) {
    const source = String(value || "").replace(/\s/g, "");
    try {
      if (typeof global.TextDecoder === "function" && typeof global.atob === "function") {
        const binary = global.atob(source);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        return new global.TextDecoder().decode(bytes);
      }
      if (global.Buffer) {
        return global.Buffer.from(source, "base64").toString("utf8");
      }
    } catch {
      throw createError("REMOTE_DOCUMENT_INVALID", "仓库里的 schedule.json 不是有效内容。");
    }
    throw createError("BASE64_UNAVAILABLE", "当前环境无法读取发布内容。");
  }

  async function responsePayload(response) {
    const body = await response.text();
    if (!body) return null;
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }

  function githubDetail(payload, response, token) {
    const rawDetail = text(payload?.message) || `HTTP ${response.status}`;
    const detail = token ? rawDetail.split(token).join("[REDACTED]") : rawDetail;
    return detail.slice(0, 240);
  }

  function encodedPath(path) {
    return path.split("/").map(encodeURIComponent).join("/");
  }

  function createPublication(options = {}) {
    const organization = normalizeOrganization(options.organization);
    const settings = options.settings || {};
    const storage = options.storage || global.localStorage;
    const fetchImpl = options.fetchImpl || global.fetch;
    const scheduleUtils = options.scheduleUtils || global.DutyRosterSchedule;
    const clock = options.clock || (() => new Date());
    const draftKeyPrefix = text(options.draftKeyPrefix) || DEFAULT_DRAFT_KEY_PREFIX;
    const draftKey = `${draftKeyPrefix}:${organization.slug}`;

    function requireStorage() {
      if (!storage
        || typeof storage.getItem !== "function"
        || typeof storage.setItem !== "function"
        || typeof storage.removeItem !== "function") {
        throw createError("DRAFT_STORAGE_UNAVAILABLE", "当前环境无法保存团队草稿。");
      }
    }

    function removeDraft() {
      requireStorage();
      storage.removeItem(draftKey);
    }

    function saveDraft(teams, remoteDocument = null, published = false) {
      requireStorage();
      const savedAtIso = clockDate(clock).toISOString();
      const draft = {
        version: 2,
        organizationSlug: organization.slug,
        savedAtIso,
        remoteUpdatedAt: text(remoteDocument?.updatedAt),
        published: published === true,
        teams: cloneTeams(teams)
      };
      storage.setItem(draftKey, JSON.stringify(draft));
      return {
        teams: cloneTeams(draft.teams),
        savedAtIso: draft.savedAtIso,
        remoteUpdatedAt: draft.remoteUpdatedAt,
        published: draft.published
      };
    }

    function restoreDraft(remoteDocument = null) {
      requireStorage();
      const raw = storage.getItem(draftKey);
      if (!raw) return null;

      let draft;
      try {
        draft = JSON.parse(raw);
      } catch {
        removeDraft();
        return null;
      }

      const savedAt = Date.parse(draft?.savedAtIso || "");
      const remoteUpdatedAt = Date.parse(remoteDocument?.updatedAt || "");
      const invalid = draft?.version !== 2
        || draft?.organizationSlug !== organization.slug
        || !Array.isArray(draft?.teams)
        || !draft.teams.length
        || !Number.isFinite(savedAt);
      const stale = Number.isFinite(remoteUpdatedAt) && remoteUpdatedAt > savedAt;

      if (invalid || stale) {
        removeDraft();
        return null;
      }

      return {
        teams: cloneTeams(draft.teams),
        savedAtIso: draft.savedAtIso,
        remoteUpdatedAt: text(draft.remoteUpdatedAt),
        published: draft.published === true
          && Boolean(text(remoteDocument?.updatedAt))
          && text(draft.remoteUpdatedAt) === text(remoteDocument?.updatedAt)
      };
    }

    function stageDraft(teams, remoteDocument = null) {
      return saveDraft(teams, remoteDocument, false);
    }

    function readSettings() {
      return {
        repoSlug: normalizeRepoSlug(settings.repoSlug || DEFAULT_REPO) || DEFAULT_REPO,
        token: text(settings.token)
      };
    }

    function requestHeaders(token, extra = {}) {
      return {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: `Bearer ${token}`,
        ...extra
      };
    }

    async function callGithub(url, request, errorCode, actionLabel) {
      if (typeof fetchImpl !== "function") {
        throw createError("FETCH_UNAVAILABLE", "当前环境无法连接 GitHub。");
      }
      try {
        return await fetchImpl(url, request);
      } catch {
        throw createError(errorCode, `${actionLabel}失败，请稍后重试。`);
      }
    }

    async function loadRemote(contentsUrl, token) {
      const response = await callGithub(
        contentsUrl,
        { method: "GET", headers: requestHeaders(token) },
        "GITHUB_READ_FAILED",
        "GitHub 读取"
      );
      const payload = await responsePayload(response);
      if (response.status === 404) return { sha: null, document: null };
      if (!response.ok) {
        throw createError(
          "GITHUB_READ_FAILED",
          `GitHub 读取失败（${response.status}）：${githubDetail(payload, response, token)}`
        );
      }
      if (!payload?.content) return { sha: payload?.sha || null, document: null };

      try {
        return {
          sha: payload.sha || null,
          document: JSON.parse(decodeBase64Utf8(payload.content))
        };
      } catch (error) {
        if (error?.code === "BASE64_UNAVAILABLE") throw error;
        throw createError("REMOTE_DOCUMENT_INVALID", "仓库里的 schedule.json 不是有效 JSON。");
      }
    }

    async function writeRemote(contentsUrl, token, body) {
      const response = await callGithub(
        contentsUrl,
        {
          method: "PUT",
          headers: requestHeaders(token, { "Content-Type": "application/json" }),
          body: JSON.stringify(body)
        },
        "GITHUB_WRITE_FAILED",
        "GitHub 发布"
      );
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw createError(
          "GITHUB_WRITE_FAILED",
          `GitHub 发布失败（${response.status}）：${githubDetail(payload, response, token)}`
        );
      }
      return payload || {};
    }

    async function publish(teams) {
      const stagedTeams = saveDraft(teams, null, false).teams;
      const publicationSettings = readSettings();
      if (!publicationSettings.token) {
        throw createError("TOKEN_REQUIRED", "先填写 GitHub Token。");
      }
      const repo = parseRepoSlug(publicationSettings.repoSlug);
      if (!scheduleUtils || typeof scheduleUtils.buildPublishedDocument !== "function") {
        throw createError("SCHEDULE_MODULE_UNAVAILABLE", "规则版本 module 不可用。");
      }

      const path = organization.schedulePath;
      const contentsUrl = `${GITHUB_BASE_URL}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/contents/${encodedPath(path)}`;
      const remote = await loadRemote(contentsUrl, publicationSettings.token);
      const publishedAt = clockDate(clock);
      const publishDateKey = dateKey(publishedAt);
      const document = scheduleUtils.buildPublishedDocument(remote.document, stagedTeams, {
        publishDateKey,
        updatedAt: publishedAt.toISOString()
      });
      document.organization = {
        slug: organization.slug,
        name: organization.name
      };

      const body = {
        message: `chore: update ${organization.slug} roster rules ${publishDateKey}`,
        content: encodeBase64Utf8(`${JSON.stringify(document, null, 2)}\n`)
      };
      if (remote.sha) body.sha = remote.sha;

      const result = await writeRemote(contentsUrl, publicationSettings.token, body);
      saveDraft(stagedTeams, document, true);
      return {
        commit: result.commit || null,
        document,
        path,
        repo: repo.slug
      };
    }

    return Object.freeze({ restoreDraft, stageDraft, publish });
  }

  const api = { createPublication };
  global.DutyRosterPublication = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
