export interface TitleSampleDetail {
  title: string;
  startTime: number;
  endTime: number | null;
}

export interface HistorySession {
  id: number;
  appName: string;
  exeName: string;
  windowTitle: string;
  startTime: number;
  endTime: number | null;
  duration: number | null;
  continuityGroupStartTime: number | null;
  titleSampleDetails?: TitleSampleDetail[];
}

export interface DailySummary {
  date: string;
  totalDuration: number;
}
