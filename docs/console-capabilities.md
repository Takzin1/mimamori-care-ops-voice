# Console Operator and Case Capabilities

The live Console consumes server-projected operator context and Case command capabilities.

## Operator context

Authenticated route:

```
GET /api/care-ops/tenants/:tenantId/operator
```

Response shape:

```json
{
  "tenantId": "provider-a",
  "actorId": "responder-a",
  "roles": ["responder"],
  "queueVisibility": "responder"
}
```

The response intentionally does not include the Auth principal ID.

## Case capabilities

Authenticated route:

```
GET /api/care-ops/tenants/:tenantId/cases/:caseId/capabilities
```

Example:

```json
{
  "tenantId": "provider-a",
  "caseId": "case-a",
  "version": 4,
  "status": "IN_PROGRESS",
  "operator": {
    "tenantId": "provider-a",
    "actorId": "responder-a",
    "roles": ["responder"],
    "queueVisibility": "responder"
  },
  "commands": [
    {
      "type": "request_handoff",
      "requires": ["targetAssigneeId"]
    },
    {
      "type": "complete",
      "requires": [
        "outcome",
        "summary",
        "evidence"
      ]
    }
  ]
}
```

## Input requirement vocabulary

Possible requirement names:

- priority
- assigneeId
- targetAssigneeId
- outcome
- summary
- evidence
- reason

These tell a renderer which form fields are needed.

They do not validate the submitted values.

## Execution remains authoritative

Capabilities are a read projection.

Between projection and command submission:

- another operator may change the Case
- membership may be revoked
- ownership may transfer
- target membership may change

Every actual command still passes through:

- current verified identity
- current membership/RBAC
- current target validation
- expected Case version
- current Case Core transition validation

A stale capability never authorizes a stale command.
