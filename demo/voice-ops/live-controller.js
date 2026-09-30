const MAX_TOKEN_LENGTH = 8 * 1024;

function requireOrigin(value) {
  const url = new URL(value);
  const localhost =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1";

  if (
    url.protocol !== "https:" &&
    !(localhost && url.protocol === "http:")
  ) {
    throw new Error(
      "Live API base must use https (http is allowed only on localhost).",
    );
  }

  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname && url.pathname !== "/")
  ) {
    throw new Error(
      "Live API base must be an origin only.",
    );
  }

  return url.origin;
}

function requireIdentifier(value, label) {
  const normalized = value.trim();

  if (
    !/^[A-Za-z0-9._:-]{1,128}$/.test(
      normalized,
    )
  ) {
    throw new Error(
      `${label} is invalid.`,
    );
  }

  return normalized;
}

function requireToken(value) {
  if (
    !value ||
    value.length > MAX_TOKEN_LENGTH ||
    !/^[^\s,]+$/.test(value)
  ) {
    throw new Error(
      "Care Ops access token is unavailable or malformed.",
    );
  }

  return value;
}

function requireLocale(value) {
  const normalized = value.trim();

  if (
    normalized.length < 2 ||
    normalized.length > 64 ||
    !/^[A-Za-z0-9-]+$/.test(normalized)
  ) {
    throw new Error(
      "Locale is invalid.",
    );
  }

  return normalized;
}

function requestCredentials(
  url,
) {
  const target =
    new URL(url);

  return target.origin ===
    window.location.origin
      ? "same-origin"
      : "omit";
}

async function jsonRequest(
  url,
  token,
  body,
) {
  const response = await fetch(
    url,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization:
          `Bearer ${token}`,
        "content-type":
          "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      credentials:
        requestCredentials(
          url,
        ),
      redirect: "error",
      referrerPolicy: "no-referrer",
    },
  );

  const type =
    response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();

  if (type !== "application/json") {
    throw new Error(
      "Care Ops API returned a non-JSON response.",
    );
  }

  const value = await response.json();

  if (!response.ok) {
    throw new Error(
      value?.error?.message ??
        "Care Ops API request failed.",
    );
  }

  return value;
}

async function jsonGet(
  url,
  token,
) {
  const response = await fetch(
    url,
    {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization:
          `Bearer ${token}`,
      },
      cache: "no-store",
      credentials:
        requestCredentials(
          url,
        ),
      redirect: "error",
      referrerPolicy: "no-referrer",
    },
  );

  const type =
    response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();

  if (type !== "application/json") {
    throw new Error(
      "Care Ops API returned a non-JSON response.",
    );
  }

  const value = await response.json();

  if (!response.ok) {
    throw new Error(
      value?.error?.message ??
        "Care Ops API request failed.",
    );
  }

  return value;
}

function clamp(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(
    -1,
    Math.min(1, value),
  );
}

function resampleMono(
  samples,
  inputRate,
  outputRate,
) {
  if (samples.length === 0) {
    return new Float32Array();
  }

  if (inputRate === outputRate) {
    return new Float32Array(
      samples,
    );
  }

  const length = Math.max(
    1,
    Math.floor(
      samples.length *
        outputRate /
        inputRate,
    ),
  );
  const output =
    new Float32Array(length);
  const ratio =
    inputRate / outputRate;

  for (
    let index = 0;
    index < length;
    index += 1
  ) {
    const position =
      index * ratio;
    const left =
      Math.floor(position);
    const right =
      Math.min(
        left + 1,
        samples.length - 1,
      );
    const fraction =
      position - left;
    const a =
      samples[
        Math.min(
          left,
          samples.length - 1,
        )
      ] ?? 0;
    const b =
      samples[right] ?? a;

    output[index] =
      a + (b - a) * fraction;
  }

  return output;
}

function pcm16(samples) {
  const buffer =
    new ArrayBuffer(
      samples.length * 2,
    );
  const view =
    new DataView(buffer);

  for (
    let index = 0;
    index < samples.length;
    index += 1
  ) {
    const sample =
      clamp(
        samples[index] ?? 0,
      );
    const value =
      sample < 0
        ? Math.round(
            sample * 0x8000,
          )
        : Math.round(
            sample * 0x7fff,
          );

    view.setInt16(
      index * 2,
      value,
      true,
    );
  }

  return new Uint8Array(
    buffer,
  );
}

function finalEvidence(
  session,
  turn,
) {
  const text =
    typeof turn.transcript ===
      "string"
      ? turn.transcript
      : "";

  if (
    turn.type !== "Turn" ||
    turn.end_of_turn !== true ||
    !text.trim()
  ) {
    return null;
  }

  const suffix =
    Number.isInteger(
      turn.turn_order,
    )
      ? `:${turn.turn_order}`
      : "";

  return {
    provider: "assemblyai",
    transcriptId:
      `${session.sessionId}${suffix}`,
    text,
    language:
      typeof turn.language_code ===
        "string" &&
      turn.language_code.trim()
        ? turn.language_code.trim()
        : "und",
    capturedAt:
      new Date().toISOString(),
  };
}

