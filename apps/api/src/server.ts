import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { createHmac, randomInt } from "node:crypto";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { Prisma, PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";

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
  emailVerified?: boolean;
  phoneVerified?: boolean;
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
    emailVerified: user.emailVerified ?? false,
    phoneVerified: user.phoneVerified ?? false,
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


const routeEstimateSchema = z.object({
  origin: z.string().trim().min(3).max(180),
  destination: z.string().trim().min(3).max(180),
});

type GeoPoint = { latitude: number; longitude: number; label: string };

async function geocodeAddress(address: string): Promise<GeoPoint | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", address);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  const response = await fetch(url, {
    headers: { "User-Agent": "MobilidadeApp/1.0 (route-estimation)" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("O serviço de endereços está indisponível.");
  const results = await response.json() as Array<{ lat: string; lon: string; display_name: string }>;
  const first = results[0];
  if (!first) return null;
  return { latitude: Number(first.lat), longitude: Number(first.lon), label: first.display_name };
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

app.get("/mobility/geocode", {
  config: { rateLimit: { max: 20, timeWindow: "15 minutes" } },
}, async (request, reply) => {
  const parsed = z.object({ query: z.string().trim().min(3).max(180) }).safeParse(request.query);
  if (!parsed.success) return reply.code(400).send({ error: "Informe um endereço com pelo menos 3 caracteres." });
  try {
    const point = await geocodeAddress(parsed.data.query);
    if (!point) return reply.code(404).send({ error: "Endereço não encontrado. Tente incluir cidade e estado." });
    return reply.send({ point });
  } catch (error) {
    request.log.warn({ err: error }, "Falha ao consultar geocodificação");
    return reply.code(502).send({ error: "Não foi possível localizar o endereço agora. Tente novamente." });
  }
});

app.post("/mobility/estimate", {
  config: { rateLimit: { max: 20, timeWindow: "15 minutes" } },
}, async (request, reply) => {
  const parsed = routeEstimateSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({
    error: "Informe origem e destino válidos.",
    details: parsed.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })),
  });

  try {
    const origin = await geocodeAddress(parsed.data.origin);
    await wait(1100);
    const destination = await geocodeAddress(parsed.data.destination);
    if (!origin || !destination) {
      return reply.code(404).send({ error: "Não encontramos a origem ou o destino. Inclua cidade e estado nos endereços." });
    }

    const routeUrl = new URL(`https://router.project-osrm.org/route/v1/driving/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`);
    routeUrl.searchParams.set("overview", "full");
    routeUrl.searchParams.set("geometries", "geojson");
    routeUrl.searchParams.set("alternatives", "false");
    routeUrl.searchParams.set("steps", "false");
    const response = await fetch(routeUrl, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("O serviço de rotas está indisponível.");
    const routeData = await response.json() as {
      code: string;
      routes?: Array<{ distance: number; duration: number; geometry?: { coordinates: [number, number][] } }>;
    };
    const route = routeData.routes?.[0];
    if (routeData.code !== "Ok" || !route) {
      return reply.code(422).send({ error: "Não foi possível calcular uma rota de carro entre esses endereços." });
    }

    const distanceKm = route.distance / 1000;
    const durationMinutes = route.duration / 60;
    const baseCents = Math.max(0, Number(process.env.MOBILIDADE_FARE_BASE_CENTS ?? 500));
    const perKmCents = Math.max(0, Number(process.env.MOBILIDADE_FARE_PER_KM_CENTS ?? 220));
    const perMinuteCents = Math.max(0, Number(process.env.MOBILIDADE_FARE_PER_MINUTE_CENTS ?? 35));
    const minimumCents = Math.max(0, Number(process.env.MOBILIDADE_FARE_MINIMUM_CENTS ?? 800));
    const estimatedFareCents = Math.round(Math.max(minimumCents, baseCents + distanceKm * perKmCents + durationMinutes * perMinuteCents));
    const mapUrl = "https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=" +
      encodeURIComponent(`${origin.latitude},${origin.longitude};${destination.latitude},${destination.longitude}`);

    return reply.send({
      origin,
      destination,
      distanceKm: Number(distanceKm.toFixed(2)),
      durationMinutes: Math.max(1, Math.round(durationMinutes)),
      routeCoordinates: route.geometry?.coordinates ?? [],
      estimatedFareCents,
      estimatedFare: Number((estimatedFareCents / 100).toFixed(2)),
      currency: "BRL",
      pricing: {
        baseCents, perKmCents, perMinuteCents, minimumCents,
        note: "Estimativa inicial; o valor final pode variar com trânsito, espera, demanda e ajustes comerciais.",
      },
      mapUrl,
      provider: { geocoding: "OpenStreetMap Nominatim", routing: "OSRM" },
    });
  } catch (error) {
    request.log.warn({ err: error }, "Falha ao estimar rota");
    return reply.code(502).send({ error: "O serviço de mapas está temporariamente indisponível. Tente novamente." });
  }
});

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
    forgotPassword: "POST /auth/password/forgot",
    resetPassword: "POST /auth/password/reset",
    verifyEmail: "POST /auth/verification/email",
    verifyPhone: "POST /auth/verification/phone",
    confirmVerification: "POST /auth/verification/confirm",
    pendingDrivers: "GET /admin/drivers/pending",
    updateProfile: "PATCH /me",
    driverProfile: "PATCH /profiles/driver",
    geocode: "GET /mobility/geocode?query=...",
    estimateRoute: "POST /mobility/estimate",
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


