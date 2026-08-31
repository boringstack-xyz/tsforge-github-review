// src/diff-lines.test.ts
import { describe, test, expect } from "bun:test";
import { validLines } from "./diff-lines";

const SAMPLE_DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,3 +10,4 @@ function foo() {
 line10
-line11
+line11-changed
+line12-new
 line13
diff --git a/src/b.ts b/src/b.ts
index 3333333..4444444 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,2 +1,2 @@
-old
+new
`;

describe(validLines.name, () => {
  test("collects added/context line numbers on the new-file side, per file", () => {
    const result = validLines(SAMPLE_DIFF);

    expect(result.get("src/a.ts")).toEqual(new Set([10, 11, 12, 13]));
    expect(result.get("src/b.ts")).toEqual(new Set([1]));
  });

  test("returns an empty map for an empty diff", () => {
    expect(validLines("").size).toBe(0);
  });

  test("ignores a file with only deletions (no +/context lines to anchor a comment on)", () => {
    const diff = `diff --git a/src/c.ts b/src/c.ts
--- a/src/c.ts
+++ b/src/c.ts
@@ -1,2 +0,0 @@
-removed1
-removed2
`;

    expect(validLines(diff).has("src/c.ts")).toBe(false);
  });
});
