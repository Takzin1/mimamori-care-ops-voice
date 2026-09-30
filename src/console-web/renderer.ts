import {
  CASE_PRIORITIES,
  COMPLETION_OUTCOMES,
  EVIDENCE_KINDS,
  type CaseCommandType,
} from "../core/types.ts";
import type {
  LiveConsoleWorkspaceSnapshot,
} from "../console/types.ts";
import {
  buildConsoleCommandIntent,
} from "./commands.ts";
import {
  ConsoleWebInputError,
} from "./errors.ts";
import {
  LIVE_CONSOLE_CSS,
} from "./styles.ts";
import type {
  ConsoleCommandFormValues,
  ConsoleWebAction,
  LiveConsoleWebRendererHandle,
  LiveConsoleWebRendererOptions,
} from "./types.ts";
import {
  projectConsoleWebModel,
} from "./view-model.ts";

function node<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function appendTextPair(
  doc: Document,
  parent: HTMLElement,
  label: string,
  value: string,
): void {
  const wrap = node(doc, "div", "mco-fact");
  wrap.append(
    node(doc, "span", "mco-label", label),
    node(doc, "strong", "mco-value", value),
  );
  parent.append(wrap);
}

function display(
  value: string | null | undefined,
): string {
  return value && value.trim()
    ? value
    : "—";
}

function minutesLabel(
  value: number | null,
): string {
  return value === null
    ? "—"
    : `${value}m`;
}

function dateLabel(
  value: string | null,
): string {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return new Date(parsed)
    .toISOString()
    .replace("T", " ")
    .replace(".000Z", "Z");
}

function actionInput(
  doc: Document,
  name: string,
  label: string,
  maxLength?: number,
): HTMLInputElement {
  const input = node(doc, "input");
  input.name = name;
  input.autocomplete = "off";
  input.required = true;
  if (maxLength !== undefined) {
    input.maxLength = maxLength;
  }

  const wrap = node(doc, "label", "mco-field");
  wrap.append(
    node(doc, "span", "mco-label", label),
    input,
  );

  return Object.assign(input, {
    __wrapper: wrap,
  });
}

function fieldWrapper(
  input: HTMLInputElement,
): HTMLElement {
  return (
    input as HTMLInputElement & {
      __wrapper: HTMLElement;
    }
  ).__wrapper;
}

function textArea(
  doc: Document,
  name: string,
  label: string,
  maxLength: number,
): HTMLElement {
  const wrap = node(doc, "label", "mco-field");
  const area = node(doc, "textarea");
  area.name = name;
  area.required = true;
  area.maxLength = maxLength;
  wrap.append(
    node(doc, "span", "mco-label", label),
    area,
  );
  return wrap;
}

