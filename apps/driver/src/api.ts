const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3333").replace(/\/$/, "");

export type AccountRole = "passenger" | "driver";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: AccountRole;
  createdAt: string;
  updatedAt: string;
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
  updateDriverProfile: (token: string, input: {
    cpf?: string; licenseNumber?: string; vehicleMake?: string; vehicleModel?: string;
    vehicleColor?: string; vehiclePlate?: string;
  }) => request<{ driverProfile: NonNullable<AuthUser["driverProfile"]> }>(
    "/profiles/driver", { method: "PATCH", body: JSON.stringify(input) }, token
  ),
};

export { API_URL };
