import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

async function loadUtils() {
  const source = await fs.readFile("admin/member-utils.js", "utf8");
  const context = { window: {}, console };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.DutyRosterMembers;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("parseMembers reads names with optional Feishu OpenID", async () => {
  const utils = await loadUtils();

  assert.deepEqual(plain(utils.parseMembers("方思琪 | ou_frontend\n唐宇宏\n@谭贤 | ou_test")), [
    { name: "方思琪", feishuOpenId: "ou_frontend" },
    { name: "唐宇宏", feishuOpenId: "" },
    { name: "谭贤", feishuOpenId: "ou_test" }
  ]);
});

test("formatMembers keeps configured OpenIDs editable", async () => {
  const utils = await loadUtils();

  assert.equal(
    utils.formatMembers([
      { name: "方思琪", feishuOpenId: "ou_frontend" },
      { name: "唐宇宏", feishuOpenId: "" },
      "谭贤"
    ]),
    ["方思琪 | ou_frontend", "唐宇宏", "谭贤"].join("\n")
  );
});

test("serializeMembers stores configured OpenIDs and keeps unconfigured names clean", async () => {
  const utils = await loadUtils();

  assert.deepEqual(
    plain(utils.serializeMembers([
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
  const utils = await loadUtils();

  assert.equal(utils.memberName("方思琪"), "方思琪");
  assert.equal(utils.memberOpenId("方思琪"), "");
  assert.deepEqual(plain(utils.memberNames([{ name: "方思琪" }, "唐宇宏"])), ["方思琪", "唐宇宏"]);
});
