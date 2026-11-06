// Paper mode is a separate process. It has no signer and no transaction sender.

const BLOCKED_ENV = ["WALLET_PRIVATE_KEY", "TELEGRAM_BOT_TOKEN", "JUPITER_API_KEY"];

export function assertPaperProcess() {
  const present = BLOCKED_ENV.filter((key) => {
    const value = process.env[key];
    return typeof value === "string" && value.length > 0;
  });
  if (present.length) {
    throw new Error(`PAPER refuses to start while ${present.join(", ")} is set`);
  }
}

export function rejectBroadcast() {
  throw new Error("PAPER cannot broadcast, sign, approve, or transfer");
}

export function rejectLiveModule(specifier) {
  throw new Error(`PAPER cannot load live module ${specifier}`);
}