function selectField(
  doc: Document,
  name: string,
  label: string,
  values: readonly string[],
): HTMLElement {
  const wrap = node(doc, "label", "mco-field");
  const select = node(doc, "select");
  select.name = name;
  select.required = true;

  for (const value of values) {
    const option = node(doc, "option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  }

  wrap.append(
    node(doc, "span", "mco-label", label),
    select,
  );
  return wrap;
}

function formValues(
  form: HTMLFormElement,
): ConsoleCommandFormValues {
  const data = new FormData(form);
  const value = (name: string) => {
    const raw = data.get(name);
    return typeof raw === "string"
      ? raw
      : undefined;
  };

  return {
    priority: value("priority"),
    assigneeId: value("assigneeId"),
    targetAssigneeId:
      value("targetAssigneeId"),
    outcome: value("outcome"),
    summary: value("summary"),
    evidenceKind:
      value("evidenceKind"),
    evidenceRef: value("evidenceRef"),
    reason: value("reason"),
  };
}

function actionFields(
  doc: Document,
  action: ConsoleWebAction,
): HTMLElement[] {
  const fields: HTMLElement[] = [];

  for (const requirement of action.requires) {
    switch (requirement) {
      case "priority":
        fields.push(
          selectField(
            doc,
            "priority",
            "Priority",
            CASE_PRIORITIES,
          ),
        );
        break;

      case "assigneeId": {
        const input = actionInput(
          doc,
          "assigneeId",
          "Assignee actor ID",
          128,
        );
        fields.push(fieldWrapper(input));
        break;
      }

      case "targetAssigneeId": {
        const input = actionInput(
          doc,
          "targetAssigneeId",
          "Handoff target actor ID",
          128,
        );
        fields.push(fieldWrapper(input));
        break;
      }

      case "outcome":
        fields.push(
          selectField(
            doc,
            "outcome",
            "Outcome",
            COMPLETION_OUTCOMES,
          ),
        );
        break;

      case "summary":
        fields.push(
          textArea(
            doc,
            "summary",
            "Completion summary",
            4000,
          ),
        );
        break;

      case "evidence": {
        const ref = actionInput(
          doc,
          "evidenceRef",
          "Evidence reference",
          1000,
        );
        fields.push(
          selectField(
            doc,
            "evidenceKind",
            "Evidence kind",
            EVIDENCE_KINDS,
          ),
          fieldWrapper(ref),
        );
        break;
      }

      case "reason":
        fields.push(
          textArea(
            doc,
            "reason",
            "Reopen reason",
            1000,
          ),
        );
        break;
    }
  }

  return fields;
}

export class LiveConsoleWebRenderer
implements LiveConsoleWebRendererHandle {
  readonly #root: HTMLElement;
  readonly #workspace:
    LiveConsoleWebRendererOptions["workspace"];
  #unsubscribe: (() => void) | null = null;
  #started = false;
  #disposed = false;
  #localError: string | null = null;

  constructor(
    options: LiveConsoleWebRendererOptions,
  ) {
    this.#root = options.root;
    this.#workspace = options.workspace;
  }

  #run(
    operation: () => Promise<void>,
  ): void {
    void operation().catch((error) => {
      this.#localError =
        error instanceof ConsoleWebInputError
          ? error.message
          : "操作を開始できませんでした。";
      this.#render(
        this.#workspace.snapshot(),
      );
    });
  }

  #banner(
    doc: Document,
    text: string,
    kind:
      | "error"
      | "warn"
      | "normal" = "normal",
  ): HTMLElement {
    const className =
      kind === "error"
        ? "mco-banner mco-banner-error"
        : kind === "warn"
          ? "mco-banner mco-banner-warn"
          : "mco-banner";
    return node(
      doc,
      "div",
      className,
      text,
    );
  }

  #topbar(
    doc: Document,
    snapshot: LiveConsoleWorkspaceSnapshot,
  ): HTMLElement {
    const model =
      projectConsoleWebModel(snapshot);
    const bar = node(
      doc,
      "header",
      "mco-topbar",
    );
    const title = node(doc, "div");
    title.append(
      node(
        doc,
        "h1",
        "mco-title",
        "Mimamori Care Ops",
      ),
      node(
        doc,
        "div",
        "mco-subtle",
        "Responder Console · Last-mile GK",
      ),
    );

    const right = node(
      doc,
      "div",
      "mco-operator",
    );

    if (model.operator) {
      right.append(
        node(
          doc,
          "strong",
          "",
          model.operator.actorId,
        ),
        node(
          doc,
          "div",
          "mco-subtle",
          model.operator.roles.join(
            " · ",
          ),
        ),
      );
    } else {
      right.append(
        node(
          doc,
          "div",
          "mco-subtle",
          model.sessionState,
        ),
      );
    }

    bar.append(title, right);
    return bar;
  }

  #toolbar(
    doc: Document,
    snapshot: LiveConsoleWorkspaceSnapshot,
  ): HTMLElement {
    const bar = node(
      doc,
      "div",
      "mco-toolbar",
    );
    bar.style.padding = "12px 20px";

    const refresh = node(
      doc,
      "button",
      "mco-button",
      "更新",
    );
    refresh.type = "button";
    refresh.disabled =
      snapshot.session.state !==
      "ready";
    refresh.addEventListener(
      "click",
      () => {
        this.#localError = null;
        this.#run(async () => {
          await Promise.all([
            this.#workspace.refreshQueue(),
            snapshot.selectedCaseId
              ? this.#workspace
                  .refreshSelectedCase()
              : Promise.resolve(),
          ]);
        });
      },
    );

    const signOut = node(
      doc,
      "button",
      "mco-button mco-button-danger",
      "サインアウト",
    );
    signOut.type = "button";
    signOut.disabled =
      snapshot.session.state !==
      "ready";
    signOut.addEventListener(
      "click",
      () => {
        this.#localError = null;
        this.#run(
          () =>
            this.#workspace.signOut(),
        );
      },
    );

    const state = node(
      doc,
      "span",
      "mco-subtle",
      `Session: ${snapshot.session.state}`,
    );

    bar.append(refresh, signOut, state);
    return bar;
  }

  #summary(
    doc: Document,
    snapshot: LiveConsoleWorkspaceSnapshot,
  ): HTMLElement {
    const model =
      projectConsoleWebModel(snapshot);
    const grid = node(
      doc,
      "section",
      "mco-metrics",
    );

    const values = [
      ["ACTIVE", model.queue.total],
      ["SLA BREACH", model.queue.breached],
      ["UNASSIGNED", model.queue.unassigned],
      [
        "HANDOFF",
        model.queue.handoffPending,
      ],
    ] as const;

    for (const [label, value] of values) {
      const metric = node(
        doc,
        "div",
        "mco-metric",
      );
      metric.append(
        node(
          doc,
          "span",
          "mco-label",
          label,
        ),
        node(
          doc,
          "strong",
          "",
          String(value),
        ),
      );
      grid.append(metric);
    }

    return grid;
  }

  #queuePanel(
    doc: Document,
    snapshot: LiveConsoleWorkspaceSnapshot,
  ): HTMLElement {
    const model =
      projectConsoleWebModel(snapshot);
    const panel = node(
      doc,
      "section",
      "mco-panel",
    );
    const head = node(
      doc,
      "div",
      "mco-panel-head",
    );
    head.append(
      node(
        doc,
        "h2",
        "",
        "今、誰が動くべきか",
      ),
    );
    panel.append(head);

    if (model.queue.error) {
      panel.append(
        this.#banner(
          doc,
          model.queue.error,
          "error",
        ),
      );
    }

    if (
      model.queue.cards.length === 0
    ) {
      panel.append(
        node(
          doc,
          "div",
          "mco-empty",
          model.queue.loading
            ? "Queueを読み込み中…"
            : "Active Caseはありません。",
        ),
      );
      return panel;
    }

    const list = node(
      doc,
      "div",
      "mco-list",
    );

    for (
      const card of
      model.queue.cards
    ) {
      const button = node(
        doc,
        "button",
        [
          "mco-card",
          card.selected
            ? "mco-card-selected"
            : "",
          card.hasActiveBreach
            ? "mco-card-breach"
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
      button.type = "button";
      button.disabled =
        snapshot.mutation.pending;

      const top = node(
        doc,
        "div",
        "mco-row",
      );
      top.append(
        node(
          doc,
          "strong",
          "",
          card.caseId,
        ),
        node(
          doc,
          "span",
          "mco-tag",
          card.priority.toUpperCase(),
        ),
      );

      const meta = node(
        doc,
        "div",
        "mco-subtle",
        `${card.status} · ${card.attentionReason}`,
      );
      meta.style.marginTop = "6px";

      const owner = node(
        doc,
        "div",
        "mco-subtle",
        `owner: ${display(card.owner)}`,
      );
      owner.style.marginTop = "5px";

      if (card.hasActiveBreach) {
        owner.append(
          node(
            doc,
            "span",
            "mco-tag mco-tag-breach",
            ` ${card.overdueMinutes}m overdue`,
          ),
        );
      }

      button.append(
        top,
        node(
          doc,
          "div",
          "",
          card.subjectId,
        ),
        meta,
        owner,
      );

      button.addEventListener(
        "click",
        () => {
          this.#localError = null;
          this.#run(
            () =>
              this.#workspace
                .selectCase(
                  card.caseId,
                ),
          );
        },
      );

      list.append(button);
    }

    panel.append(list);
    return panel;
  }

  #detailPanel(
    doc: Document,
    snapshot: LiveConsoleWorkspaceSnapshot,
  ): HTMLElement {
    const model =
      projectConsoleWebModel(snapshot);
    const panel = node(
      doc,
      "section",
      "mco-panel",
    );
    const head = node(
      doc,
      "div",
      "mco-panel-head",
    );
    const title = node(
      doc,
      "h2",
      "",
      model.selected
        ? model.selected.caseId
        : "Case Detail",
    );
    head.append(title);

    if (
      snapshot.selectedCaseId
    ) {
      const close = node(
        doc,
        "button",
        "mco-button",
        "選択解除",
      );
      close.type = "button";
      close.style.marginTop = "10px";
      close.addEventListener(
        "click",
        () => {
          this.#workspace
            .clearSelection();
        },
      );
      head.append(close);
    }

    panel.append(head);

    if (model.detailError) {
      panel.append(
        this.#banner(
          doc,
          model.detailError,
          "error",
        ),
      );
    }

    if (!model.selected) {
      panel.append(
        node(
          doc,
          "div",
          "mco-empty",
          snapshot.detail.state ===
            "loading"
            ? "Caseを読み込み中…"
            : "QueueからCaseを選択してください。",
        ),
      );
      return panel;
    }

    const facts = node(
      doc,
      "div",
      "mco-facts",
    );
    facts.style.margin = "16px";

    appendTextPair(
      doc,
      facts,
      "Status",
      model.selected.status,
    );
    appendTextPair(
      doc,
      facts,
      "Priority",
      model.selected.priority,
    );
    appendTextPair(
      doc,
      facts,
      "Version",
      String(
        model.selected.version,
      ),
    );
    appendTextPair(
      doc,
      facts,
      "Subject",
      model.selected.subjectId,
    );
    appendTextPair(
      doc,
      facts,
      "Owner",
      display(
        model.selected.owner,
      ),
    );
    appendTextPair(
      doc,
      facts,
      "Handoff",
      display(
        model.selected
          .handoffTarget,
      ),
    );
    appendTextPair(
      doc,
      facts,
      "Source",
      model.selected.sourceType,
    );
    appendTextPair(
      doc,
      facts,
      "Evidence",
      String(
        model.selected
          .evidenceCount,
      ),
    );

    panel.append(facts);

    if (
      model.selected.active === false
    ) {
      panel.append(
        this.#banner(
          doc,
          "このCaseはActive Queue外です。履歴・証跡として表示しています。",
          "warn",
        ),
      );
    }

    if (model.metrics) {
      const metrics = node(
        doc,
        "div",
        "mco-facts",
      );
      metrics.style.margin = "16px";

      appendTextPair(
        doc,
        metrics,
        "TTA",
        minutesLabel(
          model.metrics.ttaMinutes,
        ),
      );
      appendTextPair(
        doc,
        metrics,
        "Assignment",
        minutesLabel(
          model.metrics
            .assignmentMinutes,
        ),
      );
      appendTextPair(
        doc,
        metrics,
        "First Action",
        minutesLabel(
          model.metrics
            .firstActionMinutes,
        ),
      );
      appendTextPair(
        doc,
        metrics,
        "TTC",
        minutesLabel(
          model.metrics.ttcMinutes,
        ),
      );

      panel.append(metrics);
    }

    const stored =
      snapshot.detail.data;

    if (stored) {
      const timelineTitle = node(
        doc,
        "div",
        "mco-panel-head",
      );
      timelineTitle.append(
        node(
          doc,
          "h2",
          "",
          "責任の履歴",
        ),
      );
      panel.append(timelineTitle);

      const timeline = node(
        doc,
        "ol",
        "mco-timeline",
      );

      for (
        const event of
        [...stored.events].reverse()
      ) {
        const item = node(
          doc,
          "li",
        );
        item.append(
          node(
            doc,
            "strong",
            "",
            event.type,
          ),
          node(
            doc,
            "small",
            "",
            `${dateLabel(event.at)} · ${display(event.actorId)}`,
          ),
        );
        timeline.append(item);
      }

      panel.append(timeline);
    }

    return panel;
  }

  #actionForm(
    doc: Document,
    action: ConsoleWebAction,
    snapshot: LiveConsoleWorkspaceSnapshot,
  ): HTMLElement {
    const form = node(
      doc,
      "form",
      "mco-action",
    );
    form.append(
      node(
        doc,
        "h3",
        "",
        action.label,
      ),
    );

    for (
      const field of actionFields(
        doc,
        action,
      )
    ) {
      form.append(field);
    }

    const submit = node(
      doc,
      "button",
      "mco-button mco-button-primary",
      action.label,
    );
    submit.type = "submit";
    submit.disabled =
      snapshot.mutation.pending;
    form.append(submit);

    form.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        this.#localError = null;

        try {
          const command =
            buildConsoleCommandIntent(
              action.type,
              formValues(form),
            );
          this.#run(
            () =>
              this.#workspace
                .execute(command),
          );
        } catch (error) {
          this.#localError =
            error instanceof
              ConsoleWebInputError
              ? error.message
              : "入力を確認してください。";
          this.#render(
            this.#workspace
              .snapshot(),
          );
        }
      },
    );

    return form;
  }

  #actionsPanel(
    doc: Document,
    snapshot: LiveConsoleWorkspaceSnapshot,
  ): HTMLElement {
    const model =
      projectConsoleWebModel(snapshot);
    const panel = node(
      doc,
      "section",
      "mco-panel",
    );
    const head = node(
      doc,
      "div",
      "mco-panel-head",
    );
    head.append(
      node(
        doc,
        "h2",
        "",
        "Next Actions",
      ),
    );
    panel.append(head);

    if (this.#localError) {
      panel.append(
        this.#banner(
          doc,
          this.#localError,
          "error",
        ),
      );
    }

    if (model.mutationError) {
      panel.append(
        this.#banner(
          doc,
          model.mutationError,
          "error",
        ),
      );
    }

    if (model.staleConflict) {
      panel.append(
        this.#banner(
          doc,
          `Caseが更新されています。expected v${model.staleConflict.expectedVersion}, current v${display(
            model.staleConflict
              .actualVersion === null
              ? null
              : String(
                  model.staleConflict
                    .actualVersion,
                ),
          )}。最新状態を確認して再判断してください。`,
          "warn",
        ),
      );
    }

    if (model.capabilityError) {
      panel.append(
        this.#banner(
          doc,
          model.capabilityError,
          "error",
        ),
      );
    }

    if (!model.selected) {
      panel.append(
        node(
          doc,
          "div",
          "mco-empty",
          "Caseを選択すると許可された操作が表示されます。",
        ),
      );
      return panel;
    }

    if (model.actions.length === 0) {
      panel.append(
        node(
          doc,
          "div",
          "mco-empty",
          snapshot.capabilities.state ===
            "loading"
            ? "操作権限を確認中…"
            : "現在このCaseで実行できる操作はありません。",
        ),
      );
      return panel;
    }

    const actions = node(
      doc,
      "div",
      "mco-actions",
    );

    for (
      const action of
      model.actions
    ) {
      actions.append(
        this.#actionForm(
          doc,
          action,
          snapshot,
        ),
      );
    }

    panel.append(actions);
    return panel;
  }

  #render(
    snapshot:
      LiveConsoleWorkspaceSnapshot,
  ): void {
    if (this.#disposed) return;

    const doc =
      this.#root.ownerDocument;
    const style = node(
      doc,
      "style",
    );
    style.textContent =
      LIVE_CONSOLE_CSS;

    const shell = node(
      doc,
      "div",
      "mco-shell",
    );

    shell.append(
      this.#topbar(
        doc,
        snapshot,
      ),
      this.#toolbar(
        doc,
        snapshot,
      ),
    );

    if (
      snapshot.session.state !==
      "ready"
    ) {
      shell.append(
        this.#banner(
          doc,
          snapshot.session.state ===
            "signed_out"
            ? "サインインが必要です。認証プロバイダのログインUIから再開してください。"
            : "セッションの再認証が必要です。失敗した操作は自動再送されません。",
          snapshot.session.state ===
            "signed_out"
            ? "normal"
            : "warn",
        ),
      );

      this.#root.replaceChildren(
        style,
        shell,
      );
      return;
    }

    shell.append(
      this.#summary(
        doc,
        snapshot,
      ),
    );

    const grid = node(
      doc,
      "main",
      "mco-grid",
    );
    grid.append(
      this.#queuePanel(
        doc,
        snapshot,
      ),
      this.#detailPanel(
        doc,
        snapshot,
      ),
      this.#actionsPanel(
        doc,
        snapshot,
      ),
    );
    shell.append(grid);

    this.#root.replaceChildren(
      style,
      shell,
    );
  }

  async start(): Promise<void> {
    if (this.#disposed) {
      throw new Error(
        "Renderer is disposed",
      );
    }
    if (this.#started) return;

    this.#started = true;
    this.#unsubscribe =
      this.#workspace.subscribe(
        (snapshot) => {
          this.#localError = null;
          this.#render(snapshot);
        },
      );

    this.#render(
      this.#workspace.snapshot(),
    );

    await this.#workspace.initialize();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#root.replaceChildren();
  }
}
