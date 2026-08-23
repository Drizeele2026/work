import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import memberUtils from "../member-utils.js";

async function loadBrowserUtils() {
  const source = await readFile(new URL("../member-utils.js", import.meta.url), "utf8");
  const context = { window: {}, console };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.DutyRosterMembers;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("parseMembers reads names with optional Feishu OpenID", async () => {
  assert.deepEqual(plain(memberUtils.parseMembers("方思琪 | ou_frontend\n唐宇宏\n@谭贤 | ou_test")), [
    { name: "方思琪", feishuOpenId: "ou_frontend" },
    { name: "唐宇宏", feishuOpenId: "" },
    { name: "谭贤", feishuOpenId: "ou_test" }
  ]);
});

test("formatMembers keeps configured OpenIDs editable", async () => {
  assert.equal(
    memberUtils.formatMembers([
      { name: "方思琪", feishuOpenId: "ou_frontend" },
      { name: "唐宇宏", feishuOpenId: "" },
      "谭贤"
    ]),
    ["方思琪 | ou_frontend", "唐宇宏", "谭贤"].join("\n")
  );
});

test("serializeMembers stores configured OpenIDs and keeps unconfigured names clean", async () => {
  assert.deepEqual(
    plain(memberUtils.serializeMembers([
      { name: "方思琪", feishuOpenId: "ou_frontend" },
      { name: "唐宇宏", feishuOpenId: "" }
    ])),
    [
      { name: "方思琪", feishuOpenId: "ou_frontend" },
      { name: "唐宇宏" }
    ]
  );
});

test("normalizeMembers supports old string members", async () => {
  assert.deepEqual(plain(memberUtils.normalizeMembers([{ name: "方思琪" }, "唐宇宏"])), [
    { name: "方思琪", feishuOpenId: "" },
    { name: "唐宇宏", feishuOpenId: "" }
  ]);
});

test("findMemberIndex matches stable OpenID before display name", () => {
  const members = [
    { name: "新名字", feishuOpenId: "ou_same" },
    { name: "同名成员", feishuOpenId: "ou_new" }
  ];

  assert.equal(memberUtils.findMemberIndex(members, { name: "旧名字", feishuOpenId: "ou_same" }), 0);
  assert.equal(memberUtils.findMemberIndex(members, { name: "同名成员", feishuOpenId: "ou_old" }), 1);
});

test("restoreKnownIdentities restores editable text without overwriting edits", () => {
  const restored = memberUtils.restoreKnownIdentities([
    "方思琪",
    "唐宇宏 | ou_explicit",
    "谭贤"
  ].join("\n"), [
    { name: "方思琪", feishuOpenId: "ou_frontend" },
    { name: "唐宇宏", feishuOpenId: "ou_remote" }
  ]);

  assert.equal(restored.changed, true);
  assert.equal(restored.text, ["方思琪 | ou_frontend", "唐宇宏 | ou_explicit", "谭贤"].join("\n"));
  assert.deepEqual(plain(restored.members), [
    { name: "方思琪", feishuOpenId: "ou_frontend" },
    { name: "唐宇宏", feishuOpenId: "ou_explicit" },
    { name: "谭贤", feishuOpenId: "" }
  ]);
});

test("interface 只暴露成员身份所需的六个动作", () => {
  assert.deepEqual(Object.keys(memberUtils), [
    "normalizeMembers",
    "findMemberIndex",
    "parseMembers",
    "formatMembers",
    "serializeMembers",
    "restoreKnownIdentities"
  ]);
  assert.equal(Object.isFrozen(memberUtils), true);
});

test("root member module supports browser global and CommonJS loading", async () => {
  const browserUtils = await loadBrowserUtils();
  const require = createRequire(import.meta.url);
  const commonJsUtils = require("../member-utils.js");

  assert.equal(browserUtils.normalizeMembers(["@方思琪"])[0].name, "方思琪");
  assert.equal(commonJsUtils, memberUtils);
});
