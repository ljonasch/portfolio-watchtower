import { runDailyCheck as runDailyCheckFromLifecycleService } from "./services";

export async function runDailyCheck(opts: {
  triggerType?: "scheduled" | "manual" | "debug";
  triggeredBy?: string;
  onProgress?: (step: number) => void;
} = {}): Promise<{ runId: string; reportId: string; alertLevel: string }> {
  return runDailyCheckFromLifecycleService(opts);
}
