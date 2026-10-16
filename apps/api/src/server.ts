import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
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

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  await prisma.$disconnect();
  process.exit(1);
}
