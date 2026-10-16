import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) {
    throw new Error("Defina ADMIN_EMAIL e ADMIN_PASSWORD (mínimo 12 caracteres).");
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { email },
    update: { role: UserRole.ADMIN, passwordHash },
    create: { name: "Administrador Mobilidade", email, passwordHash, role: UserRole.ADMIN, emailVerified: true },
  });
  console.log("Administrador configurado:", email);
}

main().finally(async () => prisma.$disconnect());
