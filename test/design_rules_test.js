// Automatischer Test für Design-Regeln
// Erstellt einfache BPMN-Prozesse und validiert die Layout-Regeln

const https = require('https');
const http = require('http');

const BASE_URL = 'http://localhost:5000';

// Test-Prozessbeschreibungen
const TEST_PROCESSES = [
    {
        name: "Einfacher linearer Prozess",
        description: "Ein Mitarbeiter startet eine Aufgabe und beendet sie dann.",
        expectedRules: {
            horizontalIncoming: true,
            gatewayExits: "not_applicable",
            noOverlaps: true
        }
    },
    {
        name: "Prozess mit Gateway",
        description: "Ein Mitarbeiter prüft eine Bedingung. Wenn ja, macht er Aufgabe A. Wenn nein, macht er Aufgabe B.",
        expectedRules: {
            horizontalIncoming: true,
            gatewayExits: true,
            noOverlaps: true
        }
    },
    {
        name: "Komplexer Prozess mit mehreren Gateways",
        description: "Ein Prozess startet, prüft Bedingung 1. Wenn ja, geht zu Gateway 2. Wenn nein, macht Aufgabe A. Bei Gateway 2 wird Bedingung 2 geprüft. Wenn ja, Aufgabe B, wenn nein, Aufgabe C.",
        expectedRules: {
            horizontalIncoming: true,
            gatewayExits: true,
            noOverlaps: true
        }
    }
];

async function generateBPMN(description) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            description,
            realTime: false
        });
        
        const options = {
            hostname: 'localhost',
            port: 5000,
            path: '/api/generate',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };
        
        const req = http.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            });
        });
        
        req.on('error', (error) => {
            console.error('Fehler bei BPMN-Generierung:', error);
            reject(error);
        });
        
        req.write(postData);
        req.end();
    });
}

