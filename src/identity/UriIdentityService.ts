import { createHash } from "crypto";
import * as path from "path";
import {
  DocumentIdentity,
  ProjectIdentity,
  SCHEMA_VERSION,
} from "../domain/schemaV2";
import { Clock, FileSystemAdapter } from "../platform/ports";

export interface UriIdentityInput {
  scheme: string;
  authority: string;
  path: string;
  fsPath?: string;
}

export interface UriIdentityServiceOptions {
  clock: Clock;
  fileSystem: FileSystemAdapter;
  platform?: NodeJS.Platform;
}

export class UriIdentityService {
  private readonly clock: Clock;
  private readonly fileSystem: FileSystemAdapter;
  private readonly platform: NodeJS.Platform;

  constructor(options: UriIdentityServiceOptions) {
    this.clock = options.clock;
    this.fileSystem = options.fileSystem;
    this.platform = options.platform ?? process.platform;
  }

  public createProjectIdentity(
    uri: UriIdentityInput,
    displayName: string,
    existing?: ProjectIdentity,
  ): ProjectIdentity {
    const canonicalUri = this.canonicalize(uri);
    const now = this.clock.nowMs();
    return {
      schemaVersion: SCHEMA_VERSION,
      id: this.stableId("project", canonicalUri),
      canonicalUri,
      displayName,
      scheme: uri.scheme.toLowerCase(),
      authority: uri.authority || null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  }

  public createDocumentIdentity(
    uri: UriIdentityInput,
    projectId: string | null,
    existing?: DocumentIdentity,
  ): DocumentIdentity {
    const canonicalUri = this.canonicalize(uri);
    const now = this.clock.nowMs();
    return {
      schemaVersion: SCHEMA_VERSION,
      id: this.stableId("document", canonicalUri),
      canonicalUri,
      projectId,
      scheme: uri.scheme.toLowerCase(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  }

  public canonicalize(uri: UriIdentityInput): string {
    const scheme = uri.scheme.trim().toLowerCase();
    if (!scheme) {
      throw new Error("URI scheme must not be empty");
    }

    if (scheme === "file") {
      return this.canonicalizeFileUri(uri);
    }

    const normalizedPath = this.normalizeUriPath(uri.path);
    const encodedPath = this.encodePath(normalizedPath);
    return uri.authority
      ? `${scheme}://${uri.authority}${encodedPath}`
      : `${scheme}:${encodedPath}`;
  }

  private canonicalizeFileUri(uri: UriIdentityInput): string {
    const candidate = uri.fsPath || uri.path;
    if (!candidate) {
      throw new Error("File URI path must not be empty");
    }

    let resolved = candidate;
    try {
      resolved = this.fileSystem.realpathSync(candidate);
    } catch {
      resolved =
        this.platform === "win32"
          ? path.win32.resolve(candidate)
          : path.posix.resolve(candidate);
    }

    if (this.platform === "win32") {
      resolved = path.win32.normalize(resolved).replace(/\\/g, "/");
      resolved = resolved.replace(/^([A-Z]):/, (match) =>
        match.toLowerCase(),
      );
      if (!resolved.startsWith("/")) {
        resolved = `/${resolved}`;
      }
    } else {
      resolved = path.posix.normalize(resolved);
      if (!resolved.startsWith("/")) {
        resolved = `/${resolved}`;
      }
    }

    return `file://${this.encodePath(resolved)}`;
  }

  private normalizeUriPath(value: string): string {
    const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
    return path.posix.normalize(withLeadingSlash);
  }

  private encodePath(value: string): string {
    return value
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
  }

  private stableId(prefix: "project" | "document", canonicalUri: string): string {
    const digest = createHash("sha256").update(canonicalUri).digest("hex");
    return `${prefix}-${digest}`;
  }
}
