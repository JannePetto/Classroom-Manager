const WS_PROTOCOL = location.protocol === "https:" ? "wss" : "ws";
const WS_URL = `${WS_PROTOCOL}://${location.host}/dashboard`;

let ws = null;
let reconnectTimer = null;
let devices = [];
let auditEvents = [];
let currentUser = null;
let adminState = {
  accounts: [],
  presets: {},
};
let sessionDeviceId = null;
let remoteControlEnabled = false;
let previewScale = 100;
let lastRemoteMoveAt = 0;
let remotePointerActive = false;
let remotePointerButton = "left";
let lastRemoteCoordinates = null;
let pendingSessionFrameToken = null;
let pendingSessionFrameUrl = null;
let sessionFrameDecodePending = false;
let renderedSessionFrameToken = null;

const previousShareStates = new Map();
const screenFrames = new Map();
let managementState = {
  groups: [],
  policies: {},
  presets: {},
};
let selectedAgentUpdateFile = null;
let selectedDeviceImageFile = null;
let selectedGroupImageFile = null;
let selectedDeviceId = null;
let pendingGroupSelection = "";
let groupPolicyAutosaveTimer = null;
let devicePolicyAutosaveTimer = null;
let forcedIndividualPolicyDeviceId = "";
const accountAccessSaveTimers = new Map();

const authScreen = document.getElementById("authScreen");
const loginUsernameInput = document.getElementById("loginUsernameInput");
const loginPasswordInput = document.getElementById("loginPasswordInput");
const loginButton = document.getElementById("loginButton");
const loginError = document.getElementById("loginError");
const serverStatus = document.getElementById("serverStatus");
const themeToggleButton = document.getElementById("themeToggleButton");
const machineCount = document.getElementById("machineCount");
const accountBadge = document.getElementById("accountBadge");
const manualLink = document.getElementById("manualLink");
const logoutButton = document.getElementById("logoutButton");
const onlineCount = document.getElementById("onlineCount");
const activeSessions = document.getElementById("activeSessions");
const pendingRequests = document.getElementById("pendingRequests");
const staleCount = document.getElementById("staleCount");
const averageBattery = document.getElementById("averageBattery");
const blackoutCount = document.getElementById("blackoutCount");
const offTaskCount = document.getElementById("offTaskCount");
const adminSectionHeader = document.getElementById("adminSectionHeader");
const adminPanel = document.getElementById("adminPanel");
const adminCollapseSections = [...adminPanel.querySelectorAll(".admin-collapse")];
const adminNewUsernameInput = document.getElementById("adminNewUsernameInput");
const adminNewPasswordInput = document.getElementById("adminNewPasswordInput");
const adminNewIsAdminInput = document.getElementById("adminNewIsAdminInput");
const adminCreateAccountButton = document.getElementById("adminCreateAccountButton");
const adminPresetSelect = document.getElementById("adminPresetSelect");
const adminPresetNameInput = document.getElementById("adminPresetNameInput");
const adminPresetProgramsInput = document.getElementById("adminPresetProgramsInput");
const adminPresetSitesInput = document.getElementById("adminPresetSitesInput");
const adminPresetWebsiteModeInput = document.getElementById("adminPresetWebsiteModeInput");
const adminLoadPresetButton = document.getElementById("adminLoadPresetButton");
const adminSavePresetButton = document.getElementById("adminSavePresetButton");
const adminDeletePresetButton = document.getElementById("adminDeletePresetButton");
const adminAccountList = document.getElementById("adminAccountList");
const machineGrid = document.getElementById("machineGrid");
const emptyState = document.getElementById("emptyState");
const emptyStateBadge = document.getElementById("emptyStateBadge");
const emptyStateCopy = document.getElementById("emptyStateCopy");
const toastContainer = document.getElementById("toastContainer");
const auditLogList = document.getElementById("auditLogList");
const auditEmpty = document.getElementById("auditEmpty");
const downloadAgentLink = document.getElementById("downloadAgentLink");
const downloadUrl = document.getElementById("downloadUrl");
const connectNote = document.getElementById("connectNote");
const blackoutAllOn = document.getElementById("blackoutAllOn");
const blackoutAllOff = document.getElementById("blackoutAllOff");
const refreshAll = document.getElementById("refreshAll");
const deviceSearchInput = document.getElementById("deviceSearchInput");
const openGroupManager = document.getElementById("openGroupManager");
const openClassAdminManager = document.getElementById("openClassAdminManager");
const groupManagerModal = document.getElementById("groupManagerModal");
const closeGroupManager = document.getElementById("closeGroupManager");
const classAdminManagerModal = document.getElementById("classAdminManagerModal");
const closeClassAdminManager = document.getElementById("closeClassAdminManager");
const groupTargetInput = document.getElementById("groupTargetInput");
const adminClassTargetInput = document.getElementById("adminClassTargetInput");
const adminNewClassNameInput = document.getElementById("adminNewClassNameInput");
const adminRenameClassNameInput = document.getElementById("adminRenameClassNameInput");
const adminCreateClassButton = document.getElementById("adminCreateClassButton");
const adminRenameClassButton = document.getElementById("adminRenameClassButton");
const adminDeleteClassButton = document.getElementById("adminDeleteClassButton");
const adminClassSearchInput = document.getElementById("adminClassSearchInput");
const adminClassDeviceList = document.getElementById("adminClassDeviceList");
const groupPresetInput = document.getElementById("groupPresetInput");
const allowedProgramsInput = document.getElementById("allowedProgramsInput");
const allowedSitesInput = document.getElementById("allowedSitesInput");
const groupWebsiteModeInput = document.getElementById("groupWebsiteModeInput");
const clearGroupPolicy = document.getElementById("clearGroupPolicy");
const groupBlackoutOn = document.getElementById("groupBlackoutOn");
const groupBlackoutOff = document.getElementById("groupBlackoutOff");
const groupImageInput = document.getElementById("groupImageInput");
const groupImageStatus = document.getElementById("groupImageStatus");
const groupDisplayImageButton = document.getElementById("groupDisplayImageButton");
const groupClearImageButton = document.getElementById("groupClearImageButton");
const groupAnnouncementInput = document.getElementById("groupAnnouncementInput");
const sendGroupAnnouncementButton = document.getElementById("sendGroupAnnouncementButton");
const clearGroupAnnouncementButton = document.getElementById("clearGroupAnnouncementButton");
const deviceModal = document.getElementById("deviceModal");
const closeDeviceModal = document.getElementById("closeDeviceModal");
const deviceModalTitle = document.getElementById("deviceModalTitle");
const deviceModalMeta = document.getElementById("deviceModalMeta");
const deviceFactList = document.getElementById("deviceFactList");
const programHistoryList = document.getElementById("programHistoryList");
const websiteHistoryList = document.getElementById("websiteHistoryList");
const devicePolicyModeLabel = document.getElementById("devicePolicyModeLabel");
const devicePolicyModeButton = document.getElementById("devicePolicyModeButton");
const deviceAllowedProgramsInput = document.getElementById("deviceAllowedProgramsInput");
const deviceAllowedSitesInput = document.getElementById("deviceAllowedSitesInput");
const deviceWebsiteModeInput = document.getElementById("deviceWebsiteModeInput");
const deviceScreenShareButton = document.getElementById("deviceScreenShareButton");
const deviceOpenSessionButton = document.getElementById("deviceOpenSessionButton");
const deviceBlackoutButton = document.getElementById("deviceBlackoutButton");
const deviceRefreshButton = document.getElementById("deviceRefreshButton");
const deviceImageInput = document.getElementById("deviceImageInput");
const deviceImageStatus = document.getElementById("deviceImageStatus");
const displayDeviceImageButton = document.getElementById("displayDeviceImageButton");
const clearDeviceImageButton = document.getElementById("clearDeviceImageButton");
const deviceAnnouncementInput = document.getElementById("deviceAnnouncementInput");
const sendDeviceAnnouncementButton = document.getElementById("sendDeviceAnnouncementButton");
const clearDeviceAnnouncementButton = document.getElementById("clearDeviceAnnouncementButton");
const launchWebsiteInput = document.getElementById("launchWebsiteInput");
const launchWebsiteButton = document.getElementById("launchWebsiteButton");
const launchProgramInput = document.getElementById("launchProgramInput");
const launchProgramButton = document.getElementById("launchProgramButton");
const agentUpdateInput = document.getElementById("agentUpdateInput");
const agentUpdateStatus = document.getElementById("agentUpdateStatus");
const deployAgentUpdate = document.getElementById("deployAgentUpdate");
const deviceLockButton = document.getElementById("deviceLockButton");
const deviceRestartButton = document.getElementById("deviceRestartButton");
const deviceShutdownButton = document.getElementById("deviceShutdownButton");
const sessionModal = document.getElementById("sessionModal");
const sessionTitle = document.getElementById("sessionTitle");
const sessionMeta = document.getElementById("sessionMeta");
const closeSessionModalButton = document.getElementById("closeSessionModal");
const sessionPreview = document.getElementById("sessionPreview");
const sessionImage = document.getElementById("sessionImage");
const sessionEmpty = document.getElementById("sessionEmpty");
const remoteControlToggle = document.getElementById("remoteControlToggle");
const remoteControlHint = document.getElementById("remoteControlHint");
const sessionTextInput = document.getElementById("sessionTextInput");
const sendSessionText = document.getElementById("sendSessionText");
const sessionImageInput = document.getElementById("sessionImageInput");
const clearSessionImage = document.getElementById("clearSessionImage");
const sessionScale = document.getElementById("sessionScale");
const deviceCollapseSections = [...deviceModal.querySelectorAll(".device-collapse")];

function createEmptyManagementState() {
  return {
    groups: [],
    policies: {},
    presets: {},
  };
}

function applyTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = nextTheme;
  themeToggleButton.textContent = nextTheme === "dark" ? "Light mode" : "Dark mode";
}

function initializeTheme() {
  applyTheme("light");
}

function resetDeviceModalSections() {
  for (const section of deviceCollapseSections) {
    section.open = false;
  }
}

function setStatus(online) {
  const pulse = serverStatus.querySelector(".pulse");
  const text = serverStatus.querySelector(".status-text");
  pulse.classList.toggle("live", online);
  text.textContent = online ? "Dashboard connected" : (currentUser ? "Reconnecting" : "Sign in required");
}

function setAuthRequired(required) {
  authScreen.classList.toggle("hidden", !required);
  document.body.classList.toggle("auth-required", required);
  if (required) {
    setStatus(false);
  }
}

function renderUserChrome() {
  if (currentUser) {
    accountBadge.textContent = currentUser.isAdmin ? `${currentUser.username} (Admin)` : currentUser.username;
    manualLink.hidden = false;
    logoutButton.hidden = false;
  } else {
    accountBadge.textContent = "Signed out";
    manualLink.hidden = true;
    logoutButton.hidden = true;
  }
}

function closeSocket(allowReconnect = false) {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  const activeSocket = ws;
  ws = null;

  if (!activeSocket) {
    if (!allowReconnect) {
      setStatus(false);
    }
    return;
  }

  activeSocket.onopen = null;
  activeSocket.onmessage = null;
  activeSocket.onerror = null;
  activeSocket.onclose = null;

  if (activeSocket.readyState === WebSocket.OPEN || activeSocket.readyState === WebSocket.CONNECTING) {
    activeSocket.close();
  }

  if (!allowReconnect) {
    setStatus(false);
  }
}

for (const section of adminCollapseSections) {
  section.addEventListener("toggle", () => {
    if (!section.open) {
      return;
    }

    for (const otherSection of adminCollapseSections) {
      if (otherSection !== section) {
        otherSection.open = false;
      }
    }
  });
}

