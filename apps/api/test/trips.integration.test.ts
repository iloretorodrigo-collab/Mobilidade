import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { io as socketClient, type Socket } from "socket.io-client";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "integration-test-secret-at-least-32-characters";

let app: typeof import("../src/server.js")["app"];
let prisma: typeof import("../src/server.js")["prisma"];
let baseUrl = "";
let passengerId = "";
let passengerToken = "";
let driverIds: string[] = [];
let driverTokens: string[] = [];
let tripId = "";
const tripIds: string[] = [];
let passengerSocket: Socket | undefined;
let driverSocket: Socket | undefined;

before(async () => {
  ({ app, prisma } = await import("../src/server.js"));
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("API test server did not bind to a TCP port");
  baseUrl = "http://127.0.0.1:" + address.port;

  const passenger = await prisma.user.create({
    data: { name: "Integration Passenger", email: "passenger-" + Date.now() + "@test.invalid", passwordHash: "not-used", role: "PASSENGER" },
  });
  passengerId = passenger.id;
  passengerToken = app.jwt.sign({ sub: passenger.id, role: passenger.role });

  for (let index = 0; index < 2; index += 1) {
    const driver = await prisma.user.create({
      data: {
        name: "Integration Driver " + index,
        email: "driver-" + index + "-" + Date.now() + "@test.invalid",
        passwordHash: "not-used",
        role: "DRIVER",
        driverProfile: { create: { approvalStatus: "APPROVED", isOnline: true } },
      },
    });
    driverIds.push(driver.id);
    driverTokens.push(app.jwt.sign({ sub: driver.id, role: driver.role }));
  }
});

after(async () => {
  passengerSocket?.disconnect();
  driverSocket?.disconnect();
  if (tripIds.length) await prisma.ride.deleteMany({ where: { id: { in: tripIds } } });
  if (passengerId) {
    await prisma.tripQuote.deleteMany({ where: { passengerId } });
    await prisma.user.deleteMany({ where: { id: passengerId } });
  }
  if (driverIds.length) await prisma.user.deleteMany({ where: { id: { in: driverIds } } });
  await app.close();
  await prisma.$disconnect();
});

