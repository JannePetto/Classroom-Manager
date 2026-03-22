const crypto = require("crypto");
const express = require("express");
const dgram = require("dgram");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { WebSocketServer, WebSocket } = require("ws");

const HTTP_PORT = Number(process.env.PORT || 3000);
const DEFAULT_CONNECT_HOST = String(process.env.CLASSROOM_CONNECT_HOST || "").trim();
const DISCOVERY_PORT = Number(process.env.CLASSROOM_DISCOVERY_PORT || 3100);
const DISCOVERY_PROTOCOL = "classroom-discovery-v1";
const AGENT_TIMEOUT = 75_000;
const RETAIN_OFFLINE_MS = 24 * 60 * 60 * 1000;
const MAX_AUDIT_EVENTS = 120;
const MAX_ACTIVITY_HISTORY = 18;
const MAX_UPDATE_PAYLOAD_BYTES = 64 * 1024 * 1024;
const MAX_ANNOUNCEMENT_LENGTH = 500;
const MAX_ACCOUNT_NAME_LENGTH = 32;
const AGENT_DOWNLOAD_ROUTE = "/downloads/classroom-agent.exe";
const AGENT_DOWNLOAD_FILENAME = "ClassroomDeviceAgent.exe";
const AGENT_DOWNLOAD_PATH = path.join(__dirname, "..", "slave", "dist", "slave.exe");
const STATE_PATH = path.join(__dirname, "data", "classroom-state.json");
const DEFAULT_ADMIN_USERNAME = String(process.env.CLASSROOM_ADMIN_USERNAME || "admin").trim() || "admin";
const DEFAULT_ADMIN_PASSWORD = String(process.env.CLASSROOM_ADMIN_PASSWORD || "change-me").trim() || "change-me";
const SESSION_COOKIE_NAME = "classroom_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const KNOWN_BROWSER_PROCESSES = new Set([
  "chrome.exe",
  "msedge.exe",
  "firefox.exe",
  "brave.exe",
  "opera.exe",
  "iexplore.exe",
]);

const app = express();
const server = http.createServer(app);
const discoverySocket = dgram.createSocket("udp4");

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get(AGENT_DOWNLOAD_ROUTE, (_request, response) => {
  if (!fs.existsSync(AGENT_DOWNLOAD_PATH)) {
    response.status(404).send("The packaged classroom agent is not available right now.");
    return;
  }

  response.download(AGENT_DOWNLOAD_PATH, AGENT_DOWNLOAD_FILENAME);
});

app.get("/teacher-manual", (_request, response) => {
  response.sendFile(path.join(__dirname, "..", "docs", "teacher-account-manual.html"));
});

function getLanHttpUrls() {
  const networkInterfaces = os.networkInterfaces();
  const lanUrls = [];

  for (const addresses of Object.values(networkInterfaces)) {
    for (const address of addresses || []) {
      if (address.family !== "IPv4" || address.internal) continue;
      lanUrls.push(`http://${address.address}:${HTTP_PORT}`);
    }
  }

  return lanUrls;
}

function getPreferredBaseUrl(lanUrls = []) {
  if (DEFAULT_CONNECT_HOST) {
    return `http://${DEFAULT_CONNECT_HOST}:${HTTP_PORT}`;
  }

  return lanUrls[0] || `http://localhost:${HTTP_PORT}`;
}

app.get("/api/connect-info", (_request, response) => {
  const lanUrls = getLanHttpUrls();
  const downloadAvailable = fs.existsSync(AGENT_DOWNLOAD_PATH);
  const preferredBaseUrl = getPreferredBaseUrl(lanUrls);
  const lanDownloadUrls = lanUrls.map((url) => `${url}${AGENT_DOWNLOAD_ROUTE}`);

  response.json({
    lanUrls,
    localUrl: `http://localhost:${HTTP_PORT}`,
    preferredUrl: preferredBaseUrl,
    discoveryPort: DISCOVERY_PORT,
    discoverySupported: true,
    autoLaunchCommand: "py slave.py",
    manualLaunchCommand: `py slave.py ${preferredBaseUrl}`,
    downloadAvailable,
    downloadPath: AGENT_DOWNLOAD_ROUTE,
    downloadFilename: AGENT_DOWNLOAD_FILENAME,
    localDownloadUrl: `http://localhost:${HTTP_PORT}${AGENT_DOWNLOAD_ROUTE}`,
    preferredDownloadUrl: `${preferredBaseUrl}${AGENT_DOWNLOAD_ROUTE}`,
    lanDownloadUrls,
  });
});

function createEmptyManagedState() {
  return {
    groupPolicies: {},
    devicePolicies: {},
  };
}

function createEmptyState() {
  return {
    accounts: {},
    groups: [],
    deviceAssignments: {},
    groupPolicies: {},
    groupPolicyPresets: {},
  };
}

function normalizeGroupName(value) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 48);
}

function normalizeAccountName(value) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, MAX_ACCOUNT_NAME_LENGTH);
}

function normalizeAccountKey(value) {
  return normalizeAccountName(value).toLowerCase();
}

function ensureStoredGroup(state, group) {
  const normalized = normalizeGroupName(group);
  if (!normalized) {
    return "";
  }

  if (!state.groups.includes(normalized)) {
    state.groups.push(normalized);
  }

  return normalized;
}

function normalizeClassAccessList(value) {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n|,/)
      : [];

  const normalized = [];
  const seen = new Set();
  for (const item of rawItems) {
    const className = normalizeGroupName(item);
    const lookup = className.toLowerCase();
    if (!className || seen.has(lookup)) continue;
    seen.add(lookup);
    normalized.push(className);
  }

  return normalized.sort((left, right) => left.localeCompare(right));
}

function normalizeAnnouncementText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n").trim().slice(0, MAX_ANNOUNCEMENT_LENGTH);
}

function createPasswordHash(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  try {
    const [algorithm, salt, expectedHash] = String(storedHash || "").split("$");
    if (algorithm !== "scrypt" || !salt || !expectedHash) {
      return false;
    }

    const actualHash = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(actualHash, "hex"), Buffer.from(expectedHash, "hex"));
  } catch {
    return false;
  }
}

function normalizePresetName(value) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 48);
}

function normalizeRuleList(value) {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n|,/)
      : [];

  const normalized = [];
  const seen = new Set();
  for (const item of rawItems) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim().slice(0, 120);
    const lookup = trimmed.toLowerCase();
    if (!trimmed || seen.has(lookup)) continue;
    seen.add(lookup);
    normalized.push(trimmed);
  }

  return normalized.slice(0, 40);
}

function createEmptyPolicy() {
  return {
    allowedPrograms: [],
    allowedSites: [],
    websiteMode: "block",
  };
}

function normalizeWebsiteMode(value) {
  return String(value || "").trim().toLowerCase() === "warn" ? "warn" : "block";
}

function normalizePolicy(value) {
  const allowedPrograms = normalizeRuleList(value?.allowedPrograms);
  const allowedSites = normalizeRuleList(value?.allowedSites);
  return {
    allowedPrograms,
    allowedSites,
    websiteMode: normalizeWebsiteMode(value?.websiteMode),
  };
}

function hasPolicySettings(policy) {
  return Boolean(
    policy
    && (policy.allowedPrograms?.length
      || policy.allowedSites?.length),
  );
}

function normalizeManagedState(raw) {
  const nextState = createEmptyManagedState();

  if (raw && typeof raw.devicePolicies === "object") {
    for (const [key, value] of Object.entries(raw.devicePolicies)) {
      const normalizedKey = String(key || "").trim().slice(0, 200);
      if (!normalizedKey) continue;

      const normalizedPolicy = normalizePolicy(value);
      if (!hasPolicySettings(normalizedPolicy)) continue;

      nextState.devicePolicies[normalizedKey] = normalizedPolicy;
    }
  }

  if (raw && typeof raw.groupPolicies === "object") {
    for (const [groupName, value] of Object.entries(raw.groupPolicies)) {
      const group = normalizeGroupName(groupName);
      if (!group) continue;

      const normalizedPolicy = normalizePolicy(value);
      if (!hasPolicySettings(normalizedPolicy)) continue;

      nextState.groupPolicies[group] = normalizedPolicy;
    }
  }

  return nextState;
}

function normalizeGroupPolicyCollection(raw) {
  const policies = {};
  if (!raw || typeof raw !== "object") {
    return policies;
  }

  for (const [groupName, value] of Object.entries(raw)) {
    const group = normalizeGroupName(groupName);
    if (!group) continue;

    const normalizedPolicy = normalizePolicy(value);
    if (!hasPolicySettings(normalizedPolicy)) continue;

    policies[group] = normalizedPolicy;
  }

  return policies;
}

function collectSharedGroups(raw, state) {
  if (Array.isArray(raw?.groups)) {
    for (const groupName of raw.groups) {
      ensureStoredGroup(state, groupName);
    }
  }

  if (raw && typeof raw.deviceAssignments === "object") {
    for (const [key, value] of Object.entries(raw.deviceAssignments)) {
      const normalizedKey = String(key || "").trim().slice(0, 200);
      const group = ensureStoredGroup(state, value?.group);
      if (!normalizedKey || !group) continue;
      state.deviceAssignments[normalizedKey] = { group };
    }
  }

  if (raw && typeof raw.groupPolicies === "object") {
    for (const groupName of Object.keys(raw.groupPolicies)) {
      ensureStoredGroup(state, groupName);
    }
  }

  if (raw && typeof raw.sharedGroupPolicies === "object") {
    for (const groupName of Object.keys(raw.sharedGroupPolicies)) {
      ensureStoredGroup(state, groupName);
    }
  }
}

function normalizePresetCollection(raw) {
  const presets = {};
  if (!raw || typeof raw !== "object") {
    return presets;
  }

  for (const [rawName, value] of Object.entries(raw)) {
    const name = normalizePresetName(rawName || value?.name);
    if (!name) continue;
    const policy = normalizePolicy(value);
    if (!hasPolicySettings(policy)) continue;
    presets[name] = policy;
  }

  return presets;
}

function createAccountRecord(username, password, role = "teacher", classAccess = []) {
  return {
    username,
    role: role === "admin" ? "admin" : "teacher",
    passwordHash: createPasswordHash(password),
    classAccess: role === "admin" ? [] : normalizeClassAccessList(classAccess),
    managedState: createEmptyManagedState(),
  };
}

