# Seed data

`sample_urls.txt` is a list of ~35 real sites across categories, used to try Cairn end to end.

Load it into a demo account (creates the account if needed and queues every URL for the worker):

```bash
cd backend
uv run python -m app.seed --email demo@cairn.test --password cairn-demo-2026 --file ../seed/sample_urls.txt
```

Demo account used during development: `demo@cairn.test` / `cairn-demo-2026` (local only; change or delete it for any shared deployment).

You can also paste the file's contents into **Add links** in the web app, or drop the file onto that dialog.
