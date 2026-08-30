import { describe, expect, it } from "@jest/globals";

import { GeographicLookupError, NominatimGeocoder } from "../src/registration/geocoder.js";

describe("NominatimGeocoder", () => {
  it("normalizes countries to ISO codes and caches repeated queries", async () => {
    const requestedUrls: URL[] = [];
    const geocoder = new NominatimGeocoder({
      baseUrl: "https://geocoder.example/",
      userAgent: "test-agent",
      fetchImplementation: async (input) => {
        requestedUrls.push(new URL(String(input)));
        return jsonResponse([
          { address: { country_code: "ru" } },
          { address: { country_code: "ru" } },
        ]);
      },
    });

    await expect(geocoder.findCountries("Россия")).resolves.toEqual([
      { kind: "country", country: "Россия", countryCode: "RU", label: "Россия" },
    ]);
    await geocoder.findCountries("Россия");

    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]?.pathname).toBe("/search");
    expect(requestedUrls[0]?.searchParams.get("featureType")).toBe("country");
  });

  it("returns only cities belonging to the selected country", async () => {
    const requestedUrls: URL[] = [];
    const geocoder = new NominatimGeocoder({
      baseUrl: "https://geocoder.example/",
      userAgent: "test-agent",
      fetchImplementation: async (input) => {
        requestedUrls.push(new URL(String(input)));
        return jsonResponse([
          {
            name: "Москва",
            osm_id: 2555133,
            osm_type: "relation",
            address: { city: "Москва", country_code: "ru" },
          },
          {
            name: "Moscow",
            osm_id: 224922,
            osm_type: "relation",
            address: { city: "Moscow", country_code: "us" },
          },
        ]);
      },
    });

    await expect(geocoder.findCities("Москва", "RU")).resolves.toEqual([
      {
        kind: "city",
        city: "Москва",
        country: "Россия",
        countryCode: "RU",
        cityOsmType: "relation",
        cityOsmId: "2555133",
        label: "Москва, Россия",
      },
    ]);

    expect(requestedUrls[0]?.searchParams.get("countrycodes")).toBe("ru");
    expect(requestedUrls[0]?.searchParams.get("featureType")).toBe("city");
  });

  it("reports unavailable geocoder instead of accepting arbitrary input", async () => {
    const geocoder = new NominatimGeocoder({
      baseUrl: "https://geocoder.example/",
      userAgent: "test-agent",
      fetchImplementation: async () => new Response("unavailable", { status: 503 }),
    });

    await expect(geocoder.findCountries("Россия")).rejects.toBeInstanceOf(GeographicLookupError);
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
