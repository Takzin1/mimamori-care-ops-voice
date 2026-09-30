const staticCases = [
  {
    caseId: "CASE-002",
    subjectId: "subject-demo-002",
    priority: "high",
    status: "ACKNOWLEDGED",
    reason: "unassigned",
    owner: null,
    handoffTarget: null,
    stage: "assign",
    deadline: "06:38",
    overdue: 0,
    breached: false,
    source: "unwell",
  },
  {
    caseId: "CASE-003",
    subjectId: "subject-demo-003",
    priority: "normal",
    status: "HANDOFF_PENDING",
    reason: "handoff_pending",
    owner: "responder-c",
    handoffTarget: "responder-d",
    stage: "handoff_accept",
    deadline: "06:28",
    overdue: 0,
    breached: false,
    source: "welfare_need_help",
  },
  {
    caseId: "CASE-004",
    subjectId: "subject-demo-004",
    priority: "normal",
    status: "IN_PROGRESS",
    reason: "active",
    owner: "responder-e",
    handoffTarget: null,
    stage: "complete",
    deadline: "07:10",
    overdue: 0,
    breached: false,
    source: "manual",
  },
];

const scenario = [
  {
    status: "NEW",
    priority: "high",
    owner: null,
    handoffTarget: null,
    stage: "acknowledge",
    deadline: "06:10",
    breached: true,
    overdue: 8,
    version: 1,
    evidence: 0,
    tta: "—",
    assign: "—",
    firstAction: "—",
    ttc: "—",
    actionTitle: "Caseを確認する",
    actionDescription:
      "dispatcher-demo が未応答Caseを確認し、責任ある対応フローを開始します。",
    buttonLabel: "確認済みに進める",
    timeline: [
      {
        time: "06:00",
        title: "Case発生",
        detail: "non_response / high · system",
      },
    ],
  },
  {
    status: "ACKNOWLEDGED",
    priority: "high",
    owner: null,
    handoffTarget: null,
    stage: "assign",
    deadline: "06:38",
    breached: false,
    overdue: 0,
    version: 2,
    evidence: 0,
    tta: "18分",
    assign: "—",
    firstAction: "—",
    ttc: "—",
    actionTitle: "担当者を確定する",
    actionDescription:
      "確認だけで止めず、次に動く accountable responder を明示します。",
    buttonLabel: "responder-aへ割当",
    timeline: [
      {
        time: "06:18",
        title: "確認済み",
        detail: "dispatcher-demo · acknowledgement SLAは履歴上18分",
      },
      {
        time: "06:00",
        title: "Case発生",
        detail: "non_response / high · system",
      },
    ],
  },
  {
    status: "ASSIGNED",
    priority: "high",
    owner: "responder-a",
    handoffTarget: null,
    stage: "first_action",
    deadline: "06:40",
    breached: false,
    overdue: 0,
    version: 3,
    evidence: 0,
    tta: "18分",
    assign: "20分",
    firstAction: "—",
    ttc: "—",
    actionTitle: "最初の対応を開始する",
    actionDescription:
      "担当確定後、実際の支援アクション開始までの時間を別KPIとして追跡します。",
    buttonLabel: "対応開始",
    timeline: [
      {
        time: "06:20",
        title: "担当確定",
        detail: "responder-a · dispatcher-demo",
      },
      {
        time: "06:18",
        title: "確認済み",
        detail: "dispatcher-demo",
      },
      {
        time: "06:00",
        title: "Case発生",
        detail: "non_response / high · system",
      },
    ],
  },
  {
    status: "IN_PROGRESS",
    priority: "high",
    owner: "responder-a",
    handoffTarget: null,
    stage: "complete",
    deadline: "07:00",
    breached: false,
    overdue: 0,
    version: 4,
    evidence: 0,
    tta: "18分",
    assign: "20分",
    firstAction: "22分",
    ttc: "—",
    actionTitle: "必要なら責任を引き継ぐ",
    actionDescription:
      "引継ぎ要求を出しても、受諾されるまでは responder-a が責任者のままです。",
    buttonLabel: "responder-bへ引継ぎ依頼",
    timeline: [
      {
        time: "06:22",
        title: "対応開始",
        detail: "responder-a",
      },
      {
        time: "06:20",
        title: "担当確定",
        detail: "responder-a",
      },
      {
        time: "06:18",
        title: "確認済み",
        detail: "dispatcher-demo",
      },
      {
        time: "06:00",
        title: "Case発生",
        detail: "non_response / high · system",
      },
    ],
  },
  {
    status: "HANDOFF_PENDING",
    priority: "high",
    owner: "responder-a",
    handoffTarget: "responder-b",
    stage: "handoff_accept",
    deadline: "06:40",
    breached: false,
    overdue: 0,
    version: 5,
    evidence: 0,
    tta: "18分",
    assign: "20分",
    firstAction: "22分",
    ttc: "—",
    actionTitle: "引継ぎを受諾する",
    actionDescription:
      "この時点では責任者はまだ responder-a。responder-b の明示受諾でのみ責任が移ります。",
    buttonLabel: "responder-bが受諾",
    timeline: [
      {
        time: "06:30",
        title: "引継ぎ依頼",
        detail: "responder-a → responder-b · ownerはまだresponder-a",
      },
      {
        time: "06:22",
        title: "対応開始",
        detail: "responder-a",
      },
      {
        time: "06:20",
        title: "担当確定",
        detail: "responder-a",
      },
      {
        time: "06:18",
        title: "確認済み",
        detail: "dispatcher-demo",
      },
      {
        time: "06:00",
        title: "Case発生",
        detail: "non_response / high · system",
      },
    ],
  },
  {
    status: "IN_PROGRESS",
    priority: "high",
    owner: "responder-b",
    handoffTarget: null,
    stage: "complete",
    deadline: "07:00",
    breached: false,
    overdue: 0,
    version: 6,
    evidence: 0,
    tta: "18分",
    assign: "20分",
    firstAction: "22分",
    ttc: "—",
    actionTitle: "支援完了を証跡付きで記録する",
    actionDescription:
      "statusだけをresolvedにせず、outcome・summary・evidence・completedByを揃えます。",
    buttonLabel: "支援完了を記録",
    timeline: [
      {
        time: "06:34",
        title: "引継ぎ受諾",
        detail: "responder-b · この瞬間にownerが移転",
      },
      {
        time: "06:30",
        title: "引継ぎ依頼",
        detail: "responder-a → responder-b",
      },
      {
        time: "06:22",
        title: "対応開始",
        detail: "responder-a",
      },
      {
        time: "06:20",
        title: "担当確定",
        detail: "responder-a",
      },
      {
        time: "06:18",
        title: "確認済み",
        detail: "dispatcher-demo",
      },
      {
        time: "06:00",
        title: "Case発生",
        detail: "non_response / high · system",
      },
    ],
  },
  {
    status: "COMPLETED",
    priority: "high",
    owner: "responder-b",
    handoffTarget: null,
    stage: null,
    deadline: null,
    breached: false,
    overdue: 0,
    version: 7,
    evidence: 1,
    tta: "18分",
    assign: "20分",
    firstAction: "22分",
    ttc: "42分",
    actionTitle: "Caseをクローズする",
    actionDescription:
      "支援完了の証跡を確認した supervisor-demo がCaseを閉じます。",
    buttonLabel: "Caseをクローズ",
    timeline: [
      {
        time: "06:42",
        title: "支援完了",
        detail: "confirmed_safe · call evidence 1件 · responder-b",
      },
      {
        time: "06:34",
        title: "引継ぎ受諾",
        detail: "responder-b",
      },
      {
        time: "06:30",
        title: "引継ぎ依頼",
        detail: "responder-a → responder-b",
      },
      {
        time: "06:22",
        title: "対応開始",
        detail: "responder-a",
      },
      {
        time: "06:20",
        title: "担当確定",
        detail: "responder-a",
      },
      {
        time: "06:18",
        title: "確認済み",
        detail: "dispatcher-demo",
      },
      {
        time: "06:00",
        title: "Case発生",
        detail: "non_response / high · system",
      },
    ],
  },
  {
    status: "CLOSED",
    priority: "high",
    owner: "responder-b",
    handoffTarget: null,
    stage: null,
    deadline: null,
    breached: false,
    overdue: 0,
    version: 8,
    evidence: 1,
    tta: "18分",
    assign: "20分",
    firstAction: "22分",
    ttc: "42分",
    actionTitle: "支援完了まで記録されました",
    actionDescription:
      "Caseはactive queueから外れます。履歴とCompletion Evidenceは監査用に保持されます。",
    buttonLabel: "完了",
    timeline: [
      {
        time: "06:44",
        title: "Caseクローズ",
        detail: "supervisor-demo",
      },
      {
        time: "06:42",
        title: "支援完了",
        detail: "confirmed_safe · call evidence 1件 · responder-b",
      },
      {
        time: "06:34",
        title: "引継ぎ受諾",
        detail: "responder-b",
      },
      {
        time: "06:30",
        title: "引継ぎ依頼",
        detail: "responder-a → responder-b",
      },
      {
        time: "06:22",
        title: "対応開始",
        detail: "responder-a",
      },
      {
        time: "06:20",
        title: "担当確定",
        detail: "responder-a",
      },
      {
        time: "06:18",
        title: "確認済み",
        detail: "dispatcher-demo",
      },
      {
        time: "06:00",
        title: "Case発生",
        detail: "non_response / high · system",
      },
    ],
  },
];

