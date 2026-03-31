# mcp-spacex

MCP server for SpaceX data. Get launch info, rocket specs, crew members, and Starlink satellite tracking via the SpaceX API v4 — free, no API key required.

Part of the [Pipeworx](https://pipeworx.io) open MCP gateway.

## Tools

| Tool | Description |
|------|-------------|
| `get_latest_launch` | Get the most recent SpaceX launch |
| `get_next_launch` | Get the next upcoming SpaceX launch |
| `get_past_launches` | Get recent past launches sorted by date |
| `get_rockets` | List all SpaceX rockets with specs |
| `get_crew` | List SpaceX crew members |
| `get_starlink` | Get Starlink satellite info |

## Quick Start

```json
{
  "mcpServers": {
    "spacex": {
      "command": "npx",
      "args": ["-y", "mcp-remote@latest", "https://gateway.pipeworx.io/spacex/mcp"]
    }
  }
}
```

Or use the CLI:

```bash
npx pipeworx use spacex
```

## License

MIT
