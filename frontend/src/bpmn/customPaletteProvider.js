class CustomPaletteProvider {
    constructor(palette, create, elementFactory, bpmnFactory) {
        this.create = create;
        this.elementFactory = elementFactory;
        this.bpmnFactory = bpmnFactory;

        palette.registerProvider(this);
    }

    getPaletteEntries() {
        const paletteClassByGroup = {
            system: "palette-system",
            activities: "palette-activity",
            gateways: "palette-gateway",
            roles: "palette-role",
            resources: "palette-resource"
        };

        const createAction = (type, className, title, options = {}) => {
            const paletteClassName = paletteClassByGroup[options.group]
                ? `${className} ${paletteClassByGroup[options.group]}`
                : className;

            const createListener = (event) => {
                const businessObject = options.businessObjectFactory
                    ? options.businessObjectFactory()
                    : this.bpmnFactory.create(type);

                const shape = options.shapeFactory
                    ? options.shapeFactory(businessObject)
                    : this.elementFactory.createShape({
                        type,
                        businessObject,
                        ...options.shape
                    });

                this.create.start(event, shape);
            };

            return {
                group: options.group || "model",
                className: paletteClassName,
                title,
                action: {
                    dragstart: createListener,
                    click: createListener
                }
            };
        };

        const createEventWithDefinition = (eventType, definitionType, attrs = {}) => {
            const eventDefinition = this.bpmnFactory.create(definitionType, attrs);
            return this.bpmnFactory.create(eventType, {
                eventDefinitions: [eventDefinition]
            });
        };

        return {
            "create.start-message": createAction(
                "bpmn:StartEvent",
                "bpmn-icon-start-event-message",
                "Prozessstart per Nachricht",
                {
                    group: "system",
                    businessObjectFactory: () =>
                        createEventWithDefinition("bpmn:StartEvent", "bpmn:MessageEventDefinition")
                }
            ),
            "create.end-message": createAction(
                "bpmn:EndEvent",
                "bpmn-icon-end-event-message",
                "Prozessende mit Nachricht",
                {
                    group: "system",
                    businessObjectFactory: () =>
                        createEventWithDefinition("bpmn:EndEvent", "bpmn:MessageEventDefinition")
                }
            ),
            "create.end-terminate": createAction(
                "bpmn:EndEvent",
                "bpmn-icon-end-event-terminate",
                "Sofortiges Prozessende",
                {
                    group: "system",
                    businessObjectFactory: () =>
                        createEventWithDefinition("bpmn:EndEvent", "bpmn:TerminateEventDefinition")
                }
            ),
            "create.intermediate-none": createAction(
                "bpmn:IntermediateCatchEvent",
                "bpmn-icon-intermediate-event-none",
                "Zwischenereignis ohne Auslöser",
                {
                    group: "system"
                }
            ),
            "create.intermediate-timer": createAction(
                "bpmn:IntermediateCatchEvent",
                "bpmn-icon-intermediate-event-catch-timer",
                "Zwischenereignis mit Zeitsteuerung",
                {
                    group: "system",
                    businessObjectFactory: () =>
                        createEventWithDefinition("bpmn:IntermediateCatchEvent", "bpmn:TimerEventDefinition")
                }
            ),
            "create.intermediate-message": createAction(
                "bpmn:IntermediateCatchEvent",
                "bpmn-icon-intermediate-event-catch-message",
                "Zwischenereignis mit Nachricht",
                {
                    group: "system",
                    businessObjectFactory: () =>
                        createEventWithDefinition("bpmn:IntermediateCatchEvent", "bpmn:MessageEventDefinition")
                }
            ),
            "create.intermediate-signal": createAction(
                "bpmn:IntermediateCatchEvent",
                "bpmn-icon-intermediate-event-catch-signal",
                "Zwischenereignis mit Signal",
                {
                    group: "system",
                    businessObjectFactory: () =>
                        createEventWithDefinition("bpmn:IntermediateCatchEvent", "bpmn:SignalEventDefinition")
                }
            ),
            "create.task": createAction(
                "bpmn:Task",
                "bpmn-icon-task",
                "Manuelle Aktivität",
                {
                    group: "activities"
                }
            ),
            "create.subprocess-collapsed": createAction(
                "bpmn:SubProcess",
                "bpmn-icon-subprocess-collapsed",
                "Kompakter Subprozess",
                {
                    group: "activities",
                    shape: { isExpanded: false }
                }
            ),
            "create.subprocess-expanded": createAction(
                "bpmn:SubProcess",
                "bpmn-icon-subprocess-expanded",
                "Erweiterter Subprozess",
                {
                    group: "activities",
                    shape: { isExpanded: true }
                }
            ),
            "create.service-task": createAction(
                "bpmn:ServiceTask",
                "bpmn-icon-service-task",
                "Automatische Aktivität",
                { group: "activities" }
            ),
            "create.gateway-exclusive": createAction(
                "bpmn:ExclusiveGateway",
                "bpmn-icon-gateway-xor",
                "Exklusive Entscheidung (XOR)",
                { group: "gateways" }
            ),
            "create.gateway-parallel": createAction(
                "bpmn:ParallelGateway",
                "bpmn-icon-gateway-parallel",
                "Parallele Verzweigung (AND)",
                { group: "gateways" }
            ),
            "create.gateway-event-based": createAction(
                "bpmn:EventBasedGateway",
                "bpmn-icon-gateway-eventbased",
                "Ereignisbasierte Entscheidung",
                { group: "gateways" }
            ),
            "create.data-store-reference": createAction(
                "bpmn:DataStoreReference",
                "bpmn-icon-data-store",
                "Persistente Datenbank",
                { group: "resources" }
            ),
            "create.participant-collapsed": createAction(
                "bpmn:Participant",
                "bpmn-icon-lane",
                "Rolle als Pool/Lane",
                {
                    group: "roles",
                    shapeFactory: (businessObject) =>
                        this.elementFactory.createParticipantShape({
                            type: "bpmn:Participant",
                            businessObject,
                            isExpanded: false
                        })
                }
            )
        };
    }
}

CustomPaletteProvider.$inject = ["palette", "create", "elementFactory", "bpmnFactory"];

export const customPaletteModule = {
    __init__: ["customPaletteProvider"],
    customPaletteProvider: ["type", CustomPaletteProvider]
};
