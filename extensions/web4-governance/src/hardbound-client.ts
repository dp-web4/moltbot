/**
 * Hardbound PolicyService Client
 *
 * Wraps HTTP calls to the Hardbound server for server-side policy evaluation.
 * Designed for fail-open behavior: if the server is unreachable, callers
 * fall back to local evaluation (PolicyEngine + PolicyModel).
 */

// -- Request/Response Types --

export type HardboundEvaluateRequest = {
  actor_lct: string;
  action_type: string;
  target: string | undefined;
  parameters: Record<string, unknown>;
  role_context: {
    session_id: string;
    agent_id?: string;
    action_index: number;
    plugin_id?: string;
  };
};

export type HardboundEvaluateResponse = {
  request_id: string;
  decision: "approve" | "deny" | "escalate";
  reason: string;
  constraints: string[];
  signature: string;
  /** Server-side confidence score (0-1) */
  confidence?: number;
};

export type HardboundOutcomeRequest = {
  request_id: string;
  success: boolean;
  result_hash: string | undefined;
};

export type HardboundRegisterRequest = {
  plugin_name: string;
  plugin_version: string;
  capabilities: string[];
};

export type HardboundRegisterResponse = {
  plugin_id: string;
  lct_id: string;
  trust_ceiling: number;
};

export type HardboundHeartbeatRequest = {
  plugin_id: string;
};

// -- Client --

export type HardboundClientConfig = {
  /** Base URL for the Hardbound server (e.g. http://localhost:9400) */
  serverUrl: string;
  /** Request timeout in ms (default: 3000) */
  timeoutMs?: number;
  /** Plugin name for registration */
  pluginName?: string;
  /** Plugin version for registration */
  pluginVersion?: string;
};

export class HardboundClient {
  private serverUrl: string;
  private timeoutMs: number;
  private pluginName: string;
  private pluginVersion: string;

  /** Set after successful register() call */
  private _pluginId: string | undefined;
  private _lctId: string | undefined;
  private _trustCeiling: number | undefined;

  /** Tracks whether the server was reachable on last attempt */
  private _serverReachable = false;

  /** Timestamp of last successful server contact */
  private _lastContactMs = 0;

  /** Heartbeat interval handle */
  private _heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  constructor(config: HardboundClientConfig) {
    // Strip trailing slash
    this.serverUrl = config.serverUrl.replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? 3000;
    this.pluginName = config.pluginName ?? "web4-governance";
    this.pluginVersion = config.pluginVersion ?? "2026.1.27-beta.1";
  }

  // -- Public API --

  get pluginId(): string | undefined {
    return this._pluginId;
  }

  get lctId(): string | undefined {
    return this._lctId;
  }

  get trustCeiling(): number | undefined {
    return this._trustCeiling;
  }

  get serverReachable(): boolean {
    return this._serverReachable;
  }

  get lastContactMs(): number {
    return this._lastContactMs;
  }

  /**
   * Register this plugin with the Hardbound server.
   * Returns true on success, false on failure (server unreachable).
   */
  async register(): Promise<boolean> {
    const body: HardboundRegisterRequest = {
      plugin_name: this.pluginName,
      plugin_version: this.pluginVersion,
      capabilities: ["policy-evaluation", "audit-trail", "r6-workflow"],
    };

    try {
      const resp = await this.post<HardboundRegisterResponse>(
        "/api/v1/plugin/register",
        body,
      );
      this._pluginId = resp.plugin_id;
      this._lctId = resp.lct_id;
      this._trustCeiling = resp.trust_ceiling;
      this._serverReachable = true;
      this._lastContactMs = Date.now();
      return true;
    } catch {
      this._serverReachable = false;
      return false;
    }
  }

  /**
   * Evaluate a tool call against the Hardbound PolicyService.
   * Returns the server's signed decision, or null if the server is unreachable.
   */
  async evaluate(
    req: HardboundEvaluateRequest,
  ): Promise<HardboundEvaluateResponse | null> {
    // Inject plugin_id into role_context if we have one
    if (this._pluginId) {
      req.role_context.plugin_id = this._pluginId;
    }

    try {
      const resp = await this.post<HardboundEvaluateResponse>(
        "/api/v1/policy/evaluate",
        req,
      );
      this._serverReachable = true;
      this._lastContactMs = Date.now();
      return resp;
    } catch {
      this._serverReachable = false;
      return null;
    }
  }

  /**
   * Report an action outcome to the Hardbound server.
   * Fire-and-forget: failures are silently ignored.
   */
  async reportOutcome(req: HardboundOutcomeRequest): Promise<void> {
    try {
      await this.post("/api/v1/policy/outcome", req);
      this._serverReachable = true;
      this._lastContactMs = Date.now();
    } catch {
      this._serverReachable = false;
    }
  }

  /**
   * Send a heartbeat to the server. Called periodically to maintain
   * registration and track reachability.
   */
  async heartbeat(): Promise<boolean> {
    if (!this._pluginId) return false;

    const body: HardboundHeartbeatRequest = { plugin_id: this._pluginId };
    try {
      await this.post("/api/v1/plugin/heartbeat", body);
      this._serverReachable = true;
      this._lastContactMs = Date.now();
      return true;
    } catch {
      this._serverReachable = false;
      return false;
    }
  }

  /**
   * Start periodic heartbeat (default: every 30s).
   */
  startHeartbeat(intervalMs = 30_000): void {
    this.stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      void this.heartbeat();
    }, intervalMs);
    // Don't hold the process open
    if (this._heartbeatTimer && typeof this._heartbeatTimer === "object" && "unref" in this._heartbeatTimer) {
      this._heartbeatTimer.unref();
    }
  }

  /**
   * Stop periodic heartbeat.
   */
  stopHeartbeat(): void {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = undefined;
    }
  }

  // -- Internal --

  private async post<T = unknown>(path: string, body: unknown): Promise<T> {
    const url = `${this.serverUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!resp.ok) {
        throw new Error(`Hardbound server returned ${resp.status}: ${resp.statusText}`);
      }

      return (await resp.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
