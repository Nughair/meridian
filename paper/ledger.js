import fs from "node:fs";
import path from "node:path";

export const INITIAL_CASH_CENTS = 100_000;
export const ALLOCATION_CENTS = 10_000;

export function centsToUsd(cents) {
  return cents / 100;
}

export function emptyLedger(now = new Date().toISOString()) {
  return {
    version: 1,
    mode: "PAPER",
    broadcast: false,
    currency: "USD",
    initialCashCents: INITIAL_CASH_CENTS,
    cashCents: INITIAL_CASH_CENTS,
    initializedAt: now,
    positions: [],
    closed: [],
    attempts: {},
    signalState: { events: [], signals: {} },
    events: [],
    lastScan: null,
  };
}

function assertLedger(data) {
  if (!data || data.version !== 1 || data.mode !== "PAPER" || data.broadcast !== false) {
    throw new Error("Paper ledger is missing or is not a paper-only book");
  }
  if (data.initialCashCents !== INITIAL_CASH_CENTS || !Number.isInteger(data.cashCents)) {
    throw new Error("Paper ledger cash is unreadable; refusing to treat it as empty or spendable");
  }
  if (!Array.isArray(data.positions) || !Array.isArray(data.closed) || !Array.isArray(data.events)) {
    throw new Error("Paper ledger positions are unreadable");
  }
  return data;
}

export function loadLedger(file, { create = false, now = new Date().toISOString() } = {}) {
  if (!fs.existsSync(file)) {
    if (!create) throw new Error(`Paper ledger does not exist: ${file}`);
    const created = emptyLedger(now);
    saveLedger(file, created);
    return created;
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Paper ledger is unreadable (${error.message}); refusing to reset cash`);
  }
  return assertLedger(parsed);
}

export function saveLedger(file, data) {
  assertLedger(data);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function portfolioSummary(ledger) {
  const open = ledger.positions.filter((position) => !position.closed);
  const deployedCostCents = open.reduce((sum, position) => sum + position.allocationCents, 0);
  const marks = open.map((position) => position.valuation?.marketValueCents);
  const marked = marks.every((value) => Number.isInteger(value));
  const marketValueCents = marked ? marks.reduce((sum, value) => sum + value, 0) : null;
  const feesEarnedCents = open.reduce((sum, position) => sum + (position.feesEarnedCents || 0), 0)
    + ledger.closed.reduce((sum, position) => sum + (position.feesEarnedCents || 0), 0);
  return {
    cashUsd: centsToUsd(ledger.cashCents),
    deployedCostUsd: centsToUsd(deployedCostCents),
    marketValueUsd: marketValueCents == null ? null : centsToUsd(marketValueCents),
    equityUsd: open.length === 0 ? centsToUsd(ledger.cashCents) : (marketValueCents == null ? null : centsToUsd(ledger.cashCents + marketValueCents)),
    equityStatus: open.length === 0 ? "cash_only" : (marketValueCents == null ? "mark_unavailable" : "marked"),
    feesEarnedUsd: centsToUsd(feesEarnedCents),
    openPositions: open.length,
  };
}
