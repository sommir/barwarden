import Foundation

enum ApplicationNameSimilarity {
    static let scale = 10_000

    enum Kind: Equatable {
        case exact
        case approximate
    }

    struct Result: Equatable {
        let kind: Kind
        let similarity: Int

        var isHighConfidence: Bool { similarity >= 8_800 }
    }

    private struct NormalizedName {
        let exactTokens: [String]
        let meaningfulTokens: [String]

        var exactText: String { exactTokens.joined(separator: " ") }
        var meaningfulText: String { meaningfulTokens.joined(separator: " ") }
        var meaningfulCharacterCount: Int {
            meaningfulTokens.reduce(0) { $0 + $1.count }
        }
    }

    private static let genericTokens: Set<String> = [
        "app", "apps", "application", "client", "com", "desktop", "dmg", "io", "mac",
        "macos", "net", "official", "org", "osx",
    ]

    static func compare(applicationName: String, itemName: String) -> Result? {
        guard let application = normalize(applicationName),
              let item = normalize(itemName) else { return nil }

        if application.exactTokens == item.exactTokens {
            return Result(kind: .exact, similarity: scale)
        }

        guard !application.meaningfulTokens.isEmpty,
              !item.meaningfulTokens.isEmpty else { return nil }
        guard !hasConflictingDiscriminators(
            application.meaningfulTokens,
            item.meaningfulTokens
        ) else { return nil }

        let jaroWinkler = jaroWinkler(
            Array(application.meaningfulText),
            Array(item.meaningfulText)
        )
        let edit = optimalStringAlignment(
            Array(application.meaningfulText),
            Array(item.meaningfulText)
        )
        let coverage = symmetricTokenCoverage(
            application.meaningfulTokens,
            item.meaningfulTokens
        )
        let score = (45 * jaroWinkler + 35 * edit + 20 * coverage) / 100
        let shortest = min(
            application.meaningfulCharacterCount,
            item.meaningfulCharacterCount
        )
        let threshold: Int
        switch shortest {
        case 3 ... 4: threshold = 9_400
        case 5 ... 7: threshold = 8_000
        default: threshold = 7_200
        }

        guard score >= threshold else { return nil }
        return Result(kind: .approximate, similarity: score)
    }

    private static func normalize(_ raw: String) -> NormalizedName? {
        let composed = raw.precomposedStringWithCanonicalMapping
        guard composed.unicodeScalars.count <= 128 else { return nil }

        var separated = ""
        var previous: Unicode.Scalar?
        for scalar in composed.unicodeScalars {
            if let previous,
               (previous.properties.isLowercase || previous.properties.numericType != nil),
               scalar.properties.isUppercase {
                separated.append(" ")
            }
            separated.unicodeScalars.append(scalar)
            previous = scalar
        }

        let folded = separated.folding(
            options: [.caseInsensitive, .widthInsensitive],
            locale: Locale(identifier: "en_US_POSIX")
        ).precomposedStringWithCanonicalMapping
        let exactTokens = folded.split { !$0.isLetter && !$0.isNumber }.map(String.init)
        guard !exactTokens.isEmpty, exactTokens.count <= 16 else { return nil }
        let meaningful = exactTokens.filter { token in
            token.count >= 3 && !genericTokens.contains(token)
        }
        return NormalizedName(exactTokens: exactTokens, meaningfulTokens: meaningful)
    }

