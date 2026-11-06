// Public HTTPS GET only. No RPC, no POST, no signed requests.

const DEFAULT_HOSTS = [
  "api.jup.ag",
  "datapi.jup.ag",
  "dlmm.datapi.meteora.ag",
  "pool-discovery-api.datapi.meteora.ag",
];

export function assertPublicGet(url, allowHosts = DEFAULT_HOSTS) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("PAPER market reads require https");
  if (parsed.username || parsed.password) throw new Error("PAPER market reads reject credentials in the URL");
  if (!allowHosts.includes(parsed.hostname)) throw new Error(`PAPER market host is not allowlisted: ${parsed.hostname}`);
  return parsed;
}

export async function publicGetJson(url, { allowHosts = DEFAULT_HOSTS, timeoutMs = 10_000, fetchImpl = globalThis.fetch } = {}) {
  assertPublicGet(url, allowHosts);
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Market request failed (HTTP ${response.status})`);
  return response.json();
}

export function readSolPriceV3(body, mint) {
  const price = Number(body?.[mint]?.usdPrice);
  return price > 0 ? price : null;
}

export function readSolPriceSearch(body, mint) {
  const rows = Array.isArray(body) ? body : [];
  const row = rows.find((item) => item?.id === mint);
  const price = Number(row?.usdPrice);
  return price > 0 ? price : null;
}

export async function fetchSolUsd(market, options = {}) {
  const attempts = [];
  try {
    const body = await publicGetJson(market.solPriceV3, options);
    const price = readSolPriceV3(body, options.mint);
    if (price) return { solUsd: price, source: market.solPriceV3, fetchedAt: new Date().toISOString(), attempts };
    attempts.push({ source: market.solPriceV3, error: "usdPrice missing" });
  } catch (error) {
    attempts.push({ source: market.solPriceV3, error: error.message });
  }
  try {
    const body = await publicGetJson(market.solAssetSearch, options);
    const price = readSolPriceSearch(body, options.mint);
    if (price) return { solUsd: price, source: market.solAssetSearch, fetchedAt: new Date().toISOString(), attempts };
    attempts.push({ source: market.solAssetSearch, error: "usdPrice missing" });
  } catch (error) {
    attempts.push({ source: market.solAssetSearch, error: error.message });
  }
  return { solUsd: null, source: null, fetchedAt: new Date().toISOString(), attempts };
}
