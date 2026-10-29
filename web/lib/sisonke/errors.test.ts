import { describe, expect, test } from "vitest";
import { escrow } from "@/tests/fixtures";
import { CONTRACT_ERRORS, SisonkeError, contractCode, toSisonkeError } from "./errors";

const sim = (code: number) => new Error(`HostError: Error(Contract, #${code})\n\nEvent log (newest first):\n   0: [Diagnostic Event] ...`);

describe("contract codes", () => {
  test("parses the code out of simulation text", () => {
    expect(contractCode("HostError: Error(Contract, #101)")).toBe(101);
    expect(contractCode("nothing here")).toBeNull();
  });

  test("every Sisonke code maps to its entry", () => {
    for (const [code, entry] of Object.entries(CONTRACT_ERRORS)) {
      const e = toSisonkeError(sim(Number(code)), { method: "fund", escrow: escrow({ status: "Created" }) });
      expect(e.code).toBe(Number(code));
      expect(e.title).toBe(entry.title);
      expect(e.body.length).toBeGreaterThan(0);
    }
  });

  test("101 wording follows the method and the escrow's status", () => {
    const body = (method: string, status: Parameters<typeof escrow>[0]) => toSisonkeError(sim(101), { method, escrow: escrow(status) }).body;
    expect(body("fund", { status: "Funded" })).toBe("This escrow is already funded. It can't be funded twice. Nothing moved.");
    expect(body("release", { status: "Created" })).toBe("Nothing is locked yet, so there's nothing to release. Nothing moved.");
    expect(body("refund", { status: "Created" })).toBe("Nothing is locked yet, so there's nothing to refund. Nothing moved.");
    expect(body("release", { status: "Released" })).toBe("This escrow is already released. Nothing pays out twice. Nothing moved.");
    expect(body("refund", { status: "Refunded" })).toBe("This escrow is already refunded. Nothing pays out twice. Nothing moved.");
    expect(body("fund", { status: "Cancelled" })).toBe("This escrow is already cancelled. Nothing pays out twice. Nothing moved.");
    expect(body("reclaim", { status: "Disputed" })).toBe("A dispute is open, so only the arbiter can send money back. Nothing moved.");
    expect(body("cancel", { status: "Funded" })).toBe("The escrow's status doesn't allow that any more. Refresh to see where it is. Nothing moved.");
    expect(toSisonkeError(sim(101), {}).title).toBe("Already moved on");
  });

  test("102 by method, 103 with the deadline, 106 with the amount, 141 offers the migration", () => {
    expect(toSisonkeError(sim(102), { method: "dispute" }).body).toMatch(/^The deadline has passed, so a dispute can't be opened/);
    expect(toSisonkeError(sim(102), { method: "fund" }).body).toMatch(/won't take a deposit/);
    expect(toSisonkeError(sim(103), { method: "reclaim", escrow: escrow() }).body).toMatch(/before \d{1,2} \w{3} \d{4}, \d{2}:\d{2}\./);
    expect(toSisonkeError(sim(106), { method: "resolve", escrow: escrow() }).body).toBe(
      "The recipient's share must be between 0 and 250.00 USDC. Nothing moved.",
    );
    expect(toSisonkeError(sim(141), {}).fix).toEqual({ label: "Run the migration", action: "migrate" });
  });

  test("unknown Sisonke codes still read as a refusal", () => {
    expect(toSisonkeError(sim(199), {})).toMatchObject({ code: 199, title: "The contract refused" });
  });
});

describe("USDC SAC codes", () => {
  test("13 names whose wallet, with a fix only for your own", () => {
    expect(toSisonkeError(sim(13), { method: "fund" })).toMatchObject({
      code: 13,
      title: "Your wallet can't hold USDC yet",
      fix: { label: "Add the trustline", href: "/setup" },
    });
    expect(toSisonkeError(sim(13), { method: "create_and_fund" }).title).toBe("Your wallet can't hold USDC yet");
    const release = toSisonkeError(sim(13), { method: "release" });
    expect(release.title).toBe("The recipient's wallet can't hold USDC yet");
    expect(release.fix).toBeUndefined();
    expect(toSisonkeError(sim(13), { method: "refund" }).title).toBe("The payer's wallet can't hold USDC yet");
    expect(toSisonkeError(sim(13), { method: "reclaim" }).title).toBe("The payer's wallet can't hold USDC yet");
    expect(toSisonkeError(sim(13), { method: "resolve" }).title).toBe("The payer's or the recipient's wallet can't hold USDC yet");
  });
  test("6, 10, 11 and the others", () => {
    expect(toSisonkeError(sim(6), { method: "fund" }).title).toBe("That wallet isn't on Testnet yet");
    expect(toSisonkeError(sim(10), { method: "fund" })).toMatchObject({ title: "Not enough USDC", body: "Your wallet doesn't hold enough USDC for this. Nothing moved." });
    expect(toSisonkeError(sim(11), { method: "release" }).body).toBe(
      "Circle has frozen USDC for the recipient's wallet, so it can't send or receive it. Nothing moved.",
    );
    expect(toSisonkeError(sim(3), { method: "fund" })).toMatchObject({ title: "USDC refused the transfer", body: "The USDC contract returned error #3. Nothing moved." });
  });
});

describe("other failures", () => {
  test("auth errors name the required signer", () => {
    const e = toSisonkeError(new Error("HostError: Error(Auth, InvalidAction)"), { method: "release" });
    expect(e).toMatchObject({ title: "Not yours to sign", body: "The contract only accepts this from the payer. Nothing moved." });
    expect(toSisonkeError(new Error("Error(Auth, InvalidAction)"), { method: "resolve" }).body).toMatch(/from the arbiter\./);
    expect(toSisonkeError(new Error("Error(Auth, InvalidAction)"), { method: "refund" }).body).toMatch(/from the recipient\./);
  });
  test("wallet rejections", () => {
    const expected = { title: "You rejected it in your wallet", body: "Nothing was sent and nothing changed. Try again whenever you're ready." };
    expect(toSisonkeError({ code: -4, message: "whatever" })).toEqual(expected);
    expect(toSisonkeError(new Error("User declined access"))).toEqual(expected);
    expect(toSisonkeError(new Error("The user rejected this request"))).toEqual(expected);
    expect(toSisonkeError(Object.assign(new Error("rejected"), { code: -4 }))).toEqual(expected);
  });
  test("send result codes", () => {
    expect(toSisonkeError(new Error("txBadSeq")).body).toMatch(/^Your account changed since we checked/);
    expect(toSisonkeError(new Error("txInsufficientBalance")).fix?.href).toBe("/setup");
    expect(toSisonkeError(new Error("txTooLate")).body).toMatch(/^It expired before it was sent/);
    expect(toSisonkeError(new Error("txBadAuth")).body).toMatch(/Is your wallet on Testnet\?/);
    expect(toSisonkeError(new Error("TRY_AGAIN_LATER")).title).toBe("Stellar is busy");
  });
  test("transport errors", () => {
    expect(toSisonkeError(new TypeError("Failed to fetch"))).toEqual({ title: "Couldn't reach Stellar", body: "Check your connection and try again." });
    expect(toSisonkeError(new Error("connect ECONNREFUSED 127.0.0.1")).title).toBe("Couldn't reach Stellar");
  });
  test("fallback keeps the first line, at most 200 characters, as text", () => {
    const e = toSisonkeError(new Error(`${"x".repeat(300)}\nsecond line`));
    expect(e.title).toBe("Something went wrong");
    expect(e.body).toBe("x".repeat(200));
  });
  test("our own errors pass through with their fix and hash", () => {
    const own = new SisonkeError("Not enough USDC", "This deposit needs…", { label: "Get test USDC", href: "/setup" });
    expect(toSisonkeError(own)).toMatchObject({ title: "Not enough USDC", fix: { href: "/setup" } });
  });
  test("an on-chain failure keeps its hash", () => {
    const hash = "a".repeat(64);
    expect(toSisonkeError(Object.assign(sim(101), { hash }), { method: "fund" }).hash).toBe(hash);
  });
});
