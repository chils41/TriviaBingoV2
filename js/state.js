export const DEFAULT_EVENT_ID = "event-engine-demo";

export const DEFAULT_EVENT_CONFIG = {
  eventId: DEFAULT_EVENT_ID,
  eventName: "A2Z Event",
  eventLogoUrl: "",
  eventStatus: "Waiting for the next round...",
  active: true,
};

export function createState({ appName }) {
  const runtimeState = {
    appName,
    eventId: DEFAULT_EVENT_ID,
    eventConfig: { ...DEFAULT_EVENT_CONFIG },
    configSource: "fallback",
    firebase: {
      initialized: false,
      isConfigured: false,
      isConnected: false,
      status: "offline",
      message: "Firebase is not configured yet.",
      error: null,
    },
    currentPlayer: null,
    deviceId: "",
    hasPassedAgeGate: false,
    activeHubPanel: "trivia",
    reviewVisible: true,
    trivia: {},
    bingo: {},
  };

  return {
    getState() {
      return { ...runtimeState };
    },
    patch(nextState) {
      Object.assign(runtimeState, nextState);
      return { ...runtimeState };
    },
  };
}