for (const section of deviceCollapseSections) {
  section.addEventListener("toggle", () => {
    if (!section.open) {
      return;
    }

    for (const otherSection of deviceCollapseSections) {
      if (otherSection !== section) {
        otherSection.open = false;
      }
    }
  });
}

function connect() {
  if (!currentUser) {
    closeSocket(false);
    return;
  }

  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    setStatus(true);
  };

  ws.onclose = () => {
    ws = null;
    setStatus(false);
    if (currentUser) {
      reconnectTimer = setTimeout(connect, 3000);
    }
  };

  ws.onerror = () => ws.close();

  ws.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    handleMessage(message);
  };
}

function handleMessage(message) {
  if (message.type === "device_list") {
    const nextDevices = Array.isArray(message.devices) ? message.devices : [];
    const activatedSessionId = findActivatedSessionId(nextDevices);

    devices = nextDevices;
    managementState = normalizeManagementState(message.groups);
    pruneScreenFrames();
    renderManagementState();
    renderDashboard();
    if (selectedDeviceId) {
      const selectedDevice = getDeviceById(selectedDeviceId);
      if (!selectedDevice) {
        closeDeviceModalView();
      } else {
        renderDeviceModal();
      }
    }
    updateShareStates(nextDevices);

    if (sessionDeviceId) {
      const sessionDevice = getDeviceById(sessionDeviceId);
      if (!sessionDevice || getScreenShareStatus(sessionDevice) !== "Active") {
        closeSessionModal(false);
      } else {
        renderSessionModal();
      }
    }

    if (activatedSessionId && isSessionClosed()) {
      openSessionModal(activatedSessionId);
    }
    return;
  }

  if (message.type === "audit_log") {
    auditEvents = Array.isArray(message.events) ? message.events : [];
    renderAuditLog();
    return;
  }

  if (message.type === "screen_frame") {
    if (typeof message.id !== "string" || !message.frame || typeof message.frame.data !== "string") {
      return;
    }

    screenFrames.set(message.id, message.frame);
    if (sessionDeviceId === message.id && !isSessionClosed()) {
      renderSessionModal();
    }
    return;
  }

  if (message.type === "screen_frame_clear" && typeof message.id === "string") {
    screenFrames.delete(message.id);
    if (sessionDeviceId === message.id && !isSessionClosed()) {
      renderSessionModal();
    }
    return;
  }

  if (message.type === "error" && message.message) {
    toast(message.message, "error");
  }
}

function normalizeManagementState(raw) {
  const groups = Array.isArray(raw?.groups)
    ? raw.groups.filter((group) => typeof group === "string" && group.trim())
    : [];
  const policies = raw && typeof raw.policies === "object" ? raw.policies : {};
  const presets = raw && typeof raw.presets === "object" ? raw.presets : {};

  return {
    groups,
    policies,
    presets,
  };
}

function getPresetByName(name) {
  if (!name) {
    return null;
  }

  const preset = managementState.presets?.[name];
  if (!preset || typeof preset !== "object") {
    return null;
  }

  return {
    allowedPrograms: Array.isArray(preset.allowedPrograms) ? preset.allowedPrograms : [],
    allowedSites: Array.isArray(preset.allowedSites) ? preset.allowedSites : [],
    websiteMode: preset.websiteMode === "warn" ? "warn" : "block",
  };
}

function applyPresetToGroupForm(presetName) {
  const preset = getPresetByName(presetName);
  if (!preset) {
    toast("Choose a preset first.", "error");
    return false;
  }

  allowedProgramsInput.value = preset.allowedPrograms.join("\n");
  allowedSitesInput.value = preset.allowedSites.join("\n");
  groupWebsiteModeInput.value = preset.websiteMode;
  return true;
}

function getGroupTargetValue() {
  return groupTargetInput.value.trim();
}

function getPolicyForGroup(groupName) {
  if (!groupName) {
    return {
      allowedPrograms: [],
      allowedSites: [],
      websiteMode: "block",
    };
  }

  const policy = managementState.policies[groupName];
  return {
    allowedPrograms: Array.isArray(policy?.allowedPrograms) ? policy.allowedPrograms : [],
    allowedSites: Array.isArray(policy?.allowedSites) ? policy.allowedSites : [],
    websiteMode: String(policy?.websiteMode || "block") === "warn" ? "warn" : "block",
  };
}

function renderManagementState() {
  const groups = [...managementState.groups].sort((left, right) => left.localeCompare(right));
  const presetNames = Object.keys(managementState.presets || {}).sort((left, right) => left.localeCompare(right));
  const currentTargetGroup = getGroupTargetValue();
  const currentPreset = groupPresetInput.value.trim();

  groupTargetInput.innerHTML = "";
  const emptyTargetOption = document.createElement("option");
  emptyTargetOption.value = "";
  emptyTargetOption.textContent = "Select a class";
  groupTargetInput.appendChild(emptyTargetOption);

  groupPresetInput.innerHTML = "";
  const emptyPresetOption = document.createElement("option");
  emptyPresetOption.value = "";
  emptyPresetOption.textContent = "Select a preset";
  groupPresetInput.appendChild(emptyPresetOption);

  for (const group of groups) {
    const targetOption = document.createElement("option");
    targetOption.value = group;
    targetOption.textContent = group;
    groupTargetInput.appendChild(targetOption);
  }

  for (const presetName of presetNames) {
    const presetOption = document.createElement("option");
    presetOption.value = presetName;
    presetOption.textContent = presetName;
    groupPresetInput.appendChild(presetOption);
  }

  const selectedTargetGroup = pendingGroupSelection && groups.includes(pendingGroupSelection)
    ? pendingGroupSelection
    : currentTargetGroup;
  groupTargetInput.value = groups.includes(selectedTargetGroup) ? selectedTargetGroup : "";
  if (groupTargetInput.value === pendingGroupSelection) {
    pendingGroupSelection = "";
  }
  groupPresetInput.value = presetNames.includes(currentPreset) ? currentPreset : "";

  const targetGroup = getGroupTargetValue();
  if (!targetGroup) {
    if (document.activeElement !== allowedProgramsInput) {
      allowedProgramsInput.value = "";
    }
    if (document.activeElement !== allowedSitesInput) {
      allowedSitesInput.value = "";
    }
    if (document.activeElement !== groupWebsiteModeInput) {
      groupWebsiteModeInput.value = "block";
    }
    renderAdminClassManager();
    return;
  }

  const policy = getPolicyForGroup(targetGroup);
  if (document.activeElement !== allowedProgramsInput) {
    allowedProgramsInput.value = policy.allowedPrograms.join("\n");
  }
  if (document.activeElement !== allowedSitesInput) {
    allowedSitesInput.value = policy.allowedSites.join("\n");
  }
  if (document.activeElement !== groupWebsiteModeInput) {
    groupWebsiteModeInput.value = policy.websiteMode || "block";
  }
  renderAdminClassManager();
}

