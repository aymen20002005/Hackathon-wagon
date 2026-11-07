# Can AI process data without compromising trust?

Demo for Le Wagon: a company-enrichment agent guarded for privacy and data integrity, using ScortonJS and Context.dev.

## Run

Requires Node 20.12+ (Python 3 for ScortonJS).

```bash
npm run setup:scorton     # clones ScortonJS into vendor/, creates .venv with `requests`
npm run challenge         # offline, recorded responses; writes presentation/report.js
npm run present           # slides at http://localhost:4173 (or open presentation/index.html)
```

Live data: copy `.env.example` to `.env`, set `CONTEXT_DEV_API_KEY`, then `npm run challenge:live`.
Live Scorton scoring: set `SCORTON_API_URL` and `SCORTON_TOKEN` (otherwise test T1 is reported as n/a).

## TRUSTLAYER AI live demo (pitch deck slide 8)

```bash
npm run demo        # http://localhost:4174  (keys: 1 normal, 2 poison, R reset)
npm run demo:test   # 15-case test pack with expected vs actual outcomes
```

Only team-owned test pages (`trustlayer/testpages/`, fabricated data) are allow-listed. Other hosts need `ALLOWED_DOMAINS` and `CONTEXT_DEV_API_KEY` (retrieval then goes through Context.dev).

## Layout

- `trustlayer/`: demo server, pipeline (`service.js`), extraction and checks (`fields.js`), test pack, UI (`public/`).
- `src/privacy.js`, `src/egress.js`: minimisation and outbound inspection (only a company domain may leave).
- `src/contextdev.js`: Context.dev Brand + Answers over REST.
- `src/trust.js`: ScortonJS adapter (`score` per target domain).
- `src/integrity.js`: domain match, injection tripwire, cross-source check, provenance.
- `src/audit.js`: hash-chained, PII-free audit log.
- `challenge/run.js`: test suite and fault injection; `presentation/index.html`: slides driven by the report.
