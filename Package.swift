// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "KnowledgeMaster",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "KnowledgeMaster", targets: ["KnowledgeMaster"])
    ],
    targets: [
        .executableTarget(
            name: "KnowledgeMaster",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("PDFKit"),
                .linkedFramework("Security")
            ]
        ),
        .testTarget(name: "KnowledgeMasterTests", dependencies: ["KnowledgeMaster"])
    ]
)
