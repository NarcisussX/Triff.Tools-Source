const test = require("node:test");
const assert = require("node:assert/strict");
const { installExternalModuleFallbacks } = require("./helpers/moduleStubs");

installExternalModuleFallbacks();
const accountDeletion = require("../services/accountDeletion");

test("account deletion body requires password and typed confirmation", () => {
  assert.deepEqual(accountDeletion.validateAccountDeletionBody({}), {
    error: "password_required",
    message: "Enter your password to delete this account.",
  });

  assert.deepEqual(accountDeletion.validateAccountDeletionBody({
    password: "correct-horse-battery-staple",
    confirmation: "delete",
  }), {
    error: "confirmation_required",
    message: "Type DELETE to confirm account deletion.",
  });

  assert.deepEqual(accountDeletion.validateAccountDeletionBody({
    password: "correct-horse-battery-staple",
    confirmation: "DELETE",
  }), {
    password: "correct-horse-battery-staple",
  });
});

test("account deletion SQL helpers only accept known-safe identifiers", () => {
  const helpers = accountDeletion._test;

  assert.equal(helpers.quoteIdentifier("tool_user_state"), "\"tool_user_state\"");
  assert.equal(
    helpers.ownershipWhereClause({ columns: ["challenger_id", "target_id"] }),
    "\"challenger_id\" = $1 OR \"target_id\" = $1"
  );
  assert.throws(() => helpers.quoteIdentifier("tool_user_state; DROP TABLE users"), /Unsafe SQL identifier/);
});
