import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../organization-utils.js", import.meta.url), "utf8");
const context = { window: {}, console, module: { exports: {} } };
vm.createContext(context);
vm.runInContext(source, context);
const orgUtils = context.module.exports;

test("resolveOrganization 在 interface 内归一化请求 slug", () => {
  const result = orgUtils.resolveOrganization({
    organizations: [
      { slug: "TakeAway-Team_01", name: "外卖业务组", enabled: true }
    ]
  }, " TakeAway-Team_01 ");

  assert.equal(result.error, "");
  assert.equal(result.organization.slug, "takeaway-team-01");
});

test("resolveOrganization 没有 org 时使用 defaultOrg", () => {
  const result = orgUtils.resolveOrganization({
    version: 1,
    defaultOrg: "default",
    organizations: [
      { slug: "default", name: "默认组织", schedulePath: "data/orgs/default/schedule.json", enabled: true },
      { slug: "takeaway", name: "外卖业务组", schedulePath: "data/orgs/takeaway/schedule.json", enabled: true }
    ]
  }, "");

  assert.equal(result.error, "");
  assert.equal(result.organization.slug, "default");
  assert.equal(result.organization.name, "默认组织");
});

test("resolveOrganization 按请求 slug 返回组织", () => {
  const result = orgUtils.resolveOrganization({
    version: 1,
    defaultOrg: "default",
    organizations: [
      { slug: "default", name: "默认组织", schedulePath: "data/orgs/default/schedule.json", enabled: true },
      { slug: "takeaway", name: "外卖业务组", schedulePath: "data/orgs/takeaway/schedule.json", enabled: true }
    ]
  }, "takeaway");

  assert.equal(result.error, "");
  assert.equal(result.organization.slug, "takeaway");
  assert.equal(result.organization.schedulePath, "data/orgs/takeaway/schedule.json");
});

test("resolveOrganization 把组织别名归一为 canonical 组织", () => {
  const result = orgUtils.resolveOrganization({
    version: 1,
    defaultOrg: "intelligence",
    organizations: [
      {
        slug: "intelligence",
        aliases: ["default"],
        name: "智慧门店",
        schedulePath: "data/orgs/intelligence/schedule.json",
        enabled: true
      }
    ]
  }, "default");

  assert.equal(result.reason, "alias");
  assert.equal(result.organization.slug, "intelligence");
  assert.deepEqual(Array.from(result.organization.aliases), ["default"]);
  assert.equal(result.organization.schedulePath, "data/orgs/intelligence/schedule.json");
});

test("resolveOrganization 停用组织不可用", () => {
  const result = orgUtils.resolveOrganization({
    version: 1,
    defaultOrg: "default",
    organizations: [
      { slug: "qa", name: "测试中心", schedulePath: "data/orgs/qa/schedule.json", enabled: false }
    ]
  }, "qa");

  assert.equal(result.organization, null);
  assert.match(result.error, /测试中心/);
  assert.match(result.error, /已停用/);
});

test("resolveOrganization 没有索引时可回退旧 schedule 文件", () => {
  const result = orgUtils.resolveOrganization(null, "", { allowLegacy: true });

  assert.equal(result.error, "");
  assert.equal(result.reason, "legacy");
  assert.equal(result.organization.slug, "default");
  assert.equal(result.organization.schedulePath, "data/schedule.json");
  assert.equal(result.organization.reminder.webhookSecretName, "FEISHU_WEBHOOK");
});

test("resolveOrganization 显式 org=default 时仍可回退旧 schedule 文件", () => {
  const result = orgUtils.resolveOrganization(null, "default", { allowLegacy: true });

  assert.equal(result.error, "");
  assert.equal(result.reason, "legacy");
  assert.equal(result.organization.slug, "default");
  assert.equal(result.organization.schedulePath, "data/schedule.json");
});

test("resolveOrganization 显式具名组织时不能回退到默认组织", () => {
  const result = orgUtils.resolveOrganization(null, "takeaway", { allowLegacy: true });

  assert.equal(result.organization, null);
  assert.equal(result.reason, "missing-index");
  assert.match(result.error, /takeaway/);
  assert.match(result.error, /组织索引/);
});

test("relativeDataPath 管理页自动回到站点根目录", () => {
  assert.equal(orgUtils.relativeDataPath("data/orgs/default/schedule.json", false), "data/orgs/default/schedule.json");
  assert.equal(orgUtils.relativeDataPath("data/orgs/default/schedule.json", true), "../data/orgs/default/schedule.json");
});

test("resolveReminderTargets 集中提醒资格和资源语义", () => {
  const result = orgUtils.resolveReminderTargets({
    organizations: [
      {
        slug: "takeaway",
        name: "外卖业务组",
        schedulePath: "data/orgs/takeaway/schedule.json",
        enabled: true,
        reminder: {
          enabled: true,
          webhookSecretName: "FEISHU_WEBHOOK_TAKEAWAY",
          publicUrl: "https://example.com/?org=takeaway"
        }
      },
      { slug: "disabled", name: "停用组织", enabled: false },
      { slug: "silent", name: "不提醒组织", enabled: true, reminder: { enabled: false } }
    ]
  }, "");

  assert.equal(result.legacyResult, false);
  assert.deepEqual(JSON.parse(JSON.stringify(result.targets)), [{
    organization: { slug: "takeaway", name: "外卖业务组" },
    schedulePath: "data/orgs/takeaway/schedule.json",
    statePath: "data/orgs/takeaway/reminder-state.json",
    publicUrl: "https://example.com/?org=takeaway",
    webhookSecretName: "FEISHU_WEBHOOK_TAKEAWAY",
    legacy: false
  }]);
});

test("resolveReminderTargets 索引缺失时只允许旧 default 入口", () => {
  const result = orgUtils.resolveReminderTargets(null, "default", {
    statePath: "tmp/reminder-state.json",
    publicUrl: "https://example.com/legacy"
  });

  assert.equal(result.legacyResult, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.targets[0])), {
    organization: { slug: "default", name: "默认组织" },
    schedulePath: "data/schedule.json",
    statePath: "tmp/reminder-state.json",
    publicUrl: "https://example.com/legacy",
    webhookSecretName: "FEISHU_WEBHOOK",
    legacy: true
  });
  assert.throws(
    () => orgUtils.resolveReminderTargets(null, "takeaway"),
    /组织 takeaway 不存在，无法在缺少组织索引时发送/
  );
});

test("resolveReminderTargets 具名组织必须有提醒资格", () => {
  assert.throws(
    () => orgUtils.resolveReminderTargets({
      organizations: [
        { slug: "qa", name: "测试中心", enabled: true, reminder: { enabled: false } }
      ]
    }, "qa"),
    /不存在、已停用或未启用提醒/
  );
});

test("resolveReminderTargets 的组织别名只生成 canonical target", () => {
  const result = orgUtils.resolveReminderTargets({
    organizations: [
      {
        slug: "intelligence",
        aliases: ["default"],
        name: "智慧门店",
        enabled: true,
        reminder: { enabled: true, webhookSecretName: "FEISHU_WEBHOOK" }
      }
    ]
  }, "default");

  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0].organization.slug, "intelligence");
  assert.equal(result.targets[0].schedulePath, "data/orgs/intelligence/schedule.json");
});
