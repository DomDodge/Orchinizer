#if canImport(FoundationEssentials)
import FoundationEssentials
#else
import Foundation
#endif

/// The options of `fix`, parsed by `ScannerCLI`.
struct FixOptions: Equatable {
  var paths: [String] = []
  var symbols: [String] = []
  var dryRun = false
  var onlyErrors = false
}

/// A Fix-It that `fix` applied or skipped, at the location of its diagnostic.
struct FixItReport: Equatable {
  let line: Int
  let column: Int
  let message: String

  /// Why `fix` skipped the Fix-It, or `nil` when it applied it.
  let skipReason: String?
}

/// The result of applying the Fix-Its of one file.
struct FixedSource: Equatable {
  /// The source with the applied Fix-Its.
  let source: String
  let fixIts: [FixItReport]

  /// Whether `fixSource` stopped after `maxFixPasses` passes while Fix-Its were left to apply.
  var reachedPassLimit = false

  var applied: [FixItReport] {
    fixIts.filter { $0.skipReason == nil }
  }
}

extension Scanner {
  /// Runs `fix`: expands the macros in each file like `expand` and applies the Fix-Its of their
  /// diagnostics to the file, in place (see `fixSource`). It doesn't format the file.
  ///
  /// Each applied Fix-It is printed to stdout as `<file>:<line>:<column>: fix-it: <message>` after its
  /// file is written, followed by a summary, and each skipped one to stderr as a warning. With
  /// `--dry-run`, the files aren't written. A file that can't be written is reported and the others are
  /// still fixed. The exit code is `0` also when a Fix-It is skipped, `1` when a file can't be written,
  /// and `2` for an input that `expand` doesn't take.
  ///
  /// `write` writes a fixed file and returns whether it changed it (see `writeFixedSource`); tests
  /// replace it. A file that another path already fixed, through a hard link, isn't printed or counted
  /// again.
  static func runFix(
    options: FixOptions,
    expander: MacroExpander,
    write: (_ source: String, _ path: String, _ original: Data) throws -> Bool = writeFixedSource
  ) -> Int32 {
    let sources: [(source: String, contents: Data, expanded: ExpandedFile)]
    switch expandSources(options: ExpandOptions(paths: options.paths, symbols: options.symbols), expander: expander) {
    case .success(let expanded):
      sources = expanded
    case .failure(let error):
      writeToStandardError("error: \(error.message)\n")
      return 2
    }

    var appliedCount = 0
    var fixedFiles = 0
    var failedFiles = 0
    for (source, contents, expanded) in sources {
      let fixed = fixSource(
        source,
        expanded: expanded,
        symbols: options.symbols,
        onlyErrors: options.onlyErrors,
        expander: expander
      )
      writeToStandardError(renderSkippedFixIts(fixed, file: expanded.file))
      guard !fixed.applied.isEmpty else {
        continue
      }
      if !options.dryRun {
        do {
          guard try write(fixed.source, expanded.file, contents) else {
            continue
          }
        } catch {
          writeToStandardError("error: could not write '\(expanded.file)': \(error)\n")
          failedFiles += 1
          continue
        }
      }
      writeToStandardOutput(renderAppliedFixIts(fixed, file: expanded.file))
      appliedCount += fixed.applied.count
      fixedFiles += 1
    }

    writeToStandardOutput(
      renderFixSummary(applied: appliedCount, files: fixedFiles, failed: failedFiles, dryRun: options.dryRun)
    )
    return failedFiles > 0 ? 1 : 0
  }
}

/// Why `writeFixedSource` didn't write a file.
struct FixWriteError: Error, CustomStringConvertible {
  let description: String
}

