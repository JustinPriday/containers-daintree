/**
 * Build-time replacement for Dockerode's optional ssh2 dependency.
 * Containers for Daintree intentionally supports local Unix sockets only in its macOS
 * slice, so loading this class always indicates an internal configuration bug.
 */
export class Client {
  constructor() {
    throw new Error("Containers for Daintree does not support Docker-over-SSH endpoints");
  }
}