function parseRuleInput(value) {
  return value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function policyHasSettings(policy) {
  return Boolean(
    policy
    && (
      (Array.isArray(policy.allowedPrograms) && policy.allowedPrograms.length)
      || (Array.isArray(policy.allowedSites) && policy.allowedSites.length)
    ),
  );
}

function createEmptyPolicy() {
  return {
    allowedPrograms: [],
    allowedSites: [],
    websiteMode: "block",
  };
}

function setDevicePolicyInputsEnabled(enabled) {
  deviceAllowedProgramsInput.disabled = !enabled;
  deviceAllowedSitesInput.disabled = !enabled;
  deviceWebsiteModeInput.disabled = !enabled;
}

function getDevicePolicyDraftFromInputs() {
  return {
    allowedPrograms: parseRuleInput(deviceAllowedProgramsInput.value),
    allowedSites: parseRuleInput(deviceAllowedSitesInput.value),
    websiteMode: deviceWebsiteModeInput.value === "warn" ? "warn" : "block",
  };
}

function sendCurrentGroupPolicy(showToast = false) {
  const group = getGroupTargetValue();
  if (!group) {
    return false;
  }

  const draftPolicy = {
    allowedPrograms: parseRuleInput(allowedProgramsInput.value),
    allowedSites: parseRuleInput(allowedSitesInput.value),
    websiteMode: groupWebsiteModeInput.value === "warn" ? "warn" : "block",
  };

  if (policyHasSettings(draftPolicy)) {
    managementState = {
      ...managementState,
      policies: {
        ...managementState.policies,
        [group]: draftPolicy,
      },
    };
  } else {
    const nextPolicies = { ...managementState.policies };
    delete nextPolicies[group];
    managementState = {
      ...managementState,
      policies: nextPolicies,
    };
  }

  send({
    type: "set_group_policy",
    group,
    ...draftPolicy,
  });
  if (showToast) {
    toast(`Saved class restrictions for ${group}.`);
  }
  return true;
}

function scheduleGroupPolicyAutosave() {
  clearTimeout(groupPolicyAutosaveTimer);
  groupPolicyAutosaveTimer = setTimeout(() => {
    groupPolicyAutosaveTimer = null;
    sendCurrentGroupPolicy(false);
  }, 550);
}

function syncDevicePolicyEditor(device) {
  const savedIndividualPolicy = policyHasSettings(device?.devicePolicy);
  const forcedIndividualPolicy = device?.id && forcedIndividualPolicyDeviceId === device.id;
  const individualPolicyActive = Boolean(savedIndividualPolicy || forcedIndividualPolicy);
  const visiblePolicy = savedIndividualPolicy
    ? device.devicePolicy
    : (forcedIndividualPolicy ? getDevicePolicyDraftFromInputs() : (device?.groupPolicy || createEmptyPolicy()));

  if (document.activeElement !== deviceAllowedProgramsInput) {
    deviceAllowedProgramsInput.value = Array.isArray(visiblePolicy?.allowedPrograms)
      ? visiblePolicy.allowedPrograms.join("\n")
      : "";
  }
  if (document.activeElement !== deviceAllowedSitesInput) {
    deviceAllowedSitesInput.value = Array.isArray(visiblePolicy?.allowedSites)
      ? visiblePolicy.allowedSites.join("\n")
      : "";
  }
  if (document.activeElement !== deviceWebsiteModeInput) {
    deviceWebsiteModeInput.value = visiblePolicy?.websiteMode === "warn" ? "warn" : "block";
  }
  setDevicePolicyInputsEnabled(individualPolicyActive && Boolean(device?.online));
  devicePolicyModeButton.textContent = individualPolicyActive ? "Use class policy" : "Use individual policy";
  devicePolicyModeLabel.textContent = savedIndividualPolicy
    ? "This device is currently using its own individual restrictions."
    : (individualPolicyActive
      ? "You are editing an individual policy draft for this device."
      : "This device is currently using the class restrictions.");
}

function sendCurrentDevicePolicy(showToast = false) {
  const device = getSelectedDevice();
  if (!device) {
    return false;
  }

  const draftPolicy = getDevicePolicyDraftFromInputs();
  device.devicePolicy = policyHasSettings(draftPolicy) ? { ...draftPolicy } : createEmptyPolicy();
  if (forcedIndividualPolicyDeviceId === device.id && policyHasSettings(draftPolicy)) {
    forcedIndividualPolicyDeviceId = "";
  }
  if (!policyHasSettings(draftPolicy)) {
    forcedIndividualPolicyDeviceId = "";
  }

  send({
    type: "set_device_policy",
    id: device.id,
    ...draftPolicy,
  });
  syncDevicePolicyEditor(device);
  if (showToast) {
    toast(`Saved individual restrictions for ${getDeviceLabel(device)}.`);
  }
  return true;
}

function scheduleDevicePolicyAutosave() {
  const device = getSelectedDevice();
  if (!device || (!policyHasSettings(device.devicePolicy) && forcedIndividualPolicyDeviceId !== device.id)) {
    return;
  }

  clearTimeout(devicePolicyAutosaveTimer);
  devicePolicyAutosaveTimer = setTimeout(() => {
    devicePolicyAutosaveTimer = null;
    sendCurrentDevicePolicy(false);
  }, 550);
}

function queueAccountAccessSave(row) {
  const username = row?.dataset.username || "";
  if (!username) {
    return;
  }

  clearTimeout(accountAccessSaveTimers.get(username));
  accountAccessSaveTimers.set(username, setTimeout(async () => {
    accountAccessSaveTimers.delete(username);
    const isAdmin = Boolean(row.querySelector("input[data-admin-toggle]")?.checked);
    const classAccess = Array.from(row.querySelectorAll("input[data-class-name]:checked"))
      .map((input) => input.dataset.className || "")
      .filter(Boolean);

    try {
      const payload = await fetchJson("/api/admin/accounts/access", {
        method: "POST",
        body: JSON.stringify({ username, isAdmin, classAccess }),
      });
      applyAdminResponse(payload);
    } catch (error) {
      if (error?.status === 401) {
        setSignedOutState("Your session expired. Sign in again.");
        return;
      }
      toast(error instanceof Error ? error.message : "Could not update that account.", "error");
    }
  }, 350));
}

async function assignDeviceClassNow(id, group) {
  const payload = await fetchJson("/api/admin/classes/assign", {
    method: "POST",
    body: JSON.stringify({ id, group }),
  });
  applyAdminResponse(payload);
}

function getFocusStateLabel(device) {
  if (device.offTask) return "Off task";
  if (device.monitored) return "On task";
  return "Unrestricted";
}

function formatTargetLabel(groupName) {
  return groupName ? `class ${groupName}` : "all online devices";
}

function getDeviceLabel(device) {
  return device?.username || device?.hostname || "that device";
}

function openOverlayModal(modal) {
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeOverlayModal(modal) {
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  if (
    groupManagerModal.classList.contains("hidden")
    && classAdminManagerModal.classList.contains("hidden")
    && deviceModal.classList.contains("hidden")
    && sessionModal.classList.contains("hidden")
  ) {
    document.body.classList.remove("modal-open");
  }
}

function getSelectedDevice() {
  return getDeviceById(selectedDeviceId);
}

function openDeviceModal(deviceId) {
  const device = getDeviceById(deviceId);
  if (!device) return;

  selectedDeviceId = deviceId;
  resetDeviceModalSections();
  openOverlayModal(deviceModal);
  renderDeviceModal();
}

function closeDeviceModalView() {
  forcedIndividualPolicyDeviceId = "";
  selectedDeviceId = null;
  selectedAgentUpdateFile = null;
  selectedDeviceImageFile = null;
  clearTimeout(devicePolicyAutosaveTimer);
  devicePolicyAutosaveTimer = null;
  agentUpdateInput.value = "";
  deviceImageInput.value = "";
  agentUpdateStatus.textContent = "No update selected.";
  deviceImageStatus.textContent = "No picture selected.";
  deviceAnnouncementInput.value = "";
  launchWebsiteInput.value = "";
  launchProgramInput.value = "";
  deviceAllowedProgramsInput.value = "";
  deviceAllowedSitesInput.value = "";
  deviceWebsiteModeInput.value = "block";
  setDevicePolicyInputsEnabled(false);
  devicePolicyModeButton.textContent = "Use individual policy";
  devicePolicyModeLabel.textContent = "This device is currently using the class restrictions.";
  resetDeviceModalSections();
  closeOverlayModal(deviceModal);
}

function renderFact(label, value) {
  return `
    <div class="stat">
      <span class="stat-label">${escapeHtml(label)}</span>
      <span class="stat-value">${escapeHtml(value)}</span>
    </div>
  `;
}

function getHistoryEntries(entries) {
  return Array.isArray(entries)
    ? entries.filter((entry) => entry && typeof entry === "object" && typeof entry.label === "string" && entry.label.trim())
    : [];
}

function formatHistoryTime(timestamp) {
  if (!timestamp) return "Just now";

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Just now";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderActivityHistory(entries, emptyMessage, options = {}) {
  const items = getHistoryEntries(entries);
  if (!items.length) {
    return `<div class="history-empty">${escapeHtml(emptyMessage)}</div>`;
  }

  return items.map((entry) => `
    <article class="history-entry${options.highlightForbidden && entry.forbidden ? " forbidden" : ""}">
      <div class="history-meta">
        <strong>${escapeHtml(entry.label || "Unknown")}</strong>
        <span class="history-meta-right">
          ${options.highlightForbidden && entry.forbidden ? '<span class="history-badge">Forbidden</span>' : ""}
          <span>${escapeHtml(formatHistoryTime(entry.at))}</span>
        </span>
      </div>
      ${entry.detail ? `<p>${escapeHtml(entry.detail)}</p>` : ""}
    </article>
  `).join("");
}

function renderDeviceModal() {
  const device = getSelectedDevice();
  if (!device) return;

  const focusState = getFocusStateLabel(device);
  const updateDetail = device.updateMessage ? `${device.updateStatus}: ${device.updateMessage}` : (device.updateStatus || "Idle");
  const shareAction = getDeviceScreenShareAction(device);
  deviceModalTitle.textContent = device.username || "Unknown user";
  deviceModalMeta.textContent = [device.hostname || "Unknown device", device.ip || "Unknown IP", focusState].join(" - ");
  deviceFactList.innerHTML = [
    renderFact("Hostname", device.hostname || "Unknown"),
    renderFact("IP", device.ip || "Unknown"),
    renderFact("Foreground app", device.appStatus || "Unavailable"),
    renderFact("Foreground process", device.foregroundProcess || "Unavailable"),
    renderFact("Website", device.browserDomain || "Unavailable"),
    renderFact("Browser URL", device.browserUrl || "Unavailable"),
    renderFact("Class", device.group || "Unassigned"),
    renderFact("Restriction source", device.policySource || "none"),
    renderFact("Website action", device.policy?.websiteMode === "warn" ? "Warn only" : "Block"),
    renderFact("Screen share", getScreenShareFactLabel(device)),
    renderFact("Picture display", device.imageDisplay || "Off"),
    renderFact("Announcement", device.announcementDisplay || "Off"),
    renderFact("Battery", formatBattery(device.battery)),
    renderFact("Admin status", updateDetail),
    renderFact("Last seen", formatLastSeen(device.lastSeen, device.online)),
  ].join("");
  websiteHistoryList.innerHTML = renderActivityHistory(device.websiteHistory, "No website history recorded yet.", { highlightForbidden: true });
  programHistoryList.innerHTML = renderActivityHistory(device.programHistory, "No program history recorded yet.");
  syncDevicePolicyEditor(device);

  deviceScreenShareButton.textContent = shareAction.label;
  deviceBlackoutButton.textContent = device.screenBlackout === "On" ? "Restore screen" : "Blackout screen";
  deviceScreenShareButton.disabled = !device.online || Boolean(shareAction.disabled);
  deviceOpenSessionButton.disabled = !canOpenSession(device);
  devicePolicyModeButton.disabled = !device.online;
  displayDeviceImageButton.disabled = !device.online;
  clearDeviceImageButton.disabled = !device.online || device.imageDisplay !== "On";
  sendDeviceAnnouncementButton.disabled = !device.online;
  clearDeviceAnnouncementButton.disabled = !device.online || device.announcementDisplay !== "On";
  deviceLockButton.disabled = !device.online;
  deviceRestartButton.disabled = !device.online;
  deviceShutdownButton.disabled = !device.online;
}

function getDeviceSortLabel(device) {
  return (device.username || device.hostname || "").toLocaleLowerCase();
}

function sortDevicesByName(entries) {
  return [...entries].sort((left, right) => getDeviceSortLabel(left).localeCompare(getDeviceSortLabel(right)));
}

function matchesOverviewSearch(device, searchTerm) {
  if (!searchTerm) return true;

  const haystacks = [
    device.username,
    device.hostname,
    device.group,
  ];

  return haystacks.some((value) => typeof value === "string" && value.toLocaleLowerCase().includes(searchTerm));
}

function setOverviewEmptyState(title, copy) {
  emptyStateBadge.textContent = title;
  emptyStateCopy.textContent = copy;
  emptyState.classList.remove("hidden");
  machineGrid.appendChild(emptyState);
}

function createOverviewGroupSection(title, groupDevices) {
  const section = document.createElement("section");
  section.className = "machine-group-section";

  const header = document.createElement("div");
  header.className = "machine-group-header";
  header.innerHTML = `
    <div>
      <p class="eyebrow">Class</p>
      <h3 class="machine-group-title">${escapeHtml(title)}</h3>
    </div>
    <span class="machine-group-count">${groupDevices.length} student${groupDevices.length === 1 ? "" : "s"}</span>
  `;

  const grid = document.createElement("div");
  grid.className = "machine-grid";
  for (const device of groupDevices) {
    grid.appendChild(createCard(device));
  }

  section.appendChild(header);
  section.appendChild(grid);
  return section;
}

function renderDashboard() {
  const onlineDevices = devices.filter((device) => device.online);
  const liveScreenShares = devices.filter((device) => getScreenShareStatus(device) === "Active");
  const pendingShareRequests = devices.filter((device) => getScreenShareStatus(device) === "Requested");
  const staleDevices = devices.filter((device) => !device.online);
  const blackoutDevices = devices.filter((device) => device.screenBlackout === "On");
  const offTaskDevices = devices.filter((device) => device.offTask);
  const batteryValues = devices
    .map((device) => device.battery?.percent)
    .filter((value) => Number.isFinite(value));

  machineCount.textContent = `${devices.length} device${devices.length === 1 ? "" : "s"}`;
  onlineCount.textContent = String(onlineDevices.length);
  activeSessions.textContent = String(liveScreenShares.length);
  pendingRequests.textContent = String(pendingShareRequests.length);
  staleCount.textContent = String(staleDevices.length);
  blackoutCount.textContent = String(blackoutDevices.length);
  offTaskCount.textContent = String(offTaskDevices.length);
  averageBattery.textContent = batteryValues.length
    ? `${Math.round(batteryValues.reduce((total, value) => total + value, 0) / batteryValues.length)}%`
    : "N/A";

  machineGrid.innerHTML = "";

  if (!devices.length) {
    setOverviewEmptyState(
      "No devices yet",
      "Download and install the classroom manager on each student device, then the devices will appear here after the first heartbeat.",
    );
    return;
  }

  const searchTerm = deviceSearchInput.value.trim().toLocaleLowerCase();
  const visibleDevices = sortDevicesByName(devices.filter((device) => matchesOverviewSearch(device, searchTerm)));
  if (!visibleDevices.length) {
    setOverviewEmptyState(
      "No matches",
      "No connected students matched that search. Try another username or clear the search box.",
    );
    return;
  }

  emptyState.classList.add("hidden");

  const groupedDevices = new Map();
  for (const device of visibleDevices) {
    const groupName = device.group && device.group.trim() ? device.group.trim() : "";
    if (!groupedDevices.has(groupName)) {
      groupedDevices.set(groupName, []);
    }
    groupedDevices.get(groupName).push(device);
  }

  const namedGroups = [...groupedDevices.keys()]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

  for (const groupName of namedGroups) {
    machineGrid.appendChild(createOverviewGroupSection(groupName, groupedDevices.get(groupName)));
  }

  if (groupedDevices.has("")) {
      machineGrid.appendChild(createOverviewGroupSection("Unassigned", groupedDevices.get("")));
  }
}

function createCard(device) {
  const card = document.createElement("article");
  card.className = `machine-card${device.offTask ? " off-task" : ""}`;
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `Open controls for ${getDeviceLabel(device)}`);

  const onlineLabel = device.online ? "Online" : "Offline";
  const metaLine = [device.hostname || "", device.group || "Unassigned"]
    .filter(Boolean)
    .join(" - ");

  card.innerHTML = `
    <div class="card-header">
      <div>
        <p class="eyebrow">Logged in user</p>
        <h2 class="card-hostname">${escapeHtml(device.username || "Unknown user")}</h2>
        <p class="card-meta-line">${escapeHtml(metaLine)}</p>
      <p class="card-hint">Click to open the full controls, status, and device details.</p>
        ${device.offTask ? '<span class="alert-badge">Off task</span><div class="card-critical">Needs attention now</div>' : ""}
      </div>
      <span class="card-status ${device.online ? "online" : "offline"}">
        <span class="card-status-dot"></span>${onlineLabel}
      </span>
    </div>
    ${device.offTask ? `<p class="alert-copy">${escapeHtml(device.offTaskReason || "This device is outside the current classroom policy.")}</p>` : ""}
  `;

  card.addEventListener("click", () => {
    openDeviceModal(device.id);
  });
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDeviceModal(device.id);
    }
  });

  return card;
}

