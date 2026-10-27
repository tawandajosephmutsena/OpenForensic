const { createServer } = require("node:http");
const { createHash, randomBytes, randomUUID, timingSafeEqual } = require("node:crypto");
const { mkdir, readFile, rename, chmod, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { INSTRUCTIONS, MAX_INPUT_BYTES, responseText } = require("./agent.cjs");

const AUTH_ORIGIN = "https://auth.openai.com";
const RESOURCE = "https://api.openai.com/v1";
const TOKEN_URL = `${AUTH_ORIGIN}/api/accounts/oauth/token`;
const AUTHORIZE_URL = `${AUTH_ORIGIN}/api/accounts/authorize`;
const RESPONSES_URL = `${RESOURCE}/responses`;
const MODELS_URL = `${RESOURCE}/models`;
const REQUIRED_SCOPE = "chatgpt.tokens.use.direct";

function randomUrlSafe() { return randomBytes(32).toString("base64url"); }
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseSseBlock(block) {
  const lines = block.split(/\r?\n/);
  const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
  const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
  if (!data || data === "[DONE]") return null;
  const parsed = JSON.parse(data);
  return { type: event || parsed.type, data: parsed };
}

async function completedResponseText(response) {
  if (!response.body) throw new Error("The ChatGPT response had no stream.");
  const decoder = new TextDecoder();
  let buffer = "";
  let deltas = "";
  let completed = false;
  let finalText = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    if (buffer.length > 2_000_000) throw new Error("The ChatGPT response exceeded the stream limit.");
    let boundary;
    while ((boundary = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const block = buffer.slice(0, boundary);
      const separator = buffer[boundary] === "\r" ? (buffer[boundary + 2] === "\r" ? 4 : 3) : 2;
      buffer = buffer.slice(boundary + separator);
      const parsed = parseSseBlock(block);
      if (!parsed) continue;
      if (parsed.type === "response.output_text.delta" && typeof parsed.data.delta === "string") {
        deltas += parsed.data.delta;
        if (deltas.length > 100_000) throw new Error("The ChatGPT answer was too long.");
      } else if (parsed.type === "response.completed") {
        completed = true;
        finalText = responseText(parsed.data.response || {}) || deltas;
      } else if (parsed.type === "response.failed") {
        const code = parsed.data.response?.error?.code;
        if (code === "subscription_sharing_usage_limit_exceeded" || code === "subscription_sharing_usage_unavailable") {
          throw new Error("ChatGPT plan usage is unavailable or at its limit. Manage usage in ChatGPT Settings or use an API key.");
        }
        throw new Error("The ChatGPT response failed. Try again.");
      } else if (parsed.type === "response.incomplete") {
        throw new Error("The ChatGPT response was incomplete. Try again.");
      }
    }
  }
  if (!completed) throw new Error("The ChatGPT stream ended before completion.");
  if (!finalText.trim()) throw new Error("ChatGPT returned no text.");
  return finalText.trim();
}

function createChatGPTAuth({ userDataDir, openExternal, safeStorage, fetchImpl = fetch }) {
  const filePath = path.join(userDataDir, "chatgpt-auth.json");
  let loaded = false;
  let saved = null;
  let refreshPromise = null;
  let signInPromise = null;

  async function canProtectCredentials() {
    try {
      if (!safeStorage || !(await safeStorage.isAsyncEncryptionAvailable())) return false;
      return process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text";
    } catch { return false; }
  }

  async function persist() {
    await mkdir(userDataDir, { recursive: true, mode: 0o700 });
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    try {
      const record = { hostId: saved.hostId, activeClientId: saved.activeClientId, accounts: [] };
      const protect = await canProtectCredentials();
      for (const account of saved.accounts) {
        const { accessToken, refreshToken, idToken, ...publicFields } = account;
        const entry = { ...publicFields };
        if (protect && (accessToken || refreshToken || idToken)) {
          try {
            const encrypted = await safeStorage.encryptStringAsync(JSON.stringify({ accessToken, refreshToken, idToken }));
            entry.encryptedCredentials = encrypted.toString("base64");
          } catch { /* Session stays in memory; never write raw tokens. */ }
        }
        record.accounts.push(entry);
      }
      await writeFile(temporary, JSON.stringify(record), { mode: 0o600, flag: "wx" });
      await rename(temporary, filePath);
      if (process.platform !== "win32") await chmod(filePath, 0o600);
    } catch (error) {
      const { rm } = require("node:fs/promises");
      await rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  async function load() {
    if (loaded) return;
    let needsMigration = false;
    try {
      saved = JSON.parse(await readFile(filePath, "utf8"));
      if (!saved || !saved.hostId || !Array.isArray(saved.accounts)) throw new Error("Invalid ChatGPT credential record.");
      for (const account of saved.accounts) {
        const hadPlaintext = Boolean(account.accessToken || account.refreshToken || account.idToken);
        if (account.encryptedCredentials && await canProtectCredentials()) {
          try {
            const decrypted = await safeStorage.decryptStringAsync(Buffer.from(account.encryptedCredentials, "base64"));
            Object.assign(account, JSON.parse(decrypted.result));
          } catch { /* Keep the account registration; require sign-in again. */ }
        }
        delete account.encryptedCredentials;
        if (hadPlaintext) needsMigration = true;
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      saved = { hostId: `urn:uuid:${randomUUID()}`, accounts: [], activeClientId: null };
      await persist();
    }
    loaded = true;
    if (needsMigration) await persist();
  }

  function activeAccount() {
    return saved?.accounts.find((account) => account.clientId === saved.activeClientId) || null;
  }

  function statusSync() {
    const account = activeAccount();
    if (!account?.refreshToken || !account.scopes?.includes(REQUIRED_SCOPE)) return { connected: false, provider: null };
    return { connected: true, provider: "chatgpt", accountLabel: account.label || "ChatGPT account", model: account.model || undefined };
  }

  async function status() { await load(); return statusSync(); }

  async function metadata() {
    const response = await fetchImpl(`${AUTH_ORIGIN}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("Could not load ChatGPT sign-in configuration.");
    const config = await response.json();
    if (config.issuer !== AUTH_ORIGIN || !config.jwks_uri?.startsWith(`${AUTH_ORIGIN}/`)) throw new Error("Unexpected ChatGPT sign-in configuration.");
    return config;
  }

  async function verifyIdToken(idToken, clientId, nonce, config) {
    const { createRemoteJWKSet, jwtVerify } = await import("jose");
    const jwks = createRemoteJWKSet(new URL(config.jwks_uri));
    const result = await jwtVerify(idToken, jwks, { issuer: AUTH_ORIGIN, audience: clientId });
    if (!safeEqual(result.payload.nonce, nonce) || !result.payload.sub || !Number.isInteger(result.payload.exp) || !Number.isInteger(result.payload.iat)) throw new Error("ChatGPT identity validation failed.");
    return result.payload;
  }

  async function exchange(form) {
    const response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (error.error === "invalid_grant") throw new Error("ChatGPT sign-in expired. Try again.");
      throw new Error("ChatGPT token exchange failed. Try again.");
    }
    return response.json();
  }

  async function listenForCallback(expectedState) {
    let resolveCallback;
    let rejectCallback;
    const callback = new Promise((resolve, reject) => { resolveCallback = resolve; rejectCallback = reject; });
    void callback.catch(() => {});
    const server = createServer((request, response) => {
      const parsed = new URL(request.url || "/", "http://127.0.0.1");
      if (request.method !== "GET" || parsed.pathname !== "/auth/callback") {
        response.writeHead(404).end("Not found");
        return;
      }
      if (!safeEqual(parsed.searchParams.get("state"), expectedState)) {
        response.writeHead(400).end("Invalid sign-in state.");
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })
        .end("<!doctype html><title>Open Forensic</title><p>Return to Open Forensic to finish sign-in.</p>");
      resolveCallback(parsed.searchParams);
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const timer = setTimeout(() => rejectCallback(new Error("ChatGPT sign-in timed out. Try again.")), 300000);
    return {
      redirectUri: `http://127.0.0.1:${server.address().port}/auth/callback`,
      callback,
      close: () => { clearTimeout(timer); server.close(); },
    };
  }

  async function signIn() {
    await load();
    if (signInPromise) return signInPromise;
    signInPromise = (async () => {
      const previous = activeAccount();
      const clientId = previous?.clientId || "dynamic_agent_client";
      const state = randomUrlSafe();
      const nonce = randomUrlSafe();
      const verifier = randomUrlSafe();
      const listener = await listenForCallback(state);
      try {
        const auth = new URL(AUTHORIZE_URL);
        const params = {
          client_id: clientId,
          response_type: "code",
          redirect_uri: listener.redirectUri,
          scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
          resource: RESOURCE,
          state,
          nonce,
          code_challenge_method: "S256",
          code_challenge: createHash("sha256").update(verifier).digest("base64url"),
          ext_agent_host_id: saved.hostId,
        };
        if (clientId === "dynamic_agent_client") params.agent_name_hint = "Open Forensic";
        if (previous?.idToken) params.id_token_hint = previous.idToken;
        if (previous?.email) params.login_hint = previous.email;
        auth.search = new URLSearchParams(params).toString();
        await openExternal(auth.href);
        const callback = await listener.callback;
        if (callback.get("error")) throw new Error("ChatGPT sign-in was not completed.");
        const code = callback.get("code");
        const issuedId = callback.get("client_id") || (clientId !== "dynamic_agent_client" ? clientId : null);
        if (!code || !issuedId || issuedId === "dynamic_agent_client" || (clientId !== "dynamic_agent_client" && issuedId !== clientId)) throw new Error("ChatGPT registration was incomplete.");
        const tokens = await exchange({ grant_type: "authorization_code", client_id: issuedId, code, code_verifier: verifier, redirect_uri: listener.redirectUri, resource: RESOURCE });
        const config = await metadata();
        const identity = await verifyIdToken(tokens.id_token, issuedId, nonce, config);
        if (previous && identity.sub !== previous.subject) throw new Error("A different ChatGPT account answered this sign-in request.");
        const scopes = String(tokens.scope || "").split(/\s+/).filter(Boolean);
        if (!tokens.access_token || !tokens.refresh_token) throw new Error("ChatGPT did not return a renewable session.");
        const account = {
          clientId: issuedId,
          subject: identity.sub,
          email: typeof identity.email === "string" ? identity.email : null,
          label: typeof identity.email === "string" ? identity.email : "ChatGPT account",
          idToken: tokens.id_token,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
          scopes,
          model: null,
        };
        const oldIndex = saved.accounts.findIndex((item) => item.clientId === issuedId);
        if (oldIndex === -1) saved.accounts.push(account);
        else saved.accounts[oldIndex] = account;
        saved.activeClientId = issuedId;
        await persist();
        if (!scopes.includes(REQUIRED_SCOPE)) return { connected: false, provider: null, accountLabel: account.label, error: "ChatGPT plan usage was not granted. You can connect with an API key instead." };
        try { await listModels(); } catch { /* Saved auth remains usable; model lookup retries on ask. */ }
        return statusSync();
      } finally { listener.close(); }
    })();
    try { return await signInPromise; } finally { signInPromise = null; }
  }

  async function refresh() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const account = activeAccount();
      if (!account?.refreshToken) throw new Error("Sign in with ChatGPT again.");
      let response;
      try {
        response = await fetchImpl(TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "refresh_token", client_id: account.clientId, refresh_token: account.refreshToken, resource: RESOURCE }),
          signal: AbortSignal.timeout(30000),
        });
      } catch { throw new Error("Could not refresh ChatGPT session. Check your connection."); }
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const terminal = new Set(["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"]);
        if (terminal.has(errorBody.error)) {
          account.accessToken = null;
          account.refreshToken = null;
          account.idToken = null;
          await persist();
          throw new Error("ChatGPT session expired. Sign in again.");
        }
        throw new Error("Could not refresh ChatGPT session. Try again.");
      }
      const tokens = await response.json();
      const scopes = tokens.scope ? String(tokens.scope).split(/\s+/).filter(Boolean) : account.scopes;
      if (!tokens.access_token || !tokens.refresh_token || !scopes.includes(REQUIRED_SCOPE)) throw new Error("ChatGPT session no longer permits plan usage.");
      account.accessToken = tokens.access_token;
      account.refreshToken = tokens.refresh_token;
      account.expiresAt = Date.now() + Number(tokens.expires_in || 3600) * 1000;
      account.scopes = scopes;
      if (tokens.id_token) account.idToken = tokens.id_token;
      await persist();
      return account.accessToken;
    })();
    try { return await refreshPromise; } finally { refreshPromise = null; }
  }

  async function accessToken() {
    await load();
    const account = activeAccount();
    if (!account?.refreshToken || !account.scopes?.includes(REQUIRED_SCOPE)) throw new Error("Sign in with ChatGPT first.");
    if (!account.accessToken || Date.now() > account.expiresAt - 60000) return refresh();
    return account.accessToken;
  }

  async function listModels() {
    const token = await accessToken();
    const response = await fetchImpl(MODELS_URL, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error("Could not list models for this ChatGPT account.");
    const data = await response.json();
    const models = (data.models || []).filter((model) => model?.visibility === "list" && typeof model.slug === "string");
    if (!models.length) throw new Error("No ChatGPT models are available for this account.");
    const preferred = models.find((model) => model.slug === "gpt-5.4-mini") || models.find((model) => model.slug === "gpt-6.1-sol") || models[0];
    const account = activeAccount();
    account.model = preferred.slug;
    await persist();
    return models;
  }

  async function ask(payload) {
    await load();
    if (!payload || typeof payload !== "object" || !Object.hasOwn(INSTRUCTIONS, payload.task)) throw new Error("Invalid agent task.");
    if (typeof payload.input !== "string" || !payload.input.trim() || Buffer.byteLength(payload.input, "utf8") > MAX_INPUT_BYTES) throw new Error("Agent input must be between 1 byte and 32 KB.");
    const token = await accessToken();
    const account = activeAccount();
    if (!account.model) await listModels();
    const response = await fetchImpl(RESPONSES_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: account.model, instructions: INSTRUCTIONS[payload.task], input: [{ role: "user", content: payload.input }], store: false, stream: true }),
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) {
      if (response.status === 401) throw new Error("ChatGPT session expired. Sign in again.");
      if (response.status === 429) throw new Error("ChatGPT plan usage is at its limit. Manage usage in ChatGPT Settings or use an API key.");
      throw new Error(`ChatGPT returned an error (${response.status}).`);
    }
    return completedResponseText(response);
  }

  async function signOut() {
    await load();
    const account = activeAccount();
    if (!account) return;
    let revocationConfirmed = true;
    if (account.refreshToken) {
      try {
        const config = await metadata();
        const revokeUrl = new URL(config.revocation_endpoint);
        if (revokeUrl.origin !== AUTH_ORIGIN || revokeUrl.protocol !== "https:") throw new Error("Unexpected ChatGPT revocation endpoint.");
        const response = await fetchImpl(revokeUrl.href, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: account.refreshToken, token_type_hint: "refresh_token", client_id: account.clientId }),
          signal: AbortSignal.timeout(15000),
        });
        revocationConfirmed = response.ok;
      } catch { revocationConfirmed = false; }
    }
    account.accessToken = null;
    account.refreshToken = null;
    account.idToken = null;
    await persist();
    if (!revocationConfirmed) throw new Error("Signed out locally. Remote revocation was not confirmed; disconnect Open Forensic in ChatGPT Settings.");
  }

  return { signIn, signOut, status, ask, listModels };
}

module.exports = { createChatGPTAuth, completedResponseText, parseSseBlock };
