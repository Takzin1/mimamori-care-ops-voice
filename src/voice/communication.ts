import type {
  EnqueueOutboxInput,
} from "../outbox/types.ts";
import type {
  ApprovedCommunication,
  CommunicationDraft,
  VoiceIncidentDraft,
} from "./types.ts";

function facts(incident: VoiceIncidentDraft): string {
  const fall =
    incident.observations.find(
      (item) =>
        item.key ===
          "fall_occurred",
    );
  const collapse =
    incident.observations.find(
      (item) =>
        item.key ===
          "collapse_occurred",
    );
  const fever =
    incident.observations.find(
      (item) =>
        item.key === "fever",
    );
  const safe =
    incident.observations.find(
      (item) =>
        item.key ===
          "safe_position",
    );

  const factParts:
    string[] = [];

  factParts.push(
    fall?.state === "denied"
      ? "転倒なし"
      : fall?.state === "confirmed"
        ? "転倒あり"
        : "転倒の有無は未確認",
  );

  if (
    collapse?.state ===
      "confirmed"
  ) {
    factParts.push(
      "倒れ込みあり",
    );
  }

  if (
    fever?.state ===
      "confirmed"
  ) {
    factParts.push(
      "発熱あり",
    );
  }

  factParts.push(
    safe?.state ===
        "confirmed" &&
      safe.value
      ? `現在${safe.value}`
      : "現在状態を確認中",
  );

  return `${factParts.join("。 ")}。`;
}

export function createCommunicationDrafts(input: {
  caseId: string;
  incident: VoiceIncidentDraft;
}): CommunicationDraft[] {
  const sharedFacts = facts(input.incident);

  return [
    {
      id: `${input.caseId}:supervisor:1`,
      caseId: input.caseId,
      audience: "supervisor",
      channel: "message",
      body:
        `${input.incident.summary}。 ${sharedFacts} ` +
        "必要な状態確認の結果を更新してください。",
      requiresHumanApproval: true,
    },
    {
      id: `${input.caseId}:family:1`,
      caseId: input.caseId,
      audience: "family",
      channel: "message",
      body:
        `${input.incident.summary}。 ${sharedFacts} ` +
        "職員が状態を確認し、変化があれば改めてご連絡します。",
      requiresHumanApproval: true,
    },
  ];
}

export function approveCommunication(
  draft: CommunicationDraft,
  approvedBy: string,
  approvedAt: string,
): ApprovedCommunication {
  const actor = approvedBy.trim();
  if (!actor) {
    throw new Error("approvedBy is required");
  }
  if (!Number.isFinite(Date.parse(approvedAt))) {
    throw new Error("approvedAt must be ISO-compatible");
  }

  return {
    draft,
    approvedBy: actor,
    approvedAt,
  };
}

export function toCommunicationOutbox(
  tenantId: string,
  approved: ApprovedCommunication,
): EnqueueOutboxInput {
  if (!tenantId.trim()) {
    throw new Error("tenantId is required");
  }

  return {
    tenantId,
    topic: "care_ops.communication",
    deliveryKey:
      `voice-communication:${approved.draft.id}`,
    payload: {
      caseId: approved.draft.caseId,
      audience: approved.draft.audience,
      channel: approved.draft.channel,
      body: approved.draft.body,
      approvedBy: approved.approvedBy,
      approvedAt: approved.approvedAt,
    },
  };
}
