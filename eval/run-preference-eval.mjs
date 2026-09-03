import { readFile, mkdir, writeFile } from "node:fs/promises";
import { interpretPreferences } from "../packages/preferences/src/index.mjs";

const cases = JSON.parse(
  await readFile(new URL("./test_case.json", import.meta.url), "utf8")
);
const outputFile = process.env.PREFERENCE_EVAL_OUTPUT ?? "preference-eval-v2.json";

const results = [];

for (const testCase of cases) {
  const output = await interpretPreferences(testCase.input);

  results.push({
    id: testCase.id ?? testCase.name,
    input: testCase.input,
    output,
    human_review: null
  });

  console.log("\n========================================");
  console.log(testCase.id ?? testCase.name);
  console.log(testCase.input);
  console.log(JSON.stringify(output, null, 2));
}

await mkdir(new URL("../output/", import.meta.url), { recursive: true });

await writeFile(
  new URL(`../output/${outputFile}`, import.meta.url),
  JSON.stringify(results, null, 2)
);

console.log(
  `\nSaved ${results.length} results to output/${outputFile}`
);
