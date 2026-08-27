import AppKit

struct CredentialCandidateRow {
    let candidate: RankedCandidate
    let reasonText: String
}

struct CredentialCandidateSection {
    let group: CandidateGroup
    let rows: [CredentialCandidateRow]

    var title: String {
        switch group {
        case .exact: return "Exact matches"
        case .relevant: return "Relevant Logins"
        case .other: return "Other Logins"
        }
    }
}

final class CredentialCandidateListModel {
    private(set) var sections: [CredentialCandidateSection]
    private var selectedCandidateID: String?
    private let onSubmit: (RankedCandidate) -> Bool

    init(candidates: [RankedCandidate], onSubmit: @escaping (RankedCandidate) -> Bool = { _ in false }) {
        self.onSubmit = onSubmit
        let groups: [CandidateGroup] = [.exact, .relevant, .other]
        sections = groups.compactMap { group in
            let rows = candidates.filter { $0.group == group }.map {
                CredentialCandidateRow(candidate: $0, reasonText: Self.readableReason(for: $0))
            }
            return rows.isEmpty ? nil : CredentialCandidateSection(group: group, rows: rows)
        }
    }

    func select(candidateID: String?) {
        selectedCandidateID = candidateID
    }

    @discardableResult
    func confirmSelection() -> Bool {
        guard let selectedCandidateID,
              let candidate = sections.lazy.flatMap(\.rows).first(where: {
                  $0.candidate.cipherID == selectedCandidateID
              })?.candidate else { return false }
        return onSubmit(candidate)
    }

    private static func readableReason(for candidate: RankedCandidate) -> String {
        switch candidate.reason {
        case "user_binding": return "Previously linked to this app"
        case "service_identifier": return "Matches the requesting service"
        case "app_preset": return "Matches this known app"
        case "vault_uri_rule": return "Matches this Login's saved URI rule"
        case "host_or_domain": return "Shares the requesting host or domain"
        case "fuzzy_name": return "Login name may relate to this app"
        case "selection_history": return "Previously filled for this context"
        case "favorite": return "Saved as a favorite Login"
        case "recent": return "Recently used Login"
        case "other" where candidate.requiresMismatchConfirmation:
            return "Does not match this service; confirmation required"
        case "other": return "Available from all Logins"
        default:
            switch candidate.group {
            case .exact: return "Matches this request"
            case .relevant: return "May be relevant to this request"
            case .other where candidate.requiresMismatchConfirmation:
                return "Does not match this service; confirmation required"
            case .other: return "Available from all Logins"
            }
        }
    }
}

final class CandidateListViewController: NSViewController {
    private enum ListEntry {
        case header(String)
        case candidate(CredentialCandidateRow)
    }

    var onSearch: (String) -> Void = { _ in }
    var onFill: (RankedCandidate) -> Bool = { _ in false }
    var onCancel: () -> Void = {}

    private var model = CredentialCandidateListModel(candidates: [])
    private var entries: [ListEntry] = []
    private let searchField = NSSearchField()
    private let tableView = NSTableView()
    private let statusLabel = NSTextField(labelWithString: "")
    private let fillButton = NSButton(title: "Fill", target: nil, action: nil)
    private let cancelButton = NSButton(title: "Cancel", target: nil, action: nil)

