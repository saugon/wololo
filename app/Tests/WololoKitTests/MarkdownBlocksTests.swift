import XCTest
@testable import WololoKit

final class MarkdownBlocksTests: XCTestCase {
    func testBlocks() {
        let markdown = """
        # Spec: **Wololo** Desk

        Quien usa wololo en varias terminales
        tiene una app.

        ## Alcance
        - Un `Swift Package` en `app/`
        - Un widget
          que flota
        * Otro punto
        1. Primero
        2) Segundo

        ---
        #### Detalle ##
        > Una cita
        """

        XCTAssertEqual(markdownBlocks(markdown), [
            .heading(level: 1, text: "Spec: **Wololo** Desk"),
            .paragraph("Quien usa wololo en varias terminales tiene una app."),
            .heading(level: 2, text: "Alcance"),
            .listItem(number: nil, text: "Un `Swift Package` en `app/`"),
            .listItem(number: nil, text: "Un widget que flota"),
            .listItem(number: nil, text: "Otro punto"),
            .listItem(number: 1, text: "Primero"),
            .listItem(number: 2, text: "Segundo"),
            .rule,
            .heading(level: 3, text: "Detalle"),
            .paragraph("Una cita"),
        ])
    }

    func testCodeFenceKeepsHashesAndBlankLines() {
        let markdown = """
        Antes:
        ```bash
        # not a heading
        - not an item

          indented
        ```
        ## After
        ~~~~
        ```
        ~~~~
        """

        XCTAssertEqual(markdownBlocks(markdown), [
            .paragraph("Antes:"),
            .code(language: "bash", text: "# not a heading\n- not an item\n\n  indented"),
            .heading(level: 2, text: "After"),
            .code(language: nil, text: "```"),
        ])
    }

    func testUnclosedFenceRunsToTheEnd() {
        XCTAssertEqual(markdownBlocks("```\nlet a = 1\n# b"), [.code(language: nil, text: "let a = 1\n# b")])
    }

    func testTablesAndEdgeCases() {
        let markdown = """
        | Etapa | Costo |
        |:------|------:|
        | Plan | $0.50 |
        #hashtag
        -no item
        ***
        """

        XCTAssertEqual(markdownBlocks(markdown), [
            .paragraph("Etapa · Costo"),
            .paragraph("Plan · $0.50"),
            .paragraph("#hashtag -no item"),
            .rule,
        ])
        XCTAssertEqual(markdownBlocks(""), [])
        XCTAssertEqual(markdownBlocks("\r\n\r\ntexto\r\n"), [.paragraph("texto")])
    }
}
