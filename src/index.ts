#!/usr/bin/env node
import { log } from "apify";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createClient } from "./utils.js";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

// Interface for input arguments
interface InputArgs {
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

// Parse command line arguments using yargs
const argv = yargs(hideBin(process.argv))
    .option("target", {
        alias: "t",
        type: "string",
        description: "Target MCP server URL",
        demandOption: true,
    })
    .option("sse", {
        type: "boolean",
        description: "Enable SSE transport",
        default: false,
    })
    .option("clients", {
        alias: "c",
        type: "number",
        description:
            "In normal mode: total number of concurrent client connections to maintain. In swarm mode: number of clients to create in each batch.",
        default: 10,
    })
    .option("clientsCreationBatchSize", {
        type: "number",
        description:
            "In normal mode: number of clients to create in each initialization batch (to avoid overwhelming the server). In swarm mode: this parameter is ignored.",
        default: 5,
    })
    .option("opsRate", {
        alias: "r",
        type: "number",
        description:
            "In normal mode: operations (list tools) per minute per client. In swarm mode: this parameter is ignored as each client performs exactly one operation before being closed.",
        default: 60,
    })
    .option("maxRetries", {
        type: "number",
        description: "Maximum number of retries",
        default: 3,
    })
    .option("initialBackoffMs", {
        type: "number",
        description: "Initial backoff in milliseconds",
        default: 100,
    })
    .option("maxBackoffMs", {
        type: "number",
        description: "Maximum backoff in milliseconds",
        default: 10000,
    })
    .option("backoffFactor", {
        type: "number",
        description: "Backoff factor",
        default: 2,
    })
    .option("mode", {
        type: "string",
        description:
            "Test mode: 'normal' (persistent clients that continuously send operations) or 'swarm' (constantly creating/closing clients to simulate dynamic load patterns)",
        choices: ["normal", "swarm"],
        default: "normal",
    })
    .option("swarmInterval", {
        type: "number",
        description:
            "Interval in ms between swarm batches (only used in swarm mode). Controls how frequently new client batches are created and destroyed.",
        default: 5000,
    })
    .help()
    .alias("help", "h")
    .version()
    .alias("version", "v")
    .parse();

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
    mode,
    swarmInterval,
}: InputArgs = argv as InputArgs;

async function main() {
    log.info(`Starting benchmark with the following configuration:
- Target URL: ${targetUrl}
- SSE Enabled: ${sseEnabled}
- Mode: ${mode}
- Number of Clients: ${numClients}
- Clients Creation Batch Size: ${clientsCreationBatchSize}
- Operations Per Minute: ${opsRate}
- Max Retries: ${maxRetries}
- Initial Backoff: ${initialBackoffMs}ms
- Max Backoff: ${maxBackoffMs}ms
- Backoff Factor: ${backoffFactor}
${mode === "swarm" ? `- Swarm Interval: ${swarmInterval}ms` : ""}
`);

    if (mode === "normal") {
        await runNormalMode();
    } else if (mode === "swarm") {
        await runSwarmMode();
    } else {
        log.error(`Unknown mode: ${mode}`);
        process.exit(1);
    }
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

async function runSwarmMode() {
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

main().catch((error) => {
    log.error("Error in main execution:", error);
    process.exit(1);
});
