CREATE TYPE "UserRole" AS ENUM ('PASSENGER', 'DRIVER', 'ADMIN');
CREATE TYPE "DriverApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "RideStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'DRIVER_ARRIVING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT,
  "passwordHash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'PASSENGER',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

CREATE TABLE "DriverProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "cpf" TEXT,
  "licenseNumber" TEXT,
  "vehicleMake" TEXT,
  "vehicleModel" TEXT,
  "vehicleColor" TEXT,
  "vehiclePlate" TEXT,
  "approvalStatus" "DriverApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "isOnline" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DriverProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DriverProfile_userId_key" ON "DriverProfile"("userId");
CREATE UNIQUE INDEX "DriverProfile_cpf_key" ON "DriverProfile"("cpf");
CREATE UNIQUE INDEX "DriverProfile_licenseNumber_key" ON "DriverProfile"("licenseNumber");
CREATE UNIQUE INDEX "DriverProfile_vehiclePlate_key" ON "DriverProfile"("vehiclePlate");

CREATE TABLE "TripQuote" (
  "id" TEXT NOT NULL,
  "passengerId" TEXT NOT NULL,
  "originLatitude" DOUBLE PRECISION NOT NULL,
  "originLongitude" DOUBLE PRECISION NOT NULL,
  "destinationLatitude" DOUBLE PRECISION NOT NULL,
  "destinationLongitude" DOUBLE PRECISION NOT NULL,
  "distanceMeters" INTEGER NOT NULL,
  "durationSeconds" INTEGER NOT NULL,
  "estimatedFareCents" INTEGER NOT NULL,
  "fareRuleVersion" TEXT NOT NULL DEFAULT 'mvp-v1',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TripQuote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TripQuote_passengerId_createdAt_idx" ON "TripQuote"("passengerId", "createdAt");
CREATE INDEX "TripQuote_expiresAt_usedAt_idx" ON "TripQuote"("expiresAt", "usedAt");

CREATE TABLE "Ride" (
  "id" TEXT NOT NULL,
  "passengerId" TEXT NOT NULL,
  "driverId" TEXT,
  "status" "RideStatus" NOT NULL DEFAULT 'REQUESTED',
  "originLatitude" DOUBLE PRECISION NOT NULL,
  "originLongitude" DOUBLE PRECISION NOT NULL,
  "destinationLatitude" DOUBLE PRECISION NOT NULL,
  "destinationLongitude" DOUBLE PRECISION NOT NULL,
  "estimatedFareCents" INTEGER,
  "quoteId" TEXT,
  "idempotencyKey" TEXT,
  "finalFareCents" INTEGER,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "Ride_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Ride_quoteId_key" ON "Ride"("quoteId");
CREATE UNIQUE INDEX "Ride_idempotencyKey_key" ON "Ride"("idempotencyKey");
CREATE INDEX "Ride_passengerId_requestedAt_idx" ON "Ride"("passengerId", "requestedAt");
CREATE INDEX "Ride_driverId_status_idx" ON "Ride"("driverId", "status");
CREATE INDEX "Ride_status_requestedAt_idx" ON "Ride"("status", "requestedAt");

CREATE TABLE "DriverOffer" (
  "id" TEXT NOT NULL,
  "rideId" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DriverOffer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DriverOffer_rideId_driverId_key" ON "DriverOffer"("rideId", "driverId");
CREATE INDEX "DriverOffer_driverId_expiresAt_idx" ON "DriverOffer"("driverId", "expiresAt");
CREATE INDEX "DriverOffer_rideId_expiresAt_idx" ON "DriverOffer"("rideId", "expiresAt");

CREATE TABLE "OutboxEvent" (
  "id" TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMP(3),
  "lastError" TEXT,
  CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OutboxEvent_publishedAt_createdAt_idx" ON "OutboxEvent"("publishedAt", "createdAt");
CREATE INDEX "OutboxEvent_aggregateType_aggregateId_createdAt_idx" ON "OutboxEvent"("aggregateType", "aggregateId", "createdAt");

ALTER TABLE "DriverProfile" ADD CONSTRAINT "DriverProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TripQuote" ADD CONSTRAINT "TripQuote_passengerId_fkey" FOREIGN KEY ("passengerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Ride" ADD CONSTRAINT "Ride_passengerId_fkey" FOREIGN KEY ("passengerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ride" ADD CONSTRAINT "Ride_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Ride" ADD CONSTRAINT "Ride_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "TripQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DriverOffer" ADD CONSTRAINT "DriverOffer_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriverOffer" ADD CONSTRAINT "DriverOffer_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
