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
  apiBase.protocol !==
    "https:" &&
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
    apiBase.pathname !==
      "/"
  )
) {
  throw new Error(
    "CARE_OPS_API_BASE must be an origin",
  );
}

const tenant =
  required(
    "CARE_OPS_TENANT_ID",
  );

if (
  !/^[A-Za-z0-9._:-]{1,128}$/.test(
    tenant,
  )
) {
  throw new Error(
    "CARE_OPS_TENANT_ID is invalid",
  );
}

const accessToken =
  required(
    "CARE_OPS_ACCESS_TOKEN",
  );

if (
  accessToken.length >
    8 * 1024 ||
  /[\s,]/.test(
    accessToken,
  )
) {
  throw new Error(
    "CARE_OPS_ACCESS_TOKEN is malformed",
  );
}

const locale =
  (
    process.env
      .CARE_OPS_VOICE_LOCALE ??
    "ja-JP"
  ).trim();
const smokeSuffix =
  Date.now()
    .toString(36);
const caseId =
  `CASE-VOICE-SMOKE-${smokeSuffix}`;
const subjectId =
  "subject-demo-smoke";

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

const endpoint =
  new URL(
    `/api/care-ops/tenants/${encodeURIComponent(tenant)}/voice/session`,
    apiBase.origin,
  );

const response =
  await fetch(
    endpoint,
    {
      method:
        "POST",
      headers: {
        accept:
          "application/json",
        authorization:
          `Bearer ${accessToken}`,
        "content-type":
          "application/json",
        ...(protectionBypass
          ? {
              "x-vercel-protection-bypass":
                protectionBypass,
            }
          : {}),
      },
      body:
        JSON.stringify({
          caseId,
          subjectId,
          locale,
        }),
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

const contentType =
  response.headers
    .get(
      "content-type",
    )
    ?.split(
      ";",
      1,
    )[0]
    ?.trim()
    .toLowerCase();

if (
  contentType !==
    "application/json"
) {
  throw new Error(
    `Voice session endpoint returned non-JSON HTTP ${response.status}`,
  );
}

const value =
  await response.json();

if (!response.ok) {
  throw new Error(
    `Voice session endpoint failed with HTTP ${response.status}: ${value?.error?.code ?? "unknown"}`,
  );
}

const session =
  value?.session;
const evidenceReceipt =
  value?.evidenceReceipt;

if (
  !session ||
  session.provider !==
    "assemblyai" ||
  typeof session.websocketUrl !==
    "string" ||
  typeof session.expiresAt !==
    "string" ||
  typeof evidenceReceipt !==
    "string" ||
  !evidenceReceipt.trim() ||
  !session.audio ||
  !Number.isInteger(
    session.audio
      .sampleRateHz,
  )
) {
  throw new Error(
    "Voice session response shape is invalid",
  );
}

const websocket =
  new URL(
    session.websocketUrl,
  );

if (
  websocket.protocol !==
    "wss:"
) {
  throw new Error(
    "Voice session did not return a secure websocket",
  );
}

if (
  !websocket.searchParams
    .get("token")
) {
  throw new Error(
    "Voice session websocket is missing short-lived token",
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      provider:
        session.provider,
      websocketHost:
        websocket.host,
      sampleRateHz:
        session.audio
          .sampleRateHz,
      encoding:
        session.audio
          .encoding,
      expiresAt:
        session.expiresAt,
      evidenceBinding:
        "session-receipt-present",
    },
    null,
    2,
  ),
);