export function createLiveVoiceController(
  handlers = {},
) {
  let socket = null;
  let stream = null;
  let context = null;
  let source = null;
  let processor = null;
  let silentGain = null;
  let activeSession = null;
  let activeEvidenceReceipt = null;
  let activeConfig = null;
  let stopping = false;
  let planning = false;

  function state(value) {
    handlers.onState?.(value);
  }

  async function stopAudio() {
    if (processor) {
      processor.onaudioprocess =
        null;
      processor.disconnect();
    }

    source?.disconnect();
    silentGain?.disconnect();

    for (
      const track of
        stream?.getTracks?.() ?? []
    ) {
      track.stop();
    }

    if (
      context &&
      context.state !== "closed"
    ) {
      await context.close();
    }

    processor = null;
    source = null;
    silentGain = null;
    stream = null;
    context = null;
  }

  function closeSocket(
    reason,
  ) {
    const current =
      socket;
    socket = null;

    if (!current) {
      return;
    }

    current.onopen = null;
    current.onmessage = null;
    current.onerror = null;
    current.onclose = null;

    if (
      current.readyState < 2
    ) {
      current.close(
        1000,
        reason,
      );
    }
  }

  async function stop() {
    if (stopping) {
      return;
    }

    stopping = true;

    try {
      await stopAudio();

      closeSocket(
        "demo complete",
      );
    } finally {
      socket = null;
      planning = false;
      activeSession = null;
      activeEvidenceReceipt = null;
      activeConfig = null;
      stopping = false;
      state("idle");
    }
  }

  async function requestPlan(
    evidence,
  ) {
    const config =
      activeConfig;

    if (!config) {
      throw new Error(
        "Live configuration is unavailable.",
      );
    }

    const planStarted = performance.now();
    const value =
      await jsonRequest(
        `${config.apiBase}/api/care-ops/tenants/${encodeURIComponent(config.tenantId)}/voice/plan`,
        config.accessToken,
        {
          caseId:
            config.caseId,
          subjectId:
            config.subjectId,
          locale:
            config.locale,
          transcript:
            evidence,
          evidenceReceipt:
            activeEvidenceReceipt,
        },
      );

    handlers.onPlan?.(
      value.plan,
      value.case,
      { ...value.timings, finalToPlanMs: performance.now() - planStarted },
    );
  }

  async function handleMessage(
    raw,
  ) {
    if (
      typeof raw !== "string"
    ) {
      return;
    }

    let message;

    try {
      message =
        JSON.parse(raw);
    } catch {
      handlers.onError?.(
        new Error(
          "AssemblyAI message was not valid JSON.",
        ),
      );
      return;
    }

    if (
      message.type === "Turn" &&
      typeof message.transcript ===
        "string"
    ) {
      handlers.onTranscript?.({
        text:
          message.transcript,
        final:
          message.end_of_turn ===
            true,
      });
    }

    const evidence =
      activeSession
        ? finalEvidence(
            activeSession,
            message,
          )
        : null;

    if (!evidence) {
      return;
    }

    handlers.onFinal?.(
      evidence,
    );

    planning = true;
    state("planning");

    try {
      const planRequest =
        requestPlan(
          evidence,
        );
      closeSocket(
        "final turn received",
      );
      const cleanup =
        stopAudio();

      const [
        planResult,
        cleanupResult,
      ] =
        await Promise.allSettled([
          planRequest,
          cleanup,
        ]);

      if (
        cleanupResult.status ===
          "rejected"
      ) {
        throw cleanupResult.reason;
      }

      if (
        planResult.status ===
          "rejected"
      ) {
        throw planResult.reason;
      }

      state("planned");
    } catch (error) {
      handlers.onError?.(
        error instanceof Error
          ? error
          : new Error(
              "Voice plan request failed.",
            ),
      );
      state("error");
    } finally {
      planning = false;
    }
  }

  function requestMicrophoneStream() {
    return navigator
      .mediaDevices
      .getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation:
            true,
          noiseSuppression:
            true,
          autoGainControl:
            true,
        },
        video: false,
      });
  }

  async function startMicrophone(
    session,
  ) {
    if (!stream) {
      throw new Error(
        "Microphone stream is unavailable.",
      );
    }

    context =
      new AudioContext();
    source =
      context
        .createMediaStreamSource(
          stream,
        );
    processor =
      context
        .createScriptProcessor(
          4096,
          1,
          1,
        );
    silentGain =
      context.createGain();
    silentGain.gain.value = 0;

    processor.onaudioprocess =
      (event) => {
        if (
          !socket ||
          socket.readyState !==
            WebSocket.OPEN
        ) {
          return;
        }

        const mono =
          event.inputBuffer
            .getChannelData(0);
        const resampled =
          resampleMono(
            mono,
            context.sampleRate,
            session.audio
              .sampleRateHz,
          );
        const chunk =
          pcm16(resampled);

        if (
          chunk.byteLength > 0
        ) {
          socket.send(
            chunk,
          );
        }
      };

    source.connect(
      processor,
    );
    processor.connect(
      silentGain,
    );
    silentGain.connect(
      context.destination,
    );
  }

  async function outboxHealth() {
    const config =
      activeConfig;

    if (!config) {
      throw new Error(
        "Live configuration is unavailable.",
      );
    }

    const value =
      await jsonGet(
        `${config.apiBase}/api/care-ops/tenants/${encodeURIComponent(config.tenantId)}/voice/outbox/health`,
        config.accessToken,
      );

    return value.outbox;
  }

  async function approve(
    draft,
  ) {
    const config =
      activeConfig;

    if (!config) {
      throw new Error(
        "Live configuration is unavailable.",
      );
    }

    const value =
      await jsonRequest(
        `${config.apiBase}/api/care-ops/tenants/${encodeURIComponent(config.tenantId)}/voice/communications/approve`,
        config.accessToken,
        {
          draft,
        },
      );

    return value.queued;
  }

  async function start(input) {
    if (
      socket ||
      stream ||
      context
    ) {
      throw new Error(
        "Live voice session is already active.",
      );
    }

    const config = {
      apiBase:
        requireOrigin(
          input.apiBase,
        ),
      tenantId:
        requireIdentifier(
          input.tenantId,
          "tenantId",
        ),
      subjectId:
        requireIdentifier(
          input.subjectId,
          "subjectId",
        ),
      caseId:
        requireIdentifier(
          input.caseId,
          "caseId",
        ),
      locale:
        requireLocale(
          input.locale,
        ),
      accessToken:
        requireToken(
          input.accessToken,
        ),
    };

    activeConfig =
      config;
    state("requesting-session");

    const sessionRequest =
      jsonRequest(
        `${config.apiBase}/api/care-ops/tenants/${encodeURIComponent(config.tenantId)}/voice/session`,
        config.accessToken,
        {
          caseId:
            config.caseId,
          subjectId:
            config.subjectId,
          locale:
            config.locale,
        },
      );
    const microphoneRequest =
      requestMicrophoneStream();

    let value;

    try {
      [
        value,
        stream,
      ] =
        await Promise.all([
          sessionRequest,
          microphoneRequest,
        ]);
    } catch (error) {
      void microphoneRequest
        .then(
          (candidate) => {
            for (
              const track of
                candidate.getTracks()
            ) {
              track.stop();
            }
          },
        )
        .catch(
          () => {},
        );
      activeConfig = null;
      state("error");
      throw error;
    }

    const session =
      value.session;
    const evidenceReceipt =
      value.evidenceReceipt;

    if (
      !session ||
      session.provider !==
        "assemblyai" ||
      typeof session.websocketUrl !==
        "string" ||
      !session.websocketUrl
        .startsWith("wss://") ||
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
        "Voice session response is invalid.",
      );
    }

    activeSession =
      session;
    activeEvidenceReceipt =
      evidenceReceipt;
    state("connecting");

    socket =
      new WebSocket(
        session.websocketUrl,
      );
    socket.binaryType =
      "arraybuffer";

    socket.onmessage =
      (event) => {
        void handleMessage(
          event.data,
        );
      };

    socket.onerror =
      () => {
        state("error");
        handlers.onError?.(
          new Error(
            "AssemblyAI realtime connection failed.",
          ),
        );
      };

    socket.onclose =
      () => {
        socket = null;

        if (
          !stopping &&
          !planning
        ) {
          state("closed");
        }
      };

    try {
      await new Promise(
        (resolve, reject) => {
          const current =
            socket;

          if (!current) {
            reject(
              new Error(
                "WebSocket was not created.",
              ),
            );
            return;
          }

          current.onopen =
            () => resolve();

          const previousError =
            current.onerror;

          current.onerror =
            (event) => {
              previousError?.(
                event,
              );
              reject(
                new Error(
                  "AssemblyAI realtime connection failed.",
                ),
              );
            };
        },
      );
    } catch (error) {
      await stopAudio();
      closeSocket(
        "connection failed",
      );
      activeSession = null;
      activeEvidenceReceipt = null;
      activeConfig = null;
      state("error");
      throw error;
    }

    state("microphone");

    try {
      await startMicrophone(
        session,
      );
      state("listening");
    } catch (error) {
      await stop();
      state("error");
      throw error;
    }
  }

  return {
    start,
    stop,
    approve,
    outboxHealth,
  };
}
