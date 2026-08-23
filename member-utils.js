(function (global, factory) {
  const api = factory();
  global.DutyRosterMembers = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function normalizeMember(member) {
    if (typeof member === "string") {
      return { name: member.trim().replace(/@/g, ""), feishuOpenId: "" };
    }

    return {
      name: String(member?.name || "").trim().replace(/@/g, ""),
      feishuOpenId: String(member?.feishuOpenId || "").trim()
    };
  }

  function normalizeMembers(members) {
    return (Array.isArray(members) ? members : [])
      .map(normalizeMember)
      .filter((member) => member.name);
  }

  function findMemberIndex(members, personOrMember) {
    const target = normalizeMember(personOrMember);
    if (!target.name && !target.feishuOpenId) return -1;

    if (target.feishuOpenId) {
      const openIdIndex = (Array.isArray(members) ? members : [])
        .findIndex((member) => normalizeMember(member).feishuOpenId === target.feishuOpenId);
      if (openIdIndex >= 0) return openIdIndex;
    }

    if (target.name) {
      return (Array.isArray(members) ? members : [])
        .findIndex((member) => normalizeMember(member).name === target.name);
    }
    return -1;
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

  function formatMembers(members) {
    return normalizeMembers(members)
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
    return normalizeMembers(members)
      .map(serializeMember);
  }

  function restoreKnownIdentities(text, knownMembers) {
    const knownOpenIdsByName = new Map();
    normalizeMembers(knownMembers).forEach((member) => {
      if (member.feishuOpenId) knownOpenIdsByName.set(member.name, member.feishuOpenId);
    });

    const current = parseMembers(text);
    const members = current.map((member) => {
      if (member.feishuOpenId) return member;
      const knownOpenId = knownOpenIdsByName.get(member.name);
      return knownOpenId ? { ...member, feishuOpenId: knownOpenId } : member;
    });
    const restoredText = formatMembers(members);
    return {
      members,
      text: restoredText,
      changed: restoredText !== formatMembers(current)
    };
  }

  return Object.freeze({
    normalizeMembers,
    findMemberIndex,
    parseMembers,
    formatMembers,
    serializeMembers,
    restoreKnownIdentities
  });
});
