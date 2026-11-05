import XCTest
@testable import WololoKit

final class EventReaderTests: XCTestCase {
    private var fixture: StoreFixture!
    private var runDir: URL!

    override func setUpWithError() throws {
        fixture = try StoreFixture()
        runDir = fixture.runsURL.appendingPathComponent("r")
        try FileManager.default.createDirectory(at: runDir, withIntermediateDirectories: true)
    }

    override func tearDown() {
        fixture = nil
    }

    private func line(_ seq: Int, type: String = "doing", text: String = "paso") -> String {
        #"{"v":1,"seq":\#(seq),"ts":\#(1000 + seq),"run":"r","type":"\#(type)","data":{"text":"\#(text)"}}"# + "\n"
    }

    private func lines(_ seqs: ClosedRange<Int>) -> String {
        seqs.map { line($0) }.joined()
    }

    private func write(_ text: String, to name: String) throws {
        try Data(text.utf8).write(to: runDir.appendingPathComponent(name))
    }

    private func append(_ text: String) throws {
        try fixture.append(text, toEventsOf: "r")
    }

    func testScenario8RotatedFilesThenTheCurrentOneInSeqOrder() throws {
        try write(lines(1...500), to: "events.1.jsonl")
        let broken = String(line(601).prefix(30))
        try write(lines(501...600) + broken, to: "events.jsonl")

        let events = EventReader.readAll(runDir: runDir)

        XCTAssertEqual(events.map(\.seq), Array(1...600))
        XCTAssertEqual(events.first?.type, "doing")
        XCTAssertEqual(events.first?.ts, 1001)
        XCTAssertEqual(events.first?.text("text"), "paso")
    }

    func testRotatedFilesGoInNumericOrder() throws {
        try write(lines(21...30), to: "events.10.jsonl")
        try write(lines(1...10), to: "events.2.jsonl")
        try write(lines(11...20), to: "events.9.jsonl")
        try write(lines(31...32), to: "events.jsonl")
        try write(line(99), to: "events.x.jsonl")
        try write(line(98), to: "events.jsonl.tmp")

        XCTAssertEqual(EventReader.rotatedFiles(runDir: runDir).map(\.lastPathComponent),
                       ["events.2.jsonl", "events.9.jsonl", "events.10.jsonl"])
        XCTAssertEqual(EventReader.readAll(runDir: runDir).map(\.seq), Array(1...32))
    }

    func testEventsSharingASeqAreAllKeptInFileOrder() throws {
        // Two hooks running at once both take last_seq + 1, as in a real run's agent.finished and item.reviewed.
        try write(line(1) + line(3, type: "agent.finished", text: "a"), to: "events.1.jsonl")
        try write(line(3, type: "item.reviewed", text: "b") + line(2) + line(3, type: "doing", text: "c") + line(4), to: "events.jsonl")

        let events = EventReader.readAll(runDir: runDir)

        XCTAssertEqual(events.map(\.seq), [1, 2, 3, 3, 3, 4])
        XCTAssertEqual(events.filter { $0.seq == 3 }.map(\.type), ["agent.finished", "item.reviewed", "doing"])
        let entries = timeline(events, lang: .es, includeMinor: true)
        XCTAssertEqual(Set(entries.map(\.id)).count, entries.count, "timeline ids stay unique")
    }

    func testTheOpenFileIsNotReadTwiceWhenItWasRotatedMeanwhile() throws {
        // A rotation between opening events.jsonl and listing the rotated files: the open file is listed as
        // events.2.jsonl. A hard link puts the same inode under both names.
        try write(lines(1...3), to: "events.1.jsonl")
        try write(lines(4...6), to: "events.jsonl")
        try FileManager.default.linkItem(at: runDir.appendingPathComponent("events.jsonl"), to: runDir.appendingPathComponent("events.2.jsonl"))

        XCTAssertEqual(EventReader.readAll(runDir: runDir).map(\.seq), Array(1...6))
        let tail = EventTail(runDir: runDir)
        tail.poll()
        XCTAssertEqual(tail.events.map(\.seq), Array(1...6))
    }

    func testBadLinesAreSkipped() throws {
        let text = line(1)
            + "not json\n"
            + #"{"seq":2,"ts":1}"# + "\n"
            + #"{"type":"doing","ts":1}"# + "\n"
            + "\n"
            + #"{"seq":3,"ts":1003.5,"type":"blocked"}"# + "\n"
            + #"{"seq":4,"type":"decision","data":{"text":"x","n":2,"ok":true,"none":null,"list":[1,"a"],"obj":{"k":"v"}}}"# + "\n"
        try write(text, to: "events.jsonl")

        let events = EventReader.readAll(runDir: runDir)

        XCTAssertEqual(events.map(\.seq), [1, 3, 4])
        XCTAssertEqual(events[1].ts, 1003.5)
        XCTAssertEqual(events[1].data, [:])
        XCTAssertEqual(events[2].ts, 0)
        let data = events[2].data
        XCTAssertEqual(data["n"], .number(2))
        XCTAssertEqual(data["ok"], .bool(true))
        XCTAssertEqual(data["none"], .null)
        XCTAssertEqual(data["list"], .array([.number(1), .string("a")]))
        XCTAssertEqual(data["obj"]?["k"], .string("v"))
        XCTAssertEqual(events[2].text("n"), "2")
        XCTAssertEqual(events[2].text("missing"), "")
    }

    func testMissingDirectoryReadsNothing() {
        XCTAssertEqual(EventReader.readAll(runDir: runDir.appendingPathComponent("nope")), [])
        let tail = EventTail(runDir: runDir.appendingPathComponent("nope"))
        XCTAssertEqual(tail.poll(), .reset)
        XCTAssertEqual(tail.events, [])
        XCTAssertEqual(tail.poll(), .unchanged)
    }

