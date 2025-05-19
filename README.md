# MCP stress tester 🚀🔥

[![MCP Stress Tester](https://apify.com/actor-badge?actor=jakub.kopecky/mcp-stress-tester)](https://apify.com/jakub.kopecky/mcp-stress-tester)

A simple MCP Stress Tester client Actor for stress-testing your MCP server. 💻⚡

**Supported transports**:
- Legacy SSE HTTP 🌐
- Streamable HTTP 🚀

**Test modes**:
- Normal mode: Maintains persistent client connections that continuously send operations
- Swarm mode: Constantly creates and destroys client connections to simulate dynamic load patterns

**Run as**:
- CLI tool 🛠️
- Apify Actor 🐙

## Usage 🛠️

Fill in the target MCP server URL, select the test mode, configure the client settings, and start the Actor to test your MCP server's performance! 🔥

### Normal vs swarm mode

**Normal mode**:
- Creates a fixed number of persistent client connections
- Each client continuously sends operations at the specified rate
- Best for testing steady-state performance and long-running connections

**Swarm mode**:
- Creates and destroys batches of clients at regular intervals
- Each client performs exactly one operation before being closed
- Best for testing connection handling, resource cleanup, and server resilience

### Key parameters

- **Target URL**: Your MCP server endpoint
- **Mode**: "normal" or "swarm"
- **Number of clients**:
  - In normal mode: Total number of concurrent connections to maintain
  - In swarm mode: Number of clients to create in each batch
- **Clients creation batch size**:
  - In normal mode: Number of clients to create in each initialization batch
  - In swarm mode: This parameter is ignored
- **Operations rate**:
  - In normal mode: Operations per minute per client
  - In swarm mode: Ignored (each client performs exactly one operation)
- **Swarm interval**: Time in milliseconds between creating new batches in swarm mode

## Open source 🌟

This project is open source and available on [GitHub](https://github.com/apify/actor-mcp-stress-tester). 🐙✨
