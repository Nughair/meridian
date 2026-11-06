import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoPath } from "../repo-root.js";
import { assessSizing, fundedSlots, loadPaperConfig, REPRODUCTION_GAPS } from "./engine.js";
import { assertPaperProcess, rejectBroadcast } from "./guard.js";
import { loadLedger, portfolioSummary, saveLedger } from "./ledger.js";
import { fetchSolUsd } from "./market.js";

function flag(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

export async function runScan({
  configPath = repoPath("paper/config.json"),
  watchlistPath = repoPath("paper/watchlist.json"),
  ledgerPath = repoPath("paper/state/ledger.json"),
  statusPath = repoPath("paper/state/status.json"),
  outboxPath = repoPath("paper/state/outbox.jsonl"),
  lockPath = repoPath("paper/state/scan.lock"),
  fetchImpl = globalThis.fetch,
  now = new Date(),
} = {}) {
  if (process.argv.includes("--broadcast") || process.argv.includes("--live")) rejectBroadcast();
  assertPaperProcess();
  const config = loadPaperConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  let lock;
  try {
    lock = fs.openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("Another paper scan holds the lock; refusing a concurrent book update");
    throw error;
  }
  try {
    fs.writeFileSync(lock, `${process.pid}\n`);
    const watch = JSON.parse(fs.readFileSync(watchlistPath, "utf8"));
    const wallets = Array.isArray(watch.wallets) ? watch.wallets.filter((wallet) => typeof wallet === "string" && wallet.trim()) : null;
    const ledger = loadLedger(ledgerPath, { create: true, now: now.toISOString() });
    const sol = await fetchSolUsd(config.market, { mint: config.quoteMint, fetchImpl, allowHosts: config.market.allowHosts });
    const openCount = ledger.positions.filter((position) => !position.closed).length;
    const sizing = assessSizing({ cashCents: ledger.cashCents, openCount, solUsd: sol.solUsd, rules: config.rules });
    const capacity = sol.solUsd ? fundedSlots(ledger.cashCents, sol.solUsd, config.rules) : { slots: 0, cashAfterCents: ledger.cashCents };
    let code = "no_tracked_wallets";
    if (!wallets) code = "watchlist_unreadable";
    else if (wallets.length === 0) code = "no_tracked_wallets";
    else code = "watchlist_present_but_no_convergence_feed";

    const summary = portfolioSummary(ledger);
    const event = {
      type: "scan_completed",
      mode: "PAPER",
      deliver: false,
      destination: "@nughairBot",
      at: now.toISOString(),
      code,
      cashUsd: summary.cashUsd,
      equityUsd: summary.equityUsd,
      equityStatus: summary.equityStatus,
      deployedCostUsd: summary.deployedCostUsd,
      feesEarnedUsd: summary.feesEarnedUsd,
      openPositions: ledger.positions.filter((position) => !position.closed).map(publicPosition),
      solUsd: sol.solUsd,
      solSource: sol.source,
      solFetchedAt: sol.fetchedAt,
      fundedSlots: capacity.slots,
      chainTx: null,
    };
    ledger.lastScan = {
      at: event.at,
      code,
      solUsd: sol.solUsd,
      solSource: sol.source,
      fundedSlots: capacity.slots,
      openPositions: event.openPositions.length,
    };
    ledger.events.push(event);
    saveLedger(ledgerPath, ledger);
    const status = {
      mode: "PAPER",
      broadcast: false,
      durableService: false,
      auditedCommit: config.source.auditedCommit,
      chain: config.chain,
      venue: config.venue,
      scannedAt: event.at,
      code,
      summary,
      sol,
      sizing,
      fundedSlots: capacity.slots,
      cashAfterFullBookUsd: capacity.cashAfterCents / 100,
      reproduction: "partial",
      gaps: REPRODUCTION_GAPS,
      event,
    };
    fs.mkdirSync(path.dirname(statusPath), { recursive: true });
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2) + "\n", { mode: 0o600 });
    fs.appendFileSync(outboxPath, JSON.stringify(event) + "\n", { mode: 0o600 });
    return status;
  } finally {
    fs.closeSync(lock);
    fs.rmSync(lockPath, { force: true });
  }
}

function publicPosition(position) {
  return {
    id: position.id,
    label: position.label,
    simulatedFill: true,
    chainTx: null,
    mint: position.mint,
    pool: position.pool,
    strategy: position.strategy,
    binsBelow: position.binsBelow,
    binsAbove: position.binsAbove,
    allocationUsd: position.allocationCents / 100,
    feesEarnedUsd: position.feesEarnedCents / 100,
    valuation: position.valuation,
  };
}

const launched = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (launched) {
  const status = await runScan({
    configPath: flag("--config", repoPath("paper/config.json")),
    watchlistPath: flag("--watchlist", repoPath("paper/watchlist.json")),
    ledgerPath: flag("--ledger", repoPath("paper/state/ledger.json")),
    statusPath: flag("--status", repoPath("paper/state/status.json")),
    outboxPath: flag("--outbox", repoPath("paper/state/outbox.jsonl")),
    lockPath: flag("--lock", repoPath("paper/state/scan.lock")),
  });
  process.stdout.write(JSON.stringify({
    code: status.code,
    cashUsd: status.summary.cashUsd,
    equityUsd: status.summary.equityUsd,
    openPositions: status.event.openPositions.length,
    solUsd: status.sol.solUsd,
    fundedSlots: status.fundedSlots,
    scannedAt: status.scannedAt,
  }) + "\n");
}
