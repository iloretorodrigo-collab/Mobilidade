import { test } from "node:test";
import assert from "node:assert/strict";

const base = process.env.API_URL ?? "http://127.0.0.1:3333";
const suffix = Date.now().toString();
const passengerEmail = "passenger-" + suffix + "@example.test";
const driverEmail = "driver-" + suffix + "@example.test";
const adminEmail = process.env.ADMIN_EMAIL ?? "admin@example.test";
const adminPassword = process.env.ADMIN_PASSWORD ?? "LocalAdminPassword123!";

async function api(path: string, method = "GET", body?: unknown, token?: string) {
  const response = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json() as Record<string, any>;
  return { status: response.status, data };
}

test("auth lifecycle, contact verification, password reset and driver approval", async () => {
  assert.equal((await api("/health")).status, 200);
  const registered = await api("/auth/register", "POST", {
    name: "Passageiro Teste", email: passengerEmail, phone: "+1555" + suffix.slice(-7), password: "PassageiroSenha123!", role: "passenger",
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.data));
  const passengerToken = registered.data.token as string;
  assert.equal(registered.data.user.role, "passenger");

  const login = await api("/auth/login", "POST", { email: passengerEmail, password: "PassageiroSenha123!" });
  assert.equal(login.status, 200);
  assert.ok(login.data.token);

  const me = await api("/me", "GET", undefined, passengerToken);
  assert.equal(me.status, 200);
  assert.equal(me.data.user.email, passengerEmail);

  const updated = await api("/me", "PATCH", { name: "Passageiro Atualizado" }, passengerToken);
  assert.equal(updated.status, 200);
  assert.equal(updated.data.user.name, "Passageiro Atualizado");

  const verifyRequest = await api("/auth/verification/email", "POST", {}, passengerToken);
  assert.equal(verifyRequest.status, 200, JSON.stringify(verifyRequest.data));
  assert.ok(verifyRequest.data.developmentCode);
  const verified = await api("/auth/verification/confirm", "POST", { channel: "email", code: verifyRequest.data.developmentCode }, passengerToken);
  assert.equal(verified.status, 200);

  const phoneRequest = await api("/auth/verification/phone", "POST", {}, passengerToken);
  assert.equal(phoneRequest.status, 200, JSON.stringify(phoneRequest.data));
  assert.ok(phoneRequest.data.developmentCode);
  const phoneVerified = await api("/auth/verification/confirm", "POST", { channel: "phone", code: phoneRequest.data.developmentCode }, passengerToken);
  assert.equal(phoneVerified.status, 200);

  const forgot = await api("/auth/password/forgot", "POST", { email: passengerEmail });
  assert.equal(forgot.status, 200);
  assert.ok(forgot.data.developmentCode);
  const reset = await api("/auth/password/reset", "POST", { email: passengerEmail, code: forgot.data.developmentCode, newPassword: "NovaSenhaSegura123!" });
  assert.equal(reset.status, 200);
  assert.equal((await api("/auth/login", "POST", { email: passengerEmail, password: "NovaSenhaSegura123!" })).status, 200);

  const driver = await api("/auth/register", "POST", {
    name: "Motorista Teste", email: driverEmail, phone: "+1666" + suffix.slice(-7), password: "MotoristaSenha123!", role: "driver",
  });
  assert.equal(driver.status, 201, JSON.stringify(driver.data));
  assert.equal(driver.data.user.driverProfile.approvalStatus, "pending");

  const adminLogin = await api("/auth/login", "POST", { email: adminEmail, password: adminPassword });
  assert.equal(adminLogin.status, 200, "Seed admin before integration tests");
  const adminToken = adminLogin.data.token as string;
  const pending = await api("/admin/drivers/pending", "GET", undefined, adminToken);
  assert.equal(pending.status, 200);
  assert.ok(pending.data.drivers.some((d: { userId: string }) => d.userId === driver.data.user.id));

  const approved = await api("/admin/drivers/" + driver.data.user.id + "/approval", "PATCH", { status: "approved" }, adminToken);
  assert.equal(approved.status, 200);
  assert.equal(approved.data.approvalStatus, "approved");

  const forbidden = await api("/admin/drivers/pending", "GET", undefined, passengerToken);
  assert.equal(forbidden.status, 403);
});
