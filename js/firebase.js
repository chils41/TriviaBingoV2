import { DEFAULT_EVENT_CONFIG, DEFAULT_EVENT_ID } from "./state.js";

const REQUIRED_FIREBASE_KEYS = ["apiKey", "authDomain", "databaseURL", "projectId", "appId"];
const FIREBASE_APP_MODULE_URL = "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
const FIREBASE_DATABASE_MODULE_URL = "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseState = {
  app: null,
  database: null,
  sdk: null,
  config: null,
  eventId: DEFAULT_EVENT_ID,
  initialized: false,
  isConfigured: false,
  isConnected: false,
  warning: "",
  error: null,
  readyPromise: null,
};

function normalizeRelativePath(relativePath = "") {
  return String(relativePath || "").replace(/^\/+|\/+$/g, "");
}

function isPlaceholderValue(value) {
  return typeof value === "string" && /your_|placeholder|replace-me/i.test(value);
}

function hasUsableFirebaseConfig(config) {
  if (!config || typeof config !== "object") {
    return false;
  }

  return REQUIRED_FIREBASE_KEYS.every((key) => {
    const value = config[key];
    return typeof value === "string" && value.trim() !== "" && !isPlaceholderValue(value);
  });
}

function buildFirebaseStatus() {
  const message = firebaseState.error || firebaseState.warning || (firebaseState.isConnected
    ? "Firebase connected."
    : "Firebase is running in fallback mode.");
  const status = firebaseState.error
    ? "error"
    : firebaseState.isConnected
      ? "connected"
      : "warning";

  return {
    initialized: firebaseState.initialized,
    isConfigured: firebaseState.isConfigured,
    isConnected: firebaseState.isConnected,
    status,
    message,
    error: firebaseState.error,
    warning: firebaseState.warning,
  };
}

async function loadFirebaseSdk() {
  if (firebaseState.sdk) {
    return firebaseState.sdk;
  }

  const [appModule, databaseModule] = await Promise.all([
    import(FIREBASE_APP_MODULE_URL),
    import(FIREBASE_DATABASE_MODULE_URL),
  ]);

  firebaseState.sdk = {
    initializeApp: appModule.initializeApp,
    getApps: appModule.getApps,
    getDatabase: databaseModule.getDatabase,
    get: databaseModule.get,
    onValue: databaseModule.onValue,
    ref: databaseModule.ref,
    set: databaseModule.set,
    update: databaseModule.update,
  };

  return firebaseState.sdk;
}

async function ensureFirebaseRuntime() {
  if (firebaseState.database || !hasUsableFirebaseConfig(firebaseState.config)) {
    return firebaseState.database;
  }

  if (!firebaseState.readyPromise) {
    firebaseState.readyPromise = loadFirebaseSdk()
      .then((sdk) => {
        firebaseState.app = sdk.getApps()[0] || sdk.initializeApp(firebaseState.config);
        firebaseState.database = sdk.getDatabase(firebaseState.app);
        firebaseState.isConfigured = true;
        firebaseState.isConnected = true;
        firebaseState.error = null;
        return firebaseState.database;
      })
      .catch((error) => {
        firebaseState.error = `Firebase SDK failed to load: ${error.message}`;
        firebaseState.isConfigured = false;
        firebaseState.isConnected = false;
        console.error(`[Event Engine] ${firebaseState.error}`, error);
        return null;
      });
  }

  return firebaseState.readyPromise;
}

export async function initializeFirebase(config, options = {}) {
  if (!firebaseState.initialized) {
    firebaseState.config = config || null;
    firebaseState.eventId = options.eventId || DEFAULT_EVENT_ID;
    firebaseState.initialized = true;

    if (!hasUsableFirebaseConfig(config)) {
      firebaseState.warning = "Firebase config is missing or still using placeholder values. The app is running with safe local fallbacks.";
      console.warn(`[Event Engine] ${firebaseState.warning}`);
    }
  }

  await ensureFirebaseRuntime();

  return {
    config: firebaseState.config,
    initialized: firebaseState.initialized,
    isConfigured: firebaseState.isConfigured,
    isConnected: firebaseState.isConnected,
    getStatus: buildFirebaseStatus,
    getEventId,
    getEventPath,
    readEventData,
    writeEventData,
    updateEventData,
    listenEventData,
    loadEventConfig,
    seedEventShell,
  };
}

export function getEventId() {
  return firebaseState.eventId || DEFAULT_EVENT_ID;
}

export function getEventPath(relativePath = "") {
  const cleanPath = normalizeRelativePath(relativePath);
  const basePath = `events/${getEventId()}`;
  return cleanPath ? `${basePath}/${cleanPath}` : basePath;
}

