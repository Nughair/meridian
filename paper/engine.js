import { ALLOCATION_CENTS, centsToUsd } from "./ledger.js";
import { initialExitState, observeExit, quotePnlPct } from "./exits.js";
import {
  computeBinsBelow,
  deployerBlocked,
  rankPools,
  rejectMintProof,
  rejectPool,
  rejectToken,
  screeningView,
} from "./rules.js";
import { confirmedEvents, qualifyingEvents } from "./signals.js";

export const REPRODUCTION_GAPS = [
  "Entries require fresh tracked-wallet convergence. This repository does not ship a smart-wallet list.",
  "The live bot reads mint authority and remaining LP exposure through Solana RPC. Paper has no RPC client; a missing proof does not pass.",
  "Live submits use the Meteora SDK, a 1 percent slippage tolerance, and a bin-array initialization check. Paper does not turn those into a price or a fee.",
  "The standalone bot does not rebalance. Out-of-range handling is an exit rule.",
  "Live fee and impermanent-loss figures come from Meteora after a real deposit. Pool APR and fee/active-TVL are not paper fees.",
  "USD 100 replaces computeDeployAmount for this book. The 0.5 SOL minimum, 0.2 SOL gas reserve, and maximum of 3 positions still apply.",
  "Exits follow the fast poller: the same signal must appear on 2 observations. The 10-minute manageOnce path can close on one read; paper does not.",
  "Local blacklist, deployer blocklist, and pool-memory cooldowns are operator files. Paper does not read them.",
  "One cloud run is not a durable 24/7 service.",
];

export function loadPaperConfig(raw) {
  if (raw?.mode !== "PAPER" || raw?.broadcast !== false) throw new Error("Paper config must keep broadcast disabled");
  if (raw?.capital?.initialCashUsd !== 1000 || raw?.capital?.allocationUsd !== 100) {
    throw new Error("Paper capital must stay USD 1000 with USD 100 per position");
  }
  if (raw.chain !== "solana" || raw.venue !== "meteora-dlmm") throw new Error("Source venue is Solana Meteora DLMM");
  if (raw.rules?.minBinsBelow < 35 || raw.rules?.binsAbove !== 0 || raw.rules?.strategy !== "bid_ask") {
    throw new Error("Paper keeps the single-sided bid_ask range floor");
  }
  return raw;
}

export function lamportsFromUsd(usd, solUsd) {
  if (!(solUsd > 0) || !(usd > 0)) return null;
  return Math.round((usd / solUsd) * 1e9);
}

export function cashCentsToLamports(cents, solUsd) {
  if (!(solUsd > 0) || !Number.isInteger(cents)) return null;
  return Math.floor((cents / 100) / solUsd * 1e9);
}

export function assessSizing({ cashCents, openCount, solUsd, rules }) {
  const gas = Math.round(rules.gasReserveSol * 1e9);
  const minOpen = Math.round(rules.minSolToOpen * 1e9);
  const minDeploy = Math.round(Math.max(0.1, rules.deployAmountSol) * 1e9);
  const maxDeploy = Math.round(rules.maxDeployAmountSol * 1e9);
  const allocationLamports = lamportsFromUsd(centsToUsd(ALLOCATION_CENTS), solUsd);
  const cashLamports = cashCentsToLamports(cashCents, solUsd);
  const report = {
    allocationUsd: centsToUsd(ALLOCATION_CENTS),
    allocationLamports,
    allocationSol: allocationLamports == null ? null : allocationLamports / 1e9,
    cashSol: cashLamports == null ? null : cashLamports / 1e9,
    gasReserveSol: rules.gasReserveSol,
    gasReserveUsd: solUsd > 0 ? (gas / 1e9) * solUsd : null,
    solUsd: solUsd > 0 ? solUsd : null,
  };
  if (!(solUsd > 0) || allocationLamports == null || cashLamports == null) return { ...report, ok: false, code: "sol_price_unavailable" };
  if (openCount >= rules.maxPositions) return { ...report, ok: false, code: "portfolio_full" };
  if (allocationLamports < minDeploy) return { ...report, ok: false, code: "allocation_below_min_deploy_sol" };
  if (allocationLamports > maxDeploy) return { ...report, ok: false, code: "allocation_above_max_deploy_sol" };
  const needLamports = Math.max(allocationLamports + gas, minOpen + gas);
  if (cashLamports < needLamports) return { ...report, ok: false, code: "insufficient_spendable_sol", needLamports };
  return { ...report, ok: true, code: "sized", needLamports };
}

