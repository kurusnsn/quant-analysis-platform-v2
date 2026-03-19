export type DevUser = {
  id: string;
  email: string;
  displayName?: string;
  plan?: "free" | "pro";
};

export const DEV_USER_STORAGE_KEY = "quant-platform_dev_user";
export const DEV_USER_COOKIE = "quant-platform_dev_user";
export const DEV_USER_HEADER = "X-QuantPlatform-Dev-User";

const DEFAULT_DEV_USER_ID = "11111111-1111-4111-8111-111111111111";
const DEFAULT_DEV_USER_EMAIL = "dev-pro@quant-platform.local";
const DEFAULT_DEV_USER_DISPLAY_NAME = "Dev Pro User";
const DEFAULT_DEV_USER_PLAN: DevUser["plan"] = "pro";

const guidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isLocalHost = (hostname: string) =>
  hostname === "localhost" || hostname === "127.0.0.1";

const safeDecodeURIComponent = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const encodeBase64 = (value: string) => {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "utf8").toString("base64");
  }
  if (typeof btoa !== "undefined") {
    return btoa(unescape(encodeURIComponent(value)));
  }
  return "";
};

const decodeBase64 = (value: string) => {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "base64").toString("utf8");
  }
  if (typeof atob !== "undefined") {
    return decodeURIComponent(escape(atob(value)));
  }
  return "";
};

const normalizePlan = (value: unknown): DevUser["plan"] | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "pro") return "pro";
  if (normalized === "free") return "free";
  return undefined;
};

const parseConfiguredPlan = () => normalizePlan(process.env.NEXT_PUBLIC_DEV_USER_PLAN);

const isValidDevUser = (value: unknown): value is DevUser => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as DevUser;
  if (!candidate.id || !candidate.email) return false;
  if (!guidRegex.test(candidate.id)) return false;
  if (!candidate.email.includes("@")) return false;
  if (candidate.plan && !normalizePlan(candidate.plan)) return false;
  return true;
};

export const encodeDevUser = (user: DevUser) =>
  encodeBase64(JSON.stringify(user));

export const decodeDevUser = (encoded: string) => {
  const normalized = safeDecodeURIComponent(encoded);
  try {
    const json = decodeBase64(normalized);
    const parsed = JSON.parse(json);
    return isValidDevUser(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const isDevAuthEnabled = () =>
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_DEV_AUTH === "true" ||
  (typeof window !== "undefined" && isLocalHost(window.location.hostname));

export const shouldForceConfiguredDevUser = () =>
  process.env.NEXT_PUBLIC_DEV_USER_FORCE === "true";

export const getConfiguredDevUser = (): DevUser => {
  const configuredId = process.env.NEXT_PUBLIC_DEV_USER_ID?.trim();
  const configuredEmail = process.env.NEXT_PUBLIC_DEV_USER_EMAIL?.trim();
  const configuredDisplayName = process.env.NEXT_PUBLIC_DEV_USER_DISPLAY_NAME?.trim();
  const configuredPlan = parseConfiguredPlan();

  return {
    id: configuredId && guidRegex.test(configuredId) ? configuredId : DEFAULT_DEV_USER_ID,
    email:
      configuredEmail && configuredEmail.includes("@")
        ? configuredEmail
        : DEFAULT_DEV_USER_EMAIL,
    displayName: configuredDisplayName || DEFAULT_DEV_USER_DISPLAY_NAME,
    plan: configuredPlan ?? DEFAULT_DEV_USER_PLAN,
  };
};

export const getDevUserFromStorage = (): DevUser | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DEV_USER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidDevUser(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const getOrCreateDevUser = (): DevUser | null => {
  if (typeof window === "undefined") return null;
  if (!isDevAuthEnabled()) return null;

  const configured = getConfiguredDevUser();
  const existing = getDevUserFromStorage();
  const shouldForce = shouldForceConfiguredDevUser();
  const enforcedPlan = configured.plan ?? DEFAULT_DEV_USER_PLAN;

  if (existing && !shouldForce) {
    if (existing.plan === enforcedPlan) {
      return existing;
    }

    const upgraded = { ...existing, plan: enforcedPlan };
    localStorage.setItem(DEV_USER_STORAGE_KEY, JSON.stringify(upgraded));
    return upgraded;
  }

  const nextUser = configured.plan === enforcedPlan
    ? configured
    : { ...configured, plan: enforcedPlan };

  localStorage.setItem(DEV_USER_STORAGE_KEY, JSON.stringify(nextUser));
  return nextUser;
};
