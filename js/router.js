const supportedApps = new Set(["player", "admin", "host", "display"]);

export function resolveAppContext(appName) {
  const normalizedApp = supportedApps.has(appName) ? appName : "player";

  return {
    appName: normalizedApp,
    route: normalizedApp,
    title: normalizedApp.charAt(0).toUpperCase() + normalizedApp.slice(1),
  };
}
