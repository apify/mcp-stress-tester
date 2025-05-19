import { Actor, log } from "apify";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createClient } from "./utils.js";

await Actor.init();

interface Input {
    target: string;
    sse: boolean;
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
    await runNormalMode();
} else if (mode === "swarm") {
    await runSwarmMode();
} else {
    log.error(`Unknown mode: ${mode}`);
    process.exit(1);
}

async function runNormalMode() {
    const numBatches = Math.floor(numClients / clientsCreationBatchSize);

    const clients: Client[] = [];
    for (let i = 0; i < numBatches; i++) {
        const batch = await Promise.all(
            Array.from({ length: clientsCreationBatchSize }, () =>
                createClient({
                    targetUrl,
                    sseEnabled,
                    token: process.env.APIFY_TOKEN as string,
                    maxRetries,
                    initialBackoffMs,
                    maxBackoffMs,
                    backoffFactor,
                }),
            ),
        );
        log.info(
            `Created client batch ${i + 1} of ${Math.ceil(numClients / clientsCreationBatchSize)}`,
        );
        clients.push(...batch);
    }
    if (numClients % clientsCreationBatchSize !== 0) {
        const remainingClients = numClients % clientsCreationBatchSize;
        const batch = await Promise.all(
            Array.from({ length: remainingClients }, () =>
                createClient({
                    targetUrl,
                    sseEnabled,
                    token: process.env.APIFY_TOKEN as string,
                    maxRetries,
                    initialBackoffMs,
                    maxBackoffMs,
                    backoffFactor,
                }),
            ),
        );
        log.info(`Created final client batch of ${remainingClients}`);
        clients.push(...batch);
    }

    log.info(
        `Successfully created ${clients.length} clients. Starting benchmark operations...`,
    );

    const startTime = Date.now();
    let operationsCompleted = 0;
    let operationsFailed = 0;

    const intervalIDs = clients.map((_, index) => {
        return setInterval(async () => {
            try {
                await clients[index].listTools(undefined, {
                    timeout: 60000,
                });
                operationsCompleted++;
                if (operationsCompleted % 100 === 0) {
                    const elapsedSeconds = (Date.now() - startTime) / 1000;
                    const opsPerSec = operationsCompleted / elapsedSeconds;
                    log.info(
                        `Completed ${operationsCompleted} operations (${(opsPerSec).toFixed(2)} ops/sec), failed: ${operationsFailed}`,
                    );
                }
            } catch (error) {
                operationsFailed++;
                log.error(`Error listing tools for client ${index}: ${error}`);
            }
        }, 60000 / opsRate);
    });

    Actor.on("aborting", async () => {
        log.info("Received abort. Closing clients...");
        for (const id of intervalIDs) {
            clearInterval(id);
        }

        const elapsedSeconds = (Date.now() - startTime) / 1000;
        log.info(`
Benchmark Summary:
- Total operations completed: ${operationsCompleted}
- Total operations failed: ${operationsFailed}
- Average throughput: ${(operationsCompleted / elapsedSeconds).toFixed(2)} ops/sec
- Total runtime: ${elapsedSeconds.toFixed(2)} seconds
`);

        await Promise.all(clients.map((client) => client.close()))
            .then(() => {
                log.info("All clients closed.");
            })
            .catch((error) => {
                log.error("Error closing clients:", error);
            });
    });

    while (true) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
}

async function runSwarmMode() {
    const startTime = Date.now();
    let batchesCompleted = 0;
    let clientsCreated = 0;
    let operationsCompleted = 0;
    let operationsFailed = 0;
    let running = true;

    // In swarm mode, we use the numClients parameter for each batch
    const batchSize = numClients;

    log.info(
        `Swarm mode: Each batch will create ${batchSize} clients, perform one operation per client, then close them.`,
    );
    log.info(
        `Swarm mode: New batches will be created every ${swarmInterval}ms.`,
    );

    Actor.on("aborting", async () => {
        log.info("Received abort. Stopping swarm mode...");
        running = false;

        const elapsedSeconds = (Date.now() - startTime) / 1000;
        log.info(`
Swarm Benchmark Summary:
- Total batches completed: ${batchesCompleted}
- Total clients created: ${clientsCreated}
- Total operations completed: ${operationsCompleted}
- Total operations failed: ${operationsFailed}
- Average client creation rate: ${(clientsCreated / elapsedSeconds).toFixed(2)} clients/sec
- Average operation rate: ${(operationsCompleted / elapsedSeconds).toFixed(2)} ops/sec
- Total runtime: ${elapsedSeconds.toFixed(2)} seconds
`);
    });

    while (running) {
        try {
            // Create a batch of clients
            log.info(
                `Creating batch #${batchesCompleted + 1} with ${batchSize} clients...`,
            );
            const clients = await Promise.all(
                Array.from({ length: batchSize }, () =>
                    createClient({
                        targetUrl,
                        sseEnabled,
                        token: process.env.APIFY_TOKEN as string,
                        maxRetries,
                        initialBackoffMs,
                        maxBackoffMs,
                        backoffFactor,
                    }),
                ),
            );
            clientsCreated += clients.length;

            // Have each client list tools
            log.info(
                `Batch #${batchesCompleted + 1}: Listing tools with ${clients.length} clients...`,
            );
            const results = await Promise.allSettled(
                clients.map((client) =>
                    client.listTools(undefined, { timeout: 60000 }),
                ),
            );

            // Count successes and failures
            const successes = results.filter(
                (r) => r.status === "fulfilled",
            ).length;
            const failures = results.filter(
                (r) => r.status === "rejected",
            ).length;
            operationsCompleted += successes;
            operationsFailed += failures;

            // Close all clients
            log.info(
                `Batch #${batchesCompleted + 1}: Closing ${clients.length} clients...`,
            );
            await Promise.all(clients.map((client) => client.close()));

            batchesCompleted++;

            // Log progress periodically
            if (batchesCompleted % 5 === 0) {
                const elapsedSeconds = (Date.now() - startTime) / 1000;
                log.info(`
Swarm Progress:
- Batches completed: ${batchesCompleted}
- Clients created: ${clientsCreated}
- Operations completed: ${operationsCompleted} (${(operationsCompleted / elapsedSeconds).toFixed(2)} ops/sec)
- Operations failed: ${operationsFailed}
- Runtime: ${elapsedSeconds.toFixed(2)} seconds
`);
            }

            // Wait before creating the next batch
            await new Promise((resolve) => setTimeout(resolve, swarmInterval));
        } catch (error) {
            log.error(`Error in swarm batch: ${error}`);
        }
    }
}

// Gracefully exit the Actor process. It's recommended to quit all Actors with an exit().
await Actor.exit();