function validateDesignRules(bpmnXml, expectedRules) {
    const issues = [];
    
    // Validierung 1: Horizontale eingehende Pfeile
    if (expectedRules.horizontalIncoming) {
        // Prüfe ob Pfeile horizontal in Aktivitäten enden
        const incomingFlows = bpmnXml.match(/<bpmn:sequenceFlow[^>]*source="[^"]*"[^>]*>/g);
        if (incomingFlows) {
            incomingFlows.forEach((flow, index) => {
                // Prüfe Wegpunkte auf horizontale Ausrichtung
                const waypoints = flow.match(/waypoint[^>]*x="([^"]*)"[^>]*y="([^"]*)"/g);
                if (waypoints && waypoints.length >= 2) {
                    const lastPoint = waypoints[waypoints.length - 1];
                    const x = parseFloat(lastPoint[1]);
                    const y = parseFloat(lastPoint[2]);
                    
                    // Prüfe ob der letzte Wegpunkt horizontal ausgerichtet ist
                    // (sollte von links kommen und mittig enden)
                    if (x < 100) { // Annahme: Aktivität beginnt bei x=100
                        issues.push(`Pfeil ${index}: Endet bei x=${x}, sollte horizontal von links kommen`);
                    }
                }
            });
        }
    }
    
    // Validierung 2: Gateway-Ausgänge
    if (expectedRules.gatewayExits) {
        // Prüfe ob Gateway-Pfeile rechts/oben/unten ausgehen
        const gateways = bpmnXml.match(/<bpmn:exclusiveGateway[^>]*id="([^"]*)"/g);
        if (gateways) {
            gateways.forEach((gateway, index) => {
                const gatewayId = gateway[1];
                const outgoingFlows = bpmnXml.match(new RegExp(`<bpmn:sequenceFlow[^>]*source="${gatewayId}"[^>]*>`, 'g'));
                
                if (outgoingFlows && outgoingFlows.length > 1) {
                    outgoingFlows.forEach((flow, flowIndex) => {
                        const waypoints = flow.match(/waypoint[^>]*x="([^"]*)"[^>]*y="([^"]*)"/g);
                        if (waypoints && waypoints.length >= 2) {
                            const firstPoint = waypoints[0];
                            const secondPoint = waypoints[1];
                            const x1 = parseFloat(firstPoint[1]);
                            const y1 = parseFloat(firstPoint[2]);
                            const x2 = parseFloat(secondPoint[1]);
                            const y2 = parseFloat(secondPoint[2]);
                            
                            // Prüfe ob der erste Wegpunkt rechts/oben/unten vom Gateway ist
                            if (x2 <= x1) {
                                issues.push(`Gateway ${index} Pfeil ${flowIndex}: Geht nicht nach rechts (x2=${x2} <= x1=${x1})`);
                            }
                            
                            // Prüfe ob vertikale Ausrichtung (oben/unten)
                            if (Math.abs(y2 - y1) < 10) {
                                issues.push(`Gateway ${index} Pfeil ${flowIndex}: Sollte oben/unten gehen, ist aber horizontal`);
                            }
                        }
                    });
                }
            });
        }
    }
    
    // Validierung 3: Keine Überlappungen
    if (expectedRules.noOverlaps) {
        // Prüfe auf offensichtliche Überlappungen in den Koordinaten
        const shapes = bpmnXml.match(/<dc:Bounds[^>]*x="([^"]*)"[^>]*y="([^"]*)"[^>]*width="([^"]*)"[^>]*height="([^"]*)"/g);
        if (shapes && shapes.length > 1) {
            for (let i = 0; i < shapes.length; i++) {
                for (let j = i + 1; j < shapes.length; j++) {
                    const shape1 = shapes[i];
                    const shape2 = shapes[j];
                    
                    const x1 = parseFloat(shape1[1]);
                    const y1 = parseFloat(shape1[2]);
                    const w1 = parseFloat(shape1[3]);
                    const h1 = parseFloat(shape1[4]);
                    
                    const x2 = parseFloat(shape2[1]);
                    const y2 = parseFloat(shape2[2]);
                    const w2 = parseFloat(shape2[3]);
                    const h2 = parseFloat(shape2[4]);
                    
                    // Prüfe auf Überlappung
                    if (!(x1 + w1 <= x2 || x2 + w2 <= x1 || 
                          y1 + h1 <= y2 || y2 + h2 <= y1)) {
                        issues.push(`Überlappung zwischen Element ${i} und ${j}`);
                    }
                }
            }
        }
    }
    
    return issues;
}

async function runTests() {
    console.log('🧪 Starte automatische Design-Regeln Tests...\n');
    
    for (const test of TEST_PROCESSES) {
        console.log(`📋 Test: ${test.name}`);
        console.log(`📝 Beschreibung: ${test.description}`);
        
        try {
            // BPMN generieren
            const result = await generateBPMN(test.description);
            
            if (result.success && result.bpmn) {
                // Design-Regeln validieren
                const issues = validateDesignRules(result.bpmn, test.expectedRules);
                
                if (issues.length === 0) {
                    console.log(`✅ ${test.name}: Alle Design-Regeln erfüllt`);
                } else {
                    console.log(`❌ ${test.name}: Design-Regeln verletzt:`);
                    issues.forEach(issue => console.log(`   - ${issue}`));
                }
                
                // BPMN speichern für manuelle Inspektion
                const fs = require('fs');
                const filename = `test_${test.name.replace(/\s+/g, '_')}.bpmn`;
                fs.writeFileSync(filename, result.bpmn);
                console.log(`💾 Gespeichert als: ${filename}`);
            } else {
                console.log(`❌ ${test.name}: BPMN-Generierung fehlgeschlagen`);
            }
        } catch (error) {
            console.log(`❌ ${test.name}: Fehler - ${error.message}`);
        }
        
        console.log(''); // Leerzeile
    }
    
    console.log('🏁 Tests abgeschlossen!');
}

// Tests ausführen
runTests().catch(console.error);
