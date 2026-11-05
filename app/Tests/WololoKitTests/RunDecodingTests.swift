import XCTest
@testable import WololoKit

final class RunDecodingTests: XCTestCase {
    private let fullRun = #"""
    {
      "schema_version": 1,
      "id": "saugon__wololo-4312-a1b2c3",
      "title": "Exportar facturas a CSV",
      "source": { "kind": "github_issue", "ref": "#4312", "url": "https://github.com/saugon/wololo/issues/4312" },
      "project": {
        "key": "saugon__wololo",
        "path": "/Users/me/wololo",
        "worktree": "/Users/me/wololo/.claude/worktrees/wololo-4312",
        "branch": "wololo/4312-export-csv",
        "base": "main"
      },
      "mode": "checkpoints",
      "risk": "high",
      "lang": "en",
      "slot": 1,
      "stage": { "id": "implement", "index": 4, "total": 8, "since": 1000 },
      "stages": [
        { "id": "context", "started_at": 100, "finished_at": 200 },
        { "id": "implement", "started_at": 1000, "finished_at": null }
      ],
      "gates": {
        "gate_a": {
          "requested_at": 300, "resolved_at": 400, "outcome": "approved", "by": "user",
          "snapshot": { "spec": "abc", "plan": null, "tree": "def" }
        }
      },
      "status": "waiting_user",
      "waiting": { "on": "user", "question": "¿Aprobás el spec?", "since": 1100 },
      "blocked": { "reason": "a test looks wrong", "since": 1050 },
      "agents": [
        {
          "id": "a1", "role": "implementer", "description": "Item 4", "model": "claude-opus-5-5",
          "status": "running", "started_at": 1010, "finished_at": null
        },
        {
          "id": "a2", "role": "verifier", "description": "Item 3", "model": null,
          "status": "completed", "started_at": 900, "finished_at": 950
        }
      ],
      "tasks": [
        { "id": "t1", "label": "CI", "kind": "ci", "started_at": 1020, "finished_at": null, "status": null }
      ],
      "items": {
        "done": 4,
        "total": 7,
        "current": { "n": 5, "title": "Write the CSV", "since": 1030 },
        "list": [
          { "n": 1, "title": "Read invoices", "state": "done", "sha": "1234567", "verified": { "at": 1, "tree": null } },
          { "n": 5, "title": "Write the CSV", "state": "active", "sha": null }
        ]
      },
      "counts": {
        "assumptions": 5, "decisions": 9, "corrections": 1, "debate_turns": 2, "attempts": 1,
        "reversals": 0, "nudges": 0, "unsigned": 0, "reversals_by_item": { "3": 1 }, "ci_failures": 2
      },
      "pr": { "url": "https://github.com/saugon/wololo/pull/4400", "number": 4400, "state": "draft", "ci": "pending" },
      "screenshots": [ { "file": "screenshots/01.png", "caption": "The export button" } ],
      "owner": { "session_id": "s-1", "cwd": "/Users/me/wololo", "heartbeat_at": 1200 },
      "last_seq": 1087,
      "last_user_at": 1000,
      "last_answer_at": 400,
      "last_answer": { "at": 400, "pairs": [ { "header": "Aprobar spec", "answer": "Aprobar" } ] },
      "created_at": 90,
      "updated_at": 1210,
      "finished_at": null,
      "outcome": null,
      "summary": null,
      "doing": { "text": "Writing the CSV exporter", "since": 1040 },
      "pause_requested_at": null,
      "paused": null,
      "review": "local",
      "time": {
        "context": { "roles": { "explorer": 270.5 }, "work": 100.25, "agents": 82 },
        "implement": { "roles": {}, "you": 30 }
      },
      "usage": {
        "context": {
          "input": 111, "output": 33866, "cache_read": 2153696, "cache_write": 157232, "usd": 1.98,
          "roles": { "main": { "usd": 0.61, "tokens": 1125829 } }
        }
      }
    }
    """#

    private func decode(_ json: String) throws -> Run {
        try Run.decode(from: Data(json.utf8))
    }

    func testDecodesAFullRun() throws {
        let run = try decode(fullRun)

        XCTAssertEqual(run.id, "saugon__wololo-4312-a1b2c3")
        XCTAssertEqual(run.title, "Exportar facturas a CSV")
        XCTAssertEqual(run.source.kind, "github_issue")
        XCTAssertEqual(run.source.ref, "#4312")
        XCTAssertEqual(run.project.key, "saugon__wololo")
        XCTAssertEqual(run.project.branch, "wololo/4312-export-csv")
        XCTAssertEqual(run.mode, "checkpoints")
        XCTAssertEqual(run.risk, "high")
        XCTAssertEqual(run.lang, .en)
        XCTAssertEqual(run.stage?.id, "implement")
        XCTAssertEqual(run.stage?.index, 4)
        XCTAssertEqual(run.stages.count, 2)
        XCTAssertEqual(run.stages[0].finishedAt, 200)
        XCTAssertNil(run.stages[1].finishedAt)
        XCTAssertEqual(run.gates["gate_a"]?.outcome, "approved")
        XCTAssertEqual(run.gates["gate_a"]?.resolvedAt, 400)
        XCTAssertEqual(run.status, .waitingUser)
        XCTAssertEqual(run.waiting?.question, "¿Aprobás el spec?")
        XCTAssertEqual(run.blocked?.reason, "a test looks wrong")
        XCTAssertEqual(run.doing?.text, "Writing the CSV exporter")
        XCTAssertNil(run.paused)
        XCTAssertEqual(run.agents.map(\.role), ["implementer", "verifier"])
        XCTAssertEqual(run.agents[0].model, "claude-opus-5-5")
        XCTAssertNil(run.agents[1].model)
        XCTAssertEqual(run.agents[1].finishedAt, 950)
        XCTAssertEqual(run.tasks.first?.kind, "ci")
        XCTAssertEqual(run.items.done, 4)
        XCTAssertEqual(run.items.total, 7)
        XCTAssertEqual(run.items.current?.n, 5)
        XCTAssertEqual(run.items.current?.since, 1030)
        XCTAssertEqual(run.items.list.map(\.state), ["done", "active"])
        XCTAssertEqual(run.counts.decisions, 9)
        XCTAssertEqual(run.counts.debateTurns, 2)
        XCTAssertEqual(run.counts.ciFailures, 2)
        XCTAssertEqual(run.pr?.number, 4400)
        XCTAssertEqual(run.pr?.state, "draft")
        XCTAssertEqual(run.pr?.ci, "pending")
        XCTAssertEqual(run.screenshots.first?.caption, "The export button")
        XCTAssertEqual(run.owner.sessionID, "s-1")
        XCTAssertEqual(run.owner.cwd, "/Users/me/wololo")
        XCTAssertEqual(run.owner.heartbeatAt, 1200)
        XCTAssertEqual(run.createdAt, 90)
        XCTAssertEqual(run.updatedAt, 1210)
        XCTAssertNil(run.finishedAt)
        XCTAssertNil(run.outcome)
        XCTAssertEqual(run.time["context"]?.work, 100.25)
        XCTAssertEqual(run.time["context"]?.roles["explorer"], 270.5)
        XCTAssertEqual(run.time["implement"]?.you, 30)
        XCTAssertEqual(run.time["implement"]?.work, 0)
        XCTAssertEqual(run.usage["context"]?.cacheRead, 2153696)
        XCTAssertEqual(run.usage["context"]?.tokens, 111 + 33866 + 2153696 + 157232)
        XCTAssertEqual(run.usage["context"]?.roles["main"]?.tokens, 1125829)
    }

    func testDecodesAFinishedRun() throws {
        let run = try decode(#"""
        {
          "id": "r-done", "status": "done", "outcome": "done", "finished_at": 5000,
          "summary": "PR #4471 listo para revisión",
          "pr": { "url": "https://example.com/pull/4471", "number": 4471, "state": "ready", "ci": "passing" }
        }
        """#)

        XCTAssertEqual(run.status, .done)
        XCTAssertEqual(run.outcome, "done")
        XCTAssertEqual(run.finishedAt, 5000)
        XCTAssertEqual(run.summary, "PR #4471 listo para revisión")
        XCTAssertEqual(run.pr?.ci, "passing")
    }

    func testUnknownFieldsAndStatusStillDecode() throws {
        let run = try decode(#"""
        {
          "id": "r-new",
          "status": "something_new",
          "brand_new_block": { "nested": [1, 2, 3] },
          "owner": { "session_id": "s", "cwd": "/tmp", "heartbeat_at": 10, "host": "laptop" },
          "items": { "done": 1, "total": 2, "current": null, "progress": 0.5 }
        }
        """#)

        XCTAssertEqual(run.status, .unknown("something_new"))
        XCTAssertEqual(run.status.rawValue, "something_new")
        XCTAssertEqual(run.owner.heartbeatAt, 10)
        XCTAssertEqual(run.items.done, 1)
    }

    func testTruncatedJSONThrows() {
        let truncated = String(fullRun.prefix(fullRun.count / 2))
        XCTAssertThrowsError(try decode(truncated))
    }

    func testMissingOrEmptyIDThrows() {
        XCTAssertThrowsError(try decode(#"{ "title": "No id", "status": "running" }"#))
        XCTAssertThrowsError(try decode(#"{ "id": "", "status": "running" }"#))
        XCTAssertThrowsError(try decode(#"{ "id": 42 }"#))
    }

    func testMissingBlocksGetDefaults() throws {
        let run = try decode(#"{ "id": "r-min" }"#)

        XCTAssertEqual(run.title, "")
        XCTAssertEqual(run.source.kind, "text")
        XCTAssertEqual(run.source.ref, "")
        XCTAssertNil(run.source.url)
        XCTAssertEqual(run.project.key, "")
        XCTAssertNil(run.project.branch)
        XCTAssertEqual(run.lang, .es)
        XCTAssertNil(run.stage)
        XCTAssertEqual(run.stages, [])
        XCTAssertEqual(run.gates, [:])
        XCTAssertEqual(run.status, .unknown(""))
        XCTAssertNil(run.waiting)
        XCTAssertNil(run.blocked)
        XCTAssertNil(run.doing)
        XCTAssertNil(run.paused)
        XCTAssertEqual(run.agents, [])
        XCTAssertEqual(run.tasks, [])
        XCTAssertEqual(run.items.done, 0)
        XCTAssertEqual(run.items.total, 0)
        XCTAssertNil(run.items.current)
        XCTAssertEqual(run.items.list, [])
        XCTAssertEqual(run.counts.attempts, 0)
        XCTAssertNil(run.pr)
        XCTAssertEqual(run.screenshots, [])
        XCTAssertEqual(run.owner.heartbeatAt, 0)
        XCTAssertEqual(run.createdAt, 0)
        XCTAssertEqual(run.updatedAt, 0)
        XCTAssertNil(run.finishedAt)
        XCTAssertEqual(run.usage, [:])
        XCTAssertEqual(run.time, [:])
    }

    func testWrongTypesFallBackToDefaults() throws {
        let run = try decode(#"""
        {
          "id": "r-odd",
          "title": 7,
          "status": 3,
          "stage": "implement",
          "items": { "done": "four", "total": 7 },
          "agents": [ "not an agent", { "id": "a1", "role": "critic" } ],
          "owner": null
        }
        """#)

        XCTAssertEqual(run.title, "")
        XCTAssertEqual(run.status, .unknown(""))
        XCTAssertNil(run.stage)
        XCTAssertEqual(run.items.done, 0)
        XCTAssertEqual(run.items.total, 7)
        XCTAssertEqual(run.agents.map(\.role), ["critic"])
        XCTAssertEqual(run.owner.heartbeatAt, 0)
    }

    func testUnknownLangFallsBackToSpanish() throws {
        XCTAssertEqual(try decode(#"{ "id": "r", "lang": "fr" }"#).lang, .es)
        XCTAssertEqual(try decode(#"{ "id": "r", "lang": null }"#).lang, .es)
        XCTAssertEqual(try decode(#"{ "id": "r", "lang": "en" }"#).lang, .en)
    }
}
