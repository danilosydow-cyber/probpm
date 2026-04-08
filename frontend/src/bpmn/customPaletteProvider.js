class CustomPaletteProvider {
    constructor(palette, create, elementFactory, bpmnFactory) {
        this.create = create;
        this.elementFactory = elementFactory;
        this.bpmnFactory = bpmnFactory;

        palette.registerProvider(this);
    }

    getPaletteEntries() {
        const createAction = (type, className, title, options = {}) => {
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
                className,
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
                "Startereignis: Nachricht",
                {
                    group: "event",
                    businessObjectFactory: () =>
                        createEventWithDefinition("bpmn:StartEvent", "bpmn:MessageEventDefinition")
                }
            ),
            "create.end-message": createAction(
                "bpmn:EndEvent",
                "bpmn-icon-end-event-message",
                "Endereignis: Nachricht",
                {
                    group: "event",
                    businessObjectFactory: () =>
                        createEventWithDefinition("bpmn:EndEvent", "bpmn:MessageEventDefinition")
                }
            ),
            "create.end-terminate": createAction(
                "bpmn:EndEvent",
                "bpmn-icon-end-event-terminate",
                "Endereignis: Abbruch",
                {
                    group: "event",
                    businessObjectFactory: () =>
                        createEventWithDefinition("bpmn:EndEvent", "bpmn:TerminateEventDefinition")
                }
            ),
            "create.intermediate-none": createAction(
                "bpmn:IntermediateCatchEvent",
                "bpmn-icon-intermediate-event-none",
                "Zwischenereignis",
                {
                    group: "event"
                }
            ),
            "create.intermediate-timer": createAction(
                "bpmn:IntermediateCatchEvent",
                "bpmn-icon-intermediate-event-catch-timer",
                "Zwischenereignis: Zeit",
                {
                    group: "event",
                    businessObjectFactory: () =>
                        createEventWithDefinition("bpmn:IntermediateCatchEvent", "bpmn:TimerEventDefinition")
                }
            ),
            "create.intermediate-message": createAction(
                "bpmn:IntermediateCatchEvent",
                "bpmn-icon-intermediate-event-catch-message",
                "Zwischenereignis: Nachricht",
                {
                    group: "event",
                    businessObjectFactory: () =>
                        createEventWithDefinition("bpmn:IntermediateCatchEvent", "bpmn:MessageEventDefinition")
                }
            ),
            "create.intermediate-signal": createAction(
                "bpmn:IntermediateCatchEvent",
                "bpmn-icon-intermediate-event-catch-signal",
                "Zwischenereignis: Signal",
                {
                    group: "event",
                    businessObjectFactory: () =>
                        createEventWithDefinition("bpmn:IntermediateCatchEvent", "bpmn:SignalEventDefinition")
                }
            ),
            "create.activity-task": createAction(
                "bpmn:Task",
                "bpmn-icon-task",
                "Task",
                {
                    group: "activity"
                }
            ),
            "create.subprocess-collapsed": createAction(
                "bpmn:SubProcess",
                "bpmn-icon-subprocess-collapsed",
                "Subprozess (kollabiert)",
                {
                    group: "activity",
                    shape: { isExpanded: false }
                }
            ),
            "create.service-task": createAction(
                "bpmn:ServiceTask",
                "bpmn-icon-service-task",
                "IT-System (Service Task)",
                { group: "activity" }
            ),
            "create.gateway-exclusive": createAction(
                "bpmn:ExclusiveGateway",
                "bpmn-icon-gateway-xor",
                "Gateway: Exklusiv (X)",
                { group: "gateway" }
            ),
            "create.gateway-parallel": createAction(
                "bpmn:ParallelGateway",
                "bpmn-icon-gateway-parallel",
                "Gateway: Parallel (+)",
                { group: "gateway" }
            ),
            "create.gateway-event-based": createAction(
                "bpmn:EventBasedGateway",
                "bpmn-icon-gateway-eventbased",
                "Gateway: Ereignisbasiert",
                { group: "gateway" }
            ),
            "create.participant-collapsed": createAction(
                "bpmn:Participant",
                "bpmn-icon-lane",
                "Schwimmbahn/Pool (eingeklappt)",
                {
                    group: "collaboration",
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
