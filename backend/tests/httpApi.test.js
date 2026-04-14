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
        assert.equal(data.code, "INVALID_INPUT");
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
        assert.equal(typeof data.qualityScorecard, "object");
        assert.equal(typeof data.qualityScorecard.percent, "number");
        assert.equal(typeof data.qualityScorecard.metrics, "object");
        assert.equal(typeof data.qualityScorecard.metrics.elementOverlaps, "number");
        assert.equal(typeof data.qualityScorecard.metrics.flowCrossingsTotal, "number");
        assert.equal(typeof data.qualityGateStatus, "string");
        assert.equal(Array.isArray(data.learning?.recentScores), true);
        assert.equal(data.routingDebug, null);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test("POST /api/generate supports routing debug payload", async () => {
    const fakeProcess = {
        roles: ["System"],
        steps: [
            { id: "step_1", type: "task", label: "A", role: "System", next: ["step_2", "step_3"] },
            { id: "step_2", type: "task", label: "B", role: "System", next: ["step_4"] },
            { id: "step_3", type: "task", label: "C", role: "System", next: ["step_4"] },
            { id: "step_4", type: "end", label: "Ende", role: "System" }
        ]
    };
    const app = createApp({
        analyzeText: async () => fakeProcess
    });
    const server = app.listen(0);

    try {
        const { port } = server.address();
        const response = await fetch(`http://127.0.0.1:${port}/api/generate?debugRouting=true`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: "Ein valider Prozess-Text." })
        });

        const data = await response.json();
        assert.equal(response.status, 200);
        assert.equal(data.success, true);
        assert.equal(Array.isArray(data.routingDebug?.flows), true);
        assert.ok(data.routingDebug.flows.some((flow) => flow.type === "main"));
        const branchOrLoop = data.routingDebug.flows.find((flow) => flow.type === "branch" || flow.type === "loop");
        assert.ok(branchOrLoop, "Routing debug should include at least one branch or loop flow");
        assert.ok("gatewaySideAnchor" in branchOrLoop, "Routing debug flow should expose gateway side anchor diagnostic");
        assert.ok("loopTargetAnchor" in branchOrLoop, "Routing debug flow should expose loop target anchor diagnostic");
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test("POST /api/generate supports strict quality gate blocking", async () => {
    const fakeProcess = {
        roles: ["System"],
        steps: [
            { id: "step_1", type: "task", label: "A", role: "System", next: ["step_2"] },
            { id: "step_2", type: "end", label: "Ende", role: "System" }
        ]
    };
    const app = createApp({
        analyzeText: async () => fakeProcess,
        generateBpmn: () => "<bpmn:definitions></bpmn:definitions>",
        buildScorecard: () => ({
            score: 10,
            maxScore: 100,
            percent: 10,
            grade: "E",
            gate: {
                needsRelayout: true,
                blocking: true,
                severity: "error",
                reasons: ["outOfWorkspaceFlows", "flowShapeOverlaps"]
            },
            checks: [],
            violations: [],
            suggestions: [],
            metrics: {
                outOfWorkspaceFlows: 1,
                flowCrossingsAvoidable: 0,
                flowShapeOverlaps: 1
            }
        })
    });
    const server = app.listen(0);

    try {
        const { port } = server.address();
        const response = await fetch(`http://127.0.0.1:${port}/api/generate?strictQualityGate=true`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: "Ein valider Prozess-Text." })
        });
        const data = await response.json();
        assert.equal(response.status, 422);
        assert.equal(data.success, false);
        assert.equal(data.code, "QUALITY_GATE_FAILED");
        assert.equal(data.qualityGateStatus, "failed_after_relayout");
        assert.match(String(data.error || ""), /Layout-Qualitaetsgrenzen verletzt/);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test("POST /api/generate keeps best-effort model when strict gate is non-blocking", async () => {
    const fakeProcess = {
        roles: ["System"],
        steps: [
            { id: "step_1", type: "task", label: "A", role: "System", next: ["step_2"] },
            { id: "step_2", type: "end", label: "Ende", role: "System" }
        ]
    };
    let scoreCall = 0;
    const app = createApp({
        analyzeText: async () => fakeProcess,
        generateBpmn: () => "<bpmn:definitions></bpmn:definitions>",
        buildScorecard: () => {
            scoreCall += 1;
            return {
                score: 80,
                maxScore: 100,
                percent: 80,
                grade: "B",
                gate: {
                    needsRelayout: true,
                    blocking: false,
                    severity: "warn",
                    reasons: ["flowCrossingsAvoidable"]
                },
                checks: [],
                violations: [],
                suggestions: [],
                metrics: {
                    outOfWorkspaceFlows: 0,
                    flowCrossingsAvoidable: 3,
                    flowShapeOverlaps: 0
                }
            };
        }
    });
    const server = app.listen(0);

    try {
        const { port } = server.address();
        const response = await fetch(`http://127.0.0.1:${port}/api/generate?strictQualityGate=true`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: "Ein valider Prozess-Text." })
        });
        const data = await response.json();
        assert.equal(response.status, 200);
        assert.equal(data.success, true);
        assert.equal(data.qualityGateStatus, "failed_after_relayout");
        assert.match(String(data.qualityGateMessage || ""), /Best-effort Modell ausgegeben/);
        assert.equal(scoreCall, 2);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test("POST /api/analyze returns 400 for invalid input", async () => {
    const app = createApp({
        analyzeText: async () => {
            throw new Error("should not be called");
        }
    });
    const server = app.listen(0);

    try {
        const { port } = server.address();
        const response = await fetch(`http://127.0.0.1:${port}/api/analyze`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: "abc" })
        });

        const data = await response.json();
        assert.equal(response.status, 400);
        assert.equal(data.success, false);
        assert.equal(data.code, "INVALID_INPUT");
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test("POST /api/analyze returns json for valid input", async () => {
    const fakeProcess = {
        roles: ["System"],
        steps: [
            {
                id: "step_1",
                type: "task",
                label: "Erfassen",
                role: "System"
            },
            {
                id: "step_2",
                type: "end",
                label: "Ende",
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
        const response = await fetch(`http://127.0.0.1:${port}/api/analyze`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: "Bitte pruefe den Antrag und beende den Prozess." })
        });

        const data = await response.json();
        assert.equal(response.status, 200);
        assert.equal(data.success, true);
        assert.deepEqual(data.json, fakeProcess);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test("POST /api/optimize returns 400 for invalid input", async () => {
    const app = createApp({
        optimizeText: async () => {
            throw new Error("should not be called");
        }
    });
    const server = app.listen(0);

    try {
        const { port } = server.address();
        const response = await fetch(`http://127.0.0.1:${port}/api/optimize`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: "abc" })
        });

        const data = await response.json();
        assert.equal(response.status, 400);
        assert.equal(data.success, false);
        assert.equal(data.code, "INVALID_INPUT");
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test("POST /api/optimize returns optimized text", async () => {
    const app = createApp({
        optimizeText: async (input) => `${input} (optimiert)`
    });
    const server = app.listen(0);

    try {
        const { port } = server.address();
        const response = await fetch(`http://127.0.0.1:${port}/api/optimize`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: "Bitte pruefe den Antrag." })
        });

        const data = await response.json();
        assert.equal(response.status, 200);
        assert.equal(data.success, true);
        assert.equal(data.optimizedText, "Bitte pruefe den Antrag. (optimiert)");
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test("GET /api/bpmn-knowledge-base returns instructions", async () => {
    const app = createApp({
        getKnowledgeBase: () => ({
            version: "test",
            instructions: [{ id: "ins_x", category: "core", level: "basic" }],
            antiPatterns: [],
            qualityChecklist: []
        })
    });
    const server = app.listen(0);

    try {
        const { port } = server.address();
        const response = await fetch(`http://127.0.0.1:${port}/api/bpmn-knowledge-base`);
        const data = await response.json();

        assert.equal(response.status, 200);
        assert.equal(data.success, true);
        assert.equal(data.data.version, "test");
        assert.equal(Array.isArray(data.data.instructions), true);
        assert.equal(data.data.instructions.length, 1);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
