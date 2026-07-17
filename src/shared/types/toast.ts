export type QuietToastTone = "success" | "warning" | "error" | "info";

export interface QuietToastItem {
  id: number;
  message: string;
  tone: QuietToastTone;
}
