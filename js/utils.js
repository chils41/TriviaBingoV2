export function formatRoleLabel(role) {
  if (!role) {
    return "Unknown";
  }

  return role.charAt(0).toUpperCase() + role.slice(1);
}

const DEVICE_ID_STORAGE_KEY = "eventEngineDeviceId";
const FIREBASE_KEY_UNSAFE_PATTERN = /[.#$\[\]\/]/g;

function getLocalStorage() {
  try {
    return window.localStorage;
  } catch (error) {
    console.warn("[Event Engine] Local storage is unavailable for player device IDs.", error);
    return null;
  }
}

export function normalizeTextInput(value) {
  return String(value ?? "").trim();
}

export function normalizeEmailInput(value) {
  return normalizeTextInput(value).toLowerCase();
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
