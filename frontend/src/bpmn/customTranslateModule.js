const deTranslations = {
    "Task": "Aktivität",
    "Service Task": "Automatische Aktivität",
    "IT-System (Service Task)": "Automatische Aktivität",
    "Pool/Participant": "Pool/Teilnehmer",
    "Participant": "Teilnehmer",
    "Sub Process": "Subprozess",
    "Start Event": "Startereignis",
    "End Event": "Endereignis",
    "Exclusive Gateway": "Exklusives Gateway",
    "Parallel Gateway": "Paralleles Gateway",
    "Event based Gateway": "Ereignisbasiertes Gateway",
    "Data Object Reference": "Datenobjekt",
    "Data Store Reference": "Datenbank",
    "Create Data Store Reference": "Datenbank erstellen",
    "Create Task": "Aktivität erstellen",
    "Create ServiceTask": "Automatische Aktivität erstellen",
    "Create Service Task": "Automatische Aktivität erstellen",
    "Create Pool/Participant": "Pool/Teilnehmer erstellen",
    "Create expanded SubProcess": "Erweiterten Subprozess erstellen",
    "Create DataObjectReference": "Datenobjekt erstellen",
    "Create DataStoreReference": "Datenbank erstellen",
    "Append Task": "Aktivität anhängen",
    "Append EndEvent": "Endereignis anhängen",
    "Append Gateway": "Gateway anhängen",
    "Append Intermediate/Boundary Event": "Zwischen-/Grenzereignis anhängen",
    "Append Intermediate/Boundary Event with condition": "Bedingtes Zwischen-/Grenzereignis anhängen",
    "Append compensation activity": "Kompensationsaktivität anhängen",
    "Change type": "Typ ändern",
    "Replace": "Ersetzen",
    "Delete": "Löschen",
    "Connect using Sequence/MessageFlow or Association": "Mit Sequenz-/Nachrichtenfluss oder Assoziation verbinden",
    "Hand Tool": "Hand-Werkzeug",
    "Lasso Tool": "Lasso-Werkzeug",
    "Space Tool": "Abstands-Werkzeug",
    "Global Connect Tool": "Globales Verbindungs-Werkzeug",
    "Activate the hand tool": "Hand-Werkzeug aktivieren",
    "Activate the lasso tool": "Lasso-Werkzeug aktivieren",
    "Activate the create/remove space tool": "Werkzeug zum Erstellen/Entfernen von Abstand aktivieren",
    "Activate the global connect tool": "Globales Verbindungs-Werkzeug aktivieren"
};

function customTranslate(template, replacements) {
    const translated = deTranslations[template] || template;
    return translated.replace(/{([^}]+)}/g, (_, key) => (
        replacements && replacements[key] ? replacements[key] : `{${key}}`
    ));
}

customTranslate.$inject = [];

export const customTranslateModule = {
    translate: ["value", customTranslate]
};