export function fundedSlots(cashCents, solUsd, rules) {
  let cash = cashCents;
  let slots = 0;
  while (slots < rules.maxPositions) {
    const next = assessSizing({ cashCents: cash, openCount: slots, solUsd, rules });
    if (!next.ok) break;
    cash -= ALLOCATION_CENTS;
    slots += 1;
  }
  return { slots, cashAfterCents: cash };
}

function rejectEarly(code, extra = {}) {
  return { opened: false, code, ...extra };
}

export function evaluateEntry(ledger, packet, config, now = Date.now()) {
  const rules = config.rules;
  const open = ledger.positions.filter((position) => !position.closed);
  const sizing = assessSizing({ cashCents: ledger.cashCents, openCount: open.length, solUsd: packet?.solUsd, rules });
  const attempt = packet?.mint ? ledger.attempts[packet.mint] : null;
  if (attempt && ["open", "opening"].includes(attempt.status)) return rejectEarly("mint_already_attempted", { sizing });

  const qualified = qualifyingEvents(
    confirmedEvents(packet?.events).map((event) => ({ ...event, mint: packet.mint })),
    packet?.mint,
    rules,
    now,
  );
  if (qualified.length < rules.walletThreshold) return rejectEarly("exposure_unconfirmed", { sizing, present: qualified.length });
  if (!sizing.ok) return rejectEarly(sizing.code, { sizing });
  if (!(packet?.deadline > now)) return rejectEarly("signal_expired", { sizing });

  const screening = screeningView(rules);
  const tokenReason = rejectToken(packet.token, packet.mint, screening, now);
  if (tokenReason) return rejectEarly("screening_rejected", { sizing, reason: tokenReason });
  if (deployerBlocked(packet.token, packet.blockedDevs || {})) return rejectEarly("deployer_blocked", { sizing });
  if (packet.blacklist?.[packet.mint]) return rejectEarly("token_blocked", { sizing });

  const mintReason = rejectMintProof(packet.mintProof, config, now);
  if (mintReason) return rejectEarly("mint_proof_missing", { sizing, reason: mintReason });
  if (rules.timeframe === "5m" && packet.volatilityTimeframe !== rules.volatilityTimeframe) {
    return rejectEarly("volatility_timeframe_missing", { sizing });
  }

  const rejected = [];
  const candidates = [];
  for (const pool of packet.pools || []) {
    if (packet.poolCooldowns?.[pool.pool_address]) {
      rejected.push("Pool cooldown");
      continue;
    }
    const why = rejectPool(pool, packet.mint, screening, config.quoteMint);
    if (why) rejected.push(why);
    else candidates.push(pool);
  }
  if (packet.mintCooldowns?.[packet.mint]) return rejectEarly("token_cooldown", { sizing });
  if (!candidates.length) return rejectEarly("no_eligible_pool", { sizing, reason: rejected.slice(0, 3).join("; ") || "No eligible token/SOL pool" });
  const pool = rankPools(candidates)[0];
  if (open.some((position) => position.pool === pool.pool_address)) return rejectEarly("duplicate_pool", { sizing });
  if (open.some((position) => position.mint === packet.mint)) return rejectEarly("duplicate_mint", { sizing });

  const base = Number(packet.screenPrice ?? pool.pool_price);
  const fresh = Number(packet.freshPrice);
  const freshAt = Number(packet.freshPriceAt);
  if (!(base > 0) || !(fresh > 0)) return rejectEarly("price_unavailable", { sizing });
  if (!Number.isFinite(freshAt) || now - freshAt > rules.quoteStaleMs || freshAt > now + rules.tokenFutureSkewMs) {
    return rejectEarly("price_stale", { sizing });
  }
  const movePct = Math.abs(fresh - base) / base * 100;
  if (movePct > rules.maxPriceMovePct) return rejectEarly("price_moved", { sizing, movePct });

  let binsBelow;
  try {
    binsBelow = computeBinsBelow(pool.volatility, rules.minBinsBelow, rules.maxBinsBelow);
  } catch (error) {
    return rejectEarly("volatility_invalid", { sizing, reason: error.message });
  }

  const position = {
    id: `PAPER-${now.toString(36)}-${ledger.positions.length + 1}`,
    label: "PAPER",
    simulatedFill: true,
    chainTx: null,
    signed: false,
    mint: packet.mint,
    pool: pool.pool_address,
    strategy: rules.strategy,
    binsBelow,
    binsAbove: 0,
    allocationCents: ALLOCATION_CENTS,
    solLamports: sizing.allocationLamports,
    entrySolUsd: packet.solUsd,
    entryPoolPrice: fresh,
    binStep: pool.dlmm_params.bin_step,
    volatility: pool.volatility,
    openedAt: new Date(now).toISOString(),
    sources: packet.sources || [],
    feesEarnedCents: 0,
    feePolicy: "unobserved_on_chain_fees_are_zero_apr_not_booked",
    ignoredPoolStats: {
      feeActiveTvlRatio: pool.fee_active_tvl_ratio ?? null,
      apr: packet.token?.apr ?? null,
    },
    valuation: {
      status: "cost_basis_only",
      marketValueCents: null,
      unrealizedPnlPct: null,
      reason: "No auditable bin mark. APR and fee/active-TVL are not booked as earned fees.",
    },
    exitState: initialExitState(),
    closed: false,
  };

  ledger.attempts[packet.mint] = { status: "opening", at: now, pool: pool.pool_address };
  if (ledger.cashCents < ALLOCATION_CENTS) {
    ledger.attempts[packet.mint] = { status: "failed", at: now, error: "cash underflow" };
    return rejectEarly("insufficient_cash", { sizing });
  }
  ledger.cashCents -= ALLOCATION_CENTS;
  ledger.positions.push(position);
  ledger.attempts[packet.mint] = { status: "open", at: now, positionId: position.id, pool: pool.pool_address };
  ledger.events.push({
    type: "paper_position_opened",
    mode: "PAPER",
    at: position.openedAt,
    positionId: position.id,
    mint: position.mint,
    pool: position.pool,
    allocationUsd: 100,
    solLamports: position.solLamports,
    binsBelow,
    binsAbove: 0,
    strategy: position.strategy,
    chainTx: null,
    simulatedFill: true,
    feesEarnedUsd: 0,
    entryPoolPrice: fresh,
    entrySolUsd: packet.solUsd,
  });
  return { opened: true, code: "opened", position, sizing };
}

