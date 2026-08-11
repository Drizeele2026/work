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

test("member helpers support old string members", async () => {
  assert.equal(memberUtils.memberName("方思琪"), "方思琪");
  assert.equal(memberUtils.memberOpenId("方思琪"), "");
  assert.deepEqual(plain(memberUtils.memberNames([{ name: "方思琪" }, "唐宇宏"])), ["方思琪", "唐宇宏"]);
});

test("findMemberIndex matches stable OpenID before display name", () => {
  const members = [
    { name: "新名字", feishuOpenId: "ou_same" },
    { name: "同名成员", feishuOpenId: "ou_new" }
  ];

  assert.equal(memberUtils.findMemberIndex(members, { name: "旧名字", feishuOpenId: "ou_same" }), 0);
  assert.equal(memberUtils.findMemberIndex(members, { name: "同名成员", feishuOpenId: "ou_old" }), 1);
});

test("mergeKnownIdentities fills missing OpenIDs without overwriting edits", () => {
  const merged = memberUtils.mergeKnownIdentities([
    "方思琪",
    { name: "唐宇宏", feishuOpenId: "ou_explicit" },
    "谭贤"
  ], [
    { name: "方思琪", feishuOpenId: "ou_frontend" },
    { name: "唐宇宏", feishuOpenId: "ou_remote" }
  ]);

  assert.deepEqual(plain(merged), [
    { name: "方思琪", feishuOpenId: "ou_frontend" },
    { name: "唐宇宏", feishuOpenId: "ou_explicit" },
    { name: "谭贤", feishuOpenId: "" }
  ]);
});

test("root member module supports browser global and CommonJS loading", async () => {
  const browserUtils = await loadBrowserUtils();
  const require = createRequire(import.meta.url);
  const commonJsUtils = require("../member-utils.js");

  assert.equal(browserUtils.memberName("@方思琪"), "方思琪");
  assert.equal(commonJsUtils, memberUtils);
});
