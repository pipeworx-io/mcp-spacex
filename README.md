# mcp-spacex

SpaceX MCP — revival of the (dead) SpaceX API.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1475+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `get_latest_launch` | Get the most recent SpaceX launch. Returns launch name, date (UTC), success status, mission details, rocket, launch pad, and media links (webcast, article, wikipedia). |
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

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/spacex/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1475+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Spacex data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
