export function formatRoleLabel(role) {
  if (!role) {
    return "Unknown";
  }

  return role.charAt(0).toUpperCase() + role.slice(1);
}

const DEVICE_ID_STORAGE_KEY = "eventEngineDeviceId";
const ROLE_UNLOCK_STORAGE_KEY_PREFIX = "eventEngineRoleUnlock";
const FIREBASE_KEY_UNSAFE_PATTERN = /[.#$\[\]\/]/g;

function getLocalStorage() {
  try {
    return window.localStorage;
  } catch (error) {
    console.warn("[Event Engine] Local storage is unavailable for player device IDs.", error);
    return null;
  }
}

function getSessionStorage() {
  try {
    return window.sessionStorage;
  } catch (error) {
    console.warn("[Event Engine] Session storage is unavailable for role unlock state.", error);
    return null;
  }
}

export function normalizeTextInput(value) {
  return String(value ?? "").trim();
}

export function normalizeEmailInput(value) {
  return normalizeTextInput(value).toLowerCase();
}

export function buildRoleUnlockStorageKey(role, eventId) {
  const normalizedRole = normalizeTextInput(role).toLowerCase() || "unknown";
  const normalizedEventId = normalizeTextInput(eventId) || "default";

  return `${ROLE_UNLOCK_STORAGE_KEY_PREFIX}:${normalizedRole}:${normalizedEventId}`;
}

export function hasRoleUnlockSession(role, eventId) {
  const storage = getSessionStorage();

  if (!storage) {
    return false;
  }

  return storage.getItem(buildRoleUnlockStorageKey(role, eventId)) === "1";
}

export function setRoleUnlockSession(role, eventId) {
  const storage = getSessionStorage();

  if (!storage) {
    return false;
  }

  storage.setItem(buildRoleUnlockStorageKey(role, eventId), "1");
  return true;
}

export function clearRoleUnlockSession(role, eventId) {
  const storage = getSessionStorage();

  if (!storage) {
    return false;
  }

  storage.removeItem(buildRoleUnlockStorageKey(role, eventId));
  return true;
}

export function sanitizeFirebaseKey(value) {
  const normalized = normalizeTextInput(value).replace(FIREBASE_KEY_UNSAFE_PATTERN, "-");
  return normalized || "device_fallback";
}

export function createDeviceId() {
  const rawId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  return sanitizeFirebaseKey(`device_${rawId}`);
}

export function getOrCreateDeviceId() {
  const storage = getLocalStorage();
  const storedId = storage?.getItem(DEVICE_ID_STORAGE_KEY) || "";
  const safeStoredId = sanitizeFirebaseKey(storedId);

  if (safeStoredId && safeStoredId !== "device_fallback") {
    if (safeStoredId !== storedId) {
      storage?.setItem(DEVICE_ID_STORAGE_KEY, safeStoredId);
    }

    return safeStoredId;
  }

  const nextDeviceId = createDeviceId();
  storage?.setItem(DEVICE_ID_STORAGE_KEY, nextDeviceId);
  return nextDeviceId;
}

export function isValidEmail(value) {
  if (!value) {
    return true;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isValidAbsoluteHttpUrl(value) {
  const normalizedValue = normalizeTextInput(value);

  if (!normalizedValue) {
    return false;
  }

  try {
    const parsedUrl = new URL(normalizedValue);
    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  } catch (error) {
    return false;
  }
}

export function getPreferredName(fullName) {
  const normalizedName = normalizeTextInput(fullName);

  if (!normalizedName) {
    return "Player";
  }

  return normalizedName.split(/\s+/)[0];
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
