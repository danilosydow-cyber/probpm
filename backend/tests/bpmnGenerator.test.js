import test from "node:test";
import assert from "node:assert/strict";

import { generateBPMN } from "../services/bpmnGenerator.js";

function getSequenceFlowId(xml, sourceRef, targetRef) {
    const escapedSource = sourceRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedTarget = targetRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const flowRegex = new RegExp(
        `<bpmn:sequenceFlow id="([^"]+)" sourceRef="${escapedSource}" targetRef="${escapedTarget}"`,
        "i"
    );
    const match = flowRegex.exec(xml);
    return match ? match[1] : null;
}

function getSequenceFlowName(xml, sourceRef, targetRef) {
    const escapedSource = sourceRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedTarget = targetRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const flowRegex = new RegExp(
        `<bpmn:sequenceFlow id="[^"]+" sourceRef="${escapedSource}" targetRef="${escapedTarget}"(?: name="([^"]+)")?`,
        "i"
    );
    const match = flowRegex.exec(xml);
    return match ? match[1] || "" : "";
}

function getEdgeWaypoints(xml, flowId) {
    if (!flowId) return [];
    const edgeRegex = new RegExp(
        `<bpmndi:BPMNEdge bpmnElement="${flowId}">([\\s\\S]*?)<\\/bpmndi:BPMNEdge>`,
        "i"
    );
    const edgeMatch = edgeRegex.exec(xml);
    if (!edgeMatch) return [];
    const waypointRegex = /<di:waypoint x="(-?\d+)" y="(-?\d+)" \/>/g;
    const points = [];
    let match = waypointRegex.exec(edgeMatch[1]);
    while (match) {
        points.push({ x: Number(match[1]), y: Number(match[2]) });
        match = waypointRegex.exec(edgeMatch[1]);
    }
    return points;
}

function isOrthogonal(points) {
    if (points.length < 2) return true;
    for (let i = 0; i < points.length - 1; i += 1) {
        const a = points[i];
        const b = points[i + 1];
        const horizontal = a.y === b.y;
        const vertical = a.x === b.x;
        if (!horizontal && !vertical) return false;
    }
    return true;
}

function toSegments(points, flowId) {
    const segments = [];
    for (let i = 0; i < points.length - 1; i += 1) {
        segments.push({
            flowId,
            a: points[i],
            b: points[i + 1]
        });
    }
    return segments;
}

function pointsEqual(p1, p2) {
    return p1.x === p2.x && p1.y === p2.y;
}

function segmentIntersection(seg1, seg2) {
    const { a: p1, b: p2 } = seg1;
    const { a: p3, b: p4 } = seg2;

    const seg1Horizontal = p1.y === p2.y;
    const seg2Horizontal = p3.y === p4.y;
    const seg1Vertical = p1.x === p2.x;
    const seg2Vertical = p3.x === p4.x;

    // Only evaluate orthogonal crossings (H x V or V x H)
    if (seg1Horizontal && seg2Vertical) {
        const inX = Math.min(p1.x, p2.x) <= p3.x && p3.x <= Math.max(p1.x, p2.x);
        const inY = Math.min(p3.y, p4.y) <= p1.y && p1.y <= Math.max(p3.y, p4.y);
        if (inX && inY) return { x: p3.x, y: p1.y };
    }
    if (seg1Vertical && seg2Horizontal) {
        const inX = Math.min(p3.x, p4.x) <= p1.x && p1.x <= Math.max(p3.x, p4.x);
        const inY = Math.min(p1.y, p2.y) <= p3.y && p3.y <= Math.max(p1.y, p2.y);
        if (inX && inY) return { x: p1.x, y: p3.y };
    }
    return null;
}

function getAllFlowIds(xml) {
    const regex = /<bpmn:sequenceFlow id="([^"]+)"/g;
    const ids = [];
    let match = regex.exec(xml);
    while (match) {
        ids.push(match[1]);
        match = regex.exec(xml);
    }
    return ids;
}

function getFlowRefs(xml) {
    const regex = /<bpmn:sequenceFlow id="([^"]+)" sourceRef="([^"]+)" targetRef="([^"]+)"/g;
    const refs = [];
    let match = regex.exec(xml);
    while (match) {
        refs.push({ flowId: match[1], sourceRef: match[2], targetRef: match[3] });
        match = regex.exec(xml);
    }
    return refs;
}

