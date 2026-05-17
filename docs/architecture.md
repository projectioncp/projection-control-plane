# Projection Architecture

## Overview
Projection is an enterprise agentic control-plane pattern that creates bounded Projection Frames for AI systems. Instead of giving an LLM direct access to raw enterprise systems, Projection exposes governed operational context and approved deterministic capabilities.

## Core Flow
Request → Identity → Intent → Projection Frame → Orchestrator → Guardrail → Capability Runtime → Audit

## Architectural Principles
- AI reasons over bounded context, not raw systems.
- Execution happens through deterministic capabilities.
- Guardrails validate actions before execution.
- Boundary Gates control data/action movement across enterprise boundaries.
- Audit and telemetry capture the full lifecycle.

## Components

### Projection Frame
A bounded operational view assembled for a specific user, workflow, and decision.

Includes:
- relevant context
- workflow state
- retrieved records
- constraints
- user scope
- capability outputs

### Orchestrator
Coordinates the workflow, routes intent, manages state, invokes retrieval, and calls approved capabilities.

### Guardrail
Validates whether an action is allowed before execution.

Checks:
- authorization
- policy
- thresholds
- approvals
- schema validity
- confidence

### Boundary Gates
Local enforcement points around systems, environments, or data domains.

They control:
- what data can cross boundaries
- what actions can execute
- what must be redacted
- what must be logged

### Capability Runtime
The deterministic execution layer.

Examples:
- validate supplier risk
- analyze inventory impact
- compare workflow versions
- run approved simulation
- generate report
- trigger escalation

### Hooks
Lifecycle interception points.

Examples:
- pre-execution validation
- post-execution audit
- approval checks
- rollback checks
- telemetry capture

### Audit & Telemetry
Captures:
- user
- request
- frame
- capability
- policy decision
- execution result
- trace ID
- timestamps

## Multi-Turn Frame Updates
Projection Frames are stateful. The LLM can have a multi-turn conversation over the frame while the orchestrator updates it with retrieved context, user clarifications, workflow state, and capability outputs.

## Manufacturing MVP
The first MVP focuses on manufacturing and supply-chain workflows, including:
- supplier delay analysis
- inventory impact
- BOM/context retrieval
- governed workflow execution
- audit traceability

## What Projection Does Not Do
Projection does not give the LLM unrestricted access to enterprise systems.
Projection does not rely on free-form tool execution.
Projection does not replace deterministic business systems.
