import type {
  IncidentExtractor,
  IncidentObservation,
  SituationUnderstandingProvider,
  VoiceIncidentDraft,
  VoiceTranscriptEvidence,
} from "./types.ts";
import {
  RuleBasedSituationUnderstandingProvider,
} from "./situation.ts";

function containsAny(
  value: string,
  patterns: readonly string[],
): boolean {
  const normalized =
    value.toLowerCase();

  return patterns.some(
    (pattern) =>
      normalized.includes(
        pattern.toLowerCase(),
      ),
  );
}

function observation(
  key: IncidentObservation["key"],
  label: string,
  state: IncidentObservation["state"],
  value?: string,
): IncidentObservation {
  return {
    key,
    label,
    state,
    ...(value ? { value } : {}),
  };
}

export class RuleBasedDemoIncidentExtractor
implements IncidentExtractor {
  readonly #situation:
    SituationUnderstandingProvider;

  constructor(
    situation:
      SituationUnderstandingProvider =
      new RuleBasedSituationUnderstandingProvider(),
  ) {
    this.#situation =
      situation;
  }

  async extract(input: {
    subjectId: string;
    transcript:
      VoiceTranscriptEvidence;
  }): Promise<VoiceIncidentDraft> {
    const text =
      input.transcript.text;
    const situation =
      await this.#situation
        .understand(input);

    const seated =
      containsAny(
        text,
        [
          "座っています",
          "座ってます",
          "座らせています",
          "椅子に座って",
          "腰掛けています",
          "着座",
          "sitting",
          "duduk",
        ],
      );

    const asksForHelp =
      containsAny(
        text,
        [
          "どうすれば",
          "どうしたら",
          "どう対応",
          "対応を教えて",
          "初めて",
          "わからない",
          "分からない",
          "what should i do",
          "what do i do",
          "apa yang harus",
          "tidak paham",
        ],
      );

    const urgentSignal =
      containsAny(
        text,
        [
          "意識がない",
          "意識ありません",
          "呼びかけに反応がない",
          "呼吸していない",
          "呼吸がない",
          "大量出血",
          "unconscious",
          "not breathing",
          "severe bleeding",
        ],
      );

    const incidentLike =
      situation.fall ===
        "confirmed" ||
      situation.collapse ===
        "confirmed" ||
      situation.fever ===
        "confirmed" ||
      situation.needsClarification;

    const kind =
      incidentLike
        ? "incident"
        : "near_miss";

    const urgency =
      urgentSignal
        ? "urgent"
        : incidentLike
          ? "attention"
          : "routine";

    const recommendedPriority =
      urgentSignal
        ? "critical"
        : incidentLike
          ? "high"
          : "normal";

    const observations:
      IncidentObservation[] = [
        observation(
          "fall_occurred",
          "転倒の有無",
          situation.fall,
        ),
        observation(
          "collapse_occurred",
          "倒れ込みの有無",
          situation.collapse,
        ),
        observation(
          "fever",
          "発熱の有無",
          situation.fever,
        ),
        observation(
          "safe_position",
          "安全な姿勢",
          seated
            ? "confirmed"
            : "unknown",
          seated
            ? "着座"
            : undefined,
        ),
        observation(
          "consciousness",
          "意識の存在（申告）",
          situation.consciousness,
        ),
        observation(
          "pain",
          "痛み",
          "unknown",
        ),
        observation(
          "injury",
          "外傷",
          situation.injury,
        ),
        observation(
          "dizziness_continues",
          "ふらつき継続",
          "unknown",
        ),
      ];

    observations.push(
      observation("breathing", "呼吸の存在（申告）", situation.breathing),
      observation("uncertainty", "申告の不確実性", situation.uncertainty),
    );

    const currentState =
      seated
        ? "現在は着座している"
        : situation.collapse ===
            "confirmed"
          ? "倒れているとの申告。現在状態は追加確認が必要"
          : "現在状態は追加確認が必要";

    return {
      kind,
      urgency,
      recommendedPriority,
      subjectId:
        input.subjectId,
      summary:
        situation.summary,
      currentState,
      needsGuidance:
        asksForHelp,
      observations,
      evidence:
        { ...input.transcript },
      situation,
    };
  }
}
