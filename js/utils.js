export function formatRoleLabel(role) {
  if (!role) {
    return "Unknown";
  }

  return role.charAt(0).toUpperCase() + role.slice(1);
}