function openSessionModal(deviceId) {
  const device = getDeviceById(deviceId);
  if (!device) return;

  sessionDeviceId = deviceId;
  setRemoteControlEnabled(false);
  openOverlayModal(sessionModal);
  applySessionScale();
  renderSessionModal();
}

function closeSessionModal(showToast = false) {
  const device = getDeviceById(sessionDeviceId);

  setRemoteControlEnabled(false);
  remotePointerActive = false;
  lastRemoteCoordinates = null;
  pendingSessionFrameToken = null;
  pendingSessionFrameUrl = null;
  sessionFrameDecodePending = false;
  renderedSessionFrameToken = null;
  sessionDeviceId = null;
  sessionTextInput.value = "";
  sessionImageInput.value = "";
  sessionPreview.classList.remove("has-frame");
  sessionImage.style.removeProperty("width");
  sessionImage.style.removeProperty("height");
  sessionImage.hidden = true;
  sessionImage.removeAttribute("src");
  sessionEmpty.hidden = false;
  sessionEmpty.textContent = "Waiting for a live session preview.";
  closeOverlayModal(sessionModal);

  if (showToast && device) {
    toast(`Closed session popup for ${device.hostname}.`);
  }
}

function renderSessionModal() {
  if (isSessionClosed()) return;

  const device = getDeviceById(sessionDeviceId);
  const frame = device ? screenFrames.get(device.id) : null;
  const active = Boolean(device && getScreenShareStatus(device) === "Active");

  if (!device) {
    closeSessionModal(false);
    return;
  }

  sessionTitle.textContent = device.hostname || "Screen-share session";
  sessionMeta.textContent = buildSessionMeta(device, frame);
  sessionPreview.classList.toggle("has-frame", Boolean(frame));

  if (frame) {
    renderSessionFrame(frame);
  } else {
    pendingSessionFrameToken = null;
    pendingSessionFrameUrl = null;
    sessionFrameDecodePending = false;
    renderedSessionFrameToken = null;
    sessionPreview.classList.remove("has-frame");
    sessionImage.style.removeProperty("width");
    sessionImage.style.removeProperty("height");
    sessionImage.hidden = true;
    sessionImage.removeAttribute("src");
    sessionEmpty.hidden = false;
    sessionEmpty.textContent = active
      ? `Waiting for the first live frame from ${device.hostname}.`
      : `${device.hostname} is no longer sharing a live screen.`;
  }

  applySessionScale();

  remoteControlToggle.disabled = !active;
  sendSessionText.disabled = !active;
  sessionTextInput.disabled = !active;
  sessionImageInput.disabled = !active;
  clearSessionImage.disabled = !active;

  if (!active && remoteControlEnabled) {
    setRemoteControlEnabled(false);
  }
}

function setRemoteControlEnabled(enabled) {
  remoteControlEnabled = Boolean(enabled);
  remoteControlToggle.textContent = remoteControlEnabled ? "Disable remote control" : "Enable remote control";
  remoteControlToggle.classList.toggle("warning", remoteControlEnabled);
  remoteControlHint.textContent = remoteControlEnabled
    ? "Remote control is live. Click inside the preview to steer the mouse and type."
    : "Enable remote control, then click inside the preview to move the mouse or type.";

  if (remoteControlEnabled) {
    sessionPreview.focus();
  }
}

function applySessionScale() {
  const baseHeight = Math.min(window.innerHeight * 0.72, 760);
  sessionPreview.style.height = `${Math.round(baseHeight)}px`;

  const frame = sessionDeviceId ? screenFrames.get(sessionDeviceId) : null;
  if (!frame?.width || !frame?.height) {
    sessionImage.style.removeProperty("width");
    sessionImage.style.removeProperty("height");
    return;
  }

  const previewStyles = getComputedStyle(sessionPreview);
  const paddingX = (parseFloat(previewStyles.paddingLeft) || 0) + (parseFloat(previewStyles.paddingRight) || 0);
  const paddingY = (parseFloat(previewStyles.paddingTop) || 0) + (parseFloat(previewStyles.paddingBottom) || 0);
  const availableWidth = Math.max(220, sessionPreview.clientWidth - paddingX);
  const availableHeight = Math.max(180, baseHeight - paddingY);
  const fitScale = Math.min(availableWidth / frame.width, availableHeight / frame.height);
  const displayScale = fitScale * (previewScale / 100);

  sessionImage.style.width = `${Math.max(1, Math.round(frame.width * displayScale))}px`;
  sessionImage.style.height = `${Math.max(1, Math.round(frame.height * displayScale))}px`;
}

function canOpenSession(device) {
  return Boolean(device && (getScreenShareStatus(device) === "Active" || screenFrames.has(device.id)));
}

function isSessionClosed() {
  return sessionModal.classList.contains("hidden");
}

function findActivatedSessionId(nextDevices) {
  for (const device of nextDevices) {
    if (
      getScreenShareStatus(device) === "Active"
      && device.screenShareOwnedByCurrentUser
      && previousShareStates.get(device.id) === "Requested"
    ) {
      return device.id;
    }
  }

  return null;
}

function updateShareStates(nextDevices) {
  previousShareStates.clear();
  for (const device of nextDevices) {
    previousShareStates.set(device.id, getScreenShareStatus(device));
  }
}

function pruneScreenFrames() {
  const deviceIds = new Set(devices.map((device) => device.id));
  for (const deviceId of screenFrames.keys()) {
    if (!deviceIds.has(deviceId)) {
      screenFrames.delete(deviceId);
    }
  }
}

function getDeviceById(deviceId) {
  if (!deviceId) return null;
  return devices.find((device) => device.id === deviceId) || null;
}

function buildSessionMeta(device, frame) {
  const ownerPart = device.screenShareOwnerName
    ? (device.screenShareOwnedByCurrentUser ? "Started by you" : `Started by ${device.screenShareOwnerName}`)
    : "";
  const parts = [
    device.username || "Unknown user",
    device.ip || "Unknown IP",
    `Screen share ${getScreenShareStatus(device)}`,
  ];

  if (ownerPart) {
    parts.push(ownerPart);
  }

  if (frame?.sourceWidth && frame?.sourceHeight) {
    parts.push(`${frame.sourceWidth}x${frame.sourceHeight}`);
  } else if (frame?.width && frame?.height) {
    parts.push(`${frame.width}x${frame.height}`);
  }

  if (frame?.capturedAt) {
    parts.push(`Updated ${formatRelativeTime(frame.capturedAt)}`);
  }

  return parts.join(" - ");
}

function getScreenShareStatus(device) {
  if (typeof device.screenShareStatus === "string" && device.screenShareStatus.trim()) {
    return device.screenShareStatus;
  }

  return device.teacherSession === "Connected" ? "Active" : "Idle";
}

function getScreenShareAction(screenShareStatus) {
  if (screenShareStatus === "Active") {
    return { type: "screen_share_end", label: "End screen share" };
  }

  if (screenShareStatus === "Requested") {
    return { type: "screen_share_cancel", label: "Cancel request" };
  }

  return { type: "screen_share_request", label: "Request screen share" };
}

function getDeviceScreenShareAction(device) {
  const status = getScreenShareStatus(device);
  if (status === "Requested" && !device.screenShareOwnedByCurrentUser) {
    return {
      type: null,
      label: device.screenShareOwnerName ? `Requested by ${device.screenShareOwnerName}` : "Requested by another teacher",
      disabled: true,
    };
  }

  return getScreenShareAction(status);
}

function getScreenShareFactLabel(device) {
  const status = getScreenShareStatus(device);
  if (status === "Requested" && !device.screenShareOwnedByCurrentUser && device.screenShareOwnerName) {
    return `Requested by ${device.screenShareOwnerName}`;
  }
  if (status === "Active" && device.screenShareOwnerName && !device.screenShareOwnedByCurrentUser) {
    return `Active with ${device.screenShareOwnerName}`;
  }
  return status;
}

function formatBattery(battery) {
  if (!battery) return "Unavailable";
  if (typeof battery.text === "string" && battery.text.trim()) return battery.text;
  if (Number.isFinite(battery.percent)) return `${battery.percent}%`;
  return "Unavailable";
}

function formatLastSeen(lastSeen, online) {
  if (!lastSeen) return "Never";
  if (online) return "Just now";

  const elapsedSeconds = Math.max(0, Math.round((Date.now() - lastSeen) / 1000));
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
  if (elapsedSeconds < 3600) return `${Math.round(elapsedSeconds / 60)}m ago`;
  if (elapsedSeconds < 86400) return `${Math.round(elapsedSeconds / 3600)}h ago`;
  return new Date(lastSeen).toLocaleString();
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return "just now";

  const elapsedSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 5) return "just now";
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
  if (elapsedSeconds < 3600) return `${Math.round(elapsedSeconds / 60)}m ago`;
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderAuditLog() {
  auditLogList.innerHTML = "";

  if (!auditEvents.length) {
    auditEmpty.classList.remove("hidden");
    return;
  }

  auditEmpty.classList.add("hidden");

  for (const event of auditEvents) {
    const item = document.createElement("article");
    item.className = "audit-entry";
    item.innerHTML = `
      <div class="audit-meta">
        <span class="audit-badge">${escapeHtml(formatAuditLabel(event.action))}</span>
        <span>${escapeHtml(formatAuditTime(event.at))}</span>
      </div>
      <strong>${escapeHtml(event.hostname || "Unknown device")}</strong>
      <p>${escapeHtml(event.detail || "Activity recorded.")}</p>
      ${event.accountUsername ? `<p>${escapeHtml(`Teacher: ${event.accountUsername}`)}</p>` : ""}
      <span class="audit-user">${escapeHtml(event.username || "Unknown user")}</span>
    `;
    auditLogList.appendChild(item);
  }
}

function formatAuditLabel(action) {
  const labels = {
    requested: "Request sent",
    approved: "Approved",
    declined: "Declined",
    cancelled: "Cancelled",
    ended: "Ended",
    off_task: "Off task",
    back_on_task: "Back on task",
  };

  return labels[action] || "Activity";
}

