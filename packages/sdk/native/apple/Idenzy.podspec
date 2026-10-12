Pod::Spec.new do |s|
  s.name = 'Idenzy'
  s.version = '0.1.0'
  s.summary = 'Idenzy for iOS: sign-in, sessions and MFA, with the session in the Keychain.'
  s.homepage = 'https://github.com/idenzy-io/idenzy'
  s.license = { :type => 'MIT' }
  s.authors = 'Idenzy'
  # The release zip scripts/package-apple.sh writes, which carries the generated sources and the
  # XCFramework the repository does not; an app naming the pod by :path ignores this.
  s.source = { :http => "https://github.com/idenzy-io/idenzy/releases/download/v#{s.version}/idenzy-apple-#{s.version}.zip" }
  s.platforms = { :ios => '15.0' }
  s.swift_version = '5.9'
  s.source_files = 'Sources/Idenzy/**/*.swift'
  s.frameworks = 'AuthenticationServices', 'Security'
  s.dependency 'IdenzyCore', s.version.to_s
end
