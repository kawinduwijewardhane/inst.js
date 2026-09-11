import assert from "node:assert/strict";
import { test } from "node:test";
import { isVersion, validateReleaseTag } from "./release-version.mjs";

test("release versions follow semantic version syntax", () => {
  for (const value of ["1.0.0", "1.0.0-rc.1", "1.2.3+build.7"]) assert.ok(isVersion(value));
  for (const value of ["01.0.0", "1.0.0-01", "1.0.0-", "1.0.0-a..b", "1.0.0+", "v1.0.0"]) assert.equal(isVersion(value), false);
});

test("release tags match every public package", () => {
  validateReleaseTag("v1.0.0", "1.0.0", [{ name: "core", version: "1.0.0" }]);
  assert.throws(() => validateReleaseTag("v0.0.0", "0.0.0", []));
  assert.throws(() => validateReleaseTag("v1.0.1", "1.0.0", []));
  assert.throws(() => validateReleaseTag("v1.0.0", "1.0.0", [{ name: "core", version: "0.0.0" }]));
});
