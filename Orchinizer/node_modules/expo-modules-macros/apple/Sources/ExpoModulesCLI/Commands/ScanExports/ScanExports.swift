import SwiftParser
import SwiftSyntax

#if canImport(FoundationEssentials)
import FoundationEssentials
#else
import Foundation
#endif

extension Scanner {
  /// Runs `scan-exports` over `paths`, prints the JSON report to stdout, and returns the exit code
  /// (`0` on success, `1` if encoding fails). The deep counterpart to `runModules`.
  public static func runExports(paths: [String]) -> Int32 {
    let result = scanExports(paths: paths)

    do {
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
      let data = try encoder.encode(result)
      writeToStandardOutput(String(decoding: data, as: UTF8.self) + "\n")
      return 0
    } catch {
      writeToStandardError("error: failed to encode results: \(error)\n")
      return 1
    }
  }
}

/// Scans `paths` for `@ExpoModule`, `@SharedObject`, `@Record`, `@Union`, `@ExpoView`, and
/// `@ViewProps` types plus `Enumerable` enums, and returns their exported surface plus the run's stats.
/// Separate from the public entry so tests can drive it without argv/stdout.
///
/// The pre-filter omits `@Event`: an event only declares a member of a module or shared object, so a
/// file containing one already matches on its enclosing type. It does include `Enumerable`, which is a
/// conformance rather than an attribute: an enum is commonly declared in a file of its own, which no
/// macro attribute would match.
func scanExports(paths: [String]) -> ScanExportsResult {
  var modules: [ExportedModule] = []
  var sharedObjects: [ExportedSharedObject] = []
  var records: [ExportedRecord] = []
  var enums: [ExportedEnum] = []
  var unions: [ExportedUnion] = []
  var views: [ExportedView] = []
  var viewProps: [ViewPropsDeclaration] = []

  let stats = scanFiles(
    paths: paths,
    macros: [.expoModule, .sharedObject, .record, .union, .expoView, .viewProps],
    conformances: [enumerableConformanceName]
  ) { source, file in
    let tree = Parser.parse(source: source)
    let visitor = SurfaceVisitor(file: file, tree: tree)
    visitor.walk(tree)
    modules.append(contentsOf: visitor.modules)
    sharedObjects.append(contentsOf: visitor.sharedObjects)
    records.append(contentsOf: visitor.records)
    enums.append(contentsOf: visitor.enums)
    unions.append(contentsOf: visitor.unions)
    views.append(contentsOf: visitor.views)
    viewProps.append(contentsOf: visitor.viewProps)
  }

  // Refs resolve only once every file has been walked: a type parsed in one file may name a type
  // declared in another, so the full set of declarations has to exist before any lookup is valid. The
  // same holds for a view's `@ViewProps` struct, which is joined before the refs resolve so that the
  // refs in its props resolve from the struct, and for a superclass, so the inherited members are
  // merged last.
  let surface = ExportedSurface(
    modules: modules,
    sharedObjects: sharedObjects,
    records: records,
    enums: enums,
    unions: unions,
    views: views
  ).joiningViewProps(viewProps).resolvingRefs().mergingInheritedMembers()

  return ScanExportsResult(
    schemaVersion: scanExportsSchemaVersion,
    exports: surface,
    stats: stats
  )
}
