import crypto from "crypto";
import { execFile, execFileSync } from "child_process";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.resolve(__dirname, "..", ".oauth2-tokens.json");
const KEYCHAIN_SERVICE = "x-mcp.oauth2-tokens";
const KEYCHAIN_ACCOUNT = "x-mcp";
const AUTH_URL = "https://twitter.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.twitter.com/2/oauth2/token";
const REDIRECT_URI = "http://127.0.0.1:3219/callback";
const SCOPES = "bookmark.read bookmark.write tweet.read users.read offline.access";
const FILE_STORE_ERROR = "File token storage is disabled by default. Set X_MCP_TOKEN_STORE=file and X_MCP_ALLOW_FILE_TOKEN_STORE=true to use .oauth2-tokens.json.";

interface OAuth2Tokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix ms
}

type TokenStoreMode = "keychain" | "file";

function isOAuth2Tokens(value: unknown): value is OAuth2Tokens {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OAuth2Tokens>;
  return (
    typeof candidate.access_token === "string" &&
    typeof candidate.refresh_token === "string" &&
    typeof candidate.expires_at === "number" &&
    Number.isFinite(candidate.expires_at)
  );
}

function getTokenStoreMode(): TokenStoreMode {
  const configured = process.env.X_MCP_TOKEN_STORE?.trim().toLowerCase();
  if (configured === "keychain" || configured === "file") return configured;
  return process.platform === "darwin" ? "keychain" : "file";
}

function isFileStoreAllowed(): boolean {
  return process.env.X_MCP_ALLOW_FILE_TOKEN_STORE === "true";
}

function openAuthUrl(authUrl: string) {
  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "cmd"
      : "xdg-open";
  const args = process.platform === "win32"
    ? ["/c", "start", "", authUrl]
    : [authUrl];

  execFile(command, args, { windowsHide: true }, (err) => {
    if (err) {
      console.error(`Failed to open browser automatically. Open this URL manually: ${authUrl}`);
    }
  });
}