const sixDigitCode = z.string().regex(/^\d{6}$/);
const digestCode = (code: string) => createHmac("sha256", jwtSecret).update(code).digest("hex");

async function sendChallenge(channel: "EMAIL" | "PHONE", destination: string, code: string, purpose: string) {
  const bodyText = purpose === "RESET_PASSWORD"
    ? "Seu código para redefinir a senha Mobilidade é " + code + ". Ele expira em 10 minutos."
    : "Seu código de verificação Mobilidade é " + code + ". Ele expira em 10 minutos.";
  if (channel === "EMAIL" && process.env.RESEND_API_KEY && process.env.EMAIL_FROM) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [destination], subject: "Seu código Mobilidade", text: bodyText }),
    });
    if (!response.ok) throw new Error("Falha no provedor de e-mail.");
    return;
  }
  if (channel === "PHONE" && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const payload = new URLSearchParams({ To: destination, From: process.env.TWILIO_FROM, Body: bodyText });
    const response = await fetch("https://api.twilio.com/2010-04-01/Accounts/" + sid + "/Messages.json", {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(sid + ":" + process.env.TWILIO_AUTH_TOKEN).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: payload,
    });
    if (!response.ok) throw new Error("Falha no provedor de SMS.");
    return;
  }
  if (process.env.NODE_ENV !== "production") {
    app.log.info({ channel, destination, code, purpose }, "Código de verificação apenas para desenvolvimento");
    return;
  }
  throw new Error("Provedor de entrega não configurado.");
}

async function issueChallenge(userId: string, channel: "EMAIL" | "PHONE", purpose: "VERIFY_EMAIL" | "VERIFY_PHONE" | "RESET_PASSWORD", destination: string) {
  const code = String(randomInt(0, 1000000)).padStart(6, "0");
  await prisma.verificationChallenge.updateMany({
    where: { userId, channel, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  await prisma.verificationChallenge.create({
    data: { userId, channel, purpose, codeHash: digestCode(code), expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
  });
  await sendChallenge(channel, destination, code, purpose);
  return code;
}

app.post("/auth/password/forgot", { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } }, async (request, reply) => {
  const parsed = z.object({ email: z.string().trim().email().transform(v => v.toLowerCase()) }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Informe um e-mail válido." });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (user) {
    try {
      const code = await issueChallenge(user.id, "EMAIL", "RESET_PASSWORD", user.email);
      if (process.env.NODE_ENV !== "production" && !process.env.RESEND_API_KEY) {
        return reply.send({ message: "Se a conta existir, um código foi gerado.", developmentCode: code });
      }
    } catch (error) {
      request.log.error(error);
    }
  }
  return reply.send({ message: "Se a conta existir, você receberá instruções para redefinir a senha." });
});

app.post("/auth/password/reset", { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } }, async (request, reply) => {
  const parsed = z.object({
    email: z.string().trim().email().transform(v => v.toLowerCase()),
    code: sixDigitCode,
    newPassword: z.string().min(8).max(72),
  }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos. Código de 6 dígitos e senha de ao menos 8 caracteres." });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user) return reply.code(400).send({ error: "Código inválido ou expirado." });
  const challenge = await prisma.verificationChallenge.findFirst({
    where: { userId: user.id, channel: "EMAIL", purpose: "RESET_PASSWORD", consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge || challenge.attempts >= 5 || challenge.codeHash !== digestCode(parsed.data.code)) {
    if (challenge) await prisma.verificationChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    return reply.code(400).send({ error: "Código inválido ou expirado." });
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, 12) } }),
    prisma.verificationChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } }),
    prisma.verificationChallenge.updateMany({ where: { userId: user.id, purpose: "RESET_PASSWORD", consumedAt: null }, data: { consumedAt: new Date() } }),
  ]);
  return reply.send({ message: "Senha redefinida. Entre com a nova senha." });
});

