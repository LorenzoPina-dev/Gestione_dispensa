import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canWrite,
  isInviteRole,
  isMembershipRole,
  isValidBrowserBindingHash,
  isValidEmail,
  isValidInviteCode,
  isValidInviteExpiry,
  isValidVersion,
  normalizeFamilyName,
  normalizeInviteCode,
} from "../src/validation.js";

describe("service-family / pure validation", () => {
  it("normalizes family names without inventing values", () => {
    assert.equal(normalizeFamilyName("  Casa  "), "Casa");
    assert.equal(normalizeFamilyName(""), "");
    assert.equal(normalizeFamilyName(null), "");
    assert.equal(normalizeFamilyName(42), "");
  });

  it("recognizes only owner/admin as write roles", () => {
    assert.equal(canWrite("owner"), true);
    assert.equal(canWrite("admin"), true);
    assert.equal(canWrite("member"), false);
    assert.equal(canWrite("viewer"), false);
    assert.equal(canWrite(null), false);
  });

  it("accepts documented membership roles", () => {
    for (const role of ["admin", "member", "viewer"]) {
      assert.equal(isMembershipRole(role), true);
    }
    assert.equal(isMembershipRole("owner"), false);
    assert.equal(isMembershipRole("MANAGER"), false);
    assert.equal(isMembershipRole(undefined), false);
  });

  it("accepts documented invite roles", () => {
    assert.equal(isInviteRole("admin"), true);
    assert.equal(isInviteRole("member"), true);
    assert.equal(isInviteRole("viewer"), true);
    assert.equal(isInviteRole("owner"), false);
  });

  it("enforces the one-hour to seven-day invite lifetime", () => {
    assert.equal(isValidInviteExpiry(3600), true);
    assert.equal(isValidInviteExpiry(604800), true);
    assert.equal(isValidInviteExpiry(3599), false);
    assert.equal(isValidInviteExpiry(604801), false);
    assert.equal(isValidInviteExpiry(3600.5), false);
  });

  it("validates the optional invite email exactly at the family boundary", () => {
    assert.equal(isValidEmail(null), true);
    assert.equal(isValidEmail("user@example.com"), true);
    assert.equal(isValidEmail("a@b"), false);
    assert.equal(isValidEmail("bad value@example.com"), false);
    assert.equal(isValidEmail(42), false);
  });

  it("validates the browser binding and six-digit invite code", () => {
    assert.equal(isValidBrowserBindingHash("0123456789abcdef"), true);
    assert.equal(isValidBrowserBindingHash("ABCDEF0123456789"), true);
    assert.equal(isValidBrowserBindingHash("123"), false);
    assert.equal(isValidBrowserBindingHash("zzzzzzzzzzzzzzzzzz"), false);

    assert.equal(normalizeInviteCode("12-34 56"), "123456");
    assert.equal(isValidInviteCode("123456"), true);
    assert.equal(isValidInviteCode("12-34 56"), true);
    assert.equal(isValidInviteCode("12345"), false);
  });

  it("accepts only positive integer optimistic-lock versions", () => {
    assert.equal(isValidVersion("1"), true);
    assert.equal(isValidVersion("42"), true);
    assert.equal(isValidVersion("0"), false);
    assert.equal(isValidVersion("-1"), false);
    assert.equal(isValidVersion("1.5"), false);
    assert.equal(isValidVersion(""), false);
  });
});
