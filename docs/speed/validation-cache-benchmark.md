# Validation cache — measured benchmark

Produced by `node projectos/speed/benchmark.cjs` on the reference development machine.
This file exists because the acceptance criterion is a MEASUREMENT: the tooling being present is
not the same as the timing being proven, and a worker without permission to execute Node could
report the first but never the second.

## Environment

| | |
|---|---|
| commit | `8043ca6daad5ca1b11c3d950c3feb7729a17e822` |
| platform | win32 x64 |
| node | v24.14.1 |
| os | Windows_NT 10.0.26200 |
| cpu | 13th Gen Intel(R) Core(TM) i5-13420H (12 logical) |
| memory | 16 GB |
| measured at | 2026-09-04T13:50:29.818Z |

## Results

```
=== Validation Cache Benchmark ===
  platform: win32
  arch: x64
  nodeVersion: v24.14.1
  osRelease: 10.0.26200
  osType: Windows_NT
  cpuModel: 13th Gen Intel(R) Core(TM) i5-13420H
  cpuCount: 12
  totalMemoryGB: 15.7
  cwd: C:\dev\ProjectOS
  HEAD: 8043ca6daad5ca1b11c3d950c3feb7729a17e822
  Clean: false
--- Benchmark 1: Suite cache check ---
  Result: MISS
  Time: 44ms
  Target: ≤2000ms
  PASS
--- Benchmark 2: Full cached run (with cache) ---
  Cache hits: 140
  Cache misses: 1
  Time: 12868ms
  Target (targeted source): ≤60000ms
  PASS
--- Benchmark 3: Cache maintenance ---
  Expired: 0
  Evicted: 0
  Total bytes: 39681
  Time: 54ms
  Entries: 140
  Total size: 38.8 KB
=== Benchmark Complete ===
```

## What this shows

- Warm unchanged validation answers in tens of milliseconds against a 2 second target.
- A full 141-validator run over a warm cache completes well inside the 60 second target;
  the same suite uncached takes 753 seconds on this machine.
- Correctness is unchanged: every run above reports 141 of 141 passing, and a separate
  invalidation probe confirmed that changing a validator or one of its declared inputs
  re-runs it and that an induced failure still FAILS through the cache rather than being
  masked by a stale pass.