    func testTailReadsOnlyWhatWasAppendedAndWaitsForAPartialLine() throws {
        try write(lines(1...5), to: "events.1.jsonl")
        try write(lines(6...8), to: "events.jsonl")
        let tail = EventTail(runDir: runDir)

        XCTAssertEqual(tail.poll(), .reset)
        XCTAssertEqual(tail.events.map(\.seq), Array(1...8))
        XCTAssertEqual(tail.poll(), .unchanged)

        try append(line(9) + line(10))
        guard case .appended(let added) = tail.poll() else { return XCTFail("expected appended events") }
        XCTAssertEqual(added.map(\.seq), [9, 10])
        XCTAssertEqual(tail.events.map(\.seq), Array(1...10))

        let next = line(11, text: "a medias")
        let cut = next.index(next.startIndex, offsetBy: 25)
        try append(String(next[..<cut]))
        XCTAssertEqual(tail.poll(), .unchanged)
        XCTAssertEqual(tail.events.count, 10)

        try append(String(next[cut...]) + line(12))
        XCTAssertEqual(tail.poll(), .appended(EventReader.parse(Data((next + line(12)).utf8))))
        XCTAssertEqual(tail.events.map(\.seq), Array(1...12))
        XCTAssertEqual(tail.events[10].text("text"), "a medias")
    }

    func testTailStartsWithAPartialLastLineAndPicksItUpOnceComplete() throws {
        let next = line(3)
        let cut = next.index(next.startIndex, offsetBy: 20)
        try write(lines(1...2) + String(next[..<cut]), to: "events.jsonl")
        let tail = EventTail(runDir: runDir)
        tail.poll()
        XCTAssertEqual(tail.events.map(\.seq), [1, 2])

        try append(String(next[cut...]))
        tail.poll()
        XCTAssertEqual(tail.events.map(\.seq), [1, 2, 3])
    }

    func testTailKeepsEventsSharingASeq() throws {
        try write(line(1) + line(2, type: "agent.finished", text: "a"), to: "events.jsonl")
        let tail = EventTail(runDir: runDir)
        tail.poll()

        let same = line(2, type: "item.reviewed", text: "b")
        try append(same + line(3))
        XCTAssertEqual(tail.poll(), .appended(EventReader.parse(Data((same + line(3)).utf8))))
        XCTAssertEqual(tail.events.map(\.seq), [1, 2, 2, 3])
        XCTAssertEqual(tail.events.map(\.type), ["doing", "agent.finished", "item.reviewed", "doing"])
        XCTAssertEqual(tail.events, EventReader.readAll(runDir: runDir), "the same as a full read")
    }

    func testTailResortsAndSaysResetWhenAnAppendGoesBeforeTheLastEvent() throws {
        try write(lines(1...3) + line(5), to: "events.jsonl")
        let tail = EventTail(runDir: runDir)
        tail.poll()

        try append(line(4, type: "blocked", text: "tarde") + line(6))
        XCTAssertEqual(tail.poll(), .reset)
        XCTAssertEqual(tail.events.map(\.seq), [1, 2, 3, 4, 5, 6])
        XCTAssertEqual(tail.events, EventReader.readAll(runDir: runDir))

        try append(line(7))
        XCTAssertEqual(tail.poll(), .appended(EventReader.parse(Data(line(7).utf8))))
    }

    func testTailResetsWhenTheFileRotates() throws {
        try write(lines(1...3), to: "events.jsonl")
        let tail = EventTail(runDir: runDir)
        tail.poll()

        // What the mod's rotateIfLarge does, then the next append creates a new file.
        try append(line(4))
        XCTAssertEqual(rename(runDir.appendingPathComponent("events.jsonl").path, runDir.appendingPathComponent("events.2.jsonl").path), 0)
        XCTAssertEqual(tail.poll(), .reset, "the file is gone until the next append")
        XCTAssertEqual(tail.events.map(\.seq), [1, 2, 3, 4])
        XCTAssertEqual(tail.poll(), .unchanged)

        // A new file under the old name.
        try append(lines(5...12))
        XCTAssertEqual(tail.poll(), .reset)
        XCTAssertEqual(tail.events.map(\.seq), Array(1...12))

        try append(line(13))
        XCTAssertEqual(tail.poll(), .appended(EventReader.parse(Data(line(13).utf8))))
    }

    func testTailResetsWhenTheNewFileIsAlreadyThere() throws {
        try write(lines(1...3), to: "events.jsonl")
        let tail = EventTail(runDir: runDir)
        tail.poll()

        XCTAssertEqual(rename(runDir.appendingPathComponent("events.jsonl").path, runDir.appendingPathComponent("events.1.jsonl").path), 0)
        // Longer than what the tail had read, so only the inode tells it apart.
        try append(lines(4...20))
        XCTAssertEqual(tail.poll(), .reset)
        XCTAssertEqual(tail.events.map(\.seq), Array(1...20))
    }

    func testTailResetsWhenTheFileShrinks() throws {
        let file = runDir.appendingPathComponent("events.jsonl")
        try write(lines(1...10), to: "events.jsonl")
        let tail = EventTail(runDir: runDir)
        tail.poll()

        // Truncated in place: same inode, fewer bytes.
        let handle = try FileHandle(forWritingTo: file)
        try handle.truncate(atOffset: 0)
        try handle.write(contentsOf: Data((line(1) + line(2)).utf8))
        try handle.close()

        XCTAssertEqual(tail.poll(), .reset)
        XCTAssertEqual(tail.events.map(\.seq), [1, 2])
    }
}
