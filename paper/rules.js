// Decision predicates copied from standalone/screening.js and exit-rules.js.
// Paper does not import those modules, so this process never loads a Solana connection.

const number = (value) => (value == null || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null);

export function rejectToken(token, mint, screening, now = Date.now()) {
  if (token?.id !== mint) return "Token mint mismatch";
  const updated = Date.parse(token.updatedAt);
  if (!Number.isFinite(updated) || now - updated > screening.tokenStaleMs || updated > now + screening.tokenFutureSkewMs) {
    return "Token data is stale or has no timestamp";
  }
  const audit = token.audit;
  if (audit?.mintAuthorityDisabled !== true || audit?.freezeAuthorityDisabled !== true) return "Mint/freeze authority is enabled or unknown";
  for (const [key, limit] of [["topHoldersPercentage", screening.maxTop10Pct], ["botHoldersPercentage", screening.maxBotHoldersPct]]) {
    const n = number(audit[key]);
    if (n == null || n < 0 || n > limit) return `${key} failed (${n ?? "unknown"})`;
  }
  if (number(token.fees) == null || token.fees < screening.minTokenFeesSol) return "Token fees below threshold or unknown";
  if (screening.allowedLaunchpads.length && !screening.allowedLaunchpads.includes(token.launchpad)) return "Launchpad is not allowed";
  if (screening.blockedLaunchpads.includes(token.launchpad)) return "Launchpad is blocked";
  if (number(token.holderCount) == null || token.holderCount < screening.minHolders) return "Insufficient holders";
  if (number(token.mcap) == null || token.mcap < screening.minMcap || token.mcap > screening.maxMcap) return "Market cap outside limits";
  if (number(token.organicScore) == null || token.organicScore < screening.minOrganic) return "Organic activity below threshold";
  const age = (now - Date.parse(token.createdAt)) / 3_600_000;
  if ((screening.minTokenAgeHours != null || screening.maxTokenAgeHours != null) && (!Number.isFinite(age) || age < 0)) return "Token age unknown";
  if (screening.minTokenAgeHours != null && age < screening.minTokenAgeHours) return "Token too young";
  if (screening.maxTokenAgeHours != null && age > screening.maxTokenAgeHours) return "Token too old";
  return null;
}

export function deployerBlocked(token, blockedDevs) {
  const list = blockedDevs || {};
  if (token?.dev) return !!list[token.dev];
  return Object.keys(list).length > 0;
}

export function rejectPool(pool, mint, screening, quoteMint) {
  if (pool?.token_x?.address !== mint || pool?.token_y?.address !== quoteMint || pool?.pool_type !== "dlmm") {
    return "Requires an exact-mint DLMM token/SOL pool";
  }
  if (pool.is_blacklisted !== false) return "Pool blacklist status unsafe or unknown";
  if (!Array.isArray(pool.token_x.warnings) || !Array.isArray(pool.token_y.warnings)) return "Pool token warnings unavailable";
  if ([...pool.token_x.warnings, ...pool.token_y.warnings].some((warning) => ["critical", "danger", "warning"].includes(warning.severity))) {
    return "Pool token warning";
  }
  for (const [label, raw, min, max] of [
    ["TVL", pool.tvl, screening.minTvl, screening.maxTvl],
    ["active TVL", pool.active_tvl, screening.minTvl, null],
    ["volume", pool.volume, screening.minVolume, null],
    ["fee/active TVL", pool.fee_active_tvl_ratio, screening.minFeeActiveTvlRatio, null],
    ["bin step", pool.dlmm_params?.bin_step, screening.minBinStep, screening.maxBinStep],
    ["quote organic", pool.token_y.organic_score, screening.minQuoteOrganic, null],
  ]) {
    const n = number(raw);
    if (n == null || n < min || (max != null && n > max)) return `${label} outside limits or unknown`;
  }
  if (!(number(pool.volatility) > 0) || !(number(pool.pool_price) > 0)) return "Volatility or price unavailable";
  return null;
}

export function rankPools(pools) {
  return [...pools].sort((a, b) => b.fee_active_tvl_ratio - a.fee_active_tvl_ratio || b.active_tvl - a.active_tvl || a.pool_address.localeCompare(b.pool_address));
}

export function computeBinsBelow(volatility, minBinsBelow, maxBinsBelow) {
  const parsed = Number(volatility);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid volatility ${volatility ?? "unknown"} — refusing volatility-scaled deploy.`);
  }
  return Math.max(minBinsBelow, Math.min(maxBinsBelow, Math.round(minBinsBelow + (parsed / 5) * (maxBinsBelow - minBinsBelow))));
}

export function rejectMintProof(proof, config, now = Date.now()) {
  if (!proof || proof.unavailable === true) return "On-chain mint authority check unavailable";
  const observed = Number(proof.observedAt);
  if (!Number.isFinite(observed) || now - observed > config.rules.quoteStaleMs || observed > now + config.rules.tokenFutureSkewMs) {
    return "On-chain mint proof is stale or has no timestamp";
  }
  if (!config.tokenPrograms.includes(proof.owner) || proof.mintAuthority !== null || proof.freezeAuthority !== null) {
    return "On-chain mint authority check failed";
  }
  const token2022 = config.tokenPrograms[1];
  if (proof.owner === token2022 && !Array.isArray(proof.extensions)) return "Token-2022 extensions unavailable";
  for (const extension of proof.extensions || []) {
    if (!config.allowedToken2022Extensions.includes(extension)) return `Unsupported Token-2022 extension: ${extension}`;
  }
  return null;
}

export function screeningView(rules) {
  return {
    ...rules,
    tokenStaleMs: rules.tokenStaleMs,
    tokenFutureSkewMs: rules.tokenFutureSkewMs,
  };
}
