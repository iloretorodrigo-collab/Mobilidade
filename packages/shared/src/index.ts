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
