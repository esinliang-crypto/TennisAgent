# TennisAgent

Preference-Aware Personal Tennis Agent.

## Current Progress

Implemented:

- SUSF authenticated availability adapter
- Live SUSF Court availability path through `packages/susf`
- Dynamic Tennis Court discovery
- Court 1-6 currently verified
- Next-hour availability detection
- Pre-payment rate table extraction
- Candidate price options for verified Peak / Off-Peak rates
- Natural-language Preference Interpreter interface
- Structured Preference Profile validation
- Hard vs soft preference representation
- Local JSON Preference Profile store
- Candidate Core for factual feature extraction
- Australia/Sydney timezone handling
- Tests

Not implemented yet:

- Candidate-level Peak / Off-Peak mapping
- Weather
- Google Calendar
- LLM candidate ranking
- MCP Server
- Agent orchestration
- Web UI
- Automatic booking

## Commands

```bash
npm run susf:login
npm run susf:check
npm run preference:set -- "我主要想便宜，最好后一小时也没人，13点前或者17点以后都行"
npm run preference:show
npm run candidates
npm run preview
npm test
```

`preference:set` uses OpenAI structured JSON output. Set `OPENAI_API_KEY` in `.env` or the shell first.

Runtime secrets and personal data are ignored:

- `.auth/`
- `.env`
- `data/preferences.json`
- `output/`
