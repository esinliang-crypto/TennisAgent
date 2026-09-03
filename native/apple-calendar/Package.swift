// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "AppleCalendarBridge",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "AppleCalendarBridge", targets: ["AppleCalendarBridge"])
    ],
    targets: [
        .executableTarget(name: "AppleCalendarBridge")
    ]
)
