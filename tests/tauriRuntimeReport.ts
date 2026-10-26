import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, release, totalmem } from "node:os";
import { join } from "node:path";

function failureDetails(error: unknown): unknown {
  return error instanceof AggregateError ? { name: error.name, message: error.message, errors: error.errors.map(failureDetails) }
    : error instanceof Error ? { name: error.name, message: error.message, stack: error.stack, cause: error.cause ? failureDetails(error.cause) : undefined } : error;
}

export class RuntimeReport {
  readonly id = `${Date.now()}-${randomUUID()}`;
  readonly output = join("artifacts", "runtime-smoke", this.id);
  readonly startedAt = new Date().toISOString();
  readonly started = performance.now();
  readonly events: Array<{ phase: string; kind: "start" | "end"; atMs: number; status?: string }> = [];
  readonly results: Array<{ group: string; status: string }> = [];
  metadata: Record<string, unknown> = {};
  private phase: string | null = null;
  readonly selection: string;
  constructor(selection: string) { this.selection = selection; mkdirSync(this.output, { recursive: true }); }
  enter(phase: string) {
    this.leave("completed");
    this.phase = phase;
    this.events.push({ phase, kind: "start", atMs: performance.now() - this.started });
    console.log(`PATINA_RUNTIME_PHASE ${phase}`);
    this.save("running");
  }
  leave(status: string) {
    if(this.phase) this.events.push({ phase: this.phase, kind: "end", atMs: performance.now() - this.started, status });
    this.phase = null;
  }
  save(status: string, error?: unknown) {
    writeFileSync(join(this.output, "result.json"), JSON.stringify({
      id: this.id, selection: this.selection, startedAt: this.startedAt,
      elapsedMs: performance.now() - this.started, status, events: this.events, results: this.results,
      environment: { platform: process.platform, architecture: process.arch, os: release(), node: process.version, cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem() },
      metadata: this.metadata, error: failureDetails(error),
    }, null, 2) + "\n", "utf8");
  }
}
