import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../config.js";
import { getDeterministicCloseRule, computeBinsBelow as liveBins } from "../exit-rules.js";
import { acceptEvents, MonitorStore } from "../standalone/store.js";
import { rejectPool as liveRejectPool, rejectToken as liveRejectToken } from "../standalone/screening.js";
import { applyObservation, assessSizing, closeQuoted, evaluateEntry, fundedSlots, loadPaperConfig } from "../paper/engine.js";
import { observeExit } from "../paper/exits.js";
import { emptyLedger, loadLedger, portfolioSummary, saveLedger } from "../paper/ledger.js";
import { assertPublicGet, readSolPriceSearch, readSolPriceV3 } from "../paper/market.js";
import { computeBinsBelow, rankPools, rejectPool, rejectToken } from "../paper/rules.js";
import { acceptEvents as paperAccept, qualifyingEvents } from "../paper/signals.js";
import { runScan } from "../paper/scan.js";
import { assertPaperProcess, rejectBroadcast } from "../paper/guard.js";
import { repoPath } from "../repo-root.js";

const paperConfig = loadPaperConfig(JSON.parse(fs.readFileSync(repoPath("paper/config.json"), "utf8")));
const rules = paperConfig.rules;
const MINT = "Mint111111111111111111111111111111111111111";
const NOW = 1_700_000_000_000;

function token(overrides = {}) {
  return {
    id: MINT,
    updatedAt: new Date(NOW - 10_000).toISOString(),
    audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPercentage: 30, botHoldersPercentage: 10 },
    fees: 50,
    launchpad: null,
    holderCount: 800,
    mcap: 400_000,
    organicScore: 75,
    createdAt: new Date(NOW - 3 * 3_600_000).toISOString(),
    dev: "Dev1111111111111111111111111111111111111111",
    apr: 999,
    ...overrides,
  };
}

function pool(overrides = {}) {
  return {
    pool_address: "PoolAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    pool_type: "dlmm",
    is_blacklisted: false,
    token_x: { address: MINT, warnings: [] },
    token_y: { address: paperConfig.quoteMint, warnings: [], organic_score: 75 },
    tvl: 50_000,
    active_tvl: 40_000,
    volume: 5_000,
    fee_active_tvl_ratio: 0.2,
    dlmm_params: { bin_step: 100 },
    volatility: 2.5,
    pool_price: 1.5,
    ...overrides,
  };
}

function packet(overrides = {}) {
  const events = overrides.events || [
    { id: "a", wallet: "Wallet111111111111111111111111111111111111", depositSol: 1, at: NOW - 1_000, exposureConfirmed: true },
    { id: "b", wallet: "Wallet222222222222222222222222222222222222", depositSol: 1, at: NOW - 1_000, exposureConfirmed: true },
  ];
  return {
    mint: MINT,
    deadline: NOW + 60_000,
    solUsd: 150,
    events,
    token: token(),
    blockedDevs: {},
    blacklist: {},
    mintProof: {
      owner: paperConfig.tokenPrograms[0],
      mintAuthority: null,
      freezeAuthority: null,
      extensions: null,
      observedAt: NOW - 1_000,
    },
    volatilityTimeframe: "30m",
    pools: [pool()],
    screenPrice: 1.5,
    freshPrice: 1.52,
    freshPriceAt: NOW - 1_000,
    sources: [{ name: "fixture", fetchedAt: new Date(NOW).toISOString() }],
    ...overrides,
  };
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meridian-paper-"));
}

test("paper book initializes at USD 1000 and reloads the same cash", () => {
  const dir = tempDir();
  const file = path.join(dir, "ledger.json");
  const created = loadLedger(file, { create: true, now: "2026-11-06T00:00:00.000Z" });
  assert.equal(created.cashCents, 100_000);
  assert.equal(created.mode, "PAPER");
  assert.equal(created.broadcast, false);
  created.cashCents = 90_000;
  saveLedger(file, created);
  const reloaded = loadLedger(file);
  assert.equal(reloaded.cashCents, 90_000);
  assert.equal(portfolioSummary(reloaded).equityUsd, 900);
  assert.throws(() => loadLedger(path.join(dir, "missing.json")), /does not exist/);
  fs.writeFileSync(path.join(dir, "bad.json"), "{");
  assert.throws(() => loadLedger(path.join(dir, "bad.json")), /unreadable/);
});

