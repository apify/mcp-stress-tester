import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export type CreateClientOptions = {
    targetUrl: string;
    sseEnabled: boolean;
    token: string;
    maxRetries?: number;
    initialBackoffMs?: number;
    maxBackoffMs?: number;
    backoffFactor?: number;
};

/**
 * Sleep for the specified number of milliseconds
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Create a client with exponential backoff retry logic
 */
export async function createClient(
    options: CreateClientOptions,
): Promise<Client> {
    const {
        targetUrl,
        sseEnabled,
        token,
        maxRetries = 5,
        initialBackoffMs = 100,
        maxBackoffMs = 10000,
        backoffFactor = 2,
    } = options;

    let retries = 0;
    let backoffMs = initialBackoffMs;

    while (true) {
        try {
            let transport: StreamableHTTPClientTransport | SSEClientTransport;
            if (sseEnabled) {
                transport = new SSEClientTransport(new URL(targetUrl), {
                    requestInit: {
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                    },
                    eventSourceInit: {
                        // The EventSource package augments EventSourceInit with a "fetch" parameter.
                        // You can use this to set additional headers on the outgoing request.
                        // Based on this example: https://github.com/modelcontextprotocol/typescript-sdk/issues/118
                        async fetch(
                            input: Request | URL | string,
                            init?: RequestInit,
                        ) {
                            const headers = new Headers(init?.headers || {});
                            headers.set("authorization", `Bearer ${token}`);
                            return fetch(input, { ...init, headers });
                        },
                        // We have to cast to "any" to use it, since it's non-standard
                    },
                });
            } else {
                transport = new StreamableHTTPClientTransport(
                    new URL(targetUrl),
                    {
                        requestInit: {
                            headers: {
                                Authorization: `Bearer ${token}`,
                            },
                        },
                    },
                );
            }

            const client = new Client({
                name: "benchmark-client",
                version: "1.0.0",
            });

            await client.connect(transport);
            return client;
        } catch (error) {
            retries++;
            if (retries > maxRetries) {
                console.error(
                    `Failed to create client after ${maxRetries} retries:`,
                    error,
                );
                throw error;
            }

            // Add jitter to avoid thundering herd problem
            const jitter = Math.random() * 0.3 + 0.85; // Random value between 0.85 and 1.15
            const actualBackoff = Math.min(backoffMs * jitter, maxBackoffMs);

            console.warn(
                `Client creation failed, retrying in ${Math.round(actualBackoff)}ms (attempt ${retries}/${maxRetries})`,
            );
            await sleep(actualBackoff);

            // Increase backoff for next attempt
            backoffMs = Math.min(backoffMs * backoffFactor, maxBackoffMs);
        }
    }
}
