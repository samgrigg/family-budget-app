export interface Provider {
  configured: boolean;
  call(path: string, body: Record<string, unknown>): Promise<any>;
}
export class Plaid implements Provider {
  configured: boolean;
  constructor(
    private env: string,
    private clientId: string,
    private secret: string,
  ) {
    this.configured = !!(clientId && secret);
    if (!["sandbox", "production"].includes(env))
      throw Error("PLAID_ENV must be sandbox or production");
  }
  async call(path: string, body: Record<string, unknown>) {
    if (!this.configured)
      throw Object.assign(Error("Configure Plaid credentials in .env first."), {
        code: "NOT_CONFIGURED",
      });
    const r = await fetch(`https://${this.env}.plaid.com${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        client_id: this.clientId,
        secret: this.secret,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const data: any = await r.json();
    if (!r.ok)
      throw Object.assign(Error("Plaid request failed"), {
        code: data.error_code,
        requestId: data.request_id,
      });
    return data;
  }
}
