// Behavioral tests for the app's highest-value money/auth checks
// (functions/lib/verify.mjs). These actually execute the verification logic,
// unlike the source-string assertions elsewhere in the suite.
import test from "node:test";
import assert from "node:assert/strict";
import {
  timingSafeEqual,
  hmacHex,
  validStripeSignature,
  ownerAddress,
  sameSuiAddress,
  paymentReceived,
  loginMessage,
} from "../functions/lib/verify.mjs";

test("timingSafeEqual: equal strings, mismatches, and bad inputs", () => {
  assert.equal(timingSafeEqual("abc123", "abc123"), true);
  assert.equal(timingSafeEqual("abc123", "abc124"), false);
  assert.equal(timingSafeEqual("abc", "abcd"), false); // length mismatch
  assert.equal(timingSafeEqual("", ""), true);
  assert.equal(timingSafeEqual(undefined, "x"), false);
  assert.equal(timingSafeEqual(null, null), false);
  assert.equal(timingSafeEqual(123, 123), false); // non-strings
});

test("loginMessage binds the nonce into the signed message", () => {
  assert.equal(loginMessage("n1"), "Liber 登录\nnonce: n1");
  assert.notEqual(loginMessage("n1"), loginMessage("n2")); // replay with a fresh nonce won't match
});

test("validStripeSignature accepts a correct HMAC and rejects tampering", async () => {
  const secret = "whsec_test_secret";
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
  const t = "1700000000";
  const good = await hmacHex(secret, `${t}.${body}`);

  assert.equal(await validStripeSignature(secret, `t=${t},v1=${good}`, body), true);
  // a second (garbage) v1 alongside a good one still passes
  assert.equal(await validStripeSignature(secret, `t=${t},v1=dead,v1=${good}`, body), true);

  // tampered body → signature no longer matches
  assert.equal(await validStripeSignature(secret, `t=${t},v1=${good}`, body + " "), false);
  // wrong secret
  assert.equal(await validStripeSignature("whsec_wrong", `t=${t},v1=${good}`, body), false);
  // timestamp is part of the signed payload — changing it invalidates the sig
  assert.equal(await validStripeSignature(secret, `t=1700000001,v1=${good}`, body), false);
  // missing pieces
  assert.equal(await validStripeSignature(secret, `t=${t}`, body), false); // no v1
  assert.equal(await validStripeSignature(secret, `v1=${good}`, body), false); // no timestamp
  assert.equal(await validStripeSignature(secret, "", body), false);
  assert.equal(await validStripeSignature(secret, null, body), false);
  assert.equal(await validStripeSignature("", `t=${t},v1=${good}`, body), false); // no secret
});

test("ownerAddress unwraps the Sui owner shapes", () => {
  assert.equal(ownerAddress("0xabc"), "0xabc");
  assert.equal(ownerAddress({ AddressOwner: "0xdef" }), "0xdef");
  assert.equal(ownerAddress({ addressOwner: "0x123" }), "0x123");
  assert.equal(ownerAddress({ Shared: {} }), null);
  assert.equal(ownerAddress(null), null);
});

test("sameSuiAddress normalizes before comparing", () => {
  assert.equal(sameSuiAddress("0x1", "0x01"), true); // normalize pads to 32 bytes
  assert.equal(
    sameSuiAddress("0x1", "0x0000000000000000000000000000000000000000000000000000000000000001"),
    true,
  );
  assert.equal(sameSuiAddress("0x1", "0x2"), false);
  assert.equal(sameSuiAddress(null, "0x1"), false);
  assert.equal(sameSuiAddress("0x1", undefined), false);
});

test("paymentReceived requires the right coin, treasury, and at least the amount", () => {
  const treasury = "0x000000000000000000000000000000000000000000000000000000000000beef";
  const coinType = "0x2::usdc::USDC";
  const amount = "1000000"; // atomic units required
  const cfg = { coinType, treasury, amount };

  const credit = (over = {}) => [{ coinType, owner: { AddressOwner: treasury }, amount, ...over }];

  // exact amount to the right treasury in the right coin → accepted
  assert.equal(paymentReceived(credit(), cfg), true);
  // more than enough → accepted
  assert.equal(paymentReceived(credit({ amount: "2000000" }), cfg), true);
  // not enough → rejected
  assert.equal(paymentReceived(credit({ amount: "999999" }), cfg), false);
  // wrong coin type → rejected (e.g. native SUI instead of USDC)
  assert.equal(paymentReceived(credit({ coinType: "0x2::sui::SUI" }), cfg), false);
  // right amount but to a different address → rejected
  assert.equal(paymentReceived(credit({ owner: { AddressOwner: "0x1" } }), cfg), false);
  // a debit (negative) on the payer is not a credit to treasury
  assert.equal(
    paymentReceived([{ coinType, owner: { AddressOwner: "0x1" }, amount: "-1000000" }], cfg),
    false,
  );
  // empty / missing balance changes → rejected
  assert.equal(paymentReceived([], cfg), false);
  assert.equal(paymentReceived(null, cfg), false);
  assert.equal(paymentReceived(undefined, cfg), false);
});
