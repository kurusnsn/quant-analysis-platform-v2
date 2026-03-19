export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
const USERNAME_REGEX = /^[a-z0-9_]+$/;

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export function validateUsername(value: string) {
  if (!value) {
    return { valid: false, reason: "empty" as const };
  }
  if (value.length < USERNAME_MIN || value.length > USERNAME_MAX) {
    return { valid: false, reason: "length" as const };
  }
  if (!USERNAME_REGEX.test(value)) {
    return { valid: false, reason: "format" as const };
  }
  return { valid: true as const };
}

export function usernameHelpText() {
  return `Use ${USERNAME_MIN}-${USERNAME_MAX} characters: lowercase letters, numbers, underscore.`;
}
