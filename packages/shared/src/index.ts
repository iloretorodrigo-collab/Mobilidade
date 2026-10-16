export type UserRole = "passenger" | "driver" | "admin";

export type RideStatus =
  | "requested"
  | "accepted"
  | "driver_arriving"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface RideEstimate {
  currency: "BRL";
  estimatedFareCents: number;
  estimatedDurationMinutes: number;
  distanceMeters: number;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export type DriverApprovalStatus = "pending" | "approved" | "rejected";

export interface DriverProfile {
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleColor: string | null;
  vehiclePlate: string | null;
  approvalStatus: DriverApprovalStatus;
  isOnline: boolean;
}
