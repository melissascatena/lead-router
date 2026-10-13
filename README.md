# Lead Router

A single-page app that scores, qualifies, and routes B2B leads from a CSV. It's plain HTML, CSS, and JS with no build step and no backend. Your data never leaves the browser.

## Features

- **Upload a CSV** with the button, or drag and drop it anywhere on the page. A sample of 50 fake B2B SaaS leads loads on first visit.
- **Scoring rules you can edit** in the sidebar:
  - **Title seniority:** keyword tiers (C-Level/Founder, VP, Director/Head, Manager, plus a fallback for everyone else). The first tier that matches sets the points.
  - **Company size:** points for each employee band.
  - **Target industries:** turn industries on or off, each with its own points. New industries found in your CSV show up automatically.
  - **Lead source:** points for each source. New sources found in your CSV show up automatically.
  - **MQL threshold:** leads that score at or above it become MQLs.
- **Routing:** each MQL goes to a rep based on territory and segment:
  - Territory (East, Central, or West) comes from the lead's state.
  - Segment (SMB, Mid-Market, or Enterprise) comes from employee count.
  - You can edit the state lists, the segment cutoffs, and all 9 rep names.
- **Funnel chart:** Total → MQL → MQLs routed to each rep. Hover a bar for details.
- **Results table:** sort, search, and filter by status or rep. Hover a score to see how it was built up. You can export the results to CSV.
- Rules are saved in `localStorage`. Light and dark mode follow your system setting. The layout works on phones.

## CSV format

```
name,title,company,company_size,industry,lead_source,state
Jane Doe,VP of Sales,Acme Health,1200,Healthcare,Demo Request,NY
```

Header matching is flexible:

- `first_name` and `last_name` are combined into a name.
- `employees`, `headcount`, and `job_title` are accepted as column names.
- Company sizes like `1,200`, `5k`, and `200-499` are understood. For a range, the lower number is used.
- States can be codes or full names.

See [`sample-leads.csv`](sample-leads.csv).

## Run locally

Open `index.html` in a browser. That's it. The sample data is embedded in `sample-data.js`, so the app works from `file://` too.

## Deploy to GitHub Pages

1. Push this repo to GitHub.
2. Go to **Settings → Pages**.
3. Under **Source**, pick *Deploy from a branch*, then choose your branch and `/ (root)`.
4. Save. The site will be live at `https://<user>.github.io/lead-router/`.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page markup |
| `styles.css` | Styles, including dark mode and responsive layout |
| `app.js` | CSV parsing, scoring, routing, and rendering |
| `sample-data.js` | The embedded sample dataset |
| `sample-leads.csv` | The same sample as a downloadable CSV |
