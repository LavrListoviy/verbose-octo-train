const NOMINATIM_REQUEST_INTERVAL_MS = 1_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const CACHE_MAX_ENTRIES = 256;

type FetchImplementation = typeof fetch;

interface NominatimResult {
  osm_id?: number | string;
  osm_type?: string;
  name?: string;
  address?: {
    city?: string;
    country_code?: string;
  };
}

export interface CountryCandidate {
  kind: "country";
  country: string;
  countryCode: string;
  label: string;
}

export interface CityCandidate {
  kind: "city";
  city: string;
  country: string;
  countryCode: string;
  cityOsmId: string;
  cityOsmType: "node" | "relation" | "way";
  label: string;
}

export type GeographicCandidate = CountryCandidate | CityCandidate;

interface CachedValue<T> {
  expiresAt: number;
  value: T;
}

export class GeographicLookupError extends Error {
  public constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "GeographicLookupError";
  }
}

export class NominatimGeocoder {
  private readonly cache = new Map<string, CachedValue<NominatimResult[]>>();
  private requestQueue: Promise<void> = Promise.resolve();
  private nextRequestAt = 0;

  public constructor(
    private readonly options: {
      baseUrl: string;
      userAgent: string;
      fetchImplementation?: FetchImplementation;
    },
  ) {}

  public async findCountries(query: string): Promise<CountryCandidate[]> {
    const results = await this.search(`country:${query}`, {
      q: query,
      featureType: "country",
      limit: "5",
    });

    const candidates = new Map<string, CountryCandidate>();
    for (const result of results) {
      const countryCode = toCountryCode(result.address?.country_code);
      if (!countryCode) continue;

      const country = countryName(countryCode);
      candidates.set(countryCode, {
        kind: "country",
        country,
        countryCode,
        label: country,
      });
    }
    return [...candidates.values()];
  }

  public async findCities(query: string, countryCode: string): Promise<CityCandidate[]> {
    const normalizedCountryCode = toCountryCode(countryCode);
    if (!normalizedCountryCode) throw new GeographicLookupError("Invalid country code");

    const results = await this.search(`city:${normalizedCountryCode}:${query}`, {
      city: query,
      countrycodes: normalizedCountryCode.toLowerCase(),
      featureType: "city",
      limit: "5",
    });

    const candidates = new Map<string, CityCandidate>();
    for (const result of results) {
      const resultCountryCode = toCountryCode(result.address?.country_code);
      const cityOsmType = toOsmType(result.osm_type);
      const cityOsmId = result.osm_id ? String(result.osm_id) : undefined;
      const city = normalizeName(result.address?.city ?? result.name);
      if (
        resultCountryCode !== normalizedCountryCode ||
        !city ||
        !cityOsmType ||
        !cityOsmId
      ) {
        continue;
      }

      const country = countryName(normalizedCountryCode);
      const key = `${cityOsmType}:${cityOsmId}`;
      candidates.set(key, {
        kind: "city",
        city,
        country,
        countryCode: normalizedCountryCode,
        cityOsmType,
        cityOsmId,
        label: `${city}, ${country}`,
      });
    }
    return [...candidates.values()];
  }

  private async search(
    cacheKey: string,
    parameters: Record<string, string>,
  ): Promise<NominatimResult[]> {
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const result = await this.enqueueRequest(parameters);
    this.cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value: result });
    if (this.cache.size > CACHE_MAX_ENTRIES) {
      this.cache.delete(this.cache.keys().next().value ?? cacheKey);
    }
    return result;
  }

  private async enqueueRequest(parameters: Record<string, string>): Promise<NominatimResult[]> {
    let releaseQueue: () => void = () => undefined;
    const previousRequest = this.requestQueue;
    this.requestQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });

    await previousRequest;
    try {
      const delay = this.nextRequestAt - Date.now();
      if (delay > 0) await sleep(delay);
      this.nextRequestAt = Date.now() + NOMINATIM_REQUEST_INTERVAL_MS;

      const url = new URL("search", this.options.baseUrl);
      url.search = new URLSearchParams({
        ...parameters,
        format: "jsonv2",
        addressdetails: "1",
        "accept-language": "ru",
      }).toString();

      const response = await (this.options.fetchImplementation ?? fetch)(url, {
        headers: { "User-Agent": this.options.userAgent },
      });
      if (!response.ok) {
        throw new GeographicLookupError(`Geocoder responded with HTTP ${response.status}`);
      }

      const body: unknown = await response.json();
      if (!Array.isArray(body)) throw new GeographicLookupError("Geocoder returned an invalid response");
      return body as NominatimResult[];
    } catch (error) {
      if (error instanceof GeographicLookupError) throw error;
      throw new GeographicLookupError("Geocoder request failed", error);
    } finally {
      releaseQueue();
    }
  }
}

function countryName(countryCode: string): string {
  return new Intl.DisplayNames(["ru"], { type: "region" }).of(countryCode) ?? countryCode;
}

function normalizeName(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized || undefined;
}

function toCountryCode(value: string | undefined): string | undefined {
  const countryCode = value?.toUpperCase();
  return countryCode && /^[A-Z]{2}$/.test(countryCode) ? countryCode : undefined;
}

function toOsmType(value: string | undefined): CityCandidate["cityOsmType"] | undefined {
  return value === "node" || value === "relation" || value === "way" ? value : undefined;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
