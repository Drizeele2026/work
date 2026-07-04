import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../organization-utils.js", import.meta.url), "utf8");
const context = { window: {}, console, module: { exports: {} } };
vm.createContext(context);
vm.runInContext(source, context);
const orgUtils = context.module.exports;

test("normalizeOrgSlug 只保留 URL 和路径安全字符", () => {
  assert.equal(orgUtils.normalizeOrgSlug(" 外卖_业务组 "), "org");
  assert.equal(orgUtils.normalizeOrgSlug("TakeAway-Team_01"), "takeaway-team-01");
  assert.equal(orgUtils.normalizeOrgSlug("qa"), "qa");
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

test("organizationStatePath 和 schedule 文件同目录", () => {
  assert.equal(
    orgUtils.organizationStatePath({ schedulePath: "data/orgs/takeaway/schedule.json" }),
    "data/orgs/takeaway/reminder-state.json"
  );
});