function formatAuditTime(timestamp) {
  if (!timestamp) return "Just now";

  const date = new Date(timestamp);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();

  return sameDay
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function toast(message, type = "success") {
  const element = document.createElement("div");
  element.className = `toast ${type}`;
  element.textContent = message;
  toastContainer.appendChild(element);
  setTimeout(() => element.remove(), 3500);
}

function send(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

async function fetchJson(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  let payload = null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    payload = await response.json();
  }

  if (!response.ok) {
    const error = new Error(payload?.error || payload?.message || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }

  return payload;
}

function resetDashboardState() {
  devices = [];
  auditEvents = [];
  adminState = {
    accounts: [],
    presets: {},
  };
  managementState = createEmptyManagementState();
  selectedDeviceId = null;
  pendingGroupSelection = "";
  selectedAgentUpdateFile = null;
  selectedDeviceImageFile = null;
  selectedGroupImageFile = null;
  forcedIndividualPolicyDeviceId = "";
  adminNewIsAdminInput.checked = false;
  adminClassSearchInput.value = "";
  adminNewClassNameInput.value = "";
  adminRenameClassNameInput.value = "";
  clearTimeout(groupPolicyAutosaveTimer);
  groupPolicyAutosaveTimer = null;
  clearTimeout(devicePolicyAutosaveTimer);
  devicePolicyAutosaveTimer = null;
  for (const timer of accountAccessSaveTimers.values()) {
    clearTimeout(timer);
  }
  accountAccessSaveTimers.clear();
  previousShareStates.clear();
  screenFrames.clear();
  closeOverlayModal(groupManagerModal);
  closeOverlayModal(classAdminManagerModal);
  closeDeviceModalView();
  closeSessionModal(false);
  renderManagementState();
  renderDashboard();
  renderAuditLog();
  renderAdminPanel();
  renderAdminClassManager();
}

function setSignedOutState(message = "") {
  currentUser = null;
  closeSocket(false);
  resetDashboardState();
  renderUserChrome();
  setAuthRequired(true);

  if (message) {
    loginError.textContent = message;
    loginError.classList.remove("hidden");
  } else {
    loginError.textContent = "";
    loginError.classList.add("hidden");
  }

  loginPasswordInput.value = "";
  setTimeout(() => {
    loginUsernameInput.focus();
  }, 0);
}

function syncManagementState(nextManagement) {
  managementState = normalizeManagementState(nextManagement);
  renderManagementState();
}

function applyAdminResponse(payload) {
  if (payload?.management) {
    managementState = normalizeManagementState(payload.management);
  } else if (payload && typeof payload === "object" && !payload.admin) {
    managementState = {
      ...managementState,
      presets: payload.presets && typeof payload.presets === "object" ? payload.presets : managementState.presets,
    };
  }

  syncAdminState(payload?.admin || payload);
}

function syncAdminState(nextState) {
  adminState = {
    accounts: Array.isArray(nextState?.accounts) ? nextState.accounts : [],
    presets: nextState && typeof nextState.presets === "object" ? nextState.presets : {},
  };
  renderManagementState();
  renderAdminPanel();
  renderAdminClassManager();
}

function renderAdminPanel() {
  const showAdmin = Boolean(currentUser?.isAdmin);
  adminSectionHeader.classList.toggle("hidden", !showAdmin);
  adminPanel.classList.toggle("hidden", !showAdmin);
  openClassAdminManager.hidden = !showAdmin;

  if (!showAdmin) {
    adminAccountList.innerHTML = "";
    adminPresetSelect.innerHTML = '<option value="">Select a preset</option>';
    return;
  }

  const presetNames = Object.keys(adminState.presets || {}).sort((left, right) => left.localeCompare(right));
  const currentPreset = adminPresetSelect.value.trim();
  adminPresetSelect.innerHTML = '<option value="">Select a preset</option>';
  for (const presetName of presetNames) {
    const option = document.createElement("option");
    option.value = presetName;
    option.textContent = presetName;
    adminPresetSelect.appendChild(option);
  }
  adminPresetSelect.value = presetNames.includes(currentPreset) ? currentPreset : "";

  if (!adminState.accounts.length) {
    adminAccountList.innerHTML = '<p class="access-empty">No accounts are available.</p>';
    return;
  }

  const allClasses = [...managementState.groups].sort((left, right) => left.localeCompare(right));
  adminAccountList.innerHTML = adminState.accounts.map((account) => {
    const classAccess = Array.isArray(account.classAccess) ? account.classAccess : [];
    const classCount = classAccess.length;
    const adminToggleDisabled = account.isPrimaryAdmin ? "disabled" : "";
    const classCheckboxesDisabled = account.isAdmin ? "disabled" : "";
    const accessGridClassName = `access-grid${account.isAdmin ? " hidden" : ""}`;
    const classesMarkup = account.isAdmin
      ? '<p class="account-summary">This admin account has full access to every device and the full admin console.</p>'
      : (allClasses.length
        ? `
          <div class="${accessGridClassName}">
            ${allClasses.map((groupName) => `
              <label class="access-option">
                <input
                  type="checkbox"
                  data-class-name="${escapeAttribute(groupName)}"
                  ${classAccess.includes(groupName) ? "checked" : ""}
                  ${classCheckboxesDisabled}
                />
                <span>
                  <strong>${escapeHtml(groupName)}</strong>
                  <span>Whole class access</span>
                </span>
              </label>
            `).join("")}
          </div>
        `
        : '<p class="access-empty">No classes are available yet. Create one in the class management menu first.</p>');

    return `
      <article class="account-row" data-username="${escapeAttribute(account.username)}">
        <div class="account-row-header">
          <div>
            <p class="eyebrow">Account</p>
            <h3>${escapeHtml(account.username)}</h3>
            <p class="account-summary">${account.isPrimaryAdmin ? "Primary admin account. This account always stays admin and always has full access to every device." : (account.isAdmin ? "Admin access to every device and the full admin console." : `${classCount} assigned class${classCount === 1 ? "" : "es"} in this account.`)}</p>
          </div>
          <span class="account-role">${escapeHtml(account.role || "teacher")}</span>
        </div>

        <label class="toggle-row">
          <input type="checkbox" data-admin-toggle ${account.isAdmin ? "checked" : ""} ${adminToggleDisabled} />
          <span>${account.isPrimaryAdmin ? "Primary admin account" : "Admin account"}</span>
        </label>

        <label class="field-label">Change password</label>
        <input class="form-input" data-password-input="${escapeAttribute(account.username)}" type="password" placeholder="New password" />
        <div class="inline-actions">
          <button class="btn" data-action="change-password" data-username="${escapeAttribute(account.username)}" type="button">Update password</button>
          ${account.isPrimaryAdmin ? "" : `<button class="btn warning" data-action="delete-account" data-username="${escapeAttribute(account.username)}" type="button">Delete account</button>`}
        </div>

        ${!account.isAdmin ? '<div class="field-label">Allowed classes</div>' : ""}
        ${classesMarkup}
        ${!account.isAdmin ? '<p class="management-note">Class access changes save automatically.</p>' : ""}
      </article>
    `;
  }).join("");
}

function getAdminClassTargetValue() {
  return adminClassTargetInput.value.trim();
}

function createClassOptionMarkup(selectedGroup = "") {
  return [
    '<option value="">No class</option>',
    ...[...managementState.groups]
      .sort((left, right) => left.localeCompare(right))
      .map((groupName) => `<option value="${escapeAttribute(groupName)}"${groupName === selectedGroup ? " selected" : ""}>${escapeHtml(groupName)}</option>`),
  ].join("");
}

function renderAdminClassManager() {
  const showAdmin = Boolean(currentUser?.isAdmin);
  if (!showAdmin) {
    adminClassDeviceList.innerHTML = "";
    return;
  }

  const groups = [...managementState.groups].sort((left, right) => left.localeCompare(right));
  const currentTargetGroup = getAdminClassTargetValue();
  const selectedTargetGroup = pendingGroupSelection && groups.includes(pendingGroupSelection)
    ? pendingGroupSelection
    : currentTargetGroup;

  adminClassTargetInput.innerHTML = '<option value="">Select a class</option>';
  for (const groupName of groups) {
    const option = document.createElement("option");
    option.value = groupName;
    option.textContent = groupName;
    adminClassTargetInput.appendChild(option);
  }
  adminClassTargetInput.value = groups.includes(selectedTargetGroup) ? selectedTargetGroup : "";
  if (adminClassTargetInput.value === pendingGroupSelection) {
    pendingGroupSelection = "";
  }

  if (document.activeElement !== adminRenameClassNameInput) {
    adminRenameClassNameInput.value = adminClassTargetInput.value || "";
  }

  const searchTerm = adminClassSearchInput.value.trim().toLocaleLowerCase();
  const filteredDevices = sortDevicesByName(devices).filter((device) => {
    if (!searchTerm) return true;
    return [device.username, device.hostname, device.group]
      .some((value) => typeof value === "string" && value.toLocaleLowerCase().includes(searchTerm));
  });

  if (!filteredDevices.length) {
    adminClassDeviceList.innerHTML = '<p class="access-empty">No matching devices are available right now.</p>';
    return;
  }

  adminClassDeviceList.innerHTML = filteredDevices.map((device) => `
    <article class="account-row" data-device-id="${escapeAttribute(device.id)}">
      <div class="account-row-header">
        <div>
          <p class="eyebrow">Student device</p>
          <h3>${escapeHtml(device.username || "Unknown user")}</h3>
          <p class="account-summary">${escapeHtml(device.hostname || "Unknown device")} - ${escapeHtml(device.group || "No class assigned")}</p>
        </div>
        <span class="account-role">${device.online ? "online" : "offline"}</span>
      </div>

      <label class="field-label">Assigned class</label>
      <select class="form-input" data-device-class-select>
        ${createClassOptionMarkup(device.group || "")}
      </select>
      <p class="management-note">This saves as soon as you pick a class.</p>
    </article>
  `).join("");
}

function fillAdminPresetForm(presetName) {
  const name = presetName || adminPresetSelect.value.trim();
  const preset = adminState.presets?.[name];
  if (!name || !preset) {
    toast("Choose a preset first.", "error");
    return false;
  }

  adminPresetSelect.value = name;
  adminPresetNameInput.value = name;
  adminPresetProgramsInput.value = Array.isArray(preset.allowedPrograms) ? preset.allowedPrograms.join("\n") : "";
  adminPresetSitesInput.value = Array.isArray(preset.allowedSites) ? preset.allowedSites.join("\n") : "";
  adminPresetWebsiteModeInput.value = preset.websiteMode === "warn" ? "warn" : "block";
  return true;
}

async function loadAdminState() {
  if (!currentUser?.isAdmin) {
    syncAdminState(null);
    return;
  }

  try {
    const payload = await fetchJson("/api/admin/state");
    applyAdminResponse(payload);
  } catch (error) {
    if (error?.status === 401) {
      setSignedOutState("Your session expired. Sign in again.");
      return;
    }
    throw error;
  }
}

async function hydrateSession() {
  const session = await fetchJson("/api/session");
  currentUser = session?.user || null;
  renderUserChrome();
  syncManagementState(session?.management || createEmptyManagementState());
  setAuthRequired(false);
  loginError.textContent = "";
  loginError.classList.add("hidden");

  if (currentUser?.isAdmin) {
    await loadAdminState();
  } else {
    syncAdminState(null);
  }

  connect();
  return currentUser;
}

async function performLogin() {
  const username = loginUsernameInput.value.trim();
  const password = loginPasswordInput.value;
  if (!username || !password) {
    loginError.textContent = "Enter your username and password first.";
    loginError.classList.remove("hidden");
    return;
  }

  loginButton.disabled = true;
  loginError.textContent = "";
  loginError.classList.add("hidden");

  try {
    await fetchJson("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    const user = await hydrateSession();
    toast(`Signed in as ${user?.username || username}.`);
  } catch (error) {
    loginError.textContent = error instanceof Error ? error.message : "Could not sign in.";
    loginError.classList.remove("hidden");
  } finally {
    loginButton.disabled = false;
    loginPasswordInput.value = "";
  }
}

async function performLogout(showToast = true) {
  try {
    await fetchJson("/api/logout", { method: "POST" });
  } catch {
  }

  setSignedOutState("");
  if (showToast) {
    toast("Signed out.");
  }
}

async function loadConnectInfo() {
  try {
    const response = await fetch("/api/connect-info");
    if (!response.ok) return;

    const info = await response.json();
    const downloadPath = typeof info.downloadPath === "string" ? info.downloadPath : "";
    const preferredDownloadUrl = typeof info.preferredDownloadUrl === "string" && info.preferredDownloadUrl
      ? info.preferredDownloadUrl
      : (downloadPath ? `${location.origin}${downloadPath}` : "");
    const downloadFilename = typeof info.downloadFilename === "string" && info.downloadFilename
      ? info.downloadFilename
      : "ClassroomDeviceAgent.exe";
    const manualLaunchCommand = typeof info.manualLaunchCommand === "string" ? info.manualLaunchCommand : "";

    if (info.downloadAvailable && downloadPath) {
      downloadAgentLink.classList.remove("disabled");
      downloadAgentLink.removeAttribute("aria-disabled");
      downloadAgentLink.href = downloadPath;
      downloadAgentLink.setAttribute("download", downloadFilename);
      downloadAgentLink.textContent = "Download classroom manager (.exe)";
      downloadUrl.textContent = preferredDownloadUrl || downloadPath;
      connectNote.textContent = "Students can download the classroom manager and, when they start it, it will ask whether it should install itself into their Documents\\Intel folder.";
    } else {
      downloadAgentLink.classList.add("disabled");
      downloadAgentLink.setAttribute("aria-disabled", "true");
      downloadAgentLink.removeAttribute("href");
      downloadAgentLink.removeAttribute("download");
      downloadUrl.textContent = "Packaged .exe not found.";
      connectNote.textContent = manualLaunchCommand
        ? `The packaged .exe is missing right now. You can still launch the agent manually with ${manualLaunchCommand}.`
        : "The packaged .exe is missing right now.";
    }
  } catch {
    downloadAgentLink.classList.add("disabled");
    downloadAgentLink.setAttribute("aria-disabled", "true");
    downloadAgentLink.removeAttribute("href");
    downloadAgentLink.removeAttribute("download");
    downloadUrl.textContent = "Could not load the download link.";
    connectNote.textContent = "Student laptops can auto-discover the teacher dashboard on the local network after the agent starts.";
  }
}

function getSessionPointerCoordinates(event) {
  const frame = screenFrames.get(sessionDeviceId);
  if (!frame || !frame.sourceWidth || !frame.sourceHeight) {
    return null;
  }

  const rect = sessionImage.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }

  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) {
    return null;
  }

  return {
    x: Math.round((frame.sourceLeft || 0) + (localX / rect.width) * frame.sourceWidth),
    y: Math.round((frame.sourceTop || 0) + (localY / rect.height) * frame.sourceHeight),
  };
}

function mapMouseButton(button) {
  if (button === 2) return "right";
  if (button === 1) return "middle";
  return "left";
}

function buildSessionFrameUrl(frame) {
  return `data:${frame.mimeType || "image/bmp"};base64,${frame.data}`;
}

function renderSessionFrame(frame) {
  const nextToken = `${frame.capturedAt || 0}:${frame.width || 0}:${frame.height || 0}:${frame.data.length}`;
  if (nextToken === renderedSessionFrameToken || nextToken === pendingSessionFrameToken) {
    return;
  }

  pendingSessionFrameToken = nextToken;
  pendingSessionFrameUrl = buildSessionFrameUrl(frame);
  flushPendingSessionFrame();
}

function flushPendingSessionFrame() {
  if (!pendingSessionFrameUrl || sessionFrameDecodePending) {
    return;
  }

  const nextToken = pendingSessionFrameToken;
  const nextUrl = pendingSessionFrameUrl;
  const preloadImage = new Image();
  sessionFrameDecodePending = true;

  preloadImage.onload = () => {
    sessionFrameDecodePending = false;
    if (pendingSessionFrameToken === nextToken) {
      pendingSessionFrameToken = null;
      pendingSessionFrameUrl = null;
    }

    renderedSessionFrameToken = nextToken;
    sessionImage.src = nextUrl;
    sessionImage.hidden = false;
    sessionEmpty.hidden = true;
    sessionPreview.classList.add("has-frame");
    applySessionScale();

    if (pendingSessionFrameUrl) {
      flushPendingSessionFrame();
    }
  };

  preloadImage.onerror = () => {
    sessionFrameDecodePending = false;
    if (pendingSessionFrameToken === nextToken) {
      pendingSessionFrameToken = null;
      pendingSessionFrameUrl = null;
    }

    if (pendingSessionFrameUrl) {
      flushPendingSessionFrame();
    }
  };

  preloadImage.src = nextUrl;
}

async function fileToPngPayload(file, maxWidth, maxHeight) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });

  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("Could not decode the selected image."));
    element.src = dataUrl;
  });

  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));

  const context = canvas.getContext("2d");
  context.fillStyle = "#000000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL("image/png").split(",")[1];
}