test("USD 100 sizing respects cash, the 0.5 SOL floor, gas reserve, and three-position cap", () => {
  const sized = assessSizing({ cashCents: 100_000, openCount: 0, solUsd: 150, rules });
  assert.equal(sized.ok, true);
  assert.equal(sized.allocationUsd, 100);
  assert.ok(sized.allocationSol > 0.5);
  const capacity = fundedSlots(100_000, 150, rules);
  assert.equal(capacity.slots, 3);
  assert.equal(capacity.cashAfterCents, 70_000);

  const tooSmallNotional = assessSizing({ cashCents: 100_000, openCount: 0, solUsd: 250, rules });
  assert.equal(tooSmallNotional.ok, false);
  assert.equal(tooSmallNotional.code, "allocation_below_min_deploy_sol");
  assert.equal(fundedSlots(100_000, 250, rules).slots, 0);

  const poor = assessSizing({ cashCents: 10_000, openCount: 0, solUsd: 150, rules });
  assert.equal(poor.code, "insufficient_spendable_sol");
  assert.equal(assessSizing({ cashCents: 100_000, openCount: 3, solUsd: 150, rules }).code, "portfolio_full");

  const reserveBinds = fundedSlots(20_000, 150, rules);
  assert.equal(reserveBinds.slots, 1);
  assert.equal(reserveBinds.cashAfterCents, 10_000);

  const belowSolFloor = fundedSlots(100_000, 4_000, rules);
  assert.equal(belowSolFloor.slots, 0);
  assert.equal(belowSolFloor.cashAfterCents, 100_000);
});

test("a complete fixture opens one paper position and a second signal does not", () => {
  const ledger = emptyLedger("2026-11-06T00:00:00.000Z");
  const first = evaluateEntry(ledger, packet(), paperConfig, NOW);
  assert.equal(first.opened, true);
  assert.equal(first.position.label, "PAPER");
  assert.equal(first.position.chainTx, null);
  assert.equal(first.position.signed, false);
  assert.equal(first.position.binsAbove, 0);
  assert.equal(first.position.strategy, "bid_ask");
  assert.equal(first.position.feesEarnedCents, 0);
  assert.equal(first.position.valuation.marketValueCents, null);
  assert.equal(first.position.ignoredPoolStats.apr, 999);
  assert.equal(ledger.cashCents, 90_000);
  assert.equal(portfolioSummary(ledger).equityUsd, null);
  assert.equal(portfolioSummary(ledger).equityStatus, "mark_unavailable");
  assert.equal(portfolioSummary(ledger).feesEarnedUsd, 0);

  const second = evaluateEntry(ledger, packet(), paperConfig, NOW + 1);
  assert.equal(second.opened, false);
  assert.equal(second.code, "mint_already_attempted");
  assert.equal(ledger.cashCents, 90_000);
  assert.equal(ledger.positions.length, 1);
});

test("missing exposure, missing mint proof, and a naked PnL number do not become a fill", () => {
  const unconfirmed = packet({
    events: [
      { id: "a", wallet: "W1", depositSol: 1, at: NOW - 1_000, exposureConfirmed: false },
      { id: "b", wallet: "W2", depositSol: 1, at: NOW - 1_000 },
    ],
  });
  const ledger = emptyLedger();
  assert.equal(evaluateEntry(ledger, unconfirmed, paperConfig, NOW).code, "exposure_unconfirmed");
  assert.equal(ledger.cashCents, 100_000);

  const noProof = packet({ mintProof: { unavailable: true } });
  assert.equal(evaluateEntry(emptyLedger(), noProof, paperConfig, NOW).code, "mint_proof_missing");

  const opened = evaluateEntry(emptyLedger(), packet(), paperConfig, NOW);
  const mark = applyObservation(opened.position, { pnl_pct: 25, apr: 400, feePerTvl24h: 80 }, rules, NOW);
  assert.equal(mark.applied, false);
  assert.equal(opened.position.feesEarnedCents, 0);
  assert.equal(opened.position.valuation.marketValueCents, null);
  assert.equal(closeQuoted(emptyLedger(), opened.position, { marketValueCents: 11_000 }).code, "close_quote_missing");
});

test("quoted close books the quote once and still does not add APR", () => {
  const ledger = emptyLedger();
  const opened = evaluateEntry(ledger, packet(), paperConfig, NOW);
  const quote = { marketValueCents: 11_000, source: "https://example.test/quote", fetchedAt: new Date(NOW).toISOString(), apr: 50 };
  const closed = closeQuoted(ledger, opened.position, quote, NOW);
  assert.equal(closed.closed, true);
  assert.equal(closed.pnlCents, 1_000);
  assert.equal(ledger.cashCents, 101_000);
  assert.equal(ledger.positions.length, 0);
  assert.equal(ledger.closed[0].feesEarnedCents, 0);
  assert.equal(portfolioSummary(ledger).equityUsd, 1010);
  assert.equal(portfolioSummary(ledger).feesEarnedUsd, 0);
});