function getLaneYBounds(xml) {
    const laneRegex = /<bpmndi:BPMNShape bpmnElement="Lane_[^"]+"[^>]*><dc:Bounds x="[^"]+" y="(-?\d+)" width="[^"]+" height="(-?\d+)" \/>/g;
    const values = [];
    let match = laneRegex.exec(xml);
    while (match) {
        const y = Number(match[1]);
        const h = Number(match[2]);
        values.push({ min: y, max: y + h });
        match = laneRegex.exec(xml);
    }
    if (values.length === 0) return null;
    return {
        min: Math.min(...values.map((v) => v.min)),
        max: Math.max(...values.map((v) => v.max))
    };
}

function getLaneBounds(xml, laneElementId) {
    const escapedId = laneElementId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const laneRegex = new RegExp(
        `<bpmndi:BPMNShape bpmnElement="${escapedId}"[^>]*><dc:Bounds x="(-?\\d+)" y="(-?\\d+)" width="(-?\\d+)" height="(-?\\d+)" \\/>`,
        "i"
    );
    const match = laneRegex.exec(xml);
    if (!match) return null;
    return {
        x: Number(match[1]),
        y: Number(match[2]),
        width: Number(match[3]),
        height: Number(match[4])
    };
}

function getShapeBounds(xml, elementId) {
    const escapedId = elementId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const shapeRegex = new RegExp(
        `<bpmndi:BPMNShape bpmnElement="${escapedId}"[^>]*><dc:Bounds x="(-?\\d+)" y="(-?\\d+)" width="(-?\\d+)" height="(-?\\d+)" \\/>`,
        "i"
    );
    const match = shapeRegex.exec(xml);
    if (!match) return null;
    return {
        x: Number(match[1]),
        y: Number(match[2]),
        width: Number(match[3]),
        height: Number(match[4])
    };
}

function segmentTouchesRectInterior(seg, rect) {
    if (!rect) return false;
    const left = rect.x;
    const right = rect.x + rect.width;
    const top = rect.y;
    const bottom = rect.y + rect.height;

    if (seg.a.y === seg.b.y) {
        const y = seg.a.y;
        if (!(top < y && y < bottom)) return false;
        const minX = Math.min(seg.a.x, seg.b.x);
        const maxX = Math.max(seg.a.x, seg.b.x);
        return Math.max(minX, left) < Math.min(maxX, right);
    }

    if (seg.a.x === seg.b.x) {
        const x = seg.a.x;
        if (!(left < x && x < right)) return false;
        const minY = Math.min(seg.a.y, seg.b.y);
        const maxY = Math.max(seg.a.y, seg.b.y);
        return Math.max(minY, top) < Math.min(maxY, bottom);
    }

    return false;
}

function segmentOverlapType(segA, segB) {
    const aHorizontal = segA.a.y === segA.b.y;
    const bHorizontal = segB.a.y === segB.b.y;
    const aVertical = segA.a.x === segA.b.x;
    const bVertical = segB.a.x === segB.b.x;

    if (aVertical && bVertical && segA.a.x === segB.a.x) {
        const overlap =
            Math.max(Math.min(segA.a.y, segA.b.y), Math.min(segB.a.y, segB.b.y))
            < Math.min(Math.max(segA.a.y, segA.b.y), Math.max(segB.a.y, segB.b.y));
        if (overlap) return "vertical";
    }

    if (aHorizontal && bHorizontal && segA.a.y === segB.a.y) {
        const overlap =
            Math.max(Math.min(segA.a.x, segA.b.x), Math.min(segB.a.x, segB.b.x))
            < Math.min(Math.max(segA.a.x, segA.b.x), Math.max(segB.a.x, segB.b.x));
        if (overlap) return "horizontal";
    }

    return null;
}

function getEdgeLabelBounds(xml, flowId) {
    if (!flowId) return null;
    const edgeRegex = new RegExp(
        `<bpmndi:BPMNEdge bpmnElement="${flowId}">([\\s\\S]*?)<\\/bpmndi:BPMNEdge>`,
        "i"
    );
    const edgeMatch = edgeRegex.exec(xml);
    if (!edgeMatch) return null;
    const labelRegex = /<bpmndi:BPMNLabel><dc:Bounds x="(-?\d+)" y="(-?\d+)" width="(-?\d+)" height="(-?\d+)" \/><\/bpmndi:BPMNLabel>/i;
    const labelMatch = labelRegex.exec(edgeMatch[1]);
    if (!labelMatch) return null;
    return {
        x: Number(labelMatch[1]),
        y: Number(labelMatch[2]),
        width: Number(labelMatch[3]),
        height: Number(labelMatch[4])
    };
}