async function fileToBase64Payload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const [, base64] = result.split(",", 2);
      if (!base64) {
        reject(new Error("Could not read the selected file."));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}

function sendDeviceAction(action) {
  const device = getSelectedDevice();
  if (!device) {
    toast("That device is no longer available.", "error");
    return null;
  }

  send({ type: action, id: device.id });
  return device;
}

loginButton.addEventListener("click", () => {
  performLogin();
});

loginPasswordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    performLogin();
  }
});

loginUsernameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    performLogin();
  }
});

logoutButton.addEventListener("click", () => {
  performLogout();
});

adminCreateAccountButton.addEventListener("click", async () => {
  const username = adminNewUsernameInput.value.trim();
  const password = adminNewPasswordInput.value;
  if (!username || !password) {
    toast("Enter a username and password first.", "error");
    return;
  }

  try {
    const payload = await fetchJson("/api/admin/accounts", {
      method: "POST",
      body: JSON.stringify({ username, password, isAdmin: adminNewIsAdminInput.checked }),
    });
    applyAdminResponse(payload);
    adminNewUsernameInput.value = "";
    adminNewPasswordInput.value = "";
    adminNewIsAdminInput.checked = false;
    toast(`Created account ${username}.`);
  } catch (error) {
    if (error?.status === 401) {
      setSignedOutState("Your session expired. Sign in again.");
      return;
    }
    toast(error instanceof Error ? error.message : "Could not create that account.", "error");
  }
});

adminLoadPresetButton.addEventListener("click", () => {
  fillAdminPresetForm();
});

adminPresetSelect.addEventListener("change", () => {
  if (adminPresetSelect.value) {
    fillAdminPresetForm(adminPresetSelect.value);
  }
});

adminSavePresetButton.addEventListener("click", async () => {
  const name = adminPresetNameInput.value.trim();
  if (!name) {
    toast("Enter a preset name first.", "error");
    return;
  }

  try {
    const payload = await fetchJson("/api/admin/presets", {
      method: "POST",
      body: JSON.stringify({
        name,
        allowedPrograms: parseRuleInput(adminPresetProgramsInput.value),
        allowedSites: parseRuleInput(adminPresetSitesInput.value),
        websiteMode: adminPresetWebsiteModeInput.value === "warn" ? "warn" : "block",
      }),
    });
    applyAdminResponse(payload);
    adminPresetSelect.value = name;
    fillAdminPresetForm(name);
    toast(`Saved preset ${name}.`);
  } catch (error) {
    if (error?.status === 401) {
      setSignedOutState("Your session expired. Sign in again.");
      return;
    }
    toast(error instanceof Error ? error.message : "Could not save that preset.", "error");
  }
});

adminDeletePresetButton.addEventListener("click", async () => {
  const name = adminPresetSelect.value.trim() || adminPresetNameInput.value.trim();
  if (!name) {
    toast("Choose a preset first.", "error");
    return;
  }

  try {
    const payload = await fetchJson("/api/admin/presets/delete", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    applyAdminResponse(payload);
    adminPresetSelect.value = "";
    adminPresetNameInput.value = "";
    adminPresetProgramsInput.value = "";
    adminPresetSitesInput.value = "";
    adminPresetWebsiteModeInput.value = "block";
    toast(`Deleted preset ${name}.`);
  } catch (error) {
    if (error?.status === 401) {
      setSignedOutState("Your session expired. Sign in again.");
      return;
    }
    toast(error instanceof Error ? error.message : "Could not delete that preset.", "error");
  }
});

adminAccountList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const username = button.dataset.username || "";
  const row = button.closest(".account-row");
  if (!username || !row) {
    return;
  }

  if (button.dataset.action === "change-password") {
    const passwordInput = row.querySelector("input[data-password-input]");
    const password = passwordInput?.value || "";
    if (!password) {
      toast("Enter a new password first.", "error");
      return;
    }

    try {
      const payload = await fetchJson("/api/admin/password", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      applyAdminResponse(payload);
      toast(`Updated the password for ${username}.`);
    } catch (error) {
      if (error?.status === 401) {
        setSignedOutState("Your session expired. Sign in again.");
        return;
      }
      toast(error instanceof Error ? error.message : "Could not update that password.", "error");
    }
    return;
  }

  if (button.dataset.action === "delete-account") {
    if (!window.confirm(`Delete the account ${username}?`)) {
      return;
    }

    try {
      const payload = await fetchJson("/api/admin/accounts/delete", {
        method: "POST",
        body: JSON.stringify({ username }),
      });
      applyAdminResponse(payload);
      toast(`Deleted account ${username}.`);
    } catch (error) {
      if (error?.status === 401) {
        setSignedOutState("Your session expired. Sign in again.");
        return;
      }
      toast(error instanceof Error ? error.message : "Could not delete that account.", "error");
    }
  }
});

adminAccountList.addEventListener("change", (event) => {
  const changedInput = event.target.closest("input[data-admin-toggle], input[data-class-name]");
  if (!changedInput) {
    return;
  }

  const row = changedInput.closest(".account-row");
  if (!row) {
    return;
  }

  const checked = Boolean(row.querySelector("input[data-admin-toggle]")?.checked);
  const accessGrid = row.querySelector(".access-grid");
  if (accessGrid) {
    accessGrid.classList.toggle("hidden", checked);
  }
  for (const checkbox of row.querySelectorAll("input[data-class-name]")) {
    checkbox.disabled = checked;
  }
  queueAccountAccessSave(row);
});

blackoutAllOn.addEventListener("click", () => {
  send({ type: "blackout_all_on" });
  toast("Screen blackout sent to all online devices.");
});

blackoutAllOff.addEventListener("click", () => {
  send({ type: "blackout_all_off" });
  toast("Screen blackout cleared on all online devices.");
});

refreshAll.addEventListener("click", () => {
  send({ type: "request_refresh_all" });
  toast("Refresh requested from all online devices.");
});

deviceSearchInput.addEventListener("input", () => {
  renderDashboard();
});

openGroupManager.addEventListener("click", () => {
  if (!getGroupTargetValue() && managementState.groups.length) {
    groupTargetInput.value = managementState.groups[0];
  }
  renderManagementState();
  openOverlayModal(groupManagerModal);
  groupTargetInput.focus();
});

closeGroupManager.addEventListener("click", () => {
  closeOverlayModal(groupManagerModal);
});

groupManagerModal.addEventListener("click", (event) => {
  if (event.target === groupManagerModal) {
    closeOverlayModal(groupManagerModal);
  }
});

openClassAdminManager.addEventListener("click", () => {
  if (!currentUser?.isAdmin) {
    return;
  }

  if (!getAdminClassTargetValue() && managementState.groups.length) {
    adminClassTargetInput.value = managementState.groups[0];
  }
  renderAdminClassManager();
  openOverlayModal(classAdminManagerModal);
  if (managementState.groups.length) {
    adminClassTargetInput.focus();
  } else {
    adminNewClassNameInput.focus();
  }
});

