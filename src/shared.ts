import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createClient } from "./utils.js";
import { log } from "apify";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export async function runNormalMode(
    targetUrl: string,
    token: string,
    sseEnabled: boolean,
    numClients: number,
    clientsCreationBatchSize: number,
    opsRate: number,
    maxRetries: number,
    initialBackoffMs: number,
    maxBackoffMs: number,
    backoffFactor: number,
) {
    const numBatches = Math.floor(numClients / clientsCreationBatchSize);

    const clients: Client[] = [];
    for (let i = 0; i < numBatches; i++) {
        const batch = await Promise.all(
            Array.from({ length: clientsCreationBatchSize }, () =>
                createClient({
                    targetUrl,
                    sseEnabled,
                    token,
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
                    token,
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

    process.on("SIGINT", async () => {
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
                process.exit(0);
            })
            .catch((error) => {
                log.error("Error closing clients:", error);
                process.exit(1);
            });
    });

    while (true) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
}

export async function runSwarmMode(
    targetUrl: string,
    token: string,
    sseEnabled: boolean,
    numClients: number,
    swarmInterval: number,
    maxRetries: number,
    initialBackoffMs: number,
    maxBackoffMs: number,
    backoffFactor: number,
) {
    const startTime = Date.now();
    let batchesCompleted = 0;
    let clientsCreated = 0;
    let operationsCompleted = 0;
    let operationsFailed = 0;
    let running = true;

    // In swarm mode, we use the numClients parameter for each batch
    const batchSize = numClients;

    process.on("SIGINT", async () => {
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
        process.exit(0);
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
                        token,
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
            await Promise.all(
                clients.map((client) => {
                    if (
                        client.transport instanceof
                        StreamableHTTPClientTransport
                    ) {
                        return client.transport.terminateSession();
                    }
                    return null;
                }),
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
