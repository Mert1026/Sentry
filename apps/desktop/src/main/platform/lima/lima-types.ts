/**
 * Types and error definitions for Sentry's macOS Lima virtualization backend.
 */

export type LimaSecurityErrorCode =
  | 'LIMA_BACKEND_UNSUPPORTED'
  | 'LIMA_UNSAFE_MOUNT_DETECTED'
  | 'LIMA_UNSAFE_PORT_FORWARD'
  | 'LIMA_HOST_LOOPBACK_EXPOSURE'
  | 'LIMA_UNSAFE_BYPASS_FORBIDDEN'
  | 'LIMA_VERSION_UNSUPPORTED'
  | 'LIMA_EXECUTABLE_UNAVAILABLE'
  | 'LIMA_INSTANCE_NOT_FOUND'
  | 'LIMA_INSPECTION_FAILED'
  | 'LIMA_PROVISION_FAILED';

export interface LimaMount {
  readonly location: string;
  readonly mountPoint?: string;
  readonly writable?: boolean;
  readonly [key: string]: unknown;
}

export interface LimaPortForward {
  readonly guestPort?: number;
  readonly guestPortRange?: readonly [number, number];
  readonly hostPort?: number;
  readonly hostPortRange?: readonly [number, number];
  readonly guestIP?: string;
  readonly guestIPMustBeZero?: boolean;
  readonly hostIP?: string;
  readonly proto?: 'tcp' | 'udp' | 'any' | string;
  readonly ignore?: boolean;
  readonly [key: string]: unknown;
}

export interface LimaInstanceConfig {
  readonly vmType?: string;
  readonly os?: string;
  readonly arch?: string;
  readonly mounts?: readonly LimaMount[];
  readonly portForwards?: readonly LimaPortForward[];
  readonly networkOpts?: {
    readonly hostLoopback?: boolean;
    readonly [key: string]: unknown;
  };
  readonly user?: {
    readonly name?: string;
    readonly passwordlessSudo?: boolean;
    readonly [key: string]: unknown;
  };
  readonly [key: string]: unknown;
}

export interface LimaInstanceInfo {
  readonly name: string;
  readonly status?: string;
  readonly vmType?: string;
  readonly arch?: string;
  readonly dir?: string;
  readonly sshLocalPort?: number;
  readonly config?: LimaInstanceConfig;
  readonly limaVersion?: string;
  readonly [key: string]: unknown;
}

export class LimaSecurityError extends Error {
  readonly code: LimaSecurityErrorCode;
  readonly instance?: string | undefined;
  readonly details?: readonly string[] | undefined;

  constructor(
    code: LimaSecurityErrorCode,
    message: string,
    options?: { instance?: string | undefined; details?: readonly string[] | undefined },
  ) {
    super(message);
    this.name = 'LimaSecurityError';
    this.code = code;
    if (options?.instance !== undefined) {
      this.instance = options.instance;
    }
    if (options?.details !== undefined) {
      this.details = options.details;
    }
    Object.setPrototypeOf(this, LimaSecurityError.prototype);
  }
}
