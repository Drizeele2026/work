import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import publicationModule from "../publication-module.js";
import scheduleUtils from "../schedule-utils.js";

const { createPublication } = publicationModule;
const DRAFT_PREFIX = "duty-roster-team-config";
const FIXED_NOW = "2026-08-12T04:00:00.000Z";

const organization = {
  slug: "ops",
  name: "运营组织",
  schedulePath: "data/orgs/ops/schedule.json"
};

const teams = [
  {
    name: "前端",
    color: "blue",
    members: [
      { name: "A", feishuOpenId: "ou_a" },
      { name: "B" }
    ]
  }
];

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    read(key) {
      return values.has(key) ? values.get(key) : null;
    }
  };
}

function response(status, payload = null) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async text() {
      return payload === null ? "" : JSON.stringify(payload);
    }
  };
}

function encodeDocument(document) {
  return Buffer.from(JSON.stringify(document), "utf8").toString("base64");
}

function decodeDocument(content) {
  return JSON.parse(Buffer.from(content, "base64").toString("utf8"));
}

function draftKey(slug = organization.slug) {
  return `${DRAFT_PREFIX}:${slug}`;
}

function draft(overrides = {}) {
  return {
    version: 2,
    organizationSlug: organization.slug,
    savedAtIso: "2026-08-12T03:00:00.000Z",
    remoteUpdatedAt: "2026-08-12T02:00:00.000Z",
    teams,
    ...overrides
  };
}

function createForTest(overrides = {}) {
  return createPublication({
    organization,
    settings: { repoSlug: "Drizeele2026/work", token: "test-token" },
    storage: memoryStorage(),
    fetchImpl: async () => {
      throw new Error("测试必须提供 fetchImpl");
    },
    scheduleUtils,
    clock: () => new Date(FIXED_NOW),
    ...overrides
  });
}

test("UMD 在浏览器环境暴露 DutyRosterPublication", async () => {
  const source = await readFile(new URL("../publication-module.js", import.meta.url), "utf8");
  const context = { window: {}, console };
  vm.createContext(context);
  vm.runInContext(source, context);

  assert.equal(typeof context.window.DutyRosterPublication.createPublication, "function");
});

test("interface 只暴露 restoreDraft、stageDraft、publish", () => {
  const publication = createForTest();

  assert.deepEqual(Object.keys(publication), ["restoreDraft", "stageDraft", "publish"]);
  assert.equal(Object.isFrozen(publication), true);
});

test("publish 在任意运行时区都按北京时间确定生效日", async () => {
  const originalTimeZone = process.env.TZ;
  process.env.TZ = "UTC";
  try {
    const publication = createForTest({
      clock: () => new Date("2026-08-11T16:30:00.000Z"),
      fetchImpl: async (_url, request) => request.method === "GET"
        ? response(404, { message: "Not Found" })
        : response(200, { commit: { sha: "beijing-date" } })
    });

    const result = await publication.publish(teams);

    assert.equal(result.document.ruleVersions[0].effectiveDate, "2026-08-12");
  } finally {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  }
});

test("restoreDraft 恢复比远端更新的新鲜组织草稿", () => {
  const storage = memoryStorage({
    [draftKey()]: JSON.stringify(draft())
  });
  const publication = createForTest({ storage });

  const restored = publication.restoreDraft({ updatedAt: "2026-08-12T02:30:00.000Z" });

  assert.deepEqual(restored.teams, teams);
  assert.equal(restored.savedAtIso, "2026-08-12T03:00:00.000Z");
  assert.equal(restored.published, false);
  assert.ok(storage.read(draftKey()));
});

