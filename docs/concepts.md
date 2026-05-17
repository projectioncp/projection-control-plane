# Projection Concepts

## Core Thesis

AI systems should not operate directly against raw enterprise systems.

Projection creates a bounded operational representation of enterprise context so AI can reason safely within controlled execution boundaries.

AI does not see the enterprise directly.
It sees what is projected.

---

# Projection Frame

A Projection Frame is the bounded operational context presented to the AI system.

A frame may contain:
- workflow state
- retrieved records
- user scope
- operational metadata
- constraints
- historical context
- capability outputs

Frames are:
- temporary
- scoped
- governed
- auditable
- continuously updated during interaction

The frame is the AI system’s working context.

---

# Guardrail

Guardrails define what AI is allowed to do.

Guardrails enforce:
- authorization
- policy
- approvals
- thresholds
- execution safety
- schema validation
- confidence requirements

Guardrails sit between reasoning and execution.

---

# Boundary Gates

Boundary Gates control what data and actions can cross enterprise boundaries.

Each boundary may represent:
- a system
- an application
- a network
- a plant
- a cloud environment
- a regulatory zone

Boundary Gates may:
- filter data
- redact fields
- validate entitlements
- enforce residency rules
- block execution
- emit audit events

Projection defines what AI sees.
Boundary Gates define what can cross boundaries.

---

# Capability Runtime

Capabilities are deterministic enterprise operations exposed to the orchestrator.

Examples:
- inventory analysis
- supplier risk assessment
- workflow deployment
- report generation
- simulation execution
- escalation workflows

Capabilities are:
- approved
- auditable
- deterministic
- policy-aware

The LLM does not directly execute enterprise actions.

Capabilities perform execution.

---

# Hooks

Hooks are lifecycle interception points inside orchestration workflows.

Hooks may perform:
- validation
- approvals
- telemetry capture
- rollback checks
- audit recording
- policy enforcement

Examples:
- pre-execution hook
- post-execution hook
- escalation hook
- rollback hook

---

# Audit & Telemetry

Projection records the operational lifecycle of AI-assisted execution.

Audit may include:
- user identity
- request
- retrieved context
- capability calls
- policy decisions
- execution results
- timestamps
- trace IDs

Auditability is required for enterprise trust.

---

# Deterministic Execution

Projection separates:
- probabilistic reasoning
from
- deterministic execution

The LLM assists with:
- interpretation
- summarization
- recommendations
- workflow understanding

Execution occurs through approved deterministic capabilities.

---

# Orchestration

The orchestrator coordinates:
- retrieval
- state
- workflow progression
- capability invocation
- hooks
- policy enforcement
- audit lifecycle

The orchestrator manages the flow between user intent and enterprise execution.

---

# Multi-Turn Operational Context

Projection Frames evolve during conversation.

As workflows progress, the orchestrator may:
- retrieve additional data
- update workflow state
- invoke capabilities
- refine constraints
- append telemetry

This creates a stateful operational interaction model.

---

# Projection vs Traditional AI Access

Traditional Pattern:
LLM ↔ Raw Enterprise Systems

Projection Pattern:
LLM ↔ Projection Frame ↔ Orchestrator ↔ Guardrails ↔ Capabilities ↔ Enterprise Systems

Projection reduces:
- uncontrolled access
- excessive tool exposure
- operational risk
- unbounded reasoning

while improving:
- traceability
- governance
- execution safety
- operational clarity