let stepIndex = 0;
let selectedId = "CASE-DEMO-001";

const el = (id) => document.getElementById(id);

function scenarioCase() {
  const step = scenario[stepIndex];
  return {
    caseId: "CASE-DEMO-001",
    subjectId: "subject-demo-001",
    priority: step.priority,
    status: step.status,
    reason: step.breached
      ? "sla_breach"
      : step.status === "NEW"
        ? "unacknowledged"
        : step.status === "ACKNOWLEDGED"
          ? "unassigned"
          : step.status === "HANDOFF_PENDING"
            ? "handoff_pending"
            : "active",
    owner: step.owner,
    handoffTarget: step.handoffTarget,
    stage: step.stage,
    deadline: step.deadline,
    overdue: step.overdue,
    breached: step.breached,
    source: "non_response",
  };
}

function activeQueue() {
  const dynamic =
    scenario[stepIndex].status === "COMPLETED" ||
    scenario[stepIndex].status === "CLOSED"
      ? []
      : [scenarioCase()];

  return [...dynamic, ...staticCases];
}

function reasonLabel(value) {
  return {
    sla_breach: "SLA BREACH",
    unacknowledged: "未確認",
    unassigned: "未割当",
    handoff_pending: "引継ぎ待ち",
    active: "対応中",
  }[value] ?? value;
}