test("generateBPMN returns valid core XML sections", () => {
    const process = {
        roles: ["Sales", "Finance"],
        steps: [
            {
                id: "step_1",
                type: "task",
                label: "Anfrage prüfen",
                role: "Sales",
                next: ["step_2"]
            },
            {
                id: "step_2",
                type: "gateway",
                label: "Budget > 1000?",
                role: "Finance",
                conditions: [
                    { label: "Ja", target: "step_3" },
                    { label: "Nein", target: "step_4" }
                ]
            },
            {
                id: "step_3",
                type: "end",
                label: "Freigeben",
                role: "Finance"
            },
            {
                id: "step_4",
                type: "end",
                label: "Ablehnen",
                role: "Sales"
            }
        ]
    };

    const xml = generateBPMN(process);

    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.ok(xml.includes("<bpmn:definitions"));
    assert.ok(xml.includes("<bpmn:laneSet id=\"LaneSet_1\">"));
    assert.ok(xml.includes("<bpmn:startEvent"));
    assert.ok(xml.includes("<bpmn:exclusiveGateway"));
    assert.ok(xml.includes("<bpmn:endEvent"));
    assert.ok(xml.includes("<bpmndi:BPMNDiagram>"));
    assert.ok(xml.includes("</bpmn:definitions>"));
});

test("generateBPMN escapes XML special characters", () => {
    const process = {
        roles: ["R&D"],
        steps: [
            {
                id: "step_1",
                type: "task",
                label: "Check <input> & confirm",
                role: "R&D"
            }
        ]
    };

    const xml = generateBPMN(process);
    assert.ok(xml.includes("Check &lt;input&gt; &amp;"));
    assert.ok(xml.includes("R&amp;D"));
});

test("keeps same-role sequential tasks on straight orthogonal edges", () => {
    const process = {
        roles: ["Mitarbeiter"],
        steps: [
            { id: "step_1", type: "task", label: "Eingabe prüfen", role: "Mitarbeiter", next: ["step_2"] },
            { id: "step_2", type: "task", label: "Daten speichern", role: "Mitarbeiter", next: ["step_3"] },
            { id: "step_3", type: "end", label: "Fertig", role: "Mitarbeiter" }
        ]
    };

    const xml = generateBPMN(process);
    const flowId = getSequenceFlowId(xml, "step_1", "step_2");
    const waypoints = getEdgeWaypoints(xml, flowId);

    assert.ok(flowId, "Flow step_1 -> step_2 must exist");
    assert.equal(waypoints.length, 2, "Same-role sequential edge should be straight");
    assert.ok(isOrthogonal(waypoints), "Edge routing must remain orthogonal");
});

test("keeps primary forward edge straight even with side branch", () => {
    const process = {
        roles: ["Mitarbeiter"],
        steps: [
            {
                id: "step_1",
                type: "task",
                label: "Pruefen",
                role: "Mitarbeiter",
                next: ["step_2", "step_3"]
            },
            { id: "step_2", type: "task", label: "Weiter", role: "Mitarbeiter", next: ["step_4"] },
            { id: "step_3", type: "task", label: "Alternative", role: "Mitarbeiter", next: ["step_4"] },
            { id: "step_4", type: "end", label: "Ende", role: "Mitarbeiter" }
        ]
    };

    const xml = generateBPMN(process);
    const flowA = getSequenceFlowId(xml, "step_1", "step_2");
    const flowB = getSequenceFlowId(xml, "step_1", "step_3");
    const pointsA = getEdgeWaypoints(xml, flowA);
    const pointsB = getEdgeWaypoints(xml, flowB);

    assert.ok(flowA && flowB, "Both split flows from step_1 must exist");
    const isStraightForward = (points) =>
        points.length === 2
        && points[1].x > points[0].x
        && points[0].y === points[1].y;
    assert.ok(
        isStraightForward(pointsA) || isStraightForward(pointsB),
        "One primary forward branch should stay straight without bend"
    );
});

test("keeps primary forward role-change edge on horizontal main axis", () => {
    const process = {
        roles: ["Mitarbeiter", "System"],
        steps: [
            { id: "step_1", type: "task", label: "Erfassen", role: "Mitarbeiter", next: ["step_2", "step_3"] },
            { id: "step_2", type: "task", label: "Validieren", role: "System", next: ["step_4"] },
            { id: "step_3", type: "task", label: "Rueckfrage", role: "Mitarbeiter", next: ["step_4"] },
            { id: "step_4", type: "end", label: "Ende", role: "System" }
        ]
    };

    const xml = generateBPMN(process);
    const flowId = getSequenceFlowId(xml, "step_1", "step_2");
    const points = getEdgeWaypoints(xml, flowId);

    assert.ok(flowId, "Primary role-change flow must exist");
    assert.ok(points.length >= 2, "Primary role-change flow should be routed with minimal direct segments");
    assert.equal(points[0].y, points[1].y, "Flow should leave source on horizontal main axis");
    assert.ok(points[1].x > points[0].x, "Flow should progress to the right before vertical transition");
});