test("restoreDraft 把组织别名下的旧草稿迁移到 canonical key", () => {
  const storage = memoryStorage({
    [draftKey("default")]: JSON.stringify(draft({ organizationSlug: "default" }))
  });
  const publication = createForTest({
    organization: {
      slug: "intelligence",
      name: "智慧门店",
      aliases: ["default"],
      schedulePath: "data/orgs/intelligence/schedule.json"
    },
    storage
  });

  const restored = publication.restoreDraft({ updatedAt: "2026-08-12T02:30:00.000Z" });

  assert.deepEqual(restored.teams, teams);
  assert.equal(JSON.parse(storage.read(draftKey("intelligence"))).organizationSlug, "intelligence");
  assert.equal(storage.read(draftKey("default")), null);
});

test("stageDraft 只保留 canonical organization 的草稿", () => {
  const storage = memoryStorage({
    [draftKey("default")]: JSON.stringify(draft({ organizationSlug: "default" }))
  });
  const publication = createForTest({
    organization: {
      slug: "intelligence",
      name: "智慧门店",
      aliases: ["default"],
      schedulePath: "data/orgs/intelligence/schedule.json"
    },
    storage
  });

  publication.stageDraft(teams);

  assert.equal(JSON.parse(storage.read(draftKey("intelligence"))).organizationSlug, "intelligence");
  assert.equal(storage.read(draftKey("default")), null);
});

test("restoreDraft 只有在成功发布标记与远端版本一致时才返回已发布", () => {
  const storage = memoryStorage({
    [draftKey()]: JSON.stringify(draft({ published: true }))
  });
  const publication = createForTest({ storage });

  assert.equal(
    publication.restoreDraft({ updatedAt: "2026-08-12T02:00:00.000Z" }).published,
    true
  );
  assert.equal(
    publication.restoreDraft({ updatedAt: "2026-08-12T02:30:00.000Z" }).published,
    false
  );
});

test("restoreDraft 丢弃远端更新后的过期草稿", () => {
  const storage = memoryStorage({
    [draftKey()]: JSON.stringify(draft())
  });
  const publication = createForTest({ storage });

  assert.equal(
    publication.restoreDraft({ updatedAt: "2026-08-12T03:30:00.000Z" }),
    null
  );
  assert.equal(storage.read(draftKey()), null);
});

test("restoreDraft 丢弃错误归属的跨组织草稿", () => {
  const storage = memoryStorage({
    [draftKey()]: JSON.stringify(draft({ organizationSlug: "another-org" }))
  });
  const publication = createForTest({ storage });

  assert.equal(publication.restoreDraft(null), null);
  assert.equal(storage.read(draftKey()), null);
});

test("restoreDraft 丢弃损坏的草稿", () => {
  const storage = memoryStorage({ [draftKey()]: "{bad json" });
  const publication = createForTest({ storage });

  assert.equal(publication.restoreDraft(null), null);
  assert.equal(storage.read(draftKey()), null);
});

test("publish 先保存草稿，再用稳定错误拒绝缺少 token 的发布", async () => {
  const storage = memoryStorage();
  let fetched = false;
  const publication = createForTest({
    settings: { repoSlug: "Drizeele2026/work", token: "" },
    storage,
    fetchImpl: async () => {
      fetched = true;
      return response(500);
    }
  });

  await assert.rejects(
    () => publication.publish(teams),
    (error) => error.code === "TOKEN_REQUIRED" && error.message === "先填写 GitHub Token。"
  );

  const saved = JSON.parse(storage.read(draftKey()));
  assert.deepEqual(saved.teams, teams);
  assert.equal(saved.organizationSlug, organization.slug);
  assert.equal(saved.published, false);
  assert.equal(fetched, false);
  assert.doesNotMatch(JSON.stringify(saved), /token/i);
});