test("fast-poller exits match the live rule order and need two confirms", () => {
  const mgmt = { ...config.management, confirmTicks: 2 };
  const base = { position: "Pos111111111111111111111111111111111111111", pair: "T/SOL", pnl_pct: 0, active_bin: 100, upper_bin: 100, minutes_out_of_range: 0, age_minutes: 90, fee_per_tvl_24h: 10, in_range: true };
  assert.equal(getDeterministicCloseRule({ ...base, pnl_pct: 10 }, mgmt)?.rule, 2);
  let exit = { peak_pnl_pct: 0, pending_peak_confirm_count: 0, pending_peak_pnl_pct: null, trailing_active: false, pending_exit_count: 0, pending_exit_action: null, out_of_range_since: null };
  let step = observeExit(exit, { ...base, pnl_pct: 10 }, rules, NOW);
  assert.equal(step.signal, "RULE_2");
  assert.equal(step.fire, false);
  step = observeExit(step.exit, { ...base, pnl_pct: 10 }, rules, NOW + 3_000);
  assert.equal(step.fire, true);

  assert.equal(getDeterministicCloseRule({ ...base, pnl_pct: -95, pnl_pct_suspicious: true }, mgmt), null);
  step = observeExit(exit, { ...base, pnl_pct: -95, pnl_pct_suspicious: true }, rules, NOW);
  assert.equal(step.signal, null);

  step = observeExit(exit, { ...base, active_bin: 130 }, rules, NOW);
  assert.equal(step.signal, "RULE_3");
  assert.equal(getDeterministicCloseRule({ ...base, active_bin: 130 }, mgmt)?.rule, 3);

  const widened = { ...rules, minAgeBeforeYieldCheck: 120 };
  step = observeExit(exit, { ...base, fee_per_tvl_24h: 1, age_minutes: 90 }, widened, NOW);
  assert.equal(step.signal, "RULE_5");

  exit = { ...exit };
  step = observeExit(exit, { ...base, pnl_pct: 4 }, rules, NOW);
  step = observeExit(step.exit, { ...base, pnl_pct: 4 }, rules, NOW + 3_000);
  assert.equal(step.exit.trailing_active, true);
  assert.equal(step.signal, null);
  step = observeExit(step.exit, { ...base, pnl_pct: 2.4 }, rules, NOW + 6_000);
  assert.equal(step.signal, "TRAILING_TP");
  assert.equal(step.fire, false);
  step = observeExit(step.exit, { ...base, pnl_pct: 2.4 }, rules, NOW + 9_000);
  assert.equal(step.fire, true);
});

test("screening, ranking, bins, and convergence match the live functions", () => {
  assert.equal(config.tokens.SOL, paperConfig.quoteMint);
  const screening = config.screening;
  const sample = token();
  const liveScreen = { ...screening, tokenStaleMs: 90_000, tokenFutureSkewMs: 5_000 };
  assert.equal(rejectToken(sample, MINT, liveScreen, NOW), liveRejectToken(sample, MINT, screening, NOW));
  assert.equal(
    rejectToken({ ...sample, updatedAt: new Date(NOW - 300_000).toISOString() }, MINT, liveScreen, NOW),
    liveRejectToken({ ...sample, updatedAt: new Date(NOW - 300_000).toISOString() }, MINT, screening, NOW),
  );
  const healthy = pool();
  assert.equal(rejectPool(healthy, MINT, liveScreen, config.tokens.SOL), liveRejectPool(healthy, MINT, screening));
  assert.notEqual(rejectPool({ ...healthy, tvl: null }, MINT, liveScreen, config.tokens.SOL), null);

  const ranked = rankPools([
    pool({ pool_address: "B", fee_active_tvl_ratio: 0.1, active_tvl: 80_000 }),
    pool({ pool_address: "A", fee_active_tvl_ratio: 0.4, active_tvl: 10_000 }),
  ]);
  assert.deepEqual(ranked.map((item) => item.pool_address), ["A", "B"]);

  for (const volatility of [0.01, 2.5, 50]) assert.equal(computeBinsBelow(volatility, 35, 69), liveBins(volatility));
  assert.throws(() => computeBinsBelow(0, 35, 69), /Invalid volatility/);
  assert.throws(() => liveBins(null), /Invalid volatility/);

  const options = { walletThreshold: 2, windowSec: 120, screeningDeadlineSec: 120, minDepositSol: 0.1, cooldownSec: 300, walletGroups: {} };
  const events = [
    { id: "e1", mint: MINT, wallet: "W1", at: NOW - 5_000, depositSol: 1 },
    { id: "e2", mint: MINT, wallet: "W1", at: NOW - 4_000, depositSol: 1 },
    { id: "e3", mint: MINT, wallet: "W2", at: NOW - 3_000, depositSol: 0.05 },
  ];
  assert.equal(qualifyingEvents(events, MINT, options, NOW).length, 1);
  const file = path.join(tempDir(), "monitor.json");
  const live = new MonitorStore(file);
  const triggered = acceptEvents(live, events, options, NOW);
  const paperState = { events: [], signals: {} };
  const paperTriggered = paperAccept(paperState, events, options, NOW);
  assert.equal(triggered.length, 0);
  assert.equal(paperTriggered.length, 0);
  const enough = [...events, { id: "e4", mint: MINT, wallet: "W2", at: NOW - 2_000, depositSol: 1 }];
  const liveHit = acceptEvents(live, enough, options, NOW);
  const paperHit = paperAccept(paperState, enough, options, NOW);
  assert.equal(liveHit.length, 1);
  assert.equal(paperHit.length, 1);
  assert.deepEqual(paperHit[0].events.map((event) => event.id).sort(), liveHit[0].events.map((event) => event.id).sort());
});

