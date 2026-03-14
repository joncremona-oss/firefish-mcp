/**
 * Firefish MCP Server — Ceek Talent
 * ─────────────────────────────────
 * Exposes Firefish CRM data to Claude.ai via the Model Context Protocol.
 * Covers: Candidates, Jobs, Companies, Placements, Actions, Pipeline summary.
 *
 * Deploy to Railway / Render, then add the URL to Claude.ai → Settings → Connectors.
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { firefishRequest, type FirefishConfig } from "./firefish-client.js";

// ── Config from environment variables ────────────────────────────────────────
const config: FirefishConfig = {
  clientId: process.env.FIREFISH_CLIENT_ID ?? "",
  clientSecret: process.env.FIREFISH_CLIENT_SECRET ?? "",
  baseUrl: process.env.FIREFISH_API_URL ?? "https://api.firefishsoftware.com",
};

if (!config.clientId || !config.clientSecret) {
  console.error("❌ Missing FIREFISH_CLIENT_ID or FIREFISH_CLIENT_SECRET");
  process.exit(1);
}

// ── MCP Server setup ──────────────────────────────────────────────────────────
const server = new McpServer({
  name: "firefish-ceek-talent",
  version: "1.0.0",
});

// ─────────────────────────────────────────────────────────────────────────────
// TOOL: Search Candidates
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  "search_candidates",
  "Search Ceek Talent candidates in Firefish. Filter by name, job title, sector, availability, or date range. Returns a list of matching candidates with key details.",
  {
    firstName: z.string().optional().describe("Candidate first name (partial match)"),
    lastName: z.string().optional().describe("Candidate last name (partial match)"),
    jobTitle: z.string().optional().describe("Current or desired job title"),
    sector: z.string().optional().describe("Industry sector e.g. iGaming, Finance, Tech"),
    availability: z.string().optional().describe("Availability status e.g. Available, Placed"),
    dateFrom: z.string().optional().describe("Filter updated from this date (YYYY-MM-DD)"),
    dateTo: z.string().optional().describe("Filter updated to this date (YYYY-MM-DD)"),
    limit: z.number().optional().default(50).describe("Max results to return (default 50)"),
  },
  async ({ firstName, lastName, jobTitle, sector, availability, dateFrom, dateTo, limit }) => {
    const name = [firstName, lastName].filter(Boolean).join(" ") || undefined;
    const data = await firefishRequest<unknown[]>(config, "/api/v1.0/candidates/search", {
      ...(name && { name }),
      ...(jobTitle && { "job-title": jobTitle }),
      ...(sector && { discipline: sector }),
      ...(dateFrom && { "from-date": dateFrom }),
      ...(dateTo && { "to-date": dateTo }),
      "use-updated-dates": true,
    });

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      }],
    };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// TOOL: Get Candidate Details
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  "get_candidate",
  "Get full details for a specific candidate by their Firefish reference ID. Returns complete profile including employment history, education, skills, and availability.",
  {
    candidateRef: z.string().describe("The unique Firefish candidate reference ID"),
  },
  async ({ candidateRef }) => {
    const data = await firefishRequest<unknown>(config, `/api/v1.0/candidates/${candidateRef}`);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      }],
    };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// TOOL: Search Jobs
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  "search_jobs",
  "Search open job vacancies in Firefish. Filter by title, company, job type, or status. Returns active roles being worked by Ceek recruiters.",
  {
    jobTitle: z.string().optional().describe("Job title (partial match)"),
    companyName: z.string().optional().describe("Client company name"),
    jobType: z.string().optional().describe("Job type: Permanent, Temporary, Contract"),
    status: z.string().optional().describe("Job status e.g. Live, On Hold, Filled"),
    dateFrom: z.string().optional().describe("Filter from date (YYYY-MM-DD)"),
    dateTo: z.string().optional().describe("Filter to date (YYYY-MM-DD)"),
    limit: z.number().optional().default(50).describe("Max results (default 50)"),
  },
  async ({ jobTitle, companyName, jobType, status, dateFrom, dateTo, limit }) => {
    const data = await firefishRequest<unknown[]>(config, "/api/v1.0/jobs/search", {
      ...(jobTitle && { "job-title": jobTitle }),
      ...(companyName && { "company-name": companyName }),
      ...(jobType && { "job-type": jobType }),
      ...(status && { status }),
      ...(dateFrom && { "from-date": dateFrom }),
      ...(dateTo && { "to-date": dateTo }),
    });

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      }],
    };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// TOOL: Search Companies (Clients)
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  "search_companies",
  "Search client companies in Firefish. Returns company details, contacts, and relationship status. Useful for BD pipeline and client health reviews.",
  {
    companyName: z.string().optional().describe("Company name (partial match)"),
    sector: z.string().optional().describe("Industry sector"),
    country: z.string().optional().describe("Country of the company"),
    dateFrom: z.string().optional().describe("Filter updated from date (YYYY-MM-DD)"),
    dateTo: z.string().optional().describe("Filter updated to date (YYYY-MM-DD)"),
    limit: z.number().optional().default(50).describe("Max results (default 50)"),
  },
  async ({ companyName, sector, country, dateFrom, dateTo, limit }) => {
    const data = await firefishRequest<unknown[]>(config, "/api/v1.0/companies/search", {
      ...(companyName && { name: companyName }),
      ...(sector && { sector }),
      ...(country && { country }),
      ...(dateFrom && { "from-date": dateFrom }),
      ...(dateTo && { "to-date": dateTo }),
    });

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      }],
    };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// TOOL: Get Company Details
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  "get_company",
  "Get full details for a specific client company by Firefish reference ID. Includes contacts, terms, and associated jobs.",
  {
    companyRef: z.string().describe("The unique Firefish company reference ID"),
  },
  async ({ companyRef }) => {
    const data = await firefishRequest<unknown>(config, `/api/v1.0/companies/${companyRef}`);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      }],
    };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// TOOL: Search Placements
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  "search_placements",
  "Search placement records in Firefish. Returns confirmed placements including candidate, company, job, salary, start date, and fee. Critical for revenue tracking.",
  {
    dateFrom: z.string().optional().describe("Placement start date from (YYYY-MM-DD)"),
    dateTo: z.string().optional().describe("Placement start date to (YYYY-MM-DD)"),
    jobType: z.string().optional().describe("Permanent, Temporary, or Contract"),
    companyRef: z.string().optional().describe("Filter by specific client company ref"),
    limit: z.number().optional().default(100).describe("Max results (default 100)"),
  },
  async ({ dateFrom, dateTo, jobType, companyRef, limit }) => {
    const data = await firefishRequest<unknown[]>(config, "/api/v1.1/placements/search", {
      ...(dateFrom && { "from-date": dateFrom }),
      ...(dateTo && { "to-date": dateTo }),
      ...(jobType && { "job-type": jobType }),
      ...(companyRef && { "company-ref": companyRef }),
    });

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      }],
    };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// TOOL: Search Actions (Activity log)
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  "search_actions",
  "Search recruiter activity/action log in Firefish. Shows calls, emails, meetings, and notes logged against candidates and companies. Useful for BD activity review.",
  {
    dateFrom: z.string().optional().describe("Actions from date (YYYY-MM-DD)"),
    dateTo: z.string().optional().describe("Actions to date (YYYY-MM-DD)"),
    actionType: z.string().optional().describe("Type of action e.g. Call, Email, Meeting"),
    candidateRef: z.string().optional().describe("Filter by candidate ref"),
    companyRef: z.string().optional().describe("Filter by company ref"),
    limit: z.number().optional().default(100).describe("Max results (default 100)"),
  },
  async ({ dateFrom, dateTo, actionType, candidateRef, companyRef, limit }) => {
    const data = await firefishRequest<unknown[]>(config, "/api/v1.0/actions/search", {
      ...(dateFrom && { "from-date": dateFrom }),
      ...(dateTo && { "to-date": dateTo }),
      ...(actionType && { "action-type": actionType }),
      ...(candidateRef && { "candidate-ref": candidateRef }),
      ...(companyRef && { "company-ref": companyRef }),
    });

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      }],
    };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// TOOL: CCO Pipeline Summary
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  "get_pipeline_summary",
  "Get a high-level CCO-view pipeline summary for Ceek Talent. Returns: open jobs count, recent placements, active candidates, and BD activity for the specified period. Use this for weekly commercial reviews.",
  {
    periodDays: z.number().optional().default(30).describe("Number of days to look back (default 30)"),
  },
  async ({ periodDays = 30 }) => {
    const dateTo = new Date().toISOString().split("T")[0];
    const dateFrom = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    // Run all queries in parallel for speed
    const [jobs, placements, candidates, actions] = await Promise.allSettled([
      firefishRequest<unknown[]>(config, "/api/v1.0/jobs/search", {
        status: "Live",
      }),
      firefishRequest<unknown[]>(config, "/api/v1.1/placements/search", {
        "from-date": dateFrom,
        "to-date": dateTo,
      }),
      firefishRequest<unknown[]>(config, "/api/v1.0/candidates/search", {
        "from-date": dateFrom,
        "to-date": dateTo,
        "use-updated-dates": true,
      }),
      firefishRequest<unknown[]>(config, "/api/v1.0/actions/search", {
        "from-date": dateFrom,
        "to-date": dateTo,
      }),
    ]);

    const summary = {
      period: { from: dateFrom, to: dateTo, days: periodDays },
      openJobs: jobs.status === "fulfilled" ? jobs.value.length : "error fetching",
      placementsInPeriod: placements.status === "fulfilled" ? placements.value.length : "error fetching",
      candidatesUpdatedInPeriod: candidates.status === "fulfilled" ? candidates.value.length : "error fetching",
      actionsLoggedInPeriod: actions.status === "fulfilled" ? actions.value.length : "error fetching",
      placements: placements.status === "fulfilled" ? placements.value : [],
      jobs: jobs.status === "fulfilled" ? jobs.value : [],
    };

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(summary, null, 2),
      }],
    };
  }
);

// ── Express HTTP server for MCP transport ────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// Health check endpoint (useful for Railway/Render uptime monitoring)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "firefish-mcp-ceek-talent" });
});

// MCP endpoint — Claude.ai connects here
app.all("/mcp", async (req, res) => {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
    });
    res.on("close", () => {
      transport.close().catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: String(error) });
    }
  }
});

const PORT = parseInt(process.env.PORT ?? "3000", 10);
app.listen(PORT, () => {
  console.log(`✅ Firefish MCP Server running on port ${PORT}`);
  console.log(`   MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
});
