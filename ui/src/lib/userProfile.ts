export type UserProfile = {
  id: string;
  email: string;
  displayName: string | null;
};

export type UsernameAvailability = {
  available: boolean;
  reason?: string;
};

export type DeleteAccountResponse = {
  deleted: boolean;
  authDeleted?: boolean;
  message?: string;
};

const rawApiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";
const normalizedApiUrl = rawApiUrl.replace(/\/+$/, "");
const API_URL = normalizedApiUrl.endsWith("/api")
  ? normalizedApiUrl
  : `${normalizedApiUrl}/api`;

export async function checkUsernameAvailability(username: string) {
  const response = await fetch(
    `${API_URL}/users/username-available?username=${encodeURIComponent(username)}`,
    { cache: "no-store" }
  );

  if (!response.ok) {
    throw new Error("Unable to check username availability.");
  }

  return (await response.json()) as UsernameAvailability;
}

export async function getUserProfile(accessToken: string) {
  const response = await fetch(`${API_URL}/users/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error("Unable to load user profile.");
  }

  return (await response.json()) as UserProfile;
}

export async function setUsername(accessToken: string, username: string) {
  const response = await fetch(`${API_URL}/users/username`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username }),
  });

  if (response.status === 409) {
    const payload = await response.json().catch(() => null);
    return { ok: false, reason: payload?.error ?? "Username already taken." };
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    return { ok: false, reason: payload?.error ?? "Unable to set username." };
  }

  return { ok: true };
}

export async function deleteAccount(accessToken: string) {
  const response = await fetch(`${API_URL}/users/me`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    return { ok: false as const, reason: payload?.error ?? "Unable to delete account." };
  }

  const payload = (await response.json().catch(() => null)) as DeleteAccountResponse | null;
  return { ok: true as const, payload };
}
