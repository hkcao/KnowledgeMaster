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
            resources: [.copy("Resources/ChatRenderer")],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("PDFKit"),
                .linkedFramework("Security"),
                .linkedFramework("SystemConfiguration"),
                .linkedFramework("WebKit")
            ]
        ),
        .testTarget(name: "KnowledgeMasterTests", dependencies: ["KnowledgeMaster"])
    ]
)
