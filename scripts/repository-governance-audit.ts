import {
  evaluateRepositoryGovernance,
} from "../src/repository-governance.ts";

const repository =
  process.env.GITHUB_REPOSITORY?.trim();
const token =
  process.env.GITHUB_TOKEN?.trim();
const apiBase =
  (
    process.env.GITHUB_API_URL ??
    "https://api.github.com"
  ).replace(/\/$/, "");

if (!repository) {
  process.stderr.write(
    "repository governance audit failed: GITHUB_REPOSITORY is required\n",
  );
  process.exitCode = 2;
} else if (!token) {
  process.stderr.write(
    "repository governance audit failed: GITHUB_TOKEN is required\n",
  );
  process.exitCode = 2;
} else {
  try {
    const response = await fetch(
      `${apiBase}/repos/${repository}/branches/main`,
      {
        headers: {
          accept:
            "application/vnd.github+json",
          authorization:
            `Bearer ${token}`,
          "x-github-api-version":
            "2022-11-28",
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `GitHub branch metadata request failed with status ${response.status}`,
      );
    }

    const snapshot =
      await response.json();
    const report =
      evaluateRepositoryGovernance(
        snapshot,
      );

    process.stdout.write(
      JSON.stringify(report, null, 2) +
        "\n",
    );

    if (!report.passed) {
      process.exitCode = 1;
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "unknown repository governance error";

    process.stderr.write(
      `repository governance audit failed: ${message}\n`,
    );
    process.exitCode = 2;
  }
}
