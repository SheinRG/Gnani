# audio-notes

The Gnani Audio Notes app. See the [repository README](../README.md) for the
full story — the 60-second API constraint, the silence-aware chunking design,
and setup instructions. The app itself documents its architecture at
`/architecture` when running.

Quick start:

```bash
npm install
cp .env.example .env.local   # fill in
npm run db:init
npm run dev
```
