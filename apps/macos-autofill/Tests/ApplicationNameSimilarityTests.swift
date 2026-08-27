import XCTest

final class ApplicationNameSimilarityTests: XCTestCase {
    func testExactTypoTranspositionAndMultiTokenScoresAreOrdered() {
        let exact = compare("Termius", "Termius")
        let missing = compare("Termius", "trmius")
        let transposed = compare("Termius", "Temrius")
        let extended = compare("Termius", "Termius SSH")

        XCTAssertEqual(exact?.kind, .exact)
        XCTAssertEqual(exact?.similarity, 10_000)
        XCTAssertGreaterThanOrEqual(missing?.similarity ?? 0, 8_800)
        XCTAssertGreaterThanOrEqual(transposed?.similarity ?? 0, 8_800)
        XCTAssertGreaterThan(extended?.similarity ?? 0, 7_200)
        XCTAssertGreaterThan(missing?.similarity ?? 0, extended?.similarity ?? 0)
    }

    func testSharedVendorPrefixAndShortNamesFailClosed() {
        XCTAssertNil(compare("Microsoft Teams", "Microsoft Outlook"))
        XCTAssertNil(compare("AWS", "WPS"))
        XCTAssertNil(compare("Warp", "Wasp"))
    }

    func testNormalizationIsUnicodeCaseSeparatorAndCamelBoundaryStable() {
        XCTAssertEqual(compare("Visual Studio Code", "visualStudio-code")?.kind, .exact)
        XCTAssertEqual(compare("Te\u{301}rmius", "TÉRMIUS")?.kind, .exact)
    }

    func testOversizedOrNormalizationEmptyInputsFailClosed() {
        XCTAssertNil(compare(String(repeating: "a", count: 129), "a"))
        XCTAssertNil(compare("---", "___"))
    }

    func testComparisonScoreIsSymmetric() {
        let pairs = [
            ("Termius", "trmius"),
            ("Termius", "Temrius"),
            ("Termius", "Termius SSH"),
            ("Visual Studio Code", "visualStudio-code"),
        ]

        for (left, right) in pairs {
            XCTAssertEqual(compare(left, right), compare(right, left), "\(left) / \(right)")
        }
    }

    private func compare(
        _ applicationName: String,
        _ itemName: String
    ) -> ApplicationNameSimilarity.Result? {
        ApplicationNameSimilarity.compare(applicationName: applicationName, itemName: itemName)
    }
}
