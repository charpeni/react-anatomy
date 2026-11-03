export interface Artifact {
  file: string;
  sha256: string;
  bytes: number;
}

export interface Release {
  schema: number;
  version: string;
  verified: boolean;
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
}

export interface FirefoxListing {
  summary?: Record<string, string>;
  categories?: string[];
  version?: { license?: string };
}
