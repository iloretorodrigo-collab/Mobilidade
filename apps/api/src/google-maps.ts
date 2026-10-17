export type Coordinates = { latitude: number; longitude: number };

export type ComputedRoute = {
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline?: string;
};

const key = () => process.env.GOOGLE_MAPS_API_KEY;

export async function computeGoogleRoute(
  origin: Coordinates,
  destination: Coordinates,
  waypoints: Coordinates[] = [],
): Promise<ComputedRoute | null> {
  const apiKey = key();
  if (!apiKey) return null;

  const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
    },
    body: JSON.stringify({
      origin: { location: { latLng: origin } },
      destination: { location: { latLng: destination } },
      intermediates: waypoints.map((point) => ({ location: { latLng: point } })),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      languageCode: "pt-BR",
      units: "METRIC",
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("GOOGLE_ROUTES_PROVIDER_ERROR");
  const payload = await response.json() as {
    routes?: Array<{ distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string } }>;
  };
  const route = payload.routes?.[0];
  if (!route || !Number.isFinite(route.distanceMeters) || !route.duration) {
    throw new Error("GOOGLE_ROUTES_NO_ROUTE");
  }
  const durationSeconds = Number.parseInt(route.duration.replace(/s$/, ""), 10);
  if (!Number.isFinite(durationSeconds)) throw new Error("GOOGLE_ROUTES_INVALID_DURATION");
  return {
    distanceMeters: route.distanceMeters as number,
    durationSeconds,
    encodedPolyline: route.polyline?.encodedPolyline,
  };
}

export async function autocompleteGooglePlaces(input: string, latitude?: number, longitude?: number) {
  const apiKey = key();
  if (!apiKey) throw new Error("GOOGLE_MAPS_NOT_CONFIGURED");
  const body: Record<string, unknown> = { input, languageCode: "pt-BR", regionCode: "BR" };
  if (latitude !== undefined && longitude !== undefined) {
    body.locationBias = { circle: { center: { latitude, longitude }, radius: 25000 } };
  }
  const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("GOOGLE_PLACES_PROVIDER_ERROR");
  const payload = await response.json() as {
    suggestions?: Array<{ placePrediction?: { placeId?: string; text?: { text?: string } } }>;
  };
  return (payload.suggestions ?? []).flatMap((item) => {
    const prediction = item.placePrediction;
    return prediction?.placeId && prediction.text?.text
      ? [{ placeId: prediction.placeId, description: prediction.text.text }]
      : [];
  });
}
