import EventKit
import Foundation

struct BridgeError: Codable {
    let code: String
    let message: String
}

struct BusyInterval: Codable {
    let start: String
    let end: String
}

struct BridgeResponse: Codable {
    let source: String
    let status: String
    let permission: String
    let busy: [BusyInterval]
    let error: BridgeError?
}

struct Arguments {
    let start: Date
    let end: Date
    let timezone: String
    let requestPermission: Bool
}

func parseDate(_ value: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: value) {
        return date
    }

    let wholeSeconds = ISO8601DateFormatter()
    wholeSeconds.formatOptions = [.withInternetDateTime]
    return wholeSeconds.date(from: value)
}

func formatDate(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
}

func parseArguments() throws -> Arguments {
    var start: Date?
    var end: Date?
    var timezone = TimeZone.current.identifier
    var requestPermission = false
    let values = Array(CommandLine.arguments.dropFirst())
    var index = 0

    while index < values.count {
        let key = values[index]
        if key == "--request-permission" {
            requestPermission = true
            index += 1
            continue
        }

        guard index + 1 < values.count else {
            throw NSError(domain: "AppleCalendarBridge", code: 2, userInfo: [NSLocalizedDescriptionKey: "Missing value for \(key)"])
        }

        let value = values[index + 1]
        if key == "--start" {
            start = parseDate(value)
        } else if key == "--end" {
            end = parseDate(value)
        } else if key == "--timezone" {
            timezone = value
        }
        index += 2
    }

    guard let parsedStart = start, let parsedEnd = end else {
        throw NSError(domain: "AppleCalendarBridge", code: 2, userInfo: [NSLocalizedDescriptionKey: "--start and --end are required"])
    }

    return Arguments(start: parsedStart, end: parsedEnd, timezone: timezone, requestPermission: requestPermission)
}

func emit(_ response: BridgeResponse) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    if let data = try? encoder.encode(response), let text = String(data: data, encoding: .utf8) {
        print(text)
    }
}

func emitError(code: String, message: String, permission: String = "unknown") {
    emit(BridgeResponse(
        source: "apple_eventkit",
        status: "unavailable",
        permission: permission,
        busy: [],
        error: BridgeError(code: code, message: message)
    ))
}

func permissionName(_ status: EKAuthorizationStatus) -> String {
    switch status {
    case .notDetermined:
        return "not_determined"
    case .restricted:
        return "restricted"
    case .denied:
        return "denied"
    case .fullAccess:
        return "granted"
    case .writeOnly:
        return "write_only"
    @unknown default:
        return "unknown"
    }
}

func calendarIsIgnored(_ calendar: EKCalendar) -> Bool {
    switch calendar.type {
    case .birthday:
        return true
    default:
        return false
    }
}

func eventIsBlocking(_ event: EKEvent) -> Bool {
    if event.status == .canceled {
        return false
    }

    if event.isAllDay {
        return false
    }

    if calendarIsIgnored(event.calendar) {
        return false
    }

    if event.availability == .free {
        return false
    }

    return true
}

@main
struct AppleCalendarBridge {
    static func main() async {
        let arguments: Arguments
        do {
            arguments = try parseArguments()
            _ = TimeZone(identifier: arguments.timezone)
        } catch {
            emitError(code: "APPLE_PROVIDER_ERROR", message: error.localizedDescription)
            Foundation.exit(2)
        }

        let store = EKEventStore()
        let status = EKEventStore.authorizationStatus(for: .event)

        if status == .notDetermined && !arguments.requestPermission {
            emitError(code: "APPLE_PERMISSION_REQUIRED", message: "Calendar permission has not been requested", permission: "not_determined")
            Foundation.exit(3)
        }

        if status == .notDetermined && arguments.requestPermission {
            do {
                let granted = try await store.requestFullAccessToEvents()
                if !granted {
                    emitError(code: "APPLE_PERMISSION_DENIED", message: "Calendar permission was not granted", permission: "denied")
                    Foundation.exit(4)
                }
            } catch {
                emitError(code: "APPLE_PERMISSION_DENIED", message: error.localizedDescription, permission: "denied")
                Foundation.exit(4)
            }
        } else if status == .denied || status == .restricted || status == .writeOnly {
            emitError(code: "APPLE_PERMISSION_DENIED", message: "Calendar permission is \(permissionName(status))", permission: permissionName(status))
            Foundation.exit(4)
        } else if status != .fullAccess {
            emitError(code: "APPLE_PROVIDER_ERROR", message: "Unsupported Calendar permission state: \(permissionName(status))", permission: permissionName(status))
            Foundation.exit(5)
        }

        let predicate = store.predicateForEvents(withStart: arguments.start, end: arguments.end, calendars: nil)
        let events = store.events(matching: predicate)
        let busy = events
            .filter(eventIsBlocking)
            .map { event in
                BusyInterval(
                    start: formatDate(event.startDate),
                    end: formatDate(event.endDate)
                )
            }
            .sorted { $0.start < $1.start }

        emit(BridgeResponse(
            source: "apple_eventkit",
            status: "available",
            permission: "granted",
            busy: busy,
            error: nil
        ))
    }
}
