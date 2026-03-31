/**
 * SpaceX MCP — wraps SpaceX API v4 (free, no auth)
 *
 * Tools:
 * - get_latest_launch: Most recent SpaceX launch
 * - get_next_launch: Next upcoming SpaceX launch
 * - get_past_launches: Recent past launches (configurable limit)
 * - get_rockets: All SpaceX rockets
 * - get_crew: SpaceX crew members
 * - get_starlink: Starlink satellite info
 */

interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

const BASE_URL = 'https://api.spacexdata.com/v4';

const tools: McpToolExport['tools'] = [
  {
    name: 'get_latest_launch',
    description:
      'Get the most recent SpaceX launch. Returns launch name, date, success status, details, rocket id, and media links (webcast, article, wikipedia).',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_next_launch',
    description:
      'Get the next upcoming SpaceX launch. Returns launch name, date, details, and rocket id.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_past_launches',
    description:
      'Get recent past SpaceX launches sorted by date descending. Returns name, date, success status, and details for each launch.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of launches to return (default 10)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_rockets',
    description:
      'List all SpaceX rockets. Returns name, type, active status, stages, boosters, cost per launch, success rate, first flight date, and description.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_crew',
    description:
      'List SpaceX crew members. Returns name, agency, status, wikipedia link, and image URL for each crew member.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_starlink',
    description:
      'Get Starlink satellite info sorted by most recently launched. Returns spaceTrack data including object name, launch date, and decay date.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of satellites to return (default 20)',
        },
      },
      required: [],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'get_latest_launch':
      return getLatestLaunch();
    case 'get_next_launch':
      return getNextLaunch();
    case 'get_past_launches':
      return getPastLaunches((args.limit as number) ?? 10);
    case 'get_rockets':
      return getRockets();
    case 'get_crew':
      return getCrew();
    case 'get_starlink':
      return getStarlink((args.limit as number) ?? 20);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function getLatestLaunch() {
  const res = await fetch(`${BASE_URL}/launches/latest`);
  if (!res.ok) throw new Error(`SpaceX API error: ${res.status}`);

  const data = (await res.json()) as {
    name: string;
    date_utc: string;
    success: boolean | null;
    details: string | null;
    rocket: string;
    links: {
      webcast: string | null;
      article: string | null;
      wikipedia: string | null;
    };
  };

  return {
    name: data.name,
    date_utc: data.date_utc,
    success: data.success,
    details: data.details,
    rocket: data.rocket,
    links: {
      webcast: data.links.webcast,
      article: data.links.article,
      wikipedia: data.links.wikipedia,
    },
  };
}

async function getNextLaunch() {
  const res = await fetch(`${BASE_URL}/launches/next`);
  if (!res.ok) throw new Error(`SpaceX API error: ${res.status}`);

  const data = (await res.json()) as {
    name: string;
    date_utc: string;
    details: string | null;
    rocket: string;
  };

  return {
    name: data.name,
    date_utc: data.date_utc,
    details: data.details,
    rocket: data.rocket,
  };
}

async function getPastLaunches(limit: number) {
  const res = await fetch(`${BASE_URL}/launches/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: {},
      options: {
        sort: { date_utc: 'desc' },
        limit,
      },
    }),
  });
  if (!res.ok) throw new Error(`SpaceX API error: ${res.status}`);

  const data = (await res.json()) as {
    docs: {
      name: string;
      date_utc: string;
      success: boolean | null;
      details: string | null;
    }[];
  };

  return {
    launches: data.docs.map((launch) => ({
      name: launch.name,
      date_utc: launch.date_utc,
      success: launch.success,
      details: launch.details,
    })),
  };
}

async function getRockets() {
  const res = await fetch(`${BASE_URL}/rockets`);
  if (!res.ok) throw new Error(`SpaceX API error: ${res.status}`);

  const data = (await res.json()) as {
    name: string;
    type: string;
    active: boolean;
    stages: number;
    boosters: number;
    cost_per_launch: number;
    success_rate_pct: number;
    first_flight: string;
    description: string;
  }[];

  return {
    rockets: data.map((rocket) => ({
      name: rocket.name,
      type: rocket.type,
      active: rocket.active,
      stages: rocket.stages,
      boosters: rocket.boosters,
      cost_per_launch: rocket.cost_per_launch,
      success_rate_pct: rocket.success_rate_pct,
      first_flight: rocket.first_flight,
      description: rocket.description,
    })),
  };
}

async function getCrew() {
  const res = await fetch(`${BASE_URL}/crew`);
  if (!res.ok) throw new Error(`SpaceX API error: ${res.status}`);

  const data = (await res.json()) as {
    name: string;
    agency: string;
    status: string;
    wikipedia: string;
    image: string;
  }[];

  return {
    crew: data.map((member) => ({
      name: member.name,
      agency: member.agency,
      status: member.status,
      wikipedia: member.wikipedia,
      image: member.image,
    })),
  };
}

async function getStarlink(limit: number) {
  const res = await fetch(`${BASE_URL}/starlink/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: {},
      options: {
        limit,
        sort: { launch: 'desc' },
      },
    }),
  });
  if (!res.ok) throw new Error(`SpaceX API error: ${res.status}`);

  const data = (await res.json()) as {
    docs: {
      spaceTrack: {
        OBJECT_NAME: string;
        LAUNCH_DATE: string;
        DECAY_DATE: string | null;
      } | null;
    }[];
  };

  return {
    satellites: data.docs.map((sat) => ({
      OBJECT_NAME: sat.spaceTrack?.OBJECT_NAME ?? null,
      LAUNCH_DATE: sat.spaceTrack?.LAUNCH_DATE ?? null,
      DECAY_DATE: sat.spaceTrack?.DECAY_DATE ?? null,
    })),
  };
}

export default { tools, callTool } satisfies McpToolExport;