test("keeps task-to-gateway forward edge on same row", () => {
    const process = {
        roles: ["System"],
        steps: [
            { id: "step_1", type: "task", label: "Validierung starten", role: "System", next: ["step_2"] },
            {
                id: "step_2",
                type: "gateway",
                label: "Pflichtfelder vollstaendig?",
                role: "System",
                conditions: [
                    { label: "Ja", target: "step_3" },
                    { label: "Nein", target: "step_4" }
                ]
            },
            { id: "step_3", type: "end", label: "Ende", role: "System" },
            { id: "step_4", type: "task", label: "Nachbearbeiten", role: "System", next: ["step_2"] }
        ]
    };

    const xml = generateBPMN(process);
    const flowId = getSequenceFlowId(xml, "step_1", "step_2");
    const points = getEdgeWaypoints(xml, flowId);

    assert.ok(flowId, "Task->Gateway flow must exist");
    assert.ok(points.length >= 2, "Task->Gateway forward flow should have explicit endpoints");
    assert.ok(points[1].x > points[0].x, "Task->Gateway forward flow should move right");
});

test("separates gateway split branches into distinct paths", () => {
    const process = {
        roles: ["Teamleiter", "System"],
        steps: [
            { id: "step_1", type: "task", label: "Antrag prüfen", role: "Teamleiter", next: ["step_2"] },
            {
                id: "step_2",
                type: "gateway",
                label: "Genehmigt?",
                role: "Teamleiter",
                conditions: [
                    { label: "Ja", target: "step_3" },
                    { label: "Nein", target: "step_4" }
                ]
            },
            { id: "step_3", type: "task", label: "Eintrag buchen", role: "System", next: ["step_5"] },
            { id: "step_4", type: "task", label: "Ablehnung senden", role: "System", next: ["step_5"] },
            { id: "step_5", type: "end", label: "Ende", role: "System" }
        ]
    };

    const xml = generateBPMN(process);
    const yesFlow = getSequenceFlowId(xml, "step_2", "step_3");
    const noFlow = getSequenceFlowId(xml, "step_2", "step_4");
    const yesPoints = getEdgeWaypoints(xml, yesFlow);
    const noPoints = getEdgeWaypoints(xml, noFlow);
    const yesLabel = getEdgeLabelBounds(xml, yesFlow);
    const noLabel = getEdgeLabelBounds(xml, noFlow);

    assert.ok(yesFlow && noFlow, "Both gateway branches must exist");
    assert.ok(yesPoints.length >= 3 && noPoints.length >= 3, "Gateway branches should keep clear directed segments");
    const yesLeavesHorizontal = yesPoints[1].x > yesPoints[0].x && yesPoints[1].y === yesPoints[0].y;
    const noLeavesHorizontal = noPoints[1].x > noPoints[0].x && noPoints[1].y === noPoints[0].y;
    assert.ok(yesLeavesHorizontal && noLeavesHorizontal, "Both branches should first leave gateway horizontally");
    const yesOnAxis = yesPoints[2]?.y === yesPoints[0].y;
    const noOnAxis = noPoints[2]?.y === noPoints[0].y;
    assert.ok(yesOnAxis || noOnAxis, "At least one branch should continue on main axis");
    const yesHasVertical = yesPoints.some((p, idx) => idx > 0 && yesPoints[idx - 1].x === p.x && p.y !== yesPoints[idx - 1].y);
    const noHasVertical = noPoints.some((p, idx) => idx > 0 && noPoints[idx - 1].x === p.x && p.y !== noPoints[idx - 1].y);
    assert.ok(yesHasVertical || noHasVertical, "At least one branch should diverge via side arm");
    assert.ok(yesLabel && noLabel, "Gateway branches must render edge labels");
    assert.ok(
        Math.abs(yesLabel.x - yesPoints[1].x) <= 60 && Math.abs(yesLabel.y - yesPoints[1].y) <= 60,
        "Yes branch label must be placed near exit point"
    );
    assert.ok(
        Math.abs(noLabel.x - noPoints[1].x) <= 60 && Math.abs(noLabel.y - noPoints[1].y) <= 60,
        "No branch label must be placed near exit point"
    );
    assert.notEqual(
        JSON.stringify(yesPoints),
        JSON.stringify(noPoints),
        "Gateway branches must be visually differentiated"
    );
});

