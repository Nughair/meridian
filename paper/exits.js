// Fast-poller exit state machine.
// Order matches the live fast exit poller:
// confirm the peak, apply the stateful exit checks, otherwise the deterministic
// close rule, then require repeated identical observations.

function blankExit() {
  return {
    peak_pnl_pct: 0,
    pending_peak_pnl_pct: null,
    pending_peak_confirm_count: 0,
    trailing_active: false,
    out_of_range_since: null,
    pending_exit_action: null,
    pending_exit_count: 0,
  };
}

export function initialExitState() {
  return blankExit();
}

function confirmPeak(exit, candidate, confirmTicks) {
  if (candidate == null) return;
  const currentPeak = exit.peak_pnl_pct ?? 0;
  if (candidate <= currentPeak) {
    exit.pending_peak_pnl_pct = null;
    exit.pending_peak_confirm_count = 0;
    return;
  }
  if (exit.pending_peak_pnl_pct != null && candidate >= exit.pending_peak_pnl_pct) {
    exit.pending_peak_confirm_count = (exit.pending_peak_confirm_count ?? 1) + 1;
    exit.pending_peak_pnl_pct = candidate;
  } else {
    exit.pending_peak_pnl_pct = candidate;
    exit.pending_peak_confirm_count = 1;
  }
  if (exit.pending_peak_confirm_count >= confirmTicks) {
    exit.peak_pnl_pct = Math.max(currentPeak, exit.pending_peak_pnl_pct);
    exit.pending_peak_pnl_pct = null;
    exit.pending_peak_confirm_count = 0;
  }
}

function deterministicClose(position, rules) {
  const suspect = position.pnl_pct_suspicious === true
    || (position.pnl_pct != null && position.pnl_pct <= -90 && position.tracked_amount_sol && (position.total_value_usd ?? 0) > 0.01);
  if (!suspect && position.pnl_pct == null) {
    // no pnl rule
  } else if (!suspect && position.pnl_pct != null && position.pnl_pct <= rules.stopLossPct) {
    return { action: "CLOSE", rule: 1, reason: "stop loss" };
  } else if (!suspect && position.pnl_pct != null && position.pnl_pct >= rules.takeProfitPct) {
    return { action: "CLOSE", rule: 2, reason: "take profit" };
  }
  if (position.active_bin != null && position.upper_bin != null && position.active_bin > position.upper_bin + rules.outOfRangeBinsToClose) {
    return { action: "CLOSE", rule: 3, reason: "pumped far above range" };
  }
  if (
    position.active_bin != null
    && position.upper_bin != null
    && position.active_bin > position.upper_bin
    && (position.minutes_out_of_range ?? 0) >= rules.outOfRangeWaitMinutes
  ) {
    return { action: "CLOSE", rule: 4, reason: "OOR" };
  }
  if (position.fee_per_tvl_24h != null && position.fee_per_tvl_24h < rules.minFeePerTvl24h && (position.age_minutes ?? 0) >= 60) {
    return { action: "CLOSE", rule: 5, reason: "low yield" };
  }
  return null;
}

function updateExit(exit, position, rules, now) {
  if (rules.trailingTakeProfit && !exit.trailing_active && (exit.peak_pnl_pct ?? 0) >= rules.trailingTriggerPct) {
    exit.trailing_active = true;
  }
  if (position.in_range === false && !exit.out_of_range_since) exit.out_of_range_since = new Date(now).toISOString();
  else if (position.in_range === true && exit.out_of_range_since) exit.out_of_range_since = null;

  const suspect = position.pnl_pct_suspicious === true;
  if (!suspect && position.pnl_pct != null && position.pnl_pct <= rules.stopLossPct) {
    return { action: "STOP_LOSS", reason: `Stop loss: PnL ${position.pnl_pct}% <= ${rules.stopLossPct}%` };
  }
  if (!suspect && exit.trailing_active && position.pnl_pct != null) {
    const drop = exit.peak_pnl_pct - position.pnl_pct;
    if (drop >= rules.trailingDropPct) {
      return { action: "TRAILING_TP", reason: `Trailing TP: peak ${exit.peak_pnl_pct}% → current ${position.pnl_pct}%` };
    }
  }
  if (exit.out_of_range_since) {
    const minutes = Math.floor((now - new Date(exit.out_of_range_since).getTime()) / 60_000);
    if (minutes >= rules.outOfRangeWaitMinutes) {
      return { action: "OUT_OF_RANGE", reason: `Out of range for ${minutes}m` };
    }
  }
  const minAge = rules.minAgeBeforeYieldCheck ?? 60;
  if (
    position.fee_per_tvl_24h != null
    && position.fee_per_tvl_24h < rules.minFeePerTvl24h
    && (position.age_minutes == null || position.age_minutes >= minAge)
  ) {
    return { action: "LOW_YIELD", reason: `Low yield: fee/TVL ${position.fee_per_tvl_24h}%` };
  }
  return null;
}

function register(exit, signal, confirmTicks) {
  if (!signal) {
    exit.pending_exit_action = null;
    exit.pending_exit_count = 0;
    return { fire: false, action: null, count: 0 };
  }
  if (exit.pending_exit_action === signal) exit.pending_exit_count = (exit.pending_exit_count ?? 1) + 1;
  else {
    exit.pending_exit_action = signal;
    exit.pending_exit_count = 1;
  }
  const count = exit.pending_exit_count;
  const fire = count >= confirmTicks;
  if (fire) {
    exit.pending_exit_action = null;
    exit.pending_exit_count = 0;
  }
  return { fire, action: signal, count };
}

export function observeExit(exitState, observation, rules, now = Date.now()) {
  const exit = { ...blankExit(), ...exitState };
  confirmPeak(exit, observation.pnl_pct ?? null, rules.confirmTicks);
  const fast = updateExit(exit, observation, rules, now);
  const closeRule = fast ? null : deterministicClose(observation, rules);
  let signal = null;
  let reason = null;
  if (fast) {
    signal = fast.action;
    reason = fast.reason;
  } else if (closeRule) {
    signal = `RULE_${closeRule.rule}`;
    reason = closeRule.reason;
  }
  const confirmation = register(exit, signal, rules.confirmTicks);
  return { exit, signal, reason, fire: confirmation.fire, count: confirmation.count };
}

export function quotePnlPct(costCents, quotedValueCents) {
  if (!(costCents > 0) || quotedValueCents == null) return null;
  return ((quotedValueCents - costCents) / costCents) * 100;
}