function ownerLabel(value) {
  return value ?? "未割当";
}

function renderSummary() {
  const queue = activeQueue();
  el("metric-total").textContent = String(queue.length);
  el("metric-breached").textContent = String(
    queue.filter((item) => item.breached).length,
  );
  el("metric-unassigned").textContent = String(
    queue.filter((item) => item.status === "ACKNOWLEDGED").length,
  );
  el("metric-handoff").textContent = String(
    queue.filter((item) => item.status === "HANDOFF_PENDING").length,
  );
  el("metric-ttc").textContent =
    stepIndex >= 6 ? "42m" : "—";
}

function renderQueue() {
  const container = el("queue-list");
  container.replaceChildren();

  for (const item of activeQueue()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = [
      "queue-card",
      item.caseId === selectedId ? "active" : "",
      item.breached ? "breached" : "",
    ]
      .filter(Boolean)
      .join(" ");

    button.innerHTML = `
      <div class="queue-top">
        <strong>${item.caseId}</strong>
        <span class="badge priority-${item.priority}">
          ${item.priority.toUpperCase()}
        </span>
      </div>
      <div class="queue-subject">${item.subjectId}</div>
      <div class="queue-meta">
        <span>${item.status}</span>
        <span>owner: ${ownerLabel(item.owner)}</span>
      </div>
      <div class="queue-bottom">
        <span class="reason">${reasonLabel(item.reason)}</span>
        <span>${
          item.breached
            ? `${item.overdue}m overdue`
            : item.deadline
              ? `due ${item.deadline}`
              : "—"
        }</span>
      </div>
    `;

    button.addEventListener("click", () => {
      selectedId = item.caseId;
      render();
    });

    container.append(button);
  }

  if (!activeQueue().length) {
    container.innerHTML =
      '<p class="queue-subject">Active Caseはありません。</p>';
  }
}

