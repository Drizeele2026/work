(function (global) {
  const ORGANIZATIONS_PATH = "data/organizations.json";
  const LEGACY_SCHEDULE_PATH = "data/schedule.json";
  const LEGACY_WEBHOOK_SECRET = "FEISHU_WEBHOOK";

  function normalizeOrgSlug(value) {
    const raw = String(value || "").trim().toLowerCase().replace(/_/g, "-");
    const ascii = raw
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return ascii || "org";
  }

  function normalizeOwners(owners) {
    return (Array.isArray(owners) ? owners : [])
      .map((owner) => String(owner || "").trim())
      .filter(Boolean);
  }

  function normalizeReminder(reminder, slug) {
    const source = reminder && typeof reminder === "object" ? reminder : {};
    return {
      enabled: source.enabled !== false,
      webhookSecretName: String(source.webhookSecretName || "").trim(),
      publicUrl: String(source.publicUrl || `https://drizeele2026.github.io/work/?org=${slug}`).trim()
    };
  }

  function normalizeOrganization(organization, index = 0) {
    const rawSlug = organization?.slug || (index === 0 ? "default" : `org-${index + 1}`);
    const slug = normalizeOrgSlug(rawSlug);
    const name = String(organization?.name || (slug === "default" ? "默认组织" : slug)).trim();
    return {
      slug,
      name,
      owners: normalizeOwners(organization?.owners),
      schedulePath: String(organization?.schedulePath || `data/orgs/${slug}/schedule.json`).trim(),
      enabled: organization?.enabled !== false,
      reminder: normalizeReminder(organization?.reminder, slug)
    };
  }

  function normalizeOrganizationIndex(document) {
    const organizations = (Array.isArray(document?.organizations) ? document.organizations : [])
      .map(normalizeOrganization)
      .filter((organization) => organization.slug && organization.schedulePath);
    const defaultOrg = normalizeOrgSlug(document?.defaultOrg || organizations[0]?.slug || "default");
    return {
      version: Number(document?.version) || 1,
      defaultOrg,
      organizations
    };
  }

  function createLegacyOrganization() {
    return {
      slug: "default",
      name: "默认组织",
      owners: [],
      schedulePath: LEGACY_SCHEDULE_PATH,
      enabled: true,
      reminder: {
        enabled: true,
        webhookSecretName: LEGACY_WEBHOOK_SECRET,
        publicUrl: "https://drizeele2026.github.io/work/"
      }
    };
  }

  function findOrganization(index, slug) {
    return (index.organizations || []).find((organization) => organization.slug === slug) || null;
  }

  function resolveOrganization(document, requestedSlug, options = {}) {
    const index = normalizeOrganizationIndex(document);
    if (!index.organizations.length && options.allowLegacy) {
      return { organization: createLegacyOrganization(), index, reason: "legacy", error: "" };
    }

    const requested = requestedSlug ? normalizeOrgSlug(requestedSlug) : "";
    const slug = requested || index.defaultOrg;
    const organization = findOrganization(index, slug);
    if (!organization) {
      return { organization: null, index, reason: "missing", error: `组织 ${requested || slug} 不存在。` };
    }
    if (!organization.enabled) {
      return { organization: null, index, reason: "disabled", error: `组织【${organization.name}】已停用。` };
    }
    return {
      organization,
      index,
      reason: requested ? "requested" : "default",
      error: ""
    };
  }

  function relativeDataPath(path, isAdminRoute) {
    const clean = String(path || "").replace(/^\/+/, "");
    return isAdminRoute ? `../${clean}` : clean;
  }

  function organizationStatePath(organization) {
    const schedulePath = String(organization?.schedulePath || "").replace(/\/+$/, "");
    const slashIndex = schedulePath.lastIndexOf("/");
    const directory = slashIndex >= 0 ? schedulePath.slice(0, slashIndex) : ".";
    return `${directory}/reminder-state.json`;
  }

  const api = {
    ORGANIZATIONS_PATH,
    LEGACY_SCHEDULE_PATH,
    normalizeOrgSlug,
    normalizeOrganization,
    normalizeOrganizationIndex,
    resolveOrganization,
    relativeDataPath,
    organizationStatePath
  };

  global.DutyRosterOrganizations = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
