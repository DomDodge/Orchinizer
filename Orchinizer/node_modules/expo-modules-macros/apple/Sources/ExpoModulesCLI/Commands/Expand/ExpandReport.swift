/// Version of the `expand --json` output shape. Independent of the scan schema versions: bump it when
/// the shape of `ExpandResult` changes, together with `SUPPORTED_EXPAND_SCHEMA_VERSION` and the mirror
/// types in `src/types.ts`.
public let expandSchemaVersion = 1

/// The JSON report of `expand --json`.
public struct ExpandResult: Codable, Equatable, Sendable {
  public let schemaVersion: Int

  /// One entry per expanded file: the files in argument order, the files of a directory sorted.
  public let files: [ExpandedFile]
}

/// What the macros generate for one source file, and what they report about it.
public struct ExpandedFile: Codable, Equatable, Sendable {
  /// The path as it was passed on the command line, or the absolute path of a file found in a
  /// directory.
  public let file: String

  /// Without `--symbol`, one expansion of the whole file. With it, one expansion per symbol found in
  /// this file, in the order of the options. Empty with `--diagnostics-only`.
  public let expansions: [Expansion]

  /// The syntax errors in the file and the diagnostics of the macros, in source order. With
  /// `--symbol`, only those inside the declarations of the symbols.
  public let diagnostics: [ExpansionDiagnostic]

  public init(file: String, expansions: [Expansion], diagnostics: [ExpansionDiagnostic]) {
    self.file = file
    self.expansions = expansions
    self.diagnostics = diagnostics
  }
}

/// Expanded source code.
public struct Expansion: Codable, Equatable, Sendable {
  /// The `--symbol` value this expansion is for, or `nil` for the whole file.
  public let symbol: String?

  public let source: String

  public init(symbol: String?, source: String) {
    self.symbol = symbol
    self.source = source
  }
}

/// A diagnostic, at its location in the original source file. A diagnostic that a macro attaches to
/// the code it generates has the location of the macro attribute.
public struct ExpansionDiagnostic: Codable, Equatable, Sendable {
  public enum Severity: String, Codable, Sendable {
    case error
    case warning
    case note
    case remark
  }

  public let severity: Severity
  public let message: String

  /// 1-based, as in the compiler's output. The column counts UTF-8 bytes.
  public let line: Int
  public let column: Int

  public let notes: [ExpansionNote]

  /// The messages of the Fix-Its, for example `replace 'var' with 'let'`.
  public let fixIts: [String]

  /// The edits of each Fix-It in `fixIts`, in the original file, for `fix`. The edits of a Fix-It are
  /// empty when they aren't in the original file, and this is empty for a diagnostic whose Fix-Its
  /// `fix` doesn't apply, such as a syntax error. Not part of the JSON report, nor of equality, so a
  /// diagnostic is equal to itself after a JSON round trip.
  public var fixItEdits: [[ExpansionEdit]] = []

  private enum CodingKeys: String, CodingKey {
    case severity, message, line, column, notes, fixIts
  }

  public static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.severity == rhs.severity && lhs.message == rhs.message && lhs.line == rhs.line
      && lhs.column == rhs.column && lhs.notes == rhs.notes && lhs.fixIts == rhs.fixIts
  }

  public init(
    severity: Severity,
    message: String,
    line: Int,
    column: Int,
    notes: [ExpansionNote] = [],
    fixIts: [String] = [],
    fixItEdits: [[ExpansionEdit]] = []
  ) {
    self.severity = severity
    self.message = message
    self.line = line
    self.column = column
    self.notes = notes
    self.fixIts = fixIts
    self.fixItEdits = fixItEdits
  }
}

/// A change of one range of the original file: `original`, which starts at `offset`, becomes
/// `replacement`.
public struct ExpansionEdit: Equatable, Sendable {
  /// The UTF-8 offset in the original file.
  public let offset: Int

  /// The text that the edit replaces, so `fix` can check that the file still has it there. An
  /// insertion also replaces a few bytes after it with themselves, so it has text to check too, and
  /// is empty only at the end of a declaration.
  public let original: String

  public let replacement: String

  public init(offset: Int, original: String, replacement: String) {
    self.offset = offset
    self.original = original
    self.replacement = replacement
  }
}

/// A note attached to a diagnostic, at its own location.
public struct ExpansionNote: Codable, Equatable, Sendable {
  public let message: String
  public let line: Int
  public let column: Int

  public init(message: String, line: Int, column: Int) {
    self.message = message
    self.line = line
    self.column = column
  }
}

/// Expands the macros in one source file. The macro implementations live in the plugin executable,
/// which this library can't depend on, so the executable passes this in (see `ScannerCLI`).
public struct MacroExpander {
  /// The attribute names of the macros, such as `ExpoModule`. A file found in a directory is expanded
  /// only when it contains one of them after an `@`.
  let attributeNames: Set<String>

  /// - Parameters:
  ///   - source: The contents of the file.
  ///   - file: The path of the file, for the diagnostics and the expansion context.
  ///   - symbols: The `--symbol` values. Empty to expand the whole file.
  let expand: (_ source: String, _ file: String, _ symbols: [String]) -> ExpandedFile

  public init(
    attributeNames: Set<String>,
    expand: @escaping (_ source: String, _ file: String, _ symbols: [String]) -> ExpandedFile
  ) {
    self.attributeNames = attributeNames
    self.expand = expand
  }
}
