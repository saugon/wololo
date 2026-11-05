// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "WololoDesk",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "WololoKit", targets: ["WololoKit"]),
        .executable(name: "WololoDesk", targets: ["WololoDesk"]),
    ],
    targets: [
        .target(name: "WololoKit"),
        .executableTarget(name: "WololoDesk", dependencies: ["WololoKit"]),
        .testTarget(name: "WololoKitTests", dependencies: ["WololoKit"]),
    ]
)