/// Writes `source`, the fixed source of the file at `path`, whose contents were `original`, and
/// returns whether it changed the file.
///
/// The file must still have the contents that `fix` read, so a change that an editor saved meanwhile
/// isn't lost. A file that already has the fixed contents, because `fix` wrote it through another
/// hard link, is left as it is. It keeps the UTF-8 byte order mark of the file, which `readSource`
/// removes from the source.
///
/// The file is written in place, so on macOS and Linux its links, permissions, owner, extended
/// attributes and ACLs stay, and a read-only file isn't written. When the write fails, the original contents are written back,
/// and the error tells whether the file is unchanged. When that fails too, the original contents are
/// saved to a file in the temporary directory, which the error names.
@discardableResult
func writeFixedSource(_ source: String, toFile path: String, original: Data) throws -> Bool {
  let url = URL(fileURLWithPath: path)
  let contents = Data((original.starts(with: utf8ByteOrderMark) ? utf8ByteOrderMark : []) + Array(source.utf8))
  guard let current = try? Data(contentsOf: url) else {
    throw FixWriteError(description: "the file can't be read anymore")
  }
  guard current != contents else {
    return false
  }
  guard current == original else {
    throw FixWriteError(description: "the file changed after fix read it")
  }
  do {
    try contents.write(to: url)
  } catch {
    if (try? Data(contentsOf: url)) != original {
      try? original.write(to: url)
    }
    if (try? Data(contentsOf: url)) == original {
      throw FixWriteError(description: "\(error); the file is unchanged")
    }
    let backup = FileManager.default.temporaryDirectory.appendingPathComponent(
      "\(url.lastPathComponent).\(UUID().uuidString).original"
    )
    let saved = (try? original.write(to: backup)) != nil
    throw FixWriteError(
      description: "\(error); the file can be incomplete"
        + (saved ? ", and its original contents are in '\(backup.path)'" : "")
    )
  }
  return true
}

/// The most times that `fixSource` expands a file again after applying Fix-Its.
let maxFixPasses = 10

/// Applies the Fix-Its of `expanded`, the expansion of `source`, to `source`. A macro can stop at its
/// first error, so after applying Fix-Its, this expands the result again and applies the new Fix-Its,
/// until none applies or after `maxFixPasses` passes. The location of an applied Fix-It is in the
/// source of its pass. The skipped Fix-Its are those of the last pass. With `onlyErrors`, the Fix-Its
/// of warnings and other diagnostics that aren't errors are left out.
func fixSource(
  _ source: String,
  expanded: ExpandedFile,
  symbols: [String],
  onlyErrors: Bool = false,
  expander: MacroExpander
) -> FixedSource {
  let selected = { (diagnostics: [ExpansionDiagnostic]) in
    onlyErrors ? diagnostics.filter { $0.severity == .error } : diagnostics
  }
  var fixed = applyFixIts(to: source, diagnostics: selected(expanded.diagnostics))
  var applied = fixed.applied
  for _ in 1..<maxFixPasses where !fixed.applied.isEmpty {
    let diagnostics = expander.expand(fixed.source, expanded.file, symbols).diagnostics
    fixed = applyFixIts(to: fixed.source, diagnostics: selected(diagnostics))
    applied += fixed.applied
  }
  // After the last pass, expand once more to tell whether Fix-Its are left.
  let reachedPassLimit =
    !fixed.applied.isEmpty
    && !applyFixIts(
      to: fixed.source,
      diagnostics: selected(expander.expand(fixed.source, expanded.file, symbols).diagnostics)
    ).applied.isEmpty
  return FixedSource(
    source: fixed.source,
    fixIts: applied + fixed.fixIts.filter { $0.skipReason != nil },
    reachedPassLimit: reachedPassLimit
  )
}

