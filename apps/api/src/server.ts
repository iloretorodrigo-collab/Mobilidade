import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { Prisma, PrismaClient, UserRole, RideStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { autocompleteGooglePlaces, computeGoogleRoute } from "./google-maps.js";

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error("JWT_SECRET is required and must contain at least 32 characters.");
}

const prisma = new PrismaClient();
const app = Fastify({ logger: true, bodyLimit: 16_384 });
const port = Number(process.env.API_PORT ?? 3333);
const host = process.env.HOST ?? "0.0.0.0";

await app.register(cors, {
  origin: process.env.CORS_ORIGIN?.split(",") ?? false,
});
await app.register(jwt, {
  secret: jwtSecret,
  sign: { expiresIn: "1h" },
});
await app.register(rateLimit, {
  max: 100,
  timeWindow: "15 minutes",
});

app.addHook("onClose", async () => prisma.$disconnect());

const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  phone: z.string().trim().min(8).max(20).optional(),
  password: z.string().min(8).max(72),
  role: z.enum(["passenger", "driver"]),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(72),
});

const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().min(8).max(20).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "Informe ao menos um campo para atualizar.",
});

const updateDriverProfileSchema = z.object({
  cpf: z.string().trim().min(11).max(14).optional(),
  licenseNumber: z.string().trim().min(5).max(30).optional(),
  vehicleMake: z.string().trim().min(1).max(60).optional(),
  vehicleModel: z.string().trim().min(1).max(60).optional(),
  vehicleColor: z.string().trim().min(1).max(40).optional(),
  vehiclePlate: z.string().trim().min(7).max(10).transform((value) => value.toUpperCase()).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "Informe ao menos um campo para atualizar.",
});


const coordinatesSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});
const quoteRequestSchema = z.object({
  origin: coordinatesSchema,
  destination: coordinatesSchema,
  category: z.literal("standard"),
  waypoints: z.array(coordinatesSchema).max(5).optional().default([]),
});
const createTripSchema = z.object({
  quoteId: z.string().trim().min(1).max(64),
  notes: z.string().max(500).optional(),
  paymentMethodId: z.string().max(100).optional(),
});
function estimateDirectDistanceMeters(origin: { latitude: number; longitude: number }, destination: { latitude: number; longitude: number }): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(destination.latitude - origin.latitude);
  const dLon = radians(destination.longitude - origin.longitude);
  const lat1 = radians(origin.latitude);
  const lat2 = radians(destination.latitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
function finiteEnv(name: string, fallback: number, minimum = 0): number {
  const parsed = Number(process.env[name] ?? fallback);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}
function estimateMvpFare(distanceMeters: number, durationSeconds: number) {
  const baseFareCents = finiteEnv("VIAE_FARE_BASE_CENTS", 500);
  const centsPerKm = finiteEnv("VIAE_FARE_PER_KM_CENTS", 250);
  const centsPerMinute = finiteEnv("VIAE_FARE_PER_MINUTE_CENTS", 30);
  const minimumFareCents = finiteEnv("VIAE_FARE_MINIMUM_CENTS", 1000);
  const distanceFareCents = Math.ceil(distanceMeters / 1000 * centsPerKm);
  const timeFareCents = Math.ceil(durationSeconds / 60 * centsPerMinute);
  return { baseFareCents, distanceFareCents, timeFareCents, feesCents: 0, discountCents: 0, totalCents: Math.max(minimumFareCents, baseFareCents + distanceFareCents + timeFareCents) };
}
function apiRideStatus(status: string): string {
  const statuses: Record<string, string> = { REQUESTED: "requested", ACCEPTED: "accepted", DRIVER_ARRIVING: "driver_arrived", IN_PROGRESS: "in_progress", COMPLETED: "completed", CANCELLED: "canceled" };
  return statuses[status] ?? "requested";
}

type JwtUser = { sub: string; role: "PASSENGER" | "DRIVER" | "ADMIN" };

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtUser;
    user: JwtUser;
  }
}

function publicUser(user: {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
  driverProfile?: {
    vehicleMake: string | null;
    vehicleModel: string | null;
    vehicleColor: string | null;
    vehiclePlate: string | null;
    approvalStatus: string;
    isOnline: boolean;
  } | null;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role.toLowerCase(),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    ...(user.role === "DRIVER"
      ? {
          driverProfile: user.driverProfile
            ? {
                vehicleMake: user.driverProfile.vehicleMake,
                vehicleModel: user.driverProfile.vehicleModel,
                vehicleColor: user.driverProfile.vehicleColor,
                vehiclePlate: user.driverProfile.vehiclePlate,
                approvalStatus: user.driverProfile.approvalStatus.toLowerCase(),
                isOnline: user.driverProfile.isOnline,
              }
            : null,
        }
      : {}),
  };
}

