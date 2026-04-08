function escapeXml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

function normalizeType(step) {
    if (step.type === "end" || step.type === "endEvent") return "endEvent";
    if (step.type === "gateway") return "gateway";
    if (step.type === "start" || step.type === "startEvent") return "task";
    return "task";
}

export function generateBPMN(process) {
    const roles = Array.isArray(process?.roles) && process.roles.length > 0 ? process.roles : ["System"];
    const steps = JSON.parse(JSON.stringify(process?.steps || []));
    const stepById = new Map(steps.map((step) => [step.id, step]));

    const flows = [];
    steps.forEach((step) => {
        if (Array.isArray(step.next)) {
            step.next.forEach((target) => {
                if (stepById.has(target)) flows.push({ from: step.id, to: target });
            });
        }
        if (Array.isArray(step.conditions)) {
            step.conditions.forEach((cond) => {
                if (stepById.has(cond.target)) {
                    flows.push({
                        from: step.id,
                        to: cond.target,
                        condition: cond.label || "Bedingung"
                    });
                }
            });
        }
    });

    steps.forEach((step) => {
        step.type = normalizeType(step);
    });

    const hasOutgoing = new Set(flows.map((flow) => flow.from));
    steps.forEach((step) => {
        if (!hasOutgoing.has(step.id) && step.type !== "gateway") {
            step.type = "endEvent";
        }
    });

    const incoming = new Set(flows.map((flow) => flow.to));
    const startCandidates = steps.filter((step) => !incoming.has(step.id));
    const startId = "StartEvent_1";

    steps.unshift({
        id: startId,
        type: "startEvent",
        label: "Start"
    });

    startCandidates.forEach((step) => {
        flows.unshift({ from: startId, to: step.id });
    });

    const roleMap = {};
    roles.forEach((role, i) => {
        const id = typeof role === "string" ? `role_${i}` : role.id || `role_${i}`;
        const name = typeof role === "string" ? role : role.name || `Role ${i + 1}`;
        roleMap[id] = { id, name, steps: [] };
    });

    const defaultRoleId = Object.keys(roleMap)[0];

    steps.forEach((step) => {
        let roleId;
        if (step.type === "startEvent") {
            const firstTarget = flows.find((flow) => flow.from === startId)?.to;
            const targetStep = steps.find((candidate) => candidate.id === firstTarget);
            roleId = Object.values(roleMap).find((role) => role.name === targetStep?.role)?.id;
        } else {
            roleId = Object.values(roleMap).find((role) => role.name === step.role)?.id;
        }

        if (!roleId) roleId = defaultRoleId;
        roleMap[roleId].steps.push(step.id);
        step._roleId = roleId;
    });

    const positions = {};
    const laneMeta = {};
    let currentY = 100;

    Object.values(roleMap).forEach((role) => {
        const height = Math.max(150, role.steps.length * 70 + 80);
        laneMeta[role.id] = { y: currentY, height };
        currentY += height + 40;
    });

    const stepIndex = {};
    steps.forEach((step, index) => {
        stepIndex[step.id] = index;
    });

    const laneOffset = {};
    Object.keys(roleMap).forEach((id) => {
        laneOffset[id] = 0;
    });

    steps.forEach((step) => {
        const lane = laneMeta[step._roleId];
        const offset = laneOffset[step._roleId] * 70;
        positions[step.id] = { x: 180 + stepIndex[step.id] * 220, y: lane.y + 30 + offset };
        laneOffset[step._roleId] += 1;
    });

    const firstFlow = flows.find((flow) => flow.from === startId);
    if (firstFlow && positions[firstFlow.to]) {
        positions[startId] = {
            x: positions[firstFlow.to].x - 140,
            y: positions[firstFlow.to].y + 12
        };
    }

    const diagramWidth = Math.max(1500, steps.length * 220 + 300);
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
id="Defs_1">
<bpmn:process id="Process_1" isExecutable="false">`;

    xml += `<bpmn:laneSet id="LaneSet_1">`;
    Object.values(roleMap).forEach((role) => {
        xml += `<bpmn:lane id="Lane_${role.id}" name="${escapeXml(role.name)}">`;
        role.steps.forEach((stepId) => {
            xml += `<bpmn:flowNodeRef>${stepId}</bpmn:flowNodeRef>`;
        });
        xml += `</bpmn:lane>`;
    });
    xml += `</bpmn:laneSet>`;

    steps.forEach((step) => {
        const name = escapeXml(step.label || "undefined");
        if (step.type === "startEvent") {
            xml += `<bpmn:startEvent id="${step.id}" name="${name}" />`;
        } else if (step.type === "endEvent") {
            xml += `<bpmn:endEvent id="${step.id}" name="${name}" />`;
        } else if (step.type === "gateway") {
            xml += `<bpmn:exclusiveGateway id="${step.id}" name="${name}" />`;
        } else {
            xml += `<bpmn:task id="${step.id}" name="${name}" />`;
        }
    });

    flows.forEach((flow, i) => {
        const name = flow.condition ? ` name="${escapeXml(flow.condition)}"` : "";
        xml += `<bpmn:sequenceFlow id="flow_${i}" sourceRef="${flow.from}" targetRef="${flow.to}"${name} />`;
    });

    xml += `</bpmn:process><bpmndi:BPMNDiagram><bpmndi:BPMNPlane bpmnElement="Process_1">`;

    Object.values(roleMap).forEach((role) => {
        const meta = laneMeta[role.id];
        xml += `<bpmndi:BPMNShape bpmnElement="Lane_${role.id}" isHorizontal="true"><dc:Bounds x="50" y="${meta.y}" width="${diagramWidth}" height="${meta.height}" /></bpmndi:BPMNShape>`;
    });

    steps.forEach((step) => {
        const pos = positions[step.id];
        const isGateway = step.type === "gateway";
        const isStart = step.type === "startEvent";
        const width = isGateway ? 50 : isStart ? 36 : 100;
        const height = isGateway ? 50 : isStart ? 36 : 60;
        xml += `<bpmndi:BPMNShape bpmnElement="${step.id}"><dc:Bounds x="${pos.x}" y="${pos.y}" width="${width}" height="${height}" /></bpmndi:BPMNShape>`;
    });

    flows.forEach((flow, i) => {
        const from = positions[flow.from];
        const to = positions[flow.to];
        if (!from || !to) return;

        const fromStep = steps.find((step) => step.id === flow.from);
        const toStep = steps.find((step) => step.id === flow.to);
        const isGateway = fromStep?.type === "gateway";
        const isStart = fromStep?.type === "startEvent";
        const fromWidth = isGateway ? 50 : isStart ? 36 : 100;
        const fromHeight = isGateway ? 50 : isStart ? 36 : 60;
        const toHeight = toStep?.type === "gateway" ? 50 : toStep?.type === "startEvent" ? 36 : 60;

        const startX = from.x + fromWidth;
        const startY = from.y + fromHeight / 2;
        const endX = to.x;
        const endY = to.y + toHeight / 2;
        const midX1 = startX + 40;
        const midX2 = endX - 40;

        xml += `<bpmndi:BPMNEdge bpmnElement="flow_${i}"><di:waypoint x="${startX}" y="${startY}" /><di:waypoint x="${midX1}" y="${startY}" /><di:waypoint x="${midX1}" y="${endY}" /><di:waypoint x="${midX2}" y="${endY}" /><di:waypoint x="${endX}" y="${endY}" /></bpmndi:BPMNEdge>`;
    });

    xml += `</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;
    return xml;
}