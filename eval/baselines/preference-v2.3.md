# Preference Interpreter v2.3 Frozen Baseline

Status: frozen for the current 20-case dev/regression set.

This baseline preserves the current Preference Profile schema, interpreter prompt, normalizer behavior, regression tests, and real OpenAI eval output.

The 20 cases in `eval/test_case.json` are now a development/regression set. They are not a final holdout or generalization benchmark, and future prompt/rule changes must not be tuned directly against them as if they were unseen evaluation data.

Recorded verification:

- Offline regression test: `npm test`
- Result: 162 tests, 162 pass, 0 fail
- Real OpenAI eval output: `output/preference-eval-v2.3.json`
- Real OpenAI eval cases: 20
- `human_review`: all `null`

Frozen files:

- `packages/preferences/src/schema.mjs`
- `packages/preferences/src/openai-schema.mjs`
- `packages/preferences/src/interpreter.mjs`
- `packages/preferences/src/store.mjs`
- `packages/preferences/src/index.mjs`
- `tests/preferences.test.mjs`
- `eval/test_case.json`
- `eval/run-preference-eval.mjs`
- `output/preference-eval-v2.3.json`