test("paper sources cannot broadcast and the scan books no position without a wallet signal", async () => {
  const banned = ["sendAndConfirmTransaction", "sendTransaction", "Keypair", "@solana/web3.js", "api.telegram.org", "tools/dlmm.js", "tools/wallet.js", "tools/executor.js", "standalone/runtime.js", "standalone/rpc.js"];
  const files = fs.readdirSync(repoPath("paper")).flatMap((name) => {
    const full = repoPath("paper", name);
    if (fs.statSync(full).isDirectory()) return fs.readdirSync(full).filter((child) => child.endsWith(".js")).map((child) => path.join(full, child));
    return name.endsWith(".js") ? [full] : [];
  });
  assert.ok(files.length >= 8);
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const tokenText of banned) assert.equal(text.includes(tokenText), false, `${path.basename(file)} contains ${tokenText}`);
  }
  assert.throws(() => rejectBroadcast(), /cannot broadcast/);
  assert.throws(() => assertPublicGet("http://api.jup.ag/price"), /https/);
  assert.throws(() => assertPublicGet("https://user:pass@api.jup.ag/price"), /credentials/);
  assert.throws(() => assertPublicGet("https://evil.example/price"), /not allowlisted/);
  assert.equal(readSolPriceV3({ [paperConfig.quoteMint]: { usdPrice: 150.25 } }, paperConfig.quoteMint), 150.25);
  assert.equal(readSolPriceSearch([{ id: paperConfig.quoteMint, usdPrice: "151.5" }], paperConfig.quoteMint), 151.5);
  assert.equal(readSolPriceV3({}, paperConfig.quoteMint), null);

  const previous = process.env.WALLET_PRIVATE_KEY;
  process.env.WALLET_PRIVATE_KEY = "not-a-real-key";
  assert.throws(() => assertPaperProcess(), /WALLET_PRIVATE_KEY/);
  if (previous == null) delete process.env.WALLET_PRIVATE_KEY;
  else process.env.WALLET_PRIVATE_KEY = previous;

  const dir = tempDir();
  const status = await runScan({
    configPath: repoPath("paper/config.json"),
    watchlistPath: repoPath("paper/watchlist.json"),
    ledgerPath: path.join(dir, "ledger.json"),
    statusPath: path.join(dir, "status.json"),
    outboxPath: path.join(dir, "outbox.jsonl"),
    lockPath: path.join(dir, "scan.lock"),
    fetchImpl: async () => { throw new Error("offline"); },
    now: new Date("2026-11-06T17:40:00.000Z"),
  });
  assert.equal(status.code, "no_tracked_wallets");
  assert.equal(status.summary.cashUsd, 1000);
  assert.equal(status.summary.equityUsd, 1000);
  assert.equal(status.event.openPositions.length, 0);
  assert.equal(status.sol.solUsd, null);
  assert.equal(status.broadcast, false);
  assert.equal(fs.existsSync(path.join(dir, "scan.lock")), false);
  const line = JSON.parse(fs.readFileSync(path.join(dir, "outbox.jsonl"), "utf8").trim());
  assert.equal(line.deliver, false);
  assert.equal(line.chainTx, null);
  assert.equal(line.destination, "@nughairBot");
});