test("normalizes gateway branch labels and keeps deterministic branch bands", () => {
    const process = {
        roles: ["Mitarbeiter", "System"],
        steps: [
            { id: "step_1", type: "task", label: "Antrag prüfen", role: "Mitarbeiter", next: ["step_2"] },
            {
                id: "step_2",
                type: "gateway",
                label: "Validierung ok?",
                role: "System",
                conditions: [
                    { label: "yes", target: "step_3" },
                    { label: "nein", target: "step_4" },
                    { label: "fehlend", target: "step_5" }
                ]
            },
            { id: "step_3", type: "task", label: "Weiter", role: "System", next: ["step_6"] },
            { id: "step_4", type: "task", label: "Zurück", role: "Mitarbeiter", next: ["step_6"] },
            { id: "step_5", type: "task", label: "Manuell", role: "System", next: ["step_6"] },
            { id: "step_6", type: "end", label: "Ende", role: "System" }
        ]
    };

    const xml = generateBPMN(process);
    const yesFlow = getSequenceFlowId(xml, "step_2", "step_3");
    const noFlow = getSequenceFlowId(xml, "step_2", "step_4");
    const errorFlow = getSequenceFlowId(xml, "step_2", "step_5");
    const yesName = getSequenceFlowName(xml, "step_2", "step_3");
    const noName = getSequenceFlowName(xml, "step_2", "step_4");
    const errorName = getSequenceFlowName(xml, "step_2", "step_5");
    const yesPoints = getEdgeWaypoints(xml, yesFlow);
    const noPoints = getEdgeWaypoints(xml, noFlow);
    const errorPoints = getEdgeWaypoints(xml, errorFlow);
    const yesLabel = getEdgeLabelBounds(xml, yesFlow);
    const noLabel = getEdgeLabelBounds(xml, noFlow);
    const errorLabel = getEdgeLabelBounds(xml, errorFlow);

    assert.equal(yesName, "Ja");
    assert.equal(noName, "Nein");
    assert.equal(errorName, "Fehlerpfad");
    assert.ok(noPoints[1].x > noPoints[0].x, "No path should start by moving right on main axis");
    assert.equal(noPoints[0].y, noPoints[1].y, "No path should leave split horizontally");
    assert.equal(yesPoints[0].y, yesPoints[1].y, "Ja path should leave split horizontally");
    assert.notEqual(yesPoints[2].y, noPoints[2].y, "Ja/Nein should separate into different branch bands");
    assert.notEqual(
        errorPoints[2].y,
        noPoints[2].y,
        "Error path should use a dedicated band distinct from No branch"
    );
    assert.ok(yesLabel && noLabel && errorLabel, "All branch flows should have labels");
    assert.ok(
        Math.abs(yesLabel.x - yesPoints[1].x) <= 90 && Math.abs(yesLabel.y - yesPoints[1].y) <= 60,
        "Yes label should be close to branch origin"
    );
    assert.ok(
        Math.abs(noLabel.x - noPoints[1].x) <= 90 && Math.abs(noLabel.y - noPoints[1].y) <= 60,
        "No label should be close to branch origin"
    );
    assert.ok(
        Math.abs(errorLabel.x - errorPoints[1].x) <= 120 && Math.abs(errorLabel.y - errorPoints[1].y) <= 120,
        "Error label should be close to branch origin"
    );
});

