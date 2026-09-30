export const DEFAULT_OUTBOUND_TIMEOUT_MS =
  10_000;

export function outboundTimeoutMs(
  value: number | undefined,
): number {
  const selected =
    value ?? DEFAULT_OUTBOUND_TIMEOUT_MS;

  if (
    !Number.isInteger(selected) ||
    selected < 1 ||
    selected > 60_000
  ) {
    throw new Error(
      "outbound request timeout must be an integer between 1 and 60000 ms",
    );
  }

  return selected;
}

export function outboundAbortSignal(
  timeoutMs: number,
): AbortSignal {
  return AbortSignal.timeout(
    outboundTimeoutMs(timeoutMs),
  );
}
