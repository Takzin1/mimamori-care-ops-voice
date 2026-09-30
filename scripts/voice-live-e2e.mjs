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

function requireOrigin(
  value,
) {
  const url =
    new URL(value);

  if (
    url.protocol !== "https:" &&
    ![
      "localhost",
      "127.0.0.1",
    ].includes(url.hostname)
  ) {
    throw new Error(
      "CARE_OPS_API_BASE must use https outside localhost",
    );
  }

  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (
      url.pathname &&
      url.pathname !== "/"
    )
  ) {
    throw new Error(
      "CARE_OPS_API_BASE must be an origin",
    );
  }

  return url.origin;
}

function requireIdentifier(
  value,
  label,
) {
  const normalized =
    value.trim();

  if (
    !/^[A-Za-z0-9._:-]{1,128}$/.test(
      normalized,
    )
  ) {
    throw new Error(
      `${label} is invalid`,
    );
  }

  return normalized;
}

const apiBase =
  requireOrigin(
    required(
      "CARE_OPS_API_BASE",
    ),
  );
const tenantId =
  requireIdentifier(
    required(
      "CARE_OPS_TENANT_ID",
    ),
    "CARE_OPS_TENANT_ID",
  );
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

if (
  locale.length < 2 ||
  locale.length > 64 ||
  !/^[A-Za-z0-9-]+$/.test(
    locale,
  )
) {
  throw new Error(
    "CARE_OPS_VOICE_LOCALE is invalid",
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

function requestHeaders(
  includeJson = false,
) {
  return {
    accept:
      "application/json",
    authorization:
      `Bearer ${accessToken}`,
    ...(includeJson
      ? {
          "content-type":
            "application/json",
        }
      : {}),
    ...(protectionBypass
      ? {
          "x-vercel-protection-bypass":
            protectionBypass,
        }
      : {}),
  };
}

async function jsonGet(
  path,
) {
  const response =
    await fetch(
      new URL(
        path,
        apiBase,
      ),
      {
        method:
          "GET",
        headers:
          requestHeaders(),
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

  const type =
    response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();

  if (
    type !==
      "application/json"
  ) {
    throw new Error(
      `Care Ops returned non-JSON HTTP ${response.status}`,
    );
  }

  const value =
    await response.json();

  if (!response.ok) {
    throw new Error(
      `Care Ops HTTP ${response.status}: ${value?.error?.code ?? "unknown"}`,
    );
  }

  return value;
}

function outboxTotal(
  health,
) {
  const counts =
    health?.outbox?.counts;
  const values = [
    counts?.pending,
    counts?.processing,
    counts?.failed,
    counts?.deadLetter,
    counts?.delivered,
  ];

  if (
    values.some(
      (value) =>
        !Number.isSafeInteger(
          value,
        ) ||
        value < 0,
    )
  ) {
    throw new Error(
      "Outbox health response shape is invalid",
    );
  }

  return values.reduce(
    (sum, value) =>
      sum + value,
    0,
  );
}

async function jsonPost(
  path,
  body,
  expectedStatus,
) {
  const response =
    await fetch(
      new URL(
        path,
        apiBase,
      ),
      {
        method:
          "POST",
        headers:
          requestHeaders(
            true,
          ),
        body:
          JSON.stringify(
            body,
          ),
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

  const type =
    response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();

  if (
    type !==
      "application/json"
  ) {
    throw new Error(
      `Care Ops returned non-JSON HTTP ${response.status}`,
    );
  }

  const value =
    await response.json();

  if (
    response.status !==
      expectedStatus
  ) {
    throw new Error(
      `Care Ops HTTP ${response.status}: ${value?.error?.code ?? "unknown"}`,
    );
  }

  return value;
}

const suffix =
  Date.now()
    .toString(36);
const caseId =
  `CASE-VOICE-E2E-${suffix}`;
const subjectId =
  "subject-demo-e2e";

const sessionResult =
  await jsonPost(
    `/api/care-ops/tenants/${encodeURIComponent(tenantId)}/voice/session`,
    {
      caseId,
      subjectId,
      locale,
    },
    201,
  );

if (
  sessionResult?.session?.provider !==
    "assemblyai" ||
  typeof sessionResult?.session
    ?.sessionId !==
    "string" ||
  typeof sessionResult
    ?.evidenceReceipt !==
    "string" ||
  !sessionResult.evidenceReceipt
    .trim()
) {
  throw new Error(
    "Voice session binding response shape is invalid",
  );
}

const healthPath =
  `/api/care-ops/tenants/${encodeURIComponent(tenantId)}/voice/outbox/health`;

const beforeHealth =
  await jsonGet(
    healthPath,
  );
const beforeOutboxTotal =
  outboxTotal(
    beforeHealth,
  );

const transcriptId =
  `${sessionResult.session.sessionId}:1`;
const capturedAt =
  new Date()
    .toISOString();

const planResult =
  await jsonPost(
    `/api/care-ops/tenants/${encodeURIComponent(tenantId)}/voice/plan`,
    {
      caseId,
      subjectId,
      locale,
      transcript: {
        provider:
          "assemblyai",
        transcriptId,
        text:
          "利用者が立ち上がった時にふらつきました。転倒はしていません。今は座っています。どうすればいいですか？",
        language:
          "ja",
        capturedAt,
      },
      evidenceReceipt:
        sessionResult.evidenceReceipt,
    },
    200,
  );

if (
  planResult?.case?.id !==
    caseId ||
  typeof planResult?.case?.version !==
    "number" ||
  !planResult?.plan ||
  !Array.isArray(
    planResult.plan
      .communicationDrafts,
  ) ||
  planResult.plan
    .communicationDrafts
    .length === 0
) {
  throw new Error(
    "Voice plan response shape is invalid",
  );
}

if (process.env.CARE_OPS_REQUIRE_BEDROCK === "1" &&
    (planResult.plan.incident?.situation?.processing?.provider !== "bedrock" ||
     planResult.plan.incident.situation.processing.fallbackReason)) {
  throw new Error("Bedrock live gate failed: provider was not Bedrock success");
}

const queued = [];

for (
  const draft of
    planResult.plan
      .communicationDrafts
) {
  const approved =
    await jsonPost(
      `/api/care-ops/tenants/${encodeURIComponent(tenantId)}/voice/communications/approve`,
      {
        draft,
      },
      202,
    );

  if (
    !Number.isInteger(
      approved?.queued?.id,
    ) ||
    typeof approved?.queued
      ?.deliveryKey !==
      "string"
  ) {
    throw new Error(
      "Communication approval response shape is invalid",
    );
  }

  queued.push({
    audience:
      draft.audience,
    outboxId:
      approved.queued.id,
    created:
      approved.queued
        .created,
  });
}

const afterHealth =
  await jsonGet(
    healthPath,
  );
const afterOutboxTotal =
  outboxTotal(
    afterHealth,
  );

if (
  afterOutboxTotal <
    beforeOutboxTotal +
      queued.length
) {
  throw new Error(
    "Durable Outbox aggregate did not increase by the approved communication count",
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      case: {
        id:
          planResult.case.id,
        version:
          planResult.case.version,
        status:
          planResult.case.status,
        created:
          planResult.case.created,
      },
      incident: {
        kind:
          planResult.plan
            .incident?.kind,
        urgency:
          planResult.plan
            .incident?.urgency,
      },
      situationProcessing: planResult.plan.incident?.situation?.processing ?? null,
      timings: planResult.timings ?? null,
      guidanceActions:
        Array.isArray(
          planResult.plan
            .guidance?.actions,
        )
          ? planResult.plan
              .guidance.actions
              .length
          : null,
      communications:
        queued,
      outbox: {
        beforeTotal:
          beforeOutboxTotal,
        afterTotal:
          afterOutboxTotal,
        counts:
          afterHealth.outbox
            .counts,
      },
    },
    null,
    2,
  ),
);