test("avoids crossings between sequence flows in complex multi-lane process", () => {
    const process = {
        roles: ["Mitarbeiter", "Teamleiter", "System"],
        steps: [
            { id: "step_1", type: "task", label: "Antrag erfassen", role: "Mitarbeiter", next: ["step_2"] },
            { id: "step_2", type: "gateway", label: "Vollständig?", role: "Mitarbeiter", conditions: [
                { label: "Ja", target: "step_3" },
                { label: "Nein", target: "step_4" }
            ] },
            { id: "step_3", type: "task", label: "Freigabe prüfen", role: "Teamleiter", next: ["step_5"] },
            { id: "step_4", type: "task", label: "Nachforderung senden", role: "System", next: ["step_5"] },
            { id: "step_5", type: "gateway", label: "Genehmigt?", role: "Teamleiter", conditions: [
                { label: "Ja", target: "step_6" },
                { label: "Nein", target: "step_7" }
            ] },
            { id: "step_6", type: "task", label: "Eintrag buchen", role: "System", next: ["step_8"] },
            { id: "step_7", type: "task", label: "Ablehnung senden", role: "System", next: ["step_8"] },
            { id: "step_8", type: "end", label: "Abschluss", role: "Mitarbeiter" }
        ]
    };

    const xml = generateBPMN(process);
    const flowIds = getAllFlowIds(xml);
    const allSegments = flowIds.flatMap((flowId) => toSegments(getEdgeWaypoints(xml, flowId), flowId));
    const laneBounds = getLaneYBounds(xml);

    const violations = [];
    for (let i = 0; i < allSegments.length; i += 1) {
        for (let j = i + 1; j < allSegments.length; j += 1) {
            const s1 = allSegments[i];
            const s2 = allSegments[j];

            // Ignore same-edge comparisons
            if (s1.flowId === s2.flowId) continue;

            const crossPoint = segmentIntersection(s1, s2);
            if (!crossPoint) continue;

            // Endpoint contacts are acceptable at split/join transitions.
            const endpointOnS1 = pointsEqual(crossPoint, s1.a) || pointsEqual(crossPoint, s1.b);
            const endpointOnS2 = pointsEqual(crossPoint, s2.a) || pointsEqual(crossPoint, s2.b);
            if (endpointOnS1 || endpointOnS2) continue;

            // Ignore crossings outside lane area (outer routing corridors are intentional).
            if (laneBounds && (crossPoint.y < laneBounds.min || crossPoint.y > laneBounds.max)) continue;

            violations.push({ s1, s2, crossPoint });
        }
    }

    assert.equal(
        violations.length,
        0,
        `Found non-endpoint sequence flow crossings: ${JSON.stringify(violations.slice(0, 3))}`
    );
});

test("routes correction loop clearly around source element", () => {
    const process = {
        roles: ["Mitarbeiter", "System"],
        steps: [
            { id: "step_1", type: "task", label: "Bedarf spezifizieren", role: "Mitarbeiter", next: ["step_2"] },
            { id: "step_2", type: "task", label: "Validierung", role: "System", next: ["step_3"] },
            {
                id: "step_3",
                type: "gateway",
                label: "Angaben vollständig?",
                role: "System",
                conditions: [
                    { label: "Ja", target: "step_4" },
                    { label: "Nein", target: "step_5" }
                ]
            },
            { id: "step_4", type: "end", label: "Abschluss", role: "System" },
            { id: "step_5", type: "task", label: "Angaben korrigieren", role: "Mitarbeiter", next: ["step_2"] }
        ]
    };

    const xml = generateBPMN(process);
    const loopFlowId = getSequenceFlowId(xml, "step_5", "step_2");
    const waypoints = getEdgeWaypoints(xml, loopFlowId);
    const sourceBounds = getShapeBounds(xml, "step_5");

    assert.ok(loopFlowId, "Loop flow step_5 -> step_2 must exist");
    assert.ok(waypoints.length >= 6, "Loop flow must use explicit bend points");
    assert.ok(isOrthogonal(waypoints), "Loop flow must remain orthogonal");
    assert.equal(waypoints[0].y, waypoints[1].y, "Flow must leave source horizontally");
    assert.ok(waypoints[1].x > waypoints[0].x, "Flow must first exit clearly to the right");

    const loopSegments = toSegments(waypoints, loopFlowId);
    const illegalSourceTouches = loopSegments
        .slice(1)
        .filter((seg) => segmentTouchesRectInterior(seg, sourceBounds));

    assert.equal(
        illegalSourceTouches.length,
        0,
        `Loop re-enters source element interior: ${JSON.stringify(illegalSourceTouches)}`
    );
});

