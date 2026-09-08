const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

// Transpile the actual utilities in isolated globals; no SDK, network or account.
function loadUtility(name, extra = {}) {
  let now = 0;
  let nextTimer = 0;
  const timers = new Map();
  const context = {
    exports: {},
    console,
    Date: { now: () => now },
    setTimeout: (callback) => {
      timers.set(++nextTimer, callback);
      return nextTimer;
    },
    clearTimeout: (id) => timers.delete(id),
    setInterval: (callback) => {
      timers.set(++nextTimer, callback);
      return nextTimer;
    },
    clearInterval: (id) => timers.delete(id),
    AbortController,
    DOMException,
    Request,
    URL,
    ...extra,
  };
  const filename = path.join(__dirname, "../src/utils", name);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  vm.runInNewContext(outputText, context, { filename });
  return { context, timers, setNow: (value) => (now = value) };
}

const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

for (const reason of ["invalidated", "expired"]) {
  test(`drains 10000 ${reason} requests and runs the next valid request`, async () => {
    const { context, timers, setNow } = loadUtility("imSdkRequestScheduler.ts");
    const schedule = context.exports.scheduleIMSDKRequest;
    let release;
    let valid = true;
    const first = schedule(() => new Promise((resolve) => (release = resolve)));
    await flush();
    let settled = 0;
    let incorrectlyRun = 0;
    const results = Array.from({ length: 10000 }, () =>
      schedule(
        () => {
          incorrectlyRun++;
          return Promise.resolve();
        },
        reason === "invalidated" ? { isValid: () => valid } : { timeoutMs: 10 },
      ).then(
        (value) => {
          settled++;
          assert.equal(reason, "invalidated");
          assert.equal(value, undefined);
        },
        (error) => {
          settled++;
          assert.equal(reason, "expired");
          assert.equal(error.name, "IMSDKRequestTimeoutError");
        },
      ),
    );
    valid = false;
    if (reason === "expired") setNow(20);
    const next = schedule(() => Promise.resolve("next"));
    release();
    await flush();
    assert.equal(settled, 10000);
    await Promise.all([first, ...results]);
    assert.equal(await next, "next");
    assert.equal(incorrectlyRun, 0);
    assert.equal(timers.size, 0);
  });
}

test("keeps request priority and recovers after a failed request", async () => {
  const { context } = loadUtility("imSdkRequestScheduler.ts");
  const schedule = context.exports.scheduleIMSDKRequest;
  const order = [];
  let release;
  const first = schedule(() => new Promise((resolve) => (release = resolve)));
  await flush();
  const queued = ["low", "normal", "high"].map((priority) =>
    schedule(
      () => {
        order.push(priority);
        if (priority === "high") throw new Error("request failed");
        return Promise.resolve(priority);
      },
      { lane: "background", priority },
    ).catch((error) => error.message),
  );
  release();
  await Promise.all([first, ...queued]);
  assert.deepEqual(order, ["high", "normal", "low"]);
});

function loadFetchScheduler() {
  const calls = [];
  const utility = loadUtility("groupMemberRequestScheduler.ts", {
    fetch: (input, init) =>
      new Promise((resolve, reject) => {
        const call = { input, init, resolve, reject };
        calls.push(call);
        if (init?.signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
        } else {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }
      }),
  });
  utility.context.exports.installGroupMemberRequestScheduler();
  return { ...utility, calls };
}

const memberURL = "https://example.invalid/group/get_group_member_list";

test("limits fetch in a worker global without window; installation is idempotent", async () => {
  const { context, calls, timers } = loadFetchScheduler();
  assert.equal(context.window, undefined);
  const installedFetch = context.fetch;
  context.exports.installGroupMemberRequestScheduler();
  assert.equal(context.fetch, installedFetch);
  const requests = Array.from({ length: 8 }, (_, i) =>
    context.fetch(`${memberURL}?page=${i}`, { method: "POST", body: "members" }),
  );
  await flush();
  assert.equal(calls.length, 4);
  assert.equal(calls[0].init.body, "members");
  calls.slice(0, 4).forEach((call) => call.resolve({ ok: true }));
  await flush();
  assert.equal(calls.length, 8);
  calls.slice(4).forEach((call) => call.resolve({ ok: true }));
  await Promise.all(requests);
  await flush();
  assert.equal(timers.size, 0);
});

test("does not throttle unrelated endpoints or lose their request options", async () => {
  const { context, calls } = loadFetchScheduler();
  const init = { method: "POST", body: "payload" };
  const requests = Array.from({ length: 6 }, () =>
    context.fetch("https://example.invalid/user/get_users_info", init),
  );
  assert.equal(calls.length, 6);
  assert.equal(calls[0].init, init);
  calls.forEach((call) => call.resolve({ ok: true }));
  await Promise.all(requests);
});

test("cancels queued and active requests, times out, and releases slots", async () => {
  const { context, calls, timers } = loadFetchScheduler();
  const controllers = Array.from({ length: 6 }, () => new AbortController());
  const requests = controllers.map((controller) =>
    context
      .fetch(new Request(memberURL, { signal: controller.signal }))
      .catch((error) => error.name),
  );
  await flush();
  assert.equal(calls.length, 4);
  controllers[4].abort();
  assert.equal(await requests[4], "AbortError");
  controllers[0].abort();
  await flush();
  assert.equal(await requests[0], "AbortError");
  assert.equal(calls.length, 5); // sixth request replaces the cancelled first
  const [timerID, timeout] = timers.entries().next().value;
  timers.delete(timerID);
  timeout();
  await flush();
  assert.equal(await requests[1], "TimeoutError");
  calls.slice(2).forEach((call) => call.resolve({ ok: true }));
  await Promise.all(requests);
  await flush();
  assert.equal(timers.size, 0);
  const last = context.fetch(memberURL);
  await flush();
  assert.equal(calls.length, 6);
  calls[5].resolve({ ok: true });
  await last;
});

test("a synchronous fetch failure does not strand queued requests", async () => {
  let attempts = 0;
  const { context, timers } = loadUtility("groupMemberRequestScheduler.ts", {
    fetch: () => {
      if (++attempts <= 4) throw new Error("fetch unavailable");
      return Promise.resolve({ ok: true });
    },
  });
  context.exports.installGroupMemberRequestScheduler();
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      context.fetch(memberURL).catch((error) => error.message),
    ),
  );
  await flush();
  assert.equal(attempts, 5);
  assert.equal(results[4].ok, true);
  assert.equal(timers.size, 0);
});
