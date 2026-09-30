import {
  runStagingPreflight,
} from "../src/ops/staging-preflight.ts";

interface CliOptions {
  baseUrl: string;
  consoleOrigin: string;
  timeoutMs?: number;
}

function usage(): string {
  return [
    "Usage:",
    "  npm run preflight:staging -- --base-url https://api.example.test --console-origin https://console.example.test",
    "",
    "Environment fallbacks:",
    "  CARE_OPS_BASE_URL",
    "  CARE_OPS_CONSOLE_ORIGIN",
    "  CARE_OPS_PREFLIGHT_TIMEOUT_MS",
    "",
    "This command sends no access token, resident data, Case payload, or completion evidence.",
  ].join("\n");
}

function parseArgs(argv: readonly string[]): CliOptions {
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--help" || token === "-h") {
      process.stdout.write(usage() + "\n");
      process.exit(0);
    }

    if (!token.startsWith("--")) {
      throw new Error(`unexpected argument: ${token}`);
    }

    const value = argv[index + 1];

    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${token}`);
    }

    values.set(token, value);
    index += 1;
  }

  const baseUrl =
    values.get("--base-url") ??
    process.env.CARE_OPS_BASE_URL;
  const consoleOrigin =
    values.get("--console-origin") ??
    process.env.CARE_OPS_CONSOLE_ORIGIN;
  const rawTimeout =
    values.get("--timeout-ms") ??
    process.env.CARE_OPS_PREFLIGHT_TIMEOUT_MS;

  if (!baseUrl || !consoleOrigin) {
    throw new Error(
      "base URL and Console origin are required",
    );
  }

  const timeoutMs =
    rawTimeout === undefined
      ? undefined
      : Number(rawTimeout);

  return {
    baseUrl,
    consoleOrigin,
    timeoutMs,
  };
}

try {
  const options = parseArgs(
    process.argv.slice(2),
  );
  const report =
    await runStagingPreflight(options);

  process.stdout.write(
    JSON.stringify(report, null, 2) + "\n",
  );

  if (!report.passed) {
    process.exitCode = 1;
  }
} catch (error) {
  const message =
    error instanceof Error
      ? error.message
      : "unknown preflight error";

  process.stderr.write(
    `staging preflight failed: ${message}\n\n${usage()}\n`,
  );
  process.exitCode = 2;
}
