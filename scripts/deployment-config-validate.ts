import {
  validateCareOpsDeploymentEnvironment,
} from "../src/deployment/validation-summary.ts";

function usage(): string {
  return [
    "Usage:",
    "  npm run config:validate",
    "",
    "Reads the Care Ops deployment environment from process.env.",
    "Performs no network requests and never prints credential values.",
    "",
    "Required variables:",
    "  CARE_OPS_ENVIRONMENT",
    "  SUPABASE_URL",
    "  SUPABASE_PUBLISHABLE_KEY",
    "  SUPABASE_SECRET_KEY (preferred) or SUPABASE_SERVICE_ROLE_KEY (legacy fallback)",
    "  CARE_OPS_CONSOLE_ORIGINS",
    "  CARE_OPS_SLA_POLICIES_JSON",
  ].join("\n");
}

if (
  process.argv.includes("--help") ||
  process.argv.includes("-h")
) {
  process.stdout.write(usage() + "\n");
  process.exit(0);
}

try {
  const summary =
    validateCareOpsDeploymentEnvironment(
      process.env,
    );

  process.stdout.write(
    JSON.stringify(summary, null, 2) +
      "\n",
  );
} catch (error) {
  const message =
    error instanceof Error
      ? error.message
      : "unknown deployment configuration error";

  process.stderr.write(
    "deployment configuration invalid: " + message + "\n",
  );
  process.exitCode = 2;
}