/// Applies the Fix-Its of `diagnostics` to `source`, which is the file that they were reported for.
///
/// A diagnostic with more than one Fix-It is skipped, because they are alternatives. So is a Fix-It
/// whose edits aren't in the file, or whose edits overlap the edits of a Fix-It before it. A Fix-It
/// with the same edits as one before it, which a macro can report twice, is left out. A diagnostic
/// without `fixItEdits`, such as a syntax error, is left out too.
func applyFixIts(to source: String, diagnostics: [ExpansionDiagnostic]) -> FixedSource {
  let text = Array(source.utf8)
  var accepted: [ExpansionEdit] = []
  var reports: [FixItReport] = []

  for diagnostic in diagnostics
  where !diagnostic.fixIts.isEmpty && diagnostic.fixItEdits.count == diagnostic.fixIts.count {
    let report = { (message: String, reason: String?) in
      reports.append(
        FixItReport(line: diagnostic.line, column: diagnostic.column, message: message, skipReason: reason)
      )
    }
    guard diagnostic.fixIts.count == 1, let message = diagnostic.fixIts.first, let edits = diagnostic.fixItEdits.first
    else {
      for message in diagnostic.fixIts {
        report(message, "the diagnostic has \(diagnostic.fixIts.count) Fix-Its to choose from")
      }
      continue
    }
    if !edits.isEmpty && edits.allSatisfy(accepted.contains) {
      continue
    }
    guard !edits.isEmpty, edits.allSatisfy({ matches($0, in: text) }) else {
      report(message, "its edits aren't in the file")
      continue
    }
    let overlaps = edits.enumerated().contains { index, edit in
      (accepted + edits.prefix(index)).contains { overlap(edit, $0) }
    }
    guard !overlaps else {
      report(message, "it overlaps another Fix-It")
      continue
    }
    accepted += edits
    report(message, nil)
  }

  var fixed = text
  for edit in accepted.sorted(by: { $0.offset > $1.offset }) {
    fixed.replaceSubrange(edit.offset..<(edit.offset + edit.original.utf8.count), with: Array(edit.replacement.utf8))
  }
  return FixedSource(source: String(decoding: fixed, as: UTF8.self), fixIts: reports)
}

/// Whether `text` has the original text of `edit` at its offset.
private func matches(_ edit: ExpansionEdit, in text: [UInt8]) -> Bool {
  let original = Array(edit.original.utf8)
  return edit.offset >= 0 && edit.offset + original.count <= text.count
    && text[edit.offset..<(edit.offset + original.count)].elementsEqual(original)
}

/// Whether two edits change the same bytes, or insert at the same offset, where their order would
/// matter.
private func overlap(_ a: ExpansionEdit, _ b: ExpansionEdit) -> Bool {
  let aEnd = a.offset + a.original.utf8.count
  let bEnd = b.offset + b.original.utf8.count
  return a.offset == b.offset || (a.offset < bEnd && b.offset < aEnd)
}

/// The applied Fix-Its of `fixed`, one line each.
func renderAppliedFixIts(_ fixed: FixedSource, file: String) -> String {
  fixed.applied.map { "\(file):\($0.line):\($0.column): fix-it: \($0.message)\n" }.joined()
}

/// The warnings for the skipped Fix-Its of `fixed`, and for reaching the pass limit.
func renderSkippedFixIts(_ fixed: FixedSource, file: String) -> String {
  var text = ""
  for fixIt in fixed.fixIts {
    if let reason = fixIt.skipReason {
      text += "\(file):\(fixIt.line):\(fixIt.column): warning: skipped fix-it '\(fixIt.message)': \(reason)\n"
    }
  }
  if fixed.reachedPassLimit {
    text += "\(file): warning: stopped after \(maxFixPasses) passes; run fix again for the Fix-Its left\n"
  }
  return text
}

/// The summary line of `fix`, for example `Applied 3 Fix-Its in 2 files.` or, when files couldn't be
/// written, `Applied 1 Fix-It in 1 file. Could not write 1 file.`
func renderFixSummary(applied: Int, files: Int, failed: Int = 0, dryRun: Bool) -> String {
  let count = { (n: Int, noun: String) in "\(n) \(noun)\(n == 1 ? "" : "s")" }
  var parts: [String] = []
  if applied > 0 {
    parts.append("\(dryRun ? "Would apply" : "Applied") \(count(applied, "Fix-It")) in \(count(files, "file")).")
  }
  if failed > 0 {
    parts.append("Could not write \(count(failed, "file")).")
  }
  return (parts.isEmpty ? "No Fix-Its to apply." : parts.joined(separator: " ")) + "\n"
}
