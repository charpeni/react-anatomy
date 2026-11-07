export interface Artifact {
  file: string;
  sha256: string;
  bytes: number;
}

export interface Release {
  schema: number;
  version: string;
  verified: boolean;
  sourceCommit?: string;
  firefoxId: string;
  artifacts: Record<'chrome' | 'firefox' | 'source', Artifact>;
}

export interface LocatedRelease extends Release {
  directory: string;
}

export interface ReleaseReceipt {
  outcome: string;
  [key: string]: unknown;
}
export type Store = 'chrome' | 'firefox';
export interface FirefoxVersion {
  id?: number;
  version: string;
  channel: string;
  reviewed?: string | null;
  is_disabled?: boolean;
  file?: { status?: string };
  source?: string | null;
}

export interface ExtensionManifest {
  version: string;
  name: string;
  icons: Record<string, string>;
  browser_specific_settings?: { gecko: { id: string } };
}

export interface ChromeResponse {
  uploadState?: string;
  lastAsyncUploadState?: string;
  crxVersion?: string;
  state?: string;
  takenDown?: boolean;
  publishedItemRevisionStatus?: ChromeRevisionStatus;
  submittedItemRevisionStatus?: ChromeRevisionStatus;
}

export interface ChromeRevisionStatus {
  state: string;
  distributionChannels?: { crxVersion: string; deployPercentage: number }[];
}

export interface FirefoxListing {
  summary?: Record<string, string>;
  categories?: Record<string, string[]>;
  version?: { license?: string };
}
