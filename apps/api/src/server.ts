import Fastify from "fastify";
import cors from "@fastify/cors";

const app = Fastify({ logger: true });
const port = Number(process.env.API_PORT ?? 3333);
const host = process.env.HOST ?? "0.0.0.0";

await app.register(cors, {
  origin: process.env.CORS_ORIGIN?.split(",") ?? true,
});

app.get("/health", async () => ({
  status: "ok",
  service: "mobilidade-api",
  timestamp: new Date().toISOString(),
}));

app.get("/", async () => ({
  name: "Mobilidade API",
  version: "0.1.0",
  docs: "API documentation will be added as endpoints are implemented.",
}));

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
