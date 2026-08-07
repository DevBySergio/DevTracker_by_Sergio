import { createHmac } from "crypto";
import * as path from "path";
import { PrivacySettings } from "./PrivacySettings";

export type PrivacyPathPlatform = "posix" | "win32";

export type DocumentPrivacyReason =
  | "project-excluded"
  | "document-excluded"
  | "outside-project"
  | "detail-disabled"
  | null;

export interface DocumentPrivacyDecision {
  /** Excluded documents must not contribute even aggregate activity. */
  readonly excluded: boolean;
  /** Null means no document-level detail may be persisted. */
  readonly documentIdentity: string | null;
  readonly reason: DocumentPrivacyReason;
}

export interface PrivacyPolicyOptions {
  readonly settings: PrivacySettings;
  readonly platform?: PrivacyPathPlatform;
  /** Profile-local secret material. It must not be stored in public settings. */
  readonly hashSalt?: string;
}

interface SafeDocumentPath {
  readonly projectRoot: string;
  readonly relativePath: string;
}

/** Pure policy for exclusions and privacy-safe document identities. */
export class PrivacyPolicy {
  private readonly settings: PrivacySettings;
  private readonly platform: PrivacyPathPlatform;
  private readonly hashSalt: string | undefined;

  constructor(options: PrivacyPolicyOptions) {
    this.settings = options.settings;
    this.platform = options.platform ?? platformFor(process.platform);
    this.hashSalt = options.hashSalt;
    if (
      this.settings.fileIdentityMode === "hashed" &&
      (!this.hashSalt || this.hashSalt.trim().length === 0)
    ) {
      throw new Error("Hashed file identity mode requires a non-empty salt");
    }
  }

  public isProjectExcluded(projectPath: string): boolean {
    const normalized = this.normalizeAbsoluteProjectPath(projectPath);
    if (!normalized) {
      return true;
    }
    return this.settings.projectExclusionGlobs.some((glob) =>
      globMatches(normalized, glob, this.platform),
    );
  }

  public evaluateDocument(
    projectPath: string,
    documentPath: string,
  ): DocumentPrivacyDecision {
    const safePath = this.safeDocumentPath(projectPath, documentPath);
    if (!safePath) {
      return excluded("outside-project");
    }
    if (
      this.settings.projectExclusionGlobs.some((glob) =>
        globMatches(safePath.projectRoot, glob, this.platform),
      )
    ) {
      return excluded("project-excluded");
    }
    if (
      this.settings.documentExclusionGlobs.some((glob) =>
        documentGlobMatches(safePath.relativePath, glob, this.platform),
      )
    ) {
      return excluded("document-excluded");
    }

    switch (this.settings.fileIdentityMode) {
      case "none":
        return {
          excluded: false,
          documentIdentity: null,
          reason: "detail-disabled",
        };
      case "relative":
        return {
          excluded: false,
          documentIdentity: safePath.relativePath,
          reason: null,
        };
      case "hashed":
        return {
          excluded: false,
          documentIdentity: this.hashDocumentPath(safePath),
          reason: null,
        };
    }
  }

  private safeDocumentPath(
    projectPath: string,
    documentPath: string,
  ): SafeDocumentPath | undefined {
    if (!projectPath.trim() || !documentPath.trim()) {
      return undefined;
    }
    const pathApi = this.platform === "win32" ? path.win32 : path.posix;
    const projectInput = pathInput(projectPath, this.platform);
    const documentInput = pathInput(documentPath, this.platform);
    if (!pathApi.isAbsolute(projectInput)) {
      return undefined;
    }

    const projectRoot = pathApi.resolve(projectInput);
    const absoluteDocument = pathApi.isAbsolute(documentInput)
      ? pathApi.resolve(documentInput)
      : pathApi.resolve(projectRoot, documentInput);
    const relativePath = pathApi.relative(projectRoot, absoluteDocument);
    if (
      relativePath.length === 0 ||
      relativePath === ".." ||
      relativePath.startsWith(`..${pathApi.sep}`) ||
      pathApi.isAbsolute(relativePath)
    ) {
      return undefined;
    }

    return {
      projectRoot: normalizeForComparison(projectRoot, this.platform),
      relativePath: normalizeRelativePath(relativePath, this.platform),
    };
  }

  private normalizeAbsoluteProjectPath(value: string): string | undefined {
    if (!value.trim()) {
      return undefined;
    }
    const pathApi = this.platform === "win32" ? path.win32 : path.posix;
    const input = pathInput(value, this.platform);
    return pathApi.isAbsolute(input)
      ? normalizeForComparison(pathApi.resolve(input), this.platform)
      : undefined;
  }

  private hashDocumentPath(value: SafeDocumentPath): string {
    const identityInput = `${value.projectRoot}\0${value.relativePath}`;
    const digest = createHmac("sha256", this.hashSalt!)
      .update(identityInput)
      .digest("hex");
    return `document-${digest}`;
  }
}

/** Matches `*`, `**`, and `?` with platform-aware separators and case. */
export function globMatches(
  candidate: string,
  glob: string,
  platform: PrivacyPathPlatform = platformFor(process.platform),
): boolean {
  const normalizedCandidate = normalizeForComparison(candidate, platform);
  let normalizedGlob = normalizeForComparison(glob.trim(), platform);
  if (!normalizedGlob.includes("/")) {
    normalizedGlob = `**/${normalizedGlob}`;
  }
  return new RegExp(`^${globSource(normalizedGlob)}$`).test(
    normalizedCandidate,
  );
}

function documentGlobMatches(
  relativePath: string,
  glob: string,
  platform: PrivacyPathPlatform,
): boolean {
  const projectRelativeGlob = glob.replace(/^(?:(?:\.\/)|[\\/])+/, "");
  return globMatches(relativePath, projectRelativeGlob, platform);
}

function globSource(glob: string): string {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (
      character === "/" &&
      glob[index + 1] === "*" &&
      glob[index + 2] === "*" &&
      index + 3 === glob.length
    ) {
      source += "(?:/.*)?";
      index += 2;
      continue;
    }
    if (character === "*" && glob[index + 1] === "*") {
      if (glob[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
      continue;
    }
    if (character === "*") {
      source += "[^/]*";
      continue;
    }
    if (character === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeRegExp(character);
  }
  return source;
}

function excluded(
  reason: Exclude<DocumentPrivacyReason, "detail-disabled" | null>,
): DocumentPrivacyDecision {
  return { excluded: true, documentIdentity: null, reason };
}

function pathInput(value: string, platform: PrivacyPathPlatform): string {
  return platform === "win32"
    ? value.replace(/\//g, "\\")
    : value.replace(/\\/g, "/");
}

function normalizeRelativePath(
  value: string,
  platform: PrivacyPathPlatform,
): string {
  const portable = value.replace(/\\/g, "/").replace(/^\.\//, "");
  return platform === "win32" ? portable.toLowerCase() : portable;
}

function normalizeForComparison(
  value: string,
  platform: PrivacyPathPlatform,
): string {
  let normalized = value
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/");
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function platformFor(platform: NodeJS.Platform): PrivacyPathPlatform {
  return platform === "win32" ? "win32" : "posix";
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}