test("keeps parallel back loops on distinct line segments", () => {
    const process = {
        roles: ["Mitarbeiter", "Teamleiter", "System"],
        steps: [
            { id: "step_1", type: "task", label: "Antrag erfassen", role: "Mitarbeiter", next: ["step_2"] },
            { id: "step_2", type: "task", label: "Validierung", role: "Teamleiter", next: ["step_3"] },
            {
                id: "step_3",
                type: "gateway",
                label: "Vollständig?",
                role: "Teamleiter",
                conditions: [
                    { label: "Ja", target: "step_4" },
                    { label: "Nein", target: "step_5" }
                ]
            },
            { id: "step_4", type: "task", label: "Freigeben", role: "System", next: ["step_6"] },
            { id: "step_5", type: "task", label: "Nachbearbeitung", role: "System", next: ["step_6"] },
            {
                id: "step_6",
                type: "gateway",
                label: "Korrekt?",
                role: "System",
                conditions: [
                    { label: "Ja", target: "step_7" },
                    { label: "Nein", target: "step_8" }
                ]
            },
            { id: "step_7", type: "end", label: "Ende", role: "System" },
            { id: "step_8", type: "task", label: "Angaben korrigieren", role: "Mitarbeiter", next: ["step_2", "step_3"] }
        ]
    };

    const xml = generateBPMN(process);
    const loopA = getSequenceFlowId(xml, "step_8", "step_2");
    const loopB = getSequenceFlowId(xml, "step_8", "step_3");
    const pointsA = getEdgeWaypoints(xml, loopA);
    const pointsB = getEdgeWaypoints(xml, loopB);

    assert.ok(loopA && loopB, "Both parallel back-loop flows must exist");
    assert.ok(isOrthogonal(pointsA) && isOrthogonal(pointsB), "Both loops must stay orthogonal");

    const overlaps = [];
    const segmentsA = toSegments(pointsA, loopA);
    const segmentsB = toSegments(pointsB, loopB);

    for (const segA of segmentsA) {
        for (const segB of segmentsB) {
            const overlapType = segmentOverlapType(segA, segB);
            if (!overlapType) continue;

            const sharedEndpoint =
                pointsEqual(segA.a, segB.a)
                || pointsEqual(segA.a, segB.b)
                || pointsEqual(segA.b, segB.a)
                || pointsEqual(segA.b, segB.b);
            if (sharedEndpoint) continue;

            overlaps.push({ overlapType, segA, segB });
        }
    }

    assert.equal(
        overlaps.length,
        0,
        `Parallel back loops share line segments: ${JSON.stringify(overlaps.slice(0, 3))}`
    );
});

test("anchors every edge to explicit source and target points", () => {
    const process = {
        roles: ["Mitarbeiter", "Teamleiter", "System"],
        steps: [
            { id: "step_1", type: "task", label: "Antrag erfassen", role: "Mitarbeiter", next: ["step_2"] },
            { id: "step_2", type: "task", label: "Validierung starten", role: "System", next: ["step_3"] },
            {
                id: "step_3",
                type: "gateway",
                label: "Pflichtfelder vollständig?",
                role: "System",
                conditions: [
                    { label: "Ja", target: "step_4" },
                    { label: "Nein", target: "step_5" }
                ]
            },
            { id: "step_4", type: "task", label: "Prüfen", role: "Teamleiter", next: ["step_6"] },
            { id: "step_5", type: "task", label: "Nachbearbeitung", role: "Mitarbeiter", next: ["step_2"] },
            { id: "step_6", type: "end", label: "Ende", role: "System" }
        ]
    };

    const xml = generateBPMN(process);
    const refs = getFlowRefs(xml);

    refs.forEach(({ flowId, sourceRef, targetRef }) => {
        const points = getEdgeWaypoints(xml, flowId);
        const sourceBounds = getShapeBounds(xml, sourceRef);
        const targetBounds = getShapeBounds(xml, targetRef);
        assert.ok(points.length >= 2, `Flow ${flowId} must have at least start/end waypoint`);
        assert.ok(sourceBounds && targetBounds, `Flow ${flowId} must reference existing shape bounds`);

        const start = points[0];
        const end = points[points.length - 1];
        const expectedStartX = Math.round((sourceBounds.x + sourceBounds.width) / 12) * 12;
        const expectedEndX = Math.round(targetBounds.x / 12) * 12;
        const sourceMinY = sourceBounds.y;
        const sourceMaxY = sourceBounds.y + sourceBounds.height;
        const targetMinY = targetBounds.y;
        const targetMaxY = targetBounds.y + targetBounds.height;

        assert.equal(start.x, expectedStartX, `Flow ${flowId} must start at source right edge`);
        assert.ok(start.y >= sourceMinY && start.y <= sourceMaxY, `Flow ${flowId} start Y must be on source edge span`);
        assert.equal(end.x, expectedEndX, `Flow ${flowId} must end at target left edge`);
        assert.ok(end.y >= targetMinY && end.y <= targetMaxY, `Flow ${flowId} end Y must be on target edge span`);
    });
});

