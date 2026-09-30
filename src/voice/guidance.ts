import type {
  GuidancePlan,
  NextAction,
  VoiceIncidentDraft,
} from "./types.ts";

const POLICY_ID = "care-near-miss-v0";
const POLICY_VERSION = "2026-09-demo";

function action(
  id: string,
  label: string,
  instruction: string,
  required = true,
): NextAction {
  return {
    id,
    label,
    instruction,
    source: "sop",
    required,
  };
}

export function recommendNextActions(
  incident: VoiceIncidentDraft,
): GuidancePlan {
  const actions: NextAction[] = [];

  const safePosition = incident.observations.find(
    (item) => item.key === "safe_position",
  );
  if (safePosition?.state !== "confirmed") {
    actions.push(
      action(
        "ensure-safety",
        "安全を確保",
        "無理に立ち上がらせず、安全な姿勢を確保してください。",
      ),
    );
  }

  const unknownChecks = incident.observations.filter(
    (item) =>
      [
        "consciousness",
        "pain",
        "injury",
        "dizziness_continues",
      ].includes(item.key) &&
      item.state === "unknown",
  );

  if (unknownChecks.length > 0) {
    const fever =
      incident.observations.find(
        (item) =>
          item.key === "fever",
      );
    const collapse =
      incident.observations.find(
        (item) =>
          item.key ===
            "collapse_occurred",
      );
    const medicalChange =
      fever?.state ===
        "confirmed" ||
      collapse?.state ===
        "confirmed";

    actions.push(
      action(
        "observe-condition",
        "状態を確認",
        medicalChange
          ? "意識、呼吸、体温、痛み、外傷など現在の状態を確認してください。"
          : "意識、痛み、外傷、ふらつき継続の有無を確認してください。",
      ),
    );
  }

  actions.push(
    action(
      "notify-supervisor",
      "管理者へ共有",
      "事業所の連絡ルールに沿って、確認できた事実を管理者へ共有してください。",
    ),
  );

  if (incident.urgency === "urgent") {
    actions.unshift(
      action(
        "follow-emergency-procedure",
        "緊急手順へ移行",
        "AIの推薦を止め、所属組織の緊急時手順を優先してください。",
      ),
    );
  }

  return {
    policyId: POLICY_ID,
    policyVersion: POLICY_VERSION,
    actions,
    boundaryMessage:
      "このガイダンスは診断や緊急度の最終判断を行いません。組織のSOPと責任ある人間の判断を優先してください。",
  };
}
