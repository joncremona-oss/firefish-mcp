#!/usr/bin/env node

/**
 * Firefish MCP Server
 *
 * A Model Context Protocol server for the Firefish recruitment CRM.
 * Provides tools to search, create, update, and manage jobs via the
 * Firefish Public API (V1.1).
 *
 * Environment variables:
 *   FIREFISH_CLIENT_ID      - OAuth2 client_id (e.g. "Ceek-JobsAPI-ApiDetails")
 *   FIREFISH_CLIENT_SECRET  - OAuth2 client_secret
 *   FIREFISH_BASE_URL       - (optional) Override the API base URL
 *                             Default: https://api.firefishsoftware.com
 *
 * The server automatically handles OAuth token refresh (~10 min expiry).
 * Uses client_credentials grant to POST to /authorization/token.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { FirefishApiClient } from "./api-client.js";

// ─── Initialise ──────────────────────────────────────────────────────────────

const clientId = process.env.FIREFISH_CLIENT_ID;
const clientSecret = process.env.FIREFISH_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error(
    "ERROR: FIREFISH_CLIENT_ID and FIREFISH_CLIENT_SECRET environment variables are required.\n" +
      "Set them to your Firefish OAuth2 client credentials."
  );
  process.exit(1);
}

const client = new FirefishApiClient({
  clientId,
  clientSecret,
  baseUrl: process.env.FIREFISH_BASE_URL,
  scope: "jobsAPI-read jobsAPI-write candidatesAPI-read candidatesAPI-write companiesAPI-read companiesAPI-write contactsAPI-read contactsAPI-write placementdetailsAPI-read placementdetailsAPI-write actionsAPI-read advertsAPI-read commsAPI-readWrite usersAPI-read",
});

const server = new McpServer({
  name: "firefish",
  version: "1.0.0",
});

// ─── Helper ──────────────────────────────────────────────────────────────────

function formatResult(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

function errorResult(message: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }] };
}

// ─── Tool: Search Jobs ───────────────────────────────────────────────────────

server.tool(
  "search_jobs",
  "Search for jobs in Firefish with flexible filters. Returns a list of matching jobs with key details. Use this to find jobs by title, status, type, discipline, location, or company.",
  {
    title: z.string().optional().describe("Filter by job title (partial match)"),
    status: z
      .enum(["Open", "Closed", "Placed"])
      .optional()
      .describe("Filter by job status"),
    jobType: z
      .enum(["Permanent", "Contract", "Temp"])
      .optional()
      .describe("Filter by job type"),
    primaryDiscipline: z
      .string()
      .optional()
      .describe("Filter by primary discipline (e.g. 'Finance', 'Technology')"),
    secondaryDiscipline: z
      .string()
      .optional()
      .describe("Filter by secondary discipline"),
    primaryLocation: z
      .string()
      .optional()
      .describe("Filter by primary location (e.g. 'Malta')"),
    secondaryLocation: z.string().optional().describe("Filter by secondary location"),
    companyName: z.string().optional().describe("Filter by company name"),
    ownerUserName: z.string().optional().describe("Filter by job owner name"),
    page: z
      .number()
      .optional()
      .describe("Page number for paginated results (default: 1)"),
    pageSize: z
      .number()
      .optional()
      .describe("Number of results per page (default: 25, max: 100)"),
  },
  async (params) => {
    const queryParams: Record<string, string> = {};
    if (params.title) queryParams.title = params.title;
    if (params.status) queryParams.status = params.status;
    if (params.jobType) queryParams.jobType = params.jobType;
    if (params.primaryDiscipline)
      queryParams.primaryDiscipline = params.primaryDiscipline;
    if (params.secondaryDiscipline)
      queryParams.secondaryDiscipline = params.secondaryDiscipline;
    if (params.primaryLocation) queryParams.primaryLocation = params.primaryLocation;
    if (params.secondaryLocation)
      queryParams.secondaryLocation = params.secondaryLocation;
    if (params.companyName) queryParams.companyName = params.companyName;
    if (params.ownerUserName) queryParams.ownerUserName = params.ownerUserName;
    if (params.page) queryParams.page = String(params.page);
    if (params.pageSize) queryParams.pageSize = String(params.pageSize);

    const result = await client.get("/api/v1.1/jobs/search", queryParams);

    if (!result.ok) return errorResult(result.error || "Failed to search jobs");
    return {
      content: [{ type: "text" as const, text: formatResult(result.data) }],
    };
  }
);

// ─── Tool: Get Job Details ───────────────────────────────────────────────────

server.tool(
  "get_job",
  "Retrieve full details of a single job by its reference number. Returns all fields including salary, disciplines, locations, keywords, and status. Response structure varies by job type (Permanent, Contract, Temp).",
  {
    jobRef: z.number().describe("The unique job reference number (e.g. 2647)"),
  },
  async ({ jobRef }) => {
    // Strategy: try v1.1 first, fall back to v1.0, then search-by-ref
    const attempts: Array<{ label: string; path: string }> = [
      { label: "v1.1", path: `/api/v1.1/jobs/${jobRef}` },
      { label: "v1.0", path: `/api/v1.0/jobs/${jobRef}` },
    ];

    for (const attempt of attempts) {
      const result = await client.get(attempt.path);
      if (result.ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: `(Fetched via ${attempt.label})\n\n${formatResult(result.data)}`,
            },
          ],
        };
      }
      // Log but continue to next attempt
      console.error(
        `[firefish] get_job ${attempt.label} failed (HTTP ${result.status}): ${result.error}`
      );
    }

    // Final fallback: search for the job by ref and return the match
    console.error(
      `[firefish] get_job direct endpoints failed — falling back to search`
    );
    const searchResult = await client.get("/api/v1.1/jobs/search", {
      jobRef: String(jobRef),
    });
    if (searchResult.ok) {
      const jobs = searchResult.data as Array<Record<string, unknown>>;
      const match = Array.isArray(jobs)
        ? jobs.find((j) => j.Ref === jobRef || j.ref === jobRef)
        : null;
      if (match) {
        return {
          content: [
            {
              type: "text" as const,
              text: `(Fetched via search fallback — may lack custom fields like salary)\n\n${formatResult(match)}`,
            },
          ],
        };
      }
    }

    return errorResult(
      `All attempts to fetch job ${jobRef} failed. ` +
        `v1.1 and v1.0 both returned server errors. ` +
        `The Firefish API may be experiencing issues. ` +
        `Check job #${jobRef} directly in the Firefish web UI.`
    );
  }
);

// ─── Tool: Get Dropdown Values ───────────────────────────────────────────────

server.tool(
  "get_dropdown_values",
  "Retrieve all available dropdown values for job fields: Disciplines (primary/secondary), Locations (primary/secondary), Specialisations, Custom Job Types, Teams, Job Codes, Job Sources, and Reasons If Closed. Use this before creating a job to get valid field values.",
  {},
  async () => {
    const result = await client.get("/api/v1.1/jobs/dropdownvalues");
    if (!result.ok)
      return errorResult(result.error || "Failed to get dropdown values");
    return {
      content: [{ type: "text" as const, text: formatResult(result.data) }],
    };
  }
);

// ─── Tool: Create Job ────────────────────────────────────────────────────────

server.tool(
  "create_job",
  "Create a new job in Firefish. Supports Permanent, Contract, and Temp job types. Required fields: Title, JobType, OwnerUserEmail, CompanyRef. For Permanent jobs, include SalaryFrom/SalaryTo. For Contract jobs, include MinimumRate/MaximumRate. Use get_dropdown_values first to get valid discipline, location, and specialisation values.",
  {
    Title: z.string().describe("Job title (e.g. 'Group Financial Controller')"),
    JobType: z
      .enum(["Permanent", "Contract", "Temp"])
      .describe("Type of job"),
    OwnerUserEmail: z
      .string()
      .describe("Email of the Firefish user who will own this job"),
    CompanyRef: z
      .number()
      .optional()
      .describe("Company reference ID. Get from company search."),
    ContactRef: z
      .number()
      .optional()
      .describe("Contact reference ID for the hiring manager"),
    TotalPositions: z.number().optional().describe("Number of positions (default: 1)"),
    // Permanent-specific
    SalaryFrom: z
      .number()
      .optional()
      .describe("Minimum salary (Permanent jobs)"),
    SalaryTo: z.number().optional().describe("Maximum salary (Permanent jobs)"),
    ProposedSalary: z
      .number()
      .optional()
      .describe("Proposed salary figure (Permanent jobs)"),
    CurrencyCode: z
      .string()
      .optional()
      .describe("ISO currency code (e.g. 'EUR', 'GBP'). Default: EUR"),
    AdditionalBenefits: z
      .string()
      .optional()
      .describe("Notes on additional benefits"),
    // Contract-specific
    MinimumRate: z
      .number()
      .optional()
      .describe("Minimum rate (Contract jobs)"),
    MaximumRate: z
      .number()
      .optional()
      .describe("Maximum rate (Contract jobs)"),
    RateUnit: z
      .string()
      .optional()
      .describe("Rate unit: 'Hourly' or 'Daily' (Contract jobs)"),
    StartDate: z
      .string()
      .optional()
      .describe("Job start date (ISO format: YYYY-MM-DD)"),
    EndDate: z
      .string()
      .optional()
      .describe("Job end date (ISO format, Contract/Temp jobs)"),
    // Classification
    Keywords: z
      .string()
      .optional()
      .describe(
        "Boolean search keywords for candidate matching (e.g. '(\"Financial Controller\" OR \"Finance Director\") AND (\"ACCA\" OR \"CPA\")')"
      ),
    PrimaryDiscipline: z
      .string()
      .optional()
      .describe("Primary discipline. Must match a value from get_dropdown_values."),
    SecondaryDiscipline: z
      .string()
      .optional()
      .describe("Secondary discipline. Must match a value from get_dropdown_values."),
    PrimaryLocation: z
      .string()
      .optional()
      .describe("Primary location. Must match a value from get_dropdown_values."),
    SecondaryLocation: z
      .string()
      .optional()
      .describe("Secondary location. Must match a value from get_dropdown_values."),
    PrimarySpecialisation: z
      .string()
      .optional()
      .describe("Primary specialisation from get_dropdown_values."),
    SecondarySpecialisation: z
      .string()
      .optional()
      .describe("Secondary specialisation from get_dropdown_values."),
    CustomJobType: z
      .string()
      .optional()
      .describe("Custom job classification (e.g. 'Retained'). From get_dropdown_values."),
    Team: z
      .string()
      .optional()
      .describe("Recruiter team name. From get_dropdown_values."),
    JobSource: z
      .string()
      .optional()
      .describe("Source of the job. From get_dropdown_values."),
    JobCode: z.string().optional().describe("Job code. From get_dropdown_values."),
    CVDeadline: z
      .string()
      .optional()
      .describe("CV submission deadline (ISO format: YYYY-MM-DD)"),
  },
  async (params) => {
    // Build request body — only include provided fields
    const body: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        body[key] = value;
      }
    }

    const result = await client.post("/api/v1.1/jobs", body);
    if (!result.ok) return errorResult(result.error || "Failed to create job");
    return {
      content: [
        {
          type: "text" as const,
          text: `Job created successfully!\n\n${formatResult(result.data)}`,
        },
      ],
    };
  }
);

// ─── Tool: Update Job ────────────────────────────────────────────────────────

server.tool(
  "update_job",
  "Update an existing job in Firefish. Supports partial updates — only include the fields you want to change. Can also close or reopen jobs by setting Status to 'Closed' with a ReasonIfClosed, or 'Open' to reopen.",
  {
    jobRef: z.number().describe("The job reference number to update"),
    Title: z.string().optional().describe("Updated job title"),
    Status: z
      .enum(["Open", "Closed"])
      .optional()
      .describe("Set job status. Use 'Closed' with ReasonIfClosed to close a job."),
    ReasonIfClosed: z
      .string()
      .optional()
      .describe(
        "Reason for closing (required when Status=Closed). Values from get_dropdown_values."
      ),
    ClosedComments: z
      .string()
      .optional()
      .describe("Additional comments when closing a job"),
    Keywords: z.string().optional().describe("Updated boolean search keywords"),
    SalaryFrom: z.number().optional().describe("Updated minimum salary"),
    SalaryTo: z.number().optional().describe("Updated maximum salary"),
    ProposedSalary: z.number().optional().describe("Updated proposed salary"),
    AdditionalBenefits: z.string().optional().describe("Updated benefits text"),
    TotalPositions: z.number().optional().describe("Updated number of positions"),
    PrimaryDiscipline: z.string().optional().describe("Updated primary discipline"),
    SecondaryDiscipline: z.string().optional().describe("Updated secondary discipline"),
    PrimaryLocation: z.string().optional().describe("Updated primary location"),
    SecondaryLocation: z.string().optional().describe("Updated secondary location"),
    PrimarySpecialisation: z
      .string()
      .optional()
      .describe("Updated primary specialisation"),
    SecondarySpecialisation: z
      .string()
      .optional()
      .describe("Updated secondary specialisation"),
    CustomJobType: z.string().optional().describe("Updated custom job type"),
    Team: z.string().optional().describe("Updated team"),
    JobSource: z.string().optional().describe("Updated job source"),
    JobCode: z.string().optional().describe("Updated job code"),
    CVDeadline: z.string().optional().describe("Updated CV deadline (YYYY-MM-DD)"),
    ContactRef: z.number().optional().describe("Updated contact reference"),
    CompanyRef: z.number().optional().describe("Updated company reference"),
    StartDate: z.string().optional().describe("Updated start date (YYYY-MM-DD)"),
    // Contract-specific
    MinimumRate: z.number().optional().describe("Updated minimum rate"),
    MaximumRate: z.number().optional().describe("Updated maximum rate"),
    RateUnit: z.string().optional().describe("Updated rate unit"),
    EndDate: z.string().optional().describe("Updated end date (YYYY-MM-DD)"),
    JobPriority: z
      .string()
      .optional()
      .describe("Job priority: null, 'low', 'medium', 'high'"),
  },
  async (params) => {
    const { jobRef, ...updateFields } = params;
    const body: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updateFields)) {
      if (value !== undefined) {
        body[key] = value;
      }
    }

    if (Object.keys(body).length === 0) {
      return errorResult("No fields to update. Provide at least one field to change.");
    }

    const result = await client.patch(`/api/v1.1/jobs/${jobRef}`, body);
    if (!result.ok) return errorResult(result.error || "Failed to update job");
    return {
      content: [
        {
          type: "text" as const,
          text: `Job ${jobRef} updated successfully!\n\n${formatResult(result.data)}`,
        },
      ],
    };
  }
);

// ─── Tool: Add Shifts ────────────────────────────────────────────────────────

server.tool(
  "add_shifts",
  "Add one or more shifts to a Temp job. Each shift requires start/end times and total positions. Existing shifts cannot be updated via the API.",
  {
    jobRef: z.number().describe("The Temp job reference number"),
    shifts: z
      .array(
        z.object({
          ShiftName: z.string().optional().describe("Name of the shift"),
          ShiftStart: z
            .string()
            .describe("Shift start datetime (ISO format)"),
          ShiftEnd: z.string().describe("Shift end datetime (ISO format)"),
          ShiftBreakInMinutes: z
            .number()
            .optional()
            .describe("Break duration in minutes"),
          TotalPositions: z.number().describe("Number of positions for this shift"),
        })
      )
      .describe("Array of shift objects to add"),
  },
  async ({ jobRef, shifts }) => {
    const result = await client.post(`/api/v1.1/jobs/${jobRef}/shifts`, {
      Shifts: shifts,
    });
    if (!result.ok) return errorResult(result.error || "Failed to add shifts");
    return {
      content: [
        {
          type: "text" as const,
          text: `Shifts added to job ${jobRef}!\n\n${formatResult(result.data)}`,
        },
      ],
    };
  }
);

// ─── Tool: Search Candidates ─────────────────────────────────────────────────

server.tool(
  "search_candidates",
  "Search for candidates in Firefish. Filter by name, email, status, discipline, location, or keywords.",
  {
    name: z.string().optional().describe("Filter by candidate name (partial match)"),
    email: z.string().optional().describe("Filter by email address"),
    status: z.string().optional().describe("Filter by candidate status"),
    primaryDiscipline: z.string().optional().describe("Filter by primary discipline"),
    primaryLocation: z.string().optional().describe("Filter by primary location"),
    keywords: z.string().optional().describe("Search by keywords"),
    page: z.number().optional().describe("Page number (default: 1)"),
    pageSize: z.number().optional().describe("Results per page (default: 25)"),
  },
  async (params) => {
    const queryParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        queryParams[key] = String(value);
      }
    }
    const result = await client.get("/api/v1.0/candidates/search", queryParams);
    if (!result.ok)
      return errorResult(result.error || "Failed to search candidates");
    return {
      content: [{ type: "text" as const, text: formatResult(result.data) }],
    };
  }
);

// ─── Tool: Search Companies ──────────────────────────────────────────────────

server.tool(
  "search_companies",
  "Search for companies in Firefish. Use this to find a CompanyRef before creating a job. By default returns companies updated in the last 30 days unless dateFrom/dateTo are specified.",
  {
    name: z.string().optional().describe("Filter by company name (partial match)"),
    dateFrom: z.string().optional().describe("Return companies updated from this date (YYYY-MM-DD). Defaults to 30 days ago."),
    dateTo: z.string().optional().describe("Return companies updated to this date (YYYY-MM-DD). Defaults to today."),
    page: z.number().optional().describe("Page number (default: 1)"),
    pageSize: z.number().optional().describe("Results per page (default: 25, max: 1000)"),
  },
  async (params) => {
    // Build query params using Firefish's kebab-case header-style param names
    const queryParams: Record<string, string> = {};
    if (params.name) queryParams["name"] = params.name;
    if (params.page) queryParams["page"] = String(params.page);
    if (params.pageSize) queryParams["page-size"] = String(params.pageSize);

    // Default date range to last 30 days if not specified
    if (params.dateFrom) {
      queryParams["from-date"] = params.dateFrom;
    } else {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      queryParams["from-date"] = d.toISOString().split("T")[0];
    }
    if (params.dateTo) {
      queryParams["to-date"] = params.dateTo;
    }

    // Try v1.1 first (Company API PDF is v1.1.3), fall back to v1.0
    const attempts = [
      { label: "v1.1", path: "/api/v1.1/companies/search" },
      { label: "v1.0", path: "/api/v1.0/companies/search" },
    ];

    for (const attempt of attempts) {
      const result = await client.get(attempt.path, queryParams);
      if (result.ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: `(Fetched via ${attempt.label})\n\n${formatResult(result.data)}`,
            },
          ],
        };
      }
      console.error(
        `[firefish] search_companies ${attempt.label} failed (HTTP ${result.status}): ${result.error}`
      );
      // If we get a non-404 error (e.g. 400, 500), don't try fallback
      if (result.status !== 404) {
        return errorResult(result.error || "Failed to search companies");
      }
    }

    return errorResult("Companies search failed on both v1.1 and v1.0. The endpoint may not be available.");
  }
);

// ─── Tool: Search Contacts ───────────────────────────────────────────────────

server.tool(
  "search_contacts",
  "Search for contacts in Firefish. Use this to find a ContactRef (hiring manager) before creating a job. By default returns contacts updated in the last 30 days unless dateFrom/dateTo are specified.",
  {
    name: z.string().optional().describe("Filter by contact name (partial match)"),
    companyRef: z
      .number()
      .optional()
      .describe("Filter by company reference ID"),
    email: z.string().optional().describe("Filter by email address"),
    dateFrom: z.string().optional().describe("Return contacts updated from this date (YYYY-MM-DD). Defaults to 30 days ago."),
    dateTo: z.string().optional().describe("Return contacts updated to this date (YYYY-MM-DD). Defaults to today."),
    page: z.number().optional().describe("Page number (default: 1)"),
    pageSize: z.number().optional().describe("Results per page (default: 25, max: 1000)"),
  },
  async (params) => {
    // Build query params using Firefish's param naming conventions
    const queryParams: Record<string, string> = {};
    if (params.name) queryParams["name"] = params.name;
    if (params.companyRef) queryParams["company-ref"] = String(params.companyRef);
    if (params.email) queryParams["email"] = params.email;
    if (params.page) queryParams["page"] = String(params.page);
    if (params.pageSize) queryParams["page-size"] = String(params.pageSize);

    // Default date range to last 30 days if not specified
    if (params.dateFrom) {
      queryParams["from-date"] = params.dateFrom;
    } else {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      queryParams["from-date"] = d.toISOString().split("T")[0];
    }
    if (params.dateTo) {
      queryParams["to-date"] = params.dateTo;
    }

    const result = await client.get("/api/v1.0/contacts/search", queryParams);
    if (!result.ok)
      return errorResult(result.error || "Failed to search contacts");
    return {
      content: [{ type: "text" as const, text: formatResult(result.data) }],
    };
  }
);

// ─── Tool: Get Adverts ───────────────────────────────────────────────────────

server.tool(
  "get_adverts",
  "Retrieve adverts for a specific job. Shows advert text, status, and which job boards it's posted to.",
  {
    jobRef: z.number().describe("The job reference number to get adverts for"),
  },
  async ({ jobRef }) => {
    // Try v1.1 first, fall back to v1.0
    const attempts = [
      { label: "v1.1", path: `/api/v1.1/adverts/job/${jobRef}` },
      { label: "v1.0", path: `/api/v1.0/adverts/job/${jobRef}` },
    ];

    for (const attempt of attempts) {
      const result = await client.get(attempt.path);
      if (result.ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: `(Fetched via ${attempt.label})\n\n${formatResult(result.data)}`,
            },
          ],
        };
      }
      console.error(
        `[firefish] get_adverts ${attempt.label} failed (HTTP ${result.status}): ${result.error}`
      );
      if (result.status !== 404) {
        return errorResult(result.error || "Failed to get adverts");
      }
    }

    return errorResult(`No adverts found for job ${jobRef}, or the adverts endpoint is not available.`);
  }
);

// ─── Tool: Create Advert ─────────────────────────────────────────────────────

server.tool(
  "create_advert",
  "Create a new advert for a job. The advert contains the HTML job description that appears on job boards and the Firefish careers site.",
  {
    jobRef: z.number().describe("The job reference number to create an advert for"),
    title: z.string().describe("Advert title (usually the job title)"),
    summary: z
      .string()
      .optional()
      .describe("Short summary/teaser text for the advert"),
    description: z
      .string()
      .describe(
        "Full advert description in HTML format. This is the main content candidates will see."
      ),
    salary: z
      .string()
      .optional()
      .describe("Salary text to display (e.g. '€85,000 - €100,000+')"),
  },
  async (params) => {
    const body: Record<string, unknown> = {
      JobRef: params.jobRef,
      Title: params.title,
      Description: params.description,
    };
    if (params.summary) body.Summary = params.summary;
    if (params.salary) body.Salary = params.salary;

    // Try v1.1 first, fall back to v1.0
    let result = await client.post("/api/v1.1/adverts", body);
    if (!result.ok && result.status === 404) {
      console.error("[firefish] create_advert v1.1 returned 404, trying v1.0");
      result = await client.post("/api/v1.0/adverts", body);
    }
    if (!result.ok) return errorResult(result.error || "Failed to create advert");
    return {
      content: [
        {
          type: "text" as const,
          text: `Advert created for job ${params.jobRef}!\n\n${formatResult(result.data)}`,
        },
      ],
    };
  }
);

// ─── Tool: Search Placements ─────────────────────────────────────────────────

server.tool(
  "search_placements",
  "Search for placements in Firefish. Placements represent successful job fills (offers). By default returns placements from the last 90 days unless dateFrom/dateTo are specified.",
  {
    jobRef: z.number().optional().describe("Filter by job reference"),
    candidateRef: z.number().optional().describe("Filter by candidate reference"),
    companyRef: z.number().optional().describe("Filter by company reference"),
    status: z.string().optional().describe("Filter by placement status"),
    dateFrom: z.string().optional().describe("Return placements from this date (YYYY-MM-DD). Defaults to 90 days ago."),
    dateTo: z.string().optional().describe("Return placements to this date (YYYY-MM-DD). Defaults to today."),
    page: z.number().optional().describe("Page number (default: 1)"),
    pageSize: z.number().optional().describe("Results per page (default: 25, max: 1000)"),
  },
  async (params) => {
    // Build query params using Firefish's kebab-case naming
    const queryParams: Record<string, string> = {};
    if (params.jobRef) queryParams["job-ref"] = String(params.jobRef);
    if (params.candidateRef) queryParams["candidate-ref"] = String(params.candidateRef);
    if (params.companyRef) queryParams["company-ref"] = String(params.companyRef);
    if (params.status) queryParams["status"] = params.status;
    if (params.page) queryParams["page"] = String(params.page);
    if (params.pageSize) queryParams["page-size"] = String(params.pageSize);

    // Default date range to last 90 days if not specified
    if (params.dateFrom) {
      queryParams["from-date"] = params.dateFrom;
    } else {
      const d = new Date();
      d.setDate(d.getDate() - 90);
      queryParams["from-date"] = d.toISOString().split("T")[0];
    }
    if (params.dateTo) {
      queryParams["to-date"] = params.dateTo;
    }

    // Placements API is v1.1 (confirmed from Firefish API changelog)
    const result = await client.get("/api/v1.1/placements/search", queryParams);
    if (!result.ok)
      return errorResult(result.error || "Failed to search placements");
    return {
      content: [{ type: "text" as const, text: formatResult(result.data) }],
    };
  }
);

// ─── Tool: Update Candidate ──────────────────────────────────────────────────

server.tool(
  "update_candidate",
  "Update an existing candidate in Firefish. Supports partial updates — only include the fields you want to change. Use RecruiterSummary for internal notes (NEVER visible to candidates). Use CandidateSummary only for candidate-facing content.",
  {
    candidateRef: z.number().describe("The candidate reference number to update"),
    RecruiterSummary: z
      .string()
      .optional()
      .describe(
        "Internal recruiter notes — ONLY visible to Ceek team, never to candidates. Use this for Milo screening scores, recruiter observations, and internal assessments."
      ),
    CandidateSummary: z
      .string()
      .optional()
      .describe(
        "Candidate-facing summary. CAUTION: This is visible to the candidate. Never put scores, internal assessments, or tier classifications here."
      ),
    Skills: z
      .string()
      .optional()
      .describe("Comma-separated skills list"),
    Tags: z
      .string()
      .optional()
      .describe("Comma-separated tags for categorisation"),
    StarRating: z
      .number()
      .optional()
      .describe("Star rating 1-5"),
    HotStatus: z
      .boolean()
      .optional()
      .describe("Mark candidate as hot/priority"),
    PermanentStatus: z
      .string()
      .optional()
      .describe(
        "Permanent job status: 'available', 'passively-looking', 'not-looking', 'placed-by-us', 'placed-elsewhere'"
      ),
    ContractStatus: z
      .string()
      .optional()
      .describe(
        "Contract job status: 'available', 'passively-looking', 'not-looking', 'placed-by-us', 'placed-elsewhere'"
      ),
    OwnerUserEmail: z
      .string()
      .optional()
      .describe("Reassign candidate to a different recruiter by email"),
    CurrentSalary: z.number().optional().describe("Current salary"),
    DesiredSalary: z.number().optional().describe("Desired salary"),
    JobTitle: z.string().optional().describe("Current or target job title"),
  },
  async (params) => {
    const { candidateRef, ...updateFields } = params;
    const body: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updateFields)) {
      if (value !== undefined) {
        body[key] = value;
      }
    }

    if (Object.keys(body).length === 0) {
      return errorResult(
        "No fields to update. Provide at least one field to change."
      );
    }

    const result = await client.patch(
      `/api/v1.0/candidates/${candidateRef}`,
      body
    );
    if (!result.ok)
      return errorResult(result.error || "Failed to update candidate");
    return {
      content: [
        {
          type: "text" as const,
          text: `Candidate ${candidateRef} updated successfully!\n\n${formatResult(result.data)}`,
        },
      ],
    };
  }
);

// ─── Start Server ────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Firefish MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
