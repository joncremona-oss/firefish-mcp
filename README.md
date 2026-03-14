# Firefish MCP Server — Ceek Talent

Connects Firefish CRM to Claude.ai via the Model Context Protocol (MCP).
Once deployed, Claude can query candidates, jobs, companies, placements, and activity logs live from Ceek Talent's Firefish database.

---

## What Claude can do with this

| Tool | What it does |
|---|---|
| `search_candidates` | Find candidates by name, sector, job title, availability |
| `get_candidate` | Full profile for a specific candidate |
| `search_jobs` | Open vacancies by title, client, type, status |
| `search_companies` | Client companies by name, sector, country |
| `get_company` | Full company record with contacts |
| `search_placements` | Revenue-generating placements by date/type |
| `search_actions` | BD activity log — calls, emails, meetings |
| `get_pipeline_summary` | CCO-level commercial overview for any period |

---

## Deploy to Railway (recommended)

### Step 1 — Push to GitHub
```bash
git init
git add .
git commit -m "Initial Firefish MCP server"
git remote add origin https://github.com/YOUR_USERNAME/firefish-mcp.git
git push -u origin main
```

### Step 2 — Deploy on Railway
1. Go to [railway.app](https://railway.app) and create a new project
2. Connect your GitHub repo
3. Railway auto-detects Node.js and builds it

### Step 3 — Set environment variables on Railway
In your Railway project → Variables tab, add:
```
FIREFISH_CLIENT_ID=your_client_id
FIREFISH_CLIENT_SECRET=your_client_secret
FIREFISH_API_URL=https://api.firefishsoftware.com
```

Railway sets PORT automatically — do not set it manually.

### Step 4 — Get your public URL
Railway gives you a URL like: `https://firefish-mcp-production.up.railway.app`

### Step 5 — Connect to Claude.ai
1. Go to Claude.ai → Settings → Connectors
2. Click Add Connector
3. URL: `https://your-railway-url.up.railway.app/mcp`
4. Save — Claude will now have live Firefish access

---

## Local development

```bash
# Install dependencies
npm install

# Copy env file and fill in your credentials
cp .env.example .env

# Run locally
npm run dev
```

Server will start at `http://localhost:3000`

---

## Security notes

- Rotate your Firefish credentials after first deployment
- Use one API profile per integration (don't share with Milo)
- Tokens auto-refresh every 10 minutes (handled internally)
- Never commit .env to git — it's in .gitignore