export function closeQuoted(ledger, position, quote, now = Date.now()) {
  if (!quote?.source || !quote.fetchedAt || !Number.isInteger(quote.marketValueCents)) {
    return { closed: false, code: "close_quote_missing" };
  }
  if (position.closed) return { closed: false, code: "already_closed" };
  const pnlCents = quote.marketValueCents - position.allocationCents;
  position.closed = true;
  position.closedAt = new Date(now).toISOString();
  position.feesEarnedCents = 0;
  position.valuation = {
    status: "quoted_close",
    marketValueCents: quote.marketValueCents,
    unrealizedPnlPct: null,
    realizedPnlCents: pnlCents,
    source: quote.source,
    fetchedAt: quote.fetchedAt,
    reason: "Close uses the supplied read-only quote. APR on that quote is ignored.",
  };
  ledger.cashCents += quote.marketValueCents;
  ledger.positions = ledger.positions.filter((item) => item.id !== position.id);
  ledger.closed.push(position);
  ledger.events.push({
    type: "paper_position_closed",
    mode: "PAPER",
    at: position.closedAt,
    positionId: position.id,
    marketValueUsd: quote.marketValueCents / 100,
    realizedPnlUsd: pnlCents / 100,
    feesEarnedUsd: 0,
    chainTx: null,
    simulatedFill: true,
    source: quote.source,
  });
  return { closed: true, pnlCents };
}

export function applyObservation(position, observation, rules, now = Date.now()) {
  const quoted = observation?.quotedValueCents;
  const hasQuote = Number.isInteger(quoted) && observation?.quoteSource && observation?.quoteFetchedAt;
  if (hasQuote) {
    position.valuation = {
      status: "quoted",
      marketValueCents: quoted,
      unrealizedPnlPct: quotePnlPct(position.allocationCents, quoted),
      source: observation.quoteSource,
      fetchedAt: observation.quoteFetchedAt,
      reason: "Read-only quote. Pool APR was not added.",
    };
  }
  const observed = {
    ...observation,
    pnl_pct: hasQuote ? quotePnlPct(position.allocationCents, quoted) : (observation?.pnl_pct_suspicious ? observation.pnl_pct : null),
  };
  if (!hasQuote && observation?.pnl_pct != null && observation?.pnl_pct_suspicious !== true) {
    return { applied: false, reason: "pnl_without_quote_ignored", exit: position.exitState, fire: false };
  }
  const step = observeExit(position.exitState, observed, rules, now);
  position.exitState = step.exit;
  position.feesEarnedCents = 0;
  return { applied: true, ...step, feesEarnedCents: 0 };
}