function renderScenarioCase() {
  const step = scenario[stepIndex];

  el("case-id").textContent = "CASE-DEMO-001";
  el("case-priority").textContent = step.priority.toUpperCase();
  el("case-priority").className =
    `badge priority-${step.priority}`;
  el("case-status").textContent = step.status;
  el("case-owner").textContent = ownerLabel(step.owner);
  el("case-handoff").textContent =
    step.handoffTarget ?? "—";
  el("case-stage").textContent = step.stage ?? "—";
  el("case-deadline").textContent = step.deadline ?? "—";
  el("case-version").textContent = String(step.version);
  el("case-evidence").textContent = `${step.evidence}件`;

  const breachBox = el("breach-box");
  breachBox.classList.toggle("hidden", !step.breached);
  el("case-breach").textContent =
    step.breached ? `${step.overdue}分超過` : "—";

  el("action-title").textContent = step.actionTitle;
  el("action-description").textContent =
    step.actionDescription;

  const advance = el("advance-button");
  advance.textContent = step.buttonLabel;
  advance.disabled = stepIndex === scenario.length - 1;

  el("tta").textContent = step.tta;
  el("assign-time").textContent = step.assign;
  el("first-action-time").textContent = step.firstAction;
  el("ttc").textContent = step.ttc;

  const completion = el("completion-card");
  completion.classList.toggle("hidden", stepIndex < 6);

  renderTimeline(step.timeline);
}

function renderStaticCase(item) {
  el("case-id").textContent = item.caseId;
  el("case-priority").textContent = item.priority.toUpperCase();
  el("case-priority").className =
    `badge priority-${item.priority}`;
  el("case-status").textContent = item.status;
  el("case-owner").textContent = ownerLabel(item.owner);
  el("case-handoff").textContent =
    item.handoffTarget ?? "—";
  el("case-stage").textContent = item.stage ?? "—";
  el("case-deadline").textContent = item.deadline ?? "—";
  el("case-subject").textContent = item.subjectId;
  el("case-source").textContent = item.source;
  el("case-version").textContent = "synthetic";
  el("case-evidence").textContent = "—";

  el("breach-box").classList.toggle("hidden", !item.breached);
  el("case-breach").textContent =
    item.breached ? `${item.overdue}分超過` : "—";

  el("action-title").textContent =
    "閲覧専用のsynthetic queue item";
  el("action-description").textContent =
    "Reviewer demoではCASE-DEMO-001だけが操作可能です。Queue orderingとresponsibility表示の比較用です。";

  const advance = el("advance-button");
  advance.textContent = "CASE-DEMO-001へ戻る";
  advance.disabled = false;

  el("tta").textContent = "—";
  el("assign-time").textContent = "—";
  el("first-action-time").textContent = "—";
  el("ttc").textContent = "—";
  el("completion-card").classList.add("hidden");

  renderTimeline([
    {
      time: "synthetic",
      title: reasonLabel(item.reason),
      detail: `status=${item.status} · owner=${ownerLabel(item.owner)}`,
    },
  ]);
}

function renderTimeline(items) {
  const timeline = el("timeline");
  timeline.replaceChildren();

  for (const item of items) {
    const li = document.createElement("li");
    li.className = "timeline-item";
    li.innerHTML = `
      <span class="timeline-time">${item.time}</span>
      <strong>${item.title}</strong>
      <small>${item.detail}</small>
    `;
    timeline.append(li);
  }
}

function render() {
  renderSummary();
  renderQueue();

  const current = activeQueue().find(
    (item) => item.caseId === selectedId,
  );

  if (
    selectedId === "CASE-DEMO-001" ||
    (!current &&
      (scenario[stepIndex].status === "COMPLETED" ||
        scenario[stepIndex].status === "CLOSED"))
  ) {
    el("case-subject").textContent = "subject-demo-001";
    el("case-source").textContent = "non_response";
    renderScenarioCase();
    return;
  }

  if (current) {
    renderStaticCase(current);
  }
}

el("advance-button").addEventListener("click", () => {
  if (selectedId !== "CASE-DEMO-001") {
    selectedId = "CASE-DEMO-001";
    render();
    return;
  }

  if (stepIndex < scenario.length - 1) {
    stepIndex += 1;
    render();
  }
});

el("reset-button").addEventListener("click", () => {
  stepIndex = 0;
  selectedId = "CASE-DEMO-001";
  render();
});

render();
