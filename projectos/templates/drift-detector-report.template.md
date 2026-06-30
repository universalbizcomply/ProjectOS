# Drift Detector Report — <PHASE_ID>

> Recommendation is not approval. The detector compares supplied files only; it never connects, inspects live, or repairs.

## Detector result
<NO-DRIFT | DRIFT-DETECTED | HARD-STOP | BLOCKED>

## Request validation
- required fields: <PASS|FAIL>
- target environment: <env> (production refused by default)
- liveInspectionRequested: false
- secretsAccessed: false
- repairRequested: false

## Policy validation
- production refuse by default: true
- live inspection allowed: false
- repair allowed: false
- approval inferred: false

## Snapshot validation
- expected snapshot: <PASS|FAIL>
- observed snapshot: <PASS|FAIL>

## Drift categories checked
- <category list>

## Findings by severity
- BLOCKER: <n> · CRITICAL: <n> · HIGH: <n> · MEDIUM: <n> · LOW: <n> · INFO: <n>

## Blockers
- <blocker or none>

## Carry-forward
- <item>

## Recommendation
<advisory recommendation — NOT an approval>

## Decision needed
<exact owner/advisor decision>