test("publish 在 GitHub 返回 404 时创建组织排班文件并使用默认仓库", async () => {
  const storage = memoryStorage();
  const calls = [];
  let writeBody;
  const publication = createForTest({
    settings: { token: "test-token" },
    storage,
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      if (request.method === "GET") return response(404, { message: "Not Found" });
      writeBody = JSON.parse(request.body);
      return response(200, { commit: { sha: "new-commit" } });
    }
  });

  const result = await publication.publish(teams);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://api.github.com/repos/Drizeele2026/work/contents/data/orgs/ops/schedule.json");
  assert.equal(calls[1].request.method, "PUT");
  assert.equal(Object.hasOwn(writeBody, "sha"), false);
  assert.equal(result.commit.sha, "new-commit");
  assert.equal(result.repo, "Drizeele2026/work");
  assert.equal(result.path, organization.schedulePath);
  assert.deepEqual(result.document.organization, { slug: "ops", name: "运营组织" });
  assert.deepEqual(decodeDocument(writeBody.content), result.document);
  assert.doesNotMatch(JSON.stringify(result), /test-token/);

  const saved = JSON.parse(storage.read(draftKey()));
  assert.equal(saved.remoteUpdatedAt, result.document.updatedAt);
  assert.equal(saved.published, true);
  assert.equal(publication.restoreDraft(result.document).published, true);
});

test("publish 更新已有文件时读取远端规则版本并携带 sha", async () => {
  const storage = memoryStorage();
  const remote = scheduleUtils.buildPublishedDocument(null, teams, {
    publishDateKey: "2026-08-01",
    updatedAt: "2026-08-01T00:00:00.000Z"
  });
  remote.organization = { slug: "ops", name: "运营组织" };
  let writeBody;
  const publication = createForTest({
    storage,
    settings: { repoSlug: "https://github.com/Drizeele2026/work.git", token: "test-token" },
    fetchImpl: async (_url, request) => {
      if (request.method === "GET") {
        return response(200, { sha: "existing-sha", content: encodeDocument(remote) });
      }
      writeBody = JSON.parse(request.body);
      return response(200, { commit: { sha: "updated-commit" } });
    }
  });

  const result = await publication.publish([
    ...teams,
    { name: "后端", color: "green", members: [{ name: "C" }] }
  ]);

  assert.equal(writeBody.sha, "existing-sha");
  assert.equal(result.commit.sha, "updated-commit");
  assert.equal(result.document.ruleVersions[0].effectiveDate, "2026-08-01");
  assert.equal(result.document.ruleVersions.at(-1).effectiveDate, "2026-08-12");
});

test("publish 写入失败时抛出稳定错误且不把草稿标成已发布", async () => {
  const storage = memoryStorage();
  const publication = createForTest({
    storage,
    fetchImpl: async (_url, request) => {
      if (request.method === "GET") return response(404, { message: "Not Found" });
      return response(409, { message: "sha does not match: test-token" });
    }
  });

  await assert.rejects(
    () => publication.publish(teams),
    (error) => error.code === "GITHUB_WRITE_FAILED"
      && /GitHub 发布失败（409）/.test(error.message)
      && !error.message.includes("test-token")
  );

  const saved = JSON.parse(storage.read(draftKey()));
  assert.equal(saved.remoteUpdatedAt, "");
  assert.equal(saved.published, false);
  assert.deepEqual(saved.teams, teams);
});

test("publish 始终读写传入组织自己的 schedulePath", async () => {
  const urls = [];
  const publication = createForTest({
    organization: {
      slug: "shm",
      name: "营运通",
      schedulePath: "data/orgs/shm/schedule.json"
    },
    storage: memoryStorage(),
    fetchImpl: async (url, request) => {
      urls.push(url);
      if (request.method === "GET") return response(404, { message: "Not Found" });
      return response(200, { commit: { sha: "shm-commit" } });
    }
  });

  const result = await publication.publish(teams);

  assert.deepEqual(urls, [
    "https://api.github.com/repos/Drizeele2026/work/contents/data/orgs/shm/schedule.json",
    "https://api.github.com/repos/Drizeele2026/work/contents/data/orgs/shm/schedule.json"
  ]);
  assert.equal(result.path, "data/orgs/shm/schedule.json");
  assert.equal(result.document.organization.slug, "shm");
});
