import XCTest
@testable import WololoKit

final class ProgressTests: XCTestCase {
    private let now = fixtureNow

    private func implementing(_ status: String, done: Int = 4, total: Int = 7, lang: String = "es") throws -> Run {
        try makeRun("r", status: status, [
            "lang": lang,
            "stage": ["id": "implement", "index": 4, "since": 0],
            "items": ["done": done, "total": total],
        ])
    }

    func testImplementationFillsWithItems() throws {
        let progress = RunProgress(try implementing("waiting_agents"), now: now)

        XCTAssertEqual(progress.fraction, (4 + 4.0 / 7) / 8, accuracy: 1e-9)
        XCTAssertEqual(progress.fraction, 0.5714, accuracy: 1e-4)
        XCTAssertEqual(progress.text, "5/8 · Implementación")
        XCTAssertEqual(progress.shortText, "5/8")
        XCTAssertEqual(progress.accessibilityLabel, "Etapa 5 de 8: Implementación")
        XCTAssertEqual(progress.role, .working)
        XCTAssertEqual(RunProgress(try implementing("waiting_user"), now: now).role, .waiting)
    }

    func testEnglishLabels() throws {
        let progress = RunProgress(try implementing("running", lang: "en"), now: now)
        XCTAssertEqual(progress.text, "5/8 · Implementation")
        XCTAssertEqual(progress.accessibilityLabel, "Stage 5 of 8: Implementation")
    }

    func testOtherStagesAreHalfway() throws {
        let plan = try makeRun("p", ["stage": ["id": "plan", "index": 3, "since": 0], "items": ["done": 1, "total": 4]])
        XCTAssertEqual(RunProgress(plan, now: now).fraction, 3.5 / 8, accuracy: 1e-9)
        XCTAssertEqual(RunProgress(try implementing("running", done: 0, total: 0), now: now).fraction, 4.5 / 8, accuracy: 1e-9)
    }

    func testRunWithoutStageStartsAtContext() throws {
        let progress = RunProgress(try makeRun("n"), now: now)
        XCTAssertEqual(progress.fraction, 0.5 / 8, accuracy: 1e-9)
        XCTAssertEqual(progress.text, "1/8 · Contexto")
    }

    func testDoneIsFullAndGreen() throws {
        let progress = RunProgress(try implementing("done"), now: now)
        XCTAssertEqual(progress.fraction, 1)
        XCTAssertEqual(progress.role, .finished)
    }

    func testRolesByGroup() throws {
        XCTAssertEqual(RunProgress(try implementing("failed"), now: now).role, .failed)
        XCTAssertEqual(RunProgress(try implementing("failed"), now: now).fraction, (4 + 4.0 / 7) / 8, accuracy: 1e-9)
        XCTAssertEqual(RunProgress(try implementing("cancelled"), now: now).role, .finished)
        XCTAssertEqual(RunProgress(try implementing("paused"), now: now).role, .onHold)
        XCTAssertEqual(RunProgress(try implementing("something_new"), now: now).role, .working)
        let orphan = try makeRun("o", ["owner": ["heartbeat_at": now - 600]])
        XCTAssertEqual(RunProgress(orphan, now: now).role, .onHold)
    }
}
