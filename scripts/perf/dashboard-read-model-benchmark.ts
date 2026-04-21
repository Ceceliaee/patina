import type { HistorySession } from "../../src/shared/lib/sessionReadRepository.ts";
import { resolveTrackerHealth } from "../../src/shared/types/tracking.ts";
import { buildDashboardReadModel } from "../../src/features/dashboard/services/dashboardReadModel.ts";
import { measureBenchmark, printBenchmarkReport } from "./benchmarkUtils.ts";

function makeSession(id: number, startTime: number, duration: number, exeName: string): HistorySession {
  return {
    id,
    app_name: exeName.replace(/\.exe$/i, ""),
    exe_name: exeName,
    window_title: `${exeName} Window ${id}`,
    start_time: startTime,
    end_time: startTime + duration,
    duration,
  };
}

function buildSyntheticSessions(): HistorySession[] {
  const sessions: HistorySession[] = [];
  const executables = ["QQ.exe", "chrome.exe", "cursor.exe", "Code.exe", "WeChat.exe"];
  const dayStart = new Date(2026, 3, 18, 0, 0, 0, 0).getTime();

  for (let index = 0; index < 2_400; index += 1) {
    const exeName = executables[index % executables.length];
    const startTime = dayStart + index * 30_000;
    const duration = 20_000 + (index % 7) * 15_000;
    sessions.push(makeSession(index + 1, startTime, duration, exeName));
  }

  return sessions;
}

const sessions = buildSyntheticSessions();
const nowMs = new Date(2026, 3, 18, 20, 0, 0, 0).getTime();
const trackerHealth = resolveTrackerHealth(nowMs, nowMs, 8_000);
const iterations = 400;

const measurement = measureBenchmark("dashboard-read-model", iterations, 25, () => {
  buildDashboardReadModel(sessions, trackerHealth, nowMs);
});

printBenchmarkReport({
  benchmark: "dashboard-read-model",
  measuredAt: new Date().toISOString(),
  measurements: [measurement],
  metadata: {
    sessionCount: sessions.length,
    nowMs,
  },
});
