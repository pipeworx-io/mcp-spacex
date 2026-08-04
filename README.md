# mcp-spacex

SpaceX MCP — Pipeworx-hosted revival of the (dead) SpaceX API.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `get_latest_launch` | Get the most recent SpaceX launch. Returns launch name, date (UTC), success status, mission details, rocket, launch pad, and media links (webcast, article, wikipedia). Served from the Pipeworx-hosted SpaceX mirror. |
| `get_next_launch` | Get the next upcoming SpaceX launch. Returns launch name, scheduled date (UTC, may be TBD), mission details, rocket, and launch pad. |
| `get_past_launches` | Get recent past SpaceX launches sorted by date descending. Returns name, date (UTC), status, and success for each launch. |
| `get_rockets` | List SpaceX rocket configurations (Falcon 1, Falcon 9, Falcon Heavy, Starship, …). Returns name, family, reusability, maiden flight, launch cost, launch/success counts, and success rate. |
| `get_crew` | List astronauts who have flown (or are assigned to) SpaceX Crew Dragon missions. Returns name, agency, in-flight status, mission, role, wikipedia, and image URL. Derived from recent crewed SpaceX launches. |
| `get_starlink` | Get live Starlink satellites from the public catalog (CelesTrak), sorted by most recent orbital-element epoch. Returns object name, NORAD/COSPAR id, epoch, mean motion, inclination, and eccentricity. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "spacex": {
      "url": "https://gateway.pipeworx.io/spacex/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Spacex data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
