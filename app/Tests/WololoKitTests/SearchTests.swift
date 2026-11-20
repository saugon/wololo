import XCTest
@testable import WololoKit

final class SearchTests: XCTestCase {
    private func runs() throws -> [Run] {
        [
            try makeRun("issue", [
                "title": "Exportar facturas a CSV",
                "source": ["kind": "github_issue", "ref": "#4312"],
                "project": ["key": "acme__billing", "branch": "wololo/export-csv"],
            ]),
            try makeRun("desk", [
                "title": "Wololo: app para ver el estado",
                "source": ["kind": "text", "ref": "Una app de macOS"],
                "project": ["key": "saugon__wololo", "branch": "wololo/txt-app-para-ver"],
            ]),
            try makeRun("report", [
                "title": "Reporte mensual de uso",
                "source": ["kind": "file", "ref": "docs/plan-reporte.md"],
                "project": ["key": "saugon__wololo", "branch": "wololo/plan-reporte"],
            ]),
        ]
    }

    private func ids(_ query: String, project: String? = nil) throws -> [String] {
        filterRuns(try runs(), query: query, project: project).map(\.id)
    }

    func testSearchesTheSourceRef() throws {
        XCTAssertEqual(try ids("4312"), ["issue"])
        XCTAssertEqual(try ids("#4312"), ["issue"])
    }

    func testSearchIgnoresCaseAndAccents() throws {
        XCTAssertEqual(try ids("FACTURAS"), ["issue"])
        XCTAssertEqual(try ids("repórte"), ["report"])
    }

    func testSearchesProjectAndBranch() throws {
        XCTAssertEqual(try ids("saugon/wololo"), ["desk", "report"])
        XCTAssertEqual(try ids("txt-app"), ["desk"])
        XCTAssertEqual(try ids("plan-reporte.md"), ["report"])
    }

    func testEmptyQueryKeepsEverything() throws {
        XCTAssertEqual(try ids("  "), ["issue", "desk", "report"])
        XCTAssertEqual(try ids("nada que ver"), [])
    }

    func testProjectFilter() throws {
        XCTAssertEqual(try ids("", project: "saugon__wololo"), ["desk", "report"])
        XCTAssertEqual(try ids("4312", project: "saugon__wololo"), [])
    }
}
