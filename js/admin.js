import { getExportCapabilities } from "./export.js";
import { formatRoleLabel } from "./utils.js";

export function initAdminPage({ firebase, renderStatus }) {
  const exportCapabilities = getExportCapabilities("admin");
  const roleLabel = formatRoleLabel("admin");
  const firebaseMessage = firebase.isConfigured ? "ready for shared event data" : "running with safe Firebase fallbacks";
  const statusMessage = `${roleLabel} shell loaded. Firebase is ${firebaseMessage}. Export access: ${exportCapabilities.allowed ? "enabled" : "disabled"}.`;

  renderStatus(statusMessage, firebase.isConfigured ? "info" : "warning");

  return {
    statusMessage,
  };
}