function normalizeAccountRecord(raw, fallbackUsername = "") {
  const username = normalizeAccountName(raw?.username || fallbackUsername);
  if (!username) {
    return null;
  }

  const role = String(raw?.role || "").trim().toLowerCase() === "admin" ? "admin" : "teacher";
  const passwordHash = typeof raw?.passwordHash === "string" && raw.passwordHash.trim()
    ? raw.passwordHash.trim()
    : (role === "admin" && normalizeAccountKey(username) === normalizeAccountKey(DEFAULT_ADMIN_USERNAME)
      ? createPasswordHash(DEFAULT_ADMIN_PASSWORD)
      : createPasswordHash("changeme"));

  return {
    username,
    role,
    passwordHash,
    classAccess: role === "admin"
      ? []
      : normalizeClassAccessList(raw?.classAccess || raw?.groupAccess),
    managedState: normalizeManagedState(raw?.managedState || raw?.state || raw),
  };
}

function ensureAdminAccount(state) {
  const adminKey = normalizeAccountKey(DEFAULT_ADMIN_USERNAME);
  const existing = state.accounts[adminKey];
  if (!existing) {
    state.accounts[adminKey] = createAccountRecord(DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD, "admin");
    return;
  }

  state.accounts[adminKey] = {
    ...existing,
    username: DEFAULT_ADMIN_USERNAME,
    role: "admin",
    passwordHash: existing.passwordHash || createPasswordHash(DEFAULT_ADMIN_PASSWORD),
    classAccess: [],
    managedState: normalizeManagedState(existing.managedState),
  };
}

function normalizeAccountClassAccess(state) {
  const knownGroups = new Set(state.groups);
  for (const account of Object.values(state.accounts)) {
    if (!account) continue;
    if (isAdminAccount(account)) {
      account.classAccess = [];
      continue;
    }

    account.classAccess = normalizeClassAccessList(account.classAccess)
      .filter((group) => knownGroups.has(group));
  }
}

function normalizePersistedState(raw) {
  const nextState = createEmptyState();

  collectSharedGroups(raw, nextState);
  nextState.groupPolicies = normalizeGroupPolicyCollection(raw?.groupPolicies || raw?.sharedGroupPolicies);

  if (raw?.accounts && typeof raw.accounts === "object") {
    for (const [key, value] of Object.entries(raw.accounts)) {
      collectSharedGroups(value?.managedState || value?.state || value, nextState);
      const normalized = normalizeAccountRecord(value, key);
      if (!normalized) continue;

      for (const [group, policy] of Object.entries(normalized.managedState.groupPolicies || {})) {
        if (!nextState.groupPolicies[group]) {
          nextState.groupPolicies[group] = policy;
        }
      }
      normalized.managedState.groupPolicies = {};

      nextState.accounts[normalizeAccountKey(normalized.username)] = normalized;
    }
  } else {
    const admin = createAccountRecord(DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD, "admin");
    admin.managedState = normalizeManagedState(raw);
    for (const [group, policy] of Object.entries(admin.managedState.groupPolicies || {})) {
      if (!nextState.groupPolicies[group]) {
        nextState.groupPolicies[group] = policy;
      }
    }
    admin.managedState.groupPolicies = {};
    nextState.accounts[normalizeAccountKey(admin.username)] = admin;
  }

  nextState.groups = normalizeClassAccessList(nextState.groups);
  nextState.groupPolicyPresets = normalizePresetCollection(raw?.groupPolicyPresets);
  ensureAdminAccount(nextState);
  normalizeAccountClassAccess(nextState);
  return nextState;
}

function loadPersistedState() {
  try {
    if (!fs.existsSync(STATE_PATH)) {
      const emptyState = createEmptyState();
      ensureAdminAccount(emptyState);
      return emptyState;
    }

    const raw = fs.readFileSync(STATE_PATH, "utf8");
    return normalizePersistedState(JSON.parse(raw));
  } catch {
    const emptyState = createEmptyState();
    ensureAdminAccount(emptyState);
    return emptyState;
  }
}

function savePersistedState() {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(persistedState, null, 2));
}

let persistedState = loadPersistedState();

const sessions = new Map();

