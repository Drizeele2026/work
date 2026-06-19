(function (global) {
  function normalizeMember(member) {
    if (typeof member === "string") {
      return { name: member.trim().replace(/@/g, ""), feishuOpenId: "" };
    }

    return {
      name: String(member?.name || "").trim().replace(/@/g, ""),
      feishuOpenId: String(member?.feishuOpenId || "").trim()
    };
  }

  function parseMemberLine(line) {
    const [rawName, ...rawOpenIdParts] = String(line || "").split("|");
    return normalizeMember({
      name: rawName,
      feishuOpenId: rawOpenIdParts.join("|")
    });
  }

  function parseMembers(text) {
    return String(text || "")
      .split(/\n|,/)
      .map(parseMemberLine)
      .filter((member) => member.name);
  }

  function memberName(member) {
    return normalizeMember(member).name;
  }

  function memberOpenId(member) {
    return normalizeMember(member).feishuOpenId;
  }

  function memberNames(members) {
    return (Array.isArray(members) ? members : [])
      .map(memberName)
      .filter(Boolean);
  }

  function formatMembers(members) {
    return (Array.isArray(members) ? members : [])
      .map(normalizeMember)
      .filter((member) => member.name)
      .map((member) => member.feishuOpenId ? `${member.name} | ${member.feishuOpenId}` : member.name)
      .join("\n");
  }

  function serializeMember(member) {
    const normalized = normalizeMember(member);
    if (normalized.feishuOpenId) {
      return { name: normalized.name, feishuOpenId: normalized.feishuOpenId };
    }
    return { name: normalized.name };
  }

  function serializeMembers(members) {
    return (Array.isArray(members) ? members : [])
      .map(serializeMember)
      .filter((member) => member.name);
  }

  global.DutyRosterMembers = {
    normalizeMember,
    parseMembers,
    memberName,
    memberOpenId,
    memberNames,
    formatMembers,
    serializeMembers
  };
})(window);