app.post("/auth/verification/email", { preHandler: requireAuth, config: { rateLimit: { max: 3, timeWindow: "15 minutes" } } }, async (request, reply) => {
  const user = await prisma.user.findUnique({ where: { id: request.user.sub } });
  if (!user) return reply.code(404).send({ error: "Usuário não encontrado." });
  try {
    const code = await issueChallenge(user.id, "EMAIL", "VERIFY_EMAIL", user.email);
    return reply.send({ message: "Código de verificação enviado.", ...(process.env.NODE_ENV !== "production" && !process.env.RESEND_API_KEY ? { developmentCode: code } : {}) });
  } catch (error) {
    request.log.error(error);
    return reply.code(503).send({ error: "Não foi possível enviar o e-mail de verificação." });
  }
});

app.post("/auth/verification/phone", { preHandler: requireAuth, config: { rateLimit: { max: 3, timeWindow: "15 minutes" } } }, async (request, reply) => {
  const user = await prisma.user.findUnique({ where: { id: request.user.sub } });
  if (!user?.phone) return reply.code(400).send({ error: "Cadastre um telefone antes de verificar." });
  try {
    const code = await issueChallenge(user.id, "PHONE", "VERIFY_PHONE", user.phone);
    return reply.send({ message: "Código de verificação enviado.", ...(process.env.NODE_ENV !== "production" && !process.env.TWILIO_ACCOUNT_SID ? { developmentCode: code } : {}) });
  } catch (error) {
    request.log.error(error);
    return reply.code(503).send({ error: "Não foi possível enviar o SMS." });
  }
});

app.post("/auth/verification/confirm", { preHandler: requireAuth }, async (request, reply) => {
  const parsed = z.object({ channel: z.enum(["email", "phone"]), code: sixDigitCode }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Informe canal e código de 6 dígitos." });
  const channel = parsed.data.channel === "email" ? "EMAIL" : "PHONE";
  const purpose = channel === "EMAIL" ? "VERIFY_EMAIL" : "VERIFY_PHONE";
  const challenge = await prisma.verificationChallenge.findFirst({
    where: { userId: request.user.sub, channel, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge || challenge.attempts >= 5 || challenge.codeHash !== digestCode(parsed.data.code)) {
    if (challenge) await prisma.verificationChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    return reply.code(400).send({ error: "Código inválido ou expirado." });
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: request.user.sub }, data: channel === "EMAIL" ? { emailVerified: true } : { phoneVerified: true } }),
    prisma.verificationChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } }),
  ]);
  return reply.send({ message: "Contato verificado com sucesso." });
});

async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  await requireAuth(request, reply);
  if (reply.sent) return;
  if (request.user.role !== "ADMIN") return reply.code(403).send({ error: "Acesso exclusivo para administradores." });
}

app.get("/admin/drivers/pending", { preHandler: requireAdmin }, async (_request, reply) => {
  const drivers = await prisma.driverProfile.findMany({
    where: { approvalStatus: "PENDING" }, include: { user: true }, orderBy: { createdAt: "asc" },
  });
  return reply.send({ drivers: drivers.map(d => ({
    userId: d.userId, name: d.user.name, email: d.user.email, phone: d.user.phone,
    emailVerified: d.user.emailVerified, phoneVerified: d.user.phoneVerified,
    cpf: d.cpf, licenseNumber: d.licenseNumber, vehicleMake: d.vehicleMake,
    vehicleModel: d.vehicleModel, vehicleColor: d.vehicleColor, vehiclePlate: d.vehiclePlate,
    submittedAt: d.createdAt,
  })) });
});

app.patch("/admin/drivers/:userId/approval", { preHandler: requireAdmin }, async (request, reply) => {
  const params = z.object({ userId: z.string().min(1) }).safeParse(request.params);
  const body = z.object({ status: z.enum(["approved", "rejected"]), reason: z.string().trim().max(500).optional() }).safeParse(request.body);
  if (!params.success || !body.success) return reply.code(400).send({ error: "Informe motorista e status approved ou rejected." });
  const profile = await prisma.driverProfile.findUnique({ where: { userId: params.data.userId } });
  if (!profile) return reply.code(404).send({ error: "Perfil de motorista não encontrado." });
  const status = body.data.status === "approved" ? "APPROVED" : "REJECTED";
  const [updated] = await prisma.$transaction([
    prisma.driverProfile.update({
      where: { userId: params.data.userId },
      data: { approvalStatus: status, isOnline: false },
    }),
    prisma.driverApprovalDecision.create({
      data: { adminUserId: request.user.sub, driverUserId: params.data.userId, status, reason: body.data.reason },
    }),
  ]);
  return reply.send({ userId: updated.userId, approvalStatus: updated.approvalStatus.toLowerCase() });
});

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  await prisma.$disconnect();
  process.exit(1);
}
