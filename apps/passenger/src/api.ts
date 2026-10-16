declare const process: { env: { EXPO_PUBLIC_API_URL?: string } };

const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3333").replace(/\/$/, "");

export type AccountRole = "passenger" | "driver";

export interface RouteEstimate {
  origin: { latitude: number; longitude: number; label: string };
  destination: { latitude: number; longitude: number; label: string };
  distanceKm: number;
  durationMinutes: number;
  estimatedFareCents: number;
  estimatedFare: number;
  currency: "BRL";
  pricing: { baseCents: number; perKmCents: number; perMinuteCents: number; minimumCents: number; note: string };
  mapUrl: string;
  provider: { geocoding: string; routing: string };
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: AccountRole;
  createdAt: string;
  updatedAt: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  driverProfile?: {
    vehicleMake: string | null;
    vehicleModel: string | null;
    vehicleColor: string | null;
    vehiclePlate: string | null;
    approvalStatus: string;
    isOnline: boolean;
  } | null;
}

interface AuthResponse {
  token: string;
  tokenType: "Bearer";
  user: AuthUser;
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new Error(`Não foi possível conectar à API em ${API_URL}. Confira se o servidor está ligado e se o endereço está correto.`);
  }

  const data = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Ocorreu um erro. Tente novamente.");
  return data as T;
}

export const authApi = {
  register: (input: { name: string; email: string; phone?: string; password: string; role: AccountRole }) =>
    request<AuthResponse>("/auth/register", { method: "POST", body: JSON.stringify(input) }),
  login: (input: { email: string; password: string }) =>
    request<AuthResponse>("/auth/login", { method: "POST", body: JSON.stringify(input) }),
  me: (token: string) => request<{ user: AuthUser }>("/me", {}, token),
  updateProfile: (token: string, input: { name?: string; phone?: string | null }) =>
    request<{ user: AuthUser }>("/me", { method: "PATCH", body: JSON.stringify(input) }, token),
  forgotPassword: (email: string) =>
    request<{ message: string; developmentCode?: string }>("/auth/password/forgot", { method: "POST", body: JSON.stringify({ email }) }),
  resetPassword: (email: string, code: string, newPassword: string) =>
    request<{ message: string }>("/auth/password/reset", { method: "POST", body: JSON.stringify({ email, code, newPassword }) }),
  requestEmailVerification: (token: string) =>
    request<{ message: string; developmentCode?: string }>("/auth/verification/email", { method: "POST" }, token),
  requestPhoneVerification: (token: string) =>
    request<{ message: string; developmentCode?: string }>("/auth/verification/phone", { method: "POST" }, token),
  confirmVerification: (token: string, channel: "email" | "phone", code: string) =>
    request<{ message: string }>("/auth/verification/confirm", { method: "POST", body: JSON.stringify({ channel, code }) }, token),
  estimateRoute: (origin: string, destination: string) =>\n    request<RouteEstimate>("/mobility/estimate", { method: "POST", body: JSON.stringify({ origin, destination }) }),\n  updateDriverProfile: (token: string, input: {
    cpf?: string; licenseNumber?: string; vehicleMake?: string; vehicleModel?: string;
    vehicleColor?: string; vehiclePlate?: string;
  }) => request<{ driverProfile: NonNullable<AuthUser["driverProfile"]> }>(
    "/profiles/driver", { method: "PATCH", body: JSON.stringify(input) }, token
  ),
};

export { API_URL };
