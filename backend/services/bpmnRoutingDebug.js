function collectFlows(processJson) {
    const steps = Array.isArray(processJson?.steps) ? processJson.steps : [];
    const flows = [];
    steps.forEach((step) => {
        const from = step?.id;
        if (!from) return;
        (Array.isArray(step?.next) ? step.next : []).forEach((to) => {
            if (typeof to === "string") flows.push({ from, to, condition: "" });
        });
        (Array.isArray(step?.conditions) ? step.conditions : []).forEach((cond) => {
            if (typeof cond?.target === "string") {
                flows.push({ from, to: cond.target, condition: String(cond?.label || "") });
            }
        });
    });
    return flows;
}

function computeRank(steps, flows) {
    const rank = {};
    const bySource = new Map();
    flows.forEach((flow) => {
        const list = bySource.get(flow.from) || [];
        list.push(flow.to);
        bySource.set(flow.from, list);
    });
    steps.forEach((step) => { rank[step.id] = Number.MAX_SAFE_INTEGER; });
    const start = steps[0]?.id;
    if (!start) return rank;
    rank[start] = 0;
    const queue = [start];
    while (queue.length > 0) {
        const cur = queue.shift();
        const nextTargets = bySource.get(cur) || [];
        nextTargets.forEach((nextId) => {
            const nextRank = (rank[cur] ?? 0) + 1;
            if (nextRank < (rank[nextId] ?? Number.MAX_SAFE_INTEGER)) {
                rank[nextId] = nextRank;
                queue.push(nextId);
            }
        });
    }
    return rank;
}

function resolveGatewayBranchDirection(flow, flows, stepsById, roleOrder) {
    const sourceStep = stepsById.get(flow.from);
    if (!sourceStep?.role) return 0;
    const sourceOrder = roleOrder.get(sourceStep.role);
    if (sourceOrder == null) return 0;

    const maxDepth = 24;
    const queue = [{ stepId: flow.to, depth: 0 }];
    const visited = new Set([flow.from]);

    while (queue.length > 0) {
        const current = queue.shift();
        if (!current || visited.has(current.stepId) || current.depth > maxDepth) continue;
        visited.add(current.stepId);

        const step = stepsById.get(current.stepId);
        if (!step) continue;

        if (step.role && step.role !== sourceStep.role) {
            const targetOrder = roleOrder.get(step.role);
            if (targetOrder == null) return 0;
            if (targetOrder < sourceOrder) return -1;
            if (targetOrder > sourceOrder) return 1;
            return 0;
        }

        flows.forEach((candidate) => {
            if (candidate.from !== current.stepId) return;
            if (visited.has(candidate.to)) return;
            queue.push({ stepId: candidate.to, depth: current.depth + 1 });
        });
    }

    const directTarget = stepsById.get(flow.to);
    if (!directTarget?.role) return 0;
    const targetOrder = roleOrder.get(directTarget.role);
    if (targetOrder == null) return 0;
    if (targetOrder < sourceOrder) return -1;
    if (targetOrder > sourceOrder) return 1;
    return 0;
}

function resolveGatewayBranchDirectionWithFallback(flow, flows, stepsById, roleOrder) {
    const preferred = resolveGatewayBranchDirection(flow, flows, stepsById, roleOrder);
    if (preferred !== 0) return preferred;
    const text = `${flow.from}->${flow.to}`;
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) hash += text.charCodeAt(i);
    return hash % 2 === 0 ? -1 : 1;
}

function classifyBranchLabel(label) {
    const value = String(label || "").trim().toLowerCase();
    if (!value) return "other";
    if (/(^|\b)(ja|yes|ok|true|genehmigt|freigabe)(\b|$)/i.test(value)) return "yes";
    if (/(^|\b)(nein|no|false|abgelehnt)(\b|$)/i.test(value)) return "no";
    if (/(^|\b)(fehler|error|ungueltig|ungültig|fehlend|unvollstaendig|unvollständig)(\b|$)/i.test(value)) return "error";
    return "other";
}

export function buildRoutingDebug(processJson) {
    const steps = Array.isArray(processJson?.steps) ? processJson.steps : [];
    const flows = collectFlows(processJson);
    const rank = computeRank(steps, flows);
    const stepsById = new Map(steps.map((step) => [step.id, step]));
    const roleOrder = new Map();
    (Array.isArray(processJson?.roles) ? processJson.roles : []).forEach((role, idx) => {
        roleOrder.set(String(role), idx);
    });

    const bySource = new Map();
    flows.forEach((flow, idx) => {
        const list = bySource.get(flow.from) || [];
        list.push({ ...flow, idx });
        bySource.set(flow.from, list);
    });

    const flowDebug = [];
    bySource.forEach((list) => {
        const sorted = [...list].sort((a, b) => (rank[a.to] ?? 999999) - (rank[b.to] ?? 999999));
        sorted.forEach((flow, localIndex) => {
            const fromRank = rank[flow.from] ?? 999999;
            const toRank = rank[flow.to] ?? 999999;
            const isLoop = toRank <= fromRank;
            const type = isLoop ? "loop" : (localIndex === 0 ? "main" : "branch");
            const fromStep = stepsById.get(flow.from);
            const toStep = stepsById.get(flow.to);

            let gatewaySideAnchor = null;
            let gatewaySideAnchorOk = null;
            if (fromStep?.type === "gateway" && type === "branch") {
                const dir = resolveGatewayBranchDirectionWithFallback(flow, flows, stepsById, roleOrder);
                const branchKind = classifyBranchLabel(flow.condition);
                if (branchKind === "no" || branchKind === "error") {
                    gatewaySideAnchor = "bottom";
                    gatewaySideAnchorOk = true;
                } else {
                    gatewaySideAnchor = dir < 0 ? "top" : "bottom";
                    gatewaySideAnchorOk = true;
                }
            }

            let loopTargetAnchor = null;
            let loopTargetAnchorOk = null;
            if (type === "loop") {
                if (!toStep) {
                    loopTargetAnchor = "unknown";
                    loopTargetAnchorOk = false;
                } else {
                    // Keep debug aligned with generator endpoint rule: loop targets anchor to bottom midpoint.
                    loopTargetAnchor = "bottom";
                    loopTargetAnchorOk = true;
                }
            }
            flowDebug.push({
                id: `flow_${flow.idx}`,
                from: flow.from,
                to: flow.to,
                condition: flow.condition,
                type,
                gatewaySideAnchor,
                gatewaySideAnchorOk,
                loopTargetAnchor,
                loopTargetAnchorOk
            });
        });
    });

    return { flows: flowDebug };
}