closeClassAdminManager.addEventListener("click", () => {
  closeOverlayModal(classAdminManagerModal);
});

classAdminManagerModal.addEventListener("click", (event) => {
  if (event.target === classAdminManagerModal) {
    closeOverlayModal(classAdminManagerModal);
  }
});

adminClassTargetInput.addEventListener("change", () => {
  renderAdminClassManager();
});

adminClassSearchInput.addEventListener("input", () => {
  renderAdminClassManager();
});

adminCreateClassButton.addEventListener("click", async () => {
  const group = adminNewClassNameInput.value.trim();
  if (!group) {
    toast("Enter a class name first.", "error");
    return;
  }

  pendingGroupSelection = group;
  try {
    const payload = await fetchJson("/api/admin/classes", {
      method: "POST",
      body: JSON.stringify({ group }),
    });
    applyAdminResponse(payload);
    adminNewClassNameInput.value = "";
    toast(`Created class ${group}.`);
  } catch (error) {
    if (error?.status === 401) {
      setSignedOutState("Your session expired. Sign in again.");
      return;
    }
    toast(error instanceof Error ? error.message : "Could not create that class.", "error");
  }
});

adminRenameClassButton.addEventListener("click", async () => {
  const group = getAdminClassTargetValue();
  const nextGroup = adminRenameClassNameInput.value.trim();
  if (!group) {
    toast("Choose a class to rename first.", "error");
    return;
  }
  if (!nextGroup) {
    toast("Enter the new class name first.", "error");
    return;
  }

  pendingGroupSelection = nextGroup;
  try {
    const payload = await fetchJson("/api/admin/classes/rename", {
      method: "POST",
      body: JSON.stringify({ group, nextGroup }),
    });
    applyAdminResponse(payload);
    toast(`Renamed ${group} to ${nextGroup}.`);
  } catch (error) {
    if (error?.status === 401) {
      setSignedOutState("Your session expired. Sign in again.");
      return;
    }
    toast(error instanceof Error ? error.message : "Could not rename that class.", "error");
  }
});

adminDeleteClassButton.addEventListener("click", async () => {
  const group = getAdminClassTargetValue();
  if (!group) {
    toast("Choose a class to delete first.", "error");
    return;
  }
  if (!window.confirm(`Delete the class ${group}?`)) {
    return;
  }

  try {
    const payload = await fetchJson("/api/admin/classes/delete", {
      method: "POST",
      body: JSON.stringify({ group }),
    });
    applyAdminResponse(payload);
    toast(`Deleted class ${group}.`);
  } catch (error) {
    if (error?.status === 401) {
      setSignedOutState("Your session expired. Sign in again.");
      return;
    }
    toast(error instanceof Error ? error.message : "Could not delete that class.", "error");
  }
});

adminClassDeviceList.addEventListener("change", async (event) => {
  const select = event.target.closest("select[data-device-class-select]");
  if (!select) {
    return;
  }

  const row = select.closest(".account-row");
  const id = row?.dataset.deviceId || "";
  if (!row || !id) {
    return;
  }

  const group = select.value.trim();

  try {
    await assignDeviceClassNow(id, group);
    toast(group ? `Assigned ${getDeviceLabel(getDeviceById(id) || { username: "device" })} to ${group}.` : "Cleared the class assignment.");
  } catch (error) {
    if (error?.status === 401) {
      setSignedOutState("Your session expired. Sign in again.");
      return;
    }
    toast(error instanceof Error ? error.message : "Could not update that class assignment.", "error");
  }
});

closeDeviceModal.addEventListener("click", () => {
  closeDeviceModalView();
});

deviceModal.addEventListener("click", (event) => {
  if (event.target === deviceModal) {
    closeDeviceModalView();
  }
});

devicePolicyModeButton.addEventListener("click", () => {
  const device = getSelectedDevice();
  if (!device) {
    toast("That device is no longer available.", "error");
    return;
  }
  if (!device.online) {
    toast("That device is offline right now.", "error");
    return;
  }

  const usingIndividualPolicy = policyHasSettings(device.devicePolicy) || forcedIndividualPolicyDeviceId === device.id;
  if (usingIndividualPolicy) {
    clearTimeout(devicePolicyAutosaveTimer);
    devicePolicyAutosaveTimer = null;
    forcedIndividualPolicyDeviceId = "";
    device.devicePolicy = createEmptyPolicy();
    syncDevicePolicyEditor(device);
    send({
      type: "set_device_policy",
      id: device.id,
      allowedPrograms: [],
      allowedSites: [],
      websiteMode: "block",
    });
    toast(`${getDeviceLabel(device)} is now using the class policy.`);
    return;
  }

  forcedIndividualPolicyDeviceId = device.id;
  const seedPolicy = policyHasSettings(device.groupPolicy) ? device.groupPolicy : createEmptyPolicy();
  deviceAllowedProgramsInput.value = Array.isArray(seedPolicy.allowedPrograms) ? seedPolicy.allowedPrograms.join("\n") : "";
  deviceAllowedSitesInput.value = Array.isArray(seedPolicy.allowedSites) ? seedPolicy.allowedSites.join("\n") : "";
  deviceWebsiteModeInput.value = seedPolicy.websiteMode === "warn" ? "warn" : "block";
  if (policyHasSettings(seedPolicy)) {
    device.devicePolicy = { ...seedPolicy };
    forcedIndividualPolicyDeviceId = "";
    syncDevicePolicyEditor(device);
    send({
      type: "set_device_policy",
      id: device.id,
      ...seedPolicy,
    });
    toast(`${getDeviceLabel(device)} is now using an individual policy.`);
    return;
  }

  syncDevicePolicyEditor(device);
  deviceAllowedProgramsInput.focus();
  toast(`Individual policy editor enabled for ${getDeviceLabel(device)}. Changes save automatically.`);
});

deviceAllowedProgramsInput.addEventListener("input", () => {
  scheduleDevicePolicyAutosave();
});

deviceAllowedSitesInput.addEventListener("input", () => {
  scheduleDevicePolicyAutosave();
});

deviceWebsiteModeInput.addEventListener("change", () => {
  sendCurrentDevicePolicy(false);
});

groupTargetInput.addEventListener("change", () => {
  renderManagementState();
});

groupPresetInput.addEventListener("change", () => {
  const presetName = groupPresetInput.value.trim();
  if (!presetName || !applyPresetToGroupForm(presetName)) {
    return;
  }

  if (getGroupTargetValue()) {
    sendCurrentGroupPolicy(false);
  }
});

allowedProgramsInput.addEventListener("input", () => {
  if (getGroupTargetValue()) {
    scheduleGroupPolicyAutosave();
  }
});

allowedSitesInput.addEventListener("input", () => {
  if (getGroupTargetValue()) {
    scheduleGroupPolicyAutosave();
  }
});

groupWebsiteModeInput.addEventListener("change", () => {
  if (getGroupTargetValue()) {
    sendCurrentGroupPolicy(false);
  }
});

clearGroupPolicy.addEventListener("click", () => {
  const group = getGroupTargetValue();
  if (!group) {
    toast("Choose a class before clearing restrictions.", "error");
    return;
  }

  clearTimeout(groupPolicyAutosaveTimer);
  groupPolicyAutosaveTimer = null;
  allowedProgramsInput.value = "";
  allowedSitesInput.value = "";
  groupWebsiteModeInput.value = "block";
  sendCurrentGroupPolicy(false);
  toast(`Cleared class restrictions for ${group}.`);
});

groupBlackoutOn.addEventListener("click", () => {
  const group = getGroupTargetValue();
  if (!group) {
    toast("Choose a class before sending blackout.", "error");
    return;
  }

  send({
    type: "blackout_on",
    group,
  });
  toast(`Screen blackout sent to class ${group}.`);
});

groupBlackoutOff.addEventListener("click", () => {
  const group = getGroupTargetValue();
  if (!group) {
    toast("Choose a class before restoring screens.", "error");
    return;
  }

  send({
    type: "blackout_off",
    group,
  });
  toast(`Screen blackout cleared for class ${group}.`);
});

groupImageInput.addEventListener("change", () => {
  selectedGroupImageFile = groupImageInput.files?.[0] || null;
  groupImageStatus.textContent = selectedGroupImageFile
    ? `${selectedGroupImageFile.name} (${Math.round(selectedGroupImageFile.size / 1024)} KB)`
    : "No picture selected.";
});

groupDisplayImageButton.addEventListener("click", async () => {
  const group = getGroupTargetValue();
  if (!group) {
    toast("Choose a class before showing a picture.", "error");
    return;
  }
  if (!selectedGroupImageFile) {
    toast("Choose a picture first.", "error");
    return;
  }
  if (selectedGroupImageFile.size > 64 * 1024 * 1024) {
    toast("The selected picture is too large.", "error");
    return;
  }

  try {
    const data = await fileToPngPayload(selectedGroupImageFile, 1920, 1080);
    send({
      type: "display_image",
      group,
      data,
    });
    toast(`Showing ${selectedGroupImageFile.name} on class ${group}.`);
  } catch (error) {
    toast(error instanceof Error ? error.message : "Could not prepare the selected picture.", "error");
  }
});

groupClearImageButton.addEventListener("click", () => {
  const group = getGroupTargetValue();
  if (!group) {
    toast("Choose a class before clearing a picture.", "error");
    return;
  }

  send({
    type: "clear_display_image",
    group,
  });
  toast(`Cleared the displayed picture for class ${group}.`);
});

sendGroupAnnouncementButton.addEventListener("click", () => {
  const group = getGroupTargetValue();
  const text = groupAnnouncementInput.value.trim();
  if (!group) {
    toast("Choose a class before sending an announcement.", "error");
    return;
  }
  if (!text) {
    toast("Type an announcement first.", "error");
    return;
  }

  send({
    type: "show_announcement",
    group,
    text,
  });
  toast(`Announcement sent to class ${group}.`);
});

clearGroupAnnouncementButton.addEventListener("click", () => {
  const group = getGroupTargetValue();
  if (!group) {
    toast("Choose a class before clearing an announcement.", "error");
    return;
  }

  send({
    type: "clear_announcement",
    group,
  });
  toast(`Announcement cleared for class ${group}.`);
});

deviceScreenShareButton.addEventListener("click", () => {
  const device = getSelectedDevice();
  if (!device) {
    toast("That device is no longer available.", "error");
    return;
  }

  const action = getDeviceScreenShareAction(device);
  if (!action.type) {
    toast(action.label, "error");
    return;
  }
  send({ type: action.type, id: device.id });
  toast(`${action.label} sent to ${getDeviceLabel(device)}.`);
});

deviceOpenSessionButton.addEventListener("click", () => {
  const device = getSelectedDevice();
  if (!device) {
    toast("That device is no longer available.", "error");
    return;
  }
  if (!canOpenSession(device)) {
    toast("Start or receive a screen share before opening the live session.", "error");
    return;
  }

  openSessionModal(device.id);
});

deviceBlackoutButton.addEventListener("click", () => {
  const device = getSelectedDevice();
  if (!device) {
    toast("That device is no longer available.", "error");
    return;
  }

  const nextAction = device.screenBlackout === "On" ? "blackout_off" : "blackout_on";
  send({ type: nextAction, id: device.id });
  toast(`${device.screenBlackout === "On" ? "Restoring" : "Blacking out"} ${getDeviceLabel(device)}'s screen.`);
});

deviceRefreshButton.addEventListener("click", () => {
  const device = getSelectedDevice();
  if (!device) {
    toast("That device is no longer available.", "error");
    return;
  }

  send({ type: "request_refresh", id: device.id });
  toast(`Requested a fresh status update from ${getDeviceLabel(device)}.`);
});