    override func loadView() {
        let container = NSView(frame: NSRect(x: 0, y: 0, width: 560, height: 420))
        let title = NSTextField(labelWithString: "Barwarden AutoFill")
        title.font = .boldSystemFont(ofSize: 18)
        searchField.placeholderString = "Search all Logins"
        searchField.target = self
        searchField.action = #selector(searchChanged(_:))

        let nameColumn = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("name"))
        nameColumn.title = "Login"
        nameColumn.width = 190
        let usernameColumn = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("username"))
        usernameColumn.title = "Username"
        usernameColumn.width = 160
        let reasonColumn = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("reason"))
        reasonColumn.title = "Why shown"
        reasonColumn.width = 190
        tableView.addTableColumn(nameColumn)
        tableView.addTableColumn(usernameColumn)
        tableView.addTableColumn(reasonColumn)
        tableView.headerView = NSTableHeaderView()
        tableView.dataSource = self
        tableView.delegate = self
        tableView.allowsMultipleSelection = false
        tableView.target = self
        tableView.action = #selector(tableSelectionChanged(_:))

        let scrollView = NSScrollView()
        scrollView.documentView = tableView
        scrollView.hasVerticalScroller = true
        scrollView.borderType = .bezelBorder

        statusLabel.textColor = .secondaryLabelColor
        statusLabel.lineBreakMode = .byWordWrapping
        statusLabel.maximumNumberOfLines = 2
        fillButton.target = self
        fillButton.action = #selector(fillSelected(_:))
        fillButton.isEnabled = false
        fillButton.keyEquivalent = "\r"
        cancelButton.target = self
        cancelButton.action = #selector(cancelRequest(_:))

        let buttonRow = NSStackView(views: [statusLabel, NSView(), cancelButton, fillButton])
        buttonRow.orientation = .horizontal
        buttonRow.spacing = 10
        buttonRow.setHuggingPriority(.defaultLow, for: .horizontal)
        let stack = NSStackView(views: [title, searchField, scrollView, buttonRow])
        stack.orientation = .vertical
        stack.spacing = 12
        stack.edgeInsets = NSEdgeInsets(top: 18, left: 18, bottom: 18, right: 18)
        stack.translatesAutoresizingMaskIntoConstraints = false
        scrollView.heightAnchor.constraint(greaterThanOrEqualToConstant: 280).isActive = true
        container.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            stack.topAnchor.constraint(equalTo: container.topAnchor),
            stack.bottomAnchor.constraint(equalTo: container.bottomAnchor)
        ])
        view = container
    }

    func install(candidates: [RankedCandidate]) {
        model = CredentialCandidateListModel(candidates: candidates, onSubmit: onFill)
        entries = model.sections.flatMap { section in
            [.header(section.title)] + section.rows.map(ListEntry.candidate)
        }
        tableView.reloadData()
        tableView.deselectAll(nil)
        fillButton.isEnabled = false
        statusLabel.stringValue = candidates.isEmpty
            ? "No Logins found. Search still covers every active Login."
            : "Choose a Login, then select Fill. Nothing is submitted automatically."
    }

    func showLoading() {
        statusLabel.stringValue = "Loading Logins…"
        fillButton.isEnabled = false
    }

    func showSearching() {
        statusLabel.stringValue = "Searching all Logins…"
        fillButton.isEnabled = false
    }

    func show(errorMessage: String) {
        statusLabel.stringValue = errorMessage
        fillButton.isEnabled = false
    }

    @objc private func searchChanged(_ sender: NSSearchField) {
        showSearching()
        onSearch(sender.stringValue)
    }

    @objc private func tableSelectionChanged(_ sender: NSTableView) {
        guard sender.selectedRow >= 0,
              case let .candidate(row) = entries[sender.selectedRow] else {
            model.select(candidateID: nil)
            fillButton.isEnabled = false
            return
        }
        model.select(candidateID: row.candidate.cipherID)
        fillButton.isEnabled = true
    }

    @objc private func fillSelected(_ sender: NSButton) {
        fillButton.isEnabled = false
        if !model.confirmSelection() {
            fillButton.isEnabled = true
        }
    }

    @objc private func cancelRequest(_ sender: NSButton) {
        onCancel()
    }
}

extension CandidateListViewController: NSTableViewDataSource, NSTableViewDelegate {
    func numberOfRows(in tableView: NSTableView) -> Int { entries.count }

    func tableView(_ tableView: NSTableView, shouldSelectRow row: Int) -> Bool {
        if case .candidate = entries[row] { return true }
        return false
    }

    func tableView(
        _ tableView: NSTableView,
        viewFor tableColumn: NSTableColumn?,
        row: Int
    ) -> NSView? {
        switch entries[row] {
        case let .header(title):
            guard tableColumn == tableView.tableColumns.first else { return nil }
            let label = NSTextField(labelWithString: title)
            label.font = .boldSystemFont(ofSize: 12)
            return label
        case let .candidate(row):
            let value: String
            switch tableColumn?.identifier.rawValue {
            case "name": value = row.candidate.displayName
            case "username": value = row.candidate.username
            default: value = row.reasonText
            }
            let label = NSTextField(labelWithString: value)
            label.lineBreakMode = .byTruncatingTail
            return label
        }
    }
}
