// Convergence window copied from standalone/store.js. Rebalances never reach this
// list: the live decoder drops removeLiquidity/rebalance transactions first.

export function qualifyingEvents(events, mint, options, now = Date.now()) {
  const latest = new Map();
  for (const event of events) {
    if (event.mint !== mint || event.at > now || now - event.at > options.windowSec * 1000 || event.depositSol < options.minDepositSol) continue;
    const group = options.walletGroups?.[event.wallet] || event.wallet;
    if (!latest.has(group) || latest.get(group).at < event.at) latest.set(group, event);
  }
  return [...latest.values()];
}

export function acceptEvents(state, events, options, now = Date.now()) {
  const data = state;
  data.events = Array.isArray(data.events) ? data.events : [];
  data.signals = data.signals || {};
  for (const event of events) {
    if (!data.events.some((old) => old.id === event.id)) data.events.push(event);
  }
  const triggered = [];
  for (const mint of new Set(events.map((event) => event.mint))) {
    const existing = data.signals[mint];
    const recent = qualifyingEvents(data.events, mint, options, now);
    if (existing && (!existing.done || now < existing.cooldownUntil)) continue;
    const fresh = recent.filter((event) => !existing || event.at > existing.closedAt);
    if (fresh.length < options.walletThreshold) continue;
    const signal = {
      mint,
      createdAt: now,
      deadline: now + options.screeningDeadlineSec * 1000,
      nextCheck: now,
      events: fresh,
      done: false,
    };
    data.signals[mint] = signal;
    triggered.push(signal);
  }
  data.events = data.events.filter((event) => now - event.at < 10 * 60_000);
  return triggered;
}

export function confirmedEvents(events) {
  return (events || []).filter((event) => event.exposureConfirmed === true);
}
