import Foundation
import IdenzyCore
import Security

/// The Keychain, as PROJECT.md 4.4 specifies it: `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`.
///
/// After first unlock, so a refresh can run in the background once the user has unlocked since
/// boot. This device only, so the token is never in a backup and never restored onto another
/// phone. Before first unlock a read fails with `Unavailable`, and the core leaves the stored token
/// alone rather than read that as signed out.
///
/// Keychain items outlive the app on iOS, so a reinstall would otherwise come back signed in. The
/// first launch after an install forgets this service's items, which is what a user who deleted
/// the app expects to have happened.
public final class KeychainStore: SecureStore, @unchecked Sendable {
    private let service: String
    private let accessGroup: String?
    private let dataProtection: Bool

    /// - Parameter accessGroup: leave unset. Sharing the refresh token with an app extension needs a
    ///   cross-process lock that does not exist yet, and two processes rotating one token revoke it.
    public convenience init(service: String = "io.idenzy", accessGroup: String? = nil) {
        self.init(service: service, accessGroup: accessGroup, defaults: .standard, dataProtection: true)
    }

    /// `dataProtection: false` is the macOS file keychain, for a test host that lacks the
    /// entitlement the data-protection keychain requires. Never for an app.
    init(service: String, accessGroup: String? = nil, defaults: UserDefaults, dataProtection: Bool) {
        self.service = service
        self.accessGroup = accessGroup
        self.dataProtection = dataProtection
        let installed = "\(service).installed"
        if !defaults.bool(forKey: installed) {
            SecItemDelete(baseQuery() as CFDictionary)
            defaults.set(true, forKey: installed)
        }
    }

    public func read(key: String) throws -> String? {
        var query = itemQuery(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess:
            guard let data = result as? Data else { return nil }
            return String(decoding: data, as: UTF8.self)
        case errSecItemNotFound:
            return nil
        default:
            throw Self.failure(status)
        }
    }

    public func write(key: String, value: String) throws {
        let data = Data(value.utf8)
        let update = SecItemUpdate(itemQuery(key) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if update == errSecSuccess { return }
        guard update == errSecItemNotFound else { throw Self.failure(update) }

        var item = itemQuery(key)
        item[kSecValueData as String] = data
        if dataProtection {
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        }
        let added = SecItemAdd(item as CFDictionary, nil)
        guard added == errSecSuccess else { throw Self.failure(added) }
    }

    public func remove(key: String) throws {
        let status = SecItemDelete(itemQuery(key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw Self.failure(status) }
    }

    private func baseQuery() -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            // The iOS-style keychain on macOS too, with the same accessibility semantics.
            kSecUseDataProtectionKeychain as String: dataProtection,
        ]
        if let accessGroup { query[kSecAttrAccessGroup as String] = accessGroup }
        return query
    }

    private func itemQuery(_ key: String) -> [String: Any] {
        var query = baseQuery()
        query[kSecAttrAccount as String] = key
        return query
    }

    private static func failure(_ status: OSStatus) -> StoreFailure {
        let detail = SecCopyErrorMessageString(status, nil) as String? ?? "OSStatus \(status)"
        return .Unavailable(detail: "Keychain: \(detail)")
    }
}
