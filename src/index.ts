#!/usr/bin/env node
import { log } from "apify";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { runNormalMode, runSwarmMode } from "./shared.js";

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
        await runNormalMode(
            targetUrl,
            process.env.APIFY_TOKEN as string,
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
            process.env.APIFY_TOKEN as string,
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
}

main().catch((error) => {
    log.error("Error in main execution:", error);
    process.exit(1);
});
