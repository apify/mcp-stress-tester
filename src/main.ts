import { Actor, log } from "apify";
import { runNormalMode, runSwarmMode } from "./shared.js";

await Actor.init();

interface Input {
    target: string;
    sse: boolean;
    token: string;
    clients: number;
    clientsCreationBatchSize: number;
    opsRate: number;
    maxRetries: number;
    initialBackoffMs: number;
    maxBackoffMs: number;
    backoffFactor: number;
    mode: "normal" | "swarm";
    swarmInterval: number;
}
// Structure of input is defined in input_schema.json
const input = await Actor.getInput<Input>();
if (!input) throw new Error("Input is missing!");
const {
    target: targetUrl,
    sse: sseEnabled,
    token,
    clients: numClients,
    clientsCreationBatchSize,
    opsRate,
    maxRetries,
    initialBackoffMs,
    maxBackoffMs,
    backoffFactor,
    mode = "normal",
    swarmInterval = 5000,
} = input;

log.info(`Starting benchmark with the following configuration:
- Target URL: ${targetUrl}
- SSE Enabled: ${sseEnabled}
- Mode: ${mode}
${mode === "normal" ? `- Number of Clients: ${numClients} (total concurrent connections)` : `- Clients Per Batch: ${numClients}`}
${mode === "normal" ? `- Clients Creation Batch Size: ${clientsCreationBatchSize} (for initialization)` : ""}
${mode === "normal" ? `- Operations Per Minute Per Client: ${opsRate}` : ""}
- Max Retries: ${maxRetries}
- Initial Backoff: ${initialBackoffMs}ms
- Max Backoff: ${maxBackoffMs}ms
- Backoff Factor: ${backoffFactor}
${mode === "swarm" ? `- Swarm Interval: ${swarmInterval}ms (between batches)` : ""}
`);

if (mode === "normal") {
    await runNormalMode(
        targetUrl,
        token,
        sseEnabled,
        numClients,
        clientsCreationBatchSize,
        opsRate,
        maxRetries,
        initialBackoffMs,
        maxBackoffMs,
        backoffFactor,
    );
} else if (mode === "swarm") {
    await runSwarmMode(
        targetUrl,
        token,
        sseEnabled,
        numClients,
        swarmInterval,
        maxRetries,
        initialBackoffMs,
        maxBackoffMs,
        backoffFactor,
    );
} else {
    log.error(`Unknown mode: ${mode}`);
    process.exit(1);
}

// Gracefully exit the Actor process. It's recommended to quit all Actors with an exit().
await Actor.exit();
