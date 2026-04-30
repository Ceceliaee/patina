import { buildTimelineSessions } from "../../src/shared/lib/sessionReadCompiler.ts";
import { compileForRange, materializeLiveSessions } from "../../src/shared/lib/readModelCore.ts";
import { buildHistoryReadModel } from "../../src/features/history/services/historyReadModel.ts";
import { resolveTrackerHealth } from "../../src/shared/types/tracking.ts";
import type { HistorySession } from "../../src/shared/lib/sessionReadRepository.ts";
import { measureBenchmark, printBenchmarkReport } from "./benchmarkUtils.ts";

function makeSession(id: number, startTime: number, duration: number, exeName: string): HistorySession {
  return {
    id,
    appName: exeName.replace(/\.exe$/i, ""),
    exeName,
    windowTitle: `${exeName} Window ${id}`,
    startTime,
    endTime: startTime + duration,
    duration,
    continuityGroupStartTime: startTime,
  };
}

function buildSyntheticSessions(): HistorySession[] {
  const sessions: HistorySession[] = [];
  const executables = ["QQ.exe", "chrome.exe", "cursor.exe", "Code.exe", "WeChat.exe"];
  const baseStart = new Date(2026, 3, 18, 0, 0, 0, 0).getTime();

  for (let day = 0; day < 7; day += 1) {
    const dayStart = baseStart - day * 24 * 60 * 60 * 1000;
    for (let index = 0; index < 700; index += 1) {
      const exeName = executables[index % executables.length];
      const startTime = dayStart + index * 60_000;
      const duration = 30_000 + (index % 9) * 10_000;
      sessions.push(makeSession(day * 1000 + index, startTime, duration, exeName));
    }
  }

  return sessions;
}

const sessions = buildSyntheticSessions();
const trackerHealth = resolveTrackerHealth(Date.now(), Date.now(), 8_000);
const selectedDate = new Date(2026, 3, 18, 12, 0, 0, 0);
const nowMs = selectedDate.getTime();
const rangeStart = new Date(2026, 3, 18, 0, 0, 0, 0).getTime();
const rangeEnd = new Date(2026, 3, 19, 0, 0, 0, 0).getTime();
const iterations = 250;

const liveSessions = materializeLiveSessions(sessions, trackerHealth, nowMs);

const reference = measureBenchmark("compile-and-timeline-reference", iterations, 130, () => {
  const compiledSessions = compileForRange(liveSessions, { startMs: rangeStart, endMs: rangeEnd }, 0);
  const timelineSourceSessions = compileForRange(liveSessions, { startMs: rangeStart, endMs: rangeEnd }, 0);
  buildTimelineSessions(timelineSourceSessions, 180);
  void compiledSessions;
});

const optimized = measureBenchmark("current-history-read-model", iterations, 170, () => {
  buildHistoryReadModel({
    daySessions: sessions,
    weeklySessions: sessions,
    selectedDate,
    trackerHealth,
    nowMs,
    minSessionSecs: 0,
    mergeThresholdSecs: 180,
  });
});

printBenchmarkReport({
  benchmark: "history-read-model",
  measuredAt: new Date().toISOString(),
  measurements: [reference, optimized],
  metadata: {
    sessionCount: sessions.length,
    selectedDate: selectedDate.toISOString(),
    comparisonNotes: [
      "compile-and-timeline-reference measures only the old hot subpath shape.",
      "current-history-read-model measures the full current read model, including weekly summaries, chart data, app summary, timeline, and diagnostics.",
      "Treat these as budgeted reference measurements, not direct optimization deltas.",
    ],
  },
});