function parseCookies(request) {
  const cookieHeader = String(request.headers.cookie || "");
  const cookies = {};

  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = part.split("=");
    const key = rawKey?.trim();
    if (!key) continue;
    cookies[key] = decodeURIComponent(rawValue.join("=").trim());
  }

  return cookies;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge / 1000))}`);
  }
  if (options.httpOnly !== false) {
    parts.push("HttpOnly");
  }
  parts.push("Path=/");
  parts.push("SameSite=Lax");
  return parts.join("; ");
}

function getAllAccounts() {
  return Object.values(persistedState.accounts).sort((left, right) => left.username.localeCompare(right.username));
}

function getAccountByKey(accountKey) {
  return persistedState.accounts[normalizeAccountKey(accountKey)] || null;
}

function getAccountByUsername(username) {
  return getAccountByKey(username);
}

function getAdminAccount() {
  return getAccountByUsername(DEFAULT_ADMIN_USERNAME);
}

function isAdminAccount(account) {
  return account?.role === "admin";
}

function createSession(response, account) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, {
    accountKey: normalizeAccountKey(account.username),
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  response.setHeader("Set-Cookie", serializeCookie(SESSION_COOKIE_NAME, token, { maxAge: SESSION_TTL_MS }));
}

function clearSession(response, request) {
  const token = parseCookies(request)[SESSION_COOKIE_NAME];
  if (token) {
    sessions.delete(token);
  }
  response.setHeader("Set-Cookie", serializeCookie(SESSION_COOKIE_NAME, "", { maxAge: 0 }));
}

function getAuthenticatedAccount(request) {
  const token = parseCookies(request)[SESSION_COOKIE_NAME];
  if (!token) {
    return null;
  }

  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }

  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return getAccountByKey(session.accountKey);
}

function sendJsonError(response, status, message) {
  response.status(status).json({ error: message });
}

function requireAuthenticatedAccount(request, response) {
  const account = getAuthenticatedAccount(request);
  if (!account) {
    sendJsonError(response, 401, "Please sign in first.");
    return null;
  }
  return account;
}

function requireAdminAccount(request, response) {
  const account = requireAuthenticatedAccount(request, response);
  if (!account) {
    return null;
  }
  if (!isAdminAccount(account)) {
    sendJsonError(response, 403, "Admin access is required.");
    return null;
  }
  return account;
}

function serializeCurrentUser(account) {
  return {
    username: account.username,
    role: account.role,
    isAdmin: isAdminAccount(account),
  };
}

function getAllStoredGroups() {
  return normalizeClassAccessList(persistedState.groups);
}

function buildAdminState() {
  return {
    accounts: getAllAccounts().map((account) => ({
      username: account.username,
      role: account.role,
      isAdmin: isAdminAccount(account),
      isPrimaryAdmin: normalizeAccountKey(account.username) === normalizeAccountKey(DEFAULT_ADMIN_USERNAME),
      classAccess: isAdminAccount(account) ? [] : [...account.classAccess],
    })),
    presets: getGroupPolicyPresets(),
  };
}

function buildAdminResponse(account) {
  return {
    admin: buildAdminState(),
    management: getManagementState(account),
  };
}

app.post("/api/login", (request, response) => {
  const username = normalizeAccountName(request.body?.username);
  const password = String(request.body?.password || "");
  const account = getAccountByUsername(username);

  if (!account || !verifyPassword(password, account.passwordHash)) {
    sendJsonError(response, 401, "The username or password was incorrect.");
    return;
  }

  createSession(response, account);
  response.json({ user: serializeCurrentUser(account) });
});

app.post("/api/logout", (request, response) => {
  clearSession(response, request);
  response.json({ ok: true });
});

app.get("/api/session", (request, response) => {
  const account = getAuthenticatedAccount(request);
  if (!account) {
    sendJsonError(response, 401, "Please sign in first.");
    return;
  }

  response.json({
    user: serializeCurrentUser(account),
    management: getManagementState(account),
  });
});

app.get("/api/admin/state", (request, response) => {
  const account = requireAdminAccount(request, response);
  if (!account) return;
  response.json(buildAdminResponse(account));
});

app.post("/api/admin/accounts", (request, response) => {
  const account = requireAdminAccount(request, response);
  if (!account) return;

  const username = normalizeAccountName(request.body?.username);
  const password = String(request.body?.password || "");
  if (!username || !password) {
    sendJsonError(response, 400, "Enter a username and password first.");
    return;
  }
  if (!createUserAccount(username, password, { isAdmin: Boolean(request.body?.isAdmin) })) {
    sendJsonError(response, 400, "That account already exists or could not be created.");
    return;
  }

  response.json(buildAdminResponse(account));
});

app.post("/api/admin/password", (request, response) => {
  const account = requireAdminAccount(request, response);
  if (!account) return;

  const username = normalizeAccountName(request.body?.username);
  const password = String(request.body?.password || "");
  if (!username || !password) {
    sendJsonError(response, 400, "Choose an account and enter a new password first.");
    return;
  }
  if (!setAccountPassword(username, password)) {
    sendJsonError(response, 400, "Could not update that password.");
    return;
  }

  response.json(buildAdminResponse(account));
});

app.post("/api/admin/accounts/access", (request, response) => {
  const account = requireAdminAccount(request, response);
  if (!account) return;

  const username = normalizeAccountName(request.body?.username);
  const classAccess = normalizeClassAccessList(request.body?.classAccess);
  const isAdmin = Boolean(request.body?.isAdmin);
  if (!username) {
    sendJsonError(response, 400, "Choose an account first.");
    return;
  }
  if (!setAccountAccess(username, { isAdmin, classAccess })) {
    sendJsonError(response, 400, "Could not update access for that account.");
    return;
  }

  refreshAllManagedState(true);
  response.json(buildAdminResponse(account));
});

app.post("/api/admin/accounts/delete", (request, response) => {
  const account = requireAdminAccount(request, response);
  if (!account) return;

  const username = normalizeAccountName(request.body?.username);
  if (!username) {
    sendJsonError(response, 400, "Choose an account first.");
    return;
  }
  if (!deleteUserAccount(username)) {
    sendJsonError(response, 400, "Could not delete that account.");
    return;
  }

  refreshAllManagedState(true);
  response.json(buildAdminResponse(account));
});

app.post("/api/admin/presets", (request, response) => {
  const account = requireAdminAccount(request, response);
  if (!account) return;

  const name = normalizePresetName(request.body?.name);
  if (!name) {
    sendJsonError(response, 400, "Enter a preset name first.");
    return;
  }
  if (!setGroupPolicyPreset(name, request.body?.allowedPrograms, request.body?.allowedSites, { websiteMode: request.body?.websiteMode })) {
    sendJsonError(response, 400, "Could not save that preset.");
    return;
  }

  broadcastDeviceList();
  response.json(buildAdminResponse(account));
});

app.post("/api/admin/presets/delete", (request, response) => {
  const account = requireAdminAccount(request, response);
  if (!account) return;

  const name = normalizePresetName(request.body?.name);
  if (!name) {
    sendJsonError(response, 400, "Choose a preset first.");
    return;
  }
  if (!deleteGroupPolicyPreset(name)) {
    sendJsonError(response, 400, "Could not delete that preset.");
    return;
  }

  broadcastDeviceList();
  response.json(buildAdminResponse(account));
});

app.post("/api/admin/classes", (request, response) => {
  const account = requireAdminAccount(request, response);
  if (!account) return;

  const group = normalizeGroupName(request.body?.group);
  if (!group) {
    sendJsonError(response, 400, "Enter a class name first.");
    return;
  }
  if (!createGroup(group)) {
    sendJsonError(response, 400, "Could not create that class.");
    return;
  }

  refreshAllManagedState(true);
  response.json(buildAdminResponse(account));
});

app.post("/api/admin/classes/rename", (request, response) => {
  const account = requireAdminAccount(request, response);
  if (!account) return;

  const group = normalizeGroupName(request.body?.group);
  const nextGroup = normalizeGroupName(request.body?.nextGroup);
  if (!group || !nextGroup) {
    sendJsonError(response, 400, "Choose a class and enter the new class name.");
    return;
  }
  if (!renameGroup(group, nextGroup)) {
    sendJsonError(response, 400, "Could not rename that class.");
    return;
  }

  refreshAllManagedState(true);
  response.json(buildAdminResponse(account));
});

app.post("/api/admin/classes/delete", (request, response) => {
  const account = requireAdminAccount(request, response);
  if (!account) return;

  const group = normalizeGroupName(request.body?.group);
  if (!group) {
    sendJsonError(response, 400, "Choose a class first.");
    return;
  }
  if (!deleteGroup(group)) {
    sendJsonError(response, 400, "Could not delete that class.");
    return;
  }

  refreshAllManagedState(true);
  response.json(buildAdminResponse(account));
});

app.post("/api/admin/classes/assign", (request, response) => {
  const account = requireAdminAccount(request, response);
  if (!account) return;

  const group = normalizeGroupName(request.body?.group);
  const device = getAdminManagedDeviceReference(request.body);
  if (!device) {
    sendJsonError(response, 400, "Choose a device first.");
    return;
  }
  if (!setPersistedDeviceGroup(device, group)) {
    sendJsonError(response, 400, group ? "Could not assign that class." : "Could not clear that class.");
    return;
  }

  refreshAllManagedState(true);
  response.json(buildAdminResponse(account));
});

const websocketOptions = {
  noServer: true,
  maxPayload: MAX_UPDATE_PAYLOAD_BYTES,
  perMessageDeflate: {
    clientNoContextTakeover: true,
    serverNoContextTakeover: true,
    threshold: 1024,
  },
};

const dashboardWss = new WebSocketServer({ ...websocketOptions });
const agentWss = new WebSocketServer({ ...websocketOptions });

const dashboards = new Set();
const devices = new Map();
const auditEvents = [];

function normalizeIp(value) {
  if (!value) return "";
  if (value.startsWith("::ffff:")) return value.slice(7);
  if (value === "::1") return "127.0.0.1";
  return value;
}

function buildDiscoveryResponse() {
  return Buffer.from(JSON.stringify({
    type: "classroom_master",
    protocol: DISCOVERY_PROTOCOL,
    httpPort: HTTP_PORT,
    agentPath: "/agent",
    hostname: os.hostname(),
  }));
}

function buildLegacyDeviceKey(device) {
  const hostname = device.hostname || "unknown-host";
  const username = device.username || "unknown-user";
  return `${hostname}:${username}`;
}

function buildPreferenceKey(device) {
  return device.agentId || buildLegacyDeviceKey(device);
}

function buildDeviceId(device) {
  if (device.agentId) return device.agentId;
  const ip = device.ip || "unknown-ip";
  return `${buildLegacyDeviceKey(device)}:${ip}`;
}

function getManagedStateForAccount(account) {
  return account?.managedState || createEmptyManagedState();
}

function migrateSharedDeviceReferences(device) {
  if (!device?.agentId) {
    return false;
  }

  const primaryKey = buildPreferenceKey(device);
  const legacyKey = buildLegacyDeviceKey(device);
  if (primaryKey === legacyKey) {
    return false;
  }

  if (!persistedState.deviceAssignments[primaryKey] && persistedState.deviceAssignments[legacyKey]) {
    persistedState.deviceAssignments[primaryKey] = persistedState.deviceAssignments[legacyKey];
    delete persistedState.deviceAssignments[legacyKey];
    savePersistedState();
    return true;
  }

  return false;
}

function getPersistedDeviceGroup(device) {
  migrateSharedDeviceReferences(device);
  return persistedState.deviceAssignments[buildPreferenceKey(device)]?.group || "";
}

function migrateAccountDevicePolicyReferences(account, device) {
  if (!account || !device?.agentId) {
    return false;
  }

  const state = getManagedStateForAccount(account);
  const primaryKey = buildPreferenceKey(device);
  const legacyKey = buildLegacyDeviceKey(device);
  if (primaryKey === legacyKey) {
    return false;
  }

  if (!state.devicePolicies[primaryKey] && state.devicePolicies[legacyKey]) {
    state.devicePolicies[primaryKey] = state.devicePolicies[legacyKey];
    delete state.devicePolicies[legacyKey];
    savePersistedState();
    return true;
  }

  return false;
}

function getAdminManagedDeviceReference(raw = {}) {
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (id && devices.has(id)) {
    return devices.get(id);
  }

  const key = typeof raw.key === "string" ? raw.key.trim().slice(0, 200) : "";
  if (!key) {
    return null;
  }

  return {
    agentId: key,
    hostname: key,
    username: key,
  };
}

function setPersistedDeviceGroup(device, group) {
  const key = buildPreferenceKey(device);
  if (!key) return false;

  if (!group) {
    delete persistedState.deviceAssignments[key];
    savePersistedState();
    return true;
  }

  if (!getAllStoredGroups().includes(group)) {
    return false;
  }

  persistedState.deviceAssignments[key] = { group };
  savePersistedState();
  return true;
}

function getPersistedDevicePolicy(account, device) {
  if (!account || !device) {
    return createEmptyPolicy();
  }

  migrateAccountDevicePolicyReferences(account, device);
  return getManagedStateForAccount(account).devicePolicies[buildPreferenceKey(device)] || createEmptyPolicy();
}

function setPersistedDevicePolicy(account, device, allowedPrograms, allowedSites, options = {}) {
  if (!account || !device || !canAccessDevice(account, device)) {
    return false;
  }

  const key = buildPreferenceKey(device);
  if (!key) {
    return false;
  }

  const state = getManagedStateForAccount(account);
  const normalizedPolicy = normalizePolicy({
    allowedPrograms,
    allowedSites,
    websiteMode: options.websiteMode,
  });

  if (!hasPolicySettings(normalizedPolicy)) {
    delete state.devicePolicies[key];
  } else {
    state.devicePolicies[key] = normalizedPolicy;
  }

  savePersistedState();
  return true;
}

function getAllGroupNames() {
  return getAllStoredGroups();
}

function getAccessibleGroupNames(account) {
  if (!account) {
    return [];
  }

  if (isAdminAccount(account)) {
    return getAllStoredGroups();
  }

  const allowedGroups = new Set(normalizeClassAccessList(account.classAccess));
  return getAllStoredGroups().filter((group) => allowedGroups.has(group));
}

function canAccountManageGroup(account, group) {
  const normalized = normalizeGroupName(group);
  if (!account || !normalized) {
    return false;
  }

  if (isAdminAccount(account)) {
    return true;
  }

  return account.classAccess.includes(normalized);
}

function getGroupPolicy(account, group) {
  const normalizedGroup = normalizeGroupName(group);
  if (!normalizedGroup || !canAccountManageGroup(account, normalizedGroup)) {
    return createEmptyPolicy();
  }

  const stored = persistedState.groupPolicies[normalizedGroup];
  if (!stored) {
    return createEmptyPolicy();
  }

  return {
    allowedPrograms: Array.isArray(stored.allowedPrograms) ? [...stored.allowedPrograms] : [],
    allowedSites: Array.isArray(stored.allowedSites) ? [...stored.allowedSites] : [],
    websiteMode: normalizeWebsiteMode(stored.websiteMode),
  };
}

function setPersistedGroupPolicy(account, group, allowedPrograms, allowedSites, options = {}) {
  const normalizedGroup = normalizeGroupName(group);
  if (!account || !normalizedGroup || !getAllStoredGroups().includes(normalizedGroup) || !canAccountManageGroup(account, normalizedGroup)) {
    return false;
  }

  const normalizedPolicy = normalizePolicy({
    allowedPrograms,
    allowedSites,
    websiteMode: options.websiteMode,
  });

  if (!hasPolicySettings(normalizedPolicy)) {
    delete persistedState.groupPolicies[normalizedGroup];
  } else {
    persistedState.groupPolicies[normalizedGroup] = normalizedPolicy;
  }

  savePersistedState();
  return true;
}

function createGroup(group) {
  const normalized = normalizeGroupName(group);
  if (!normalized) return false;

  if (persistedState.groups.includes(normalized)) {
    return true;
  }

  persistedState.groups.push(normalized);
  persistedState.groups = normalizeClassAccessList(persistedState.groups);
  savePersistedState();
  return true;
}

function renameGroup(group, nextGroup) {
  const current = normalizeGroupName(group);
  const renamed = normalizeGroupName(nextGroup);
  if (!current || !renamed) return false;
  if (current === renamed) return true;
  if (getAllStoredGroups().includes(renamed)) {
    return false;
  }

  persistedState.groups = normalizeClassAccessList(
    getAllStoredGroups().map((existing) => existing === current ? renamed : existing),
  );

  for (const assignment of Object.values(persistedState.deviceAssignments)) {
    if (assignment?.group === current) {
      assignment.group = renamed;
    }
  }

  for (const account of getAllAccounts()) {
    if (!isAdminAccount(account)) {
      account.classAccess = normalizeClassAccessList(
        account.classAccess.map((existing) => existing === current ? renamed : existing),
      );
    }
    delete getManagedStateForAccount(account).groupPolicies[current];
  }

  if (persistedState.groupPolicies[current]) {
    persistedState.groupPolicies[renamed] = persistedState.groupPolicies[current];
    delete persistedState.groupPolicies[current];
  }

  savePersistedState();
  return true;
}

function deleteGroup(group) {
  const normalized = normalizeGroupName(group);
  if (!normalized) return false;

  persistedState.groups = persistedState.groups.filter((existing) => existing !== normalized);
  for (const [key, assignment] of Object.entries(persistedState.deviceAssignments)) {
    if (assignment?.group === normalized) {
      delete persistedState.deviceAssignments[key];
    }
  }

  for (const account of getAllAccounts()) {
    if (!isAdminAccount(account)) {
      account.classAccess = account.classAccess.filter((existing) => existing !== normalized);
    }

    delete getManagedStateForAccount(account).groupPolicies[normalized];
  }

  delete persistedState.groupPolicies[normalized];

  savePersistedState();
  return true;
}

function getGroupPolicyPresets() {
  return Object.fromEntries(
    Object.entries(persistedState.groupPolicyPresets).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function setGroupPolicyPreset(name, allowedPrograms, allowedSites, options = {}) {
  const presetName = normalizePresetName(name);
  if (!presetName) return false;

  const normalizedPolicy = normalizePolicy({
    allowedPrograms,
    allowedSites,
    websiteMode: options.websiteMode,
  });
  if (!hasPolicySettings(normalizedPolicy)) {
    return false;
  }

  persistedState.groupPolicyPresets[presetName] = normalizedPolicy;
  savePersistedState();
  return true;
}

function deleteGroupPolicyPreset(name) {
  const presetName = normalizePresetName(name);
  if (!presetName || !persistedState.groupPolicyPresets[presetName]) {
    return false;
  }

  delete persistedState.groupPolicyPresets[presetName];
  savePersistedState();
  return true;
}

function createUserAccount(username, password, options = {}) {
  const normalizedUsername = normalizeAccountName(username);
  const accountKey = normalizeAccountKey(normalizedUsername);
  if (!normalizedUsername || !password || !accountKey || persistedState.accounts[accountKey]) {
    return false;
  }

  persistedState.accounts[accountKey] = createAccountRecord(
    normalizedUsername,
    password,
    Boolean(options.isAdmin) ? "admin" : "teacher",
  );
  savePersistedState();
  return true;
}

function clearSessionsForAccount(accountKey) {
  const normalizedKey = normalizeAccountKey(accountKey);
  if (!normalizedKey) return;

  for (const [token, session] of sessions) {
    if (normalizeAccountKey(session?.accountKey) === normalizedKey) {
      sessions.delete(token);
    }
  }
}

function disconnectDashboardsForAccount(accountKey) {
  const normalizedKey = normalizeAccountKey(accountKey);
  if (!normalizedKey) return;

  for (const socket of dashboards) {
    if (normalizeAccountKey(socket.account?.username) === normalizedKey) {
      try {
        socket.close(1008, "Account removed.");
      } catch {
      }
    }
  }
}

function setAccountPassword(username, password) {
  const account = getAccountByUsername(username);
  if (!account || !password) {
    return false;
  }

  account.passwordHash = createPasswordHash(password);
  savePersistedState();
  return true;
}

function setAccountAccess(username, options = {}) {
  const account = getAccountByUsername(username);
  if (!account) {
    return false;
  }

  const accountKey = normalizeAccountKey(account.username);
  const isPrimaryAdmin = accountKey === normalizeAccountKey(DEFAULT_ADMIN_USERNAME);
  const nextIsAdmin = isPrimaryAdmin ? true : Boolean(options.isAdmin);
  if (isPrimaryAdmin && !Boolean(options.isAdmin)) {
    return false;
  }

  account.role = nextIsAdmin ? "admin" : "teacher";
  account.classAccess = nextIsAdmin
    ? []
    : normalizeClassAccessList(options.classAccess).filter((group) => persistedState.groups.includes(group));
  savePersistedState();
  return true;
}

function deleteUserAccount(username) {
  const normalizedUsername = normalizeAccountName(username);
  const accountKey = normalizeAccountKey(normalizedUsername);
  const account = getAccountByKey(accountKey);
  if (!account || accountKey === normalizeAccountKey(DEFAULT_ADMIN_USERNAME)) {
    return false;
  }

  delete persistedState.accounts[accountKey];
  clearSessionsForAccount(accountKey);
  disconnectDashboardsForAccount(accountKey);
  savePersistedState();
  return true;
}

function canAccessDevice(account, device) {
  if (!account || !device) return false;
  if (isAdminAccount(account)) return true;
  const group = getPersistedDeviceGroup(device);
  return Boolean(group && account.classAccess.includes(group));
}

function getScreenShareOwnerKey(device) {
  return normalizeAccountKey(device?.screenShareOwnerKey || "");
}

function isLiveScreenShareStatus(status) {
  return status === "Requested" || status === "Active";
}

function getScreenShareOwnerAccount(device) {
  const ownerKey = getScreenShareOwnerKey(device);
  return ownerKey ? getAccountByKey(ownerKey) : null;
}

function isScreenShareOwnedByAccount(account, device) {
  if (!account || !device) {
    return false;
  }

  const ownerKey = getScreenShareOwnerKey(device);
  return Boolean(ownerKey && ownerKey === normalizeAccountKey(account.username));
}

function isScreenShareBusyForAccount(account, device) {
  if (!account || !device) {
    return false;
  }

  return Boolean(
    canAccessDevice(account, device)
    && isLiveScreenShareStatus(device.screenShareStatus)
    && getScreenShareOwnerKey(device)
    && !isScreenShareOwnedByAccount(account, device),
  );
}

function canAccountViewScreenShare(account, device) {
  return Boolean(
    account
    && device
    && canAccessDevice(account, device)
    && device.screenShareStatus === "Active",
  );
}

function canAccountControlScreenShare(account, device) {
  return Boolean(
    account
    && device
    && canAccessDevice(account, device)
    && device.screenShareStatus === "Active",
  );
}

function canAccountCancelScreenShareRequest(account, device) {
  return Boolean(
    account
    && device
    && canAccessDevice(account, device)
    && isScreenShareOwnedByAccount(account, device)
    && device.screenShareStatus === "Requested",
  );
}

function canAccountEndScreenShare(account, device) {
  return Boolean(
    account
    && device
    && canAccessDevice(account, device)
    && device.screenShareStatus === "Active",
  );
}

function getVisibleScreenShareState(account, device) {
  const actualTeacherSession = typeof device?.teacherSession === "string" && device.teacherSession.trim()
    ? device.teacherSession.trim()
    : "Standby";
  const actualScreenShareStatus = typeof device?.screenShareStatus === "string" && device.screenShareStatus.trim()
    ? device.screenShareStatus.trim()
    : "Idle";
  const ownerAccount = getScreenShareOwnerAccount(device);
  const ownerName = ownerAccount?.username || "";
  const ownedByCurrentUser = isScreenShareOwnedByAccount(account, device);

  return {
    teacherSession: actualTeacherSession,
    screenShareStatus: actualScreenShareStatus,
    screenShareBusy: actualScreenShareStatus === "Requested" && Boolean(ownerName) && !ownedByCurrentUser,
    screenShareOwnedByCurrentUser: ownedByCurrentUser,
    screenShareOwnerName: ownerName,
  };
}

function getManagementState(account) {
  const groups = getAccessibleGroupNames(account);
  const policies = {};
  for (const group of groups) {
    const policy = getGroupPolicy(account, group);
    if (hasPolicySettings(policy)) {
      policies[group] = policy;
    }
  }

  return {
    groups,
    policies,
    presets: getGroupPolicyPresets(),
  };
}

function sanitizeBattery(battery = {}) {
  const rawPercent = battery.percent;
  const hasPercent = rawPercent !== null && rawPercent !== undefined && rawPercent !== "";
  return {
    percent: hasPercent && Number.isFinite(Number(rawPercent)) ? Number(rawPercent) : null,
    charging: Boolean(battery.charging),
    present: battery.present !== false,
    text: typeof battery.text === "string" ? battery.text : "Unavailable",
  };
}

function sanitizeDevicePayload(raw = {}, request) {
  return {
    agentId: typeof raw.agentId === "string" && raw.agentId.trim() ? raw.agentId.trim() : "",
    agentVersion: typeof raw.agentVersion === "string" && raw.agentVersion.trim() ? raw.agentVersion.trim() : "unknown",
    hostname: typeof raw.hostname === "string" && raw.hostname.trim() ? raw.hostname.trim() : "Unknown device",
    username: typeof raw.username === "string" && raw.username.trim() ? raw.username.trim() : "Unknown user",
    ip: typeof raw.ip === "string" && raw.ip.trim() ? raw.ip.trim() : normalizeIp(request.socket.remoteAddress),
    platform: typeof raw.platform === "string" && raw.platform.trim() ? raw.platform.trim() : "Unknown",
    version: typeof raw.version === "string" && raw.version.trim() ? raw.version.trim() : "",
    appStatus: typeof raw.appStatus === "string" && raw.appStatus.trim() ? raw.appStatus.trim() : "Unavailable",
    foregroundProcess: typeof raw.foregroundProcess === "string" && raw.foregroundProcess.trim() ? raw.foregroundProcess.trim() : "Unavailable",
    foregroundPath: typeof raw.foregroundPath === "string" && raw.foregroundPath.trim() ? raw.foregroundPath.trim() : "",
    browserUrl: typeof raw.browserUrl === "string" && raw.browserUrl.trim() ? raw.browserUrl.trim().slice(0, 400) : "",
    browserDomain: typeof raw.browserDomain === "string" && raw.browserDomain.trim() ? raw.browserDomain.trim().slice(0, 120) : "",
    sessionStatus: typeof raw.sessionStatus === "string" && raw.sessionStatus.trim() ? raw.sessionStatus.trim() : "Unknown",
    teacherSession: typeof raw.teacherSession === "string" && raw.teacherSession.trim() ? raw.teacherSession.trim() : "Standby",
    screenShareStatus: typeof raw.screenShareStatus === "string" && raw.screenShareStatus.trim() ? raw.screenShareStatus.trim() : "Idle",
    attentionMode: typeof raw.attentionMode === "string" && raw.attentionMode.trim() ? raw.attentionMode.trim() : "Off",
    screenBlackout: typeof raw.screenBlackout === "string" && raw.screenBlackout.trim() ? raw.screenBlackout.trim() : "Off",
    imageDisplay: typeof raw.imageDisplay === "string" && raw.imageDisplay.trim() ? raw.imageDisplay.trim() : "Off",
    announcementDisplay: typeof raw.announcementDisplay === "string" && raw.announcementDisplay.trim() ? raw.announcementDisplay.trim() : "Off",
    updateStatus: typeof raw.updateStatus === "string" && raw.updateStatus.trim() ? raw.updateStatus.trim() : "Idle",
    updateMessage: typeof raw.updateMessage === "string" && raw.updateMessage.trim() ? raw.updateMessage.trim().slice(0, 200) : "",
    battery: sanitizeBattery(raw.battery),
  };
}

function matchesRuleList(value, rules) {
  const haystack = String(value || "").toLowerCase();
  return rules.some((rule) => haystack.includes(rule.toLowerCase()));
}

function normalizeSiteToken(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";

  let candidate = raw.replace(/^view-source:/, "");
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(candidate) && !candidate.startsWith("about:") && !candidate.startsWith("chrome:") && !candidate.startsWith("edge:")) {
    if (candidate.startsWith("localhost") || (/^[^\s/]+\.[^\s]+/.test(candidate) && !candidate.includes(" "))) {
      candidate = `https://${candidate}`;
    }
  }

  try {
    const parsed = new URL(candidate);
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith("www.")) {
      host = host.slice(4);
    }
    return host;
  } catch {
    return "";
  }
}

