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
- Open-Meteo weather enrichment
- Google Calendar FreeBusy adapter
- Enriched candidate hard filtering
- Agent State and bounded replanning action schema
- Tests

Not implemented yet:

- Candidate-level Peak / Off-Peak mapping
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
npm run weather:check
npm run calendar:login
npm run calendar:check
npm run feasible
npm test
```

`preference:set` uses OpenAI structured JSON output. Set `OPENAI_API_KEY` in `.env` or the shell first.

Weather uses Open-Meteo hourly forecasts. Candidate start times are mapped to the containing local forecast hour in `Australia/Sydney`, so `18:15` and `18:30` both use the `18:00` hourly row for that local date. Forecasts are requested in batches for the candidate date window and cached in memory for 20 minutes.

Calendar uses Google Calendar FreeBusy only. It stores the OAuth refresh token locally at `.auth/google-calendar.json` and exposes only busy intervals to candidate enrichment; event titles, descriptions, attendees, and locations are not returned to Candidate Core.

Hard filtering is deterministic. Calendar busy is a default hard rejection; Calendar unknown is not treated as free. Weather is factual enrichment only unless the Preference Profile contains an explicit hard weather constraint, in which case unknown weather is not treated as good weather.

Runtime secrets and personal data are ignored:

- `.auth/`
- `.env`
- `data/preferences.json`
- `output/`
