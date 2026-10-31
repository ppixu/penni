import Foundation

// Compatibility entry point. The SVG is now the canonical logo master.
let builder = Process()
builder.executableURL = URL(fileURLWithPath: "/usr/bin/env")
builder.arguments = ["node", "docs/brand/vector/build-assets.mjs"]
try builder.run()
builder.waitUntilExit()
exit(builder.terminationStatus)