export async function readEventData(relativePath = "") {
  const database = await ensureFirebaseRuntime();

  if (!database) {
    return null;
  }

  try {
    const snapshot = await firebaseState.sdk.get(firebaseState.sdk.ref(database, getEventPath(relativePath)));
    return snapshot.exists() ? snapshot.val() : null;
  } catch (error) {
    const message = `Failed to read "${getEventPath(relativePath)}": ${error.message}`;
    firebaseState.error = message;
    console.error(`[Event Engine] ${message}`, error);
    return null;
  }
}

export async function writeEventData(relativePath = "", value) {
  const database = await ensureFirebaseRuntime();

  if (!database) {
    console.warn(`[Event Engine] Skipped write for "${getEventPath(relativePath)}" because Firebase is unavailable.`);
    return false;
  }

  try {
    await firebaseState.sdk.set(firebaseState.sdk.ref(database, getEventPath(relativePath)), value);
    return true;
  } catch (error) {
    const message = `Failed to write "${getEventPath(relativePath)}": ${error.message}`;
    firebaseState.error = message;
    console.error(`[Event Engine] ${message}`, error);
    return false;
  }
}

export async function updateEventData(relativePath = "", value) {
  const database = await ensureFirebaseRuntime();

  if (!database) {
    console.warn(`[Event Engine] Skipped update for "${getEventPath(relativePath)}" because Firebase is unavailable.`);
    return false;
  }

  try {
    await firebaseState.sdk.update(firebaseState.sdk.ref(database, getEventPath(relativePath)), value);
    return true;
  } catch (error) {
    const message = `Failed to update "${getEventPath(relativePath)}": ${error.message}`;
    firebaseState.error = message;
    console.error(`[Event Engine] ${message}`, error);
    return false;
  }
}

export function listenEventData(relativePath = "", callback) {
  let unsubscribe = () => {};
  let cancelled = false;

  ensureFirebaseRuntime()
    .then((database) => {
      if (cancelled || !database) {
        callback(null, {
          ok: false,
          source: "unavailable",
          message: firebaseState.error || firebaseState.warning || "Firebase is unavailable.",
        });
        return;
      }

      const eventRef = firebaseState.sdk.ref(database, getEventPath(relativePath));
      unsubscribe = firebaseState.sdk.onValue(
        eventRef,
        (snapshot) => {
          callback(snapshot.exists() ? snapshot.val() : null, {
            ok: true,
            source: "firebase",
            message: "Realtime listener connected.",
          });
        },
        (error) => {
          const message = `Listener error for "${getEventPath(relativePath)}": ${error.message}`;
          firebaseState.error = message;
          console.error(`[Event Engine] ${message}`, error);
          callback(null, {
            ok: false,
            source: "error",
            message,
          });
        }
      );
    })
    .catch((error) => {
      const message = `Listener setup failed for "${getEventPath(relativePath)}": ${error.message}`;
      firebaseState.error = message;
      console.error(`[Event Engine] ${message}`, error);
      callback(null, {
        ok: false,
        source: "error",
        message,
      });
    });

  return () => {
    cancelled = true;
    unsubscribe();
  };
}

export async function loadEventConfig() {
  const remoteConfig = await readEventData("config");

  if (remoteConfig && typeof remoteConfig === "object") {
    return {
      config: {
        ...DEFAULT_EVENT_CONFIG,
        ...remoteConfig,
        eventId: remoteConfig.eventId || getEventId(),
      },
      source: "firebase",
    };
  }

  return {
    config: {
      ...DEFAULT_EVENT_CONFIG,
      eventId: getEventId(),
    },
    source: "fallback",
    warning: firebaseState.isConfigured
      ? `No event config was found at "${getEventPath("config")}". Using fallback config.`
      : firebaseState.warning,
  };
}

export async function seedEventShell() {
  const database = await ensureFirebaseRuntime();

  if (!database) {
    console.warn("[Event Engine] Seed skipped because Firebase is unavailable.");
    return false;
  }

  const eventRoot = await readEventData("");

  if (eventRoot) {
    console.info(`[Event Engine] Seed skipped because "${getEventPath()}" already exists.`);
    return false;
  }

  const seedPayload = {
    config: {
      ...DEFAULT_EVENT_CONFIG,
      eventId: getEventId(),
    },
    players: {},
    pages: {},
    bottleList: {},
    bingo: {},
    trivia: {},
    display: {},
    reviewLinks: {},
    exports: {},
  };

  return writeEventData("", seedPayload);
}
