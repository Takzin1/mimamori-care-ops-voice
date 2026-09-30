const required = (name) => {
  const value =
    process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `${name} is required`,
    );
  }

  return value;
};

const apiBase =
  new URL(
    required(
      "CARE_OPS_API_BASE",
    ),
  );

if (
  apiBase.protocol !== "https:" &&
  ![
    "localhost",
    "127.0.0.1",
  ].includes(
    apiBase.hostname,
  )
) {
  throw new Error(
    "CARE_OPS_API_BASE must use https outside localhost",
  );
}

if (
  apiBase.username ||
  apiBase.password ||
  apiBase.search ||
  apiBase.hash ||
  (
    apiBase.pathname &&
    apiBase.pathname !== "/"
  )
) {
  throw new Error(
    "CARE_OPS_API_BASE must be an origin",
  );
}

const protectionBypass =
  process.env
    .VERCEL_AUTOMATION_BYPASS_SECRET
    ?.trim();

if (
  protectionBypass &&
  (
    protectionBypass.length >
      8 * 1024 ||
    /[\r\n]/.test(
      protectionBypass,
    )
  )
) {
  throw new Error(
    "VERCEL_AUTOMATION_BYPASS_SECRET is malformed",
  );
}

async function fetchNoStore(
  path,
  accept,
) {
  return fetch(
    new URL(
      path,
      apiBase.origin,
    ),
    {
      method: "GET",
      headers: {
        accept,
        ...(protectionBypass
          ? {
              "x-vercel-protection-bypass":
                protectionBypass,
            }
          : {}),
      },
      cache:
        "no-store",
      credentials:
        "omit",
      redirect:
        "error",
      referrerPolicy:
        "no-referrer",
    },
  );
}

const page =
  await fetchNoStore(
    "/",
    "text/html",
  );

if (!page.ok) {
  throw new Error(
    `Voice Preview root returned HTTP ${page.status}`,
  );
}

const html =
  await page.text();

if (
  !html.includes(
    "Mimamori Ops Voice",
  )
) {
  throw new Error(
    "Voice Preview root is not the expected demo",
  );
}

const health =
  await fetchNoStore(
    "/api/health",
    "application/json",
  );

const type =
  health.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();

if (
  type !==
    "application/json"
) {
  throw new Error(
    `Voice Preview health returned non-JSON HTTP ${health.status}`,
  );
}

const body =
  await health.json();

if (
  !health.ok ||
  body?.configured !== true ||
  body?.mode !==
    "preview"
) {
  throw new Error(
    `Voice Preview configuration preflight failed: HTTP ${health.status} / ${body?.configuration ?? "unknown"}`,
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      origin:
        apiBase.origin,
      page:
        "Mimamori Ops Voice",
      health:
        "configuration-present",
      mode:
        body.mode,
      commit:
        body.commit,
    },
    null,
    2,
  ),
);
