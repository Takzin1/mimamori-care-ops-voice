import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const TYPESCRIPT_INTEGRITY =
  "sha512-CWBzXQrc/qOkhidw1OzBTQuYRbfyxDXJMVJ1XNwUHGROVmuaeiEm3OslpZ1RV96d7SKKjZKrSJu3+t/xlw3R9A==";

test("TypeScript compiler is repository-managed and integrity pinned", async () => {
  const packageJson = JSON.parse(
    await readFile(
      new URL(
        "../package.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const lock = JSON.parse(
    await readFile(
      new URL(
        "../package-lock.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    lockfileVersion?: number;
    packages?: Record<
      string,
      {
        version?: string;
        integrity?: string;
      }
    >;
  };

  assert.equal(
    packageJson.devDependencies
      ?.typescript,
    "5.9.2",
  );
  assert.equal(
    packageJson.scripts?.typecheck,
    "tsc -p tsconfig.json --noEmit",
  );
  assert.equal(
    packageJson.scripts?.typecheck
      ?.includes("npx"),
    false,
  );

  assert.equal(
    lock.lockfileVersion,
    3,
  );
  assert.equal(
    lock.packages?.[
      "node_modules/typescript"
    ]?.version,
    "5.9.2",
  );
  assert.equal(
    lock.packages?.[
      "node_modules/typescript"
    ]?.integrity,
    TYPESCRIPT_INTEGRITY,
  );
});

test("CI installs the locked toolchain before typecheck and audits dependencies", async () => {
  const workflow = await readFile(
    new URL(
      "../.github/workflows/ci.yml",
      import.meta.url,
    ),
    "utf8",
  );

  const install =
    workflow.indexOf(
      "npm ci --ignore-scripts --no-audit --no-fund",
    );
  const audit =
    workflow.indexOf(
      "npm audit --audit-level=high",
    );
  const typecheck =
    workflow.indexOf(
      "npm run typecheck",
    );

  assert.ok(install >= 0);
  assert.ok(audit > install);
  assert.ok(typecheck > audit);

  assert.equal(
    workflow.includes(
      "npx --yes --package=typescript",
    ),
    false,
  );
});
