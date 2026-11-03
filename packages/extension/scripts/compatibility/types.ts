export interface ValidationCase {
  id: string;
  kind: string;
  url?: string;
  selector?: string;
  application?: string;
  mode?: string;
  react?: string;
}

export interface CaptureSummary {
  components: number;
  planes: number;
  partial: string | null;
  footer?: string;
}

export interface RuntimeSummary {
  react: string | null;
  next: string | null;
  reactDevtoolsHookPresent: boolean;
  url: string;
  title: string;
}

export interface CaseResult extends ValidationCase {
  startedAt: string;
  runtime?: RuntimeSummary;
  capture?: CaptureSummary;
  expandedCapture?: CaptureSummary;
  checks?: string[];
  selectedComponent?: string;
  sourceErrors?: string[] | null;
  status?: 'passed' | 'failed';
  error?: string;
  panelDiagnostic?: string;
  elapsedMs?: number;
}

export interface ValidationReport {
  startedAt: string;
  browser: string;
  browserVersion?: string;
  extensionVersion?: string;
  panelSha256?: string;
  cases: CaseResult[];
  finishedAt?: string;
  passed?: boolean;
}