test("distributes multiple incoming edges evenly on target side", () => {
    const process = {
        roles: ["System"],
        steps: [
            { id: "step_1", type: "task", label: "A", role: "System", next: ["step_4"] },
            { id: "step_2", type: "task", label: "B", role: "System", next: ["step_4"] },
            { id: "step_3", type: "task", label: "C", role: "System", next: ["step_4"] },
            { id: "step_4", type: "task", label: "Ziel", role: "System", next: ["step_5"] },
            { id: "step_5", type: "end", label: "Ende", role: "System" }
        ]
    };

    const xml = generateBPMN(process);
    const targetBounds = getShapeBounds(xml, "step_4");
    const f1 = getSequenceFlowId(xml, "step_1", "step_4");
    const f2 = getSequenceFlowId(xml, "step_2", "step_4");
    const f3 = getSequenceFlowId(xml, "step_3", "step_4");
    const p1 = getEdgeWaypoints(xml, f1).at(-1);
    const p2 = getEdgeWaypoints(xml, f2).at(-1);
    const p3 = getEdgeWaypoints(xml, f3).at(-1);

    assert.ok(targetBounds && p1 && p2 && p3, "Target and incoming endpoints must exist");
    assert.equal(p1.x, targetBounds.x, "Incoming 1 must end on left target side");
    assert.equal(p2.x, targetBounds.x, "Incoming 2 must end on left target side");
    assert.equal(p3.x, targetBounds.x, "Incoming 3 must end on left target side");

    const ys = [p1.y, p2.y, p3.y].sort((a, b) => a - b);
    const d1 = ys[1] - ys[0];
    const d2 = ys[2] - ys[1];
    assert.ok(Math.abs(d1 - d2) <= 12, "Incoming edges should be evenly spaced on target side");
    assert.ok(ys[0] > targetBounds.y, "Top incoming anchor should be below top edge");
    assert.ok(ys[2] < targetBounds.y + targetBounds.height, "Bottom incoming anchor should be above bottom edge");
});

test("keeps main path nodes centered in their lanes", () => {
    const process = {
        roles: ["Mitarbeiter", "System", "Teamleiter"],
        steps: [
            { id: "step_1", type: "task", label: "Erfassen", role: "Mitarbeiter", next: ["step_2"] },
            { id: "step_2", type: "task", label: "Pruefen", role: "System", next: ["step_3"] },
            { id: "step_3", type: "task", label: "Freigeben", role: "Teamleiter", next: ["step_4"] },
            { id: "step_4", type: "end", label: "Ende", role: "Teamleiter" }
        ]
    };

    const xml = generateBPMN(process);
    const lane0 = getLaneBounds(xml, "Lane_role_0");
    const lane1 = getLaneBounds(xml, "Lane_role_1");
    const lane2 = getLaneBounds(xml, "Lane_role_2");
    const step1 = getShapeBounds(xml, "step_1");
    const step2 = getShapeBounds(xml, "step_2");
    const step3 = getShapeBounds(xml, "step_3");

    assert.ok(lane0 && lane1 && lane2 && step1 && step2 && step3, "Lane and step bounds must exist");

    const centerY = (bounds) => bounds.y + bounds.height / 2;
    const centeredBlockY = (bounds) => centerY(bounds) + 14;
    const laneCenter = (lane) => lane.y + lane.height / 2;

    assert.ok(Math.abs(centeredBlockY(step1) - laneCenter(lane0)) <= 12, "Main block in lane 0 should stay near lane center");
    assert.ok(Math.abs(centeredBlockY(step2) - laneCenter(lane1)) <= 12, "Main block in lane 1 should stay near lane center");
    assert.ok(Math.abs(centeredBlockY(step3) - laneCenter(lane2)) <= 12, "Main block in lane 2 should stay near lane center");
});

test("keeps simple lane compact with balanced horizontal padding", () => {
    const process = {
        roles: ["Mitarbeiter"],
        steps: [
            { id: "step_1", type: "task", label: "Pfeil ausfuehren", role: "Mitarbeiter", next: ["step_2"] },
            { id: "step_2", type: "end", label: "Ende", role: "Mitarbeiter" }
        ]
    };

    const xml = generateBPMN(process);
    const lane = getLaneBounds(xml, "Lane_role_0");
    const start = getShapeBounds(xml, "StartEvent_1");
    const task = getShapeBounds(xml, "step_1");
    const end = getShapeBounds(xml, "step_2");
    assert.ok(lane && start && task && end, "Lane and shape bounds must exist");

    const contentLeft = Math.min(start.x, task.x, end.x);
    const contentRight = Math.max(start.x + start.width, task.x + task.width, end.x + end.width);
    const leftGap = contentLeft - lane.x;
    const rightGap = lane.x + lane.width - contentRight;

    assert.ok(Math.abs(leftGap - rightGap) <= 8, "Left/right lane padding should be balanced");
    assert.ok(lane.width <= (contentRight - contentLeft) + 200, "Lane width should stay compact for simple flow");
});
