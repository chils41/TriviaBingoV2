export function initDisplayPage({ firebase, renderStatus }) {
  const firebaseMessage = firebase.isConfigured
    ? "Display shell loaded with shared event data available."
    : "Display shell loaded safely while Firebase is unavailable.";

  renderStatus(firebaseMessage, firebase.isConfigured ? "info" : "warning");

  return {
    statusMessage: firebaseMessage,
  };
}