test("cotação → solicitação idempotente → consulta → aceite único → WebSocket", async () => {
  const headers = { authorization: "Bearer " + passengerToken, "content-type": "application/json" };
  const quoteResponse = await app.inject({
    method: "POST",
    url: "/api/v1/quotes",
    headers,
    payload: {
      origin: { latitude: -30.0346, longitude: -51.2177 },
      destination: { latitude: -30.0277, longitude: -51.2287 },
      category: "standard",
    },
  });
  assert.equal(quoteResponse.statusCode, 200, quoteResponse.body);
  const quote = quoteResponse.json().data;
  assert.ok(quote.quoteId);
  assert.ok(quote.estimatedFareCents > 0);

  const idempotencyKey = "integration-key-" + Date.now();
  const tripResponse = await app.inject({
    method: "POST",
    url: "/api/v1/trips",
    headers: { ...headers, "idempotency-key": idempotencyKey },
    payload: { quoteId: quote.quoteId },
  });
  assert.equal(tripResponse.statusCode, 201, tripResponse.body);
  tripId = tripResponse.json().data.tripId;
  tripIds.push(tripId);

  const duplicateResponse = await app.inject({
    method: "POST",
    url: "/api/v1/trips",
    headers: { ...headers, "idempotency-key": idempotencyKey },
    payload: { quoteId: quote.quoteId },
  });
  assert.equal(duplicateResponse.statusCode, 200, duplicateResponse.body);
  assert.equal(duplicateResponse.json().data.tripId, tripId);

  const getResponse = await app.inject({ method: "GET", url: "/api/v1/trips/" + tripId, headers });
  assert.equal(getResponse.statusCode, 200, getResponse.body);
  assert.equal(getResponse.json().data.status, "requested");

  const offers = await prisma.driverOffer.findMany({ where: { rideId: tripId }, orderBy: { createdAt: "asc" } });
  assert.equal(offers.length, 2);
  const acceptResults = await Promise.all(driverTokens.map((token, index) => app.inject({
    method: "POST",
    url: "/api/v1/trips/" + tripId + "/accept",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    payload: { offerId: offers.find((offer) => offer.driverId === driverIds[index])?.id },
  })));
  assert.equal(acceptResults.filter((response) => response.statusCode === 200).length, 1);
  assert.equal(acceptResults.filter((response) => response.statusCode === 409).length, 1);

  const winningIndex = acceptResults.findIndex((response) => response.statusCode === 200);
  const winningToken = driverTokens[winningIndex];
  passengerSocket = socketClient(baseUrl, { path: "/realtime/socket.io", auth: { token: passengerToken } });
  driverSocket = socketClient(baseUrl, { path: "/realtime/socket.io", auth: { token: winningToken } });
  await Promise.all([
    new Promise<void>((resolve, reject) => { passengerSocket?.once("connect", resolve); passengerSocket?.once("connect_error", reject); }),
    new Promise<void>((resolve, reject) => { driverSocket?.once("connect", resolve); driverSocket?.once("connect_error", reject); }),
  ]);
  const subscribe = (socket: Socket) => new Promise<void>((resolve, reject) => {
    socket.emit("trip.subscribe", { tripId }, (result: { ok?: boolean; error?: string }) => result?.ok ? resolve() : reject(new Error(result?.error ?? "subscribe failed")));
  });
  await Promise.all([subscribe(passengerSocket), subscribe(driverSocket)]);
  const locationEvent = new Promise<{ data: { tripId: string; latitude: number } }>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("WebSocket location event timeout")), 3000);
    passengerSocket?.once("trip.driver_location", (event) => { clearTimeout(timeout); resolve(event); });
  });
  driverSocket.emit("driver.location_update", { tripId, latitude: -30.03, longitude: -51.22, sequence: 1 }, (result: { ok?: boolean }) => {
    if (!result?.ok) throw new Error("driver location update was rejected");
  });
  const event = await locationEvent;
  assert.equal(event.data.tripId, tripId);
  assert.equal(event.data.latitude, -30.03);

  const startResponse = await app.inject({
    method: "POST",
    url: "/api/v1/trips/" + tripId + "/start",
    headers: { authorization: "Bearer " + winningToken, "content-type": "application/json" },
    payload: {},
  });
  assert.equal(startResponse.statusCode, 200, startResponse.body);
  assert.equal(startResponse.json().data.status, "in_progress");

  const completeResponse = await app.inject({
    method: "POST",
    url: "/api/v1/trips/" + tripId + "/complete",
    headers: { authorization: "Bearer " + winningToken, "content-type": "application/json" },
    payload: {},
  });
  assert.equal(completeResponse.statusCode, 200, completeResponse.body);
  assert.equal(completeResponse.json().data.status, "completed");
  assert.ok(completeResponse.json().data.finalFareCents > 0);

  const cancelQuoteResponse = await app.inject({
    method: "POST",
    url: "/api/v1/quotes",
    headers,
    payload: {
      origin: { latitude: -30.0346, longitude: -51.2177 },
      destination: { latitude: -30.02, longitude: -51.21 },
      category: "standard",
    },
  });
  assert.equal(cancelQuoteResponse.statusCode, 200, cancelQuoteResponse.body);
  const cancelTripResponse = await app.inject({
    method: "POST",
    url: "/api/v1/trips",
    headers: { ...headers, "idempotency-key": "cancel-integration-" + Date.now() },
    payload: { quoteId: cancelQuoteResponse.json().data.quoteId },
  });
  assert.equal(cancelTripResponse.statusCode, 201, cancelTripResponse.body);
  const cancelTripId = cancelTripResponse.json().data.tripId as string;
  tripIds.push(cancelTripId);

  const cancelResponse = await app.inject({
    method: "POST",
    url: "/api/v1/trips/" + cancelTripId + "/cancel",
    headers,
    payload: { reason: "integration test" },
  });
  assert.equal(cancelResponse.statusCode, 200, cancelResponse.body);
  assert.equal(cancelResponse.json().data.status, "canceled");

  const persistedEvents = await prisma.outboxEvent.findMany({ where: { aggregateType: "Ride", aggregateId: tripId } });
  assert.equal(persistedEvents.length, 3);
  assert.deepEqual(persistedEvents.map((item) => item.eventType), ["trip.status_changed", "trip.status_changed"]);
});
