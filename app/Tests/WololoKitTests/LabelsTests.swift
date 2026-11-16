import XCTest
@testable import WololoKit

final class LabelsTests: XCTestCase {
    func testStagesMatchTheMod() {
        XCTAssertEqual(Stage.all.map(\.id), ["context", "definition", "gate_a", "plan", "implement", "evidence", "gate_b", "pr"])
        XCTAssertEqual(
            Stage.all.map { $0.label(.es) },
            ["Contexto", "Definición", "Aprobar spec", "Plan", "Implementación", "Evidencia", "Aprobar PR", "PR"]
        )
        XCTAssertEqual(
            Stage.all.map { $0.label(.en) },
            ["Context", "Definition", "Approve spec", "Plan", "Implementation", "Evidence", "Approve PR", "PR"]
        )
        XCTAssertEqual(Stage.all.filter(\.isGate).map(\.id), ["gate_a", "gate_b"])
    }

    func testStageLookup() {
        XCTAssertEqual(Stage.index(of: "implement"), 4)
        XCTAssertNil(Stage.index(of: "later"))
        XCTAssertEqual(Stage.label(of: "gate_b", .es), "Aprobar PR")
        XCTAssertEqual(Stage.label(of: "later", .en), "later")
    }

    func testStatusLabelsInSpanish() {
        let labels = RunStatus.known.map { $0.label(.es) }
        XCTAssertEqual(labels, [
            "Trabajando", "Te espera", "Pide permiso", "Agentes trabajando", "Esperando CI", "Corriendo tests",
            "Bloqueado", "Detenido", "Pausando", "En pausa", "En revisión", "Huérfano", "Listo", "Falló", "Cancelado",
        ])
        XCTAssertEqual(RunStatus.unknown("something_new").label(.es), "desconocido")
    }

    func testStatusLabelsInEnglish() {
        let labels = RunStatus.known.map { $0.label(.en) }
        XCTAssertEqual(labels, [
            "Working", "Waiting for you", "Needs permission", "Agents working", "Waiting for CI", "Running tests",
            "Blocked", "Stopped", "Pausing", "Paused", "In review", "Orphaned", "Done", "Failed", "Cancelled",
        ])
        XCTAssertEqual(RunStatus.unknown("something_new").label(.en), "unknown")
    }

    func testDuration() {
        XCTAssertEqual(duration(0), "0s")
        XCTAssertEqual(duration(45), "45s")
        XCTAssertEqual(duration(59.4), "59s")
        XCTAssertEqual(duration(59.5), "1m")
        XCTAssertEqual(duration(120), "2m")
        XCTAssertEqual(duration(3599), "59m")
        XCTAssertEqual(duration(3600), "1h00")
        XCTAssertEqual(duration(3900), "1h05")
        XCTAssertEqual(duration(26 * 3600 + 30 * 60), "26h30")
        XCTAssertEqual(duration(-5), "0s")
        XCTAssertEqual(duration(.nan), "0s")
    }

    func testRiskLabels() {
        XCTAssertEqual(riskLabel("low", lang: .es), "bajo")
        XCTAssertEqual(riskLabel("high", lang: .es), "alto")
        XCTAssertEqual(riskLabel("unknown", lang: .es), "sin evaluar")
        XCTAssertEqual(riskLabel("low", lang: .en), "low")
        XCTAssertEqual(riskLabel("high", lang: .en), "high")
        XCTAssertEqual(riskLabel("unknown", lang: .en), "unassessed")
        XCTAssertEqual(riskLabel("medium", lang: .es), "medium", "a value the app does not know passes through")
    }
}
