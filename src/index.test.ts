// src/index.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { optionalEnv } from "./index";

describe(optionalEnv.name, () => {
  const testVarName = "TEST_OPTIONAL_VAR_12345";

  beforeEach(() => {
    delete process.env[testVarName];
  });

  afterEach(() => {
    delete process.env[testVarName];
  });

  test("returns undefined when env var is not set", () => {
    expect(optionalEnv(testVarName)).toBeUndefined();
  });

  test("returns undefined when env var is an empty string", () => {
    process.env[testVarName] = "";
    expect(optionalEnv(testVarName)).toBeUndefined();
  });

  test("returns the value when env var is a non-empty string", () => {
    process.env[testVarName] = "some-value";
    expect(optionalEnv(testVarName)).toBe("some-value");
  });
});