    private static func jaroWinkler(_ left: [Character], _ right: [Character]) -> Int {
        guard !left.isEmpty, !right.isEmpty else { return 0 }
        if left == right { return scale }

        let matchDistance = max(max(left.count, right.count) / 2 - 1, 0)
        var leftMatches = Array(repeating: false, count: left.count)
        var rightMatches = Array(repeating: false, count: right.count)
        var matches = 0

        for leftIndex in left.indices {
            let start = max(leftIndex - matchDistance, 0)
            let end = min(leftIndex + matchDistance + 1, right.count)
            guard start < end else { continue }
            for rightIndex in start ..< end where !rightMatches[rightIndex] {
                guard left[leftIndex] == right[rightIndex] else { continue }
                leftMatches[leftIndex] = true
                rightMatches[rightIndex] = true
                matches += 1
                break
            }
        }
        guard matches > 0 else { return 0 }

        let matchedLeft = left.indices.filter { leftMatches[$0] }.map { left[$0] }
        let matchedRight = right.indices.filter { rightMatches[$0] }.map { right[$0] }
        let mismatches = zip(matchedLeft, matchedRight).filter(!=).count
        let transpositions = mismatches / 2
        let jaro = (
            matches * scale / left.count
                + matches * scale / right.count
                + (matches - transpositions) * scale / matches
        ) / 3
        guard jaro >= 7_000 else { return jaro }

        var prefix = 0
        for (lhs, rhs) in zip(left, right).prefix(4) {
            guard lhs == rhs else { break }
            prefix += 1
        }
        return min(scale, jaro + prefix * (scale - jaro) / 10)
    }

    private static func optimalStringAlignment(_ left: [Character], _ right: [Character]) -> Int {
        guard !left.isEmpty, !right.isEmpty else { return 0 }
        let rows = left.count + 1
        let columns = right.count + 1
        var distances = Array(repeating: Array(repeating: 0, count: columns), count: rows)
        for row in 0 ..< rows { distances[row][0] = row }
        for column in 0 ..< columns { distances[0][column] = column }

        if left.count > 0, right.count > 0 {
            for row in 1 ... left.count {
                for column in 1 ... right.count {
                    let substitution = left[row - 1] == right[column - 1] ? 0 : 1
                    distances[row][column] = min(
                        distances[row - 1][column] + 1,
                        distances[row][column - 1] + 1,
                        distances[row - 1][column - 1] + substitution
                    )
                    if row > 1, column > 1,
                       left[row - 1] == right[column - 2],
                       left[row - 2] == right[column - 1] {
                        distances[row][column] = min(
                            distances[row][column],
                            distances[row - 2][column - 2] + 1
                        )
                    }
                }
            }
        }

        let maximum = max(left.count, right.count)
        return max(0, (maximum - distances[left.count][right.count]) * scale / maximum)
    }

    private static func symmetricTokenCoverage(_ left: [String], _ right: [String]) -> Int {
        let leftToRight = directionalTokenCoverage(left, right)
        let rightToLeft = directionalTokenCoverage(right, left)
        guard leftToRight > 0, rightToLeft > 0 else { return 0 }
        return 2 * leftToRight * rightToLeft / (leftToRight + rightToLeft)
    }

    private static func hasConflictingDiscriminators(_ left: [String], _ right: [String]) -> Bool {
        let leftSet = Set(left)
        let rightSet = Set(right)
        guard !leftSet.isDisjoint(with: rightSet) else { return false }
        let leftOnly = left.filter { !rightSet.contains($0) }
        let rightOnly = right.filter { !leftSet.contains($0) }
        guard !leftOnly.isEmpty, !rightOnly.isEmpty else { return false }

        let bestRemainingPair = leftOnly.reduce(0) { bestLeft, leftToken in
            rightOnly.reduce(bestLeft) { bestRight, rightToken in
                let leftCharacters = Array(leftToken)
                let rightCharacters = Array(rightToken)
                return max(
                    bestRight,
                    jaroWinkler(leftCharacters, rightCharacters),
                    optimalStringAlignment(leftCharacters, rightCharacters)
                )
            }
        }
        return bestRemainingPair < 7_200
    }

    private static func directionalTokenCoverage(_ source: [String], _ target: [String]) -> Int {
        let totalWeight = source.reduce(0) { $0 + $1.count }
        guard totalWeight > 0 else { return 0 }
        let weighted = source.reduce(0) { partial, token in
            let sourceCharacters = Array(token)
            let best = target.reduce(0) { current, candidate in
                let targetCharacters = Array(candidate)
                return max(
                    current,
                    jaroWinkler(sourceCharacters, targetCharacters),
                    optimalStringAlignment(sourceCharacters, targetCharacters)
                )
            }
            return partial + best * token.count
        }
        return weighted / totalWeight
    }
}