async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({ error: "Não autenticado. Entre novamente." });
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

app.get("/health", async () => ({
  status: "ok",
  service: "mobilidade-api",
  timestamp: new Date().toISOString(),
}));

app.get("/", async () => ({
  name: "Mobilidade API",
  version: "0.2.0",
  endpoints: {
    register: "POST /auth/register",
    login: "POST /auth/login",
    currentUser: "GET /me",
    updateProfile: "PATCH /me",
    driverProfile: "PATCH /profiles/driver",
  },
}));

app.post("/auth/register", {
  config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
}, async (request, reply) => {
  const parsed = registerSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      error: "Dados de cadastro inválidos.",
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const input = parsed.data;
  const passwordHash = await bcrypt.hash(input.password, 12);

  try {
    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        phone: input.phone,
        passwordHash,
        role: input.role === "driver" ? UserRole.DRIVER : UserRole.PASSENGER,
        ...(input.role === "driver" ? { driverProfile: { create: {} } } : {}),
      },
      include: { driverProfile: true },
    });

    const token = app.jwt.sign({ sub: user.id, role: user.role });
    return reply.code(201).send({ token, tokenType: "Bearer", user: publicUser(user) });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return reply.code(409).send({ error: "E-mail ou telefone já cadastrado." });
    }
    request.log.error(error);
    return reply.code(500).send({ error: "Não foi possível concluir o cadastro." });
  }
});

app.post("/auth/login", {
  config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
}, async (request, reply) => {
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      error: "Dados de login inválidos.",
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    include: { driverProfile: true },
  });

  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return reply.code(401).send({ error: "E-mail ou senha incorretos." });
  }

  const token = app.jwt.sign({ sub: user.id, role: user.role });
  return reply.send({ token, tokenType: "Bearer", user: publicUser(user) });
});

app.get("/me", { preHandler: requireAuth }, async (request, reply) => {
  const user = await prisma.user.findUnique({
    where: { id: request.user.sub },
    include: { driverProfile: true },
  });
  if (!user) return reply.code(404).send({ error: "Usuário não encontrado." });
  return reply.send({ user: publicUser(user) });
});

app.patch("/me", { preHandler: requireAuth }, async (request, reply) => {
  const parsed = updateProfileSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      error: "Dados de perfil inválidos.",
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  try {
    const user = await prisma.user.update({
      where: { id: request.user.sub },
      data: parsed.data,
      include: { driverProfile: true },
    });
    return reply.send({ user: publicUser(user) });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return reply.code(409).send({ error: "Este telefone já está cadastrado." });
    }
    request.log.error(error);
    return reply.code(500).send({ error: "Não foi possível atualizar o perfil." });
  }
});

