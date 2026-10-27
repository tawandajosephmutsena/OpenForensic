const assert = require("node:assert/strict");
const { mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createAgentService } = require("../desktop/agent.cjs");
const { completedResponseText, createChatGPTAuth } = require("../desktop/chatgpt.cjs");

async function main() {
  const requests = [];
  const service = createAgentService(async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ output: [{ type: "message", content: [{ type: "output_text", text: "OK" }] }] }) };
  });
  assert.deepEqual(service.status(), { connected: false });
  assert.deepEqual(await service.connect("test-key"), { connected: true });
  assert.equal(service.status().connected, true);
  assert.equal(await service.ask({ task: "map", input: "Date,Amount" }), "OK");
  const body = JSON.parse(requests[1].options.body);
  assert.equal(requests[1].url, "https://api.openai.com/v1/responses");
  assert.equal(body.model, "gpt-5.4-mini");
  assert.equal(body.store, false);
  assert.equal(body.max_output_tokens, 500);
  assert.ok(body.instructions.includes("zero-based column indexes"));
  await assert.rejects(service.ask({ task: "browse", input: "x" }), /Invalid agent task/);
  await assert.rejects(service.ask({ task: "map", input: "x".repeat(32769) }), /32 KB/);
  service.disconnect();
  assert.equal(service.status().connected, false);
  await assert.rejects(service.ask({ task: "map", input: "x" }), /Connect your AI agent/);

  const sse = new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('event: response.output_text.delta\ndata: {"delta":"Hello"}\n\nevent: response.completed\ndata: {"response":{"output":[{"type":"message","content":[{"type":"output_text","text":"Hello"}]}]}}\n\n'));
    controller.close();
  } }));
  assert.equal(await completedResponseText(sse), "Hello");
  const incomplete = new Response(new ReadableStream({ start(controller) { controller.close(); } }));
  await assert.rejects(completedResponseText(incomplete), /before completion/);

  const directory = await mkdtemp(path.join(os.tmpdir(), "open-forensic-auth-"));
  try {
    const credentialFile = path.join(directory, "chatgpt-auth.json");
    const legacy = { hostId: "urn:uuid:test-host", activeClientId: "oaiapp_test", accounts: [{ clientId: "oaiapp_test", subject: "subject", scopes: ["chatgpt.tokens.use.direct"], accessToken: "access-secret", refreshToken: "refresh-secret", idToken: "id-secret", expiresAt: Date.now() - 1 }] };
    await writeFile(credentialFile, JSON.stringify(legacy));
    const safeStorage = {
      isAsyncEncryptionAvailable: async () => true,
      getSelectedStorageBackend: () => "gnome_libsecret",
      encryptStringAsync: async (value) => Buffer.from(`protected:${value}`),
      decryptStringAsync: async (buffer) => ({ result: buffer.toString().slice("protected:".length) }),
    };
    const oauthRequests = [];
    const fetchImpl = async (url, options = {}) => {
      oauthRequests.push({ url, options });
      if (url.endsWith("/oauth/token")) return { ok: true, json: async () => ({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }) };
      if (url.endsWith("/models")) return { ok: true, json: async () => ({ models: [{ slug: "gpt-5.4-mini", visibility: "list" }] }) };
      if (url.endsWith("/responses")) return new Response('event: response.completed\ndata: {"response":{"output":[{"type":"message","content":[{"type":"output_text","text":"Reviewed"}]}]}}\n\n', { headers: { "Content-Type": "text/event-stream" } });
      throw new Error(`Unexpected URL: ${url}`);
    };
    const auth = createChatGPTAuth({ userDataDir: directory, openExternal: async () => {}, safeStorage, fetchImpl });
    assert.equal((await auth.status()).connected, true);
    assert.equal(await auth.ask({ task: "interpret", input: "Finding F-1" }), "Reviewed");
    const streamed = JSON.parse(oauthRequests.find((request) => request.url.endsWith("/responses")).options.body);
    assert.equal(streamed.store, false);
    assert.equal(streamed.stream, true);
    assert.ok(Array.isArray(streamed.input));
    assert.ok(!Object.hasOwn(streamed, "max_output_tokens"));
    const protectedRecord = await readFile(credentialFile, "utf8");
    assert.ok(protectedRecord.includes("encryptedCredentials"));
    assert.ok(!protectedRecord.includes("access-secret"));
    assert.ok(!protectedRecord.includes("refresh-secret"));
    const reloaded = createChatGPTAuth({ userDataDir: directory, openExternal: async () => {}, safeStorage });
    assert.equal((await reloaded.status()).connected, true);
  } finally { await rm(directory, { recursive: true, force: true }); }

  const fallbackDirectory = await mkdtemp(path.join(os.tmpdir(), "open-forensic-session-only-"));
  try {
    const credentialFile = path.join(fallbackDirectory, "chatgpt-auth.json");
    const record = { hostId: "urn:uuid:test-host", activeClientId: "oaiapp_test", accounts: [{ clientId: "oaiapp_test", subject: "subject", scopes: ["chatgpt.tokens.use.direct"], accessToken: "access-secret", refreshToken: "refresh-secret", idToken: "id-secret", expiresAt: Date.now() + 3600000 }] };
    await writeFile(credentialFile, JSON.stringify(record));
    const unavailableStorage = { isAsyncEncryptionAvailable: async () => false };
    const session = createChatGPTAuth({ userDataDir: fallbackDirectory, openExternal: async () => {}, safeStorage: unavailableStorage });
    assert.equal((await session.status()).connected, true);
    const onDisk = await readFile(credentialFile, "utf8");
    assert.ok(!onDisk.includes("access-secret") && !onDisk.includes("refresh-secret") && !onDisk.includes("id-secret"));
    assert.ok(!onDisk.includes("encryptedCredentials"));
    const nextSession = createChatGPTAuth({ userDataDir: fallbackDirectory, openExternal: async () => {}, safeStorage: unavailableStorage });
    assert.equal((await nextSession.status()).connected, false);
  } finally { await rm(fallbackDirectory, { recursive: true, force: true }); }
  console.log("Desktop agent bridge checks passed.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