deviceImageInput.addEventListener("change", () => {
  selectedDeviceImageFile = deviceImageInput.files?.[0] || null;
  deviceImageStatus.textContent = selectedDeviceImageFile
    ? `${selectedDeviceImageFile.name} (${Math.round(selectedDeviceImageFile.size / 1024)} KB)`
    : "No picture selected.";
});

displayDeviceImageButton.addEventListener("click", async () => {
  const device = getSelectedDevice();
  if (!device) {
    toast("That device is no longer available.", "error");
    return;
  }
  if (!selectedDeviceImageFile) {
    toast("Choose a picture first.", "error");
    return;
  }
  if (selectedDeviceImageFile.size > 64 * 1024 * 1024) {
    toast("The selected picture is too large.", "error");
    return;
  }

  try {
    const data = await fileToPngPayload(selectedDeviceImageFile, 1920, 1080);
    send({
      type: "display_image",
      id: device.id,
      data,
    });
    toast(`Showing ${selectedDeviceImageFile.name} on ${getDeviceLabel(device)}.`);
  } catch (error) {
    toast(error instanceof Error ? error.message : "Could not prepare the selected picture.", "error");
  }
});

clearDeviceImageButton.addEventListener("click", () => {
  const device = getSelectedDevice();
  if (!device) {
    toast("That device is no longer available.", "error");
    return;
  }

  send({
    type: "clear_display_image",
    id: device.id,
  });
  toast(`Clearing the displayed picture on ${getDeviceLabel(device)}.`);
});

sendDeviceAnnouncementButton.addEventListener("click", () => {
  const device = getSelectedDevice();
  const text = deviceAnnouncementInput.value.trim();
  if (!device) {
    toast("That device is no longer available.", "error");
    return;
  }
  if (!text) {
    toast("Type an announcement first.", "error");
    return;
  }

  send({
    type: "show_announcement",
    id: device.id,
    text,
  });
  toast(`Announcement sent to ${getDeviceLabel(device)}.`);
});

clearDeviceAnnouncementButton.addEventListener("click", () => {
  const device = getSelectedDevice();
  if (!device) {
    toast("That device is no longer available.", "error");
    return;
  }

  send({
    type: "clear_announcement",
    id: device.id,
  });
  toast(`Announcement cleared for ${getDeviceLabel(device)}.`);
});

launchWebsiteButton.addEventListener("click", () => {
  const device = getSelectedDevice();
  const url = launchWebsiteInput.value.trim();
  if (!device) {
    toast("That device is no longer available.", "error");
    return;
  }
  if (!url) {
    toast("Enter a website URL first.", "error");
    return;
  }

  send({
    type: "launch_website",
    id: device.id,
    url,
  });
  toast(`Opening ${url} for ${getDeviceLabel(device)}.`);
});

launchProgramButton.addEventListener("click", () => {
  const device = getSelectedDevice();
  const command = launchProgramInput.value.trim();
  if (!device) {
    toast("That device is no longer available.", "error");
    return;
  }
  if (!command) {
    toast("Enter a program command first.", "error");
    return;
  }

  send({
    type: "launch_program",
    id: device.id,
    command,
  });
  toast(`Launching ${command} for ${getDeviceLabel(device)}.`);
});

agentUpdateInput.addEventListener("change", () => {
  selectedAgentUpdateFile = agentUpdateInput.files?.[0] || null;
  agentUpdateStatus.textContent = selectedAgentUpdateFile
    ? `${selectedAgentUpdateFile.name} (${Math.round(selectedAgentUpdateFile.size / 1024)} KB)`
    : "No update selected.";
});

deployAgentUpdate.addEventListener("click", async () => {
  const device = getSelectedDevice();
  if (!device) {
    toast("That device is no longer available.", "error");
    return;
  }
  if (!selectedAgentUpdateFile) {
    toast("Choose an update file first.", "error");
    return;
  }
  if (selectedAgentUpdateFile.size > 64 * 1024 * 1024) {
    toast("The selected update file is too large.", "error");
    return;
  }

  try {
    const data = await fileToBase64Payload(selectedAgentUpdateFile);
    send({
      type: "deploy_update",
      id: device.id,
      filename: selectedAgentUpdateFile.name,
      data,
    });
    toast(`Deploying ${selectedAgentUpdateFile.name} to ${getDeviceLabel(device)}.`);
  } catch (error) {
    toast(error instanceof Error ? error.message : "Could not prepare the update file.", "error");
  }
});

deviceLockButton.addEventListener("click", () => {
  const device = getSelectedDevice();
  if (!device) {
    toast("That device is no longer available.", "error");
    return;
  }

  send({
    type: "lock_device",
    id: device.id,
  });
  toast(`Locking ${getDeviceLabel(device)}.`);
});

deviceRestartButton.addEventListener("click", () => {
  const device = getSelectedDevice();
  if (!device) {
    toast("That device is no longer available.", "error");
    return;
  }
  if (!window.confirm(`Restart ${getDeviceLabel(device)}?`)) {
    return;
  }

  send({
    type: "restart_device",
    id: device.id,
  });
  toast(`Restart scheduled for ${getDeviceLabel(device)}.`);
});

deviceShutdownButton.addEventListener("click", () => {
  const device = getSelectedDevice();
  if (!device) {
    toast("That device is no longer available.", "error");
    return;
  }
  if (!window.confirm(`Shut down ${getDeviceLabel(device)}?`)) {
    return;
  }

  send({
    type: "shutdown_device",
    id: device.id,
  });
  toast(`Shutdown scheduled for ${getDeviceLabel(device)}.`);
});

closeSessionModalButton.addEventListener("click", () => {
  closeSessionModal(true);
});

sessionModal.addEventListener("click", (event) => {
  if (event.target === sessionModal) {
    closeSessionModal(true);
  }
});

sessionImage.draggable = false;
sessionImage.addEventListener("dragstart", (event) => {
  event.preventDefault();
});

remoteControlToggle.addEventListener("click", () => {
  if (remoteControlToggle.disabled) return;

  setRemoteControlEnabled(!remoteControlEnabled);
  if (remoteControlEnabled) {
    toast("Remote control enabled for this session.");
  } else {
    toast("Remote control disabled.");
  }
});

sessionPreview.addEventListener("pointermove", (event) => {
  if (!remoteControlEnabled || sessionImage.hidden) return;

  const sessionDevice = getDeviceById(sessionDeviceId);
  if (!sessionDevice || getScreenShareStatus(sessionDevice) !== "Active") return;

  const now = Date.now();
  if (now - lastRemoteMoveAt < 20) return;

  const coordinates = getSessionPointerCoordinates(event);
  if (!coordinates) return;

  lastRemoteMoveAt = now;
  lastRemoteCoordinates = coordinates;
  send({
    type: "remote_mouse_move",
    id: sessionDevice.id,
    x: coordinates.x,
    y: coordinates.y,
  });
});

sessionPreview.addEventListener("pointerdown", (event) => {
  if (!remoteControlEnabled || sessionImage.hidden) return;

  const sessionDevice = getDeviceById(sessionDeviceId);
  if (!sessionDevice || getScreenShareStatus(sessionDevice) !== "Active") return;

  const coordinates = getSessionPointerCoordinates(event);
  if (!coordinates) return;

  event.preventDefault();
  remotePointerActive = true;
  remotePointerButton = mapMouseButton(event.button);
  lastRemoteCoordinates = coordinates;
  sessionPreview.setPointerCapture(event.pointerId);
  sessionPreview.focus();
  send({
    type: "remote_mouse_move",
    id: sessionDevice.id,
    x: coordinates.x,
    y: coordinates.y,
  });
  send({
    type: "remote_mouse_down",
    id: sessionDevice.id,
    button: remotePointerButton,
    x: coordinates.x,
    y: coordinates.y,
  });
});

sessionPreview.addEventListener("pointerup", (event) => {
  if (!remoteControlEnabled || !remotePointerActive) return;

  const sessionDevice = getDeviceById(sessionDeviceId);
  if (!sessionDevice || getScreenShareStatus(sessionDevice) !== "Active") return;

  const coordinates = getSessionPointerCoordinates(event);
  remotePointerActive = false;
  try {
    sessionPreview.releasePointerCapture(event.pointerId);
  } catch {
  }

  const releaseCoordinates = coordinates || lastRemoteCoordinates;
  if (!releaseCoordinates) return;

  send({
    type: "remote_mouse_up",
    id: sessionDevice.id,
    button: remotePointerButton,
    x: releaseCoordinates.x,
    y: releaseCoordinates.y,
  });
});

sessionPreview.addEventListener("pointercancel", () => {
  const sessionDevice = getDeviceById(sessionDeviceId);
  if (remotePointerActive && sessionDevice && lastRemoteCoordinates) {
    send({
      type: "remote_mouse_up",
      id: sessionDevice.id,
      button: remotePointerButton,
      x: lastRemoteCoordinates.x,
      y: lastRemoteCoordinates.y,
    });
  }
  remotePointerActive = false;
});

sessionPreview.addEventListener("contextmenu", (event) => {
  if (remoteControlEnabled) {
    event.preventDefault();
  }
});

sessionPreview.addEventListener("keydown", (event) => {
  if (!remoteControlEnabled) return;

  const sessionDevice = getDeviceById(sessionDeviceId);
  if (!sessionDevice || getScreenShareStatus(sessionDevice) !== "Active") return;

  if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) {
    return;
  }

  event.preventDefault();
  send({
    type: "remote_key",
    id: sessionDevice.id,
    key: event.key,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
  });
});

function sendSessionTextValue() {
  const sessionDevice = getDeviceById(sessionDeviceId);
  const text = sessionTextInput.value;
  if (!sessionDevice || getScreenShareStatus(sessionDevice) !== "Active") {
    toast("Start a live screen share before sending text.", "error");
    return;
  }

  if (!text.trim()) return;

  send({
    type: "type_text",
    id: sessionDevice.id,
    text,
  });
  sessionTextInput.value = "";
  toast(`Text sent to ${sessionDevice.hostname}.`);
}

sendSessionText.addEventListener("click", () => {
  sendSessionTextValue();
});

sessionTextInput.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    sendSessionTextValue();
  }
});

sessionImageInput.addEventListener("change", async () => {
  const sessionDevice = getDeviceById(sessionDeviceId);
  const file = sessionImageInput.files?.[0];
  if (!sessionDevice || !file) return;

  try {
    const frame = screenFrames.get(sessionDevice.id);
    const maxWidth = frame?.sourceWidth || 1920;
    const maxHeight = frame?.sourceHeight || 1080;
    const data = await fileToPngPayload(file, maxWidth, maxHeight);
    send({
      type: "display_image",
      id: sessionDevice.id,
      data,
    });
    toast(`Image sent to ${sessionDevice.hostname}.`);
  } catch (error) {
    toast(error instanceof Error ? error.message : "Could not send the selected image.", "error");
  } finally {
    sessionImageInput.value = "";
  }
});

clearSessionImage.addEventListener("click", () => {
  const sessionDevice = getDeviceById(sessionDeviceId);
  if (!sessionDevice) return;

  send({
    type: "clear_display_image",
    id: sessionDevice.id,
  });
  toast(`Displayed image cleared for ${sessionDevice.hostname}.`);
});

sessionScale.addEventListener("input", () => {
  previewScale = Number(sessionScale.value) || 100;
  applySessionScale();
});

themeToggleButton.addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

window.addEventListener("resize", () => {
  if (!isSessionClosed()) {
    applySessionScale();
  }
});

async function initializeApp() {
  initializeTheme();
  setSignedOutState("");
  await loadConnectInfo();

  try {
    await hydrateSession();
  } catch (error) {
    if (error?.status !== 401) {
      toast(error instanceof Error ? error.message : "Could not restore the saved session.", "error");
    }
  }
}

initializeApp();
