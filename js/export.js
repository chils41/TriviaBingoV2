export function getExportCapabilities(role) {
  return {
    allowed: role === "admin",
  };
}