app.patch("/profiles/driver", { preHandler: requireAuth }, async (request, reply) => {
  if (request.user.role !== "DRIVER") {
    return reply.code(403).send({ error: "Este recurso é exclusivo para motoristas." });
  }

  const parsed = updateDriverProfileSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      error: "Dados do perfil de motorista inválidos.",
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  try {
    const profile = await prisma.driverProfile.upsert({
      where: { userId: request.user.sub },
      create: { userId: request.user.sub, ...parsed.data },
      update: parsed.data,
    });
    return reply.send({
      driverProfile: {
        vehicleMake: profile.vehicleMake,
        vehicleModel: profile.vehicleModel,
        vehicleColor: profile.vehicleColor,
        vehiclePlate: profile.vehiclePlate,
        approvalStatus: profile.approvalStatus.toLowerCase(),
        isOnline: profile.isOnline,
        updatedAt: profile.updatedAt,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return reply.code(409).send({ error: "CPF, CNH ou placa já cadastrado." });
    }
    request.log.error(error);
    return reply.code(500).send({ error: "Não foi possível atualizar o perfil de motorista." });
  }
});


app.get("/api/v1/places/autocomplete", { preHandler: requireAuth }, async (request, reply) => {
  const parsed = z.object({ input: z.string().trim().min(2).max(200), latitude: z.coerce.number().min(-90).max(90).optional(), longitude: z.coerce.number().min(-180).max(180).optional() }).safeParse(request.query);
  if (!parsed.success) return reply.code(400).send({ error: "Parâmetros de pesquisa inválidos." });
  try { return reply.send({ data: await autocompleteGooglePlaces(parsed.data.input, parsed.data.latitude, parsed.data.longitude) }); }
  catch (error) { if (error instanceof Error && error.message === "GOOGLE_MAPS_NOT_CONFIGURED") return reply.code(503).send({ error: error.message }); request.log.warn({ err: error }, "Google Places request failed"); return reply.code(502).send({ error: "MAPS_PROVIDER_UNAVAILABLE" }); }
});
app.post("/api/v1/routes/estimate", { preHandler: requireAuth }, async (request, reply) => {
  const parsed = z.object({ origin: coordinatesSchema, destination: coordinatesSchema, waypoints: z.array(coordinatesSchema).max(5).optional().default([]) }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Dados da rota inválidos." });
  try { const data = await computeGoogleRoute(parsed.data.origin, parsed.data.destination, parsed.data.waypoints); if (!data) return reply.code(503).send({ error: "GOOGLE_MAPS_NOT_CONFIGURED" }); return reply.send({ data }); }
  catch (error) { request.log.warn({ err: error }, "Google Routes request failed"); return reply.code(502).send({ error: "MAPS_PROVIDER_UNAVAILABLE" }); }
});

/** MVP quote approximation only; Google Routes API is used when configured. */
app.post("/api/v1/quotes", { preHandler: requireAuth }, async (request, reply) => {
  if (request.user.role !== "PASSENGER") return reply.code(403).send({ error: "Somente passageiros podem solicitar cotações." });
  const parsed = quoteRequestSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Dados da cotação inválidos.", details: parsed.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })) });
  const { origin, destination, waypoints } = parsed.data;
  let route: { distanceMeters: number; durationSeconds: number; encodedPolyline?: string } | null = null;
  try { route = await computeGoogleRoute(origin, destination, waypoints); }
  catch (error) { request.log.warn({ err: error }, "Google Routes failed while generating quote"); return reply.code(502).send({ error: "MAPS_PROVIDER_UNAVAILABLE" }); }
  let distanceMeters: number;
  let durationSeconds: number;
  if (route) { distanceMeters = route.distanceMeters; durationSeconds = route.durationSeconds; }
  else {
    if (waypoints.length > 0) return reply.code(503).send({ error: "GOOGLE_MAPS_NOT_CONFIGURED" });
    const directDistanceMeters = estimateDirectDistanceMeters(origin, destination);
    const roadFactor = finiteEnv("VIAE_MVP_ROAD_DISTANCE_FACTOR", 1.3, 1);
    distanceMeters = Math.round(directDistanceMeters * roadFactor);
    const averageSpeedKmh = finiteEnv("VIAE_MVP_AVERAGE_SPEED_KMH", 25, 5);
    durationSeconds = Math.max(60, Math.ceil(distanceMeters / 1000 / averageSpeedKmh * 3600));
  }
  const fare = estimateMvpFare(distanceMeters, durationSeconds);
  const quote = await prisma.tripQuote.create({ data: {
    passengerId: request.user.sub,
    originLatitude: origin.latitude, originLongitude: origin.longitude,
    destinationLatitude: destination.latitude, destinationLongitude: destination.longitude,
    distanceMeters, durationSeconds, estimatedFareCents: fare.totalCents,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  }});
  return reply.send({ data: {
    quoteId: quote.id, currency: "BRL",
    estimatedDistanceMeters: quote.distanceMeters,
    estimatedDurationSeconds: quote.durationSeconds,
    estimatedFareCents: quote.estimatedFareCents,
    fareBreakdown: { baseFareCents: fare.baseFareCents, distanceFareCents: fare.distanceFareCents, timeFareCents: fare.timeFareCents, feesCents: 0, discountCents: 0 },
    fareSource: route ? "google_routes" : "mvp_straight_line_approximation",
    ...(route?.encodedPolyline ? { encodedPolyline: route.encodedPolyline } : {}),
    expiresAt: quote.expiresAt.toISOString(),
  }});
});

app.post("/api/v1/trips", { preHandler: requireAuth }, async (request, reply) => {
  if (request.user.role !== "PASSENGER") return reply.code(403).send({ error: "Somente passageiros podem solicitar corridas." });
  const parsed = createTripSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Dados da corrida inválidos.", details: parsed.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })) });
  const idempotencyKey = request.headers["idempotency-key"];
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 16 || idempotencyKey.length > 128) return reply.code(400).send({ error: "Informe Idempotency-Key com 16 a 128 caracteres." });

  const existing = await prisma.ride.findUnique({ where: { idempotencyKey } });
  if (existing) {
    if (existing.passengerId !== request.user.sub || existing.quoteId !== parsed.data.quoteId) return reply.code(409).send({ error: "IDEMPOTENCY_CONFLICT", message: "A chave já foi usada em outra solicitação." });
    return reply.code(200).send({ data: { tripId: existing.id, status: apiRideStatus(existing.status), estimatedFareCents: existing.estimatedFareCents, currency: "BRL", createdAt: existing.requestedAt.toISOString() } });
  }

  try {
    const ride = await prisma.$transaction(async (tx) => {
      const quote = await tx.tripQuote.findFirst({ where: { id: parsed.data.quoteId, passengerId: request.user.sub } });
      if (!quote) throw new Error("QUOTE_NOT_FOUND");
      if (quote.expiresAt <= new Date()) throw new Error("QUOTE_EXPIRED");
      const reserved = await tx.tripQuote.updateMany({ where: { id: quote.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (reserved.count !== 1) throw new Error("QUOTE_ALREADY_USED");
      return tx.ride.create({ data: {
        passengerId: request.user.sub, quoteId: quote.id, idempotencyKey,
        status: RideStatus.REQUESTED,
        originLatitude: quote.originLatitude, originLongitude: quote.originLongitude,
        destinationLatitude: quote.destinationLatitude, destinationLongitude: quote.destinationLongitude,
        estimatedFareCents: quote.estimatedFareCents,
      }});
    });
    return reply.code(201).send({ data: { tripId: ride.id, status: "requested", estimatedFareCents: ride.estimatedFareCents, currency: "BRL", createdAt: ride.requestedAt.toISOString() } });
  } catch (error) {
    if (error instanceof Error && ["QUOTE_NOT_FOUND", "QUOTE_EXPIRED", "QUOTE_ALREADY_USED"].includes(error.message)) {
      if (error.message === "QUOTE_ALREADY_USED") {
        const retry = await prisma.ride.findUnique({ where: { idempotencyKey } });
        if (retry && retry.passengerId === request.user.sub && retry.quoteId === parsed.data.quoteId) {
          return reply.code(200).send({ data: { tripId: retry.id, status: apiRideStatus(retry.status), estimatedFareCents: retry.estimatedFareCents, currency: "BRL", createdAt: retry.requestedAt.toISOString() } });
        }
      }
      return reply.code(error.message === "QUOTE_NOT_FOUND" ? 404 : 409).send({ error: error.message, message: "Não foi possível usar esta cotação." });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const retry = await prisma.ride.findUnique({ where: { idempotencyKey } });
      if (retry && retry.passengerId === request.user.sub && retry.quoteId === parsed.data.quoteId) return reply.code(200).send({ data: { tripId: retry.id, status: apiRideStatus(retry.status), estimatedFareCents: retry.estimatedFareCents, currency: "BRL", createdAt: retry.requestedAt.toISOString() } });
      return reply.code(409).send({ error: "IDEMPOTENCY_CONFLICT", message: "A chave já foi usada em outra solicitação." });
    }
    request.log.error(error);
    return reply.code(500).send({ error: "Não foi possível solicitar a corrida." });
  }
});

app.get("/api/v1/trips/:tripId", { preHandler: requireAuth }, async (request, reply) => {
  const params = z.object({ tripId: z.string().min(1).max(64) }).safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: "Identificador de corrida inválido." });
  const ride = await prisma.ride.findUnique({ where: { id: params.data.tripId } });
  if (!ride) return reply.code(404).send({ error: "Corrida não encontrada." });
  if (ride.passengerId !== request.user.sub && ride.driverId !== request.user.sub && request.user.role !== "ADMIN") return reply.code(403).send({ error: "Você não tem permissão para consultar esta corrida." });
  return reply.send({ data: { tripId: ride.id, status: apiRideStatus(ride.status), estimatedFareCents: ride.estimatedFareCents, finalFareCents: ride.finalFareCents, currency: "BRL", createdAt: ride.requestedAt.toISOString() } });
});

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  await prisma.$disconnect();
  process.exit(1);
}