function readKeychainTokens(): string | null {
  if (process.platform !== "darwin") return null;
  try {
    return execFileSync("security", [
      "find-generic-password",
      "-a",
      KEYCHAIN_ACCOUNT,
      "-s",
      KEYCHAIN_SERVICE,
      "-w",
    ], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function writeKeychainTokens(tokens: string) {
  if (process.platform !== "darwin") {
    throw new Error("macOS Keychain token storage is only available on macOS. Set X_MCP_TOKEN_STORE=file and X_MCP_ALLOW_FILE_TOKEN_STORE=true to opt into file token storage.");
  }
  execFileSync("security", [
    "add-generic-password",
    "-a",
    KEYCHAIN_ACCOUNT,
    "-s",
    KEYCHAIN_SERVICE,
    "-w",
    tokens,
    "-U",
  ], { stdio: ["ignore", "ignore", "pipe"] });
}

function deleteKeychainTokens() {
  if (process.platform !== "darwin") return;
  try {
    execFileSync("security", [
      "delete-generic-password",
      "-a",
      KEYCHAIN_ACCOUNT,
      "-s",
      KEYCHAIN_SERVICE,
    ], { stdio: ["ignore", "ignore", "ignore"] });
  } catch {
    // Already deleted or never created.
  }
}

export class OAuth2Manager {
  private tokens: OAuth2Tokens | null = null;
  private clientId: string;
  private clientSecret: string;
  private tokenStore: TokenStoreMode;

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.tokenStore = getTokenStoreMode();
    this.loadTokens();
  }

  private loadTokens() {
    try {
      if (this.tokenStore === "keychain") {
        const raw = readKeychainTokens();
        if (!raw) return;
        const parsed = JSON.parse(raw) as unknown;
        this.tokens = isOAuth2Tokens(parsed) ? parsed : null;
        return;
      }

      if (this.tokenStore === "file" && fs.existsSync(TOKEN_FILE)) {
        if (!isFileStoreAllowed()) {
          throw new Error(FILE_STORE_ERROR);
        }
        const raw = fs.readFileSync(TOKEN_FILE, "utf-8");
        const parsed = JSON.parse(raw) as unknown;
        this.tokens = isOAuth2Tokens(parsed) ? parsed : null;
      }
    } catch {
      this.tokens = null;
    }
  }

  private saveTokens(tokens: OAuth2Tokens) {
    this.tokens = tokens;
    if (this.tokenStore === "keychain") {
      writeKeychainTokens(JSON.stringify(tokens));
      return;
    }

    if (!isFileStoreAllowed()) {
      throw new Error(FILE_STORE_ERROR);
    }

    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
    fs.chmodSync(TOKEN_FILE, 0o600);
  }

  get isAuthorized(): boolean {
    return this.tokens !== null;
  }

  clearTokens(): string {
    this.tokens = null;
    deleteKeychainTokens();
    try {
      fs.unlinkSync(TOKEN_FILE);
    } catch {
      // Already deleted or never created.
    }
    return "OAuth 2.0 tokens cleared.";
  }

  async getAccessToken(): Promise<string> {
    if (!this.tokens) {
      throw new Error(
        "OAuth 2.0 not authorized. Run the 'setup_oauth2' tool first to authorize bookmark access.",
      );
    }

    // Refresh if expired or expiring within 60s
    if (Date.now() > this.tokens.expires_at - 60_000) {
      await this.refreshAccessToken();
    }

    return this.tokens!.access_token;
  }

  private async refreshAccessToken() {
    if (!this.tokens?.refresh_token) {
      throw new Error("No refresh token available. Re-run 'setup_oauth2'.");
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.tokens.refresh_token,
      client_id: this.clientId,
    });

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`,
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      this.clearTokens();
      throw new Error(
        `OAuth 2.0 token refresh failed (HTTP ${response.status}): ${text}. Re-run 'setup_oauth2'.`,
      );
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    this.saveTokens({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    });
  }

  /**
   * Starts the OAuth 2.0 PKCE authorization flow.
   * Opens a local HTTP server, returns the URL the user must visit.
   * Resolves when the callback is received and tokens are stored.
   */
  async authorize(): Promise<string> {
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    const state = crypto.randomBytes(16).toString("hex");

    const authParams = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    const authUrl = `${AUTH_URL}?${authParams}`;

    return new Promise<string>((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        try {
          const url = new URL(req.url!, `http://127.0.0.1:3219`);
          if (url.pathname !== "/callback") {
            res.writeHead(404);
            res.end("Not found");
            return;
          }

          const code = url.searchParams.get("code");
          const returnedState = url.searchParams.get("state");

          if (!code || returnedState !== state) {
            res.writeHead(400);
            res.end("Invalid callback: missing code or state mismatch");
            server.close();
            reject(new Error("OAuth callback failed: state mismatch or missing code"));
            return;
          }

          // Exchange code for tokens
          const tokenBody = new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: REDIRECT_URI,
            code_verifier: codeVerifier,
            client_id: this.clientId,
          });

          const tokenRes = await fetch(TOKEN_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`,
            },
            body: tokenBody.toString(),
          });

          if (!tokenRes.ok) {
            const text = await tokenRes.text();
            res.writeHead(500);
            res.end(`Token exchange failed: ${text}`);
            server.close();
            reject(new Error(`Token exchange failed (HTTP ${tokenRes.status}): ${text}`));
            return;
          }

          const data = await tokenRes.json() as {
            access_token: string;
            refresh_token: string;
            expires_in: number;
          };

          this.saveTokens({
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_at: Date.now() + data.expires_in * 1000,
          });

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<h1>Authorization successful!</h1><p>You can close this tab and return to your MCP client.</p>");
          server.close();
          resolve("OAuth 2.0 authorization complete. Bookmark access is now enabled.");
        } catch (err) {
          server.close();
          reject(err);
        }
      });

      server.listen(3219, "127.0.0.1", () => {
        openAuthUrl(authUrl);
      });

      // Timeout after 2 minutes
      setTimeout(() => {
        server.close();
        reject(new Error("OAuth 2.0 authorization timed out after 2 minutes."));
      }, 120_000);
    });
  }
}
