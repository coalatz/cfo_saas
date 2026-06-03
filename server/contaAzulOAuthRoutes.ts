/**
 * Express routes for Conta Azul OAuth2 Authorization Code Flow.
 *
 * Routes:
 *   GET /api/oauth/conta-azul/authorize?tenantId=&redirectUri=
 *     → Returns { authorizeUrl } to redirect the user's browser to Conta Azul login.
 *
 *   GET /api/oauth/conta-azul/callback?code=&state=&tenantId=
 *     → Exchanges code for tokens, saves them, redirects to /tenants/:tenantId.
 *
 *   GET /api/oauth/conta-azul/status?tenantId=
 *     → Returns { connected, expired, expiresAt, needsReauth }.
 *
 *   POST /api/oauth/conta-azul/refresh?tenantId=
 *     → Manually triggers a token refresh (useful for testing).
 *
 *   POST /api/oauth/conta-azul/disconnect?tenantId=
 *     → Clears stored tokens (forces re-authorization).
 */

import { Router, type Express } from "express";
import { buildAuthorizeUrl, handleCallback, getOAuthStatus, refreshAccessToken } from "./contaAzulOAuth";
import { getDb } from "./db";
import { erpConfigs } from "../drizzle/schema";
import { and, eq } from "drizzle-orm";

export function registerContaAzulOAuthRoutes(app: Express) {
  const router = Router();

  /**
   * GET /api/oauth/conta-azul/authorize
   * Query: tenantId (number), redirectUri (string — full callback URL)
   * Returns: { authorizeUrl: string }
   */
  router.get("/authorize", async (req, res) => {
    try {
      const tenantId = parseInt(req.query.tenantId as string);
      const redirectUri = req.query.redirectUri as string;

      if (!tenantId || !redirectUri) {
        res.status(400).json({ error: "tenantId and redirectUri are required" });
        return;
      }

      // Fetch credentials from DB
      const db = await getDb();
      if (!db) { res.status(503).json({ error: "Database unavailable" }); return; }

      const rows = await db
        .select()
        .from(erpConfigs)
        .where(and(eq(erpConfigs.tenantId, tenantId), eq(erpConfigs.erpType, "conta_azul")))
        .limit(1);

      if (!rows[0]) {
        res.status(404).json({ error: "Conta Azul config not found for this tenant. Add credentials first." });
        return;
      }

      const credentials = rows[0].credentials as { client_id: string; client_secret: string };
      if (!credentials.client_id || !credentials.client_secret) {
        res.status(400).json({ error: "client_id and client_secret must be configured before OAuth" });
        return;
      }

      const authorizeUrl = await buildAuthorizeUrl(tenantId, redirectUri, credentials);
      res.json({ authorizeUrl });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  /**
   * GET /api/oauth/conta-azul/callback
   * Query: code, state, tenantId, redirectUri
   * On success: redirects to /tenants/:tenantId?oauth=success
   * On error:   redirects to /tenants/:tenantId?oauth=error&message=...
   */
  router.get("/callback", async (req, res) => {
    const code = req.query.code as string;
    const state = req.query.state as string;

    const frontendBase = `${req.protocol}://${req.get("host")}`;

    if (!code || !state) {
      res.redirect(`${frontendBase}/tenants?oauth=error&message=Missing+code+or+state`);
      return;
    }

    try {
      const result = await handleCallback(code, state);
      res.redirect(`${frontendBase}/tenants/${result.tenantId}?oauth=success`);
    } catch (err: unknown) {
      const message = encodeURIComponent(err instanceof Error ? err.message : String(err));
      // Try to extract tenantId from state for a better redirect
      let tenantId = "";
      try {
        const decoded = JSON.parse(Buffer.from(state, "base64url").toString("utf-8"));
        tenantId = decoded.tenantId ? `/${decoded.tenantId}` : "";
      } catch { /* ignore */ }
      res.redirect(`${frontendBase}/tenants${tenantId}?oauth=error&message=${message}`);
    }
  });

  /**
   * GET /api/oauth/conta-azul/status
   * Query: tenantId
   * Returns: { connected, expired, expiresAt, needsReauth }
   */
  router.get("/status", async (req, res) => {
    try {
      const tenantId = parseInt(req.query.tenantId as string);
      if (!tenantId) { res.status(400).json({ error: "tenantId is required" }); return; }
      const status = await getOAuthStatus(tenantId);
      res.json(status);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  /**
   * POST /api/oauth/conta-azul/refresh
   * Body: { tenantId }
   * Returns: { success: true, expiresAt }
   */
  router.post("/refresh", async (req, res) => {
    try {
      const tenantId = parseInt(req.body.tenantId);
      if (!tenantId) { res.status(400).json({ error: "tenantId is required" }); return; }
      await refreshAccessToken(tenantId);
      const status = await getOAuthStatus(tenantId);
      res.json({ success: true, expiresAt: status.expiresAt });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  /**
   * POST /api/oauth/conta-azul/disconnect
   * Body: { tenantId }
   * Clears tokens — user will need to re-authorize.
   */
  router.post("/disconnect", async (req, res) => {
    try {
      const tenantId = parseInt(req.body.tenantId);
      if (!tenantId) { res.status(400).json({ error: "tenantId is required" }); return; }

      const db = await getDb();
      if (!db) { res.status(503).json({ error: "Database unavailable" }); return; }

      // Read current credentials to preserve client_id/client_secret, clear tokens
      const rows = await db
        .select()
        .from(erpConfigs)
        .where(and(eq(erpConfigs.tenantId, tenantId), eq(erpConfigs.erpType, "conta_azul")))
        .limit(1);

      if (!rows[0]) { res.status(404).json({ error: "Config not found" }); return; }

      const creds = rows[0].credentials as Record<string, unknown>;
      const { access_token: _removed, ...cleanCreds } = creds as { access_token?: unknown } & Record<string, unknown>;

      await db
        .update(erpConfigs)
        .set({
          credentials: cleanCreds,
          refreshToken: null,
          tokenExpiresAt: null,
          oauthState: null,
          status: "configured",
        })
        .where(and(eq(erpConfigs.tenantId, tenantId), eq(erpConfigs.erpType, "conta_azul")));

      res.json({ success: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.use("/api/oauth/conta-azul", router);
}