const SITE_KEYWORD_STOP_WORDS = new Set([
  "app",
  "co",
  "com",
  "de",
  "dev",
  "edu",
  "gov",
  "info",
  "io",
  "local",
  "localhost",
  "mil",
  "net",
  "online",
  "org",
  "schule",
  "school",
  "site",
  "uk",
  "us",
  "www",
]);

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSiteKeywords(value) {
  const normalized = normalizeSiteToken(value);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(".")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length >= 3 && !SITE_KEYWORD_STOP_WORDS.has(part));
}

function titleContainsSiteKeywords(title, keywords) {
  const titleText = String(title || "").toLowerCase();
  if (!titleText || !keywords.length) {
    return false;
  }

  return keywords.every((keyword) => {
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(keyword)}([^a-z0-9]|$)`, "i");
    return pattern.test(titleText);
  });
}

function matchesSiteRule(device, rule) {
  const rawRule = String(rule || "").trim().toLowerCase();
  if (!rawRule) return false;

  const normalizedRule = normalizeSiteToken(rawRule);
  const urlCandidates = [device.browserUrl, device.browserDomain]
    .map((value) => String(value || "").toLowerCase())
    .filter(Boolean);
  const titleCandidates = [device.appStatus]
    .map((value) => String(value || "").toLowerCase())
    .filter(Boolean);

  if (urlCandidates.some((candidate) => candidate.includes(rawRule))) {
    return true;
  }

  if (titleCandidates.some((candidate) => candidate.includes(rawRule))) {
    return true;
  }

  const siteKeywords = extractSiteKeywords(rawRule);
  if (titleCandidates.some((candidate) => titleContainsSiteKeywords(candidate, siteKeywords))) {
    return true;
  }

  if (!normalizedRule) {
    return false;
  }

  return urlCandidates.some((candidate) => {
    const candidateHost = normalizeSiteToken(candidate);
    return candidateHost === normalizedRule || candidateHost.endsWith(`.${normalizedRule}`);
  });
}

function matchesSitePolicy(device, rules) {
  return rules.some((rule) => matchesSiteRule(device, rule));
}

function matchesWebsiteHistoryEntry(entry, rules) {
  const allowedRules = Array.isArray(rules) ? rules : [];
  if (!allowedRules.length || !entry) {
    return false;
  }

  const label = typeof entry.label === "string" ? entry.label : "";
  const detail = typeof entry.detail === "string" ? entry.detail : "";
  return allowedRules.some((rule) => matchesSiteRule({
    browserUrl: detail || label,
    browserDomain: label,
    appStatus: [label, detail].filter(Boolean).join(" "),
  }, rule));
}

function serializeWebsiteHistory(record, policy) {
  return Array.isArray(record.websiteHistory)
    ? record.websiteHistory.map(({ label, detail, at }) => {
      const historyEntry = { label, detail, at };
      return {
        ...historyEntry,
        forbidden: Array.isArray(policy?.allowedSites) && policy.allowedSites.length
          ? !matchesWebsiteHistoryEntry(historyEntry, policy.allowedSites)
          : false,
      };
    })
    : [];
}

function describeObservedBrowserSite(device) {
  if (device.browserDomain) return device.browserDomain;
  if (device.browserUrl) return device.browserUrl;
  if (device.appStatus) return device.appStatus;
  return "the current browser tab";
}

function isBrowserProcess(processName) {
  return KNOWN_BROWSER_PROCESSES.has(String(processName || "").trim().toLowerCase());
}

function evaluateFocusPolicy(device, policy) {
  const allowedPrograms = policy.allowedPrograms || [];
  const allowedSites = policy.allowedSites || [];

  if (!allowedPrograms.length && !allowedSites.length) {
    return {
      monitored: false,
      offTask: false,
      reason: "",
    };
  }

  if (!device.online) {
    return {
      monitored: true,
      offTask: false,
      reason: "",
    };
  }

  const processLabel = [device.foregroundProcess, device.foregroundPath, device.appStatus]
    .filter(Boolean)
    .join(" ");
  const browserActive = isBrowserProcess(device.foregroundProcess);
  const programMatch = matchesRuleList(processLabel, allowedPrograms);
  const siteMatch = matchesSitePolicy(device, allowedSites);

  if (browserActive && allowedSites.length) {
    if (siteMatch) {
      return {
        monitored: true,
        offTask: false,
        reason: "",
      };
    }

    return {
      monitored: true,
      offTask: true,
      reason: `${describeObservedBrowserSite(device)} is not in the allowed website list.`,
    };
  }

  if (allowedPrograms.length) {
    if (programMatch) {
      return {
        monitored: true,
        offTask: false,
        reason: "",
      };
    }

    return {
      monitored: true,
      offTask: true,
      reason: `${device.foregroundProcess || device.appStatus || "Current activity"} is outside the allowed program list.`,
    };
  }

  return {
    monitored: true,
    offTask: true,
    reason: `${describeObservedBrowserSite(device)} is not in the allowed website list.`,
  };
}

function getManagedDeviceState(account, record) {
  const group = getPersistedDeviceGroup(record);
  const groupPolicy = canAccountManageGroup(account, group) ? getGroupPolicy(account, group) : createEmptyPolicy();
  const devicePolicy = getPersistedDevicePolicy(account, record);
  const policy = hasPolicySettings(devicePolicy) ? devicePolicy : groupPolicy;
  const evaluation = evaluateFocusPolicy(record, policy);
  const policySource = hasPolicySettings(devicePolicy)
    ? "individual"
    : (hasPolicySettings(groupPolicy) ? "class" : "none");

  return {
    group,
    groupPolicy,
    devicePolicy,
    policy,
    policySource,
    monitored: evaluation.monitored,
    offTask: evaluation.offTask,
    offTaskReason: evaluation.reason,
  };
}

function accountHasManagedStateForDevice(account, record) {
  const managed = getManagedDeviceState(account, record);
  return Boolean(
    hasPolicySettings(managed.devicePolicy)
    || (managed.group && hasPolicySettings(managed.groupPolicy)),
  );
}

function serializeDevice(record, account) {
  const managed = getManagedDeviceState(account, record);
  const visibleScreenShare = getVisibleScreenShareState(account, record);
  const websiteHistory = serializeWebsiteHistory(record, managed.policy);
  return {
    id: record.id,
    agentId: record.agentId,
    agentVersion: record.agentVersion,
    hostname: record.hostname,
    username: record.username,
    ip: record.ip,
    platform: record.platform,
    version: record.version,
    appStatus: record.appStatus,
    foregroundProcess: record.foregroundProcess,
    foregroundPath: record.foregroundPath,
    browserUrl: record.browserUrl,
    browserDomain: record.browserDomain,
    sessionStatus: record.sessionStatus,
    teacherSession: visibleScreenShare.teacherSession,
    screenShareStatus: visibleScreenShare.screenShareStatus,
    screenShareBusy: visibleScreenShare.screenShareBusy,
    screenShareOwnedByCurrentUser: visibleScreenShare.screenShareOwnedByCurrentUser,
    screenShareOwnerName: visibleScreenShare.screenShareOwnerName,
    attentionMode: record.attentionMode,
    screenBlackout: record.screenBlackout,
    imageDisplay: record.imageDisplay,
    announcementDisplay: record.announcementDisplay,
    updateStatus: record.updateStatus,
    updateMessage: record.updateMessage,
    battery: record.battery,
    group: managed.group,
    groupPolicy: managed.groupPolicy,
    devicePolicy: managed.devicePolicy,
    policy: managed.policy,
    policySource: managed.policySource,
    monitored: managed.monitored,
    offTask: managed.offTask,
    offTaskReason: managed.offTaskReason,
    programHistory: Array.isArray(record.programHistory) ? record.programHistory.map(({ label, detail, at }) => ({ label, detail, at })) : [],
    websiteHistory,
    online: record.online,
    lastSeen: record.lastSeen,
    connectedAt: record.connectedAt,
  };
}

function sanitizeScreenFrame(raw = {}) {
  const width = Number(raw.width);
  const height = Number(raw.height);
  const capturedAt = Number(raw.capturedAt);
  const sourceLeft = Number(raw.sourceLeft);
  const sourceTop = Number(raw.sourceTop);
  const sourceWidth = Number(raw.sourceWidth);
  const sourceHeight = Number(raw.sourceHeight);

  if (typeof raw.data !== "string" || !raw.data.trim()) {
    return null;
  }

  return {
    mimeType: raw.mimeType === "image/png" ? "image/png" : "image/bmp",
    data: raw.data.trim(),
    width: Number.isFinite(width) ? width : null,
    height: Number.isFinite(height) ? height : null,
    sourceLeft: Number.isFinite(sourceLeft) ? sourceLeft : 0,
    sourceTop: Number.isFinite(sourceTop) ? sourceTop : 0,
    sourceWidth: Number.isFinite(sourceWidth) ? sourceWidth : null,
    sourceHeight: Number.isFinite(sourceHeight) ? sourceHeight : null,
    capturedAt: Number.isFinite(capturedAt) ? capturedAt : Date.now(),
  };
}

function getAccessibleDevices(account) {
  return Array.from(devices.values())
    .filter((device) => Date.now() - device.lastSeen < RETAIN_OFFLINE_MS)
    .filter((device) => canAccessDevice(account, device));
}

function getDeviceList(account) {
  return getAccessibleDevices(account)
    .sort((left, right) => {
      const leftManaged = getManagedDeviceState(account, left);
      const rightManaged = getManagedDeviceState(account, right);
      if (left.online !== right.online) return left.online ? -1 : 1;
      if (leftManaged.offTask !== rightManaged.offTask) return leftManaged.offTask ? -1 : 1;
      return left.hostname.localeCompare(right.hostname);
    })
    .map((device) => serializeDevice(device, account));
}

function sendDeviceList(socket) {
  if (socket.readyState !== WebSocket.OPEN || !socket.account) return;
  socket.send(JSON.stringify({
    type: "device_list",
    devices: getDeviceList(socket.account),
    groups: getManagementState(socket.account),
  }));
}

function broadcastDeviceList() {
  for (const socket of dashboards) {
    sendDeviceList(socket);
  }
}

function getAuditLog(account) {
  return auditEvents
    .filter((event) => {
      const device = devices.get(event.deviceId);
      return Boolean(device && canAccessDevice(account, device));
    })
    .slice(0, 24);
}

function sendAuditLog(socket) {
  if (socket.readyState !== WebSocket.OPEN || !socket.account) return;
  socket.send(JSON.stringify({ type: "audit_log", events: getAuditLog(socket.account) }));
}

function broadcastAuditLog() {
  for (const socket of dashboards) {
    sendAuditLog(socket);
  }
}

function canDashboardAccessDevice(socket, deviceId) {
  const device = devices.get(deviceId);
  return Boolean(device && socket.account && canAccessDevice(socket.account, device));
}

function sendScreenFrame(socket, deviceId, frame) {
  const device = devices.get(deviceId);
  if (socket.readyState !== WebSocket.OPEN || !device || !canAccountViewScreenShare(socket.account, device)) return;
  socket.send(JSON.stringify({ type: "screen_frame", id: deviceId, frame }));
}

function sendThumbnailFrame(socket, deviceId, frame) {
  if (socket.readyState !== WebSocket.OPEN || !canDashboardAccessDevice(socket, deviceId)) return;
  socket.send(JSON.stringify({ type: "thumbnail_frame", id: deviceId, frame }));
}

function broadcastScreenFrame(deviceId, frame) {
  for (const socket of dashboards) {
    sendScreenFrame(socket, deviceId, frame);
  }
}

function broadcastThumbnailFrame(deviceId, frame) {
  for (const socket of dashboards) {
    sendThumbnailFrame(socket, deviceId, frame);
  }
}

function broadcastScreenFrameClear(deviceId) {
  const message = JSON.stringify({ type: "screen_frame_clear", id: deviceId });
  for (const socket of dashboards) {
    if (socket.readyState === WebSocket.OPEN && canDashboardAccessDevice(socket, deviceId)) {
      socket.send(message);
    }
  }
}

function sendStoredFrames(socket) {
  for (const device of getAccessibleDevices(socket.account)) {
    if (device.latestFrame && canAccountViewScreenShare(socket.account, device)) {
      sendScreenFrame(socket, device.id, device.latestFrame);
    }
    if (device.latestThumbnail) {
      sendThumbnailFrame(socket, device.id, device.latestThumbnail);
    }
  }
}

function logAudit(action, device, detail, options = {}) {
  if (!device) return;

  const explicitAccountKey = normalizeAccountKey(options.accountKey || "");
  const accountKey = explicitAccountKey || getScreenShareOwnerKey(device);
  const accountUsername = normalizeAccountName(options.accountUsername || getAccountByKey(accountKey)?.username || "");

  auditEvents.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    action,
    detail,
    accountKey,
    accountUsername,
    deviceId: device.id,
    hostname: device.hostname,
    username: device.username,
  });

  if (auditEvents.length > MAX_AUDIT_EVENTS) {
    auditEvents.length = MAX_AUDIT_EVENTS;
  }

  broadcastAuditLog();
}

function logFocusTransition(previous, nextRecord) {
}

function sanitizeActivityHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const key = typeof entry.key === "string" ? entry.key.trim().slice(0, 260) : "";
  const label = typeof entry.label === "string" ? entry.label.trim().slice(0, 180) : "";
  const detail = typeof entry.detail === "string" ? entry.detail.trim().slice(0, 320) : "";
  const at = Number(entry.at);
  if (!key || !label) {
    return null;
  }

  return {
    key,
    label,
    detail,
    at: Number.isFinite(at) ? at : Date.now(),
  };
}

function trimActivityText(value, maxLength = 180) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function isIgnoredActivityLabel(value) {
  const normalized = trimActivityText(value).toLowerCase();
  return !normalized || normalized === "unavailable" || normalized === "unknown";
}

function createProgramHistoryEntry(device) {
  const processName = trimActivityText(device.foregroundProcess, 120);
  const appTitle = trimActivityText(device.appStatus, 220);
  const processPath = trimActivityText(device.foregroundPath, 220);
  const label = !isIgnoredActivityLabel(processName)
    ? processName
    : (!isIgnoredActivityLabel(appTitle) ? appTitle : "");

  if (!label) {
    return null;
  }

  const detail = appTitle && appTitle !== label
    ? appTitle
    : (processPath && processPath !== label ? processPath : "");

  return sanitizeActivityHistoryEntry({
    key: ["program", label.toLowerCase()].join("|"),
    label,
    detail,
    at: Date.now(),
  });
}

function createWebsiteHistoryEntry(device) {
  const browserActive = isBrowserProcess(device.foregroundProcess);
  const domain = trimActivityText(device.browserDomain, 120);
  const url = trimActivityText(device.browserUrl, 320);
  const title = trimActivityText(device.appStatus, 220);
  const label = domain || url || (browserActive && !isIgnoredActivityLabel(title) ? title : "");

  if (!label) {
    return null;
  }

  const detail = url && url !== label
    ? url
    : (title && title !== label ? title : "");

  return sanitizeActivityHistoryEntry({
    key: ["website", label.toLowerCase()].join("|"),
    label,
    detail,
    at: Date.now(),
  });
}

function updateActivityHistory(history, entry) {
  const sanitizedHistory = Array.isArray(history)
    ? history
      .map(sanitizeActivityHistoryEntry)
      .filter(Boolean)
      .slice(0, MAX_ACTIVITY_HISTORY)
    : [];

  if (!entry) {
    return sanitizedHistory;
  }

  const latest = sanitizedHistory[0];
  if (latest?.key === entry.key) {
    return [
      {
        ...latest,
        label: entry.label,
        detail: entry.detail,
        at: entry.at,
      },
      ...sanitizedHistory.slice(1),
    ].slice(0, MAX_ACTIVITY_HISTORY);
  }

  return [
    entry,
    ...sanitizedHistory.filter((item) => item.key !== entry.key),
  ].slice(0, MAX_ACTIVITY_HISTORY);
}

function getPolicyOwnerAccountForDevice(device) {
  const explicitOwner = getAccountByKey(device?.policyOwnerKey);
  if (explicitOwner && canAccessDevice(explicitOwner, device)) {
    return explicitOwner;
  }

  const nonAdminAccounts = getAllAccounts().filter((account) => !isAdminAccount(account) && canAccessDevice(account, device));
  const managedNonAdmin = nonAdminAccounts.find((account) => accountHasManagedStateForDevice(account, device));
  if (managedNonAdmin) {
    return managedNonAdmin;
  }

  const adminAccount = getAdminAccount();
  if (adminAccount && canAccessDevice(adminAccount, device) && accountHasManagedStateForDevice(adminAccount, device)) {
    return adminAccount;
  }

  return nonAdminAccounts[0] || adminAccount || null;
}

function buildManagementConfigPayload(policy = createEmptyPolicy()) {
  const effectivePolicy = normalizePolicy(policy);
  return {
    type: "management_config",
    allowedPrograms: effectivePolicy.allowedPrograms || [],
    allowedSites: effectivePolicy.allowedSites || [],
    websiteMode: normalizeWebsiteMode(effectivePolicy.websiteMode),
    thumbnailIntervalMs: 30_000,
  };
}

function syncDeviceManagementConfig(deviceId, accountOverride = null) {
  const device = devices.get(deviceId);
  if (!device) {
    return false;
  }

  const policyAccount = accountOverride || getPolicyOwnerAccountForDevice(device);
  const policy = policyAccount ? getManagedDeviceState(policyAccount, device).policy : createEmptyPolicy();
  device.policyOwnerKey = policyAccount ? normalizeAccountKey(policyAccount.username) : "";
  return sendToAgent(deviceId, buildManagementConfigPayload(policy));
}

function refreshManagedStateForAccount(account, syncPolicies = true) {
  if (syncPolicies && account) {
    for (const device of devices.values()) {
      if (canAccessDevice(account, device)) {
        syncDeviceManagementConfig(device.id, account);
      }
    }
  }

  broadcastDeviceList();
}

function refreshAllManagedState(syncPolicies = true) {
  if (syncPolicies) {
    for (const device of devices.values()) {
      syncDeviceManagementConfig(device.id);
    }
  }

  broadcastDeviceList();
}

function setDeviceState(deviceId, changes) {
  if (!deviceId || !devices.has(deviceId)) return null;

  const existing = devices.get(deviceId);
  const nextRecord = {
    ...existing,
    ...changes,
  };

  devices.set(deviceId, nextRecord);
  broadcastDeviceList();
  return nextRecord;
}

function setDeviceScreenFrame(deviceId, frame) {
  if (!deviceId || !devices.has(deviceId)) return null;

  const existing = devices.get(deviceId);
  const nextRecord = {
    ...existing,
    latestFrame: frame,
  };

  devices.set(deviceId, nextRecord);
  broadcastScreenFrame(deviceId, frame);
  return nextRecord;
}

function setDeviceThumbnailFrame(deviceId, frame) {
  if (!deviceId || !devices.has(deviceId)) return null;

  const existing = devices.get(deviceId);
  const nextRecord = {
    ...existing,
    latestThumbnail: frame,
  };

  devices.set(deviceId, nextRecord);
  broadcastThumbnailFrame(deviceId, frame);
  return nextRecord;
}

function clearDeviceScreenFrame(deviceId) {
  if (!deviceId || !devices.has(deviceId)) return;

  const existing = devices.get(deviceId);
  if (!existing.latestFrame) return;

  devices.set(deviceId, {
    ...existing,
    latestFrame: null,
  });
  broadcastScreenFrameClear(deviceId);
}

function upsertDevice(ws, request, payload, messageType = "status") {
  const device = sanitizeDevicePayload(payload, request);
  const previousId = ws.deviceId;
  const nextId = buildDeviceId(device);
  const existing = devices.get(previousId) || devices.get(nextId) || {};
  const wasOffline = !existing.online;

  if (previousId && previousId !== nextId) {
    devices.delete(previousId);
  }

  let nextRecord = {
    ...existing,
    id: nextId,
    ws,
    online: true,
    connectedAt: existing.connectedAt || Date.now(),
    lastSeen: Date.now(),
    ...device,
  };
  nextRecord = {
    ...nextRecord,
    programHistory: updateActivityHistory(existing.programHistory, createProgramHistoryEntry(nextRecord)),
    websiteHistory: updateActivityHistory(existing.websiteHistory, createWebsiteHistoryEntry(nextRecord)),
  };

  ws.deviceId = nextId;
  devices.set(nextId, nextRecord);
  if (wasOffline || previousId !== nextId) {
    console.log(`[AGENT] ${nextId} connected`);
  }
  if (messageType === "hello" || wasOffline || previousId !== nextId || existing.ws !== ws) {
    syncDeviceManagementConfig(nextId);
  }

  const previousScreenShareStatus = existing.screenShareStatus || "Idle";
  const nextScreenShareStatus = nextRecord.screenShareStatus || "Idle";
  if (existing.id && previousScreenShareStatus !== nextScreenShareStatus) {
    if (previousScreenShareStatus === "Requested" && nextScreenShareStatus === "Active") {
      logAudit("approved", nextRecord, "Student approved the screen-share request.");
    } else if (previousScreenShareStatus === "Requested" && nextScreenShareStatus === "Declined") {
      logAudit("declined", nextRecord, "Student declined the screen-share request.");
      clearDeviceScreenFrame(nextId);
    } else if (previousScreenShareStatus === "Active" && nextScreenShareStatus !== "Active") {
      clearDeviceScreenFrame(nextId);
    }
  }

  if (nextScreenShareStatus === "Idle") {
    nextRecord = {
      ...nextRecord,
      screenShareOwnerKey: "",
    };
    devices.set(nextId, nextRecord);
  }

  logFocusTransition(existing, nextRecord);
  broadcastDeviceList();
}

function markDeviceOffline(deviceId) {
  if (!deviceId || !devices.has(deviceId)) return;
  const existing = devices.get(deviceId);
  const hadFrame = Boolean(existing.latestFrame);
  const nextRecord = {
    ...existing,
    ws: null,
    online: false,
    teacherSession: "Standby",
    screenShareStatus: "Idle",
    screenShareOwnerKey: "",
    attentionMode: "Off",
    screenBlackout: "Off",
    imageDisplay: "Off",
    announcementDisplay: "Off",
    latestFrame: null,
    lastSeen: Date.now(),
  };

  devices.set(deviceId, nextRecord);
  console.log(`[AGENT] ${deviceId} disconnected`);
  broadcastDeviceList();
  if (hadFrame) {
    broadcastScreenFrameClear(deviceId);
  }
}

function sendToAgent(deviceId, payload) {
  const device = devices.get(deviceId);
  if (!device?.online || !device.ws || device.ws.readyState !== WebSocket.OPEN) {
    return false;
  }

  device.ws.send(JSON.stringify(payload));
  return true;
}

function getAuthorizedDevice(account, deviceId) {
  const device = devices.get(String(deviceId || "").trim());
  return device && canAccessDevice(account, device) ? device : null;
}

function getTargetDevices(account, selection = {}) {
  if (typeof selection.id === "string" && selection.id.trim()) {
    const targeted = getAuthorizedDevice(account, selection.id.trim());
    return targeted ? [targeted] : [];
  }

  const normalizedGroup = normalizeGroupName(selection.group);
  return getAccessibleDevices(account).filter((device) => {
    if (!device.online || !device.ws || device.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    return !normalizedGroup || getPersistedDeviceGroup(device) === normalizedGroup;
  });
}

function sendToSelectedAgents(account, selection, payload) {
  const message = JSON.stringify(payload);
  let sent = 0;

  for (const device of getTargetDevices(account, selection)) {
    device.ws.send(message);
    sent += 1;
  }

  return sent;
}

function sendToAuthorizedAgent(account, deviceId, payload) {
  const device = getAuthorizedDevice(account, deviceId);
  if (!device?.online || !device.ws || device.ws.readyState !== WebSocket.OPEN) {
    return false;
  }

  device.ws.send(JSON.stringify(payload));
  return true;
}

const PASSTHROUGH_AGENT_COMMANDS = new Set([
  "remote_mouse_move",
  "remote_mouse_down",
  "remote_mouse_up",
  "remote_mouse_click",
  "remote_key",
  "type_text",
]);

dashboardWss.on("connection", (ws, request) => {
  ws.account = request.account || null;
  if (!ws.account) {
    ws.close(1008, "Authentication required.");
    return;
  }

  dashboards.add(ws);
  sendDeviceList(ws);
  sendAuditLog(ws);
  sendStoredFrames(ws);

  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const account = ws.account;
    if (!account) {
      return;
    }

    if (message.type === "request_refresh" && typeof message.id === "string") {
      const sent = sendToAuthorizedAgent(account, message.id, { type: "status_request" });
      if (!sent) {
        ws.send(JSON.stringify({ type: "error", message: "Device is offline or unavailable." }));
      }
      return;
    }

    if (message.type === "set_group_policy") {
      const group = normalizeGroupName(message.group);
      if (!group) {
        ws.send(JSON.stringify({ type: "error", message: "Choose a class before saving restrictions." }));
        return;
      }

      if (!setPersistedGroupPolicy(account, group, message.allowedPrograms, message.allowedSites, {
        websiteMode: message.websiteMode,
      })) {
        ws.send(JSON.stringify({ type: "error", message: "You can only manage restrictions for your own classes." }));
        return;
      }

      refreshManagedStateForAccount(account, true);
      return;
    }

    if (message.type === "set_device_policy" && typeof message.id === "string") {
      const device = getAuthorizedDevice(account, message.id);
      if (!device) {
        ws.send(JSON.stringify({ type: "error", message: "Device is no longer available." }));
        return;
      }

      if (!setPersistedDevicePolicy(account, device, message.allowedPrograms, message.allowedSites, {
        websiteMode: message.websiteMode,
      })) {
        ws.send(JSON.stringify({ type: "error", message: "Could not update the individual restrictions for that device." }));
        return;
      }

      refreshManagedStateForAccount(account, true);
      return;
    }

    if (message.type === "launch_website") {
      const url = typeof message.url === "string" ? message.url.trim() : "";
      if (!url) {
        ws.send(JSON.stringify({ type: "error", message: "Enter a website URL first." }));
        return;
      }

      const sent = sendToSelectedAgents(account, message, { type: "open_website", url });
      if (!sent) {
        ws.send(JSON.stringify({ type: "error", message: "No matching online devices were available for that website launch." }));
      }
      return;
    }

    if (message.type === "launch_program") {
      const command = typeof message.command === "string" ? message.command.trim() : "";
      if (!command) {
        ws.send(JSON.stringify({ type: "error", message: "Enter a program command first." }));
        return;
      }

      const sent = sendToSelectedAgents(account, message, { type: "launch_program", command });
      if (!sent) {
        ws.send(JSON.stringify({ type: "error", message: "No matching online devices were available for that program launch." }));
      }
      return;
    }

    if (message.type === "deploy_update") {
      const filename = typeof message.filename === "string" ? message.filename.trim() : "";
      const data = typeof message.data === "string" ? message.data.trim() : "";
      if (!filename || !data) {
        ws.send(JSON.stringify({ type: "error", message: "Choose an update file before deploying it." }));
        return;
      }

      const payloadBytes = Buffer.byteLength(data, "base64");
      if (!Number.isFinite(payloadBytes) || payloadBytes <= 0) {
        ws.send(JSON.stringify({ type: "error", message: "The selected update file was invalid." }));
        return;
      }
      if (payloadBytes > MAX_UPDATE_PAYLOAD_BYTES) {
        ws.send(JSON.stringify({ type: "error", message: "The selected update file is too large for this dashboard." }));
        return;
      }

      const sent = sendToSelectedAgents(account, message, {
        type: "agent_update",
        filename,
        data,
      });
      if (!sent) {
        ws.send(JSON.stringify({ type: "error", message: "No matching online devices were available for that update deployment." }));
      }
      return;
    }

    if (message.type === "display_image") {
      const data = typeof message.data === "string" ? message.data.trim() : "";
      if (!data) {
        ws.send(JSON.stringify({ type: "error", message: "Choose an image before displaying it." }));
        return;
      }

      const payloadBytes = Buffer.byteLength(data, "base64");
      if (!Number.isFinite(payloadBytes) || payloadBytes <= 0) {
        ws.send(JSON.stringify({ type: "error", message: "The selected image was invalid." }));
        return;
      }
      if (payloadBytes > MAX_UPDATE_PAYLOAD_BYTES) {
        ws.send(JSON.stringify({ type: "error", message: "The selected image is too large for this dashboard." }));
        return;
      }

      const sent = sendToSelectedAgents(account, message, { type: "display_image", data });
      if (!sent) {
        ws.send(JSON.stringify({ type: "error", message: "No matching online devices were available for image display." }));
      }
      return;
    }

    if (message.type === "show_announcement") {
      const text = normalizeAnnouncementText(message.text);
      if (!text) {
        ws.send(JSON.stringify({ type: "error", message: "Type an announcement first." }));
        return;
      }

      const sent = sendToSelectedAgents(account, message, { type: "show_announcement", text });
      if (!sent) {
        ws.send(JSON.stringify({ type: "error", message: "No matching online devices were available for that announcement." }));
      }
      return;
    }

    if (message.type === "clear_announcement") {
      const sent = sendToSelectedAgents(account, message, { type: "clear_announcement" });
      if (!sent) {
        ws.send(JSON.stringify({ type: "error", message: "No matching online devices were available to clear the announcement." }));
      }
      return;
    }

    if (message.type === "clear_display_image") {
      const sent = sendToSelectedAgents(account, message, { type: "clear_display_image" });
      if (!sent) {
        ws.send(JSON.stringify({ type: "error", message: "No matching online devices were available to clear the displayed image." }));
      }
      return;
    }

    if (message.type === "lock_device") {
      const sent = sendToSelectedAgents(account, message, { type: "lock_device" });
      if (!sent) {
        ws.send(JSON.stringify({ type: "error", message: "No matching online devices were available to lock." }));
      }
      return;
    }

    if (message.type === "restart_device") {
      const sent = sendToSelectedAgents(account, message, { type: "restart_device" });
      if (!sent) {
        ws.send(JSON.stringify({ type: "error", message: "No matching online devices were available to restart." }));
      }
      return;
    }

    if (message.type === "shutdown_device") {
      const sent = sendToSelectedAgents(account, message, { type: "shutdown_device" });
      if (!sent) {
        ws.send(JSON.stringify({ type: "error", message: "No matching online devices were available to shut down." }));
      }
      return;
    }

    if (PASSTHROUGH_AGENT_COMMANDS.has(message.type) && typeof message.id === "string") {
      const device = getAuthorizedDevice(account, message.id);
      if (!device || !canAccountControlScreenShare(account, device)) {
        ws.send(JSON.stringify({ type: "error", message: "Start or open an active screen share before using remote control." }));
        return;
      }

      const sent = sendToAuthorizedAgent(account, message.id, message);
      if (!sent && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "error", message: "Device is offline or unavailable." }));
      }
      return;
    }

    if ((message.type === "screen_share_request" || message.type === "session_start") && typeof message.id === "string") {
      const device = getAuthorizedDevice(account, message.id);
      if (!device) {
        ws.send(JSON.stringify({ type: "error", message: "Device is offline or unavailable." }));
        return;
      }
      if (device.screenShareStatus === "Requested" && !isScreenShareOwnedByAccount(account, device)) {
        const ownerName = getScreenShareOwnerAccount(device)?.username || "another teacher";
        ws.send(JSON.stringify({ type: "error", message: `${ownerName} already requested screen share for that device.` }));
        return;
      }
      if (device.screenShareStatus === "Active") {
        ws.send(JSON.stringify({ type: "error", message: "That device is already sharing its screen. Open the live session instead." }));
        return;
      }

      const sent = sendToAuthorizedAgent(account, message.id, { type: "screen_share_request" });
      if (!sent && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "error", message: "Device is offline or unavailable." }));
        return;
      }

      const updated = setDeviceState(message.id, {
        teacherSession: "Standby",
        screenShareStatus: "Requested",
        screenShareOwnerKey: normalizeAccountKey(account.username),
      });
      clearDeviceScreenFrame(message.id);
      logAudit("requested", updated || devices.get(message.id), "Teacher requested screen share.", {
        accountKey: account.username,
        accountUsername: account.username,
      });
      return;
    }

    if (message.type === "screen_share_cancel" && typeof message.id === "string") {
      const device = getAuthorizedDevice(account, message.id);
      if (!device || !canAccountCancelScreenShareRequest(account, device)) {
        ws.send(JSON.stringify({ type: "error", message: "Only the teacher who started this screen-share request can cancel it." }));
        return;
      }

      const sent = sendToAuthorizedAgent(account, message.id, { type: "screen_share_cancel" });
      if (!sent && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "error", message: "Device is offline or unavailable." }));
        return;
      }

      const updated = setDeviceState(message.id, {
        teacherSession: "Standby",
        screenShareStatus: "Idle",
        screenShareOwnerKey: "",
      });
      clearDeviceScreenFrame(message.id);
      logAudit("cancelled", updated || devices.get(message.id), "Teacher cancelled the pending screen-share request.", {
        accountKey: account.username,
        accountUsername: account.username,
      });
      return;
    }

    if ((message.type === "screen_share_end" || message.type === "session_end") && typeof message.id === "string") {
      const device = getAuthorizedDevice(account, message.id);
      if (!device || !canAccountEndScreenShare(account, device)) {
        ws.send(JSON.stringify({ type: "error", message: "Only an active screen share can be ended." }));
        return;
      }

      const sent = sendToAuthorizedAgent(account, message.id, { type: "screen_share_end" });
      if (!sent && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "error", message: "Device is offline or unavailable." }));
        return;
      }

      const updated = setDeviceState(message.id, {
        teacherSession: "Standby",
        screenShareStatus: "Idle",
        screenShareOwnerKey: "",
      });
      clearDeviceScreenFrame(message.id);
      logAudit("ended", updated || devices.get(message.id), "Teacher ended the screen-share session.", {
        accountKey: account.username,
        accountUsername: account.username,
      });
      return;
    }

    if (message.type === "request_refresh_all") {
      sendToSelectedAgents(account, {}, { type: "status_request" });
      return;
    }

    if (message.type === "blackout_on") {
      const sent = sendToSelectedAgents(account, message, { type: "blackout_on" });
      if (!sent && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "error", message: "No matching online devices were available for blackout." }));
      }
      return;
    }

    if (message.type === "blackout_off") {
      const sent = sendToSelectedAgents(account, message, { type: "blackout_off" });
      if (!sent && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "error", message: "No matching online devices were available to restore." }));
      }
      return;
    }

    if (message.type === "attention_all_on") {
      sendToSelectedAgents(account, {}, { type: "attention_all_on" });
      return;
    }

    if (message.type === "attention_all_off") {
      sendToSelectedAgents(account, {}, { type: "attention_all_off" });
      return;
    }

    if (message.type === "blackout_all_on") {
      sendToSelectedAgents(account, {}, { type: "blackout_all_on" });
      return;
    }

    if (message.type === "blackout_all_off") {
      sendToSelectedAgents(account, {}, { type: "blackout_all_off" });
    }
  });

  ws.on("close", () => {
    dashboards.delete(ws);
  });
});

agentWss.on("connection", (ws, request) => {
  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.type === "hello" || message.type === "heartbeat" || message.type === "status") {
      upsertDevice(ws, request, message.device || message, message.type);
      return;
    }

    if (message.type === "screen_frame") {
      const frame = sanitizeScreenFrame(message.frame);
      if (!frame || !ws.deviceId || !devices.has(ws.deviceId)) return;
      setDeviceScreenFrame(ws.deviceId, frame);
      return;
    }

    if (message.type === "thumbnail_frame") {
      const frame = sanitizeScreenFrame(message.frame);
      if (!frame || !ws.deviceId || !devices.has(ws.deviceId)) return;
      setDeviceThumbnailFrame(ws.deviceId, frame);
    }
  });

  ws.on("close", () => {
    markDeviceOffline(ws.deviceId);
  });

  ws.on("error", () => {
    markDeviceOffline(ws.deviceId);
  });
});

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === "/dashboard") {
    const account = getAuthenticatedAccount(request);
    if (!account) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    request.account = account;
    dashboardWss.handleUpgrade(request, socket, head, (ws) => {
      dashboardWss.emit("connection", ws, request);
    });
    return;
  }

  if (url.pathname === "/agent") {
    agentWss.handleUpgrade(request, socket, head, (ws) => {
      agentWss.emit("connection", ws, request);
    });
    return;
  }

  socket.destroy();
});

setInterval(() => {
  const now = Date.now();
  let changed = false;

  for (const [id, device] of devices) {
    if (device.online && now - device.lastSeen > AGENT_TIMEOUT) {
      const hadFrame = Boolean(device.latestFrame);
      const nextRecord = {
        ...device,
        ws: null,
        online: false,
        teacherSession: "Standby",
        screenShareStatus: "Idle",
        screenShareOwnerKey: "",
        attentionMode: "Off",
        screenBlackout: "Off",
        imageDisplay: "Off",
        announcementDisplay: "Off",
        latestFrame: null,
      };
      devices.set(id, nextRecord);
      if (hadFrame) {
        broadcastScreenFrameClear(id);
      }
      changed = true;
    }

    if (!device.online && now - device.lastSeen > RETAIN_OFFLINE_MS) {
      devices.delete(id);
      changed = true;
    }
  }

  if (changed) {
    broadcastDeviceList();
  }
}, 5_000);

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (!session || session.expiresAt <= now) {
      sessions.delete(token);
    }
  }
}, 60_000);

discoverySocket.on("message", (rawMessage, remote) => {
  try {
    const message = JSON.parse(rawMessage.toString("utf8"));
    if (message?.type !== "classroom_discover" || message?.protocol !== DISCOVERY_PROTOCOL) {
      return;
    }

    const response = buildDiscoveryResponse();
    discoverySocket.send(response, remote.port, remote.address);
  } catch {
  }
});

discoverySocket.on("error", (error) => {
  console.error(`[DISCOVERY] UDP discovery failed: ${error.message}`);
});

discoverySocket.bind(DISCOVERY_PORT, () => {
  try {
    discoverySocket.setBroadcast(true);
  } catch {
  }

  console.log(`[DISCOVERY] Teacher discovery ready on UDP ${DISCOVERY_PORT}`);
});

server.listen(HTTP_PORT, () => {
  console.log(`[HTTP] Classroom dashboard available at http://localhost:${HTTP_PORT}`);
  console.log("[WS] Dashboard endpoint ready at /dashboard");
  console.log("[WS] Agent endpoint ready at /agent");
});
