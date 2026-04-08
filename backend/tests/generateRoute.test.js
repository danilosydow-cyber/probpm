import test from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../server.js";

test("POST /api/generate returns 400 for invalid input", async () => {
    const app = createApp({
        analyzeText: async () => {
            throw new Error("should not be called");
        }
    });
    const server = app.listen(0);

    try {
        const { port } = server.address();
        const response = await fetch(`http://127.0.0.1:${port}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: "abc" })
        });

        const data = await response.json();
        assert.equal(response.status, 400);
        assert.equal(data.success, false);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test("POST /api/generate returns json and xml for valid input", async () => {
    const fakeProcess = {
        roles: ["System"],
        steps: [
            {
                id: "step_1",
                type: "task",
                label: "Erfassen",
                role: "System"
            }
        ]
    };

    const app = createApp({
        analyzeText: async () => fakeProcess
    });
    const server = app.listen(0);

    try {
        const { port } = server.address();
        const response = await fetch(`http://127.0.0.1:${port}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: "Ein valider Prozess-Text." })
        });

        const data = await response.json();
        assert.equal(response.status, 200);
        assert.equal(data.success, true);
        assert.deepEqual(data.json, fakeProcess);
        assert.equal(typeof data.xml, "string");
        assert.ok(data.xml.includes("<bpmn:definitions"));
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
